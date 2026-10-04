import test from "node:test";
import assert from "node:assert/strict";
import { createOliviaEngine } from "../netlify/functions/_lib/olivia/engine.mjs";
import {
  transcribeAudio,
  createRealtime,
  stopRealtime,
} from "../netlify/functions/_lib/olivia/voice.mjs";
import { defaultOliviaConfiguration } from "../src/shared/oliviaContracts.mjs";
function fixture() {
  const now = new Date("2026-10-04T15:00:00Z"),
    env = { OPENAI_API_KEY: "fixture-backend-secret" },
    session = {
      uid: "seller",
      authTime: now.getTime() / 1000,
      idToken: "fixture-firebase-token",
      profile: { active: true, role: "seller", name: "Ana" },
    },
    configuration = defaultOliviaConfiguration(),
    docs = new Map();
  docs.set("users/seller", session.profile);
  configuration.defaultQuota.tokens = 1000000;
  docs.set("oliviaConfiguration/global", configuration);
  const apply = (writes) => {
    for (const w of writes) {
      if (w.type === "create" && docs.has(w.path))
        throw new Error("Duplicate create");
      docs.set(
        w.path,
        w.type === "update"
          ? { ...docs.get(w.path), ...structuredClone(w.data) }
          : structuredClone(w.data),
      );
    }
  };
  const store = {
    get: async (path) =>
      docs.has(path)
        ? { ...structuredClone(docs.get(path)), id: path.split("/").at(-1) }
        : null,
    query: async () => [],
    commit: async (writes) => apply(writes),
    transaction: async (work) =>
      work({
        getDocument: async (path) =>
          docs.has(path) ? { data: structuredClone(docs.get(path)) } : null,
        commitDocuments: async (writes) => apply(writes),
      }),
  };
  const engine = createOliviaEngine({ store, env, clock: () => now });
  const form = (id) => {
    const f = new FormData();
    f.set("conversationId", id);
    f.set("requestId", "transcription");
    f.set(
      "file",
      new Blob(["a".repeat(256)], { type: "audio/webm" }),
      "voice.webm",
    );
    return f;
  };
  return { now, env, session, configuration, docs, store, engine, form };
}
async function initialized() {
  const f = fixture();
  f.conversationId = (await f.engine.state(f.session)).conversationId;
  return f;
}
const usage = (f) =>
  [...f.docs].find(([p]) => p.startsWith("oliviaUsage/"))?.[1];

test("transcription rejects foreign conversations and invalid audio before provider or quota", async () => {
  const f = await initialized();
  let calls = 0;
  const run = (form) =>
    transcribeAudio({
      ...f,
      form,
      provider: async () => {
        calls++;
        return { text: "Hola" };
      },
    });
  const bad = f.form(f.conversationId);
  bad.set("file", new Blob(["not audio"], { type: "text/plain" }), "file.txt");
  await assert.rejects(run(bad), { code: "invalid-audio" });
  const foreign = f.form("other");
  await assert.rejects(run(foreign), { code: "conversation-not-found" });
  await assert.rejects(
    transcribeAudio({
      ...f,
      session: { ...f.session, authTime: f.session.authTime + 1 },
      form: f.form(f.conversationId),
    }),
    { code: "session-changed" },
  );
  assert.equal(calls, 0);
  assert.equal(usage(f), undefined);
});
for (const providerUsage of [
  undefined,
  { type: "duration", seconds: 10 },
  { input_tokens: -1, output_tokens: 0, total_tokens: -1 },
])
  test(`transcription records unknown or duration usage conservatively: ${JSON.stringify(providerUsage)}`, async () => {
    const f = await initialized();
    const result = await transcribeAudio({
      ...f,
      form: f.form(f.conversationId),
      provider: async () => ({ text: "Hola Olivia", usage: providerUsage }),
    });
    assert.equal(result.text, "Hola Olivia");
    assert.equal(usage(f).totalTokens, 6000);
    assert.equal(usage(f).measurement, "reserved-estimate");
    assert.equal(usage(f).actualCostUsd, null);
    assert.deepEqual(Object.keys(result.usage).sort(), [
      "lastCost",
      "period",
      "remainingPercent",
      "renewsAt",
    ]);
    assert.equal(JSON.stringify(result).includes(f.env.OPENAI_API_KEY), false);
    assert.equal(
      [...f.docs].some(([p]) => p.includes("/messages/")),
      false,
    );
  });
