import assert from "node:assert/strict";
import test from "node:test";

import { createCampaignEventQueue } from "../src/gestion/marketing/whatsapp/campaignEventQueue.js";

test("serializes extension events for the same campaign", async () => {
  const applied = [];
  let active = 0;
  let maxActive = 0;
  const enqueue = createCampaignEventQueue(async (_profile, message) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, message.delay));
    applied.push(message.sequence);
    active -= 1;
  });

  await Promise.all([
    enqueue({}, { campaignId: "campaign-1", sequence: 1, delay: 15 }),
    enqueue({}, { campaignId: "campaign-1", sequence: 2, delay: 0 }),
    enqueue({}, { campaignId: "campaign-1", sequence: 3, delay: 0 }),
  ]);

  assert.deepEqual(applied, [1, 2, 3]);
  assert.equal(maxActive, 1);
});

test("continues the campaign queue after one event fails", async () => {
  const applied = [];
  const enqueue = createCampaignEventQueue(async (_profile, message) => {
    if (message.sequence === 1) throw new Error("transient failure");
    applied.push(message.sequence);
  });

  const first = enqueue({}, { campaignId: "campaign-1", sequence: 1 });
  const second = enqueue({}, { campaignId: "campaign-1", sequence: 2 });

  await assert.rejects(first, /transient failure/);
  await second;
  assert.deepEqual(applied, [2]);
});
