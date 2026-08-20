
import {
  canonicalWhatsAppPhone,
  normalizeCustomerPhone,
  normalizedSearchText,
} from "../../customers/customerDomain.js";

export const WHATSAPP_PROTOCOL_VERSION = 1;
export const MAX_CAMPAIGN_IMAGES = 3;

export const CAMPAIGN_STATUS_LABELS = Object.freeze({
  draft: "Borrador",
  received: "Lista para iniciar",
  ready: "Lista para enviar",
  running: "Campaña en curso",
  pause_requested: "Pausando…",
  waiting_contact: "Campaña en curso",
  waiting_batch: "Campaña en curso",
  paused: "Campaña pausada",
  daily_limit_reached: "Campaña pausada",
  images_required: "Necesita revisión",
  completed: "Campaña completada",
  stopped: "Campaña detenida",
  error: "Necesita revisión",
  cancelled: "Campaña cancelada",
});

export const CAMPAIGN_STATUS_TONES = Object.freeze({
  draft: "neutral",
  received: "info",
  ready: "info",
  running: "info",
  pause_requested: "info",
  waiting_contact: "info",
  waiting_batch: "info",
  paused: "neutral",
  daily_limit_reached: "neutral",
  images_required: "warning",
  completed: "success",
  stopped: "neutral",
  error: "error",
  cancelled: "neutral",
});

export const ACTIVE_CAMPAIGN_STATUSES = new Set([
  "received", "ready", "running", "pause_requested", "waiting_contact", "waiting_batch", "paused", "daily_limit_reached", "images_required",
]);
export const FINAL_CAMPAIGN_STATUSES = new Set(["completed", "stopped", "error", "cancelled"]);

const explicitlyBlockedFields = [
  "marketingEnabled",
  "whatsappOptIn",
  "communicationAllowed",
  "communicationsAllowed",
  "consent",
];

export function customerCommunicationAllowed(customer = {}) {
  if (customer.deleted === true || customer.active === false) return false;
  if (customer.blocked === true || customer.doNotContact === true || customer.whatsappBlocked === true) return false;
  return !explicitlyBlockedFields.some((field) => customer[field] === false);
}

export function customerCategory(customer = {}) {
  return String(customer.category || customer.segment || "").trim();
}

export function customerZone(customer = {}) {
  return String(customer.zoneName || customer.customZone || customer.zone || "").trim();
}

export function customerMatchesCampaignFilters(customer, filters = {}) {
  if (!customerCommunicationAllowed(customer)) return false;
  if (filters.zoneId || filters.zoneName) {
    const zoneMatches =
      (filters.zoneId && customer.zoneId === filters.zoneId) ||
      (filters.zoneName && normalizedSearchText(customerZone(customer)) === normalizedSearchText(filters.zoneName));
    if (!zoneMatches) return false;
  }
  if (filters.category && normalizedSearchText(customerCategory(customer)) !== normalizedSearchText(filters.category)) return false;
  const search = normalizedSearchText(filters.search || "");
  if (search) {
    const phoneSearch = normalizeCustomerPhone(filters.search);
    const phoneMatches = phoneSearch && normalizeCustomerPhone(customer.phoneNormalized || customer.phone).includes(phoneSearch);
    const textMatches = [customer.name, customerZone(customer), customerCategory(customer)]
      .some((value) => normalizedSearchText(value).includes(search));
    if (!phoneMatches && !textMatches) return false;
  }
  return true;
}

export function recipientFromCustomer(customer = {}) {
  return {
    source: "flor_mia",
    clientId: customer.id || null,
    name: String(customer.name || "").trim(),
    phone: customer.phoneNormalized || customer.phone || "",
    zone: customerZone(customer),
    category: customerCategory(customer),
    notes: "",
  };
}

export function recipientFromExcel(row = {}) {
  return {
    source: "excel",
    clientId: null,
    name: String(row.name || "").trim(),
    phone: row.phone == null ? "" : String(row.phone).trim(),
    zone: String(row.zone || "").trim(),
    category: String(row.category || "").trim(),
    notes: String(row.notes || "").trim(),
  };
}

function normalizedCandidate(candidate = {}) {
  const phoneNormalized = normalizeCustomerPhone(candidate.phone);
  const whatsappPhone = canonicalWhatsAppPhone(phoneNormalized);
  return {
    ...candidate,
    phoneNormalized,
    whatsappPhone,
  };
}

function mergeDuplicate(existing, incoming) {
  if (existing.source === "flor_mia") {
    return {
      ...existing,
      name: existing.name || incoming.name || "",
      zone: existing.zone || incoming.zone || "",
      category: existing.category || incoming.category || "",
      notes: existing.notes || incoming.notes || "",
    };
  }
  if (incoming.source === "flor_mia") {
    return {
      ...incoming,
      name: incoming.name || existing.name || "",
      zone: incoming.zone || existing.zone || "",
      category: incoming.category || existing.category || "",
      notes: incoming.notes || existing.notes || "",
    };
  }
  return {
    ...existing,
    name: existing.name || incoming.name || "",
    zone: existing.zone || incoming.zone || "",
    category: existing.category || incoming.category || "",
    notes: existing.notes || incoming.notes || "",
  };
}