test("measured transcription is idempotent and empty text never becomes a chat input", async () => {
  const f = await initialized();
  let calls = 0;
  const provider = async () => {
    calls++;
    return {
      text: " ",
      usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 },
    };
  };
  await assert.rejects(
    transcribeAudio({ ...f, form: f.form(f.conversationId), provider }),
    { code: "audio-unintelligible" },
  );
  assert.equal(usage(f).totalTokens, 25);
  await assert.rejects(
    transcribeAudio({ ...f, form: f.form(f.conversationId), provider }),
    { code: "request-already-used" },
  );
  assert.equal(calls, 1);
});
async function realtimeFixture({
  monitorStatus = 202,
  connected = true,
  answer = "v=0\r\nanswer",
  hangupFails = false,
} = {}) {
  const f = await initialized(),
    calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/realtime/calls"))
      return new Response(answer, {
        status: 201,
        headers: {
          location: "https://api.openai.com/v1/realtime/calls/rtc_fixture",
        },
      });
    if (url.endsWith("/olivia-voice-meter-background")) {
      if (connected) {
        const [path] = [...f.docs].find(([p]) =>
          p.startsWith("oliviaRealtime/"),
        );
        f.docs.set(path, {
          ...f.docs.get(path),
          meteringConnectedAt: f.now,
          meteringStatus: "running",
        });
      }
      return new Response(null, { status: monitorStatus });
    }
    if (url.endsWith("/hangup"))
      return new Response(null, { status: hangupFails ? 503 : 200 });
    throw new Error("Unexpected URL");
  };
  return {
    ...f,
    calls,
    fetchImpl,
    applicationOrigin: "https://fixture.invalid",
    waitImpl: async () => {},
    body: {
      conversationId: f.conversationId,
      requestId: "realtime",
      sdp: "v=0\r\noffer",
    },
  };
}
test("realtime sends answer only after trusted sideband connects and retains all keys server-side", async () => {
  const f = await realtimeFixture(),
    result = await createRealtime(f),
    live = f.docs.get(`oliviaRealtime/${result.realtimeSessionId}`);
  assert.equal(result.sdp, "v=0\r\nanswer");
  assert.equal(result.maxDurationSeconds, 180);
  assert.equal(live.model, f.configuration.profiles.realtime.model);
  assert.equal(
    live.transcriptionModel,
    f.configuration.profiles.liveTranscription.model,
  );
  assert.equal(usage(f), undefined);
  assert.equal(
    JSON.stringify(result).includes("fixture-backend-secret"),
    false,
  );
  const session = JSON.parse(f.calls[0].init.body.get("session"));
  assert.equal(session.audio.input.turn_detection.create_response, false);
  assert.deepEqual(session.output_modalities, ["audio"]);
  assert.match(result.voiceGreeting, /Olivia/);
  await assert.rejects(
    stopRealtime({
      ...f,
      session: { ...f.session, uid: "other" },
      body: {
        realtimeSessionId: result.realtimeSessionId,
        conversationId: f.conversationId,
      },
    }),
    { code: "permission-denied" },
  );
  await stopRealtime({
    ...f,
    body: {
      realtimeSessionId: result.realtimeSessionId,
      conversationId: f.conversationId,
    },
  });
  assert.equal(
    f.docs.get(`oliviaRealtime/${result.realtimeSessionId}`).status,
    "closed",
  );
});
for (const options of [
  { connected: false },
  { monitorStatus: 503 },
  { answer: "<html>Error</html>" },
])
  test(`realtime refuses uncontrolled or invalid provider session: ${JSON.stringify(options)}`, async () => {
    const f = await realtimeFixture(options);
    await assert.rejects(createRealtime(f), (e) =>
      ["realtime-monitor-unavailable", "realtime-invalid"].includes(e.code),
    );
    assert.ok(f.calls.some((c) => c.url.endsWith("/hangup")));
    assert.equal(usage(f).totalTokens, 20000);
    assert.equal(usage(f).actualCostUsd, null);
  });
test("failed remote hangup keeps expired session active for cleanup retry", async () => {
  const f = await realtimeFixture({ connected: false, hangupFails: true });
  await assert.rejects(createRealtime(f), {
    code: "realtime-monitor-unavailable",
  });
  const live = [...f.docs].find(([p]) => p.startsWith("oliviaRealtime/"))[1];
  assert.equal(live.status, "active");
  assert.ok(live.closeRequestedAt);
});
