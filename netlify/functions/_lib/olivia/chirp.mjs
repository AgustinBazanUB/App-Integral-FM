import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import { quotaPeriod, safeId, oliviaError, costForUsage, retentionDate } from "../../../../src/shared/oliviaContracts.mjs";
import { canUseOliviaVoice, hasGoogleCloudTtsCredentials } from "../../../../src/shared/oliviaVoiceAvailability.mjs";
import { assertConversationOwner } from "./engine.mjs";

const RATE_USD_PER_MILLION_CHARS = 30;
let cachedClient = null;

export function chirpClient(env = process.env, Client = TextToSpeechClient) {
  if (cachedClient) return cachedClient;
  const options = {};
  if (env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    let account;
    try { account = JSON.parse(env.GOOGLE_APPLICATION_CREDENTIALS_JSON); }
    catch { throw oliviaError("tts-not-configured", "La síntesis de voz no está configurada.", 503); }
    if (!account.client_email || !account.private_key || !account.project_id)
      throw oliviaError("tts-not-configured", "La síntesis de voz no está configurada.", 503);
    options.projectId = env.GOOGLE_CLOUD_PROJECT || account.project_id;
    options.credentials = { client_email: account.client_email, private_key: account.private_key.replace(/\\n/g, "\n") };
  } else if (env.GOOGLE_CLOUD_PROJECT) options.projectId = env.GOOGLE_CLOUD_PROJECT;
  cachedClient = new Client(options);
  return cachedClient;
}

async function reserveCharacters({ store, session, config, requestId, characters, now }) {
  const period = quotaPeriod("monthly", now),
    usagePath = `oliviaVoiceBudgets/${session.uid}_${period.key}`,
    requestPath = `oliviaVoiceRequests/${session.uid}_${requestId}`;
  await store.transaction(async (tx) => {
    const [prior, current] = await Promise.all([tx.getDocument(requestPath), tx.getDocument(usagePath)]);
    if (prior) throw oliviaError("request-already-used", "Este audio ya fue procesado.", 409);
    const used = Number(current?.data?.characters || 0);
    if (used + characters > config.naturalVoice.maxMonthlyCharacters)
      throw oliviaError("voice-quota-exhausted", "Se alcanzó el cupo mensual de voz. Podés continuar escribiendo o dictando.", 429);
    const expiresAt = retentionDate(config.retentionMonths, now);
    const next = { userId: session.uid, period: period.key, characters: used + characters, updatedAt: now, renewsAt: period.renewsAt, retentionExpiresAt: expiresAt };
    await tx.commitDocuments([
      { type: current ? "update" : "create", path: usagePath, data: next },
      { type: "create", path: requestPath, data: { userId: session.uid, operation: "chirp-synthesis", model: "Google Chirp 3 HD", characters, estimatedCostUsd: characters * RATE_USD_PER_MILLION_CHARS / 1_000_000, status: "streaming", createdAt: now, period: period.key, retentionExpiresAt: expiresAt } },
      { type: "create", path: `oliviaUsage/${session.uid}_${requestId}`, data: { userId: session.uid, role: session.profile.role, origin: "Olivia · voz natural", operation: "chirp-synthesis", requestId, model: "Google Chirp 3 HD", billingUnit: "tts-characters", characters, measurement: "provider-request", success: true, createdAt: now, retentionExpiresAt: expiresAt, ...costForUsage({ billingUnit: "tts-characters", characters }, config) } },
    ]);
  });
  return { requestPath, period };
}

