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
  running: "Campaña en curso",
  paused: "Campaña pausada",
  completed: "Campaña completada",
  error: "Necesita revisión",
  cancelled: "Campaña detenida",
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
    // El bridge exige un WhatsApp phone canónico. Un teléfono válido para la ficha
    // de cliente pero ambiguo para WhatsApp no se entrega a la extensión.
    if (!isValidCustomerPhone(candidate.phoneNormalized) || !candidate.whatsappPhone) {
      invalidPhone += 1;
      invalidRows.push({ ...candidate, reason: "Teléfono inválido para WhatsApp" });
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
  if (status.operational === true) {
    return {
      operational: true,
      label: "Conectado",
      tone: "success",
      message: status.message || "Listo para enviar.",
    };
  }
  const code = String(status.errorCode || "");
  if (code === "session_not_ready") {
    return { operational: false, label: "WhatsApp necesita iniciar sesión", tone: "error", message: "Abrí WhatsApp Web y escaneá el código QR para continuar." };
  }
  if (code === "whatsapp_not_open") {
    return { operational: false, label: "WhatsApp Web no está abierto", tone: "error", message: "Abrí WhatsApp Web para continuar." };
  }
  if (code === "extension_unavailable" || code === "extension_not_ready") {
    return { operational: false, label: "Extensión desconectada", tone: "error", message: "Volvé a cargar la extensión o revisá Chrome." };
  }
  return {
    operational: false,
    label: "Necesita revisión",
    tone: "error",
    message: "Hubo un problema y la campaña quedó protegida para evitar un envío incorrecto.",
  };
}

export function userFacingCampaignProblem(errorCode) {
  if (errorCode === "CONTACT_CONTEXT_UNVERIFIED") {
    return "No pudimos confirmar que WhatsApp abrió el contacto correcto. La campaña se pausó para evitar enviar el mensaje a otra persona.";
  }
  if (errorCode === "SESSION_NOT_READY" || errorCode === "session_not_ready") {
    return "WhatsApp necesita iniciar sesión. Abrí WhatsApp Web y escaneá el código QR.";
  }
  if (errorCode === "WHATSAPP_NOT_OPEN" || errorCode === "whatsapp_not_open") {
    return "WhatsApp Web no está abierto. Abrilo para continuar.";
  }
  if (["CAPABILITY_UNAVAILABLE", "WHATSAPP_UI_CHANGED", "SELECTOR_STRATEGY_EXHAUSTED"].includes(String(errorCode || ""))) {
    return "WhatsApp cambió y necesitamos revisar la conexión antes de continuar.";
  }
  return "Hubo un problema y la campaña quedó pausada para revisión.";
}

export function campaignValidation({ name, recipients = [], message = "", images = [], extensionStatus, persistedImageMetadata = [] } = {}) {
  const errors = [];
  if (!String(name || "").trim()) errors.push("Ingresá un nombre para la campaña.");
  if (!recipients.length) errors.push("Seleccioná al menos un destinatario válido.");
  if (recipients.some((recipient) => !recipient.whatsappPhone)) errors.push("Hay destinatarios sin un número de WhatsApp canónico.");
  if (images.length > MAX_CAMPAIGN_IMAGES) errors.push("La campaña admite como máximo 3 imágenes.");
  if (!String(message || "").trim() && !images.length) errors.push("Ingresá un mensaje o agregá al menos una imagen.");
  if (persistedImageMetadata.length && images.length < persistedImageMetadata.length) errors.push("Volvé a seleccionar las imágenes del borrador antes de preparar la campaña.");
  if (extensionStatus?.operational !== true) errors.push(extensionPrimaryStatus(extensionStatus).message);
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

export function extensionCampaignCounters(payload = {}, current = {}) {
  return safeCampaignCounters(
    current.totalRecipients,
    payload.sent ?? payload.progress?.completed ?? current.sentCount,
    payload.finalSummary?.failed ?? current.errorCount,
  );
}
