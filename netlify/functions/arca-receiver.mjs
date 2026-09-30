import { requireFirebaseActiveProfile } from "./_lib/firebaseAuth.mjs";
import { resolveFiscalReceiver } from "./_lib/arca/fiscalReceiverResolver.mjs";
import { getTaxpayer } from "./_lib/arca/registry.mjs";
import { toPublicArcaError } from "./_lib/arca/publicError.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  },
});

export default async function handler(request) {
  if (request.method !== "POST") {
    return json({ ok: false, code: "method-not-allowed", message: "Método no permitido." }, 405);
  }
  try {
    await requireFirebaseActiveProfile(request);
    const body = await request.json().catch(() => ({}));
    const resolution = await resolveFiscalReceiver({
      mode: body?.mode,
      cuit: body?.cuit,
      saleTotal: body?.saleTotal,
      concept: body?.concept ?? 1,
      env: process.env,
      lookupTaxpayer: getTaxpayer,
    });
    return json({ ok: true, resolution });
  } catch (error) {
    const safe = toPublicArcaError(error);
    return json({ ok: false, ...safe }, safe.status);
  }
}
