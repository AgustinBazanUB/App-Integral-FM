import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createOliviaTransport } from "../src/gestion/olivia/client.mjs";
import { defaultOliviaConfiguration, validateConfiguration, costForUsage } from "../src/shared/oliviaContracts.mjs";
import { dualVoiceResponse, spokenFallback } from "../netlify/functions/_lib/olivia/engine.mjs";
import { synthesizeChirp } from "../netlify/functions/_lib/olivia/chirp.mjs";
import { NaturalVoiceConversation, latencyPercentile } from "../src/gestion/olivia/naturalVoice.mjs";

test("configuration removes selectable legacy voice profiles and fixes GPT Transcribe", () => {
  const legacy = defaultOliviaConfiguration();
  legacy.voiceProtocol = "realtime";
  legacy.liveUsdPerMinute = 0.05;
  legacy.profiles.live = { model: "gpt-live-1", voice: "marin" };
  legacy.profiles.realtime = { model: "gpt-realtime-2.1", voice: "marin" };
  legacy.profiles.liveTranscription = { model: "gpt-realtime-whisper" };
  legacy.profiles.transcription.model = "other-model";
  const normalized = validateConfiguration(legacy);
  assert.equal(normalized.voiceProtocol, "chirp");
  assert.equal(normalized.profiles.transcription.model, "gpt-transcribe");
  assert.equal("live" in normalized.profiles, false);
  assert.equal("realtime" in normalized.profiles, false);
  assert.equal("liveTranscription" in normalized.profiles, false);
  assert.equal("liveUsdPerMinute" in normalized, false);
  assert.equal(costForUsage({ billingUnit: "tts-characters", characters: 1000 }, normalized).actualCostUsd, 0.03);
});

test("spoken answer removes markdown and truncates at a readable boundary", () => {
  assert.equal(spokenFallback("Hola **Ana**. [Abrí ventas](https://example.test/a)"), "Hola Ana. Abrí ventas");
  assert.equal(dualVoiceResponse(JSON.stringify({ complete: "Respuesta completa", spoken: "En pocas palabras." }), 100).spoken, "En pocas palabras.");
  const spoken = spokenFallback("Primera oración. Segunda oración muy extensa que continúa durante bastante tiempo sin terminar antes del límite establecido.", 22);
  assert.equal(spoken, "Primera oración.");
});

test("browser VAD sends a bounded turn with a short in-memory pre-roll and releases the microphone", async () => {
  const frames = [], records = [], states = [], turns = [], speechStarts = [];
  let now = 0, amplitude = 0;
  class Recorder {
    static isTypeSupported() { return true; }
    constructor(_stream, options) { this.mimeType = options?.mimeType; this.state = "inactive"; records.push(this); }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["tail"]) }); this.onstop?.(); }
  }
  const track = { enabled: true, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const context = {
    currentTime: 0, destination: {}, resume: async () => {}, close: async () => {},
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    createAnalyser: () => ({ fftSize: 1024, getFloatTimeDomainData(samples) { samples.fill(amplitude); }, connect() {}, disconnect() {} }),
  };
  const voice = new NaturalVoiceConversation({
    mediaDevices: { getUserMedia: async (constraints) => { assert.equal(constraints.audio.echoCancellation, true); assert.equal(constraints.audio.noiseSuppression, true); return stream; } },
    Recorder, AudioContext: class { constructor() { return context; } }, frame: (callback) => { frames.push(callback); return frames.length; }, cancelFrame() {}, now: () => now,
    onTurn: async (blob, metadata) => turns.push({ text: await blob.text(), metadata }), onState: (state) => states.push(state), onSpeechStart: (data) => speechStarts.push(data),
  });
  await voice.start();
  const recorder = records[0];
  for (const chunk of ["header", "old-1", "old-2"]) recorder.ondataavailable({ data: new Blob([chunk]) });
  now = 100; amplitude = 0.1; frames.shift()();
  assert.equal(voice.recordingTurn, true);
  assert.deepEqual(speechStarts.map(({ bargeIn }) => bargeIn), [false]);
  recorder.ondataavailable({ data: new Blob(["speech"]) });
  now = 2100; amplitude = 0; frames.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(turns.length, 1);
  assert.equal(turns[0].text, "headerold-1old-2speechtail");
  assert.equal(turns[0].metadata.durationSeconds, 2);
  assert.ok(states.includes("recording"));
  voice.close();
  assert.equal(track.stopped, true);
  assert.ok(states.includes("ended"));
  assert.equal(latencyPercentile([40, 10, 30, 20], 0.5), 20);
});

