
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
  where,
  writeBatch,
} from "firebase/firestore";
import {
  buildCustomerDraft,
  cleanZoneName,
  customerDocumentId,
  normalizeCustomerPhone,
} from "../customers/customerDomain";
import { can } from "../permissions";
import { db } from "./firebase";
import { invalidateRuntimeCache, withRuntimeCache } from "./runtimeCache";

const docsToArray = (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
const ACTIVE_ZONES_CACHE_KEY = "customer-zones:active";
const ALL_ZONES_CACHE_KEY = "customer-zones:all";
const LOCAL_ZONES_KEY = "flor-mia-customer-zones-v1";
const CUSTOMER_BATCH_LOOKUP_SIZE = 30;

function userName(profile = {}) {
  return profile.name || profile.email || "Usuario";
}

function assertCanEditCustomer(profile) {
  if (!can(profile, "loyal-customers", "edit")) {
    throw new Error("No tenés permiso para editar clientes.");
  }
}

function customerAudit(profile, { action, customerId, changedFields = [] }) {
  return {
    action,
    title: action === "customer.created" ? "Cliente creado" : "Cliente actualizado",
    description: action === "customer.created" ? "Nuevo cliente fidelizado" : "Datos principales actualizados",
    moduleId: "loyal-customers",
    entityType: "customer",
    entityId: customerId,
    userId: profile.id,
    userName: userName(profile),
    status: "completed",
    ...(changedFields.length ? { changedFields } : {}),
    createdAt: serverTimestamp(),
  };
}

function sortZones(zones = []) {
  return [...zones].sort((a, b) =>
    Number(a.order || 0) - Number(b.order || 0) ||
    String(a.name || "").localeCompare(String(b.name || ""), "es"),
  );
}

function rememberActiveZones(zones) {
  try {
    localStorage.setItem(LOCAL_ZONES_KEY, JSON.stringify(zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      order: Number(zone.order || 0),
      active: zone.active !== false,
    }))));
  } catch {
    // El cache persistente es una mejora offline; nunca bloquea la venta.
  }
  return zones;
}

function rememberedActiveZones() {
  try {
    const value = JSON.parse(localStorage.getItem(LOCAL_ZONES_KEY) || "[]");
    return Array.isArray(value) ? sortZones(value.filter((zone) => zone?.active !== false && zone?.name)) : [];
  } catch {
    return [];
  }
}

export async function findCustomerByPhone(phone) {
  const phoneNormalized = normalizeCustomerPhone(phone);
  if (!phoneNormalized) return null;
  const customerId = await customerDocumentId(phoneNormalized);
  const snapshot = await getDoc(doc(db, "customers", customerId));
  if (!snapshot.exists() || snapshot.data().deleted === true || snapshot.data().active === false) return null;
  return { id: snapshot.id, ...snapshot.data() };
}

export async function findCustomersByPhones(phones = []) {
  const normalizedPhones = [...new Set(phones.map(normalizeCustomerPhone).filter(Boolean))];
  if (!normalizedPhones.length) return new Map();
  const identities = await Promise.all(normalizedPhones.map(async (phoneNormalized) => ({
    phoneNormalized,
    customerId: await customerDocumentId(phoneNormalized),
  })));
  const byId = new Map(identities.map((item) => [item.customerId, item.phoneNormalized]));
  const result = new Map(normalizedPhones.map((phone) => [phone, null]));
  for (let index = 0; index < identities.length; index += CUSTOMER_BATCH_LOOKUP_SIZE) {
    const customerIds = identities.slice(index, index + CUSTOMER_BATCH_LOOKUP_SIZE).map((item) => item.customerId);
    const snapshot = await getDocs(query(collection(db, "customers"), where(documentId(), "in", customerIds)));
    for (const customer of docsToArray(snapshot)) {
      if (customer.deleted === true || customer.active === false) continue;
      const phoneNormalized = byId.get(customer.id) || normalizeCustomerPhone(customer.phoneNormalized || customer.phone);
      if (phoneNormalized) result.set(phoneNormalized, customer);
    }
  }
  return result;
}

