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
  retryRequest: "FLORMIA_CAMPAIGN_RETRY",
  retryFailedRequest: "FLORMIA_CAMPAIGN_RETRY_FAILED",
  stopRequest: "FLORMIA_CAMPAIGN_STOP",
  deleteRequest: "FLORMIA_CAMPAIGN_DELETE",
  statusRequest: "FLORMIA_CAMPAIGN_STATUS_REQUEST",
  diagnosticReportRequest: "FLORMIA_DIAGNOSTIC_REPORT_REQUEST",
  diagnosticReport: "FLORMIA_DIAGNOSTIC_REPORT",
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
  EXTENSION_MESSAGE_TYPES.diagnosticReport,
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
let pingInFlight = null;

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

function emitLocalEnvelope(message) {
  for (const subscriber of subscribers) subscriber(message);
  return message;
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

function abortError() {
  const error = new Error("La comprobación de la extensión fue cancelada.");
  error.name = "AbortError";
  return error;
}

function waitForReply(id, acceptedTypes, timeoutMs, { signal } = {}) {
  return new Promise((resolve, reject) => {
    let timer;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      unsubscribe();
      callback();
    };
    const unsubscribe = subscribeExtensionMessages((message) => {
      if (message.replyTo !== id && message.requestId !== id) return;
      if (!acceptedTypes.has(message.type)) return;
      finish(() => resolve(message));
    });
    const onAbort = () => finish(() => reject(abortError()));
    if (signal?.aborted) {
      finish(() => reject(abortError()));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = window.setTimeout(() => {
      finish(() => reject(new Error(`La extensión no respondió dentro del tiempo esperado (${Math.round(timeoutMs / 1000)} s).`)));
    }, timeoutMs);
  });
}

function extensionResponseError(response, fallbackMessage) {
  const error = new Error(response?.payload?.message || fallbackMessage);
  error.code = response?.payload?.code || response?.payload?.errorCode || "extension_control_failed";
  error.recoverable = response?.payload?.recoverable !== false;
  if (plainObject(response?.payload?.details)) error.details = response.payload.details;
  return error;
}

function campaignConflict(message, details = null) {
  const error = new Error(message);
  error.code = "CAMPAIGN_CONFLICT";
  error.recoverable = true;
  if (plainObject(details)) error.details = details;
  return error;
}

function syntheticStoppedEnvelope(campaignId, campaign = null, { emitterReleased = false } = {}) {
  return emitLocalEnvelope({
    channel: EXTENSION_CHANNEL,
    protocolVersion: WHATSAPP_PROTOCOL_VERSION,
    type: EXTENSION_MESSAGE_TYPES.stopped,
    campaignId,
    payload: {
      ...(plainObject(campaign) ? campaign : {}),
      campaignId,
      status: "stopped",
      emitterReleased,
    },
  });
}

function syntheticCancelledEnvelope(campaignId, campaign = null, reason = "extension_already_idle") {
  return emitLocalEnvelope({
    channel: EXTENSION_CHANNEL,
    protocolVersion: WHATSAPP_PROTOCOL_VERSION,
    type: EXTENSION_MESSAGE_TYPES.cancelled,
    campaignId,
    payload: {
      ...(plainObject(campaign) ? campaign : {}),
      campaignId,
      status: "cancelled",
      emitterReleased: true,
      cancellationReason: reason,
      staleReconciled: true,
    },
  });
}

export function extensionConnectionState({ operational = false, errorCode = "", runtimeAvailable = false, responded = false } = {}) {
  if (errorCode === "EXTENSION_CONTEXT_INVALIDATED") return "needs_page_reload";
  if (errorCode === "extension_reconnecting") return "reconnecting";
  if (operational) return "connected";
  if (responded && runtimeAvailable !== false) return "connected";
  return "disconnected";
}

export function statusFromResponse(response) {
  const errorCode = response.payload.errorCode || "";
  const operational = response.payload.operational === true;
  const runtimeAvailable = response.payload.runtimeAvailable !== false;
  return {
    operational,
    connectionState: extensionConnectionState({ operational, errorCode, runtimeAvailable, responded: true }),
    message: response.payload.message || (operational ? "La extensión está lista." : "La extensión está conectada, pero WhatsApp necesita revisión."),
    extensionVersion: response.payload.extensionVersion || "",
    configuredLimit: Number(response.payload.configuredLimit || 0),
    sentToday: Number(response.payload.sentToday || 0),
    availableToday: Number(response.payload.availableToday || 0),
    errorCode,
    campaign: plainObject(response.payload.campaign) ? response.payload.campaign : null,
    bridgeInstanceId: response.payload.bridgeInstanceId || "",
    bridgeGeneration: Number(response.payload.bridgeGeneration || 0),
    bridgeCreatedAt: response.payload.bridgeCreatedAt || "",
    runtimeAvailable,
    checkedAt: Date.now(),
  };
}

function unavailableStatus(error, fallbackMessage, errorCode) {
  return {
    operational: false,
    connectionState: "disconnected",
    message: error?.message || fallbackMessage,
    errorCode,
    campaign: null,
    configuredLimit: 0,
    sentToday: 0,
    availableToday: 0,
    bridgeInstanceId: "",
    bridgeGeneration: 0,
    bridgeCreatedAt: "",
    runtimeAvailable: false,
    checkedAt: Date.now(),
  };
}

export function pingWhatsAppExtension({ timeoutMs = EXTENSION_TIMEOUTS.ping, signal } = {}) {
  if (pingInFlight) return pingInFlight;
  const operation = (async () => {
    try {
      const id = postEnvelope(EXTENSION_MESSAGE_TYPES.ping, { payload: { requestedAt: Date.now() } });
      const response = await waitForReply(id, new Set([EXTENSION_MESSAGE_TYPES.status]), timeoutMs, { signal });
      return statusFromResponse(response);
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      return unavailableStatus(error, "Extensión no detectada o sin respuesta.", "extension_unavailable");
    }
  })();
  pingInFlight = operation;
  const clear = () => {
    if (pingInFlight === operation) pingInFlight = null;
  };
  operation.then(clear, clear);
  return operation;
}

export async function requestCampaignStatus({ timeoutMs = EXTENSION_TIMEOUTS.ping, signal } = {}) {
  const id = postEnvelope(EXTENSION_MESSAGE_TYPES.statusRequest, { payload: {} });
  const response = await waitForReply(id, new Set([EXTENSION_MESSAGE_TYPES.status, EXTENSION_MESSAGE_TYPES.error]), timeoutMs, { signal });
  if (response.type === EXTENSION_MESSAGE_TYPES.error) {
    throw extensionResponseError(response, "No se pudo consultar el estado activo de la campaña.");
  }
  return statusFromResponse(response);
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
    throw extensionResponseError(response, "La extensión rechazó la campaña.");
  }
  return response;
}

