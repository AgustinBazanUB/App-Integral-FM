
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  where,
  writeBatch,
} from "firebase/firestore";
import { can } from "../../permissions.js";
import { db } from "../../services/firebase.js";
import { listCustomerZones } from "../../services/customerService.js";
import {
  BULK_WHATSAPP_CONTACT_FILTERS,
  CAMPAIGN_STATUS_LABELS,
  campaignRecipientDisplayPhone,
  customerBulkWhatsAppContactState,
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
const CUSTOMER_LOOKUP_CHUNK_SIZE = 30;
const MAX_SELECT_ALL = 5000;
const EXTENSION_RECIPIENT_OUTCOMES = new Set(["confirmed", "unverified", "failed"]);

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

export async function listAllCampaignCustomersWithStats(profile, filters = {}) {
  const items = [];
  let cursor = null;
  let hasMore = true;
  let recentlyExcluded = 0;
  let totalMatchingWithoutCooldown = 0;
  const withoutCooldown = { ...filters, bulkWhatsAppContact: BULK_WHATSAPP_CONTACT_FILTERS.all };
  while (hasMore) {
    const page = await listCampaignCustomerPage(profile, { pageSize: 150, cursor });
    for (const customer of page.items) {
      if (!customerMatchesCampaignFilters(customer, withoutCooldown)) continue;
      totalMatchingWithoutCooldown += 1;
      if (customerMatchesCampaignFilters(customer, filters)) {
        items.push(customer);
      } else if (
        filters.bulkWhatsAppContact === BULK_WHATSAPP_CONTACT_FILTERS.available
        && customerBulkWhatsAppContactState(customer).recentlyContacted
      ) {
        recentlyExcluded += 1;
      }
    }
    if (items.length > MAX_SELECT_ALL) throw new Error("La selección supera 5.000 clientes. Aplicá un filtro más específico.");
    cursor = page.cursor;
    hasMore = page.hasMore && Boolean(cursor);
  }
  return { items, recentlyExcluded, totalMatchingWithoutCooldown };
}

export async function listAllCampaignCustomers(profile, filters = {}) {
  return (await listAllCampaignCustomersWithStats(profile, filters)).items;
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
    const isCrmRecipient = recipient.source === "flor_mia";
    operations.push((batch) => batch.set(reference, {
      recipientId: id,
      clientId: isCrmRecipient ? (recipient.clientId || null) : null,
      name: recipient.name || null,
      phone: recipient.phoneNormalized || recipient.phone,
      phoneNormalized: recipient.phoneNormalized || recipient.phone,
      whatsappPhone: recipient.whatsappPhone || null,
      zone: recipient.zone || null,
      category: recipient.category || null,
      source: recipient.source,
      status: "pending",
      customerLastBulkWhatsAppConfirmedAtSnapshot: isCrmRecipient ? (recipient.lastBulkWhatsAppConfirmedAt || null) : null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  }
  await commitOperations(operations);
  return recipients.length;
}

async function loadCustomersById(ids = []) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const customers = new Map();
  for (let index = 0; index < uniqueIds.length; index += CUSTOMER_LOOKUP_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(index, index + CUSTOMER_LOOKUP_CHUNK_SIZE);
    if (!chunk.length) continue;
    const snapshot = await getDocs(query(collection(db, "customers"), where(documentId(), "in", chunk)));
    for (const customerSnapshot of snapshot.docs) {
      customers.set(customerSnapshot.id, { id: customerSnapshot.id, ...customerSnapshot.data() });
    }
  }
  return customers;
}

async function guardRecipientsWithCurrentCustomerState(recipients = [], filters = {}) {
  const identities = recipients.map((recipient) => (
    recipient.source === "flor_mia" && recipient.clientId ? recipient.clientId : null
  ));
  const customers = await loadCustomersById(identities);
  const guarded = [];
  let recentlyExcluded = 0;
  let communicationBlockedExcluded = 0;
  for (let index = 0; index < recipients.length; index += 1) {
    const recipient = recipients[index];
    const customerId = identities[index];
    const customer = customerId ? customers.get(customerId) : null;
    if (customer && !customerCommunicationAllowed(customer)) {
      communicationBlockedExcluded += 1;
      continue;
    }
    if (customer && filters.bulkWhatsAppContact === BULK_WHATSAPP_CONTACT_FILTERS.available) {
      if (customerBulkWhatsAppContactState(customer).recentlyContacted) {
        recentlyExcluded += 1;
        continue;
      }
    }
    if (customer && filters.bulkWhatsAppContact === BULK_WHATSAPP_CONTACT_FILTERS.recent) {
      if (!customerBulkWhatsAppContactState(customer).recentlyContacted) continue;
    }
    guarded.push({
      ...recipient,
      ...(customer ? {
        clientId: customer.id,
        lastBulkWhatsAppConfirmedAt: customer.lastBulkWhatsAppConfirmedAt || null,
      } : recipient.source === "excel" ? { clientId: null } : {}),
    });
  }
  return { recipients: guarded, recentlyExcluded, communicationBlockedExcluded };
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
      processedCount: 0,
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

export async function prepareCampaignSnapshotWithCooldown(profile, input) {
  const guarded = await guardRecipientsWithCurrentCustomerState(input.recipients || [], input.filters || {});
  if (!guarded.recipients.length) {
    if (guarded.recentlyExcluded > 0) {
      throw new Error("Todos los clientes seleccionados recibieron una campaña confirmada dentro de los últimos 14 días. Cambiá el filtro o esperá a que vuelvan a estar disponibles.");
    }
    throw new Error("No quedaron destinatarios habilitados para preparar la campaña.");
  }
  const campaignId = await prepareCampaignSnapshot(profile, {
    ...input,
    recipients: guarded.recipients,
  });
  return { campaignId, ...guarded };
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

const FIRESTORE_EXTENSION_CAMPAIGN_FIELDS = Object.freeze([
  "status",
  "sentCount",
  "confirmedSentCount",
  "unverifiedSentCount",
  "processedCount",
  "errorCount",
  "progressPercentage",
  "lastExtensionSequence",
  "lastExtensionUpdateAt",
  "startedAt",
  "finishedAt",
  "extensionErrorCode",
  "extensionErrorMessage",
  "extensionBlockReason",
  "extensionRetryableFailed",
  "extensionRetryCycle",
  "extensionVersion",
  "extensionFinalSummary",
  "extensionLastCompletedContactId",
  "extensionCancellationEvidence",
  "deliveredToExtensionAt",
  "cancelledAt",
  "cancelledBy",
  "stoppedAt",
  "stoppedBy",
  "updatedBy",
  "updatedByName",
  "updatedAt",
]);

function firestoreCompatibleExtensionUpdate(update = {}) {
  return Object.fromEntries(FIRESTORE_EXTENSION_CAMPAIGN_FIELDS
    .filter((field) => Object.prototype.hasOwnProperty.call(update, field))
    .map((field) => [field, update[field]]));
}

async function normalizedExtensionRecipientResult(campaignId, payload = {}) {
  const result = payload.lastRecipientResult;
  if (!result || typeof result !== "object") return null;
  const rawRecipientId = String(result.recipientId || "").trim();
  const outcome = String(result.outcome || "").trim();
  const completedAtDate = new Date(String(result.completedAt || ""));
  if (!rawRecipientId || !EXTENSION_RECIPIENT_OUTCOMES.has(outcome) || !Number.isFinite(completedAtDate.getTime())) return null;
  const recipientId = rawRecipientId.startsWith("recipient_")
    ? rawRecipientId
    : await recipientDocumentId(rawRecipientId).catch(() => "");
  if (!recipientId) return null;
  return {
    recipientId,
    recipientRef: doc(db, "whatsappCampaigns", campaignId, "recipients", recipientId),
    outcome,
  };
}

export async function applyExtensionCampaignEvent(profile, message) {
  if (!canSend(profile) || !message?.campaignId || !extensionStatusByType[message.type]) return { ignored: true };
  const campaignRef = doc(db, "whatsappCampaigns", message.campaignId);
  const eventRef = doc(collection(db, "whatsappCampaigns", message.campaignId, "events"));
  const auditRef = doc(collection(db, "auditLogs"));
  const recipientResult = await normalizedExtensionRecipientResult(message.campaignId, message.payload || {});
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(campaignRef);
    if (!snapshot.exists()) return { ignored: true };
    const current = snapshot.data();
    const sequence = Number(message.sequence || 0);
    const lastSequence = Number(current.lastExtensionSequence || 0);
    if (sequence && sequence <= lastSequence) return { ignored: true, stale: true };

    let recipientSnapshot = null;
    let customerSnapshot = null;
    let customerRef = null;
    if (recipientResult) {
      recipientSnapshot = await transaction.get(recipientResult.recipientRef);
      const recipientData = recipientSnapshot.exists() ? recipientSnapshot.data() : null;
      if (recipientData?.source === "flor_mia" && recipientData?.clientId && recipientResult.outcome === "confirmed") {
        customerRef = doc(db, "customers", recipientData.clientId);
        customerSnapshot = await transaction.get(customerRef);
      }
    }

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
    transaction.set(campaignRef, firestoreCompatibleExtensionUpdate(update), { merge: true });

    let recipientResultApplied = false;
    let customerCooldownUpdated = false;
    if (recipientResult && recipientSnapshot?.exists()) {
      const recipientData = recipientSnapshot.data();
      const sameTerminalResult = recipientData.extensionResultOutcome === recipientResult.outcome
        && ["completed", "error"].includes(recipientData.status);
      const canSyncCustomer = recipientResult.outcome === "confirmed"
        && recipientData.source === "flor_mia"
        && Boolean(customerRef && customerSnapshot?.exists());
      const shouldSyncCustomer = canSyncCustomer
        && (!sameTerminalResult || recipientData.customerCooldownSynced !== true);
      const shouldWriteRecipient = !sameTerminalResult || shouldSyncCustomer;

      if (shouldWriteRecipient) {
        transaction.set(recipientResult.recipientRef, {
          status: recipientResult.outcome === "failed" ? "error" : "completed",
          extensionResultOutcome: recipientResult.outcome,
          extensionResultAt: serverTimestamp(),
          extensionResultSequence: update.lastExtensionSequence,
          customerCooldownSynced: shouldSyncCustomer || (sameTerminalResult && recipientData.customerCooldownSynced === true),
          ...(recipientResult.outcome === "confirmed" ? {
            deliveryConfidence: "confirmed",
            confirmedAt: serverTimestamp(),
          } : recipientResult.outcome === "unverified" ? {
            deliveryConfidence: "unverified",
          } : {}),
          updatedAt: serverTimestamp(),
        }, { merge: true });
        recipientResultApplied = !sameTerminalResult;
      }

      if (shouldSyncCustomer) {
        transaction.set(customerRef, {
          lastBulkWhatsAppConfirmedAt: serverTimestamp(),
          lastBulkWhatsAppCampaignId: message.campaignId,
          lastBulkWhatsAppRecipientId: recipientResult.recipientId,
        }, { merge: true });
        customerCooldownUpdated = true;
      }
    }

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
        blockReason: message.payload?.blockReason || null,
        retryableFailed: Math.max(0, Number(message.payload?.retryableFailed || 0)),
        retryCycle: Math.max(0, Number(message.payload?.retryCycle || 0)),
        extensionVersion: String(message.payload?.extensionVersion || current.extensionVersion || ""),
        ...(["completed", "cancelled"].includes(status) && message.payload?.finalSummary ? { finalSummary: message.payload.finalSummary } : {}),
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
    return { ignored: false, status, statusChanged, recipientResultApplied, customerCooldownUpdated, ...counters };
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

export async function campaignSummaryForExtension(campaignId, name, profile, recipients, message) {
  const extensionRecipients = await Promise.all(recipients.map(async (recipient) => ({
    recipientId: await recipientDocumentId(recipient.phoneNormalized || recipient.phone),
    clientId: recipient.source === "flor_mia" ? (recipient.clientId || null) : null,
    name: recipient.name || "",
    phone: recipient.whatsappPhone,
    source: recipient.source,
  })));
  return {
    campaignId,
    campaignName: name,
    createdBy: profile.id,
    recipients: extensionRecipients,
    message,
    totalRecipients: extensionRecipients.length,
  };
}

export { campaignRecipientDisplayPhone, progressPercentage };