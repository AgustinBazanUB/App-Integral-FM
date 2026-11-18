import test from "node:test";
import assert from "node:assert/strict";
import { costForUsage } from "../src/shared/oliviaContracts.mjs";

const config = { officialDollarSellRate: 1000, pricing: {} };
test("transcription remains metered while the retired character-synthesis tariff is absent", () => {
  assert.equal(costForUsage({ billingUnit: "audio-seconds", durationSeconds: 60 }, config).actualCostUsd, 0.0045);
  assert.equal(costForUsage({ billingUnit: "tts-characters", characters: 1000 }, config).actualCostUsd, null);
});

test("retired realtime token usage has no active tariff", () => {
  assert.equal(costForUsage({ billingUnit: "realtime-tokens", model: "gpt-realtime-2.1-mini", measurement: "provider" }, config).actualCostUsd, null);
});