test("Chirp synthesis authorizes owner, enforces monthly character quota and streams PCM without persisting text", async () => {
  const config = defaultOliviaConfiguration(); config.naturalVoice.maxMonthlyCharacters = 10;
  const now = new Date("2026-10-28T15:00:00Z"), uid = "admin_user", requestId = "voice_request_1";
  const docs = new Map([["oliviaConversations/conversation_1", { userId: uid, sessionBinding: "123", expiresAt: new Date(now.getTime() + 60000) }]]);
  const apply = (writes) => writes.forEach((write) => {
    if (write.type === "create" && docs.has(write.path)) throw new Error("duplicate create");
    docs.set(write.path, write.type === "update" ? { ...docs.get(write.path), ...structuredClone(write.data) } : structuredClone(write.data));
  });
  const store = {
    get: async (path) => docs.has(path) ? { ...docs.get(path), id: path.split("/").at(-1) } : null,
    commit: async (writes) => apply(writes),
    transaction: async (work) => work({ getDocument: async (path) => docs.has(path) ? { data: docs.get(path) } : null, commitDocuments: async (writes) => apply(writes) }),
  };
  const session = { uid, email: "AGSRESERVA@gmail.com", authTime: 123, profile: { role: "admin", active: true } };
  const env = { OPENAI_API_KEY: "backend-secret", GOOGLE_APPLICATION_CREDENTIALS_JSON: JSON.stringify({ project_id: "fm-project", client_email: "tts@example.test", private_key: "private" }) };
  const engine = { configuration: async () => config };
  const writes = [], stream = new EventEmitter();
  stream.write = (frame) => writes.push(frame);
  stream.end = () => setImmediate(() => { stream.emit("data", { audioContent: Buffer.from([1, 0, 2, 0]) }); stream.emit("end"); });
  stream.cancel = () => { stream.cancelled = true; };
  const client = { streamingSynthesize: () => stream };
  const call = (rid, text = "Hola") => synthesizeChirp({ request: new Request("https://preview.test/.netlify/functions/olivia-synthesize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: "conversation_1", requestId: rid, text }) }), session, store, engine, env, createClient: () => client, now });
  const response = await call(requestId);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Olivia-Sample-Rate"), "24000");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 0, 2, 0]);
  assert.equal(writes[0].streamingConfig.voice.name, "es-US-Chirp3-HD-Aoede");
  assert.equal(writes[0].streamingConfig.streamingAudioConfig.audioEncoding, "PCM");
  assert.equal(writes[1].input.text, "Hola");
  const usage = docs.get(`oliviaUsage/${uid}_${requestId}`);
  assert.equal(usage.characters, 4);
  assert.equal(usage.actualCostUsd, 4 * 30 / 1_000_000);
  assert.ok(usage.retentionExpiresAt instanceof Date);
  assert.ok(docs.get(`oliviaVoiceRequests/${uid}_${requestId}`).retentionExpiresAt instanceof Date);
  assert.ok([...docs].find(([path]) => path.startsWith(`oliviaVoiceBudgets/${uid}_`))[1].retentionExpiresAt instanceof Date);
  assert.equal(JSON.stringify([...docs.values()]).includes("Hola"), false);
  await assert.rejects(call("voice_request_2", "1234567"), { code: "voice-quota-exhausted" });
  await assert.rejects(synthesizeChirp({ request: new Request("https://preview.test", { method: "POST", body: JSON.stringify({ conversationId: "conversation_1", requestId: "foreign", text: "Hola" }) }), session: { ...session, uid: "other" }, store, engine, env, createClient: () => client, now }), { code: "conversation-not-found" });
});

test("natural voice job polling emits the saved spoken response and synthesize keeps binary response", async () => {
  const sent = [], events = []; let polls = 0;
  const fetchImpl = async (url, options) => {
    sent.push({ url, options });
    if (url.endsWith("olivia-synthesize")) return new Response(new Uint8Array([1, 2]), { headers: { "Content-Type": "audio/pcm" } });
    const body = JSON.parse(options.body);
    if (body.operation === "startChat") return Response.json({ jobId: "job_1" });
    polls++;
    return Response.json(polls === 1
      ? { status: "running", phase: "Guardando…", text: "", voiceText: "" }
      : { status: "completed", phase: "Completado", text: "respuesta escrita", voiceText: "respuesta hablada", result: { state: "INFORMACION" } });
  };
  const client = createOliviaTransport({ getToken: async () => "firebase-token", fetchImpl, pollIntervalMs: 1 });
  const result = await client.request({ operation: "chat", background: true, inputMode: "natural-voice" }, { pollIntervalMs: 1, onEvent: (event) => events.push(event) });
  assert.equal(result.state, "INFORMACION");
  assert.equal(events.filter((event) => event.type === "voice.ready").length, 1);
  assert.equal(events.find((event) => event.type === "voice.ready").text, "respuesta hablada");
  const audio = await client.synthesize("texto", { conversationId: "c1", requestId: "r1" });
  assert.equal(audio.headers.get("content-type"), "audio/pcm");
  assert.deepEqual([...new Uint8Array(await audio.arrayBuffer())], [1, 2]);
  assert.equal(sent.at(-1).options.headers.Authorization, "Bearer firebase-token");
});
