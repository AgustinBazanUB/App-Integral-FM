import test from "node:test";
import assert from "node:assert/strict";
import { invoiceDeliveryLabel, normalizeInvoiceEmail } from "../src/shared/invoiceDelivery.mjs";
import { invoiceEmailConfiguration, invoiceSmtpOptions, sendInvoiceEmail, verifyInvoiceEmailConnection } from "../netlify/functions/_lib/arca/invoiceEmail.mjs";
import { canReadInvoice, resolveInvoice } from "../netlify/functions/arca-document.mjs";

const env = { INVOICE_SMTP_HOST: "smtp.gmail.com", INVOICE_SMTP_PORT: "465", INVOICE_SMTP_USER: "flormia@example.com", INVOICE_SMTP_PASSWORD: "test-only" };
const invoice = { sourceType: "seller_sale", sourceId: "sale-own", authorization: { voucherClass: "B", pointOfSale: 8, voucherNumber: 320 } };

function harness({ fail = false, auditFail = false } = {}) {
  const documents = new Map();
  const messages = [];
  const args = {
    invoiceId: "invoice-test", invoice, pdf: Buffer.from("%PDF-1.4\nfixture"), filename: "Factura_B_00008-00000320.pdf",
    to: "cliente@example.com", uid: "seller-1", requestId: "test-request-00000001", env, now: new Date("2026-10-09T15:00:00Z"),
    runTransaction: async (work) => work({
      getDocument: async (path) => documents.has(path) ? { data: documents.get(path) } : null,
      commitDocuments: async (operations) => { for (const op of operations) documents.set(op.path, op.data); },
    }),
    patchDocument: async (path, data) => { if (auditFail) throw new Error("database unavailable"); documents.set(path, { ...documents.get(path), ...data }); },
    createTransport: () => ({
      sendMail: async (message) => { messages.push(message); if (fail) throw new Error("SMTP password must not appear in API response"); return { accepted: [message.to], rejected: [], messageId: "smtp-fixture" }; },
      close: () => {},
    }),
  };
  return { args, documents, messages };
}

test("correo: sólo una dirección, sin inyección de cabeceras ni destinatarios adicionales", () => {
  assert.equal(normalizeInvoiceEmail(" cliente+facturas@example.com "), "cliente+facturas@example.com");
  for (const invalid of ["", "a@example.com,b@example.com", "a@example.com\r\nBcc: b@example.com", "Cliente <a@example.com>", "a@localhost"]) assert.throws(() => normalizeInvoiceEmail(invalid));
  assert.equal(invoiceDeliveryLabel(invoice), "Factura B 00008-00000320");
});

test("correo: configuración no expone credenciales y exige TLS y datos completos", () => {
  assert.deepEqual(invoiceEmailConfiguration({}), { ready: false, from: null });
  assert.deepEqual(invoiceEmailConfiguration(env), { ready: true, from: "flormia@example.com" });
  const options = invoiceSmtpOptions(env);
  assert.equal(options.secure, true);
  assert.equal(options.requireTLS, true);
  assert.equal(options.disableFileAccess, true);
  assert.equal(options.disableUrlAccess, true);
  assert.equal(options.tls.rejectUnauthorized, true);
  assert.equal(invoiceSmtpOptions({ ...env, INVOICE_SMTP_PORT: "587" }).secure, false);
  assert.equal(invoiceSmtpOptions({ ...env, INVOICE_SMTP_PASSWORD: "abcd efgh ijkl mnop" }).auth.pass, "abcdefghijklmnop");
  assert.equal(invoiceEmailConfiguration({ ...env, INVOICE_SMTP_PASSWORD: "   " }).ready, false);
});

test("correo: verifica autenticación SMTP sin enviar mensajes ni exponer el fallo original", async () => {
  let verified = 0;
  const createTransport = () => ({ verify: async () => { verified += 1; }, close: () => {} });
  assert.deepEqual(await verifyInvoiceEmailConnection({ env, createTransport }), { ready: true, from: "flormia@example.com", verified: true });
  assert.equal(verified, 1);
  await assert.rejects(verifyInvoiceEmailConnection({ env, createTransport: () => ({ verify: async () => { throw new Error("secret SMTP response"); }, close: () => {} }) }), (error) => error.code === "arca-email-connection-failed" && !error.message.includes("secret"));
});

test("correo: adjunta el PDF del servidor y el mismo intento no vuelve a enviarse", async () => {
  const { args, messages } = harness();
  const first = await sendInvoiceEmail(args);
  const repeated = await sendInvoiceEmail(args);
  assert.equal(first.accepted, true); assert.equal(repeated.repeated, true);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].attachments, [{ filename: args.filename, content: args.pdf, contentType: "application/pdf" }]);
  assert.equal(messages[0].to, "cliente@example.com");
  assert.match(messages[0].subject, /00008-00000320/);
  await assert.rejects(sendInvoiceEmail({ ...args, requestId: "test-request-00000002" }), { code: "arca-email-rate-limit" });
});

test("correo: falla incierta o auditoría caída no duplica el envío ni revela el error SMTP", async () => {
  const failing = harness({ fail: true });
  await assert.rejects(sendInvoiceEmail(failing.args), (error) => error.code === "arca-email-send-failed" && !error.message.includes("password"));
  await assert.rejects(sendInvoiceEmail(failing.args), { code: "arca-email-outcome-unknown" });
  assert.equal(failing.messages.length, 1);
  const audit = harness({ auditFail: true });
  assert.equal((await sendInvoiceEmail(audit.args)).accepted, true);
  await assert.rejects(sendInvoiceEmail(audit.args), { code: "arca-email-outcome-unknown" });
  assert.equal(audit.messages.length, 1);
});

test("correo: no inicia envío sin conexión, con destinatario inválido o solicitud ajena", async () => {
  const { args, messages, documents } = harness();
  await assert.rejects(sendInvoiceEmail({ ...args, env: {} }), { code: "arca-email-not-configured" });
  await assert.rejects(sendInvoiceEmail({ ...args, to: "bad" }), { code: "arca-email-recipient-invalid" });
  assert.equal(documents.size, 0); assert.equal(messages.length, 0);
  await sendInvoiceEmail(args);
  await assert.rejects(sendInvoiceEmail({ ...args, to: "otro@example.com" }), { code: "arca-email-request-mismatch" });
});

test("documento: vendedor sólo accede a su factura y no puede combinar su venta con una ajena", async () => {
  assert.equal(canReadInvoice({ session: { uid: "seller-1", profile: { role: "seller" } }, sale: { sellerId: "seller-1" }, invoice }), true);
  assert.equal(canReadInvoice({ session: { uid: "seller-2", profile: { role: "seller" } }, sale: { sellerId: "seller-1" }, invoice }), false);
  const documents = new Map([
    ["sales/sale-own", { data: { sellerId: "seller-1" } }],
    ["invoices/invoice-other", { data: { ...invoice, sourceId: "sale-other" } }],
  ]);
  await assert.rejects(resolveInvoice({ invoiceId: "invoice-other", sourceType: "seller_sale", sourceId: "sale-own", env: {}, getDocument: async (path) => documents.get(path) }), { code: "arca-document-source-mismatch" });
});
