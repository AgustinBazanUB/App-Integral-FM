import { assertOliviaAccess } from "./guards.mjs";
import { safeId, oliviaError } from "../../../../src/shared/oliviaContracts.mjs";
import { reserveUsage, settleUsage, publicUsage } from "./usage.mjs";
import { openaiRequest, providerUsage } from "./provider.mjs";
import { assertConversationOwner } from "./engine.mjs";

export async function transcribeAudio({ session, form, store, engine, env = process.env, provider = openaiRequest, now = new Date() }) {
  assertOliviaAccess(session);
  const configuration = await engine.configuration();
  if (!configuration.enabled) throw oliviaError("assistant-disabled", "Olivia está deshabilitada.", 503);
  const conversationId = safeId(String(form.get("conversationId") || ""));
  assertConversationOwner(session, await store.get(`oliviaConversations/${conversationId}`), now);
  const file = form.get("file") || form.get("audio"), requestId = safeId(String(form.get("requestId") || ""));
  if (!file || typeof file.arrayBuffer !== "function" || file.size < 128 || file.size > configuration.audioLimits.maxBytes || !/^audio\/(webm|mp4|mpeg|wav|x-wav|ogg)(;.*)?$/.test(file.type))
    throw oliviaError("invalid-audio", "Grabá un audio legible de hasta 4 MB.");
  const reservation = await reserveUsage({ store, session, configuration, requestId, operation: "transcription", reservedTokens: 6000, now });
  let event = { model: configuration.profiles.transcription.model, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  try {
    const upload = new FormData();
    upload.append("file", file, file.name || "audio.webm");
    upload.append("model", event.model);
    upload.append("response_format", "json");
    upload.append("languages[]", "es");
    for (const keyword of ["Flor Mía", "Olivia", "Arbequina", "Arbosana", "Coratina", "Picual", "Arauco", "depósito", "ubicación", "transferencia de stock", "mercadería", "promoción", "factura"])
      upload.append("keywords[]", keyword);
    upload.append("prompt", "Transcribí en español rioplatense conservando nombres propios, números, variedades de aceituna y términos comerciales. El contexto es Flor Mía: Olivia, Arbequina, Arbosana, Coratina, Picual, Arauco, locales, depósitos, stock, transferencias, clientes, ventas, promociones y facturas. No agregues palabras que no se escuchan.");
    event = { ...event, totalTokens: 6000, measurement: "reserved-estimate" };
    const payload = await provider("audio/transcriptions", upload, { env, multipart: true });
    const text = String(payload.text || "").trim();
    const measured = providerUsage(payload, event.model), suppliedDuration = form.get("durationSeconds"), clientDuration = suppliedDuration == null || suppliedDuration === "" ? NaN : Number(suppliedDuration), providerDuration = payload.usage?.type === "duration" && Number.isFinite(payload.usage?.seconds) && payload.usage.seconds >= 0;
    const durationSeconds = providerDuration ? payload.usage.seconds : Number.isFinite(clientDuration) && clientDuration >= 0 && clientDuration <= configuration.audioLimits.maxSeconds ? clientDuration : NaN;
    event = { ...measured, billingUnit: "audio-seconds", measurement: "reserved-estimate", totalTokens: measured.measurement === "provider" ? measured.totalTokens : 6000 };
    if (Number.isFinite(durationSeconds) && durationSeconds >= 0) event.durationSeconds = durationSeconds;
    if (providerDuration) event.measurement = "provider";
    if (!text || text.length > 4000) throw oliviaError("audio-unintelligible", "No se pudo transcribir con claridad. Probá otra grabación o escribí el mensaje.", 422);
    const budget = await settleUsage({ store, session, reservation, event, configuration, result: { conversationId }, now: new Date() });
    return { conversationId, text, usage: publicUsage(session, budget, reservation.quota, event, configuration) };
  } catch (error) {
    await settleUsage({ store, session, reservation, event, configuration, errorCode: error.code || "transcription-error", now: new Date() });
    throw error;
  }
}

// Kept only for the scheduled cleanup of sessions created before GPT-Live retirement.
export async function hangupCall(callId, { env = process.env, fetchImpl = fetch } = {}) {
  if (!/^(rtc|live)_[A-Za-z0-9_-]+$/.test(callId)) throw oliviaError("legacy-voice-invalid", "La sesión heredada no es válida.");
  const endpoint = callId.startsWith("live_") ? "live/sessions" : "realtime/calls";
  const response = await fetchImpl(`https://api.openai.com/v1/${endpoint}/${encodeURIComponent(callId)}/hangup`, {
    method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok && response.status !== 404) throw oliviaError("legacy-voice-close-error", "No se pudo confirmar el cierre remoto de la sesión heredada.", 502);
}
