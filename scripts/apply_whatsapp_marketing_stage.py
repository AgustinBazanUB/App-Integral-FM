from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]


def write(path, content):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")


def replace_once(path, old, new):
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"No se encontró bloque esperado en {path}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


write("src/gestion/marketing/whatsapp/campaignDomain.js", r'''
import {
  isValidCustomerPhone,
  normalizeCustomerPhone,
  normalizedSearchText,
  phoneToWhatsAppInternational,
} from "../../customers/customerDomain";

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
''')

write("src/gestion/marketing/whatsapp/excelImport.js", r'''
import { recipientFromExcel } from "./campaignDomain";

const normalizeHeader = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim()
  .toLocaleLowerCase("es-AR")
  .replace(/[^a-z0-9]+/g, " ");

const headerAliases = {
  phone: ["telefono", "teléfono", "tel", "celular", "movil", "móvil", "whatsapp", "phone"],
  name: ["nombre", "nombre y apellido", "cliente", "name"],
  zone: ["zona", "localidad", "barrio", "zone"],
  category: ["categoria", "categoría", "segmento", "tipo cliente", "category", "segment"],
  notes: ["observaciones", "observacion", "observación", "notas", "notes"],
};

export function detectExcelMapping(headers = []) {
  const normalized = headers.map(normalizeHeader);
  const result = { phone: "", name: "", zone: "", category: "", notes: "" };
  for (const [field, aliases] of Object.entries(headerAliases)) {
    const aliasSet = new Set(aliases.map(normalizeHeader));
    const index = normalized.findIndex((header) => aliasSet.has(header));
    if (index >= 0) result[field] = String(headers[index]);
  }
  return result;
}

export async function readCampaignExcel(file) {
  if (!file) throw new Error("Seleccioná un archivo .xlsx.");
  if (!String(file.name || "").toLocaleLowerCase().endsWith(".xlsx")) {
    throw new Error("El importador admite archivos .xlsx. El formato .xls binario no está habilitado.");
  }
  const { readSheet } = await import("read-excel-file/browser");
  const rows = await readSheet(file);
  if (!rows?.length) throw new Error("El archivo está vacío.");
  const headers = rows[0].map((value, index) => String(value || `Columna ${index + 1}`).trim());
  return {
    fileName: file.name,
    headers,
    rows: rows.slice(1).filter((row) => row.some((value) => value != null && String(value).trim() !== "")),
    mapping: detectExcelMapping(headers),
  };
}

export function mapExcelRows(sheet, mapping) {
  if (!sheet?.headers?.length) return [];
  if (!mapping?.phone) throw new Error("Indicá qué columna contiene el teléfono.");
  const headerIndex = new Map(sheet.headers.map((header, index) => [header, index]));
  const value = (row, field) => {
    const header = mapping[field];
    return header && headerIndex.has(header) ? row[headerIndex.get(header)] : "";
  };
  return sheet.rows.map((row) => recipientFromExcel({
    phone: value(row, "phone"),
    name: value(row, "name"),
    zone: value(row, "zone"),
    category: value(row, "category"),
    notes: value(row, "notes"),
  }));
}
''')

write("src/gestion/marketing/whatsapp/extensionBridge.js", r'''
import { WHATSAPP_PROTOCOL_VERSION } from "./campaignDomain";

export const EXTENSION_CHANNEL = "flor_mia_whatsapp_extension";

export const EXTENSION_MESSAGE_TYPES = Object.freeze({
  ping: "FLORMIA_EXTENSION_PING",
  status: "FLORMIA_EXTENSION_STATUS",
  prepare: "FLORMIA_CAMPAIGN_PREPARE",
  accepted: "FLORMIA_CAMPAIGN_ACCEPTED",
  progress: "FLORMIA_CAMPAIGN_PROGRESS",
  paused: "FLORMIA_CAMPAIGN_PAUSED",
  completed: "FLORMIA_CAMPAIGN_COMPLETED",
  error: "FLORMIA_CAMPAIGN_ERROR",
  cancelled: "FLORMIA_CAMPAIGN_CANCELLED",
  cancelRequest: "FLORMIA_CAMPAIGN_CANCEL_REQUEST",
});

const inboundTypes = new Set([
  EXTENSION_MESSAGE_TYPES.status,
  EXTENSION_MESSAGE_TYPES.accepted,
  EXTENSION_MESSAGE_TYPES.progress,
  EXTENSION_MESSAGE_TYPES.paused,
  EXTENSION_MESSAGE_TYPES.completed,
  EXTENSION_MESSAGE_TYPES.error,
  EXTENSION_MESSAGE_TYPES.cancelled,
]);

const campaignEventTypes = new Set([
  EXTENSION_MESSAGE_TYPES.progress,
  EXTENSION_MESSAGE_TYPES.paused,
  EXTENSION_MESSAGE_TYPES.completed,
  EXTENSION_MESSAGE_TYPES.error,
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

function postEnvelope(type, { payload = {}, campaignId = null, transfer = [] } = {}) {
  if (typeof window === "undefined") throw new Error("La integración con la extensión requiere un navegador.");
  const id = requestId();
  const envelope = {
    channel: EXTENSION_CHANNEL,
    protocolVersion: WHATSAPP_PROTOCOL_VERSION,
    type,
    requestId: id,
    ...(campaignId ? { campaignId } : {}),
    payload,
  };
  window.postMessage(envelope, window.location.origin, transfer);
  return id;
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
      reject(new Error("La extensión no respondió dentro del tiempo esperado."));
    }, timeoutMs);
  });
}

export async function pingWhatsAppExtension({ timeoutMs = 1800 } = {}) {
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
      message: "Extensión no detectada o sin respuesta.",
      errorCode: "extension_unavailable",
      configuredLimit: 0,
      sentToday: 0,
      availableToday: 0,
      checkedAt: Date.now(),
    };
  }
}

export async function prepareCampaignForExtension(campaign, imageItems = [], { timeoutMs = 6000 } = {}) {
  const transferredImages = [];
  const transfer = [];
  for (let index = 0; index < imageItems.length; index += 1) {
    const item = imageItems[index];
    const data = await item.file.arrayBuffer();
    transfer.push(data);
    transferredImages.push({
      order: index + 1,
      name: item.file.name,
      type: item.file.type,
      size: item.file.size,
      data,
    });
  }
  const id = postEnvelope(EXTENSION_MESSAGE_TYPES.prepare, {
    campaignId: campaign.campaignId,
    transfer,
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

export async function requestCampaignCancellation(campaignId, { timeoutMs = 5000 } = {}) {
  const id = postEnvelope(EXTENSION_MESSAGE_TYPES.cancelRequest, { campaignId, payload: { campaignId } });
  return waitForReply(id, new Set([EXTENSION_MESSAGE_TYPES.cancelled, EXTENSION_MESSAGE_TYPES.error]), timeoutMs);
}
''')

