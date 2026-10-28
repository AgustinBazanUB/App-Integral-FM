import { requireFirebaseActiveProfile } from "./_lib/firebaseAuth.mjs";
import { can } from "../../src/gestion/permissions.js";
import { lookupBillingReceiver } from "./_lib/arca/receiverLookup.mjs";
import { safeFiscalError } from "../../src/shared/fiscalRecovery.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

export default async function handler(request) {
  if (request.method !== "POST") return json({ ok: false, code: "method-not-allowed" }, 405);
  try {
    const session = await requireFirebaseActiveProfile(request);
    if (!can(session.profile, "quick-sales", "requestTicket")) {
      return json({ ok: false, code: "permission-denied", message: "No tenés permiso para solicitar facturas." }, 403);
    }
    const body = await request.json().catch(() => ({}));
    return json({ ok: true, ...await lookupBillingReceiver(body.cuit) });
  } catch (error) {
    const messages = {
      "arca-cuit-invalid": "El CUIT del receptor no es válido.",
      "arca-production-taxpayer-lookup-disabled": "La consulta de CUIT en ARCA está deshabilitada. Solicitá a administración que la habilite.",
      "arca-receiver-condition-unresolved": "ARCA no pudo determinar la condición IVA de este CUIT. Revisá su constancia antes de facturar.",
    };
    return json({ ok: false, ...safeFiscalError(error), ...(messages[error.code] ? { message: messages[error.code] } : {}) }, Number(error.status) || (error.code === "arca-cuit-invalid" ? 400 : 500));
  }
}
