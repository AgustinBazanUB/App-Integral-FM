import test from 'node:test';
import assert from 'node:assert/strict';
import { NaturalVoiceConversation } from '../src/gestion/olivia/naturalVoice.mjs';
import { interactionState, appendDictation, requestFailure } from '../src/gestion/olivia/interactionState.mjs';
import { createOliviaTransport } from '../src/gestion/olivia/client.mjs';
import { defaultOliviaConfiguration, validateConfiguration } from '../src/shared/oliviaContracts.mjs';

test('one orb lifecycle prioritizes real recording/playback over work and does not treat rejection as failure', () => {
  assert.equal(interactionState({ activeJob: { jobId: 'job' } }).state, 'thinking');
  assert.equal(interactionState({ busy: true, speaking: true }).state, 'speaking');
  assert.equal(interactionState({ busy: true, recording: true }).state, 'listening');
  assert.equal(interactionState({ permissionDenied: true, error: 'permission' }).state, 'disabled');
  assert.equal(interactionState({ error: 'confirmed failure' }).state, 'error');
  assert.equal(interactionState({ muted: true }).state, 'idle');
  assert.equal(interactionState({ pending: {} }).state, 'idle');
  assert.equal(requestFailure({ name: 'AbortError' }, { reason: 'user-stop' }).kind, 'neutral');
  assert.equal(requestFailure({ name: 'AbortError' }, { reason: 'voice-ended' }).kind, 'neutral');
  assert.equal(requestFailure({ name: 'AbortError' }, { jobId: 'same-job' }).kind, 'recover');
  assert.equal(requestFailure({ code: 'olivia-network-error' }, { jobId: 'same-job' }).kind, 'recover');
  assert.equal(requestFailure({ message: 'Invalid request' }).kind, 'error');
});

test('dictation appends to a written draft and legacy short silence migrates without mutating the saved config', () => {
  assert.equal(appendDictation('Texto escrito. ', ' Texto dictado.'), 'Texto escrito. Texto dictado.');
  assert.equal(appendDictation('', ' Hola '), 'Hola');
  const legacy = defaultOliviaConfiguration(); legacy.naturalVoice.turnEndSilenceMs = 350;
  assert.equal(validateConfiguration(legacy).naturalVoice.turnEndSilenceMs, 1900);
  assert.equal(legacy.naturalVoice.turnEndSilenceMs, 350);
});

function voiceFixture({ denied = false } = {}) {
  let now = 0, amplitude = 0, requested = 0;
  const frames = [], turns = [], levels = [], tracks = [{ enabled: true, stop() { this.stopped = true; } }];
  class Recorder {
    static isTypeSupported(type) { return type === 'audio/mp4'; }
    constructor(_, options) { this.mimeType = options.mimeType; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['recorded']) }); this.onstop(); }
  }
  const context = { currentTime: 0, destination: {}, resume: async () => {}, close: async () => {},
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    createAnalyser: () => ({ fftSize: 1024, connect() {}, disconnect() {}, getFloatTimeDomainData(samples) { samples.fill(amplitude); } }) };
  const errors = [];
  const voice = new NaturalVoiceConversation({ Recorder, AudioContext: class { constructor() { return context; } },
    mediaDevices: { getUserMedia: async () => { requested++; if (denied) throw new DOMException('Denied', 'NotAllowedError'); return { getAudioTracks: () => tracks, getTracks: () => tracks }; } },
    frame: fn => { frames.push(fn); return frames.length; }, cancelFrame() {}, now: () => now,
    onTurn: (blob, metadata) => turns.push({ blob, metadata }), onFrame: frame => levels.push(frame), onError: error => errors.push(error) });
  return { voice, turns, levels, errors, tracks, requested: () => requested, tick(t, a) { now = t; amplitude = a; frames.shift()?.(); } };
}

test('natural pauses stay in one turn, acoustic continuations extend to 3–4s, manual send is immediate', async () => {
  const f = voiceFixture(); await f.voice.start();
  f.tick(100, .1); f.tick(900, 0); f.tick(1500, .1); // resumed pause
  f.tick(3500, 0); assert.equal(f.turns.length, 0);
  f.tick(4000, .1); // second resumed pause => 4s
  f.tick(7100, 0); assert.equal(f.turns.length, 0);
  f.tick(8100, 0); assert.equal(f.turns.length, 1);
  assert.equal(f.turns[0].blob.type, 'audio/mp4');
  f.tick(8200, .1); f.voice.finishTurn(); f.voice.finishTurn();
  assert.equal(f.turns.length, 2); assert.equal(f.requested(), 1);
  assert.ok(f.levels.some(frame => frame.level > 0));
  f.voice.setMuted(true); f.tick(9000, .1); assert.equal(f.levels.at(-1).level, 0);
  f.voice.close(); assert.ok(f.tracks[0].stopped);
});

