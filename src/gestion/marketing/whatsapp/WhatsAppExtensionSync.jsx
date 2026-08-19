
import { useEffect } from "react";
import { useAuth } from "../../AuthContext";
import { can } from "../../permissions";
import { applyExtensionCampaignEvent, applyExtensionCampaignSnapshot } from "./campaignService";
import { createCampaignEventQueue } from "./campaignEventQueue";
import { EXTENSION_MESSAGE_TYPES, subscribeExtensionMessages } from "./extensionBridge";

const campaignEvents = new Set([
  EXTENSION_MESSAGE_TYPES.started,
  EXTENSION_MESSAGE_TYPES.progress,
  EXTENSION_MESSAGE_TYPES.paused,
  EXTENSION_MESSAGE_TYPES.resumed,
  EXTENSION_MESSAGE_TYPES.completed,
  EXTENSION_MESSAGE_TYPES.error,
  EXTENSION_MESSAGE_TYPES.stopped,
  EXTENSION_MESSAGE_TYPES.cancelled,
]);

const enqueueCampaignState = createCampaignEventQueue((profile, message) => {
  if (message.type === EXTENSION_MESSAGE_TYPES.status) {
    return applyExtensionCampaignSnapshot(profile, message.payload?.campaign);
  }
  return applyExtensionCampaignEvent(profile, message);
});

export default function WhatsAppExtensionSync() {
  const { profile } = useAuth();
  useEffect(() => {
    if (!profile?.id || !can(profile, "marketing", "whatsappSendToExtension")) return undefined;
    return subscribeExtensionMessages((message) => {
      const snapshot = message.type === EXTENSION_MESSAGE_TYPES.status ? message.payload?.campaign : null;
      if (!campaignEvents.has(message.type) && !snapshot?.campaignId) return;
      const normalizedMessage = snapshot?.campaignId
        ? { ...message, campaignId: snapshot.campaignId }
        : message;
      enqueueCampaignState(profile, normalizedMessage).catch((error) => {
        console.error("No se pudo aplicar un estado de la extensión", error);
      });
    });
  }, [profile?.id]);
  return null;
}
