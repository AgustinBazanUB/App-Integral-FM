
import {
  isValidCustomerPhone,
  normalizeCustomerPhone,
  normalizedSearchText,
  phoneToWhatsAppInternational,
} from "../../customers/customerDomain.js";

export const WHATSAPP_PROTOCOL_VERSION = 1;
export const MAX_CAMPAIGN_IMAGES = 3;

export const CAMPAIGN_STATUS_LABELS = Object.freeze({
  draft: "Borrador",
  ready: "Lista para enviar",
  running: "En proceso",
  paused: "Pausada",
  completed: "Finalizada",
  error: "Con error",
  cancelled: "Cancelada",
});

export const CAMPAIGN_STATUS_TONES = Object.freeze({
  draft: "neutral",
  ready: "info",
  running: "info",
  paused: "neutral",
  completed: "success",
  error: "error",
  cancelled: "neutral",
});

export const ACTIVE_CAMPAIGN_STATUSES = new Set(["ready", "running", "paused"]);
export const FINAL_CAMPAIGN_STATUSES = new Set(["completed", "error", "cancelled"]);

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
  return {
    ...candidate,
    phoneNormalized,
    whatsappPhone: phoneToWhatsAppInternational(phoneNormalized),
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
    if (!isValidCustomerPhone(candidate.phoneNormalized) || !candidate.whatsappPhone) {
      invalidPhone += 1;
      invalidRows.push({ ...candidate, reason: "Teléfono inválido" });
      continue;
    }
    const existing = unique.get(candidate.phoneNormalized);
    if (existing) {
      duplicates += 1;
      unique.set(candidate.phoneNormalized, mergeDuplicate(existing, candidate));
    } else {
      unique.set(candidate.phoneNormalized, candidate);
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
  const normalized = normalizeCustomerPhone(phone);
  if (!isValidCustomerPhone(normalized)) throw new Error("El destinatario no tiene un teléfono válido.");
  if (!globalThis.crypto?.subtle) throw new Error("Este navegador no permite generar identificadores seguros.");
  const bytes = new TextEncoder().encode(`flor-mia:whatsapp-recipient:${normalized}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `recipient_${hex.slice(0, 40)}`;
}

export function extensionPrimaryStatus(status = {}) {
  return status.operational === true
    ? { operational: true, label: "Operativa", tone: "success", message: status.message || "La extensión respondió correctamente." }
    : { operational: false, label: "Error / requiere revisión", tone: "error", message: status.message || "Extensión no detectada o sin respuesta." };
}

export function campaignValidation({ name, recipients = [], message = "", images = [], extensionStatus, persistedImageMetadata = [] } = {}) {
  const errors = [];
  if (!String(name || "").trim()) errors.push("Ingresá un nombre para la campaña.");
  if (!recipients.length) errors.push("Seleccioná al menos un destinatario válido.");
  if (recipients.some((recipient) => !isValidCustomerPhone(recipient.phoneNormalized || recipient.phone))) errors.push("Hay destinatarios con teléfonos inválidos.");
  if (images.length > MAX_CAMPAIGN_IMAGES) errors.push("La campaña admite como máximo 3 imágenes.");
  if (!String(message || "").trim() && !images.length) errors.push("Ingresá un mensaje o agregá al menos una imagen.");
  if (persistedImageMetadata.length && images.length < persistedImageMetadata.length) errors.push("Volvé a seleccionar las imágenes del borrador antes de preparar la campaña.");
  if (extensionStatus?.operational !== true) errors.push(extensionStatus?.message || "La extensión no está operativa.");
  return { valid: errors.length === 0, errors };
}

export function progressPercentage(totalRecipients, sentCount) {
  const total = Math.max(0, Number(totalRecipients || 0));
  const sent = Math.max(0, Math.min(total, Number(sentCount || 0)));
  return total ? Math.round((sent / total) * 100) : 0;
}

export function safeCampaignCounters(totalRecipients, sentCount, errorCount = 0) {
  const total = Math.max(0, Number(totalRecipients || 0));
  const sent = Math.max(0, Math.min(total, Number(sentCount || 0)));
  const errors = Math.max(0, Math.min(total, Number(errorCount || 0)));
  return { total, sent, errors, progress: progressPercentage(total, sent) };
}
