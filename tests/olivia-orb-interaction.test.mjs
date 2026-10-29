import test from 'node:test';
import assert from 'node:assert/strict';
import { NaturalVoiceConversation } from '../src/gestion/olivia/naturalVoice.mjs';
import { interactionState, appendDictation, requestFailure } from '../src/gestion/olivia/interactionState.mjs';
import { createOliviaTransport } from '../src/gestion/olivia/client.mjs';
import { defaultOliviaConfiguration, validateConfiguration } from '../src/shared/oliviaContracts.mjs';
import { stateEnergy, createStateMix, blendEnergy } from '../src/gestion/olivia/voiceorbs/orb-state.js';
import { readFloatingPreference, writeFloatingPreference } from '../src/gestion/olivia/preferences.mjs';

test('floating preference is opt-in, user scoped, and denied storage is harmless', () => {
  const data = new Map(), storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  assert.equal(readFloatingPreference(storage, 'a'), false);
  writeFloatingPreference(storage, 'a', true);
  assert.equal(readFloatingPreference(storage, 'a'), true);
  assert.equal(readFloatingPreference(storage, 'b'), false);
  writeFloatingPreference(storage, 'a', false);
  assert.equal(readFloatingPreference(storage, 'a'), false);
  const denied = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(readFloatingPreference(denied, 'a'), false);
  assert.doesNotThrow(() => writeFloatingPreference(denied, 'a', true));
});

test('procedural energy moves without audio and transitions remain bounded', () => {
  const patterns = ['listening', 'thinking', 'speaking', 'connecting'].map(state => Array.from({ length: 20 }, (_, i) => stateEnergy(state, i / 10)));
  for (const pattern of patterns) assert.ok(new Set(pattern).size > 1 && pattern.every(value => value >= 0 && value <= 1));
  assert.equal(new Set(patterns.map(JSON.stringify)).size, 4);
  const mix = createStateMix('listening');
  for (let i = 0; i < 60; i++) { mix.update('speaking', 1 / 60); assert.ok(blendEnergy(mix.weights, i / 60) >= 0 && blendEnergy(mix.weights, i / 60) <= 1); }
});

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
  assert.equal(requestFailure({ name: 'AbortError' }, { reason: 'superseded' }).kind, 'neutral');
  assert.equal(interactionState({ busy: true, voiceDisabled: true }).state, 'thinking');
  assert.equal(interactionState({ voiceDisabled: true }).state, 'disabled');
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

function voiceFixture({ denied = false, adaptiveEndpointing = false } = {}) {
  let now = 0, amplitude = 0, requested = 0;
  const trackEvents = new Map(), contextEvents = new Map();
  const frames = [], turns = [], levels = [], tracks = [{ enabled: true, stop() { this.stopped = true; }, addEventListener(type, fn) { trackEvents.set(type, fn); }, removeEventListener(type) { trackEvents.delete(type); } }];
  class Recorder {
    static isTypeSupported(type) { return type === 'audio/mp4'; }
    constructor(_, options) { this.mimeType = options.mimeType; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['recorded']) }); this.onstop(); }
  }
  const context = { currentTime: 0, destination: {}, resume: async () => {}, close: async () => {}, addEventListener(type, fn) { contextEvents.set(type, fn); }, removeEventListener(type) { contextEvents.delete(type); },
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    createAnalyser: () => ({ fftSize: 1024, connect() {}, disconnect() {}, getFloatTimeDomainData(samples) { samples.fill(amplitude); } }) };
  const errors = [];
  const voice = new NaturalVoiceConversation({ Recorder,adaptiveEndpointing, AudioContext: class { constructor() { return context; } },
    mediaDevices: { getUserMedia: async () => { requested++; if (denied) throw new DOMException('Denied', 'NotAllowedError'); return { getAudioTracks: () => tracks, getTracks: () => tracks }; } },
    frame: fn => { frames.push(fn); return frames.length; }, cancelFrame() {}, now: () => now,
    onTurn: (blob, metadata) => turns.push({ blob, metadata }), onFrame: frame => levels.push(frame), onError: error => errors.push(error) });
  return { voice, turns, levels, errors, tracks, context, trackEvents, contextEvents, requested: () => requested, tick(t, a) { now = t; amplitude = a; frames.shift()?.(); } };
}

