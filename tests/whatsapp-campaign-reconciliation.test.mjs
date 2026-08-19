import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("la liberación del emisor se persiste aunque reuse la sequence del STOP", async () => {
  const reconciliation = await read("src/gestion/marketing/whatsapp/campaignReconciliation.js");
  assert.match(reconciliation, /emitterReleased:\s*true/);
  assert.match(reconciliation, /sequence:\s*0/);
  assert.match(reconciliation, /emitterReleasedAt:\s*serverTimestamp\(\)/);
  assert.match(reconciliation, /extensionBlockReason:\s*null/);
});

test("el sync global usa la reconciliación para eventos live y snapshots", async () => {
  const sync = await read("src/gestion/marketing/whatsapp/WhatsAppExtensionSync.jsx");
  assert.match(sync, /applyReconciledExtensionCampaignEvent/);
  assert.match(sync, /applyReconciledExtensionCampaignSnapshot/);
  assert.match(sync, /createCampaignEventQueue/);
});