export async function requestWhatsAppPreflight({ timeoutMs = EXTENSION_TIMEOUTS.preflight, signal } = {}) {
  try {
    const id = postEnvelope(EXTENSION_MESSAGE_TYPES.preflightRequest, { payload: { requestedAt: Date.now() } });
    const response = await waitForReply(id, new Set([EXTENSION_MESSAGE_TYPES.status]), timeoutMs, { signal });
    return statusFromResponse(response);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return unavailableStatus(error, "No fue posible ejecutar el diagnóstico de la extensión.", "extension_preflight_failed");
  }
}

async function requestCampaignControl(type, campaignId, acceptedTypes, { sequence, timeoutMs = EXTENSION_TIMEOUTS.control, signal } = {}) {
  const id = postEnvelope(type, { campaignId, sequence, payload: { campaignId } });
  const response = await waitForReply(id, new Set([...acceptedTypes, EXTENSION_MESSAGE_TYPES.error]), timeoutMs, { signal });
  if (response.type === EXTENSION_MESSAGE_TYPES.error) {
    throw extensionResponseError(response, "La extensión rechazó el control de campaña.");
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

export function requestCampaignRetry(campaignId, options = {}) {
  return requestCampaignControl(EXTENSION_MESSAGE_TYPES.retryRequest, campaignId, [EXTENSION_MESSAGE_TYPES.resumed, EXTENSION_MESSAGE_TYPES.started], options);
}

export function requestCampaignRetryFailed(campaignId, options = {}) {
  return requestCampaignControl(EXTENSION_MESSAGE_TYPES.retryFailedRequest, campaignId, [EXTENSION_MESSAGE_TYPES.started, EXTENSION_MESSAGE_TYPES.paused], options);
}

export async function requestCampaignStop(campaignId, options = {}) {
  const live = await requestCampaignStatus({
    timeoutMs: Math.min(options.timeoutMs ?? EXTENSION_TIMEOUTS.control, EXTENSION_TIMEOUTS.ping),
    signal: options.signal,
  });
  const active = live.campaign;
  if (!active) {
    return syntheticStoppedEnvelope(campaignId, null, { emitterReleased: true });
  }
  if (active.campaignId !== campaignId) {
    throw campaignConflict(
      `La extensión está controlando otra campaña (${active.campaignName || active.campaignId}). Actualizá la pantalla antes de detener.`,
      { blockingCampaign: active },
    );
  }
  if (active.status === "stopped") {
    return syntheticStoppedEnvelope(campaignId, active, { emitterReleased: false });
  }
  return requestCampaignControl(
    EXTENSION_MESSAGE_TYPES.stopRequest,
    campaignId,
    [EXTENSION_MESSAGE_TYPES.stopped, EXTENSION_MESSAGE_TYPES.cancelled],
    { ...options, sequence: Number.isInteger(active.sequence) ? active.sequence : options.sequence },
  );
}

export async function requestCampaignDelete(campaignId, options = {}) {
  const queryOptions = {
    timeoutMs: Math.min(options.timeoutMs ?? EXTENSION_TIMEOUTS.control, EXTENSION_TIMEOUTS.ping),
    signal: options.signal,
  };
  const live = await requestCampaignStatus(queryOptions);
  const active = live.campaign;
  if (!active || active.campaignId !== campaignId) {
    return syntheticStoppedEnvelope(campaignId, null, { emitterReleased: true });
  }
  if (active.status !== "stopped") {
    throw campaignConflict("La campaña todavía está activa en la extensión. Primero detenela y, cuando figure como detenida, volvé a borrarla.");
  }
  try {
    const response = await requestCampaignControl(
      EXTENSION_MESSAGE_TYPES.deleteRequest,
      campaignId,
      [EXTENSION_MESSAGE_TYPES.stopped],
      { ...options, sequence: Number.isInteger(active.sequence) ? active.sequence : options.sequence },
    );
    if (response?.payload?.emitterReleased === true) return response;
    return emitLocalEnvelope({
      ...response,
      payload: { ...(response.payload || {}), emitterReleased: true },
    });
  } catch (error) {
    if (error?.code !== "CAMPAIGN_CONFLICT") throw error;
    const after = await requestCampaignStatus(queryOptions);
    if (!after.campaign || after.campaign.campaignId !== campaignId) {
      return syntheticStoppedEnvelope(campaignId, null, { emitterReleased: true });
    }
    throw error;
  }
}

export async function requestCampaignCancellation(campaignId, options = {}) {
  const queryOptions = {
    timeoutMs: Math.min(options.timeoutMs ?? EXTENSION_TIMEOUTS.control, EXTENSION_TIMEOUTS.ping),
    signal: options.signal,
  };
  const live = await requestCampaignStatus(queryOptions);
  const active = live.campaign;

  if (!active) {
    return syntheticCancelledEnvelope(campaignId, null, "extension_has_no_active_campaign");
  }

  // La campaña solicitada es un registro stale de la Web App. No tocamos la
  // campaña distinta que sí controla la extensión: sólo archivamos la vieja.
  if (active.campaignId !== campaignId) {
    return syntheticCancelledEnvelope(campaignId, null, "requested_campaign_not_active_in_extension");
  }

  if (active.status === "cancelled") {
    return syntheticCancelledEnvelope(campaignId, active, "extension_already_cancelled");
  }

  if (active.status === "stopped") {
    try {
      return await requestCampaignControl(
        EXTENSION_MESSAGE_TYPES.cancelRequest,
        campaignId,
        [EXTENSION_MESSAGE_TYPES.cancelled],
        { ...options, sequence: Number.isInteger(active.sequence) ? active.sequence : options.sequence },
      );
    } catch (error) {
      // Compatibilidad con 0.9.4.4: esa versión podía rechazar stopped ->
      // cancelled. En ese caso liberamos explícitamente el slot stopped y
      // reconciliamos el registro histórico como cancelled en la Web App.
      const invalidLegacyTransition = error?.code === "INTERNAL_ERROR"
        || error?.code === "internal"
        || String(error?.message || "").includes("Transición de campaña inválida");
      if (!invalidLegacyTransition) throw error;
      await requestCampaignControl(
        EXTENSION_MESSAGE_TYPES.deleteRequest,
        campaignId,
        [EXTENSION_MESSAGE_TYPES.stopped],
        { ...options, sequence: Number.isInteger(active.sequence) ? active.sequence : options.sequence },
      );
      return syntheticCancelledEnvelope(campaignId, active, "legacy_stopped_campaign_released");
    }
  }

  return requestCampaignControl(
    EXTENSION_MESSAGE_TYPES.cancelRequest,
    campaignId,
    [EXTENSION_MESSAGE_TYPES.cancelled],
    { ...options, sequence: Number.isInteger(active.sequence) ? active.sequence : options.sequence },
  );
}

export async function requestCampaignDiagnosticReport(campaignId, webAppContext = {}, { timeoutMs = EXTENSION_TIMEOUTS.control, signal } = {}) {
  const id = postEnvelope(EXTENSION_MESSAGE_TYPES.diagnosticReportRequest, {
    campaignId,
    payload: { webAppContext: plainObject(webAppContext) ? webAppContext : {} },
  });
  const response = await waitForReply(
    id,
    new Set([EXTENSION_MESSAGE_TYPES.diagnosticReport, EXTENSION_MESSAGE_TYPES.error]),
    timeoutMs,
    { signal },
  );
  if (response.type === EXTENSION_MESSAGE_TYPES.error) {
    throw extensionResponseError(response, "No se pudo generar el reporte de situación actual.");
  }
  return response.payload;
}