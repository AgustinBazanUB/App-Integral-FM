import test from "node:test";
import assert from "node:assert/strict";
import { defaultOliviaConfiguration, validateConfiguration } from "../src/shared/oliviaContracts.mjs";
import { fixture, start } from "./helpers/olivia-fixture.mjs";

test("the engine exposes natural voice but no GPT-Live conversation APIs", async () => {
  const f = fixture({ role: "admin" }), { conversationId } = await start(f);
  const configuration = validateConfiguration({ ...defaultOliviaConfiguration(), voiceProtocol: "live" });
  const state = await f.engine.state(f.session, conversationId);
  assert.equal(configuration.voiceProtocol, "chirp");
  for (const key of ["live", "liveTranscription", "realtime"]) assert.equal(key in configuration.profiles, false);
  assert.equal(state.voiceProtocol, "chirp");
  for (const key of ["realtimeTool", "realtimeTranscript", "voiceCosts", "recordSpeech"]) assert.equal(key in f.engine, false);
});

test("legacy voice session fields fail before a model call", async () => {
  const f = fixture({ role: "admin" }), { conversationId } = await start(f);
  for (const fields of [{ inputMode: "live" }, { inputMode: "realtime", realtimeSessionId: "old" }, { voiceSessionId: "old" }]) {
    await assert.rejects(f.engine.chat(f.session, { conversationId, requestId: `retired_${Math.random()}`, message: "Hola", ...fields }), { code: "voice-mode-retired" });
  }
  assert.equal(f.providerCalls(), 0);
});