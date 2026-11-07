import test from "node:test";
import assert from "node:assert/strict";
import { createOliviaTransport } from "../src/gestion/olivia/client.mjs";
import { defaultOliviaConfiguration, validateConfiguration, costForUsage } from "../src/shared/oliviaContracts.mjs";
import { dualVoiceResponse, spokenFallback } from "../netlify/functions/_lib/olivia/engine.mjs";
import { NaturalVoiceConversation, latencyPercentile } from "../src/gestion/olivia/naturalVoice.mjs";

test("configuration removes selectable legacy voice profiles and fixes GPT Transcribe", () => {
  const legacy = defaultOliviaConfiguration();
  legacy.voiceProtocol = "realtime";
  legacy.naturalVoice.voice = "es-US-Chirp3-HD-Aoede";
  legacy.naturalVoice.speakingRate = 1;
  legacy.naturalVoice.maxMonthlyCharacters = 10000;
  legacy.liveUsdPerMinute = 0.05;
  legacy.profiles.live = { model: "gpt-live-1", voice: "marin" };
  legacy.profiles.realtime = { model: "gpt-realtime-2.1", voice: "marin" };
  legacy.profiles.liveTranscription = { model: "gpt-realtime-whisper" };
  legacy.profiles.transcription.model = "other-model";
  const normalized = validateConfiguration(legacy);
  assert.equal("voiceProtocol" in normalized, false);
  assert.equal("voice" in normalized.naturalVoice, false);
  assert.equal("speakingRate" in normalized.naturalVoice, false);
  assert.equal("maxMonthlyCharacters" in normalized.naturalVoice, false);
  assert.equal(normalized.profiles.transcription.model, "gpt-transcribe");
  assert.equal("live" in normalized.profiles, false);
  assert.equal("realtime" in normalized.profiles, false);
  assert.equal("liveTranscription" in normalized.profiles, false);
  assert.equal("liveUsdPerMinute" in normalized, false);
  assert.equal(costForUsage({ billingUnit: "tts-characters", characters: 1000 }, normalized).actualCostUsd, null);
});

test("spoken answer removes markdown and truncates at a readable boundary", () => {
  assert.equal(spokenFallback("Hola **Ana**. [Abrí ventas](https://example.test/a)"), "Hola Ana. Abrí ventas");
  assert.equal(dualVoiceResponse(JSON.stringify({ complete: "Respuesta completa", spoken: "En pocas palabras." }), 100).spoken, "En pocas palabras.");
  const spoken = spokenFallback("Primera oración. Segunda oración muy extensa que continúa durante bastante tiempo sin terminar antes del límite establecido.", 22);
  assert.equal(spoken, "Primera oración.");
});

test("browser VAD sends a bounded turn with a short in-memory pre-roll and releases the microphone", async () => {
  const frames = [], records = [], states = [], turns = [], speechStarts = [], traces = [];
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
    onTurn: async (blob, metadata) => turns.push({ text: await blob.text(), metadata }), onState: (state) => states.push(state), onSpeechStart: (data) => speechStarts.push(data), onTrace: event => traces.push(event),
  });
  await voice.start();
  assert.ok(traces.some(event => event.stage === 'microphone.request.start'));
  assert.ok(traces.some(event => event.stage === 'microphone.request.end' && event.status === 'ok'));
  assert.ok(traces.some(event => event.stage === 'audio.context.resume.end'));
  assert.ok(traces.some(event => event.stage === 'voice.capture.ready'));
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
  assert.ok(traces.some(event => event.stage === 'voice.turn.end' && Number.isFinite(event.endpointMs) && event.turnId));
  assert.ok(states.includes("recording"));
  voice.close();
  assert.equal(track.stopped, true);
  assert.ok(states.includes("ended"));
  assert.equal(latencyPercentile([40, 10, 30, 20], 0.5), 20);
});

test("Gemini Live streams the microphone once and local VAD only commits the turn", async () => {
  const frames = [], commits = [], states = [];
  let now = 0, amplitude = 0, recorderCount = 0, fallbackTurns = 0;
  class Recorder { static isTypeSupported() { return true; } constructor() { recorderCount++; } }
  const track = { enabled: true, stop() {} };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const context = {
    currentTime: 0, destination: {}, resume: async () => {}, close: async () => {},
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    createAnalyser: () => ({ fftSize: 1024, getFloatTimeDomainData(samples) { samples.fill(amplitude); }, connect() {}, disconnect() {} }),
  };
  const liveSession = {
    handlesTurns: true, ready: true, beginTurn(turnId) { this.turnId = turnId; },
    commit: async metadata => commits.push(metadata), discardTurn() {}, close() {},
  };
  const voice = new NaturalVoiceConversation({
    createTranscriber: async () => liveSession,
    mediaDevices: { getUserMedia: async () => stream },
    Recorder, AudioContext: class { constructor() { return context; } },
    frame: callback => { frames.push(callback); return frames.length; }, cancelFrame() {}, now: () => now,
    onTurn: async () => { fallbackTurns++; }, onState: state => states.push(state),
  });
  await voice.start();
  assert.equal(recorderCount, 0, "Gemini's streamed input must not be duplicated in MediaRecorder");
  now = 100; amplitude = 0.1; frames.shift()();
  assert.equal(voice.recordingTurn, true);
  now = 2100; amplitude = 0; frames.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(commits.length, 1);
  assert.equal(commits[0].turnId, liveSession.turnId);
  assert.equal(fallbackTurns, 0);
  assert.ok(states.includes("processing"));
  voice.close();
});

test("natural voice job polling keeps the saved spoken text and exposes no independent speech service", async () => {
  const sent = [], events = []; let polls = 0;
  const fetchImpl = async (url, options) => {
    sent.push({ url, options });
    const body = JSON.parse(options.body);
    if (body.operation === "startChat") return Response.json({ jobId: "job_1" });
    polls++;
    return Response.json(polls === 1
      ? { status: "running", phase: "Guardando…", text: "" }
      : { status: "completed", phase: "Completado", text: "respuesta escrita", result: { state: "INFORMACION", spokenText: "respuesta hablada" } });
  };
  const client = createOliviaTransport({ getToken: async () => "firebase-token", fetchImpl, pollIntervalMs: 1 });
  const result = await client.request({ operation: "chat", background: true, inputMode: "natural-voice" }, { pollIntervalMs: 1, onEvent: (event) => events.push(event) });
  assert.equal(result.state, "INFORMACION");
  assert.equal(result.spokenText, "respuesta hablada");
  assert.equal(events.some((event) => event.type === "voice.ready"), false);
  assert.equal(typeof client.synthesize, "undefined");
  assert.equal(typeof client.fastSpeech, "undefined");
  assert.equal(typeof client.speechAudio, "undefined");
  assert.equal(sent.some(({ url }) => url.includes("synthesize") || url.includes("speech-audio") || url.includes("fast-speech")), false);
});
