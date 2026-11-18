import test from "node:test";
import assert from "node:assert/strict";
import { fixture, start } from "./helpers/olivia-fixture.mjs";
import { liveTranscriptionSession } from "../netlify/functions/_lib/olivia/liveTranscription.mjs";
import { LiveTranscription } from "../src/gestion/olivia/liveTranscription.mjs";

const next = () => new Promise(resolve => setImmediate(resolve));
async function setup() {
  const f = fixture({ role: "admin" });
  f.session.email = "agsreserva@gmail.com";
  const { conversationId } = await start(f);
  return { ...f, conversationId };
}

test("live transcription is transcription-only, idempotent, bounded and closed on the server", async () => {
  const f = await setup(); let starts = 0, stops = 0;
  const fetchImpl = async (url, request) => {
    if (url.endsWith("/hangup")) { stops++; return new Response(null, { status: 200 }); }
    starts++;
    const config = JSON.parse(request.body.get("session"));
    assert.equal(config.type, "transcription");
    assert.equal(config.audio.input.transcription.model, "gpt-live-transcribe");
    assert.equal(config.audio.input.turn_detection, null);
    assert.deepEqual(config.audio.input.transcription.languages, ["es"]);
    assert.equal(config.tools, undefined);
    return new Response("v=0\nanswer", { headers: { location: "https://api.openai.com/v1/realtime/calls/rtc_fixture" } });
  };
  const body = { operation: "start", conversationId: f.conversationId, requestId: "live-1", sdp: "v=0\noffer" };
  const args = { session: f.session, store: f.store, engine: f.engine, env: { OPENAI_API_KEY: "fixture" }, body, fetchImpl, now: f.clock() };
  const result = await liveTranscriptionSession(args);
  assert.equal(result.maxSessionSeconds, 180);
  assert.equal(result.sdp, "v=0\nanswer");
  await liveTranscriptionSession(args);
  assert.equal(starts, 1);
  await assert.rejects(liveTranscriptionSession({ ...args, body: { ...body, requestId: "live-2" } }), error => error.code === "voice-session-active");
  const closed = await liveTranscriptionSession({ ...args, body: { ...body, operation: "stop" }, now: new Date(f.clock().getTime() + 30000) });
  assert.equal(stops, 1);
  assert.equal(closed.estimatedSeconds, 30);
  await liveTranscriptionSession({ ...args, body: { ...body, requestId: "live-2" }, now: new Date(f.clock().getTime() + 31000) });
  assert.equal(starts, 2);
  await assert.rejects(liveTranscriptionSession({ ...args, session: { ...f.session, email: "other@example.test" } }), error => error.code === "voice-not-enabled");
});

test("live transcription correlates finals by item_id and never treats a partial as final", async () => {
  const sent = [], partials = []; let originalStops = 0, cloneStops = 0, stopped = 0;
  class Peer {
    createDataChannel() { return this.channel = { readyState: "open", send: value => sent.push(JSON.parse(value)), close() {} }; }
    addTrack(track) { this.track = track; }
    async createOffer() { return { sdp: "v=0\noffer" }; }
    async setLocalDescription() {}
    async setRemoteDescription() { this.channel.onmessage({ data: JSON.stringify({ type: "session.created" }) }); }
    close() {}
  }
  const original = { enabled: true, stop() { originalStops++; }, clone: () => ({ enabled: true, stop() { cloneStops++; } }) };
  const live = new LiveTranscription({ Peer, connect: async () => ({ sdp: "v=0\nanswer", maxSessionSeconds: 180 }), stop: async () => stopped++, onPartial: text => partials.push(text) });
  await live.start({ getAudioTracks: () => [original] });
  live.beginTurn();
  live.receive({ type: "conversation.item.input_audio_transcription.delta", item_id: "a", delta: "Hola" });
  assert.equal(partials.at(-1), "Hola");
  const a = live.commit(), b = live.commit();
  live.receive({ type: "input_audio_buffer.committed", item_id: "a" });
  live.receive({ type: "input_audio_buffer.committed", item_id: "b" });
  live.receive({ type: "conversation.item.input_audio_transcription.completed", item_id: "b", transcript: "Cliente" });
  live.receive({ type: "conversation.item.input_audio_transcription.completed", item_id: "a", transcript: "Stock" });
  assert.equal((await a).text, "Stock");
  assert.equal((await b).text, "Cliente");
  live.beginTurn();
  assert.equal(live.track.enabled, true);
  live.discardTurn();
  assert.equal(live.track.enabled, false);
  assert.equal(original.enabled, true);
  assert.equal(sent.filter(item => item.type === "input_audio_buffer.commit").length, 2);
  const pending = live.commit();
  live.close();
  await assert.rejects(pending, { name: "AbortError" });
  await next();
  assert.equal(stopped, 1);
  assert.equal(cloneStops, 1);
  assert.equal(originalStops, 0);
});