test('browser revocation or suspended audio ends capture truthfully and permits a fresh explicit session', async () => {
  for (const cause of ['track-ended', 'suspended']) {
    const f = voiceFixture(); await f.voice.start();
    if (cause === 'track-ended') f.trackEvents.get('ended')();
    else { f.context.state = 'suspended'; f.contextEvents.get('statechange')(); }
    assert.equal(f.voice.closed, true); assert.equal(f.tracks[0].stopped, true);
    assert.equal(f.errors.length, 1); assert.equal(f.requested(), 1);
    assert.equal(f.trackEvents.size, 0); assert.equal(f.contextEvents.size, 0);
    f.voice.close(); assert.equal(f.errors.length, 1);
    const next = voiceFixture(); await next.voice.start(); assert.equal(next.voice.closed, false); next.voice.close();
  }
});

test('natural pauses stay in one turn, acoustic continuations extend to 3–4s, manual send is immediate', async () => {
  const f = voiceFixture(); await f.voice.start();
  f.tick(100, .1); f.tick(900, 0); f.tick(1500, .1); // resumed pause
  f.tick(3500, 0); assert.equal(f.turns.length, 0);
  f.tick(4000, .1); // second resumed pause => 4s
  f.tick(7100, 0); assert.equal(f.turns.length, 0);
  f.tick(8100, 0); await f.voice.deliveryQueue; assert.equal(f.turns.length, 1);
  assert.equal(f.turns[0].blob.type, 'audio/mp4');
  f.tick(8200, .1); f.voice.finishTurn(); f.voice.finishTurn();
  await f.voice.deliveryQueue;
  assert.equal(f.turns.length, 2); assert.equal(f.requested(), 1);
  assert.ok(f.levels.some(frame => frame.level > 0));
  f.voice.setMuted(true); f.tick(9000, .1); assert.equal(f.levels.at(-1).level, 0);
  f.voice.close(); assert.ok(f.tracks[0].stopped);
});

test('incomplete live partials extend silence and final live text bypasses duplicate file transcription',async()=>{
  const f=voiceFixture();let commits=0;
  f.voice.createTranscriber=async(_stream,onPartial)=>{onPartial('Necesito el stock de');return {closed:false,beginTurn(){onPartial('Necesito el stock de');},commit:async()=>{commits++;return {text:'Necesito el stock de aceite',itemId:'item-a'};},close(){this.closed=true;}};};
  await f.voice.start();f.tick(100,.1);f.tick(2200,0);assert.equal(f.turns.length,0);f.tick(4200,0);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(commits,1);assert.equal(f.turns[0].metadata.transcript.text,'Necesito el stock de aceite');assert.equal(f.requested(),1);f.voice.close();
});

test('live setup failure preserves the same authorized capture and releases setup when ended',async()=>{
  const f=voiceFixture(),notices=[];
  f.voice.createTranscriber=async()=>{throw Error('Unavailable');};f.voice.onNotice=text=>notices.push(text);
  await f.voice.start();assert.equal(f.requested(),1);assert.equal(f.voice.closed,false);assert.equal(notices.length,1);
  f.tick(100,.1);f.voice.finishTurn();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.turns.length,1);assert.equal(f.turns[0].metadata.transcript,undefined);f.voice.close();
});

test('out-of-order live finals are delivered chronologically and mute discards provider input',async()=>{
  const f=voiceFixture(),resolvers=[];let discards=0;
  f.voice.createTranscriber=async()=>({closed:false,beginTurn(){},commit:()=>new Promise(resolve=>resolvers.push(resolve)),discardTurn(){discards++;},close(){this.closed=true;}});
  await f.voice.start();f.tick(100,.1);f.voice.finishTurn();f.tick(200,.1);f.voice.finishTurn();
  resolvers[1]({text:'Después cliente'});await new Promise(resolve=>setImmediate(resolve));assert.equal(f.turns.length,0);
  resolvers[0]({text:'Primero stock'});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.turns.map(x=>x.metadata.transcript.text),['Primero stock','Después cliente']);
  f.tick(300,.1);f.voice.setMuted(true);assert.ok(discards>0);assert.equal(f.tracks[0].enabled,false);f.voice.close();
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

test('PCM output connects directly to speakers, preserves a zero odd byte and interruption resolves playback promptly', async () => {
  const voice = new NaturalVoiceConversation();
  const destination = {}, played = []; let completed = false;
  voice.context = { currentTime: 0, destination,
    createBuffer: (_, length) => ({ duration: 10, samples: new Float32Array(length), getChannelData() { return this.samples; } }),
    createBufferSource: () => { const source = { connect(node) { assert.equal(node, destination); }, start() { played.push(this); }, stop() { this.onended?.(); }, disconnect() {} }; return source; } };
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
