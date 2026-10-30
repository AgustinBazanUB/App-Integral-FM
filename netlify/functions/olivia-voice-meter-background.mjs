import { oliviaSession, json, errorResponse } from "./_lib/olivia/http.mjs";

// Legacy dispatch target retained briefly so in-flight deployments fail closed.
export default async function handler(request) {
  if (request.method !== "POST") return json({ code: "method-not-allowed", message: "Método no permitido." }, 405);
  try {
    await oliviaSession(request);
    return json({ code: "voice-mode-retired", message: "La modalidad de voz anterior fue retirada." }, 410);
  } catch (error) {
    return errorResponse(error);
  }
}
