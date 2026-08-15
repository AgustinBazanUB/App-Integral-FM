
import { useEffect } from "react";
import { useAuth } from "../../AuthContext";
import { can } from "../../permissions";
import { applyExtensionCampaignEvent } from "./campaignService";
import { EXTENSION_MESSAGE_TYPES, subscribeExtensionMessages } from "./extensionBridge";

const campaignEvents = new Set([
  EXTENSION_MESSAGE_TYPES.started,
  EXTENSION_MESSAGE_TYPES.progress,
  EXTENSION_MESSAGE_TYPES.paused,
  EXTENSION_MESSAGE_TYPES.completed,
  EXTENSION_MESSAGE_TYPES.error,
  EXTENSION_MESSAGE_TYPES.cancelled,
]);

export default function WhatsAppExtensionSync() {
  const { profile } = useAuth();
  useEffect(() => {
    if (!profile?.id || !can(profile, "marketing", "whatsappSendToExtension")) return undefined;
    return subscribeExtensionMessages((message) => {
      if (!campaignEvents.has(message.type)) return;
      applyExtensionCampaignEvent(profile, message).catch((error) => {
        console.error("No se pudo aplicar un estado de la extensión", error);
      });
    });
  }, [profile?.id]);
  return null;
}
