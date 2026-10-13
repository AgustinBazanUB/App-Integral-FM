import { requireFirebaseActiveProfile } from "./_lib/firebaseAuth.mjs";
import { safeFiscalError } from "../../src/shared/fiscalRecovery.mjs";
import { cancelSaleAndInvoice } from "./_lib/arca/saleCancellation.mjs";
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
export default async function handler(request) {
  if (request.method !== "POST")
    return json({ ok: false, code: "method-not-allowed" }, 405);
  try {
    const session = await requireFirebaseActiveProfile(request);
    const body = await request.json().catch(() => ({}));
    return json({
      ok: true,
      result: await cancelSaleAndInvoice({
        saleId: body.saleId,
        reason: body.reason,
        session,
      }),
    });
  } catch (error) {
    return json(
      {
        ok: false,
        ...safeFiscalError(error),
        ...(error.publicMessage ? { message: error.message } : {}),
      },
      Number(error.status) || 500,
    );
  }
}
