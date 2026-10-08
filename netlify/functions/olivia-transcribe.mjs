import { createOliviaStore } from "./_lib/olivia/store.mjs";
import { createOliviaEngine } from "./_lib/olivia/engine.mjs";
import { transcribeAudio } from "./_lib/olivia/voice.mjs";
import { oliviaSession, json, errorResponse } from "./_lib/olivia/http.mjs";
export default async function handler(request) {
  if (request.method !== "POST")
    return json(
      { code: "method-not-allowed", message: "Método no permitido." },
      405,
    );
  if (Number(request.headers.get("content-length") || 0) > 4.1 * 1024 * 1024)
    return json(
      { code: "audio-too-large", message: "El audio supera 4 MB." },
      413,
    );
  try {
    const session = await oliviaSession(request),
      store = createOliviaStore(),
      engine = createOliviaEngine({ store });
    let form;
    try {
      form = await request.formData();
    } catch {
      return json(
        {
          code: "invalid-audio",
          message: "La grabación no tiene un formato válido.",
        },
        400,
      );
    }
    return json(await transcribeAudio({ session, form, store, engine }));
  } catch (error) {
    console.error("olivia.transcription_failed", {
      code: error.code || "transcription-error",
    });
    return errorResponse(error);
  }
}
