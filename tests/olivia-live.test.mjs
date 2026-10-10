import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createLive, interruptLive } from "../netlify/functions/_lib/olivia/live.mjs";
import { monitorLive, liveUsage, liveSummary } from "../netlify/functions/_lib/olivia/liveMonitor.mjs";
import { reserveUsage } from "../netlify/functions/_lib/olivia/usage.mjs";
import { OliviaLive } from "../src/gestion/olivia/live.mjs";
import { oliviaVoiceConfiguration } from "../src/shared/oliviaVoiceAvailability.mjs";
import { routeModel } from "../netlify/functions/_lib/olivia/modelRouter.mjs";
import { fixture as baseFixture, start, functionResponse } from "./helpers/olivia-fixture.mjs";
const fixture = options => { const f = baseFixture(options); f.session.email = "agsreserva@gmail.com"; return f; };
const pause = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

test("creación GPT-Live: delegación cliente, credencial privada y canal sin autoridad", async () => {
  const f = fixture({ role: "admin" }), { conversationId } = await start(f);
  f.documents.get("oliviaConfiguration/global").voiceProtocol = "realtime";
  f.documents.get("oliviaConfiguration/global").profiles.live.voice = "cedar";
  let providerBody;
  const result = await createLive({ session: f.session, body: { conversationId, requestId: "live_a", sdp: "v=0\nfull-offer", screenContext: { module: "locations" } }, engine: f.engine, store: f.store, env: { OPENAI_API_KEY: "private-test-key" }, now: f.clock(), applicationOrigin: "https://preview.example", fetchImpl: async (url, options) => {
    if (url.includes("api.openai.com")) {
      providerBody = JSON.parse(options.body);
      // The API accepts ServerEventSelector objects, not bare event-name strings.
      const selectors = providerBody.session.client.data_channel.allowed_server_events;
      assert.ok(selectors.every((selector) => typeof selector.type === "string" && Object.keys(selector).length === 1));
      assert.ok(selectors.some((selector) => selector.type === "session.started"));
      return Response.json({ session: { id: "live_test" }, transport: { sdp: "v=0\nanswer" } });
    }
    const { realtimeSessionId } = JSON.parse(options.body);
    await f.store.commit([{ type: "update", path: `oliviaRealtime/${realtimeSessionId}`, data: { meteringConnectedAt: f.clock() } }]);
    return new Response(null, { status: 202 });
  } });
  assert.equal(providerBody.session.model, "gpt-live-1");
  assert.equal(providerBody.session.audio.output.voice, "marin");
  assert.deepEqual(providerBody.session.delegation, { type: "client" });
  assert.ok(!providerBody.session.client.data_channel.allowed_client_events.includes("session.instructions.append"));
  assert.ok(!JSON.stringify(result).includes("private-test-key"));
  assert.equal(f.documents.get(`oliviaRealtime/${result.realtimeSessionId}`).protocol, "live");
});

