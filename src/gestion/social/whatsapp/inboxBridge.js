import { WHATSAPP_PROTOCOL_VERSION } from "../../marketing/whatsapp/campaignDomain";

export const WHATSAPP_INBOX_CHANNEL = "flor_mia_whatsapp_extension";

export const WHATSAPP_INBOX_TYPES = Object.freeze({
  getChatsRequest: "FLORMIA_INBOX_GET_CHATS_REQUEST",
  chats: "FLORMIA_INBOX_CHATS",
  getMessagesRequest: "FLORMIA_INBOX_GET_MESSAGES_REQUEST",
  messages: "FLORMIA_INBOX_MESSAGES",
  sendTextRequest: "FLORMIA_INBOX_SEND_TEXT_REQUEST",
  textSent: "FLORMIA_INBOX_TEXT_SENT",
  error: "FLORMIA_INBOX_ERROR",
});

const responseTypes = new Set([
  WHATSAPP_INBOX_TYPES.chats,
  WHATSAPP_INBOX_TYPES.messages,
  WHATSAPP_INBOX_TYPES.textSent,
  WHATSAPP_INBOX_TYPES.error,
]);

const plainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const createRequestId = () => globalThis.crypto?.randomUUID?.() || `fm-inbox-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function validateEnvelope(event) {
  if (typeof window === "undefined" || event.source !== window || event.origin !== window.location.origin) return null;
  const data = event.data;
  if (!plainObject(data)) return null;
  if (data.channel !== WHATSAPP_INBOX_CHANNEL || data.protocolVersion !== WHATSAPP_PROTOCOL_VERSION) return null;
  if (!responseTypes.has(data.type) || typeof data.replyTo !== "string" || !plainObject(data.payload)) return null;
  return data;
}

function request(type, payload, acceptedType, timeoutMs = 10_000) {
  if (typeof window === "undefined") return Promise.reject(new Error("WhatsApp Inbox requiere un navegador."));
  const requestId = createRequestId();
  const envelope = {
    channel: WHATSAPP_INBOX_CHANNEL,
    protocolVersion: WHATSAPP_PROTOCOL_VERSION,
    type,
    requestId,
    payload,
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      callback();
    };
    const onMessage = (event) => {
      const response = validateEnvelope(event);
      if (!response || response.replyTo !== requestId) return;
      if (response.type === WHATSAPP_INBOX_TYPES.error) {
        const error = new Error(response.payload.message || "No se pudo completar la operación de WhatsApp.");
        error.code = response.payload.code || "UNKNOWN_ERROR";
        error.recoverable = response.payload.recoverable !== false;
        if (plainObject(response.payload.details)) error.details = response.payload.details;
        finish(() => reject(error));
        return;
      }
      if (response.type !== acceptedType) return;
      finish(() => resolve(response.payload));
    };
    const timer = window.setTimeout(() => {
      const error = new Error("La extensión está instalada, pero el puente de WhatsApp Inbox no respondió. Actualizá Flor Mía WhatsApp Sender y recargá la Web App.");
      error.code = "INBOX_BRIDGE_NOT_AVAILABLE";
      finish(() => reject(error));
    }, timeoutMs);
    window.addEventListener("message", onMessage);
    window.postMessage(envelope, window.location.origin);
  });
}

export async function getWhatsAppInboxChats({ limit = 80 } = {}) {
  const payload = await request(
    WHATSAPP_INBOX_TYPES.getChatsRequest,
    { limit: Math.max(1, Math.min(100, Number(limit) || 80)) },
    WHATSAPP_INBOX_TYPES.chats,
    10_000,
  );
  return Array.isArray(payload.chats) ? payload.chats : [];
}

export async function getWhatsAppInboxMessages(chatId, { limit = 50 } = {}) {
  const payload = await request(
    WHATSAPP_INBOX_TYPES.getMessagesRequest,
    { chatId: String(chatId || ""), limit: Math.max(1, Math.min(100, Number(limit) || 50)) },
    WHATSAPP_INBOX_TYPES.messages,
    12_000,
  );
  return plainObject(payload.conversation) ? payload.conversation : { chat: null, messages: [], hasMore: false };
}

export async function sendWhatsAppInboxText(chatId, message) {
  const text = String(message || "").trim();
  if (!text) throw new Error("Escribí un mensaje antes de enviar.");
  if (text.length > 4096) throw new Error("El mensaje supera 4.096 caracteres.");
  const payload = await request(
    WHATSAPP_INBOX_TYPES.sendTextRequest,
    { chatId: String(chatId || ""), message: text },
    WHATSAPP_INBOX_TYPES.textSent,
    15_000,
  );
  return plainObject(payload.result) ? payload.result : null;
}
