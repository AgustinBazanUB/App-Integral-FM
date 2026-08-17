
import { WHATSAPP_PROTOCOL_VERSION } from "./campaignDomain.js";

export const EXTENSION_CHANNEL = "flor_mia_whatsapp_extension";

export const EXTENSION_TIMEOUTS = Object.freeze({
  ping: 5000,
  prepare: 30000,
  preflight: 35000,
  control: 35000,
});

export const EXTENSION_MESSAGE_TYPES = Object.freeze({
  ping: "FLORMIA_EXTENSION_PING",
  preflightRequest: "FLORMIA_EXTENSION_PREFLIGHT_REQUEST",
  status: "FLORMIA_EXTENSION_STATUS",
  prepare: "FLORMIA_CAMPAIGN_PREPARE",
  accepted: "FLORMIA_CAMPAIGN_ACCEPTED",
  started: "FLORMIA_CAMPAIGN_STARTED",
  progress: "FLORMIA_CAMPAIGN_PROGRESS",
  paused: "FLORMIA_CAMPAIGN_PAUSED",
  resumed: "FLORMIA_CAMPAIGN_RESUMED",
  completed: "FLORMIA_CAMPAIGN_COMPLETED",
  error: "FLORMIA_CAMPAIGN_ERROR",
  stopped: "FLORMIA_CAMPAIGN_STOPPED",
  cancelled: "FLORMIA_CAMPAIGN_CANCELLED",
  cancelRequest: "FLORMIA_CAMPAIGN_CANCEL_REQUEST",
  startRequest: "FLORMIA_CAMPAIGN_START",
  pauseRequest: "FLORMIA_CAMPAIGN_PAUSE",
  resumeRequest: "FLORMIA_CAMPAIGN_RESUME",
  stopRequest: "FLORMIA_CAMPAIGN_STOP",
  statusRequest: "FLORMIA_CAMPAIGN_STATUS_REQUEST",
});

const inboundTypes = new Set([
  EXTENSION_MESSAGE_TYPES.status,
  EXTENSION_MESSAGE_TYPES.accepted,
  EXTENSION_MESSAGE_TYPES.started,
  EXTENSION_MESSAGE_TYPES.progress,
  EXTENSION_MESSAGE_TYPES.paused,
  EXTENSION_MESSAGE_TYPES.resumed,
  EXTENSION_MESSAGE_TYPES.completed,
  EXTENSION_MESSAGE_TYPES.error,
  EXTENSION_MESSAGE_TYPES.stopped,
  EXTENSION_MESSAGE_TYPES.cancelled,
]);

const campaignEventTypes = new Set([
  EXTENSION_MESSAGE_TYPES.started,
  EXTENSION_MESSAGE_TYPES.progress,
  EXTENSION_MESSAGE_TYPES.paused,
  EXTENSION_MESSAGE_TYPES.resumed,
  EXTENSION_MESSAGE_TYPES.completed,
  EXTENSION_MESSAGE_TYPES.error,
  EXTENSION_MESSAGE_TYPES.stopped,
  EXTENSION_MESSAGE_TYPES.cancelled,
]);

const subscribers = new Set();
let listening = false;

const plainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const requestId = () => globalThis.crypto?.randomUUID?.() || `fm-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function validateExtensionEnvelope(event) {
  if (typeof window === "undefined") return null;
  if (event.source !== window || event.origin !== window.location.origin) return null;
  const data = event.data;
  if (!plainObject(data)) return null;
  if (data.channel !== EXTENSION_CHANNEL || data.protocolVersion !== WHATSAPP_PROTOCOL_VERSION) return null;
  if (!inboundTypes.has(data.type)) return null;
  if (data.requestId != null && typeof data.requestId !== "string") return null;
  if (data.replyTo != null && typeof data.replyTo !== "string") return null;
  if (data.campaignId != null && typeof data.campaignId !== "string") return null;
  if (data.sequence != null && (!Number.isInteger(data.sequence) || data.sequence < 0)) return null;
  if (data.payload != null && !plainObject(data.payload)) return null;
  if (campaignEventTypes.has(data.type) && !data.campaignId) return null;
  if (data.type === EXTENSION_MESSAGE_TYPES.status && typeof data.payload?.operational !== "boolean") return null;
  return data;
}

function onWindowMessage(event) {
  const envelope = validateExtensionEnvelope(event);
  if (!envelope) return;
  for (const subscriber of subscribers) subscriber(envelope);
}

function ensureListening() {
  if (listening || typeof window === "undefined") return;
  window.addEventListener("message", onWindowMessage);
  listening = true;
}

function maybeStopListening() {
  if (!listening || subscribers.size) return;
  window.removeEventListener("message", onWindowMessage);
  listening = false;
}

export function subscribeExtensionMessages(callback) {
  ensureListening();
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
    maybeStopListening();
  };
}

function postEnvelope(type, { payload = {}, campaignId = null, sequence = null, transfer = [] } = {}) {
  if (typeof window === "undefined") throw new Error("La integración con la extensión requiere un navegador.");
  const id = requestId();
  const envelope = {
    channel: EXTENSION_CHANNEL,
    protocolVersion: WHATSAPP_PROTOCOL_VERSION,
    type,
    requestId: id,
    ...(campaignId ? { campaignId } : {}),
    ...(Number.isInteger(sequence) ? { sequence } : {}),
    payload,
  };
  window.postMessage(envelope, window.location.origin, transfer);
  return id;
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 32_768;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function waitForReply(id, acceptedTypes, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer;
    const unsubscribe = subscribeExtensionMessages((message) => {
      if (message.replyTo !== id && message.requestId !== id) return;
      if (!acceptedTypes.has(message.type)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(message);
    });
    timer = window.setTimeout(() => {
      unsubscribe();
      reject(new Error(`La extensión no respondió dentro del tiempo esperado (${Math.round(timeoutMs / 1000)} s).`));
    }, timeoutMs);
  });
}

export async function pingWhatsAppExtension({ timeoutMs = EXTENSION_TIMEOUTS.ping } = {}) {
  try {
    const id = postEnvelope(EXTENSION_MESSAGE_TYPES.ping, { payload: { requestedAt: Date.now() } });
    const response = await waitForReply(id, new Set([EXTENSION_MESSAGE_TYPES.status]), timeoutMs);
    return {
      operational: response.payload.operational === true,
      message: response.payload.message || (response.payload.operational ? "La extensión está lista." : "La extensión requiere revisión."),
      extensionVersion: response.payload.extensionVersion || "",
      configuredLimit: Number(response.payload.configuredLimit || 0),
      sentToday: Number(response.payload.sentToday || 0),
      availableToday: Number(response.payload.availableToday || 0),
      errorCode: response.payload.errorCode || "",
      checkedAt: Date.now(),
    };
  } catch (error) {
    return {
      operational: false,
      message: error?.message || "Extensión no detectada o sin respuesta.",
      errorCode: "extension_unavailable",
      configuredLimit: 0,
      sentToday: 0,
      availableToday: 0,
      checkedAt: Date.now(),
    };
  }
}

export async function prepareCampaignForExtension(campaign, imageItems = [], { timeoutMs = EXTENSION_TIMEOUTS.prepare } = {}) {
  const transferredImages = [];
  for (let index = 0; index < imageItems.length; index += 1) {
    const item = imageItems[index];
    const data = await item.file.arrayBuffer();
    transferredImages.push({
      order: index + 1,
      name: item.file.name,
      type: item.file.type,
      size: item.file.size,
      dataBase64: arrayBufferToBase64(data),
    });
  }
  const id = postEnvelope(EXTENSION_MESSAGE_TYPES.prepare, {
    campaignId: campaign.campaignId,
    payload: {
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,
      createdBy: campaign.createdBy,
      recipients: campaign.recipients,
      message: campaign.message,
      imageCount: transferredImages.length,
      imageOrder: transferredImages.map((image) => image.order),
      images: transferredImages,
      totalRecipients: campaign.totalRecipients,
    },
  });
  const response = await waitForReply(id, new Set([EXTENSION_MESSAGE_TYPES.accepted, EXTENSION_MESSAGE_TYPES.error]), timeoutMs);
  if (response.type === EXTENSION_MESSAGE_TYPES.error) {
    throw new Error(response.payload?.message || "La extensión rechazó la campaña.");
  }
  return response;
}

export async function requestWhatsAppPreflight({ timeoutMs = EXTENSION_TIMEOUTS.preflight } = {}) {
  try {
    const id = postEnvelope(EXTENSION_MESSAGE_TYPES.preflightRequest, { payload: { requestedAt: Date.now() } });
    const response = await waitForReply(id, new Set([EXTENSION_MESSAGE_TYPES.status]), timeoutMs);
    return {
      operational: response.payload.operational === true,
      message: response.payload.message || (response.payload.operational ? "La extensión está lista." : "La extensión requiere revisión."),
      extensionVersion: response.payload.extensionVersion || "",
      configuredLimit: Number(response.payload.configuredLimit || 0),
      sentToday: Number(response.payload.sentToday || 0),
      availableToday: Number(response.payload.availableToday || 0),
      errorCode: response.payload.errorCode || "",
      checkedAt: Date.now(),
    };
  } catch (error) {
    return {
      operational: false,
      message: error?.message || "No fue posible ejecutar el diagnóstico de la extensión.",
      errorCode: "extension_preflight_failed",
      configuredLimit: 0,
      sentToday: 0,
      availableToday: 0,
      checkedAt: Date.now(),
    };
  }
}

async function requestCampaignControl(type, campaignId, acceptedTypes, { sequence, timeoutMs = EXTENSION_TIMEOUTS.control } = {}) {
  const id = postEnvelope(type, { campaignId, sequence, payload: { campaignId } });
  const response = await waitForReply(id, new Set([...acceptedTypes, EXTENSION_MESSAGE_TYPES.error]), timeoutMs);
  if (response.type === EXTENSION_MESSAGE_TYPES.error) {
    throw new Error(response.payload?.message || "La extensión rechazó el control de campaña.");
  }
  return response;
}

export function requestCampaignStart(campaignId, options = {}) {
  return requestCampaignControl(EXTENSION_MESSAGE_TYPES.startRequest, campaignId, [EXTENSION_MESSAGE_TYPES.started], options);
}

export function requestCampaignPause(campaignId, options = {}) {
  return requestCampaignControl(EXTENSION_MESSAGE_TYPES.pauseRequest, campaignId, [EXTENSION_MESSAGE_TYPES.paused], options);
}

export function requestCampaignResume(campaignId, options = {}) {
  return requestCampaignControl(EXTENSION_MESSAGE_TYPES.resumeRequest, campaignId, [EXTENSION_MESSAGE_TYPES.resumed, EXTENSION_MESSAGE_TYPES.started], options);
}

export function requestCampaignStop(campaignId, options = {}) {
  return requestCampaignControl(EXTENSION_MESSAGE_TYPES.stopRequest, campaignId, [EXTENSION_MESSAGE_TYPES.stopped, EXTENSION_MESSAGE_TYPES.cancelled], options);
}

export async function requestCampaignCancellation(campaignId, { timeoutMs = EXTENSION_TIMEOUTS.control } = {}) {
  return requestCampaignStop(campaignId, { timeoutMs });
}