test("Live queda reservado a Agustín y usa Luna incluso para pedidos creativos", async () => {
  const f = fixture({ role: "admin" });
  const { conversationId } = await start(f);
  const other = { ...f.session, email: "other@gmail.com", profile: { ...f.session.profile, email: "agsreserva@gmail.com" } };
  await assert.rejects(createLive({ session: other, body: { conversationId, requestId: "denied", sdp: "v=0" }, store: f.store, engine: f.engine }), { code: "voice-not-enabled" });
  assert.equal([...f.documents].filter(([path]) => path.startsWith("oliviaRealtime/")).length, 0);
  const route = routeModel(oliviaVoiceConfiguration(f.config), f.session, { message: "Diseñame un concepto creativo para Instagram", context: { module: "marketing" } });
  assert.equal(route.model, "gpt-6-luna");
  assert.equal(route.reasoningEffort, "low");
  assert.equal(route.route, "luna-voice");
  assert.equal((await f.engine.state(other, conversationId)).voiceConversationAvailable, false);
  assert.equal((await f.engine.state(f.session, conversationId)).voiceConversationAvailable, true);
});
test("creación fallida registra costo desconocido y libera la reserva", async () => {
  const f = fixture({ role: "admin" }), { conversationId } = await start(f);
  await assert.rejects(createLive({ session: f.session, body: { conversationId, requestId: "failed", sdp: "v=0" }, engine: f.engine, store: f.store, env: { OPENAI_API_KEY: "test" }, now: f.clock(), fetchImpl: async () => new Response(null, { status: 503 }) }), { code: "live-unavailable" });
  const usage = [...f.documents].find(([path]) => path.startsWith("oliviaUsage/"))[1];
  assert.equal(usage.actualCostUsd, null); assert.equal(usage.totalTokens, 0);
  assert.equal([...f.documents].find(([path]) => path.startsWith("oliviaBudgets/"))[1].reservedTokens, 0);
});
async function voiceFixture() {
  const f = fixture({ role: "admin" }), { conversationId } = await start(f);
  const reservation = await reserveUsage({ store: f.store, session: f.session, configuration: f.config, requestId: "meter", operation: "live", reservedTokens: 20000, now: f.clock() });
  f.documents.set("oliviaRealtime/voice_a", { protocol: "live", callId: "live_test", userId: f.session.uid, sessionBinding: String(f.session.authTime), conversationId, status: "active", model: "gpt-live-1", expiresAt: new Date(f.clock().getTime() + 180000), reservation, screenContext: { module: "locations" } });
  return { f, conversationId };
}
function socketFactory(onOpen) {
  let socket;
  class Socket extends EventEmitter {
    constructor(url, options) { super(); socket = this; this.url = url; this.headers = options.headers; this.readyState = 1; this.sent = []; setImmediate(() => { this.emit("open"); onOpen?.(this); }); }
    send(text) { this.sent.push(JSON.parse(text)); }
    close() { this.readyState = 3; this.emit("close"); }
    event(value) { this.emit("message", JSON.stringify(value)); }
  }
  return { Socket, current: () => socket };
}
test("sideband liquida duración acumulativa una vez, independiente de tokens", async () => {
  const { f } = await voiceFixture();
  const fake = socketFactory((socket) => setTimeout(() => {
    socket.event({ type: "session.usage.updated", usage: { seconds: 12 } });
    socket.event({ type: "session.usage.updated", usage: { seconds: 15 } });
    socket.event({ type: "session.closed", usage: { seconds: 90 } });
  }, 10));
  const result = await monitorLive({ session: f.session, realtimeSessionId: "voice_a", store: f.store, engine: f.engine, clock: f.clock, env: { OPENAI_API_KEY: "test" }, WebSocketImpl: fake.Socket });
  assert.equal(result.seconds, 90); assert.equal(result.finalized, true);
  const usage = [...f.documents].find(([path]) => path.startsWith("oliviaUsage/"))[1];
  assert.equal(usage.actualCostUsd, 0.075); assert.equal(usage.totalTokens, 0);
  const repeat = await monitorLive({ session: f.session, realtimeSessionId: "voice_a", store: f.store, engine: f.engine, clock: f.clock });
  assert.equal(repeat.duplicate, true);
});
test("corte sin session.closed conserva duración observada y costo sin confirmar", async () => {
  const { f } = await voiceFixture();
  const fake = socketFactory((socket) => setTimeout(() => { socket.event({ type: "session.usage.updated", usage: { seconds: 12 } }); socket.close(); }, 10));
  await monitorLive({ session: f.session, realtimeSessionId: "voice_a", store: f.store, engine: f.engine, clock: f.clock, env: { OPENAI_API_KEY: "test" }, WebSocketImpl: fake.Socket, fetchImpl: async () => new Response(null, { status: 200 }) });
  const usage = [...f.documents].find(([path]) => path.startsWith("oliviaUsage/"))[1];
  assert.equal(usage.durationSeconds, 12); assert.equal(usage.actualCostUsd, null); assert.equal(usage.finalization, "incomplete");
});
test("delegación duplicada se procesa una vez por el backend; jamás confirma por voz", async () => {
  const { f, conversationId } = await voiceFixture();
  f.documents.set("products/oil", { name: "Original", defaultPrice: 1500, active: true });
  const fake = socketFactory();
  const monitoring = monitorLive({ session: f.session, realtimeSessionId: "voice_a", store: f.store, engine: f.engine, clock: f.clock, env: { OPENAI_API_KEY: "test" }, WebSocketImpl: fake.Socket });
  await pause(); f.advance(2000);
  fake.current().event({ type: "session.input_transcript.delta", event_id: "input", delta: "Cargame 12 botellas de Original" });
  const delegation = { type: "session.delegation.created", event_id: "delegate", delegation: { id: "item_a", target: "client" } };
  fake.current().event(delegation); fake.current().event(delegation);
  await pause(30);
  const task = f.documents.get(`oliviaConversations/${conversationId}`).taskState;
  assert.equal(task.slots.quantity, 12); assert.equal(task.slots.productId, "oil");
  assert.equal([...f.documents].filter(([path]) => path.startsWith("oliviaLiveDelegations/")).length, 1);
  assert.equal(f.providerCalls(), 0);
  assert.equal(fake.current().sent.filter((event) => event.type === "session.commentary.append").length, 1);
  fake.current().event({ type: "session.closed", usage: { seconds: 30 } });
  await monitoring;
});
test("barrera de revisión impide que un resultado tardío recree una tarjeta", async () => {
  let resolve, notify;
  const providerStarted = new Promise((done) => { notify = done; });
  const f = fixture({ role: "admin", provider: async () => { notify(); return new Promise((done) => { resolve = done; }); } });
  const { conversationId } = await start(f);
  const pending = f.engine.chat(f.session, { conversationId, requestId: "old", message: "Ingresá stock de aceite con todos los datos", screenContext: { module: "locations" } });
  await providerStarted;
  await f.engine.invalidateTask(f.session, conversationId);
  resolve(functionResponse("prepare_stock_load", { locationId: "local_a", productId: "oil", quantity: 12, reason: "Reposición" }));
  await assert.rejects(pending, { code: "request-expired" });
  assert.equal(f.documents.get(`oliviaConversations/${conversationId}`).pendingActionId, null);
  assert.equal([...f.documents].filter(([path]) => path.startsWith("oliviaConfirmations/")).length, 0);
});
test("control de interrupción exige sesión y conversación propias", async () => {
  const { f, conversationId } = await voiceFixture();
  await assert.rejects(interruptLive({ session: { ...f.session, uid: "other" }, body: { realtimeSessionId: "voice_a", conversationId }, store: f.store }), { code: "permission-denied" });
  assert.equal((await interruptLive({ session: f.session, body: { realtimeSessionId: "voice_a", conversationId }, store: f.store })).interrupted, true);
});
test("resumen no contiene tokens de confirmación y uso inválido no se liquida", () => {
  const content = liveSummary({ state: "ESPERANDO_CONFIRMACION", pendingAction: { confirmationToken: "secret" }, messages: [{ role: "assistant", content: "Agregar 12 unidades" }] });
  assert.ok(!content.includes("secret")); assert.match(content, /todavía no se ejecutó/);
  assert.equal(liveUsage({ usage: { seconds: -1 } }), null); assert.equal(liveUsage({ usage: { seconds: "12" } }), null);
});
test("WebRTC espera ICE completo y session.started; cierre mantiene transporte hasta finalización", async () => {
  const sent = [], listeners = new Map(), timers = new Map(); let timerId = 0, stopped = 0, refreshed = 0, offered;
  const track = { enabled: true, stop: () => { stopped++; } };
  class Peer {
    constructor() { this.iceGatheringState = "gathering"; this.connectionState = "connected"; this.channel = { readyState: "open", send: (text) => sent.push(JSON.parse(text)), close: () => {} }; }
    addTrack() {} createDataChannel() { return this.channel; }
    async createOffer() { return { sdp: "v=0\ninitial" }; }
    async setLocalDescription() { this.localDescription = { sdp: "v=0\nfull-ice" }; }
    addEventListener(name, listener) { listeners.set(name, listener); queueMicrotask(() => { this.iceGatheringState = "complete"; listener(); }); }
    removeEventListener(name) { listeners.delete(name); }
    async setRemoteDescription() {} close() { this.connectionState = "closed"; }
  }
  const client = new OliviaLive({ mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) }, PeerConnection: Peer, createAudio: () => ({ pause() {}, remove() {} }), createSession: async (sdp) => { offered = sdp; return { sdp: "v=0\nanswer", realtimeSessionId: "a" }; }, onRefresh: () => { refreshed++; }, setTimer: (fn) => { timers.set(++timerId, fn); return timerId; }, clearTimer: (id) => timers.delete(id) });
  await client.connect();
  assert.equal(offered, "v=0\nfull-ice"); client.setMuted(true); assert.equal(sent.length, 0);
  client.handleEvent({ type: "session.started" }); client.setMuted(false);
  assert.equal(sent[0].type, "session.input_audio.unmute");
  client.close(); assert.equal(client.pc.connectionState, "connected"); assert.equal(stopped, 0);
  client.handleEvent({ type: "session.closed", usage: { seconds: 30 } });
  assert.equal(client.closed, true); assert.equal(stopped, 1); assert.equal(refreshed, 1);
  assert.ok(sent.every((event) => !event.type.startsWith("response.") && event.type !== "session.start"));
});
test("transcripción de una conversación simple persiste sin llamada de razonamiento", async () => {
  const f = fixture({ role: "admin" }), { conversationId } = await start(f);
  await f.engine.recordSpeech(f.session, conversationId, "speech_a", "Esperá un segundo", "user");
  await f.engine.recordSpeech(f.session, conversationId, "speech_a", "Esperá un segundo", "user");
  await f.engine.recordSpeech(f.session, conversationId, "speech_b", "Dale, te espero.", "assistant");
  const result = await f.engine.state(f.session, conversationId);
  assert.equal(result.messages.length, 2); assert.equal(f.providerCalls(), 0);
  await assert.rejects(f.engine.recordSpeech({ ...f.session, uid: "other" }, conversationId, "speech_c", "Hola", "user"), { code: "conversation-not-found" });
});