write("src/gestion/marketing/whatsapp/campaignService.js", r'''
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  writeBatch,
} from "firebase/firestore";
import { can } from "../../permissions";
import { db } from "../../services/firebase";
import { listCustomerZones } from "../../services/customerService";
import {
  CAMPAIGN_STATUS_LABELS,
  campaignRecipientDisplayPhone,
  customerCategory,
  customerCommunicationAllowed,
  customerMatchesCampaignFilters,
  progressPercentage,
  recipientDocumentId,
  recipientFromCustomer,
  safeCampaignCounters,
} from "./campaignDomain";
import { EXTENSION_MESSAGE_TYPES } from "./extensionBridge";

const docsToArray = (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
const CHUNK_SIZE = 350;
const MAX_SELECT_ALL = 5000;

function profileName(profile = {}) {
  return profile.name || profile.email || "Usuario";
}

function canView(profile) {
  return can(profile, "marketing", "whatsappView") || can(profile, "marketing", "whatsappViewHistory") || can(profile, "marketing", "view");
}

function canCreate(profile) {
  return can(profile, "marketing", "whatsappCreateCampaign") || can(profile, "marketing", "create");
}

function canSend(profile) {
  return can(profile, "marketing", "whatsappSendToExtension") || can(profile, "marketing", "edit");
}

function canCancel(profile) {
  return can(profile, "marketing", "whatsappCancelCampaign") || can(profile, "marketing", "edit");
}

function campaignAudit(profile, action, campaignId, title, description) {
  return {
    action,
    title,
    description,
    moduleId: "marketing",
    entityType: "whatsappCampaign",
    entityId: campaignId,
    userId: profile.id,
    userName: profileName(profile),
    status: "completed",
    createdAt: serverTimestamp(),
  };
}

export async function listCampaignCustomerPage(profile, { pageSize = 100, cursor = null } = {}) {
  if (!can(profile, "loyal-customers", "view")) throw new Error("No tenés permiso para consultar Clientes Fidelizados.");
  const constraints = [orderBy("updatedAt", "desc")];
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(Math.max(1, Math.min(150, pageSize))));
  const snapshot = await getDocs(query(collection(db, "customers"), ...constraints));
  return {
    items: docsToArray(snapshot).filter(customerCommunicationAllowed),
    cursor: snapshot.docs.at(-1) || null,
    hasMore: snapshot.docs.length === Math.max(1, Math.min(150, pageSize)),
  };
}

export async function listCampaignCustomerFilterOptions(profile) {
  if (!can(profile, "loyal-customers", "view")) throw new Error("No tenés permiso para consultar clientes.");
  const [zones, segmentSnapshot, categorySnapshot] = await Promise.all([
    listCustomerZones(profile),
    getDocs(query(collection(db, "customers"), orderBy("segment"), limit(250))).catch(() => null),
    getDocs(query(collection(db, "customers"), orderBy("category"), limit(250))).catch(() => null),
  ]);
  const categories = new Set();
  for (const snapshot of [segmentSnapshot, categorySnapshot]) {
    for (const item of snapshot?.docs || []) {
      const category = customerCategory(item.data());
      if (category) categories.add(category);
    }
  }
  return {
    zones: zones.filter((zone) => zone.active !== false),
    categories: [...categories].sort((a, b) => a.localeCompare(b, "es")),
  };
}

export async function listAllCampaignCustomers(profile, filters = {}) {
  const all = [];
  let cursor = null;
  let hasMore = true;
  while (hasMore) {
    const page = await listCampaignCustomerPage(profile, { pageSize: 150, cursor });
    all.push(...page.items.filter((customer) => customerMatchesCampaignFilters(customer, filters)));
    if (all.length > MAX_SELECT_ALL) throw new Error("La selección supera 5.000 clientes. Aplicá un filtro más específico.");
    cursor = page.cursor;
    hasMore = page.hasMore && Boolean(cursor);
  }
  return all;
}

export async function listWhatsAppCampaignsPage(profile, { pageSize = 20, cursor = null } = {}) {
  if (!canView(profile)) throw new Error("No tenés permiso para ver campañas de WhatsApp.");
  const constraints = [orderBy("createdAt", "desc")];
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(Math.max(1, Math.min(50, pageSize))));
  const snapshot = await getDocs(query(collection(db, "whatsappCampaigns"), ...constraints));
  return {
    items: docsToArray(snapshot),
    cursor: snapshot.docs.at(-1) || null,
    hasMore: snapshot.docs.length === Math.max(1, Math.min(50, pageSize)),
  };
}

export async function getWhatsAppCampaign(profile, campaignId) {
  if (!canView(profile)) throw new Error("No tenés permiso para ver campañas de WhatsApp.");
  const snapshot = await getDoc(doc(db, "whatsappCampaigns", campaignId));
  if (!snapshot.exists()) throw new Error("La campaña no existe.");
  return { id: snapshot.id, ...snapshot.data() };
}

export async function listCampaignRecipients(profile, campaignId) {
  if (!canView(profile)) throw new Error("No tenés permiso para ver destinatarios.");
  const result = [];
  let cursor = null;
  while (result.length < MAX_SELECT_ALL) {
    const constraints = [orderBy("createdAt", "asc")];
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(400));
    const snapshot = await getDocs(query(collection(db, "whatsappCampaigns", campaignId, "recipients"), ...constraints));
    result.push(...docsToArray(snapshot));
    if (snapshot.docs.length < 400) break;
    cursor = snapshot.docs.at(-1);
  }
  return result;
}

export async function listCampaignEvents(profile, campaignId, pageSize = 40) {
  if (!canView(profile)) throw new Error("No tenés permiso para ver el historial.");
  return docsToArray(await getDocs(query(
    collection(db, "whatsappCampaigns", campaignId, "events"),
    orderBy("createdAt", "desc"),
    limit(Math.max(1, Math.min(100, pageSize))),
  )));
}

export async function saveWhatsAppCampaignDraft(profile, input, campaignId = null) {
  if (!canCreate(profile)) throw new Error("No tenés permiso para crear campañas de WhatsApp.");
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Ingresá un nombre para la campaña.");
  const reference = campaignId ? doc(db, "whatsappCampaigns", campaignId) : doc(collection(db, "whatsappCampaigns"));
  const existing = campaignId ? await getDoc(reference) : null;
  const imageMetadata = (input.imageMetadata || []).slice(0, 3).map((image, index) => ({
    name: String(image.name || ""),
    type: String(image.type || ""),
    size: Math.max(0, Number(image.size || 0)),
    order: index + 1,
  }));
  await setDoc(reference, {
    name,
    source: "whatsapp",
    filters: input.filters || {},
    message: String(input.message || ""),
    imageCount: imageMetadata.length,
    imageNames: imageMetadata.map((image) => image.name),
    imageOrder: imageMetadata.map((image) => image.order),
    imageMetadata,
    totalRecipients: Math.max(0, Number(input.totalRecipients || 0)),
    sentCount: Math.max(0, Number(existing?.data()?.sentCount || 0)),
    errorCount: Math.max(0, Number(existing?.data()?.errorCount || 0)),
    progressPercentage: Math.max(0, Number(existing?.data()?.progressPercentage || 0)),
    status: existing?.exists() && existing.data().status !== "draft" ? existing.data().status : "draft",
    snapshotState: "draft",
    active: true,
    deleted: false,
    updatedBy: profile.id,
    updatedByName: profileName(profile),
    updatedAt: serverTimestamp(),
    ...(existing?.exists() ? {} : {
      createdBy: profile.id,
      createdByName: profileName(profile),
      createdAt: serverTimestamp(),
    }),
  }, { merge: true });
  if (!existing?.exists()) {
    await setDoc(doc(collection(db, "auditLogs")), campaignAudit(profile, "whatsappCampaign.created", reference.id, "Campaña de WhatsApp creada", "Se creó un borrador de campaña."));
  }
  return reference.id;
}

async function commitOperations(operations) {
  for (let index = 0; index < operations.length; index += CHUNK_SIZE) {
    const batch = writeBatch(db);
    for (const operation of operations.slice(index, index + CHUNK_SIZE)) operation(batch);
    await batch.commit();
  }
}

export async function replaceCampaignRecipients(profile, campaignId, recipients = []) {
  if (!canCreate(profile)) throw new Error("No tenés permiso para guardar destinatarios.");
  const collectionRef = collection(db, "whatsappCampaigns", campaignId, "recipients");
  const existing = await getDocs(query(collectionRef, limit(MAX_SELECT_ALL)));
  const deleteOperations = existing.docs.map((snapshot) => (batch) => batch.delete(snapshot.ref));
  await commitOperations(deleteOperations);
  const operations = [];
  for (const recipient of recipients) {
    const id = await recipientDocumentId(recipient.phoneNormalized || recipient.phone);
    const reference = doc(collectionRef, id);
    operations.push((batch) => batch.set(reference, {
      recipientId: id,
      clientId: recipient.clientId || null,
      name: recipient.name || null,
      phone: recipient.phoneNormalized || recipient.phone,
      phoneNormalized: recipient.phoneNormalized || recipient.phone,
      whatsappPhone: recipient.whatsappPhone || null,
      zone: recipient.zone || null,
      category: recipient.category || null,
      source: recipient.source,
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  }
  await commitOperations(operations);
  return recipients.length;
}

export async function prepareCampaignSnapshot(profile, input) {
  if (!canCreate(profile)) throw new Error("No tenés permiso para preparar campañas.");
  const campaignId = await saveWhatsAppCampaignDraft(profile, {
    ...input,
    totalRecipients: input.recipients.length,
  }, input.campaignId || null);
  const reference = doc(db, "whatsappCampaigns", campaignId);
  await setDoc(reference, { snapshotState: "writing", status: "draft", updatedAt: serverTimestamp() }, { merge: true });
  try {
    await replaceCampaignRecipients(profile, campaignId, input.recipients);
    await setDoc(reference, {
      totalRecipients: input.recipients.length,
      sentCount: 0,
      errorCount: 0,
      progressPercentage: 0,
      status: "ready",
      snapshotState: "ready",
      preparedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    await setDoc(doc(collection(db, "whatsappCampaigns", campaignId, "events")), {
      type: "prepared",
      label: "Campaña preparada",
      userId: profile.id,
      userName: profileName(profile),
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(collection(db, "auditLogs")), campaignAudit(profile, "whatsappCampaign.prepared", campaignId, "Campaña de WhatsApp preparada", `${input.recipients.length} destinatarios listos.`));
    return campaignId;
  } catch (error) {
    await setDoc(reference, { snapshotState: "error", status: "draft", updatedAt: serverTimestamp() }, { merge: true });
    throw error;
  }
}

export async function recordCampaignDeliveredToExtension(profile, campaignId) {
  if (!canSend(profile)) throw new Error("No tenés permiso para entregar campañas a la extensión.");
  const batch = writeBatch(db);
  batch.set(doc(db, "whatsappCampaigns", campaignId), {
    deliveredToExtensionAt: serverTimestamp(),
    updatedBy: profile.id,
    updatedByName: profileName(profile),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  batch.set(doc(collection(db, "whatsappCampaigns", campaignId, "events")), {
    type: "delivered",
    label: "Entregada a la extensión",
    userId: profile.id,
    userName: profileName(profile),
    createdAt: serverTimestamp(),
  });
  batch.set(doc(collection(db, "auditLogs")), campaignAudit(profile, "whatsappCampaign.delivered", campaignId, "Campaña entregada a extensión", "La extensión aceptó el payload de campaña."));
  await batch.commit();
}

const extensionStatusByType = {
  [EXTENSION_MESSAGE_TYPES.progress]: "running",
  [EXTENSION_MESSAGE_TYPES.paused]: "paused",
  [EXTENSION_MESSAGE_TYPES.completed]: "completed",
  [EXTENSION_MESSAGE_TYPES.error]: "error",
  [EXTENSION_MESSAGE_TYPES.cancelled]: "cancelled",
};

const actionByType = {
  [EXTENSION_MESSAGE_TYPES.progress]: "whatsappCampaign.running",
  [EXTENSION_MESSAGE_TYPES.paused]: "whatsappCampaign.paused",
  [EXTENSION_MESSAGE_TYPES.completed]: "whatsappCampaign.completed",
  [EXTENSION_MESSAGE_TYPES.error]: "whatsappCampaign.error",
  [EXTENSION_MESSAGE_TYPES.cancelled]: "whatsappCampaign.cancelled",
};

export async function applyExtensionCampaignEvent(profile, message) {
  if (!canSend(profile) || !message?.campaignId || !extensionStatusByType[message.type]) return { ignored: true };
  const campaignRef = doc(db, "whatsappCampaigns", message.campaignId);
  const eventRef = doc(collection(db, "whatsappCampaigns", message.campaignId, "events"));
  const auditRef = doc(collection(db, "auditLogs"));
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(campaignRef);
    if (!snapshot.exists()) return { ignored: true };
    const current = snapshot.data();
    const sequence = Number(message.sequence || 0);
    const lastSequence = Number(current.lastExtensionSequence || 0);
    if (sequence && sequence <= lastSequence) return { ignored: true, stale: true };
    const counters = safeCampaignCounters(
      current.totalRecipients,
      message.payload?.sentCount ?? current.sentCount,
      message.payload?.errorCount ?? current.errorCount,
    );
    const status = extensionStatusByType[message.type];
    const update = {
      status,
      sentCount: counters.sent,
      errorCount: counters.errors,
      progressPercentage: counters.progress,
      lastExtensionSequence: sequence || lastSequence + 1,
      lastExtensionUpdateAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...(status === "running" && !current.startedAt ? { startedAt: serverTimestamp() } : {}),
      ...(["completed", "error", "cancelled"].includes(status) ? { finishedAt: serverTimestamp() } : {}),
      ...(status === "error" ? {
        extensionErrorCode: message.payload?.errorCode || "extension_error",
        extensionErrorMessage: message.payload?.message || "La extensión informó un error.",
      } : {}),
      ...(status === "cancelled" ? { cancelledAt: serverTimestamp(), cancelledBy: profile.id } : {}),
    };
    transaction.set(campaignRef, update, { merge: true });
    transaction.set(eventRef, {
      type: message.type,
      label: CAMPAIGN_STATUS_LABELS[status],
      sequence: update.lastExtensionSequence,
      sentCount: counters.sent,
      errorCount: counters.errors,
      progressPercentage: counters.progress,
      message: status === "error" ? update.extensionErrorMessage : null,
      createdAt: serverTimestamp(),
    });
    transaction.set(auditRef, campaignAudit(profile, actionByType[message.type], message.campaignId, `Campaña de WhatsApp ${CAMPAIGN_STATUS_LABELS[status].toLocaleLowerCase("es")}`, `Progreso reportado: ${counters.sent}/${counters.total}.`));
    return { ignored: false, status, ...counters };
  });
}

export async function cancelLocalCampaign(profile, campaign) {
  if (!canCancel(profile)) throw new Error("No tenés permiso para cancelar campañas.");
  if (!campaign?.id) throw new Error("La campaña no está disponible.");
  if (!['draft', 'ready'].includes(campaign.status)) throw new Error("La campaña ya está bajo control de la extensión.");
  const batch = writeBatch(db);
  batch.set(doc(db, "whatsappCampaigns", campaign.id), {
    status: "cancelled",
    cancelledAt: serverTimestamp(),
    cancelledBy: profile.id,
    finishedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  batch.set(doc(collection(db, "whatsappCampaigns", campaign.id, "events")), {
    type: "cancelled",
    label: "Campaña cancelada",
    userId: profile.id,
    userName: profileName(profile),
    createdAt: serverTimestamp(),
  });
  batch.set(doc(collection(db, "auditLogs")), campaignAudit(profile, "whatsappCampaign.cancelled", campaign.id, "Campaña de WhatsApp cancelada", "La campaña fue cancelada antes de su ejecución."));
  await batch.commit();
}

export function campaignSummaryForExtension(campaignId, name, profile, recipients, message) {
  return {
    campaignId,
    campaignName: name,
    createdBy: profile.id,
    recipients: recipients.map((recipient) => ({
      recipientId: recipient.phoneNormalized,
      clientId: recipient.clientId || null,
      name: recipient.name || "",
      phone: recipient.whatsappPhone,
      source: recipient.source,
    })),
    message,
    totalRecipients: recipients.length,
  };
}

export { campaignRecipientDisplayPhone, progressPercentage };
''')

