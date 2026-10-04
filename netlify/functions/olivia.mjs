import { createOliviaStore } from "./_lib/olivia/store.mjs";
import { resolveOliviaPricing } from "./_lib/olivia/pricing.mjs";
import { createOliviaEngine } from "./_lib/olivia/engine.mjs";
import { createRealtime, stopRealtime } from "./_lib/olivia/voice.mjs";
import { oliviaSession, json, errorResponse } from "./_lib/olivia/http.mjs";
import { oliviaError } from "../../src/shared/oliviaContracts.mjs";
export default async function handler(request) {
  if (request.method !== "POST")
    return json(
      { code: "method-not-allowed", message: "Método no permitido." },
      405,
    );
  let session;
  try {
    session = await oliviaSession(request);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 65000)
      throw oliviaError(
        "request-too-large",
        "La solicitud supera el límite.",
        413,
      );
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw oliviaError("invalid-json", "Solicitud inválida.");
    }
    const store = createOliviaStore(),
      engine = createOliviaEngine({ store, pricingResolver: resolveOliviaPricing });
    let result;
    if (body.operation === "state")
      result = await engine.state(
        session,
        body.conversationId,
        body.screenContext,
      );
    else if (body.operation === "chat" || body.operation === "tool")
      result = await engine.chat(session, body);
    else if (body.operation === "confirm")
      result = await engine.confirm(session, body);
    else if (body.operation === "cancel")
      result = await engine.cancel(session, body);
    else if (body.operation === "estimate")
      result = await engine.estimate(session, body);
    else if (body.operation === "resume")
      result = await engine.resumeConversation(session, body);
    else if (body.operation === "history")
      result = await engine.history(session, body);
    else if (body.operation === "requestQuotaExtension")
      result = await engine.requestQuotaExtension(session, body);
    else if (body.operation === "configuration")
      result = await engine.getConfiguration(session);
    else if (body.operation === "saveConfiguration")
      result = await engine.saveConfiguration(session, body);
    else if (body.operation === "realtime")
      result = await createRealtime({
        session,
        body,
        store,
        engine,
        applicationOrigin: new URL(request.url).origin,
      });
    else if (body.operation === "stopRealtime")
      result = await stopRealtime({ session, body, store });
    else throw oliviaError("invalid-operation", "Operación no disponible.");
    return json(result);
  } catch (error) {
    console.error("olivia.request_failed", {
      code: error.code || "assistant-error",
      status: error.status || 500,
      userId: session?.uid || null,
    });
    return errorResponse(error);
  }
}
