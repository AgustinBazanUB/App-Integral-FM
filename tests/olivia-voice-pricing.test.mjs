import test from "node:test";
import assert from "node:assert/strict";
import { MINI_VOICE_MODEL, MINI_TRANSCRIPTION_MODEL, realtimeTokenBreakdown, realtimeMiniCosts, aggregateVoiceCosts, formatOliviaCost } from "../src/shared/oliviaVoicePricing.mjs";
import { costForUsage } from "../src/shared/oliviaContracts.mjs";
const usage = () => ({ model: MINI_VOICE_MODEL, billingUnit: "realtime-tokens", measurement: "provider", observedTranscriptions: 1, transcriptionModel: MINI_TRANSCRIPTION_MODEL,
  transcriptionInputTokens: 100, transcriptionOutputTokens: 20, transcriptionTokens: 120,
  realtimeUsage: { textInput: 1000, audioInput: 100, cachedTextInput: 500, cachedAudioInput: 40, textOutput: 200, audioOutput: 300 } });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
test("Mini pricing separates cached audio/text from transcription and converts without rounding stored amounts", () => {
  const costs = realtimeMiniCosts(usage());
  close(costs.voiceUsd, 0.007422); close(costs.transcriptionUsd, 0.000225);
  const result = costForUsage(usage(), { officialDollarSellRate: 1000 });
  close(result.actualCostUsd, 0.007647); close(result.voiceCostArs, 7.7931); close(result.transcriptionCostArs, 0.23625); close(result.actualCostArs, 8.02935);
});
test("missing or inconsistent modality/cache counters stay unknown", () => {
  const u = { input_tokens: 100, output_tokens: 30, total_tokens: 130, input_token_details: { text_tokens: 40, audio_tokens: 60, cached_tokens: 20, cached_tokens_details: { text_tokens: 5, audio_tokens: 15 } }, output_token_details: { text_tokens: 10, audio_tokens: 20 } };
  assert.equal(realtimeTokenBreakdown(u).cachedAudioInput, 15);
  for (const change of [{ output_token_details: undefined }, { total_tokens: 129 }, { input_token_details: { ...u.input_token_details, cached_tokens_details: undefined } }, { input_token_details: { ...u.input_token_details, cached_tokens: -1 } }]) assert.equal(realtimeTokenBreakdown({ ...u, ...change }), null);
});
test("no spoken input has zero ASR cost, while incomplete, duration-only or unconfirmed measurements remain unknown", () => {
  assert.equal(realtimeMiniCosts({ ...usage(), observedTranscriptions: 0 }).transcriptionUsd, 0);
  for (const change of [{ measurement: "reserved-estimate" }, { transcriptionSeconds: 2 }, { transcriptionTokens: 121 }, { realtimeUsage: null }, { model: "arbitrary-model" }]) assert.equal(realtimeMiniCosts({ ...usage(), ...change }), null);
});
test("normal total sums all three components; development retains the split", () => {
  const live = { voiceMode: "realtime-mini", model: MINI_VOICE_MODEL, meteringStatus: "settled" };
  const result = aggregateVoiceCosts(live, { voiceCostUsd: 0.01, voiceCostArs: 10, transcriptionCostUsd: 0.001, transcriptionCostArs: 1 }, [{ actualCostUsd: 0.002, actualCostArs: 2 }, { actualCostUsd: 0.003, actualCostArs: 3 }]);
  assert.equal(result.complete, true); assert.equal(result.totalArs, 16); assert.equal(result.backend.queries, 2); assert.equal(result.backend.ars, 5);
});
test("pending and missing costs never appear as a complete or free total", () => {
  const live = { voiceMode: "realtime-mini", meteringStatus: "running" };
  const result = aggregateVoiceCosts(live, null, [{ actualCostUsd: 0.01, actualCostArs: 10 }, { actualCostUsd: null, actualCostArs: null }]);
  assert.equal(result.totalArs, null); assert.equal(result.knownArs, 10); assert.equal(result.backend.ars, null);
  for (const options of [{ truncated: true }, { backendPending: true }]) assert.equal(aggregateVoiceCosts({ ...live, meteringStatus: "settled" }, { voiceCostArs: 1, transcriptionCostArs: 2 }, [], options).totalArs, null);
});
test("Live bundled transcription is included once, with business queries added separately", () => {
  const result = aggregateVoiceCosts({ protocol: "live", meteringStatus: "settled" }, { actualCostArs: 100, actualCostUsd: 0.1 }, [{ actualCostArs: 3, actualCostUsd: 0.003 }]);
  assert.equal(result.transcription.included, true); assert.equal(result.totalArs, 103);
});
test("prices use one decimal in pesos, three significant digits in dollars and preserve tiny nonzero costs", () => {
  assert.match(formatOliviaCost(123.456), /123,5/);
  assert.equal(formatOliviaCost(0.004), "< $0,1");
  assert.match(formatOliviaCost(0), /0,0/);
  assert.match(formatOliviaCost(0.000123456, "USD"), /0,000123/);
  assert.equal(formatOliviaCost(null), "Sin medición");
});