write("src/gestion/marketing/whatsapp/WhatsAppExtensionSync.jsx", r'''
import { useEffect } from "react";
import { useAuth } from "../../AuthContext";
import { can } from "../../permissions";
import { applyExtensionCampaignEvent } from "./campaignService";
import { EXTENSION_MESSAGE_TYPES, subscribeExtensionMessages } from "./extensionBridge";

const campaignEvents = new Set([
  EXTENSION_MESSAGE_TYPES.progress,
  EXTENSION_MESSAGE_TYPES.paused,
  EXTENSION_MESSAGE_TYPES.completed,
  EXTENSION_MESSAGE_TYPES.error,
  EXTENSION_MESSAGE_TYPES.cancelled,
]);

export default function WhatsAppExtensionSync() {
  const { profile } = useAuth();
  useEffect(() => {
    if (!profile?.id || !(can(profile, "marketing", "whatsappSendToExtension") || can(profile, "marketing", "edit"))) return undefined;
    return subscribeExtensionMessages((message) => {
      if (!campaignEvents.has(message.type)) return;
      applyExtensionCampaignEvent(profile, message).catch((error) => {
        console.error("No se pudo aplicar un estado de la extensión", error);
      });
    });
  }, [profile?.id]);
  return null;
}
''')

write("src/gestion/pages/WhatsAppCampaignsPage.jsx", r'''
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  FormField,
  Modal,
  PageHeader,
  Panel,
  SearchInput,
  Skeleton,
  Toast,
} from "../../design-system";
import { Link } from "../../router";
import { useAuth } from "../AuthContext";
import { Icon } from "../components/icons";
import { formatDateTime } from "../formatters";
import { can } from "../permissions";
import {
  ACTIVE_CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUS_TONES,
  MAX_CAMPAIGN_IMAGES,
  analyzeRecipientCandidates,
  campaignRecipientDisplayPhone,
  campaignValidation,
  customerMatchesCampaignFilters,
  extensionPrimaryStatus,
  recipientFromCustomer,
} from "../marketing/whatsapp/campaignDomain";
import { mapExcelRows, readCampaignExcel } from "../marketing/whatsapp/excelImport";
import {
  campaignSummaryForExtension,
  cancelLocalCampaign,
  getWhatsAppCampaign,
  listAllCampaignCustomers,
  listCampaignCustomerFilterOptions,
  listCampaignCustomerPage,
  listCampaignEvents,
  listCampaignRecipients,
  listWhatsAppCampaignsPage,
  prepareCampaignSnapshot,
  recordCampaignDeliveredToExtension,
  replaceCampaignRecipients,
  saveWhatsAppCampaignDraft,
} from "../marketing/whatsapp/campaignService";
import {
  EXTENSION_MESSAGE_TYPES,
  pingWhatsAppExtension,
  prepareCampaignForExtension,
  requestCampaignCancellation,
  subscribeExtensionMessages,
} from "../marketing/whatsapp/extensionBridge";

const steps = ["Información", "Destinatarios", "Mensaje", "Imágenes", "Revisión"];
const emptyFilters = { zoneId: "", zoneName: "", category: "", search: "" };

function imageMetadata(images) {
  return images.map((item, index) => ({ name: item.file.name, type: item.file.type, size: item.file.size, order: index + 1 }));
}

function ExtensionStatus({ status, refreshing, onRefresh }) {
  const primary = extensionPrimaryStatus(status);
  return (
    <section className={`fm-wa-extension is-${primary.operational ? "operational" : "error"}`} aria-live="polite">
      <div className="fm-wa-extension__state">
        <span className="fm-wa-extension__icon"><Icon name={primary.operational ? "Check" : "AlertTriangle"} /></span>
        <div><small>Estado de la extensión</small><strong>{primary.label}</strong><p>{primary.message}</p></div>
      </div>
      <Button variant="secondary" icon="RefreshCw" loading={refreshing} onClick={onRefresh}>Comprobar</Button>
      <div className="fm-wa-extension__limits">
        <span><b>{Number(status.configuredLimit || 0).toLocaleString("es-AR")}</b><small>Límite configurado</small></span>
        <span><b>{Number(status.sentToday || 0).toLocaleString("es-AR")}</b><small>Enviados hoy</small></span>
        <span><b>{Number(status.availableToday || 0).toLocaleString("es-AR")}</b><small>Disponibles</small></span>
      </div>
    </section>
  );
}

function RecipientRows({ recipients, excluded, onToggleExclude }) {
  if (!recipients.length) return <EmptyState icon="UsersRound" title="Sin destinatarios" description="Seleccioná clientes o importá un Excel para continuar." />;
  return (
    <div className="fm-wa-recipient-list">
      {recipients.map((recipient) => {
        const key = recipient.phoneNormalized;
        const isExcluded = excluded.has(key);
        return (
          <article key={key} className={`fm-wa-recipient ${isExcluded ? "is-excluded" : ""}`}>
            <label>
              <input type="checkbox" checked={!isExcluded} onChange={() => onToggleExclude(key)} />
              <span><strong>{recipient.name || "Sin nombre"}</strong><small>{campaignRecipientDisplayPhone(recipient)} · {recipient.zone || "Sin zona"}{recipient.category ? ` · ${recipient.category}` : ""}</small></span>
            </label>
            <Badge tone={recipient.source === "flor_mia" ? "success" : "neutral"}>{recipient.source === "flor_mia" ? "Flor Mía" : "Excel"}</Badge>
          </article>
        );
      })}
    </div>
  );
}

function CampaignWizard({ profile, extensionStatus, initialCampaign, onClose, onSaved }) {
  const [step, setStep] = useState(0);
  const [campaignId, setCampaignId] = useState(initialCampaign?.id || "");
  const [name, setName] = useState(initialCampaign?.name || "");
  const [message, setMessage] = useState(initialCampaign?.message || "");
  const [filters, setFilters] = useState({ ...emptyFilters, ...(initialCampaign?.filters || {}) });
  const [customers, setCustomers] = useState([]);
  const [customerCursor, setCustomerCursor] = useState(null);
  const [hasMoreCustomers, setHasMoreCustomers] = useState(true);
  const [customerBusy, setCustomerBusy] = useState(false);
  const [filterOptions, setFilterOptions] = useState({ zones: [], categories: [] });
  const [selectedFlor, setSelectedFlor] = useState(new Map());
  const [excelSheet, setExcelSheet] = useState(null);
  const [excelMapping, setExcelMapping] = useState({ phone: "", name: "", zone: "", category: "", notes: "" });
  const [excelCandidates, setExcelCandidates] = useState([]);
  const [excluded, setExcluded] = useState(new Set());
  const [images, setImages] = useState([]);
  const [persistedImageMetadata] = useState(initialCampaign?.imageMetadata || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const imageRef = useRef([]);

  const canImport = can(profile, "marketing", "whatsappImportExcel") || can(profile, "marketing", "create");
  const canSend = can(profile, "marketing", "whatsappSendToExtension") || can(profile, "marketing", "edit");

  useEffect(() => {
    imageRef.current = images;
  }, [images]);

  useEffect(() => () => {
    for (const item of imageRef.current) URL.revokeObjectURL(item.url);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listCampaignCustomerPage(profile, { pageSize: 100 }),
      listCampaignCustomerFilterOptions(profile),
      initialCampaign?.id ? listCampaignRecipients(profile, initialCampaign.id) : Promise.resolve([]),
    ]).then(([page, options, existingRecipients]) => {
      if (cancelled) return;
      setCustomers(page.items);
      setCustomerCursor(page.cursor);
      setHasMoreCustomers(page.hasMore);
      setFilterOptions(options);
      if (existingRecipients.length) {
        const flor = new Map();
        const excel = [];
        for (const recipient of existingRecipients) {
          if (recipient.source === "flor_mia") flor.set(recipient.phoneNormalized, recipient);
          else excel.push(recipient);
        }
        setSelectedFlor(flor);
        setExcelCandidates(excel);
      }
    }).catch((cause) => setError(cause.message));
    return () => { cancelled = true; };
  }, [profile.id, initialCampaign?.id]);

  const filteredCustomers = useMemo(
    () => customers.filter((customer) => customerMatchesCampaignFilters(customer, filters)),
    [customers, filters],
  );
  const analysis = useMemo(
    () => analyzeRecipientCandidates([...selectedFlor.values(), ...excelCandidates]),
    [selectedFlor, excelCandidates],
  );
  const recipients = useMemo(
    () => analysis.recipients.filter((recipient) => !excluded.has(recipient.phoneNormalized)),
    [analysis.recipients, excluded],
  );
  const validation = campaignValidation({ name, recipients, message, images, extensionStatus, persistedImageMetadata });

  const toggleFlorCustomer = (customer) => {
    const recipient = recipientFromCustomer(customer);
    const normalized = recipient.phone && analyzeRecipientCandidates([recipient]).recipients[0];
    if (!normalized) return;
    setSelectedFlor((current) => {
      const next = new Map(current);
      if (next.has(normalized.phoneNormalized)) next.delete(normalized.phoneNormalized);
      else next.set(normalized.phoneNormalized, recipient);
      return next;
    });
    setExcluded((current) => {
      const next = new Set(current);
      next.delete(normalized.phoneNormalized);
      return next;
    });
  };

  const loadMoreCustomers = async () => {
    if (!hasMoreCustomers || customerBusy) return;
    setCustomerBusy(true);
    try {
      const page = await listCampaignCustomerPage(profile, { pageSize: 100, cursor: customerCursor });
      setCustomers((current) => [...current, ...page.items]);
      setCustomerCursor(page.cursor);
      setHasMoreCustomers(page.hasMore);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setCustomerBusy(false);
    }
  };

  const selectAllResults = async () => {
    setCustomerBusy(true);
    setError("");
    try {
      const zone = filterOptions.zones.find((item) => item.id === filters.zoneId);
      const all = await listAllCampaignCustomers(profile, { ...filters, zoneName: zone?.name || filters.zoneName });
      setSelectedFlor((current) => {
        const next = new Map(current);
        for (const customer of all) {
          const recipient = recipientFromCustomer(customer);
          const normalized = analyzeRecipientCandidates([recipient]).recipients[0];
          if (normalized) next.set(normalized.phoneNormalized, recipient);
        }
        return next;
      });
      setNotice(`${all.length} clientes habilitados incorporados a la selección.`);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setCustomerBusy(false);
    }
  };

  const importExcel = async (file) => {
    setError("");
    try {
      const sheet = await readCampaignExcel(file);
      setExcelSheet(sheet);
      setExcelMapping(sheet.mapping);
    } catch (cause) {
      setExcelSheet(null);
      setError(cause.message);
    }
  };

  const confirmExcel = () => {
    try {
      const mapped = mapExcelRows(excelSheet, excelMapping);
      setExcelCandidates(mapped);
      setNotice(`${mapped.length} registros de Excel incorporados para validar.`);
    } catch (cause) {
      setError(cause.message);
    }
  };

  const addImages = (files) => {
    const incoming = [...files].filter((file) => file.type.startsWith("image/"));
    if (images.length + incoming.length > MAX_CAMPAIGN_IMAGES) {
      setError("La campaña admite como máximo 3 imágenes.");
      return;
    }
    setImages((current) => [...current, ...incoming.map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }))]);
  };

  const removeImage = (id) => {
    setImages((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((item) => item.id !== id);
    });
  };

  const moveImage = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= images.length) return;
    setImages((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const saveDraft = async () => {
    setBusy(true);
    setError("");
    try {
      const id = await saveWhatsAppCampaignDraft(profile, {
        name,
        filters,
        message,
        imageMetadata: imageMetadata(images).length ? imageMetadata(images) : persistedImageMetadata,
        totalRecipients: recipients.length,
      }, campaignId || null);
      await replaceCampaignRecipients(profile, id, recipients);
      setCampaignId(id);
      setNotice("Borrador guardado.");
      onSaved?.();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  const prepare = async () => {
    if (!validation.valid || !canSend) return;
    setBusy(true);
    setError("");
    try {
      const id = await prepareCampaignSnapshot(profile, {
        campaignId: campaignId || null,
        name,
        filters,
        message,
        imageMetadata: imageMetadata(images),
        recipients,
      });
      setCampaignId(id);
      const payload = campaignSummaryForExtension(id, name, profile, recipients, message);
      await prepareCampaignForExtension(payload, images);
      await recordCampaignDeliveredToExtension(profile, id);
      for (const image of images) URL.revokeObjectURL(image.url);
      setImages([]);
      setNotice("La extensión aceptó la campaña.");
      onSaved?.();
      onClose();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fm-wa-wizard fm-page-enter">
      <PageHeader
        eyebrow="Marketing · WhatsApp"
        title={initialCampaign ? "Continuar campaña" : "Nueva campaña de WhatsApp"}
        description="Prepará destinatarios, contenido y multimedia. La ejecución técnica sucede exclusivamente en la extensión privada."
        actions={<Button variant="secondary" icon="ArrowLeft" onClick={onClose}>Volver</Button>}
      />
      <nav className="fm-wa-steps" aria-label="Etapas de campaña">{steps.map((label, index) => <button key={label} type="button" className={step === index ? "is-active" : ""} onClick={() => setStep(index)} aria-current={step === index ? "step" : undefined}><span>{index + 1}</span>{label}</button>)}</nav>
      {error ? <Toast tone="error">{error}</Toast> : null}
      {notice ? <Toast tone="success">{notice}</Toast> : null}

      {step === 0 ? <Panel title="Información" description="Nombre administrativo de la campaña."><div className="fm-wa-form"><FormField label="Nombre interno" required><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Promoción aceite Microcentro — Agosto 2026" /></FormField><div className="fm-wa-readonly"><span>Estado</span><Badge tone="neutral">Borrador</Badge></div></div></Panel> : null}

      {step === 1 ? <div className="fm-wa-stack">
        <Panel title="Clientes de Flor Mía" description="Sólo se ofrecen clientes activos y no bloqueados explícitamente para comunicaciones.">
          <div className="fm-wa-filter-grid">
            <SearchInput label="Buscar por nombre o teléfono" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} />
            <label><span>Zona</span><select value={filters.zoneId} onChange={(event) => setFilters((current) => ({ ...current, zoneId: event.target.value }))}><option value="">Todas las zonas</option>{filterOptions.zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></label>
            <label><span>Categoría</span><select value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}><option value="">Todas las categorías</option>{filterOptions.categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          </div>
          <div className="fm-wa-list-actions"><Button variant="secondary" loading={customerBusy} onClick={selectAllResults}>Seleccionar todos los resultados</Button><span>{filteredCustomers.length} visibles en este bloque</span></div>
          <div className="fm-wa-customer-list">{filteredCustomers.map((customer) => { const candidate = analyzeRecipientCandidates([recipientFromCustomer(customer)]).recipients[0]; const selected = candidate && selectedFlor.has(candidate.phoneNormalized); return <label key={customer.id} className="fm-wa-customer-row"><input type="checkbox" checked={Boolean(selected)} onChange={() => toggleFlorCustomer(customer)} /><span><strong>{customer.name || "Sin nombre"}</strong><small>{candidate ? campaignRecipientDisplayPhone(candidate) : "Teléfono inválido"} · {customer.zoneName || customer.customZone || "Sin zona"}{(customer.category || customer.segment) ? ` · ${customer.category || customer.segment}` : ""}</small></span></label>; })}</div>
          {hasMoreCustomers ? <div className="fm-load-more"><Button variant="secondary" loading={customerBusy} onClick={loadMoreCustomers}>Cargar más clientes</Button></div> : null}
        </Panel>

        {canImport ? <Panel title="Importar desde Excel" description="El archivo se procesa localmente y no se sube a Firebase.">
          <div className="fm-wa-excel"><label className="fm-wa-file"><span>Seleccionar .xlsx</span><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => importExcel(event.target.files?.[0])} /></label>{excelSheet ? <><p><strong>{excelSheet.fileName}</strong> · {excelSheet.rows.length} filas detectadas</p><div className="fm-wa-mapping">{[["phone","Teléfono *"],["name","Nombre"],["zone","Zona"],["category","Categoría"],["notes","Observaciones"]].map(([field,label]) => <label key={field}><span>{label}</span><select value={excelMapping[field]} onChange={(event) => setExcelMapping((current) => ({ ...current, [field]: event.target.value }))}><option value="">Sin mapear</option>{excelSheet.headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}</div><Button variant="secondary" onClick={confirmExcel}>Confirmar importación</Button></> : null}</div>
        </Panel> : null}

        <Panel title={`Destinatarios seleccionados: ${recipients.length}`} description="Un mismo teléfono normalizado aparece una sola vez; Flor Mía tiene prioridad sobre Excel.">
          <div className="fm-wa-validation" aria-live="polite"><span><b>{analysis.totalFound}</b>Total encontrado</span><span><b>{analysis.valid}</b>Válidos únicos</span><span><b>{analysis.invalid}</b>Inválidos</span><span><b>{analysis.duplicates}</b>Duplicados</span><span><b>{analysis.missingPhone}</b>Sin teléfono</span></div>
          <RecipientRows recipients={analysis.recipients} excluded={excluded} onToggleExclude={(phone) => setExcluded((current) => { const next = new Set(current); next.has(phone) ? next.delete(phone) : next.add(phone); return next; })} />
        </Panel>
      </div> : null}

      {step === 2 ? <Panel title="Mensaje de WhatsApp" description="El mismo texto se enviará a todos. La arquitectura queda preparada para placeholders futuros como {{nombre}}."><div className="fm-wa-message-grid"><FormField label="Mensaje de WhatsApp"><textarea rows="12" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Escribí el mensaje…" /></FormField><div className="fm-wa-preview"><span>Vista previa</span><div>{message || "El mensaje aparecerá aquí."}</div><small>Representación aproximada; no reproduce pixel-perfect WhatsApp Web.</small></div></div></Panel> : null}

      {step === 3 ? <Panel title="Imágenes" description="Podés agregar 0–3 imágenes. Los archivos viven sólo en memoria hasta transferirse a la extensión.">
        {persistedImageMetadata.length && !images.length ? <Toast tone="info">Este borrador tenía {persistedImageMetadata.length} imagen(es). Volvé a seleccionarlas antes de preparar la campaña; sólo se conservaron nombre y orden.</Toast> : null}
        <label className="fm-wa-file"><span>Agregar imágenes</span><input type="file" accept="image/*" multiple onChange={(event) => { addImages(event.target.files || []); event.target.value = ""; }} /></label>
        <div className="fm-wa-images">{images.map((item, index) => <article key={item.id}><img src={item.url} alt={`Imagen ${index + 1}: ${item.file.name}`} /><div><strong>Imagen {index + 1}</strong><span>{item.file.name}</span><small>{Math.round(item.file.size / 1024)} KB</small></div><div className="fm-wa-image-actions"><button type="button" onClick={() => moveImage(index, -1)} disabled={index === 0} aria-label={`Mover ${item.file.name} arriba`}><Icon name="ChevronLeft" /></button><button type="button" onClick={() => moveImage(index, 1)} disabled={index === images.length - 1} aria-label={`Mover ${item.file.name} abajo`}><Icon name="ChevronRight" /></button><button type="button" onClick={() => removeImage(item.id)} aria-label={`Eliminar ${item.file.name}`}><Icon name="X" /></button></div></article>)}</div>
        <p className="fm-wa-order"><strong>Orden definido por Flor Mía:</strong> {images.length ? `${images.map((_, index) => `Imagen ${index + 1}`).join(" → ")} → ${message.trim() ? "Texto" : "sin texto"}` : message.trim() ? "Texto" : "Sin contenido todavía"}</p>
      </Panel> : null}

      {step === 4 ? <div className="fm-wa-stack">
        <ExtensionStatus status={extensionStatus} refreshing={false} onRefresh={() => {}} />
        <Panel title="Revisión final" description="Confirmá el contenido antes de entregarlo a la extensión."><dl className="fm-wa-review"><div><dt>Campaña</dt><dd>{name || "Sin nombre"}</dd></div><div><dt>Destinatarios</dt><dd>{recipients.length} mensajes/contactos seleccionados</dd></div><div><dt>Segmentación</dt><dd>{[filters.zoneId && (filterOptions.zones.find((zone) => zone.id === filters.zoneId)?.name), filters.category].filter(Boolean).join(" + ") || "Selección manual / sin filtro"}</dd></div><div><dt>Multimedia</dt><dd>{images.length} imagen(es) · {images.map((item) => item.file.name).join(" → ") || "Sin imágenes"}</dd></div><div><dt>Mensaje</dt><dd className="fm-wa-review-message">{message || "Sin texto"}</dd></div><div><dt>Extensión</dt><dd>{extensionPrimaryStatus(extensionStatus).label}</dd></div></dl>
          {extensionStatus.availableToday > 0 && recipients.length > extensionStatus.availableToday ? <Toast tone="info">La selección supera los disponibles informados por la extensión hoy. La extensión conserva la autoridad final sobre el límite de ejecución.</Toast> : null}
          {!validation.valid ? <div className="fm-wa-errors" role="alert"><strong>Antes de preparar:</strong><ul>{validation.errors.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          <Button icon="Megaphone" loading={busy} disabled={!validation.valid || !canSend} onClick={prepare}>Preparar campaña para extensión</Button>
        </Panel>
      </div> : null}

      <div className="fm-wa-wizard-actions"><Button variant="secondary" disabled={step === 0 || busy} onClick={() => setStep((current) => Math.max(0, current - 1))}>Anterior</Button><Button variant="secondary" loading={busy} onClick={saveDraft}>Guardar borrador</Button>{step < steps.length - 1 ? <Button disabled={step === 0 && !name.trim()} onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))}>Continuar</Button> : null}</div>
    </div>
  );
}

function CampaignDetail({ campaign, profile, onClose, onContinue, onChanged }) {
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { listCampaignEvents(profile, campaign.id).then(setEvents).catch((cause) => setError(cause.message)); }, [campaign.id, profile.id]);
  const cancel = async () => {
    setBusy(true);
    setError("");
    try {
      if (["draft", "ready"].includes(campaign.status)) await cancelLocalCampaign(profile, campaign);
      else if (["running", "paused"].includes(campaign.status)) {
        const response = await requestCampaignCancellation(campaign.id);
        if (response.type === EXTENSION_MESSAGE_TYPES.error) throw new Error(response.payload?.message || "La extensión no pudo cancelar la campaña.");
      }
      onChanged();
      onClose();
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  };
  const canCancel = can(profile, "marketing", "whatsappCancelCampaign") || can(profile, "marketing", "edit");
  return <Modal open onClose={onClose} title={campaign.name} description="Detalle de campaña de WhatsApp" footer={<div className="fm-dialog-actions"><Button variant="secondary" onClick={onClose}>Cerrar</Button>{campaign.status === "draft" ? <Button onClick={onContinue}>Continuar borrador</Button> : null}{canCancel && ["draft","ready","running","paused"].includes(campaign.status) ? <Button variant="secondary" loading={busy} onClick={cancel}>Cancelar campaña</Button> : null}</div>}>
    {error ? <Toast tone="error">{error}</Toast> : null}
    <dl className="fm-wa-review"><div><dt>Estado</dt><dd><Badge tone={CAMPAIGN_STATUS_TONES[campaign.status] || "neutral"}>{CAMPAIGN_STATUS_LABELS[campaign.status] || campaign.status}</Badge></dd></div><div><dt>Creador</dt><dd>{campaign.createdByName || campaign.createdBy}</dd></div><div><dt>Fecha</dt><dd>{formatDateTime(campaign.createdAt)}</dd></div><div><dt>Destinatarios</dt><dd>{campaign.totalRecipients || 0}</dd></div><div><dt>Enviados</dt><dd>{campaign.sentCount || 0} · {campaign.progressPercentage || 0}%</dd></div><div><dt>Errores</dt><dd>{campaign.errorCount || 0}{campaign.extensionErrorMessage ? ` · ${campaign.extensionErrorMessage}` : ""}</dd></div><div><dt>Segmentación</dt><dd>{Object.entries(campaign.filters || {}).filter(([,value]) => value).map(([key,value]) => `${key}: ${value}`).join(" · ") || "Sin filtros guardados"}</dd></div><div><dt>Mensaje</dt><dd className="fm-wa-review-message">{campaign.message || "Sin texto"}</dd></div><div><dt>Imágenes</dt><dd>{(campaign.imageMetadata || []).map((image) => `${image.order}. ${image.name}`).join(" · ") || "Sin imágenes persistidas"}</dd></div><div><dt>Inicio / fin</dt><dd>{campaign.startedAt ? formatDateTime(campaign.startedAt) : "—"} / {campaign.finishedAt ? formatDateTime(campaign.finishedAt) : "—"}</dd></div></dl>
    <h3>Eventos relevantes</h3><div className="fm-wa-events">{events.length ? events.map((event) => <div key={event.id}><strong>{event.label || event.type}</strong><span>{formatDateTime(event.createdAt)}</span>{event.message ? <small>{event.message}</small> : null}</div>) : <p>Sin eventos adicionales.</p>}</div>
  </Modal>;
}

export default function WhatsAppCampaignsPage() {
  const { profile } = useAuth();
  const [extensionStatus, setExtensionStatus] = useState({ operational: false, message: "Comprobando extensión…", configuredLimit: 0, sentToday: 0, availableToday: 0 });
  const [extensionBusy, setExtensionBusy] = useState(false);
  const [campaigns, setCampaigns] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [wizard, setWizard] = useState(null);
  const [detail, setDetail] = useState(null);

  const canCreate = can(profile, "marketing", "whatsappCreateCampaign") || can(profile, "marketing", "create");

  const refreshExtension = async () => {
    setExtensionBusy(true);
    const status = await pingWhatsAppExtension();
    setExtensionStatus(status);
    setExtensionBusy(false);
  };

  const loadCampaigns = async ({ append = false } = {}) => {
    setLoading(true);
    setError("");
    try {
      const page = await listWhatsAppCampaignsPage(profile, { pageSize: 20, cursor: append ? cursor : null });
      setCampaigns((current) => append ? [...current, ...page.items] : page.items);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch (cause) { setError(cause.message); } finally { setLoading(false); }
  };

  useEffect(() => {
    refreshExtension();
    loadCampaigns();
    const interval = window.setInterval(refreshExtension, 20000);
    const unsubscribe = subscribeExtensionMessages((message) => {
      if (message.type === EXTENSION_MESSAGE_TYPES.status) {
        setExtensionStatus({
          operational: message.payload.operational === true,
          message: message.payload.message || (message.payload.operational ? "La extensión está lista." : "La extensión requiere revisión."),
          configuredLimit: Number(message.payload.configuredLimit || 0),
          sentToday: Number(message.payload.sentToday || 0),
          availableToday: Number(message.payload.availableToday || 0),
          errorCode: message.payload.errorCode || "",
          extensionVersion: message.payload.extensionVersion || "",
        });
      }
      if ([EXTENSION_MESSAGE_TYPES.progress, EXTENSION_MESSAGE_TYPES.paused, EXTENSION_MESSAGE_TYPES.completed, EXTENSION_MESSAGE_TYPES.error, EXTENSION_MESSAGE_TYPES.cancelled].includes(message.type)) {
        window.setTimeout(() => loadCampaigns(), 350);
      }
    });
    return () => { window.clearInterval(interval); unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  const activeCampaigns = campaigns.filter((campaign) => ACTIVE_CAMPAIGN_STATUSES.has(campaign.status));
  const openCampaign = async (campaign) => {
    try { setDetail(await getWhatsAppCampaign(profile, campaign.id)); } catch (cause) { setError(cause.message); }
  };
  const continueDraft = async () => {
    const campaign = detail;
    setDetail(null);
    setWizard(campaign);
  };

  if (wizard !== null) return <CampaignWizard profile={profile} extensionStatus={extensionStatus} initialCampaign={wizard?.id ? wizard : null} onClose={() => setWizard(null)} onSaved={() => loadCampaigns()} />;

  return <div className="fm-page-enter fm-wa-page">
    <PageHeader eyebrow="Marketing · WhatsApp" title="Campañas y mensajes masivos" description="Flor Mía prepara y administra campañas; la extensión privada ejecuta técnicamente WhatsApp Web." actions={<div className="fm-page-actions"><Link className="fm-button fm-button--secondary" to="/gestion/marketing"><Icon name="ArrowLeft" />Marketing</Link>{canCreate ? <Button icon="Plus" onClick={() => setWizard({})}>Nueva campaña de WhatsApp</Button> : null}</div>} />
    <ExtensionStatus status={extensionStatus} refreshing={extensionBusy} onRefresh={refreshExtension} />
    {error ? <Toast tone="error">{error}</Toast> : null}
    {activeCampaigns.length ? <Panel title="Resumen operativo" description="Campañas que todavía dependen de actualizaciones de la extensión."><div className="fm-wa-active-grid">{activeCampaigns.map((campaign) => <button type="button" key={campaign.id} onClick={() => openCampaign(campaign)}><strong>{campaign.name}</strong><span>{campaign.sentCount || 0} / {campaign.totalRecipients || 0}</span><progress max="100" value={campaign.progressPercentage || 0}>{campaign.progressPercentage || 0}%</progress><Badge tone={CAMPAIGN_STATUS_TONES[campaign.status] || "neutral"}>{CAMPAIGN_STATUS_LABELS[campaign.status] || campaign.status}</Badge></button>)}</div></Panel> : null}
    <Panel title="Historial de campañas" description="Más recientes primero. Se cargan 20 campañas por página.">
      {loading && !campaigns.length ? <Skeleton lines={6} /> : null}
      {!loading && !campaigns.length ? <EmptyState icon="Megaphone" title="Todavía no hay campañas de WhatsApp" description="Creá la primera campaña cuando necesites preparar un envío." /> : null}
      <div className="fm-wa-history">{campaigns.map((campaign) => <button type="button" key={campaign.id} onClick={() => openCampaign(campaign)}><span className="fm-wa-history__main"><strong>{campaign.name}</strong><small>{formatDateTime(campaign.createdAt)} · {campaign.totalRecipients || 0} destinatarios</small></span><span>{campaign.sentCount || 0} enviados · {campaign.progressPercentage || 0}%</span><Badge tone={CAMPAIGN_STATUS_TONES[campaign.status] || "neutral"}>{CAMPAIGN_STATUS_LABELS[campaign.status] || campaign.status}</Badge>{campaign.extensionErrorMessage ? <small className="fm-wa-history__error">{campaign.extensionErrorMessage}</small> : null}</button>)}</div>
      {hasMore ? <div className="fm-load-more"><Button variant="secondary" loading={loading} onClick={() => loadCampaigns({ append: true })}>Cargar más campañas</Button></div> : null}
    </Panel>
    {detail ? <CampaignDetail campaign={detail} profile={profile} onClose={() => setDetail(null)} onContinue={continueDraft} onChanged={() => loadCampaigns()} /> : null}
  </div>;
}
''')