export function analyzeRecipientCandidates(candidates = []) {
  const unique = new Map();
  const invalidRows = [];
  let missingPhone = 0;
  let invalidPhone = 0;
  let duplicates = 0;

  for (const raw of candidates) {
    const candidate = normalizedCandidate(raw);
    if (!candidate.phoneNormalized) {
      missingPhone += 1;
      invalidRows.push({ ...candidate, reason: "Sin teléfono" });
      continue;
    }
    if (!candidate.whatsappPhone) {
      invalidPhone += 1;
      invalidRows.push({ ...candidate, reason: "Celular argentino incompleto o ambiguo" });
      continue;
    }
    const existing = unique.get(candidate.whatsappPhone);
    if (existing) {
      duplicates += 1;
      unique.set(candidate.whatsappPhone, mergeDuplicate(existing, candidate));
    } else {
      unique.set(candidate.whatsappPhone, candidate);
    }
  }

  return {
    totalFound: candidates.length,
    valid: unique.size,
    invalid: invalidPhone,
    duplicates,
    missingPhone,
    recipients: [...unique.values()],
    invalidRows,
  };
}

export function campaignRecipientDisplayPhone(recipient = {}) {
  const normalized = normalizeCustomerPhone(recipient.phoneNormalized || recipient.phone);
  if (normalized.length === 10 && normalized.startsWith("11")) {
    return `11-${normalized.slice(2, 6)}-${normalized.slice(6)}`;
  }
  if (normalized.length > 4) return `${normalized.slice(0, -4)}-${normalized.slice(-4)}`;
  return normalized || "Sin teléfono";
}

