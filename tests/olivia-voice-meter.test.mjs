import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { closeExpiredVoiceSessions } from "../netlify/functions/olivia-voice-cleanup.mjs";
import { reserveUsage } from "../netlify/functions/_lib/olivia/usage.mjs";
import { defaultOliviaConfiguration } from "../src/shared/oliviaContracts.mjs";
import { fixture } from "./helpers/olivia-fixture.mjs";

const source = await readFile(new URL("../netlify/functions/olivia-voice-meter-background.mjs", import.meta.url), "utf8");
function retiredEndpoint() {
  const calls = [];
  const context = vm.createContext({
    Response,
    oliviaSession: async () => { calls.push("auth"); return {}; },
    json: (body, status = 200) => new Response(JSON.stringify(body), { status }),
    errorResponse: (error) => new Response(JSON.stringify({ code: error.code }), { status: error.status || 500 }),
  });
  const runnable = source.replace(/^import .*;\r?\n/gm, "").replace("export default async function handler", "globalThis.handler = async function handler");
  vm.runInContext(runnable, context);
  return { calls, handler: context.handler };
}

test("the legacy meter endpoint authenticates and returns 410 without connecting to a provider", async () => {
  const endpoint = retiredEndpoint();
  const response = await endpoint.handler(new Request("https://preview.test/.netlify/functions/olivia-voice-meter-background", { method: "POST" }));
  assert.equal(response.status, 410);
  assert.equal((await response.json()).code, "voice-mode-retired");
  assert.deepEqual(endpoint.calls, ["auth"]);
});

test("scheduled cleanup hangs up expired legacy calls and releases their reservation at unknown cost", async () => {
  const f = fixture({ role: "admin" }), configuration = defaultOliviaConfiguration();
  const reservation = await reserveUsage({ store: f.store, session: f.session, configuration, requestId: "legacy_voice", operation: "realtime", reservedTokens: 20000, now: f.clock() });
  f.documents.set("oliviaRealtime/legacy_voice", { userId: f.session.uid, callId: "live_fixture", status: "active", expiresAt: new Date(0), model: "retired-voice-session", reservation });
  const urls = [];
  const result = await closeExpiredVoiceSessions({ store: f.store, env: { OPENAI_API_KEY: "fixture" }, now: f.clock(), fetchImpl: async (url) => { urls.push(url); return new Response(null, { status: 200 }); } });
  assert.deepEqual(result, { closed: 1, failed: 0 });
  assert.deepEqual(urls, ["https://api.openai.com/v1/live/sessions/live_fixture/hangup"]);
  assert.equal(f.documents.get("oliviaRealtime/legacy_voice").meteringStatus, "settled");
  assert.equal(f.documents.get(reservation.budgetPath).reservedTokens, 0);
  assert.equal(f.documents.get(reservation.budgetPath).usedTokens, 20000);
  const usage = f.documents.get("oliviaUsage/user_a_legacy_voice");
  assert.equal(usage.measurement, "unconfirmed");
  assert.equal(usage.actualCostUsd, null);
  assert.equal(usage.success, false);
});

test("failed remote close leaves the legacy session active for the next cleanup retry", async () => {
  const f = fixture({ role: "admin" });
  f.documents.set("oliviaRealtime/legacy_a", { callId: "rtc_fixture", status: "active", expiresAt: new Date(0) });
  const result = await closeExpiredVoiceSessions({ store: f.store, env: { OPENAI_API_KEY: "fixture" }, now: f.clock(), fetchImpl: async () => new Response(null, { status: 503 }) });
  assert.deepEqual(result, { closed: 0, failed: 1 });
  assert.equal(f.documents.get("oliviaRealtime/legacy_a").status, "active");
});