write("src/styles/whatsapp-marketing.css", r'''
.fm-wa-page,.fm-wa-wizard{display:grid;gap:18px}.fm-wa-stack{display:grid;gap:16px}.fm-wa-extension{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px 18px;align-items:center;padding:18px 20px;border:1px solid var(--fm-border,#e2d8c7);border-radius:16px;background:#fff;box-shadow:0 8px 28px rgb(53 42 25/6%)}.fm-wa-extension.is-operational{border-left:5px solid #2f7d4a}.fm-wa-extension.is-error{border-left:5px solid #b64040}.fm-wa-extension__state{display:flex;gap:12px;align-items:flex-start}.fm-wa-extension__icon{display:grid;place-items:center;width:42px;height:42px;border-radius:50%;background:#f5f0e6}.fm-wa-extension.is-operational .fm-wa-extension__icon{color:#2f7d4a;background:#edf7ef}.fm-wa-extension.is-error .fm-wa-extension__icon{color:#b64040;background:#fff0f0}.fm-wa-extension__state small,.fm-wa-extension__state p{display:block;margin:0;color:#6d655c}.fm-wa-extension__state strong{display:block;margin:2px 0;font-size:1.05rem}.fm-wa-extension__limits{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.fm-wa-extension__limits span{padding:10px 12px;border-radius:12px;background:#f8f5ef}.fm-wa-extension__limits b,.fm-wa-extension__limits small{display:block}.fm-wa-extension__limits small{color:#71695f}.fm-wa-steps{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;overflow-x:auto;padding-bottom:4px}.fm-wa-steps button{min-height:48px;border:1px solid #ded4c4;border-radius:12px;background:#fff;color:#302b26;font-weight:700;display:flex;align-items:center;justify-content:center;gap:7px;padding:8px 10px;white-space:nowrap}.fm-wa-steps button span{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#f1eadf}.fm-wa-steps button.is-active{border-color:#b8892d;box-shadow:0 0 0 2px rgb(184 137 45/12%)}.fm-wa-steps button.is-active span{background:#b8892d;color:#fff}.fm-wa-form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:end}.fm-wa-readonly{display:grid;gap:6px;min-width:150px}.fm-wa-filter-grid{display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px;align-items:end}.fm-wa-filter-grid label,.fm-wa-mapping label{display:grid;gap:6px;font-size:.86rem;font-weight:700}.fm-wa-filter-grid select,.fm-wa-mapping select{min-height:44px;border:1px solid #d9d0c2;border-radius:10px;background:#fff;padding:0 10px;color:#211f1b}.fm-wa-list-actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin:14px 0}.fm-wa-customer-list,.fm-wa-recipient-list{display:grid;gap:7px;max-height:420px;overflow:auto;padding-right:4px}.fm-wa-customer-row,.fm-wa-recipient label{display:flex;align-items:center;gap:10px;min-height:52px;padding:9px 11px;border:1px solid #ece5da;border-radius:11px;background:#fff}.fm-wa-customer-row input,.fm-wa-recipient input{width:20px;height:20px;flex:0 0 auto}.fm-wa-customer-row span,.fm-wa-recipient label span{min-width:0;display:grid;gap:2px}.fm-wa-customer-row small,.fm-wa-recipient small{color:#736a60}.fm-wa-recipient{position:relative;display:flex;gap:12px;align-items:center;justify-content:space-between}.fm-wa-recipient label{flex:1}.fm-wa-recipient.is-excluded{opacity:.55}.fm-wa-validation{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:14px}.fm-wa-validation span{padding:10px;border:1px solid #ebe2d5;border-radius:10px;background:#faf8f4}.fm-wa-validation b{display:block;font-size:1.1rem}.fm-wa-excel{display:grid;gap:12px}.fm-wa-file{display:flex;align-items:center;justify-content:center;min-height:52px;border:1px dashed #b9a989;border-radius:12px;background:#faf7f1;cursor:pointer;font-weight:700;position:relative;overflow:hidden}.fm-wa-file input{position:absolute;inset:0;opacity:0;cursor:pointer}.fm-wa-mapping{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.fm-wa-message-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.72fr);gap:18px}.fm-wa-message-grid textarea{width:100%;resize:vertical;min-height:240px}.fm-wa-preview{display:grid;align-content:start;gap:9px}.fm-wa-preview>span{font-weight:800}.fm-wa-preview>div{white-space:pre-wrap;overflow-wrap:anywhere;min-height:180px;padding:16px;border-radius:16px 16px 16px 4px;background:#edf7ef;border:1px solid #d5e7d8}.fm-wa-preview small{color:#6d655d}.fm-wa-images{display:grid;gap:10px;margin-top:14px}.fm-wa-images article{display:grid;grid-template-columns:76px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px;border:1px solid #e7ded1;border-radius:12px}.fm-wa-images img{width:76px;height:64px;object-fit:cover;border-radius:9px}.fm-wa-images article>div:nth-child(2){display:grid;gap:2px;min-width:0}.fm-wa-images article span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fm-wa-image-actions{display:flex;gap:5px}.fm-wa-image-actions button{width:44px;height:44px;display:grid;place-items:center;border:1px solid #ddd3c4;border-radius:9px;background:#fff}.fm-wa-order{margin:14px 0 0;padding:12px;border-radius:10px;background:#f8f4ec}.fm-wa-review{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:#e6ded1;border:1px solid #e6ded1;border-radius:12px;overflow:hidden;margin:0 0 16px}.fm-wa-review>div{background:#fff;padding:12px 14px}.fm-wa-review dt{font-size:.78rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#746b60}.fm-wa-review dd{margin:4px 0 0;overflow-wrap:anywhere}.fm-wa-review-message{white-space:pre-wrap}.fm-wa-errors{padding:12px 14px;border:1px solid #e7bcbc;background:#fff3f3;border-radius:10px;margin:12px 0}.fm-wa-errors ul{margin:7px 0 0;padding-left:20px}.fm-wa-wizard-actions{position:sticky;bottom:10px;z-index:5;display:flex;justify-content:flex-end;gap:8px;padding:10px;border:1px solid #e6ddcf;border-radius:14px;background:rgb(255 255 255/94%);backdrop-filter:blur(10px)}.fm-wa-active-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.fm-wa-active-grid button,.fm-wa-history button{border:1px solid #e7ded1;border-radius:12px;background:#fff;color:inherit;text-align:left;cursor:pointer}.fm-wa-active-grid button{display:grid;gap:7px;padding:13px}.fm-wa-active-grid progress{width:100%}.fm-wa-history{display:grid;gap:8px}.fm-wa-history button{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(130px,.7fr) auto;align-items:center;gap:12px;padding:12px 14px}.fm-wa-history__main{display:grid;gap:3px;min-width:0}.fm-wa-history__main small{color:#71685f}.fm-wa-history__error{grid-column:1/-1;color:#a43e3e}.fm-wa-events{display:grid;gap:7px;max-height:260px;overflow:auto}.fm-wa-events>div{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;padding:9px 0;border-bottom:1px solid #eee7dc}.fm-wa-events small{grid-column:1/-1;color:#8b3b3b}
@media(max-width:900px){.fm-wa-filter-grid{grid-template-columns:1fr 1fr}.fm-wa-filter-grid .fm-search-input{grid-column:1/-1}.fm-wa-mapping{grid-template-columns:repeat(2,minmax(0,1fr))}.fm-wa-message-grid{grid-template-columns:1fr}.fm-wa-active-grid{grid-template-columns:1fr 1fr}.fm-wa-history button{grid-template-columns:minmax(0,1fr) auto}.fm-wa-history button>span:nth-child(2){grid-column:1/-1}.fm-wa-review{grid-template-columns:1fr}}
@media(max-width:640px){.fm-wa-extension{grid-template-columns:1fr}.fm-wa-extension>.fm-button{justify-self:start}.fm-wa-extension__limits{grid-template-columns:1fr 1fr 1fr}.fm-wa-steps{grid-template-columns:repeat(5,minmax(132px,1fr));margin-inline:-4px}.fm-wa-form,.fm-wa-filter-grid,.fm-wa-mapping{grid-template-columns:1fr}.fm-wa-filter-grid .fm-search-input{grid-column:auto}.fm-wa-validation{grid-template-columns:1fr 1fr}.fm-wa-active-grid{grid-template-columns:1fr}.fm-wa-history button{grid-template-columns:1fr;gap:7px}.fm-wa-history button>.fm-badge{justify-self:start}.fm-wa-images article{grid-template-columns:64px minmax(0,1fr)}.fm-wa-images img{width:64px;height:58px}.fm-wa-image-actions{grid-column:1/-1;justify-content:flex-end}.fm-wa-wizard-actions{display:grid;grid-template-columns:1fr 1fr}.fm-wa-wizard-actions .fm-button:last-child:nth-child(3){grid-column:1/-1}.fm-wa-recipient{align-items:stretch;flex-direction:column}.fm-wa-recipient>.fm-badge{align-self:flex-start}}
@media(max-width:390px){.fm-wa-extension__limits{grid-template-columns:1fr}.fm-wa-validation{grid-template-columns:1fr}.fm-wa-wizard-actions{grid-template-columns:1fr}.fm-wa-wizard-actions .fm-button:last-child:nth-child(3){grid-column:auto}}
@media(prefers-reduced-motion:reduce){.fm-wa-page *,.fm-wa-wizard *{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important}}
''')