export async function recipientDocumentId(phone) {
  const canonical = canonicalWhatsAppPhone(phone);
  if (!canonical) throw new Error("El destinatario no tiene un celular argentino válido para WhatsApp.");
  if (!globalThis.crypto?.subtle) throw new Error("Este navegador no permite generar identificadores seguros.");
  const bytes = new TextEncoder().encode(`flor-mia:whatsapp-recipient:${canonical}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `recipient_${hex.slice(0, 40)}`;
}

export function userFacingWhatsAppProblem({ code, message } = {}) {
  if (code === "CONTACT_CONTEXT_UNVERIFIED") {
    return "No pudimos confirmar que WhatsApp abrió el contacto correcto. La campaña se protegió para evitar enviar el mensaje a otra persona.";
  }
  if (code === "EXTENSION_CONTEXT_INVALIDATED") return "Necesitamos reconectar la extensión.";
  if (code === "WHATSAPP_NOT_OPEN") return "WhatsApp Web no está abierto. Abrilo para continuar.";
  if (code === "SESSION_NOT_READY") return "WhatsApp necesita iniciar sesión. Abrí WhatsApp Web y escaneá el código QR.";
  if (["PREFLIGHT_FAILED", "WHATSAPP_UI_CHANGED"].includes(code)) return "WhatsApp cambió y necesitamos revisar la conexión antes de continuar.";
  if (code === "INTERFACE_LOADING") return "WhatsApp necesita unos segundos más. La campaña quedó pausada para no avanzar mientras la interfaz general no está lista.";
  if (code === "TIMEOUT") return "No pudimos completar este contacto a tiempo. Si el fallo fue antes del envío, puede reintentarse de forma segura.";
  return String(message || "Hubo un problema y la campaña quedó protegida de forma segura.");
}

export function extensionPrimaryStatus(status = {}) {
  if (status.connectionState === "needs_page_reload") {
    return { operational: false, label: "Necesitamos reconectar la extensión", tone: "warning", message: "Usá Reconectar para actualizar esta pantalla y volver a enlazar la extensión." };
  }
  if (status.connectionState === "reconnecting") {
    return { operational: false, label: "Reconectando…", tone: "info", message: status.message || "Restableciendo la conexión con la extensión." };
  }
  if (status.connectionState === "disconnected") {
    return { operational: false, label: "Extensión desconectada", tone: "error", message: status.message || "No pudimos contactar la extensión." };
  }
  if (status.operational === true) {
    return {
      operational: true,
      label: "Conectado",
      tone: "success",
      message: status.message || "Listo para enviar.",
    };
  }
  return {
    operational: false,
    label: status.errorCode === "WHATSAPP_NOT_OPEN" ? "WhatsApp Web no está abierto" : "Necesita revisión",
    tone: "error",
    message: userFacingWhatsAppProblem({ code: status.errorCode, message: status.message || "Extensión desconectada. Revisá Chrome para continuar." }),
  };
}

export function campaignValidation({ name, recipients = [], message = "", images = [], extensionStatus, persistedImageMetadata = [] } = {}) {
  const errors = [];
  if (!String(name || "").trim()) errors.push("Ingresá un nombre para la campaña.");
  if (!recipients.length) errors.push("Seleccioná al menos un destinatario válido.");
  if (recipients.some((recipient) => !canonicalWhatsAppPhone(recipient.whatsappPhone || recipient.phoneNormalized || recipient.phone))) {
    errors.push("Hay destinatarios cuyo celular no puede normalizarse de forma inequívoca para WhatsApp.");
  }
  if (images.length > MAX_CAMPAIGN_IMAGES) errors.push("La campaña admite como máximo 3 imágenes.");
  if (!String(message || "").trim() && !images.length) errors.push("Ingresá un mensaje o agregá al menos una imagen.");
  if (persistedImageMetadata.length && images.length < persistedImageMetadata.length) errors.push("Volvé a seleccionar las imágenes del borrador antes de preparar la campaña.");
  if (extensionStatus?.operational !== true) errors.push(userFacingWhatsAppProblem({ code: extensionStatus?.errorCode, message: extensionStatus?.message || "La extensión no está conectada." }));
  return { valid: errors.length === 0, errors };
}

export function progressPercentage(totalRecipients, processedCount) {
  const total = Math.max(0, Number(totalRecipients || 0));
  const processed = Math.max(0, Math.min(total, Number(processedCount || 0)));
  return total ? Math.round((processed / total) * 100) : 0;
}

export function safeCampaignCounters(totalRecipients, sentCount, errorCount = 0, confirmedSentCount = null, unverifiedSentCount = null) {
  const total = Math.max(0, Number(totalRecipients || 0));
  const sent = Math.max(0, Math.min(total, Number(sentCount || 0)));
  const errors = Math.max(0, Math.min(Math.max(0, total - sent), Number(errorCount || 0)));
  const explicitUnverified = unverifiedSentCount == null ? 0 : Math.max(0, Number(unverifiedSentCount || 0));
  const unverifiedSent = Math.min(sent, explicitUnverified);
  const fallbackConfirmed = Math.max(0, sent - unverifiedSent);
  const confirmedSent = confirmedSentCount == null
    ? fallbackConfirmed
    : Math.min(fallbackConfirmed, Math.max(0, Number(confirmedSentCount || 0)));
  const accountedSent = confirmedSent + unverifiedSent;
  const normalizedConfirmed = accountedSent < sent ? confirmedSent + (sent - accountedSent) : confirmedSent;
  const processed = Math.min(total, sent + errors);
  return {
    total,
    sent,
    confirmedSent: normalizedConfirmed,
    unverifiedSent,
    errors,
    failed: errors,
    processed,
    remaining: Math.max(0, total - processed),
    progress: progressPercentage(total, processed),
  };
}

export function extensionCampaignCounters(payload = {}, current = {}) {
  const summary = payload.finalSummary || {};
  const total = payload.total ?? payload.progress?.total ?? summary.total ?? current.totalRecipients;
  const confirmedSent = payload.confirmedSent ?? summary.confirmedSent ?? current.confirmedSentCount;
  const unverifiedSent = payload.unverifiedSent ?? summary.unverifiedSent ?? current.unverifiedSentCount;
  const derivedSent = (confirmedSent != null || unverifiedSent != null)
    ? Number(confirmedSent || 0) + Number(unverifiedSent || 0)
    : undefined;
  return safeCampaignCounters(
    total,
    payload.sent ?? summary.sent ?? derivedSent ?? current.sentCount,
    payload.failed ?? summary.failed ?? current.errorCount,
    confirmedSent,
    unverifiedSent,
  );
}

const RETRYABLE_PAUSE_CODES = new Set([
  "contact_failed",
  "contact_paused",
  "repeated_contact_failures",
  "service_worker_restarted",
]);

export function campaignControlAvailability(campaign = {}) {
  const status = String(campaign.status || "");
  const blockCode = String(campaign.extensionBlockReason?.code || campaign.blockReason?.code || "");
  const ambiguous = blockCode === "contact_ambiguous" || campaign.hasAmbiguousSend === true;
  const retryableFailed = Math.max(0, Number(campaign.retryableFailed ?? campaign.extensionRetryableFailed ?? 0));
  const failed = Math.max(0, Number(campaign.errorCount ?? campaign.failed ?? 0));
  const normalPause = status === "paused" && (blockCode === "manual_pause" || !blockCode);
  const retryablePause = (status === "paused" || status === "error") && RETRYABLE_PAUSE_CODES.has(blockCode);
  return {
    ambiguous,
    canPause: ["running", "waiting_contact", "waiting_batch"].includes(status),
    canResume: normalPause || status === "daily_limit_reached",
    canRetry: !ambiguous && retryablePause,
    canRetryFailed: status === "completed" && failed > 0 && retryableFailed > 0,
    canStop: !["completed", "stopped", "cancelled"].includes(status),
    canCancel: ["ready", "running", "pause_requested", "waiting_contact", "waiting_batch", "paused", "daily_limit_reached", "images_required", "error"].includes(status),
    canDelete: status === "stopped" && !ambiguous && campaign.emitterReleased !== true,
  };
}
