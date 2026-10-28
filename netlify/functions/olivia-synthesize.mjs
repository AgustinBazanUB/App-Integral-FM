import { createOliviaStore } from "./_lib/olivia/store.mjs";
import { createOliviaEngine } from "./_lib/olivia/engine.mjs";
import { synthesizeChirp } from "./_lib/olivia/chirp.mjs";
import { oliviaSession, json, errorResponse } from "./_lib/olivia/http.mjs";

export default async function handler(request) {
  if (request.method !== "POST") return json({ code: "method-not-allowed", message: "Método no permitido." }, 405);
  if (Number(request.headers.get("content-length") || 0) > 16000) return json({ code: "request-too-large", message: "La solicitud supera el límite." }, 413);
  try {
    const session = await oliviaSession(request), store = createOliviaStore(), engine = createOliviaEngine({ store });
    return await synthesizeChirp({ request, session, store, engine });
  } catch (error) {
    console.error("olivia.chirp_failed", { code: error.code || "chirp-error", userId: null });
    return errorResponse(error);
  }
}