write("docs/whatsapp-extension-contract.md", r'''
# Contrato Flor Mía Web-App ↔ Extensión WhatsApp

## Alcance

La Web-App prepara campañas. La extensión privada ejecuta técnicamente WhatsApp Web. La Web-App no conoce selectores DOM, tiempos, tandas, reintentos, cookies, QR, credenciales ni tokens de WhatsApp.

## Transporte

- Canal: `flor_mia_whatsapp_extension`.
- `protocolVersion`: `1`.
- La Web-App usa `window.postMessage()` con `targetOrigin = window.location.origin`.
- El content script debe escuchar únicamente la página autorizada, validar `event.source`, `event.origin`, `channel`, `protocolVersion`, `type` y schema.
- Las respuestas deben usar `replyTo` con el `requestId` recibido cuando respondan a una solicitud puntual.
- Los eventos de campaña deben incluir `campaignId` y un `sequence` entero monótonamente creciente.

## Mensajes

Web → extensión:
- `FLORMIA_EXTENSION_PING`
- `FLORMIA_CAMPAIGN_PREPARE`
- `FLORMIA_CAMPAIGN_CANCEL_REQUEST`

Extensión → Web:
- `FLORMIA_EXTENSION_STATUS`
- `FLORMIA_CAMPAIGN_ACCEPTED`
- `FLORMIA_CAMPAIGN_PROGRESS`
- `FLORMIA_CAMPAIGN_PAUSED`
- `FLORMIA_CAMPAIGN_COMPLETED`
- `FLORMIA_CAMPAIGN_ERROR`
- `FLORMIA_CAMPAIGN_CANCELLED`

## Estado de extensión

`FLORMIA_EXTENSION_STATUS.payload`:

```js
{
  operational: true | false,
  message: "texto comprensible",
  extensionVersion: "opcional",
  configuredLimit: 1000,
  sentToday: 427,
  availableToday: 573,
  errorCode: "opcional"
}
```

La Web-App sólo interpreta dos estados principales: Operativa o Error / requiere revisión. El límite diario es autoridad exclusiva de la extensión.

## Preparación de campaña

`FLORMIA_CAMPAIGN_PREPARE.payload` contiene:

```js
{
  campaignId,
  campaignName,
  createdBy,
  recipients: [{ recipientId, clientId, name, phone, source }],
  message,
  imageCount,
  imageOrder,
  images: [{ order, name, type, size, data: ArrayBuffer }],
  totalRecipients
}
```

El `ArrayBuffer` es temporal y se transfiere únicamente en memoria. Firestore conserva sólo metadatos de imágenes. El orden lógico definido por la Web-App es Imagen 1 → Imagen 2 → Imagen 3 → Texto. La extensión debe garantizar el orden técnico real.

## Progreso

Los eventos de progreso deben incluir:

```js
{
  channel: "flor_mia_whatsapp_extension",
  protocolVersion: 1,
  type: "FLORMIA_CAMPAIGN_PROGRESS",
  campaignId: "...",
  sequence: 12,
  payload: { sentCount: 240, errorCount: 3 }
}
```

La extensión debe incrementar `sequence`. La Web-App ignora secuencias antiguas y nunca permite que `sentCount` supere `totalRecipients`.

## Datos prohibidos

No enviar ni almacenar en Flor Mía: cookies, tokens, contraseñas, QR, localStorage de WhatsApp, selectores internos, configuraciones de timing/tandas/reintentos ni binarios persistentes de las imágenes.
''')

