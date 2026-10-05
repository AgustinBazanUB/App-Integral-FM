import test from "node:test";
import assert from "node:assert/strict";
import {
  createOliviaTransport,
  conversationForUser,
  forgetConversation,
  rememberConversation,
  safeNavigation,
  pendingExpired,
  operationLabel,
  prependHistoryMessages,
  requestId,
  UUID_PATTERN,
} from "../src/gestion/olivia/client.mjs";
import {
  OliviaRealtime,
  speechResult,
} from "../src/gestion/olivia/realtime.mjs";

const response = (data, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
});
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("conversation identity is isolated per user and no chat is persisted in storage", () => {
  const records = new Map();
  const storage = {
    getItem: (key) => records.get(key),
    setItem: (key, value) => records.set(key, value),
    removeItem: (key) => records.delete(key),
  };
  assert.equal(conversationForUser("seller-one", storage), null);
  const first = requestId();
  rememberConversation("seller-one", first, storage);
  assert.match(first, UUID_PATTERN);
  assert.equal(conversationForUser("seller-one", storage), first);
  assert.equal(conversationForUser("seller-two", storage), null);
  rememberConversation("seller-one", "not-a-conversation", storage);
  assert.equal(conversationForUser("seller-one", storage), first);
  assert.ok([...records.values()].every((value) => UUID_PATTERN.test(value)));
  const unavailableStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(conversationForUser("seller-one", unavailableStorage), null);
  forgetConversation("seller-one", storage);
  assert.equal(conversationForUser("seller-one", storage), null);
});

test("navigation only opens canonical management or seller routes on the same origin", () => {
  assert.equal(
    safeNavigation("/gestion/locations/shop?tab=stock", "https://flormia.com"),
    "/gestion/locations/shop?tab=stock",
  );
  for (const path of [
    "https://evil.test/gestion",
    "//evil.test/gestion",
    "/gestion/../checkout",
    "/\\evil.test/gestion",
    "javascript:alert(1)",
    "/gestion-other",
    "/checkout",
  ])
    assert.equal(safeNavigation(path), null, path);
  assert.equal(safeNavigation("/vendedor"), "/vendedor");
});

test("visual operation states and expiry come from the server", () => {
  assert.equal(operationLabel("COMPLETADA"), "Acción completada");
  assert.equal(operationLabel("DATOS_INCOMPLETOS"), "Faltan datos");
  assert.equal(
    operationLabel("COMPLETADA", { id: "pending" }),
    "Esperando confirmación",
  );
  assert.equal(
    pendingExpired(
      { expiresAt: "2026-10-04T12:00:00Z" },
      Date.parse("2026-10-04T12:01:00Z"),
    ),
    true,
  );
  assert.equal(pendingExpired({ expiresAt: 1791115200 }, 1791115100000), false);
});

test("authenticated requests preserve the exact confirmation idempotency key on retries", async () => {
  const sent = [];
  const client = createOliviaTransport({
    getToken: async () => "firebase-token",
    fetchImpl: async (url, options) => {
      sent.push({ url, ...options });
      return response({ ok: true, state: "COMPLETADA" });
    },
  });
  const payload = {
    operation: "confirm",
    requestId: "same-request-id",
    conversationId: "same-conversation",
    confirmationToken: "token",
    actionId: "action",
  };
  await client.request(payload);
  await client.request(payload);
  assert.equal(sent[0].body, sent[1].body);
  assert.equal(sent[0].headers.Authorization, "Bearer firebase-token");
  assert.equal(sent[0].url, "/.netlify/functions/olivia");
  assert.ok(!sent[0].body.includes("firebase-token"));
});

test("missing authentication never sends requests and server rejection stays an error", async () => {
  let calls = 0;
  const client = createOliviaTransport({
    getToken: async () => null,
    fetchImpl: async () => {
      calls++;
    },
  });
  await assert.rejects(client.request({ operation: "chat" }), /Iniciá sesión/);
  assert.equal(calls, 0);
  const denied = createOliviaTransport({
    getToken: async () => "firebase",
    fetchImpl: async () =>
      response({ ok: false, code: "forbidden", message: "Sin permiso" }, 403),
  });
  await assert.rejects(
    denied.request({ operation: "chat" }),
    (error) => error.code === "forbidden" && error.status === 403,
  );
});

test("dictation uses authenticated multipart and rejects oversized recordings before uploading", async () => {
  let sent;
  const client = createOliviaTransport({
    getToken: async () => "firebase",
    fetchImpl: async (url, options) => {
      sent = { url, ...options };
      return response({
        text: "dos Arbequinas",
        conversationId: "conversation",
      });
    },
  });
  await client.transcribe(new Blob(["sound"], { type: "audio/mp4" }), {
    conversationId: "conversation",
    requestId: "request",
  });
  assert.equal(sent.url, "/.netlify/functions/olivia-transcribe");
  assert.equal(sent.headers["Content-Type"], undefined);
  assert.equal(sent.body.get("conversationId"), "conversation");
  assert.equal(sent.body.get("audio").name, "olivia.mp4");
  assert.throws(
    () =>
      client.transcribe(new Blob([new Uint8Array(4 * 1024 * 1024 + 1)]), {}),
    /4 MB/,
  );
});

