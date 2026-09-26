import { requireFirebaseActiveProfile } from "./_lib/firebaseAuth.mjs";
import { persistInvoiceIntent } from "./_lib/arca/invoicePersistence.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  },
});

export default async function handler(request) {
  if (request.method !== "POST") return json({ ok: false, code: "method-not-allowed" }, 405);

  try {
    const session = await requireFirebaseActiveProfile(request);
    const body = await request.json().catch(() => ({}));
    const invoice = await persistInvoiceIntent({
      sourceType: body?.sourceType,
      sourceId: body?.sourceId,
      session,
    });
    return json({ ok: true, invoice });
  } catch (error) {
    return json({
      ok: false,
      code: error?.code || "arca-invoice-persistence-error",
      status: Number(error?.status || 0) || null,
      message: String(error?.message || "No se pudo guardar la solicitud de facturación.").slice(0, 240),
    }, Number(error?.status || 0) || 500);
  }
}