write("tests/whatsapp-campaign-domain.test.mjs", r'''
import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeRecipientCandidates,
  campaignValidation,
  customerCommunicationAllowed,
  customerMatchesCampaignFilters,
  extensionPrimaryStatus,
  progressPercentage,
} from "../src/gestion/marketing/whatsapp/campaignDomain.js";
import { detectExcelMapping, mapExcelRows } from "../src/gestion/marketing/whatsapp/excelImport.js";

const flor = { source: "flor_mia", clientId: "c1", name: "Ana", phone: "11 5757-1979", zone: "Microcentro", category: "Premium" };
const excel = { source: "excel", clientId: null, name: "Otro nombre", phone: "+54 9 11 5757 1979", zone: "", category: "", notes: "Excel" };

test("deduplica Flor Mía + Excel y prioriza datos maestros", () => {
  const result = analyzeRecipientCandidates([excel, flor]);
  assert.equal(result.valid, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(result.recipients[0].source, "flor_mia");
  assert.equal(result.recipients[0].clientId, "c1");
  assert.equal(result.recipients[0].name, "Ana");
});

test("contabiliza sin teléfono e inválidos sin mezclarlos con válidos", () => {
  const result = analyzeRecipientCandidates([{ source: "excel", phone: "" }, { source: "excel", phone: "123" }, flor]);
  assert.equal(result.missingPhone, 1);
  assert.equal(result.invalid, 1);
  assert.equal(result.valid, 1);
});

test("respeta bloqueos explícitos pero no inventa consentimiento cuando el campo no existe", () => {
  assert.equal(customerCommunicationAllowed({ active: true, deleted: false }), true);
  assert.equal(customerCommunicationAllowed({ active: true, marketingEnabled: false }), false);
  assert.equal(customerCommunicationAllowed({ active: true, whatsappOptIn: false }), false);
  assert.equal(customerCommunicationAllowed({ active: true, doNotContact: true }), false);
});

test("combina zona, categoría, nombre y teléfono", () => {
  const customer = { active: true, name: "Ana Pérez", phoneNormalized: "1157571979", zoneId: "z1", zoneName: "Microcentro", segment: "Premium" };
  assert.equal(customerMatchesCampaignFilters(customer, { zoneId: "z1", category: "Premium", search: "ana" }), true);
  assert.equal(customerMatchesCampaignFilters(customer, { zoneId: "z1", category: "Premium", search: "5757" }), true);
  assert.equal(customerMatchesCampaignFilters(customer, { zoneId: "z2" }), false);
});

test("mapping Excel detecta teléfono y deja nombre opcional", () => {
  const headers = ["Celular", "Zona", "Observaciones"];
  const mapping = detectExcelMapping(headers);
  assert.equal(mapping.phone, "Celular");
  assert.equal(mapping.name, "");
  const rows = mapExcelRows({ headers, rows: [[1157571979, "Centro", "OK"]] }, mapping);
  assert.equal(rows[0].phone, "1157571979");
  assert.equal(rows[0].name, "");
});

test("validación final exige extensión operativa, destinatario y contenido", () => {
  const invalid = campaignValidation({ name: "Campaña", recipients: [], message: "", images: [], extensionStatus: { operational: false, message: "Extensión no detectada" } });
  assert.equal(invalid.valid, false);
  const recipient = analyzeRecipientCandidates([flor]).recipients;
  const valid = campaignValidation({ name: "Campaña", recipients: recipient, message: "Hola 👋\nhttps://flormia.com", images: [], extensionStatus: { operational: true } });
  assert.equal(valid.valid, true);
});

test("estado extensión sólo se proyecta como verde o rojo", () => {
  assert.equal(extensionPrimaryStatus({ operational: true }).tone, "success");
  assert.equal(extensionPrimaryStatus({ operational: false }).tone, "error");
});

test("progreso deriva porcentaje sin superar 100", () => {
  assert.equal(progressPercentage(487, 240), 49);
  assert.equal(progressPercentage(10, 99), 100);
});
''')

