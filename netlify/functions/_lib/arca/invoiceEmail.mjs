import nodemailer from "nodemailer";
import { createHash } from "node:crypto";
import { adminPatchDocument, adminRunTransaction } from "../firestoreAdminRest.mjs";
import { invoiceDeliveryLabel, normalizeInvoiceEmail } from "../../../../src/shared/invoiceDelivery.mjs";

const emailError = (code, message, status = 400) => Object.assign(new Error(message), { code, status });

export function invoiceEmailConfiguration(env = process.env) {
  let from = "";
  try { from = normalizeInvoiceEmail(env.INVOICE_SMTP_FROM || env.INVOICE_SMTP_USER); } catch { /* unconfigured */ }
  const host = String(env.INVOICE_SMTP_HOST || "").trim();
  const port = Number(env.INVOICE_SMTP_PORT || 465);
  const ready = Boolean(from && host && [465, 587].includes(port)
    && env.INVOICE_SMTP_USER && env.INVOICE_SMTP_PASSWORD);
  return { ready, from: ready ? from : null };
}

export function invoiceSmtpOptions(env = process.env) {
  if (!invoiceEmailConfiguration(env).ready) throw emailError("arca-email-not-configured", "Falta conectar la cuenta de correo de Flor Mía. Podés descargar o imprimir la factura mientras tanto.", 503);
  const port = Number(env.INVOICE_SMTP_PORT || 465);
  return {
    host: String(env.INVOICE_SMTP_HOST).trim(), port, secure: port === 465,
    requireTLS: true, tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    auth: { user: env.INVOICE_SMTP_USER, pass: env.INVOICE_SMTP_PASSWORD },
    connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true,
  };
}

// Claim before SMTP; a repeated request never submits a second message, even
// after a network timeout or a failed audit write. SMTP runs outside transactions.
export async function sendInvoiceEmail({ invoiceId, invoice, pdf, filename, to, requestId, uid,
  env = process.env, now = new Date(), runTransaction = adminRunTransaction,
  patchDocument = adminPatchDocument, createTransport = nodemailer.createTransport,
}) {
  const recipient = normalizeInvoiceEmail(to);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(String(requestId || ""))) throw emailError("arca-email-request-invalid", "No se pudo identificar el envío. Cerrá y volvé a abrir la opción de correo.");
  const smtpOptions = invoiceSmtpOptions(env);
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  const requestPath = `invoiceEmailRequests/${digest(`${invoiceId}|${requestId}`)}`;
  const guardPath = `invoiceEmailLimits/${digest(invoiceId)}`;
  const at = new Date(now).toISOString();
  const previous = await runTransaction(async ({ getDocument, commitDocuments }) => {
    const request = await getDocument(requestPath);
    const guard = await getDocument(guardPath);
    if (request) {
      if (request.data.to !== recipient || request.data.uid !== uid) throw emailError("arca-email-request-mismatch", "Este envío corresponde a otro destinatario o usuario.", 409);
      if (request.data.status === "accepted") return request.data;
      throw emailError("arca-email-outcome-unknown", "Este envío ya se inició. Verificá con el destinatario si recibió el correo antes de intentar otro envío.", 409);
    }
    if (guard && new Date(now).getTime() - Date.parse(guard.data.startedAt) < 60000) throw emailError("arca-email-rate-limit", "Esperá un minuto antes de volver a enviar esta factura.", 429);
    await commitDocuments([
      { type: "create", path: requestPath, data: { invoiceId, requestId, uid, to: recipient, status: "sending", startedAt: at } },
      { type: guard ? "update" : "create", path: guardPath, data: { startedAt: at } },
    ]);
    return null;
  }, { env });
  if (previous) return { accepted: true, to: recipient, acceptedAt: previous.acceptedAt, repeated: true };

  const transport = createTransport(smtpOptions);
  let info;
  try {
    info = await transport.sendMail({
      from: { name: "Flor Mía", address: invoiceEmailConfiguration(env).from },
      to: recipient,
      subject: `${invoiceDeliveryLabel(invoice)} · Flor Mía`,
      text: `Hola,\n\nAdjuntamos tu ${invoiceDeliveryLabel(invoice)} de Flor Mía en formato PDF, con su CAE y código QR.\nPodés descargarla o imprimirla.\n\nGracias por tu compra.\nFlor Mía`,
      attachments: [{ filename, content: pdf, contentType: "application/pdf" }],
      disableFileAccess: true, disableUrlAccess: true,
    });
    if (!info.accepted?.length || info.rejected?.length) throw new Error("Recipient rejected");
  } catch {
    await patchDocument(requestPath, { status: "unknown", updatedAt: at }, { env }).catch(() => {});
    throw emailError("arca-email-send-failed", "No se pudo confirmar el envío. Revisá la conexión del correo y consultá con el destinatario antes de volver a enviarlo.", 502);
  } finally { transport.close(); }
  const receipt = { accepted: true, to: recipient, acceptedAt: new Date().toISOString() };
  // Acceptance is established by SMTP, not by the optional audit acknowledgement.
  await patchDocument(requestPath, { status: "accepted", acceptedAt: receipt.acceptedAt, messageId: String(info.messageId || "") }, { env }).catch(() => {});
  return receipt;
}
