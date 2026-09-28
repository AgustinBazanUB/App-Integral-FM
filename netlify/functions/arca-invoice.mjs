import { requireFirebaseActiveProfile } from "./_lib/firebaseAuth.mjs";
import { adminGetDocument } from "./_lib/firestoreAdminRest.mjs";
import {
  canRequestInvoiceForSale,
  ensurePendingInvoice,
} from "./_lib/arca/invoicePersistence.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  },
});

function safeError(error) {
  return {
    code: error?.code || "arca-invoice-error",
    message: String(error?.message || "No se pudo preparar la facturación.").slice(0, 240),
  };
}

export default async function handler(request) {
  if (request.method !== "POST") {
    return json({ ok: false, code: "method-not-allowed" }, 405);
  }

  try {
    const session = await requireFirebaseActiveProfile(request);
    const body = await request.json().catch(() => ({}));
    const sourceType = String(body?.sourceType || "").trim();
    const sourceId = String(body?.sourceId || "").trim();

    if (!sourceType || !sourceId) {
      return json({
        ok: false,
        code: "missing-source",
        message: "Falta identificar la venta a facturar.",
      }, 400);
    }

    const saleDocument = await adminGetDocument(`sales/${sourceId}`, { env: process.env });
    const sale = saleDocument?.data || null;
    if (!sale) {
      return json({ ok: false, code: "arca-sale-not-found", message: "La venta no existe." }, 404);
    }

    if (!canRequestInvoiceForSale({ sourceType, sale, session })) {
      return json({
        ok: false,
        code: "permission-denied",
        message: "No tenés permiso para preparar la factura de esta venta.",
      }, 403);
    }

    const result = await ensurePendingInvoice({
      sourceType,
      sourceId,
      requestedBy: session.uid,
      requestedByName: session.profile?.name || session.email || null,
      env: process.env,
    });

    return json({
      ok: true,
      created: result.created,
      invoice: {
        id: result.invoiceId,
        status: result.invoice?.status || "pending",
        fiscalReadiness: result.invoice?.fiscalReadiness || null,
        sourceType: result.invoice?.sourceType || sourceType,
        sourceId: result.invoice?.sourceId || sourceId,
      },
    });
  } catch (error) {
    const status = Number(error?.status || 0) || 500;
    return json({ ok: false, ...safeError(error) }, status);
  }
}