write("tests/whatsapp-marketing-integration.test.mjs", r'''
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Marketing enlaza la ruta canónica de WhatsApp y no automatiza WhatsApp Web", async () => {
  const [router, generic, page] = await Promise.all([
    read("src/gestion/ManagementApp.jsx"),
    read("src/gestion/pages/GenericModulePage.jsx"),
    read("src/gestion/pages/WhatsAppCampaignsPage.jsx"),
  ]);
  assert.match(router, /marketing.*whatsapp/s);
  assert.match(generic, /\/gestion\/marketing\/whatsapp/);
  assert.match(page, /Campañas y mensajes masivos/);
  assert.doesNotMatch(page, /querySelector\(|WhatsApp Web.*selector/i);
});

test("contrato es versionado, valida origen y no usa wildcard", async () => {
  const bridge = await read("src/gestion/marketing/whatsapp/extensionBridge.js");
  assert.match(bridge, /WHATSAPP_PROTOCOL_VERSION/);
  assert.match(bridge, /event\.origin !== window\.location\.origin/);
  assert.match(bridge, /window\.postMessage\(envelope, window\.location\.origin/);
  assert.doesNotMatch(bridge, /postMessage\([^\n]+["']\*["']/);
});

test("imágenes se transfieren como ArrayBuffer y no se persisten como Base64", async () => {
  const [bridge, service] = await Promise.all([
    read("src/gestion/marketing/whatsapp/extensionBridge.js"),
    read("src/gestion/marketing/whatsapp/campaignService.js"),
  ]);
  assert.match(bridge, /arrayBuffer\(\)/);
  assert.doesNotMatch(service, /base64|imageData|ArrayBuffer/i);
  assert.match(service, /imageMetadata/);
});

test("recipients vive en subcolección y usa batches acotados", async () => {
  const service = await read("src/gestion/marketing/whatsapp/campaignService.js");
  assert.match(service, /"whatsappCampaigns", campaignId, "recipients"/);
  assert.match(service, /CHUNK_SIZE = 350/);
  assert.doesNotMatch(service, /recipients:\s*input\.recipients/);
});

test("Excel se procesa localmente y sólo acepta xlsx", async () => {
  const importer = await read("src/gestion/marketing/whatsapp/excelImport.js");
  assert.match(importer, /read-excel-file\/browser/);
  assert.match(importer, /\.xlsx/);
  assert.doesNotMatch(importer, /Firebase|Storage|uploadBytes/);
});

test("permisos WhatsApp están integrados al módulo marketing", async () => {
  const permissions = await read("src/gestion/permissions.js");
  for (const action of ["whatsappView", "whatsappCreateCampaign", "whatsappSendToExtension", "whatsappCancelCampaign", "whatsappViewHistory", "whatsappImportExcel"]) {
    assert.match(permissions, new RegExp(action));
  }
});
''')