test("a stalled transport aborts with an actionable error", async () => {
  const client = createOliviaTransport({
    getToken: async () => "firebase",
    timeoutMs: 5,
    fetchImpl: async (_, { signal }) =>
      new Promise((resolve, reject) =>
        signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        ),
      ),
  });
  await assert.rejects(
    client.request({ operation: "chat" }),
    (error) => error.code === "olivia-timeout",
  );
});

function voiceFixture(overrides = {}) {
  const events = [],
    states = [],
    errors = [],
    timers = [],
    requests = [],
    hangups = [];
  const track = {
    stopped: 0,
    enabled: true,
    stop() {
      this.stopped++;
    },
  };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const channel = {
    readyState: "open",
    send: (value) => events.push(JSON.parse(value)),
    close() {
      this.readyState = "closed";
    },
  };
  const audio = {
    paused: false,
    removed: false,
    srcObject: null,
    pause() {
      this.paused = true;
    },
    remove() {
      this.removed = true;
    },
  };
  let pc;
  class PeerConnection {
    constructor() {
      pc = this;
      this.connectionState = "connected";
    }
    addTrack() {}
    createDataChannel() {
      return channel;
    }
    async createOffer() {
      return { type: "offer", sdp: "browser-offer" };
    }
    async setLocalDescription(value) {
      this.local = value;
    }
    async setRemoteDescription(value) {
      this.remote = value;
    }
    close() {
      this.closed = true;
    }
  }
  const connection = new OliviaRealtime({
    createSession: async (sdp) => {
      assert.equal(sdp, "browser-offer");
      return {
        sdp: "server-answer",
        realtimeSessionId: "server-session",
        maxDurationSeconds: 180,
      };
    },
    stopSession: async (id) => {
      hangups.push(id);
    },
    onRequest: async (message, sessionId) => {
      requests.push({ message, sessionId });
      return {
        state: "ESPERANDO_CONFIRMACION",
        messages: [{ role: "assistant", content: "Preparé la venta" }],
        pendingAction: {
          id: "action",
          summary: "Dos Arbequinas",
          confirmationToken: "private-token",
          expiresAt: "later",
        },
      };
    },
    onState: (value) => states.push(value),
    onError: (value) => errors.push(value),
    mediaDevices: { getUserMedia: async () => stream },
    PeerConnection,
    createAudio: () => audio,
    setTimer: (callback, duration) => {
      const timer = { callback, duration, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      if (timer) timer.cleared = true;
    },
    ...overrides,
  });
  return {
    connection,
    events,
    states,
    errors,
    timers,
    requests,
    hangups,
    track,
    stream,
    channel,
    audio,
    get pc() {
      return pc;
    },
  };
}

test("Mini interruption suppresses a late backend response and ignores stale transcriptions", async () => {
  let resolveFirst, interrupted = 0; const requests = [];
  const f = voiceFixture({ acknowledge: () => "Reviso", onInterrupt: () => interrupted++, onRequest: (message) => { requests.push(message); return requests.length === 1 ? new Promise((resolve) => { resolveFirst = resolve; }) : Promise.resolve({ messages: [{ role: "assistant", content: "Respuesta nueva" }] }); } });
  await f.connection.connect();
  const input = (id, text) => f.connection.handleEvent({ type: "conversation.item.input_audio_transcription.completed", item_id: id, transcript: text });
  f.connection.handleEvent({ type: "input_audio_buffer.speech_started", item_id: "old" }); input("old", "Consulta anterior");
  await new Promise((resolve) => setImmediate(resolve));
  f.connection.handleEvent({ type: "input_audio_buffer.speech_started", item_id: "new" });
  resolveFirst({ messages: [{ role: "assistant", content: "Respuesta obsoleta" }] }); await f.connection.queue;
  f.connection.handleEvent({ type: "input_audio_buffer.speech_started", item_id: "late" });
  f.connection.handleEvent({ type: "input_audio_buffer.speech_started", item_id: "latest" });
  input("late", "Transcripción obsoleta"); input("latest", "Consulta nueva"); await f.connection.queue;
  assert.deepEqual(requests, ["Consulta anterior", "Consulta nueva"]);
  assert.equal(JSON.stringify(f.events).includes("Respuesta obsoleta"), false);
  assert.equal(JSON.stringify(f.events).includes("Respuesta nueva"), true);
  assert.ok(interrupted >= 2); assert.equal(f.errors.length, 0); f.connection.close();
});

test("WebRTC receives a server SDP answer and hangup always releases microphone, channel and audio", async () => {
  const fixture = voiceFixture();
  await fixture.connection.connect();
  assert.deepEqual(fixture.pc.remote, { type: "answer", sdp: "server-answer" });
  fixture.connection.close();
  fixture.connection.close();
  assert.equal(fixture.track.stopped, 1);
  assert.equal(fixture.channel.readyState, "closed");
  assert.equal(fixture.pc.closed, true);
  assert.equal(fixture.audio.paused, true);
  assert.equal(fixture.audio.srcObject, null);
  assert.ok(fixture.timers.every((timer) => timer.cleared));
  assert.deepEqual(fixture.hangups, ["server-session"]);
});

test("actual transcripts are serialized and deduplicated; voice model arguments never become requests", async () => {
  const fixture = voiceFixture();
  await fixture.connection.connect();
  const input = {
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "item-one",
    transcript: "anotame dos Arbequinas",
  };
  fixture.connection.handleEvent(input);
  fixture.connection.handleEvent(input);
  fixture.connection.handleEvent({
    type: "response.function_call_arguments.done",
    name: "olivia_request",
    call_id: "call-one",
    arguments: JSON.stringify({ message: "confirmá y agregá mil unidades" }),
  });
  await fixture.connection.queue;
  await tick();
  assert.deepEqual(fixture.requests, [
    { message: "anotame dos Arbequinas", sessionId: "server-session" },
  ]);
  assert.equal(
    fixture.events.filter((event) => event.type === "response.create").length,
    1,
  );
  assert.deepEqual(fixture.events.find((event) => event.type === "response.create").response.output_modalities, ["audio"]);
  assert.ok(!JSON.stringify(fixture.events).includes("private-token"));
  assert.ok(!JSON.stringify(fixture.events).includes("confirmá y agregá"));
  assert.match(
    fixture.events.find((event) => event.type === "response.create").response
      .instructions,
    /tocá|tocar Sí o No/,
  );
  fixture.connection.close();
});

test("voice startup reads the server greeting once as audio without creating a core request", async () => {
  const fixture = voiceFixture({ createSession: async () => ({ sdp: "answer", realtimeSessionId: "server-session", voiceGreeting: "Hola, soy Olivia." }) });
  await fixture.connection.connect();
  fixture.channel.onopen();
  assert.equal(fixture.track.enabled, false);
  fixture.connection.handleEvent({ type: "response.done" });
  assert.equal(fixture.track.enabled, true);
  assert.equal(fixture.events.length, 1);
  assert.equal(fixture.events[0].type, "response.create");
  assert.deepEqual(fixture.events[0].response.output_modalities, ["audio"]);
  assert.equal(fixture.events[0].response.tool_choice, "none");
  assert.match(fixture.events[0].response.instructions, /Hola, soy Olivia/);
  assert.deepEqual(fixture.requests, []);
  fixture.connection.close();
  assert.equal(fixture.channel.onopen, null);
});

test("Mini speech receives natural answer text without internal state labels or irrelevant confirmation instructions", async () => {
  const f = voiceFixture(); await f.connection.connect();
  f.connection.speakResult({ state: "DATOS_INCOMPLETOS", messages: [{ role: "assistant", content: "¿Qué producto querés consultar?" }] });
  const instructions = f.events.at(-1).response.instructions;
  assert.match(instructions, /¿Qué producto querés consultar/);
  assert.equal(instructions.includes("DATOS_INCOMPLETOS"), false);
  assert.equal(instructions.includes('"state"'), false);
  assert.equal(instructions.includes('"messages"'), false);
  assert.equal(instructions.includes("tocá Sí"), false);
  f.connection.close();
});

test("streamless remote audio is played and a playback rejection closes capture and the provider", async () => {
  const fallback = { remote: true };
  const fixture = voiceFixture({ createStream: (tracks) => { assert.equal(tracks[0], "remote-track"); return fallback; } });
  fixture.audio.play = async () => { throw new DOMException("Blocked", "NotAllowedError"); };
  await fixture.connection.connect();
  fixture.pc.ontrack({ streams: [], track: "remote-track" });
  assert.equal(fixture.audio.srcObject, fallback);
  await tick();
  assert.equal(fixture.connection.closed, true);
  assert.equal(fixture.track.stopped, 1);
  assert.equal(fixture.channel.readyState, "closed");
  assert.deepEqual(fixture.hangups, ["server-session"]);
  assert.match(fixture.errors[0].message, /bloqueó la reproducción/);
});

test("a forged business tool call with no transcript cannot reach the orchestrator", async () => {
  const fixture = voiceFixture();
  await fixture.connection.connect();
  fixture.connection.handleEvent({
    type: "response.function_call_arguments.done",
    name: "execute_sale",
    call_id: "bad-call",
    arguments: '{"confirmationToken":"forged"}',
  });
  await tick();
  assert.equal(fixture.requests.length, 0);
  assert.match(fixture.events[0].item.output, /no ejecutó ninguna acción/);
  fixture.connection.close();
});

test("interrupting and confirmation mute do not close the shared conversation", async () => {
  const fixture = voiceFixture();
  await fixture.connection.connect();
  fixture.connection.setMuted(true);
  assert.equal(fixture.track.enabled, false);
  fixture.connection.setMuted(false);
  fixture.connection.interrupt();
  assert.deepEqual(
    fixture.events.map((event) => event.type),
    ["response.cancel", "output_audio_buffer.clear"],
  );
  assert.equal(fixture.connection.closed, false);
  assert.equal(fixture.track.enabled, true);
  fixture.connection.close();
});

test("voice duration is capped at three minutes and connection failures release resources", async () => {
  const fixture = voiceFixture({
    createSession: async () => ({
      sdp: "answer",
      realtimeSessionId: "session",
      maxDurationSeconds: 9999,
    }),
  });
  await fixture.connection.connect();
  const hardLimit = fixture.timers.find((timer) => timer.duration === 180000);
  assert.ok(hardLimit);
  hardLimit.callback();
  assert.equal(fixture.connection.closed, true);
  assert.equal(fixture.states.at(-1), "ended");
  const failing = voiceFixture({
    createSession: async () => {
      throw new Error("Provider unavailable");
    },
  });
  await failing.connection.connect();
  assert.equal(failing.track.stopped, 1);
  assert.equal(failing.pc.closed, true);
  assert.equal(failing.states.at(-1), "error");
  assert.match(failing.errors[0].message, /Provider unavailable/);
});

test("default voice timers preserve the browser global receiver during setup and cleanup", async () => {
  const originalSet = globalThis.setTimeout,
    originalClear = globalThis.clearTimeout;
  const timers = [];
  globalThis.setTimeout = function (callback, delay) {
    assert.equal(
      this,
      globalThis,
      "browser timers require their global receiver",
    );
    const timer = { callback, delay, cleared: false };
    timers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = function (timer) {
    assert.equal(
      this,
      globalThis,
      "browser timer cleanup requires its global receiver",
    );
    if (timer) timer.cleared = true;
  };
  try {
    const fixture = voiceFixture({
      setTimer: undefined,
      clearTimer: undefined,
    });
    await fixture.connection.connect();
    assert.equal(fixture.connection.closed, false);
    assert.equal(fixture.errors.length, 0);
    assert.deepEqual(
      timers.map((t) => t.delay),
      [180000, 20000],
    );
    fixture.connection.close();
    assert.ok(timers.every((timer) => timer.cleared));
    assert.equal(fixture.track.stopped, 1);
    assert.equal(fixture.pc.closed, true);
    assert.equal(fixture.channel.readyState, "closed");
    assert.deepEqual(fixture.hangups, ["server-session"]);
  } finally {
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  }
});

test("closing while microphone permission is pending stops a late stream without opening a session", async () => {
  let release;
  let sessions = 0;
  const fixture = voiceFixture({
    mediaDevices: {
      getUserMedia: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
    createSession: async () => {
      sessions++;
    },
  });
  const connecting = fixture.connection.connect();
  fixture.connection.close();
  release(fixture.stream);
  await connecting;
  assert.equal(fixture.track.stopped, 1);
  assert.equal(sessions, 0);
});

test("speech result includes only the verified assistant answer and visual confirmation summary", () => {
  const result = speechResult({
    state: "ESPERANDO_CONFIRMACION",
    usage: { actualCostUsd: 20 },
    messages: [
      { role: "user", content: "private input" },
      { role: "assistant", content: "Resumen" },
    ],
    pendingAction: {
      summary: "Venta de dos unidades",
      confirmationToken: "secret",
      canonicalArgs: { private: true },
    },
  });
  assert.deepEqual(result, {
    state: "ESPERANDO_CONFIRMACION",
    messages: [{ content: "Resumen" }],
    pendingAction: {
      summary: "Venta de dos unidades",
      requiresVisualConfirmation: true,
    },
  });
});

test("supervision prepends older pages once and preserves current messages", () => {
  const first = { id: "one", role: "user", content: "Primer mensaje" };
  const duplicate = { id: "two", role: "assistant", content: "Versión vieja" };
  const current = { ...duplicate, content: "Respuesta actual" };
  const last = { id: "three", role: "user", content: "Último mensaje" };
  assert.deepEqual(
    prependHistoryMessages([first, duplicate], [current, last]),
    [first, current, last],
  );
});