test('permission rejection closes the pipeline and reports the real failure without a second permission', async () => {
  const f = voiceFixture({ denied: true }); await f.voice.start();
  assert.equal(f.requested(), 1); assert.equal(f.errors[0].name, 'NotAllowedError'); assert.ok(f.voice.closed);
});

test('polling survives more than five transient failures without recreating a job and surfaces definitive failure', async () => {
  const calls = [], events = []; let polls = 0;
  const transport = createOliviaTransport({ getToken: async () => 'fixture-token', pollIntervalMs: 1, fetchImpl: async (_, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    if (body.operation === 'startChat') return Response.json({ jobId: 'same-job' });
    if (++polls < 8) throw new TypeError('offline');
    return Response.json({ status: 'completed', text: 'Completa', result: { saved: true } });
  } });
  assert.equal((await transport.request({ operation: 'chat', background: true, requestId: 'same-request' }, { onEvent: event => events.push(event) })).saved, true);
  assert.equal(calls.filter(c => c.operation === 'startChat').length, 1);
  assert.ok(calls.slice(1).every(c => c.jobId === 'same-job'));
  assert.ok(events.some(e => e.label?.includes('recuperando')));
  const failed = createOliviaTransport({ getToken: async () => 'token', fetchImpl: async () => Response.json({ status: 'failed', text: '', failure: { message: 'Confirmed', code: 'backend-timeout' } }) });
  await assert.rejects(failed.request({ operation: 'waitChat', jobId: 'job' }), { code: 'backend-timeout' });
});

test('a lost start acknowledgement retries the same request and manual cancellation stays neutral', async () => {
  const starts = []; let startCalls = 0;
  const transport = createOliviaTransport({ getToken: async () => 'token', pollIntervalMs: 1, fetchImpl: async (_, init) => {
    const body = JSON.parse(init.body);
    if (body.operation === 'startChat') { starts.push(body); if (++startCalls === 1) throw new TypeError('lost acknowledgement'); return Response.json({ jobId: 'created-once' }); }
    return Response.json({ status: 'cancelled', text: '' });
  } });
  await assert.rejects(transport.request({ operation: 'chat', background: true, conversationId: 'fixed-chat', requestId: 'fixed-identity' }), { name: 'AbortError', code: 'chat-job-cancelled' });
  assert.deepEqual(starts[0], starts[1]);
});

test('PCM output uses the existing analyser, preserves a zero odd byte and interruption resolves playback promptly', async () => {
  const voice = new NaturalVoiceConversation();
  const analyser = {}, played = []; let completed = false;
  voice.outputAnalyser = analyser;
  voice.context = { currentTime: 0,
    createBuffer: (_, length) => ({ duration: 10, samples: new Float32Array(length), getChannelData() { return this.samples; } }),
    createBufferSource: () => { const source = { connect(node) { assert.equal(node, analyser); }, start() { played.push(this); }, stop() { this.onended?.(); }, disconnect() {} }; return source; } };
  const response = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0])); c.enqueue(new Uint8Array([1, 0, 2])); c.close(); } }));
  const playing = voice.play(response, { onComplete: () => { completed = true; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual([...played[0].buffer.samples], [256 / 32768, 512 / 32768]);
  voice.stopPlayback(); await playing;
  assert.equal(completed, false); assert.equal(voice.sources.size, 0);
});

test('a slow active backend job survives elapsed UI time and announces a calm progress message', async () => {
  const originalNow = Date.now; let time = 0, polls = 0; const events = [];
  Date.now = () => time;
  try {
    const transport = createOliviaTransport({ getToken: async () => 'token', pollIntervalMs: 1, fetchImpl: async () => {
      time = 500000;
      return Response.json(++polls === 1 ? { status: 'running', phase: 'Pensando…', text: 'Parcial' } : { status: 'completed', text: 'Parcial completa', result: { done: true } });
    } });
    assert.equal((await transport.request({ operation: 'waitChat', jobId: 'slow-job' }, { onEvent: e => events.push(e) })).done, true);
    assert.ok(events.some(e => e.type === 'phase' && e.label === 'Estoy terminando de procesarla…'));
    assert.equal(events.filter(e => e.type === 'delta').map(e => e.delta).join(''), 'Parcial completa');
  } finally { Date.now = originalNow; }
});
