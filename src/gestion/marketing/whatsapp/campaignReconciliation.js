import {
  applyExtensionCampaignEvent,
  applyExtensionCampaignSnapshot,
} from "./campaignService.js";
import { archiveReleasedCampaign } from "./campaignRelease.js";
import {
  EXTENSION_MESSAGE_TYPES,
  requestCampaignDelete,
} from "./extensionBridge.js";

async function archiveAfterEmitterRelease(profile, campaignId, reason) {
  return archiveReleasedCampaign(profile, campaignId, { reason });
}

async function releaseStoppedCampaign(profile, campaignId, reason) {
  const released = await requestCampaignDelete(campaignId);
  if (released?.payload?.emitterReleased !== true) {
    const error = new Error("La extensión detuvo la campaña, pero todavía no confirmó que el emisor quedó libre.");
    error.code = "CAMPAIGN_RELEASE_NOT_CONFIRMED";
    throw error;
  }
  return archiveAfterEmitterRelease(profile, campaignId, reason);
}

export async function applyReconciledExtensionCampaignEvent(profile, message) {
  if (!message?.campaignId) return { ignored: true };

  if (message?.payload?.emitterReleased === true) {
    return archiveAfterEmitterRelease(
      profile,
      message.campaignId,
      message.type === EXTENSION_MESSAGE_TYPES.cancelled
        ? "extension_cancelled_and_released"
        : "extension_released",
    );
  }

  // STOP ya no queda como un estado intermedio persistido en Firebase. Si la
  // extensión confirma que se detuvo, liberamos inmediatamente el slot y la
  // archivamos como cancelada. Esto evita depender de campos nuevos que las
  // reglas Firestore desplegadas todavía no aceptan y deja libre una campaña nueva.
  if (message.type === EXTENSION_MESSAGE_TYPES.stopped) {
    return releaseStoppedCampaign(profile, message.campaignId, "stop_then_release");
  }

  return applyExtensionCampaignEvent(profile, message);
}

export async function applyReconciledExtensionCampaignSnapshot(profile, snapshot) {
  if (!snapshot?.campaignId) return { ignored: true };

  if (snapshot.status === "stopped") {
    return releaseStoppedCampaign(profile, snapshot.campaignId, "stopped_snapshot_released");
  }

  return applyExtensionCampaignSnapshot(profile, snapshot);
}
