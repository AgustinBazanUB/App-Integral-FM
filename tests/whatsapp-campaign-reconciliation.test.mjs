import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("una liberación confirmada se archiva con los campos de cancelación ya permitidos por Firestore", async () => {
  const reconciliation = await read("src/gestion/marketing/whatsapp/campaignReconciliation.js");
  const release = await read("src/gestion/marketing/whatsapp/campaignRelease.js");

  assert.match(reconciliation, /emitterReleased\s*===\s*true/);
  assert.match(reconciliation, /archiveReleasedCampaign/);
  assert.match(release, /status:\s*"cancelled"/);
  assert.match(release, /cancelledAt:\s*serverTimestamp\(\)/);
  assert.match(release, /cancelledBy:\s*profile\.id/);
  assert.match(release, /finishedAt:\s*serverTimestamp\(\)/);
  assert.doesNotMatch(release, /emitterReleasedAt:\s*serverTimestamp\(\)/);
});

test("STOP libera automáticamente el slot antes de archivar la campaña", async () => {
  const reconciliation = await read("src/gestion/marketing/whatsapp/campaignReconciliation.js");
  assert.match(reconciliation, /message\.type\s*===\s*EXTENSION_MESSAGE_TYPES\.stopped/);
  assert.match(reconciliation, /requestCampaignDelete\(campaignId\)/);
  assert.match(reconciliation, /CAMPAIGN_RELEASE_NOT_CONFIRMED/);
  assert.match(reconciliation, /stop_then_release/);
});

test("un snapshot stopped también se libera para no revivir una campaña vieja", async () => {
  const reconciliation = await read("src/gestion/marketing/whatsapp/campaignReconciliation.js");
  assert.match(reconciliation, /snapshot\.status\s*===\s*"stopped"/);
  assert.match(reconciliation, /stopped_snapshot_released/);
});

test("el sync global usa la reconciliación para eventos live y snapshots", async () => {
  const sync = await read("src/gestion/marketing/whatsapp/WhatsAppExtensionSync.jsx");
  assert.match(sync, /applyReconciledExtensionCampaignEvent/);
  assert.match(sync, /applyReconciledExtensionCampaignSnapshot/);
  assert.match(sync, /createCampaignEventQueue/);
});
