import { requireFirebaseAdmin } from "./_lib/firebaseAuth.mjs";
import { createOliviaStore } from "./_lib/olivia/store.mjs";
import { mergeCatalogProduct } from "./_lib/catalogMerge.mjs";
import { json } from "./_lib/olivia/http.mjs";

export default async function handler(request) {
  if (request.method !== "POST") return json({ message: "Método no permitido." }, 405);
  try {
    if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return json({ message: "Origen de solicitud inválido." }, 403);
    const session = await requireFirebaseAdmin(request);
    const raw = await request.text();
    if (raw.length > 4096) return json({ message: "La solicitud es demasiado grande." }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ message: "La solicitud no es válida." }, 422); }
    const result = await mergeCatalogProduct({ store: createOliviaStore(), uid: session.uid, sourceId: body?.sourceId, targetId: body?.targetId, action: body?.action, expectedFingerprint: body?.expectedFingerprint });
    return json(result);
  } catch (error) {
    return json({ code: error.code || "UNIFICACION-ERROR", message: error.status < 500 ? error.message : "No se pudo completar la unificación. Volvé a revisar el stock antes de intentar otra vez." }, error.status >= 400 && error.status < 600 ? error.status : 500);
  }
}
