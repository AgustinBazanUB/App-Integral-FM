import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { can } from "../../permissions.js";
import { db } from "../../services/firebase.js";
import {
  applyExtensionCampaignEvent,
  applyExtensionCampaignSnapshot,
} from "./campaignService.js";

async function persistEmitterReleased(profile, campaignId) {
  if (!campaignId || !can(profile, "marketing", "whatsappSendToExtension")) return false;
  const reference = doc(db, "whatsappCampaigns", campaignId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) return false;
    transaction.set(reference, {
      emitterReleased: true,
      emitterReleasedAt: serverTimestamp(),
      extensionBlockReason: null,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    return true;
  });
}

export async function applyReconciledExtensionCampaignEvent(profile, message) {
  const emitterReleased = message?.payload?.emitterReleased === true;
  if (!emitterReleased) return applyExtensionCampaignEvent(profile, message);

  // Una liberación puede llegar con la misma sequence que el STOP anterior porque
  // no cambia el snapshot de campaña: sólo libera el slot del emisor. Forzamos la
  // reconciliación como evento local posterior y luego persistimos el marcador.
  const result = await applyExtensionCampaignEvent(profile, {
    ...message,
    sequence: 0,
  });
  await persistEmitterReleased(profile, message.campaignId);
  return { ...result, emitterReleased: true };
}

export async function applyReconciledExtensionCampaignSnapshot(profile, snapshot) {
  return applyExtensionCampaignSnapshot(profile, snapshot);
}
