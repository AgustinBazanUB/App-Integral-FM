
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
import { can } from "../../permissions.js";
import { db } from "../../services/firebase.js";
import { listCustomerZones } from "../../services/customerService.js";
import {
  CAMPAIGN_STATUS_LABELS,
  campaignRecipientDisplayPhone,
  customerCategory,
  customerCommunicationAllowed,
  customerMatchesCampaignFilters,
  extensionCampaignCounters,
  progressPercentage,
  recipientDocumentId,
  recipientFromCustomer,
} from "./campaignDomain.js";
import { EXTENSION_MESSAGE_TYPES } from "./extensionBridge.js";

const docsToArray = (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
const CHUNK_SIZE = 350;
const MAX_SELECT_ALL = 5000;

function profileName(profile = {}) {
  return profile.name || profile.email || "Usuario";
}

function canView(profile) {
  return can(profile, "marketing", "whatsappView") || can(profile, "marketing", "whatsappViewHistory");
}

function canCreate(profile) {
  return can(profile, "marketing", "whatsappCreateCampaign");
}

function canSend(profile) {
  return can(profile, "marketing", "whatsappSendToExtension");
}

function canCancel(profile) {
  return can(profile, "marketing", "whatsappCancelCampaign");
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
    processedCount: Math.max(0, Number(existing?.data()?.processedCount || 0)),
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
      confirmedSentCount: 0,
      unverifiedSentCount: 0,
      errorCount: 0,
      processedCount: 0,
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
  [EXTENSION_MESSAGE_TYPES.accepted]: "ready",
  [EXTENSION_MESSAGE_TYPES.started]: "running",
  [EXTENSION_MESSAGE_TYPES.progress]: "running",
  [EXTENSION_MESSAGE_TYPES.paused]: "paused",
  [EXTENSION_MESSAGE_TYPES.resumed]: "running",
  [EXTENSION_MESSAGE_TYPES.completed]: "completed",
  [EXTENSION_MESSAGE_TYPES.error]: "error",
  [EXTENSION_MESSAGE_TYPES.stopped]: "stopped",
  [EXTENSION_MESSAGE_TYPES.cancelled]: "cancelled",
};

const actionByType = {
  [EXTENSION_MESSAGE_TYPES.accepted]: "whatsappCampaign.ready",
  [EXTENSION_MESSAGE_TYPES.started]: "whatsappCampaign.running",
  [EXTENSION_MESSAGE_TYPES.progress]: "whatsappCampaign.running",
  [EXTENSION_MESSAGE_TYPES.paused]: "whatsappCampaign.paused",
  [EXTENSION_MESSAGE_TYPES.resumed]: "whatsappCampaign.running",
  [EXTENSION_MESSAGE_TYPES.completed]: "whatsappCampaign.completed",
  [EXTENSION_MESSAGE_TYPES.error]: "whatsappCampaign.error",
  [EXTENSION_MESSAGE_TYPES.stopped]: "whatsappCampaign.stopped",
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
    const counters = extensionCampaignCounters(message.payload, current);
    const status = extensionStatusByType[message.type];
    const update = {
      status,
      sentCount: counters.sent,
      confirmedSentCount: counters.confirmedSent,
      unverifiedSentCount: counters.unverifiedSent,
      errorCount: counters.errors,
      processedCount: counters.processed,
      progressPercentage: counters.progress,
      lastExtensionSequence: sequence || lastSequence + 1,
      lastExtensionUpdateAt: serverTimestamp(),
      extensionBlockReason: message.payload?.blockReason || null,
      extensionRetryableFailed: Math.max(0, Number(message.payload?.retryableFailed || 0)),
      extensionRetryCycle: Math.max(0, Number(message.payload?.retryCycle || 0)),
      extensionVersion: String(message.payload?.extensionVersion || current.extensionVersion || ""),
      ...(["completed", "stopped", "cancelled"].includes(status) && message.payload?.finalSummary ? {
        extensionFinalSummary: message.payload.finalSummary,
        extensionLastCompletedContactId: message.payload.finalSummary.lastCompletedContactId || null,
        extensionCancellationEvidence: message.payload.finalSummary.cancellationEvidence || null,
      } : {}),
      updatedAt: serverTimestamp(),
      ...(status === "running" && !current.startedAt ? { startedAt: serverTimestamp() } : {}),
      ...(["completed", "error", "cancelled", "stopped"].includes(status) ? { finishedAt: serverTimestamp() } : {}),
      ...(status === "error" ? {
        extensionErrorCode: message.payload?.errorCode || message.payload?.errorSummary?.code || "extension_error",
        extensionErrorMessage: message.payload?.message || message.payload?.errorSummary?.message || "La extensión informó un error.",
      } : {}),
      ...(status === "cancelled" ? { cancelledAt: serverTimestamp(), cancelledBy: profile.id } : {}),
      ...(status === "stopped" ? { stoppedAt: serverTimestamp(), stoppedBy: profile.id } : {}),
    };
    transaction.set(campaignRef, update, { merge: true });
    const statusChanged = current.status !== status;
    if (statusChanged) {
      transaction.set(eventRef, {
        type: message.type,
        label: CAMPAIGN_STATUS_LABELS[status],
        sequence: update.lastExtensionSequence,
        sentCount: counters.sent,
        confirmedSentCount: counters.confirmedSent,
        unverifiedSentCount: counters.unverifiedSent,
        errorCount: counters.errors,
        processedCount: counters.processed,
        progressPercentage: counters.progress,
        message: status === "error" ? update.extensionErrorMessage : null,
        createdAt: serverTimestamp(),
      });
      transaction.set(auditRef, campaignAudit(
        profile,
        actionByType[message.type],
        message.campaignId,
        `Campaña de WhatsApp ${CAMPAIGN_STATUS_LABELS[status].toLocaleLowerCase("es")}`,
        `Procesados: ${counters.processed}/${counters.total} · confirmados: ${counters.confirmedSent} · sin confirmación: ${counters.unverifiedSent} · con problemas: ${counters.errors}.`,
      ));
    }
    return { ignored: false, status, statusChanged, ...counters };
  });
}

export function extensionEventTypeForSnapshot(snapshot = {}) {
  const status = String(snapshot.status || "");
  if (["received", "ready"].includes(status)) return EXTENSION_MESSAGE_TYPES.accepted;
  if (["running", "pause_requested", "waiting_contact", "waiting_batch"].includes(status)) return EXTENSION_MESSAGE_TYPES.progress;
  if (["paused", "daily_limit_reached", "images_required"].includes(status)) return EXTENSION_MESSAGE_TYPES.paused;
  if (status === "completed") return EXTENSION_MESSAGE_TYPES.completed;
  if (status === "stopped") return EXTENSION_MESSAGE_TYPES.stopped;
  if (status === "error") return EXTENSION_MESSAGE_TYPES.error;
  return null;
}

export async function applyExtensionCampaignSnapshot(profile, snapshot) {
  const type = extensionEventTypeForSnapshot(snapshot);
  if (!type || !snapshot?.campaignId || !Number.isInteger(Number(snapshot.sequence))) return { ignored: true };
  return applyExtensionCampaignEvent(profile, {
    type,
    campaignId: snapshot.campaignId,
    sequence: Number(snapshot.sequence),
    payload: snapshot,
  });
}

export async function cancelLocalCampaign(profile, campaign) {
  if (!canCancel(profile)) throw new Error("No tenés permiso para cancelar campañas.");
  if (!campaign?.id) throw new Error("La campaña no está disponible.");
  if (!["draft", "ready"].includes(campaign.status)) throw new Error("La campaña ya está bajo control de la extensión.");
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