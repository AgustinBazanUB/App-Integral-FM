import test from "node:test";
import assert from "node:assert/strict";
import { createOliviaEngine } from "../netlify/functions/_lib/olivia/engine.mjs";
import { transcribeAudio } from "../netlify/functions/_lib/olivia/voice.mjs";
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
test("dictation and natural voice turns use GPT Transcribe with Spanish and Flor Mía term hints", async () => {
  const f = await initialized(), form = f.form(f.conversationId);
  form.set("durationSeconds", "3.5");
  let sent;
  const result = await transcribeAudio({ ...f, form, provider: async (_path, upload) => { sent = upload; return { text: "Coratina en Pilar" }; } });
  assert.equal(sent.get("model"), "gpt-transcribe");
  assert.deepEqual(sent.getAll("languages[]"), ["es"]);
  assert.ok(sent.getAll("keywords[]").includes("Arbequina"));
  assert.equal(sent.has("languages"), false);
  assert.equal(sent.has("keywords"), false);
  assert.match(sent.get("prompt"), /español rioplatense/);
  assert.equal(usage(f).billingUnit, "audio-seconds");
  assert.equal(usage(f).durationSeconds, 3.5);
  assert.equal(result.usage.lastCost.estimated, true);
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
    const measuredDuration = providerUsage?.type === "duration";
    assert.equal(usage(f).measurement, measuredDuration ? "provider" : "reserved-estimate");
    assert.equal(usage(f).actualCostUsd, measuredDuration ? 10 * 0.0045 / 60 : null);
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