export async function synthesizeChirp({ request, session, store, engine, env = process.env, createClient = () => chirpClient(env), now = new Date(), onTiming = metric => console.info('olivia.tts_timing',metric) }) {
  const startedAt=Date.now();let firstPacketMs=null;
  if (request.method !== "POST") throw oliviaError("method-not-allowed", "Método no permitido.", 405);
  if (!canUseOliviaVoice(session)) throw oliviaError("voice-not-enabled", "La conversación por voz sigue limitada a la prueba administrativa.", 403);
  const config = await engine.configuration();
  if (!config.enabled || !config.naturalVoice.enabled || !env.OPENAI_API_KEY || !hasGoogleCloudTtsCredentials(env))
    throw oliviaError("voice-not-enabled", "La conversación natural por voz no está disponible.", 503);
  let body;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 16000) throw oliviaError("request-too-large", "La solicitud supera el límite.", 413);
    body = JSON.parse(raw);
  } catch (error) { if (error.code) throw error; throw oliviaError("invalid-input", "Solicitud de síntesis inválida."); }
  const conversationId = safeId(body.conversationId, "conversación"), requestId = safeId(body.requestId, "intento");
  assertConversationOwner(session, await store.get(`oliviaConversations/${conversationId}`), now);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text || text.length > config.naturalVoice.maxCharactersPerTurn || text.length > 3000)
    throw oliviaError("invalid-input", "El texto de voz está vacío o supera el límite.", 400);
  const client = createClient();
  const reservation = await reserveCharacters({ store, session, config, requestId, characters: text.length, now });
  let upstream;
  try { upstream = client.streamingSynthesize(); }
  catch {
    await store.commit([{ type: "update", path: reservation.requestPath, data: { status: "provider-error", completedAt: new Date() } }]).catch(() => {});
    await store.commit([{ type: "update", path: `oliviaUsage/${session.uid}_${requestId}`, data: { success: false, errorCode: "chirp-provider-error" } }]).catch(() => {});
    throw oliviaError("chirp-provider-error", "La voz no pudo sintetizarse.", 502);
  }
  let ended = false;
  const finalize = async (status) => {
    if (ended) return;
    ended = true;
    onTiming({requestId,firstPacketMs,totalMs:Date.now()-startedAt,characters:text.length,status,sampleRate:24000});
    try { await store.commit([
      { type: "update", path: reservation.requestPath, data: { status, completedAt: new Date() } },
      { type: "update", path: `oliviaUsage/${session.uid}_${requestId}`, data: { success: status === "completed", ...(status === "completed" ? {} : { errorCode: `chirp-${status}` }) } },
    ]); } catch { /* Usage was reserved before provider dispatch. */ }
  };
  const bodyStream = new ReadableStream({
    start(controller) {
      upstream.on("data", (frame) => {
        if (frame.audioContent?.length) {firstPacketMs??=Date.now()-startedAt;controller.enqueue(new Uint8Array(frame.audioContent));}
      });
      upstream.on("end", () => { finalize("completed"); try { controller.close(); } catch {} });
      upstream.on("error", () => { finalize("provider-error"); try { controller.error(new Error("La voz no pudo sintetizarse.")); } catch {} });
      try {
        upstream.write({ streamingConfig: { voice: { languageCode: "es-US", name: config.naturalVoice.voice }, streamingAudioConfig: { audioEncoding: "PCM", sampleRateHertz: 24000, speakingRate: config.naturalVoice.speakingRate } } });
        upstream.write({ input: { text } });
        upstream.end();
      } catch {
        finalize("provider-error");
        try { controller.error(new Error("La voz no pudo sintetizarse.")); } catch {}
      }
    },
    cancel() { upstream.cancel?.(); finalize("cancelled"); },
  });
  request.signal?.addEventListener("abort", () => { upstream.cancel?.(); finalize("cancelled"); }, { once: true });
  return new Response(bodyStream, { status: 200, headers: { "Content-Type": "audio/pcm;rate=24000;channels=1", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Olivia-Audio-Encoding": "pcm_s16le", "X-Olivia-Sample-Rate": "24000", "X-Olivia-Character-Count": String(text.length), "X-Olivia-Estimated-Cost-USD": String(text.length * RATE_USD_PER_MILLION_CHARS / 1_000_000) } });
}

export const chirpPricing = Object.freeze({ usdPerMillionCharacters: RATE_USD_PER_MILLION_CHARS });