export async function listCustomers(profile, pageSize = 200) {
  if (!can(profile, "loyal-customers", "view")) {
    throw new Error("No tenés permiso para ver Clientes Fidelizados.");
  }
  const size = Math.max(1, Math.min(500, Number(pageSize) || 200));
  try {
    return docsToArray(await getDocs(query(
      collection(db, "customers"),
      orderBy("updatedAt", "desc"),
      limit(size),
    ))).filter((customer) => customer.deleted !== true);
  } catch (error) {
    if (error?.code === "permission-denied") throw error;
    return docsToArray(await getDocs(query(collection(db, "customers"), limit(size))))
      .filter((customer) => customer.deleted !== true);
  }
}

export async function createCustomerFromAdminIfMissing(profile, input) {
  if (!can(profile, "loyal-customers", "create") && !can(profile, "loyal-customers", "edit")) {
    throw new Error("No tenés permiso para guardar clientes.");
  }
  const draft = buildCustomerDraft(input);
  const customerId = await customerDocumentId(draft.phoneNormalized);
  const reference = doc(db, "customers", customerId);
  const auditRef = doc(collection(db, "auditLogs"));
  return runTransaction(db, async (transaction) => {
    const existing = await transaction.get(reference);
    if (existing.exists() && existing.data().deleted !== true) {
      return { id: customerId, created: false, customer: { id: existing.id, ...existing.data() } };
    }
    transaction.set(reference, {
      customerKey: customerId,
      phone: draft.phone,
      phoneNormalized: draft.phoneNormalized,
      name: draft.name || null,
      zoneId: draft.zoneId || null,
      zoneName: draft.zoneName,
      customZone: draft.customZone || null,
      active: true,
      deleted: false,
      source: "admin",
      updatedBy: profile.id,
      updatedByName: userName(profile),
      updatedAt: serverTimestamp(),
      createdBy: profile.id,
      createdByName: userName(profile),
      createdAt: serverTimestamp(),
    });
    transaction.set(auditRef, customerAudit(profile, { action: "customer.created", customerId }));
    return { id: customerId, created: true, customer: null };
  });
}

export async function saveCustomerFromAdmin(profile, input) {
  if (!can(profile, "loyal-customers", "create") && !can(profile, "loyal-customers", "edit")) {
    throw new Error("No tenés permiso para guardar clientes.");
  }
  const draft = buildCustomerDraft(input);
  const customerId = await customerDocumentId(draft.phoneNormalized);
  const reference = doc(db, "customers", customerId);
  const existing = await getDoc(reference);
  if (existing.exists() && !can(profile, "loyal-customers", "edit")) {
    throw new Error("Ese cliente ya existe y no tenés permiso para editarlo.");
  }
  const batch = writeBatch(db);
  batch.set(reference, {
    customerKey: customerId,
    phone: draft.phone,
    phoneNormalized: draft.phoneNormalized,
    name: draft.name || null,
    zoneId: draft.zoneId || null,
    zoneName: draft.zoneName,
    customZone: draft.customZone || null,
    active: true,
    deleted: false,
    source: existing.exists() ? (existing.data().source || "admin") : "admin",
    updatedBy: profile.id,
    updatedByName: userName(profile),
    updatedAt: serverTimestamp(),
    ...(existing.exists() ? {} : {
      createdBy: profile.id,
      createdByName: userName(profile),
      createdAt: serverTimestamp(),
    }),
  }, { merge: true });
  batch.set(doc(collection(db, "auditLogs")), customerAudit(profile, {
    action: existing.exists() ? "customer.updated" : "customer.created",
    customerId,
    changedFields: existing.exists() ? ["name", "phone", "zone"] : [],
  }));
  await batch.commit();
  return customerId;
}