# package.json: dependency only; npm will regenerate lock.
package_path = ROOT / "package.json"
package_data = json.loads(package_path.read_text(encoding="utf-8"))
package_data.setdefault("dependencies", {})["read-excel-file"] = "9.3.4"
package_path.write_text(json.dumps(package_data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

replace_once("src/gestion/routePreload.js",
'''  metrics: () => import("./pages/SalesMetricsPage"),\n  settings: () => import("./pages/SettingsPage"),''',
'''  metrics: () => import("./pages/SalesMetricsPage"),\n  marketingWhatsapp: () => import("./pages/WhatsAppCampaignsPage"),\n  settings: () => import("./pages/SettingsPage"),''')
replace_once("src/gestion/routePreload.js",
'''  if (routeId === "locations") managementPageLoaders.locationDetail().catch(() => {});''',
'''  if (routeId === "locations") managementPageLoaders.locationDetail().catch(() => {});\n  if (routeId === "marketing") managementPageLoaders.marketingWhatsapp().catch(() => {});''')

replace_once("src/gestion/ManagementApp.jsx",
'''import SellerPanel from "./seller/SellerPanel";''',
'''import SellerPanel from "./seller/SellerPanel";\nimport WhatsAppExtensionSync from "./marketing/whatsapp/WhatsAppExtensionSync";''')
replace_once("src/gestion/ManagementApp.jsx",
'''const SalesMetricsPage = lazy(managementPageLoaders.metrics);\nconst SettingsPage = lazy(managementPageLoaders.settings);''',
'''const SalesMetricsPage = lazy(managementPageLoaders.metrics);\nconst WhatsAppCampaignsPage = lazy(managementPageLoaders.marketingWhatsapp);\nconst SettingsPage = lazy(managementPageLoaders.settings);''')
replace_once("src/gestion/ManagementApp.jsx",
'''  } else if (routeId === "metrics") {\n    page = <SalesMetricsPage />;\n  } else if (routeId === "settings") {''',
'''  } else if (routeId === "metrics") {\n    page = <SalesMetricsPage />;\n  } else if (routeId === "marketing" && pathParts[2] === "whatsapp") {\n    page = <WhatsAppCampaignsPage />;\n  } else if (routeId === "settings") {''')
replace_once("src/gestion/ManagementApp.jsx",
'''    <ManagementShell>\n      <Suspense fallback={<ModuleFallback />}>{page}</Suspense>\n    </ManagementShell>''',
'''    <ManagementShell>\n      <WhatsAppExtensionSync />\n      <Suspense fallback={<ModuleFallback />}>{page}</Suspense>\n    </ManagementShell>''')

replace_once("src/gestion/pages/GenericModulePage.jsx",
'''      {moduleId === "ecommerce" ? (''',
'''      {moduleId === "marketing" ? (\n        <Panel className="fm-editorial-panel" title="WhatsApp" description="Prepará destinatarios, mensajes e imágenes temporales antes de entregar la campaña a la extensión privada de Flor Mía.">\n          <Link className="fm-button fm-button--secondary" to="/gestion/marketing/whatsapp">Campañas y mensajes masivos</Link>\n        </Panel>\n      ) : null}\n      {moduleId === "ecommerce" ? (''')

replace_once("src/gestion/permissions.js",
'''  "requestTicket",\n];''',
'''  "requestTicket",\n  "whatsappView",\n  "whatsappCreateCampaign",\n  "whatsappSendToExtension",\n  "whatsappCancelCampaign",\n  "whatsappViewHistory",\n  "whatsappImportExcel",\n];''')
replace_once("src/gestion/permissions.js",
'''const viewOnly = ["view"];''',
'''const viewOnly = ["view"];\nconst whatsappMarketingActions = [\n  "whatsappView",\n  "whatsappCreateCampaign",\n  "whatsappSendToExtension",\n  "whatsappCancelCampaign",\n  "whatsappViewHistory",\n  "whatsappImportExcel",\n];''')
replace_once("src/gestion/permissions.js",
'''        : id === "quick-sales"\n          ? [...operational, ...sellerSalesActions]\n          : [...operational, "approve", "viewAllLocations"],''',
'''        : id === "quick-sales"\n          ? [...operational, ...sellerSalesActions]\n          : id === "marketing"\n            ? [...operational, ...whatsappMarketingActions]\n            : [...operational, "approve", "viewAllLocations"],''')
replace_once("src/gestion/permissions.js",
'''    marketing: operational,''',
'''    marketing: [...operational, ...whatsappMarketingActions],''')

replace_once("src/gestion/activity/activityPresentation.js",
'''  "customer.updated": { label: "Cliente actualizado", icon: "UserRoundCheck", tone: "info", group: "Clientes" },''',
'''  "customer.updated": { label: "Cliente actualizado", icon: "UserRoundCheck", tone: "info", group: "Clientes" },\n  "whatsappCampaign.created": { label: "Campaña WhatsApp creada", icon: "Megaphone", tone: "gold", group: "Marketing" },\n  "whatsappCampaign.prepared": { label: "Campaña WhatsApp preparada", icon: "Check", tone: "gold", group: "Marketing" },\n  "whatsappCampaign.delivered": { label: "Campaña entregada a extensión", icon: "MessagesSquare", tone: "gold", group: "Marketing" },\n  "whatsappCampaign.running": { label: "Campaña WhatsApp iniciada", icon: "Play", tone: "gold", group: "Marketing" },\n  "whatsappCampaign.paused": { label: "Campaña WhatsApp pausada", icon: "Pause", tone: "neutral", group: "Marketing" },\n  "whatsappCampaign.completed": { label: "Campaña WhatsApp finalizada", icon: "Check", tone: "olive", group: "Marketing" },\n  "whatsappCampaign.error": { label: "Campaña WhatsApp con error", icon: "AlertTriangle", tone: "error", group: "Marketing" },\n  "whatsappCampaign.cancelled": { label: "Campaña WhatsApp cancelada", icon: "X", tone: "error", group: "Marketing" },''')
replace_once("src/gestion/activity/activityPresentation.js",
'''  ["discount.", { icon: "Percent", tone: "gold", group: "Descuentos" }],''',
'''  ["discount.", { icon: "Percent", tone: "gold", group: "Descuentos" }],\n  ["whatsappCampaign.", { icon: "Megaphone", tone: "gold", group: "Marketing" }],''')

replace_once("src/main.jsx",
'''import "./styles/seller-customers.css";''',
'''import "./styles/seller-customers.css";\nimport "./styles/whatsapp-marketing.css";''')

# Firestore: roles + helpers + collections + audit.
replace_once("firestore.rules",
'''        || (role == "marketing_manager"\n          && moduleId in ["social", "marketing"]\n          && action in ["create", "edit", "export"])''',
'''        || (role == "marketing_manager"\n          && moduleId in ["social", "marketing"]\n          && action in [\n            "create", "edit", "export",\n            "whatsappView", "whatsappCreateCampaign", "whatsappSendToExtension",\n            "whatsappCancelCampaign", "whatsappViewHistory", "whatsappImportExcel"\n          ])''')
replace_once("firestore.rules",
'''            "loadStock", "adjustStock", "assignDiscounts"\n          ])''',
'''            "loadStock", "adjustStock", "assignDiscounts",\n            "whatsappView", "whatsappCreateCampaign", "whatsappSendToExtension",\n            "whatsappCancelCampaign", "whatsappViewHistory", "whatsappImportExcel"\n          ])''')
replace_once("firestore.rules",
'''    function sellerCustomerUpdate(customerId) {\n      return quickSalesPermission("create")\n        && customerKeyShape(customerId)\n        && request.resource.data.diff(resource.data).affectedKeys().hasOnly([\n          "lastSaleId", "lastPurchaseAt", "updatedAt"\n        ])\n        && linkedSellerCustomer(customerId);\n    }''',
'''    function sellerCustomerUpdate(customerId) {\n      return quickSalesPermission("create")\n        && customerKeyShape(customerId)\n        && request.resource.data.diff(resource.data).affectedKeys().hasOnly([\n          "lastSaleId", "lastPurchaseAt", "updatedAt"\n        ])\n        && linkedSellerCustomer(customerId);\n    }\n    function whatsappCanView() {\n      return canModule("marketing", "whatsappView")\n        || canModule("marketing", "whatsappViewHistory")\n        || canModule("marketing", "view");\n    }\n    function whatsappCanCreate() {\n      return canModule("marketing", "whatsappCreateCampaign")\n        || canModule("marketing", "create");\n    }\n    function whatsappCanSend() {\n      return canModule("marketing", "whatsappSendToExtension")\n        || canModule("marketing", "edit");\n    }\n    function whatsappCanCancel() {\n      return canModule("marketing", "whatsappCancelCampaign")\n        || canModule("marketing", "edit");\n    }\n    function whatsappStatus(value) {\n      return value in ["draft", "ready", "running", "paused", "completed", "error", "cancelled"];\n    }\n    function noWhatsappSecrets(data) {\n      return !data.keys().hasAny([\n        "cookies", "cookie", "whatsappToken", "token", "password", "qr",\n        "localStorage", "imageData", "imageBase64", "binaryImages", "filePath",\n        "selectors", "retryDelay", "batchDelay", "messageDelay"\n      ]);\n    }\n    function validWhatsappCampaign(data) {\n      return data.name is string\n        && data.name.size() > 0\n        && whatsappStatus(data.status)\n        && data.totalRecipients is int\n        && data.totalRecipients >= 0\n        && data.sentCount is int\n        && data.sentCount >= 0\n        && data.sentCount <= data.totalRecipients\n        && data.errorCount is int\n        && data.errorCount >= 0\n        && data.imageCount is int\n        && data.imageCount >= 0\n        && data.imageCount <= 3\n        && noWhatsappSecrets(data);\n    }\n    function validWhatsappRecipient(data) {\n      return data.recipientId is string\n        && data.phoneNormalized is string\n        && data.phoneNormalized.size() >= 8\n        && data.phoneNormalized.size() <= 11\n        && data.source in ["flor_mia", "excel"]\n        && data.status in ["pending", "running", "completed", "error"]\n        && !data.keys().hasAny(["cookies", "token", "password", "imageData", "imageBase64"]);\n    }''')
replace_once("firestore.rules",
'''    match /campaigns/{campaignId} {\n      allow read: if canModule("marketing", "view");\n      allow create: if canModule("marketing", "create") && ownsNewRecord();\n      allow update: if canModule("marketing", "edit") && logicalMutation();\n      allow delete: if false;\n    }''',
'''    match /campaigns/{campaignId} {\n      allow read: if canModule("marketing", "view");\n      allow create: if canModule("marketing", "create") && ownsNewRecord();\n      allow update: if canModule("marketing", "edit") && logicalMutation();\n      allow delete: if false;\n    }\n    match /whatsappCampaigns/{campaignId} {\n      allow get, list: if whatsappCanView();\n      allow create: if whatsappCanCreate()\n        && ownsNewRecord()\n        && validWhatsappCampaign(request.resource.data);\n      allow update: if (whatsappCanCreate() || whatsappCanSend() || whatsappCanCancel())\n        && request.resource.data.createdBy == resource.data.createdBy\n        && validWhatsappCampaign(request.resource.data);\n      allow delete: if false;\n      match /recipients/{recipientId} {\n        allow get, list: if whatsappCanView();\n        allow create, update: if (whatsappCanCreate() || whatsappCanSend())\n          && validWhatsappRecipient(request.resource.data);\n        allow delete: if whatsappCanCreate();\n      }\n      match /events/{eventId} {\n        allow get, list: if whatsappCanView();\n        allow create: if whatsappCanCreate() || whatsappCanSend() || whatsappCanCancel();\n        allow update, delete: if false;\n      }\n    }''')
replace_once("firestore.rules",
'''          || (("moduleId" in request.resource.data)\n            && request.resource.data.moduleId == "loyal-customers"\n            && (canModule("loyal-customers", "create") || canModule("loyal-customers", "edit")))''',
'''          || (("moduleId" in request.resource.data)\n            && request.resource.data.moduleId == "loyal-customers"\n            && (canModule("loyal-customers", "create") || canModule("loyal-customers", "edit")))\n          || (("moduleId" in request.resource.data)\n            && request.resource.data.moduleId == "marketing"\n            && (whatsappCanCreate() || whatsappCanSend() || whatsappCanCancel() || canModule("marketing", "edit")))''')

# Add emulator rules coverage.
rules_test = ROOT / "tests/firestore.rules.mjs"
text = rules_test.read_text(encoding="utf-8")
insert = r'''

test("campañas WhatsApp quedan restringidas a marketing autorizado y sin binarios", async () => {
  const adminDb = environment.authenticatedContext("admin-1").firestore();
  const sellerDb = environment.authenticatedContext("seller-1").firestore();
  const campaignRef = doc(adminDb, "whatsappCampaigns", "wa-1");
  await assertSucceeds(setDoc(campaignRef, {
    name: "Campaña segura",
    source: "whatsapp",
    filters: {},
    message: "Hola",
    imageCount: 0,
    imageNames: [],
    imageOrder: [],
    imageMetadata: [],
    totalRecipients: 1,
    sentCount: 0,
    errorCount: 0,
    progressPercentage: 0,
    status: "draft",
    snapshotState: "draft",
    active: true,
    deleted: false,
    createdBy: "admin-1",
    createdByName: "Administrador",
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  await assertFails(getDoc(doc(sellerDb, "whatsappCampaigns", "wa-1")));
  await assertFails(setDoc(doc(adminDb, "whatsappCampaigns", "wa-binary"), {
    name: "No válida",
    source: "whatsapp",
    filters: {},
    message: "Hola",
    imageCount: 1,
    imageData: "base64",
    totalRecipients: 0,
    sentCount: 0,
    errorCount: 0,
    progressPercentage: 0,
    status: "draft",
    createdBy: "admin-1",
  }));
});

test("destinatarios WhatsApp viven en subcolección protegida", async () => {
  const adminDb = environment.authenticatedContext("admin-1").firestore();
  const sellerDb = environment.authenticatedContext("seller-1").firestore();
  const recipientRef = doc(adminDb, "whatsappCampaigns", "wa-1", "recipients", "recipient_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  await assertSucceeds(setDoc(recipientRef, {
    recipientId: "recipient_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    clientId: null,
    name: "Cliente",
    phone: "1157571979",
    phoneNormalized: "1157571979",
    whatsappPhone: "5491157571979",
    zone: "Centro",
    category: null,
    source: "excel",
    status: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  await assertFails(getDoc(doc(sellerDb, "whatsappCampaigns", "wa-1", "recipients", "recipient_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")));
});
'''
text = text.rstrip() + insert + "\n"
rules_test.write_text(text, encoding="utf-8")
