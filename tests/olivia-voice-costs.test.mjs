import test from "node:test";
import assert from "node:assert/strict";
import { fixture, start } from "./helpers/olivia-fixture.mjs";
async function initialized() {
  const f = fixture(), state = await start(f);
  f.body = { conversationId: state.conversationId, realtimeSessionId: "voice_a" };
  f.documents.set("oliviaRealtime/voice_a", { userId: f.session.uid, sessionBinding: String(f.session.authTime), conversationId: state.conversationId, status: "active", expiresAt: new Date(f.clock().getTime() + 180000), voiceMode: "realtime-mini", meteringStatus: "settled", requestId: "voice_start" });
  f.documents.set("oliviaUsage/user_a_voice_start", { userId: f.session.uid, voiceCostArs: 10, transcriptionCostArs: 1, voiceCostUsd: 0.01, transcriptionCostUsd: 0.001 });
  return f;
}
test("voice cost endpoint authenticates owner, conversation and login; closed sessions remain reviewable", async () => {
  const f = await initialized();
  for (const session of [{ ...f.session, uid: "other" }, { ...f.session, authTime: f.session.authTime + 1 }]) await assert.rejects(f.engine.voiceCosts(session, f.body), { code: "permission-denied" });
  await assert.rejects(f.engine.voiceCosts(f.session, { ...f.body, conversationId: "other" }), { code: "permission-denied" });
  f.documents.get("oliviaRealtime/voice_a").status = "closed";
  const { voiceCosts } = await f.engine.voiceCosts(f.session, f.body);
  assert.equal(voiceCosts.totalArs, 11);
  assert.equal(JSON.stringify(voiceCosts).includes(f.session.uid), false);
});
test("spoken and typed queries link only to a validated active voice session and cost totals exclude unrelated usage", async () => {
  const f = await initialized();
  for (const [requestId, extra] of [["spoken", { inputMode: "realtime", realtimeSessionId: "voice_a" }], ["typed", { inputMode: "text", voiceSessionId: "voice_a" }]]) {
    await f.engine.chat(f.session, { conversationId: f.body.conversationId, requestId, message: "Hola Olivia", ...extra });
    assert.equal(f.documents.get(`oliviaUsage/user_a_${requestId}`).realtimeSessionId, "voice_a");
    f.advance(2000);
  }
  f.documents.set("oliviaUsage/unrelated", { userId: f.session.uid, actualCostArs: 999999 });
  f.documents.set("oliviaUsage/foreign", { userId: "other", conversationId: f.body.conversationId, realtimeSessionId: "voice_a", actualCostArs: 999999 });
  assert.equal((await f.engine.voiceCosts(f.session, f.body)).voiceCosts.backend.queries, 2);
  await assert.rejects(f.engine.chat(f.session, { conversationId: f.body.conversationId, requestId: "invalid", message: "Hola", voiceSessionId: "foreign" }), { code: "realtime-expired" });
  f.documents.get("oliviaRealtime/voice_a").status = "closed";
  await assert.rejects(f.engine.chat(f.session, { conversationId: f.body.conversationId, requestId: "closed", message: "Hola", voiceSessionId: "voice_a" }), { code: "realtime-expired" });
});