export async function updateCustomerFromAdmin(profile, currentCustomer, input) {
  assertCanEditCustomer(profile);
  if (!currentCustomer?.id) throw new Error("El cliente no está disponible.");
  const draft = buildCustomerDraft(input);
  const targetId = await customerDocumentId(draft.phoneNormalized);
  const currentRef = doc(db, "customers", currentCustomer.id);
  const targetRef = doc(db, "customers", targetId);
  const auditRef = doc(collection(db, "auditLogs"));

  return runTransaction(db, async (transaction) => {
    const currentSnapshot = await transaction.get(currentRef);
    if (!currentSnapshot.exists() || currentSnapshot.data().deleted === true) {
      throw new Error("El cliente dejó de estar disponible. Actualizá el listado.");
    }
    const stored = currentSnapshot.data();
    let targetSnapshot = currentSnapshot;
    if (targetId !== currentCustomer.id) {
      targetSnapshot = await transaction.get(targetRef);
      if (targetSnapshot.exists() && targetSnapshot.data().deleted !== true) {
        throw new Error("Ya existe otro cliente con ese teléfono.");
      }
    }

    const changedFields = [];
    if (String(stored.name || "") !== draft.name) changedFields.push("name");
    if (String(stored.phoneNormalized || "") !== draft.phoneNormalized || String(stored.phone || "") !== draft.phone) changedFields.push("phone");
    if (String(stored.zoneId || "") !== draft.zoneId || String(stored.zoneName || "") !== draft.zoneName || String(stored.customZone || "") !== draft.customZone) changedFields.push("zone");

    const payload = {
      customerKey: targetId,
      phone: draft.phone,
      phoneNormalized: draft.phoneNormalized,
      name: draft.name || null,
      zoneId: draft.zoneId || null,
      zoneName: draft.zoneName,
      customZone: draft.customZone || null,
      active: true,
      deleted: false,
      source: stored.source || "admin",
      updatedBy: profile.id,
      updatedByName: userName(profile),
      updatedAt: serverTimestamp(),
    };

    if (targetId === currentCustomer.id) {
      transaction.set(currentRef, payload, { merge: true });
    } else {
      transaction.set(targetRef, {
        ...payload,
        createdBy: profile.id,
        createdByName: userName(profile),
        createdAt: serverTimestamp(),
        originalCreatedBy: stored.createdBy || null,
        originalCreatedByName: stored.createdByName || null,
        originalCreatedAt: stored.createdAt || null,
        lastSaleId: stored.lastSaleId || null,
        lastPurchaseAt: stored.lastPurchaseAt || null,
        migratedFromCustomerId: currentCustomer.id,
      }, { merge: true });
      transaction.set(currentRef, {
        active: false,
        deleted: true,
        movedToCustomerId: targetId,
        movedAt: serverTimestamp(),
        updatedBy: profile.id,
        updatedByName: userName(profile),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }

    transaction.set(auditRef, customerAudit(profile, {
      action: "customer.updated",
      customerId: targetId,
      changedFields,
    }));
    return { id: targetId, changedFields };
  });
}

export async function listActiveCustomerZones({ allowOfflineFallback = true } = {}) {
  return withRuntimeCache(ACTIVE_ZONES_CACHE_KEY, async () => {
    try {
      const zones = docsToArray(await getDocs(query(
        collection(db, "customerZones"),
        where("active", "==", true),
        limit(100),
      )));
      return rememberActiveZones(sortZones(zones));
    } catch (error) {
      const cached = allowOfflineFallback ? rememberedActiveZones() : [];
      if (cached.length) return cached;
      throw error;
    }
  }, 120_000);
}

export async function listCustomerZones(profile) {
  if (!can(profile, "loyal-customers", "view")) {
    throw new Error("No tenés permiso para administrar zonas.");
  }
  return withRuntimeCache(ALL_ZONES_CACHE_KEY, async () => sortZones(
    docsToArray(await getDocs(query(
      collection(db, "customerZones"),
      limit(150),
    ))),
  ), 60_000);
}

export async function saveCustomerZone(profile, input, zoneId = null) {
  const canEdit = can(profile, "loyal-customers", "edit") || can(profile, "loyal-customers", "admin");
  if (!canEdit) throw new Error("No tenés permiso para configurar zonas.");
  const name = cleanZoneName(input?.name);
  if (!name) throw new Error("Ingresá el nombre de la zona.");
  const reference = zoneId ? doc(db, "customerZones", zoneId) : doc(collection(db, "customerZones"));
  await setDoc(reference, {
    name,
    active: input?.active !== false,
    order: Math.max(0, Number(input?.order || 0)),
    updatedBy: profile.id,
    updatedByName: userName(profile),
    updatedAt: serverTimestamp(),
    ...(zoneId ? {} : {
      createdBy: profile.id,
      createdByName: userName(profile),
      createdAt: serverTimestamp(),
    }),
  }, { merge: true });
  invalidateCustomerZones();
  return reference.id;
}

export async function setCustomerZoneActive(profile, zone, active) {
  if (!zone?.id) throw new Error("La zona no existe.");
  return saveCustomerZone(profile, { ...zone, active }, zone.id);
}

export function invalidateCustomerZones() {
  invalidateRuntimeCache(ACTIVE_ZONES_CACHE_KEY);
  invalidateRuntimeCache(ALL_ZONES_CACHE_KEY);
}
