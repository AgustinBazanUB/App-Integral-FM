import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import handler, {
  monitorRealtime,
} from "../netlify/functions/olivia-voice-meter-background.mjs";
import {
  defaultOliviaConfiguration,
  quotaPeriod,
} from "../src/shared/oliviaContracts.mjs";

const start = new Date("2026-10-04T15:00:00Z");
const copy = (value) => structuredClone(value);
const flush = () => new Promise((resolve) => setImmediate(resolve));
const response = (id, input = 100, output = 20, extra = {}) => ({
  type: "response.done",
  response: {
    id,
    status: "completed",
    usage: {
      input_tokens: input,
      output_tokens: output,
      total_tokens: input + output,
    },
    ...extra,
  },
});
const transcription = (
  itemId = "audio_a",
  usage = {
    type: "tokens",
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  },
  contentIndex = 0,
) => ({
  type: "conversation.item.input_audio_transcription.completed",
  event_id: `event_${itemId}`,
  item_id: itemId,
  content_index: contentIndex,
  transcript: "private-input-transcript",
  usage,
});

function fixture({ hangupFails = false, role = "seller" } = {}) {
  let now = new Date(start),
    serial = Promise.resolve(),
    timerId = 0;
  const timers = new Map(),
    sockets = [],
    hangs = [],
    commits = [];
  const configuration = defaultOliviaConfiguration();
  configuration.pricing[configuration.profiles.realtime.model] = {
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 2,
  };
  const session = {
    uid: "user_a",
    authTime: start.getTime() / 1000,
    profile: {
      id: "user_a",
      active: true,
      role,
      allowedLocationIds: ["local_a"],
    },
  };
  const quota = { ...quotaPeriod("monthly", now), tokens: 100000 },
    budgetPath = `oliviaBudgets/user_a_${quota.key}`,
    requestPath = "oliviaRequests/user_a_voice_a";
  const reservation = { quota, budgetPath, requestPath, reservedTokens: 20000 };
  const documents = new Map(
    Object.entries({
      "oliviaConfiguration/global": configuration,
      "oliviaRealtime/live_a": {
        userId: "user_a",
        sessionBinding: String(session.authTime),
        conversationId: "conversation_a",
        callId: "rtc_call_a",
        requestId: "voice_a",
        status: "active",
        createdAt: start,
        expiresAt: new Date(start.getTime() + 180000),
        reservation,
      },
      [budgetPath]: {
        userId: "user_a",
        period: quota.key,
        usedTokens: 50,
        reservedTokens: 20000,
        requests: 1,
      },
      [requestPath]: {
        userId: "user_a",
        requestId: "voice_a",
        operation: "realtime",
        status: "running",
        reservedTokens: 20000,
        budgetPath,
        createdAt: start,
      },
    }),
  );
  function apply(writes) {
    const next = new Map(documents);
    for (const write of writes) {
      if (write.type === "create" && next.has(write.path))
        throw new Error("Duplicate creation");
      if (write.type === "update" && !next.has(write.path))
        throw new Error("Missing update target");
      next.set(
        write.path,
        write.type === "update"
          ? { ...next.get(write.path), ...copy(write.data) }
          : copy(write.data),
      );
    }
    documents.clear();
    for (const [path, data] of next) documents.set(path, data);
    commits.push(copy(writes));
  }
  const store = {
    get: async (path) =>
      documents.has(path)
        ? { ...copy(documents.get(path)), id: path.split("/").at(-1) }
        : null,
    commit: async (writes) => apply(writes),
    transaction(work) {
      const run = serial.then(async () => {
        const snapshot = new Map(
          [...documents].map(([path, value]) => [path, copy(value)]),
        );
        let committed = false;
        return work({
          getDocument: async (path) => {
            if (committed) throw new Error("Read after commit");
            return snapshot.has(path)
              ? { data: copy(snapshot.get(path)) }
              : null;
          },
          commitDocuments: async (writes) => {
            if (committed) throw new Error("Double commit");
            committed = true;
            apply(writes);
          },
        });
      });
      serial = run.catch(() => {});
      return run;
    },
  };
  class FakeSocket extends EventEmitter {
    constructor(url, options) {
      super();
      this.url = url;
      this.options = options;
      this.sent = [];
      sockets.push(this);
    }
    send(value) {
      this.sent.push(JSON.parse(value));
    }
    terminate() {
      this.terminated = true;
      this.emit("close", 1000);
    }
    provider(event) {
      this.emit("message", Buffer.from(JSON.stringify(event)));
    }
  }
  const dependencies = {
    session,
    realtimeSessionId: "live_a",
    store,
    env: { OPENAI_API_KEY: "private-server-fixture-key" },
    WebSocketImpl: FakeSocket,
    clock: () => new Date(now),
    setTimer: (callback, delay) => {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    hangup: async (callId) => {
      hangs.push(callId);
      if (hangupFails) throw new Error("Private transport failure detail");
    },
  };
  return {
    session,
    documents,
    commits,
    sockets,
    timers,
    hangs,
    dependencies,
    budgetPath,
    requestPath,
    start: (extra) => monitorRealtime({ ...dependencies, ...extra }),
    fireTimer(delay) {
      const [id, timer] =
        [...timers].find(([, timer]) => timer.delay === delay) || [];
      assert.ok(timer, `Missing timer ${delay}`);
      timers.delete(id);
      now = new Date(now.getTime() + delay);
      timer.callback();
    },
  };
}
async function open(f) {
  for (let attempts = 0; attempts < 15 && !f.sockets.length; attempts++)
    await flush();
  assert.equal(f.sockets.length, 1);
  const socket = f.sockets[0];
  socket.emit("open");
  for (
    let attempts = 0;
    attempts < 15 &&
    !f.documents.get("oliviaRealtime/live_a").meteringConnectedAt;
    attempts++
  )
    await flush();
  assert.ok(f.documents.get("oliviaRealtime/live_a").meteringConnectedAt);
  return socket;
}

test("server sideband authenticates privately and records exact provider usage only once", async () => {
  const f = fixture(),
    monitoring = f.start(),
    socket = await open(f);
  assert.equal(
    socket.url,
    "wss://api.openai.com/v1/realtime?call_id=rtc_call_a",
  );
  assert.equal(
    socket.options.headers.Authorization,
    "Bearer private-server-fixture-key",
  );
  assert.equal(socket.sent[0].session.max_output_tokens, 700);
  socket.provider({
    type: "response.output_audio.delta",
    delta: "private-audio-content",
  });
  socket.provider(
    response("response_a", 100, 20, {
      output: [
        {
          content: [
            { transcript: "private-transcript", text: "private-plaintext" },
          ],
        },
      ],
    }),
  );
  socket.provider(response("response_a", 100, 20));
  socket.provider(response("response_b", 50, 30));
  socket.provider(
    transcription("audio_a", {
      type: "tokens",
      input_tokens: 17,
      output_tokens: 9,
      total_tokens: 26,
    }),
  );
  socket.provider(
    transcription("audio_a", {
      type: "tokens",
      input_tokens: 17,
      output_tokens: 9,
      total_tokens: 26,
    }),
  );
  socket.emit("close", 1000);
  const result = await monitoring;
  assert.equal(result.status, "closed");
  assert.equal(result.measurement, "provider");
  assert.equal(result.totalTokens, 226);
  assert.deepEqual(f.hangs, ["rtc_call_a"]);
  assert.equal(f.documents.get(f.budgetPath).usedTokens, 276);
  assert.equal(f.documents.get(f.budgetPath).reservedTokens, 0);
  const usage = f.documents.get("oliviaUsage/user_a_voice_a");
  assert.equal(usage.inputTokens, 167);
  assert.equal(usage.outputTokens, 59);
  assert.equal(usage.observedResponses, 2);
  assert.equal(usage.observedTranscriptions, 1);
  assert.equal(usage.transcriptionTokens, 26);
  assert.equal(usage.transcriptionModel, "gpt-realtime-whisper");
  assert.equal(usage.actualCostUsd, null);
  const persisted = JSON.stringify([...f.documents]);
  for (const secret of [
    "private-audio-content",
    "private-transcript",
    "private-input-transcript",
    "private-plaintext",
    "private-server-fixture-key",
  ])
    assert.equal(persisted.includes(secret), false);
});

test("duplicate running and completed monitors neither attach nor charge twice", async () => {
  const f = fixture(),
    monitoring = f.start(),
    socket = await open(f);
  const duplicate = await f.start();
  assert.equal(duplicate.alreadyMonitored, true);
  assert.equal(duplicate.status, "running");
  assert.equal(f.sockets.length, 1);
  socket.provider(transcription());
  socket.provider(response("response_a"));
  socket.emit("close", 1000);
  await monitoring;
  const repeated = await f.start();
  assert.equal(repeated.status, "settled");
  assert.equal(f.documents.get(f.budgetPath).usedTokens, 170);
  assert.equal(f.hangs.length, 1);
  assert.equal(
    [...f.documents.keys()].filter((path) => path.startsWith("oliviaUsage/"))
      .length,
    1,
  );
});

test("quota boundary hangs up remotely without relying on browser timers", async () => {
  const f = fixture(),
    monitoring = f.start(),
    socket = await open(f);
  socket.provider(transcription());
  socket.provider(response("response_limit", 19500, 500));
  const result = await monitoring;
  assert.equal(result.totalTokens, 20000);
  assert.equal(result.measurement, "provider");
  assert.equal(
    f.documents.get("oliviaRealtime/live_a").closeReason,
    "quota-limit",
  );
  assert.equal(socket.terminated, true);
  assert.deepEqual(f.hangs, ["rtc_call_a"]);
  assert.equal(f.timers.size, 0);
});

test("180-second server deadline closes the provider even if the client stays connected", async () => {
  const f = fixture();
  f.documents.get("oliviaRealtime/live_a").expiresAt = new Date(
    start.getTime() + 1000000,
  );
  const monitoring = f.start(),
    socket = await open(f);
  socket.provider(transcription());
  socket.provider(response("response_a"));
  f.fireTimer(180000);
  const result = await monitoring;
  assert.equal(result.status, "closed");
  assert.equal(result.measurement, "provider");
  assert.equal(
    f.documents.get("oliviaRealtime/live_a").closeReason,
    "duration-limit",
  );
  assert.equal(f.hangs.length, 1);
});

test("connection timeout and provider/socket errors reserve a conservative honest bill", async () => {
  for (const failure of ["timeout", "socket", "provider"]) {
    const f = fixture(),
      monitoring = f.start();
    let socket;
    if (failure === "timeout") {
      for (let i = 0; i < 15 && !f.sockets.length; i++) await flush();
      f.fireTimer(10000);
    } else {
      socket = await open(f);
      socket.provider(response("response_a"));
      if (failure === "socket")
        socket.emit("error", new Error("private-error-content"));
      else
        socket.provider({
          type: "error",
          error: { message: "private-error-content" },
        });
    }
    const result = await monitoring;
    assert.equal(result.measurement, "reserved-estimate");
    assert.equal(result.totalTokens, 20000);
    assert.equal(f.documents.get(f.budgetPath).reservedTokens, 0);
    assert.equal(f.documents.get(f.budgetPath).usedTokens, 20050);
    assert.equal(
      f.documents.get("oliviaUsage/user_a_voice_a").actualCostUsd,
      null,
    );
    assert.equal(
      JSON.stringify([...f.documents]).includes("private-error-content"),
      false,
    );
    assert.equal(f.hangs.length, 1);
  }
});

test("missing or malformed usage cannot be treated as free actual usage", async () => {
  for (const usage of [
    null,
    { input_tokens: -1, output_tokens: 0, total_tokens: -1 },
    { input_tokens: 10, output_tokens: 20, total_tokens: 5 },
  ]) {
    const f = fixture(),
      monitoring = f.start(),
      socket = await open(f);
    socket.provider({
      type: "response.done",
      response: { id: "response_a", usage },
    });
    socket.emit("close", 1000);
    const result = await monitoring;
    assert.equal(result.measurement, "reserved-estimate");
    assert.equal(result.totalTokens, 20000);
  }
});

test("an unfinished response makes duration settlement conservative", async () => {
  const f = fixture(),
    monitoring = f.start(),
    socket = await open(f);
  socket.provider(response("response_a"));
  socket.provider({
    type: "response.created",
    response: { id: "in_progress", max_output_tokens: 700 },
  });
  f.fireTimer(180000);
  const result = await monitoring;
  assert.equal(result.measurement, "reserved-estimate");
  assert.equal(result.totalTokens, 20000);
});

test("duration-billed input transcription records seconds once and never invents a token bill", async () => {
  const f = fixture(),
    monitoring = f.start(),
    socket = await open(f);
  socket.provider({ type: "input_audio_buffer.committed", item_id: "audio_a" });
  socket.provider(transcription("audio_a", { type: "duration", seconds: 1.5 }));
  socket.provider(transcription("audio_a", { type: "duration", seconds: 1.5 }));
  socket.provider(
    transcription("audio_b", { type: "duration", seconds: 2.25 }),
  );
  socket.provider(response("response_a"));
  socket.emit("close", 1000);
  const result = await monitoring,
    usage = f.documents.get("oliviaUsage/user_a_voice_a");
  assert.equal(result.measurement, "reserved-estimate");
  assert.equal(result.totalTokens, 20000);
  assert.equal(usage.transcriptionSeconds, 3.75);
  assert.equal(usage.observedTranscriptions, 2);
  assert.equal(usage.transcriptionTokens, 0);
  assert.equal(usage.actualCostUsd, null);
});

test("input transcription token usage contributes to the same hard quota and deduplicates by content part", async () => {
  const f = fixture(),
    monitoring = f.start(),
    socket = await open(f);
  socket.provider(response("response_a", 18000, 500));
  socket.provider(
    transcription("audio_a", {
      type: "tokens",
      input_tokens: 1000,
      output_tokens: 0,
      total_tokens: 1000,
    }),
  );
  socket.provider(
    transcription("audio_a", {
      type: "tokens",
      input_tokens: 1000,
      output_tokens: 0,
      total_tokens: 1000,
    }),
  );
  socket.provider(
    transcription(
      "audio_a",
      {
        type: "tokens",
        input_tokens: 500,
        output_tokens: 0,
        total_tokens: 500,
      },
      1,
    ),
  );
  const result = await monitoring;
  assert.equal(result.totalTokens, 20000);
  assert.equal(result.measurement, "provider");
  assert.equal(
    f.documents.get("oliviaRealtime/live_a").closeReason,
    "quota-limit",
  );
  assert.equal(
    f.documents.get("oliviaUsage/user_a_voice_a").transcriptionTokens,
    1500,
  );
  assert.equal(f.hangs.length, 1);
});

test("missing, malformed, failed or unfinished input transcription uses conservative settlement", async () => {
  for (const mode of ["missing", "malformed", "failed", "pending"]) {
    const f = fixture(),
      monitoring = f.start(),
      socket = await open(f);
    socket.provider(response("response_a"));
    if (mode === "malformed")
      socket.provider(
        transcription("audio_a", {
          type: "tokens",
          input_tokens: 10,
          output_tokens: 2,
          total_tokens: 1,
        }),
      );
    if (mode === "pending") {
      socket.provider(transcription());
      socket.provider({
        type: "input_audio_buffer.committed",
        item_id: "audio_pending",
      });
    }
    if (mode === "failed")
      socket.provider({
        type: "conversation.item.input_audio_transcription.failed",
        item_id: "audio_a",
        error: { message: "private-transcription-failure" },
      });
    else socket.emit("close", 1000);
    const result = await monitoring;
    assert.equal(result.measurement, "reserved-estimate");
    assert.equal(result.totalTokens, 20000);
    assert.equal(
      f.documents.get("oliviaUsage/user_a_voice_a").actualCostUsd,
      null,
    );
    assert.equal(
      JSON.stringify([...f.documents]).includes(
        "private-transcription-failure",
      ),
      false,
    );
  }
});

test("client attempts to remove the output limit immediately close the provider", async () => {
  const f = fixture(),
    monitoring = f.start(),
    socket = await open(f);
  socket.provider({
    type: "session.updated",
    session: { max_output_tokens: "inf" },
  });
  const result = await monitoring;
  assert.equal(result.status, "closed");
  assert.equal(
    f.documents.get("oliviaRealtime/live_a").closeReason,
    "realtime-output-limit",
  );
  assert.equal(f.hangs.length, 1);
});

test("wrong owner, changed login and forged reservation paths cannot attach or settle", async () => {
  for (const mode of ["owner", "login", "reservation"]) {
    const f = fixture();
    const live = f.documents.get("oliviaRealtime/live_a");
    if (mode === "owner") live.userId = "other";
    if (mode === "login") live.sessionBinding = "different_login";
    if (mode === "reservation")
      live.reservation.requestPath = "oliviaRequests/other_request";
    await assert.rejects(f.start(), {
      code: mode === "reservation" ? "realtime-invalid" : "permission-denied",
    });
    assert.equal(f.sockets.length, 0);
    assert.equal(f.hangs.length, 0);
    assert.equal(f.commits.length, 0);
    assert.equal(f.documents.get(f.budgetPath).reservedTokens, 20000);
  }
});

test("expired jobs close immediately and settle the reservation without attaching", async () => {
  const f = fixture();
  f.documents.get("oliviaRealtime/live_a").expiresAt = new Date(
    start.getTime() - 1,
  );
  const result = await f.start();
  assert.equal(result.status, "closed");
  assert.equal(result.measurement, "reserved-estimate");
  assert.equal(f.sockets.length, 0);
  assert.equal(f.documents.get(f.budgetPath).reservedTokens, 0);
});

test("failed remote hangup remains active and expired so cleanup can retry", async () => {
  const f = fixture({ hangupFails: true }),
    monitoring = f.start(),
    socket = await open(f);
  socket.provider(response("response_a"));
  socket.emit("close", 1000);
  const result = await monitoring,
    live = f.documents.get("oliviaRealtime/live_a");
  assert.equal(result.status, "close_pending");
  assert.equal(live.status, "active");
  assert.equal(live.closeReason, "realtime-close-error");
  assert.ok(live.closeRequestedAt instanceof Date);
  assert.ok(live.expiresAt <= live.closeRequestedAt);
  assert.equal(result.measurement, "reserved-estimate");
});

test("background endpoint requires Firebase authentication before handling monitor data", async () => {
  const response = await handler(
    new Request(
      "https://app.example/.netlify/functions/olivia-voice-meter-background",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ realtimeSessionId: "live_a" }),
      },
    ),
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "unauthenticated");
});


test("administrator voice exceeds the seller token allocation and still closes on hangup", async () => {
  const f = fixture({ role: "general_admin" }), monitoring = f.start(), socket = await open(f);
  socket.provider(transcription());
  socket.provider(response("admin_large_response", 30000, 500));
  await flush();
  assert.equal(f.hangs.length, 0);
  socket.emit("close", 1000);
  const result = await monitoring;
  assert.equal(result.totalTokens, 30500);
  assert.equal(f.documents.get("oliviaRealtime/live_a").closeReason, "provider-closed");
  assert.equal(f.documents.get(f.budgetPath).usedTokens, 30550);
});
