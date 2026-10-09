import { safeFiscalError } from "../../src/shared/fiscalRecovery.mjs";
import { requireFirebaseActiveProfile } from "./_lib/firebaseAuth.mjs";
import { adminGetDocument } from "./_lib/firestoreAdminRest.mjs";
import { invoiceIdForEnvironment } from "./_lib/arca/billing.mjs";
import { arcaEnvironment } from "./_lib/arca/config.mjs";
import { syncInvoiceToSale } from "./_lib/arca/invoicePersistence.mjs";
import { buildInvoicePdf, inspectInvoicePdfReadiness } from "./_lib/arca/invoicePdf.mjs";
import { invoiceEmailConfiguration, sendInvoiceEmail, verifyInvoiceEmailConnection } from "./_lib/arca/invoiceEmail.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  },
});

function safeError(error) {
  if (/^arca-email-/.test(error?.code || "")) return { code: error.code, message: error.message };
  return { ...safeFiscalError(error), ...(Array.isArray(error?.missing) ? { missing: error.missing } : {}) };
}

function isAdmin(session) {
  const profile = session?.profile || {};
  const roles = Array.isArray(profile.roles) ? profile.roles : [];
  const role = String(profile.role || roles[0] || "")
    .trim()
    .toLowerCase()
    .replaceAll(" ", "_");
  return role === "admin"
    || role === "general_admin"
    || profile.canAccessAdmin === true
    || profile.isAdmin === true
    || roles.includes("admin");
}

export function canReadInvoice({ session, sale, invoice }) {
  if (isAdmin(session)) return true;
  if (invoice?.sourceType === "seller_sale" && sale?.sellerId === session?.uid) return true;
  return false;
}

export async function resolveInvoice({ invoiceId, sourceType, sourceId, env, getDocument = adminGetDocument }) {
  let resolvedInvoiceId = String(invoiceId || "").trim();
  let saleDocument = null;

  if (sourceId) {
    saleDocument = await getDocument(`sales/${sourceId}`, { env });
    if (!saleDocument?.data) {
      const error = new Error("La venta asociada no existe.");
      error.code = "arca-sale-not-found";
      error.status = 404;
      throw error;
    }
    if (!resolvedInvoiceId && saleDocument.data.fiscalInvoiceId) {
      resolvedInvoiceId = String(saleDocument.data.fiscalInvoiceId);
    }
  }

  if (!resolvedInvoiceId) {
    if (!sourceType || !sourceId) {
      const error = new Error("Falta identificar la factura o su venta de origen.");
      error.code = "arca-document-source-missing";
      error.status = 400;
      throw error;
    }
    resolvedInvoiceId = invoiceIdForEnvironment(
      arcaEnvironment(env).id,
      String(sourceType).trim(),
      String(sourceId).trim(),
    );
  }

  const invoiceDocument = await getDocument(`invoices/${resolvedInvoiceId}`, { env });
  if (!invoiceDocument?.data) {
    const error = new Error("Todavía no existe una factura fiscal para esta venta.");
    error.code = "arca-invoice-not-found";
    error.status = 404;
    throw error;
  }

  const invoice = invoiceDocument.data;
  if ((sourceId && String(sourceId) !== String(invoice.sourceId))
    || (sourceType && String(sourceType) !== String(invoice.sourceType))) {
    throw Object.assign(new Error("La factura no corresponde a la venta indicada."), { code: "arca-document-source-mismatch", status: 409 });
  }
  if (!saleDocument) {
    const invoiceSourceId = String(invoice.sourceId || "").trim();
    if (invoiceSourceId) saleDocument = await getDocument(`sales/${invoiceSourceId}`, { env });
  }

  return {
    invoiceId: resolvedInvoiceId,
    invoice,
    sale: saleDocument?.data || null,
  };
}

function compactMetadata(invoiceId, invoice, env) {
  const authorization = invoice.authorization || {};
  const verification = invoice.verification || {};
  const readiness = inspectInvoicePdfReadiness(env);
  return {
    id: invoiceId,
    status: invoice.status || "pending",
    fiscalEnvironment: invoice.fiscalEnvironment || "homologation",
    sourceType: invoice.sourceType || null,
    sourceId: invoice.sourceId || null,
    saleCode: invoice.saleSnapshot?.saleCode || null,
    total: Number(invoice.authorization?.fiscal?.total ?? invoice.saleSnapshot?.total ?? 0),
    authorization: {
      voucherClass: authorization.voucherClass || null,
      pointOfSale: Number(authorization.pointOfSale || 0) || null,
      voucherType: Number(authorization.voucherType || 0) || null,
      voucherNumber: Number(authorization.voucherNumber || 0) || null,
      cae: authorization.cae ? String(authorization.cae) : null,
      caeExpiration: authorization.caeExpiration ? String(authorization.caeExpiration) : null,
      authorizedAt: authorization.authorizedAt || null,
    },
    verification: {
      matched: verification.checkedAt ? verification.matched === true : null,
      checkedAt: verification.checkedAt || null,
    },
    receiver: invoice.receiverSnapshot || null,
    email: invoiceEmailConfiguration(env),
    pdf: {
      ready: readiness.ready
        && invoice.status === "authorized"
        && verification.matched === true,
      issuerDataReady: readiness.ready,
      missingIssuerFields: readiness.missing,
    },
  };
}

export default async function handler(request) {
  if (request.method !== "POST") {
    return json({ ok: false, code: "method-not-allowed" }, 405);
  }

  try {
    const session = await requireFirebaseActiveProfile(request);
    const body = await request.json().catch(() => ({}));
    const mode = String(body.mode || "metadata").trim().toLowerCase();
    if (!["metadata", "pdf", "email", "email-connection"].includes(mode)) {
      return json({ ok: false, code: "invalid-mode", message: "Modo de comprobante inválido." }, 400);
    }

    if (mode === "email-connection") {
      if (!isAdmin(session)) return json({ ok: false, code: "permission-denied", message: "Sólo administración puede verificar la conexión de correo." }, 403);
      return json({ ok: true, email: await verifyInvoiceEmailConnection() });
    }

    const resolved = await resolveInvoice({
      invoiceId: body.invoiceId,
      sourceType: body.sourceType,
      sourceId: body.sourceId,
      env: process.env,
    });

    if (!canReadInvoice({ session, sale: resolved.sale, invoice: resolved.invoice })) {
      return json({
        ok: false,
        code: "permission-denied",
        message: "No tenés permiso para consultar este comprobante.",
      }, 403);
    }

    await syncInvoiceToSale({
      invoiceId: resolved.invoiceId,
      env: process.env,
    });

    const refreshed = await adminGetDocument(`invoices/${resolved.invoiceId}`, { env: process.env });
    const invoice = refreshed?.data || resolved.invoice;

    if (mode === "metadata") {
      return json({
        ok: true,
        invoice: compactMetadata(resolved.invoiceId, invoice, process.env),
      });
    }

    const { pdf, filename } = buildInvoicePdf({
      invoice,
      env: process.env,
    });
    if (mode === "email") {
      const delivery = await sendInvoiceEmail({
        invoiceId: resolved.invoiceId, invoice, pdf, filename,
        to: body.to, requestId: body.requestId, uid: session.uid, env: process.env,
      });
      return json({ ok: true, delivery });
    }
    const disposition = String(body.disposition || "inline").toLowerCase() === "attachment"
      ? "attachment"
      : "inline";

    return new Response(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return json({ ok: false, ...safeError(error) }, Number(error?.status || 0) || 500);
  }
}
