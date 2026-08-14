import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
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

function userName(profile = {}) {
  return profile.name || profile.email || "Usuario";
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
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
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
    )));
  } catch (error) {
    if (error?.code === "permission-denied") throw error;
    return docsToArray(await getDocs(query(collection(db, "customers"), limit(size))));
  }
}

export async function saveCustomerFromAdmin(profile, input) {
  if (!can(profile, "loyal-customers", "create") && !can(profile, "loyal-customers", "edit")) {
    throw new Error("No tenés permiso para guardar clientes.");
  }
  const draft = buildCustomerDraft(input);
  const customerId = await customerDocumentId(draft.phoneNormalized);
  const reference = doc(db, "customers", customerId);
  const existing = await getDoc(reference);
  const payload = {
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
  };
  await setDoc(reference, payload, { merge: true });
  return customerId;
}

export async function listActiveCustomerZones({ allowOfflineFallback = true } = {}) {
  return withRuntimeCache(ACTIVE_ZONES_CACHE_KEY, async () => {
    try {
      const zones = docsToArray(await getDocs(query(
        collection(db, "customerZones"),
        where("active", "==", true),
        orderBy("order"),
        orderBy("name"),
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
      orderBy("order"),
      orderBy("name"),
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
