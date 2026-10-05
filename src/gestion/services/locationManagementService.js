import { buildLocationPayload } from "../../shared/managementWritePlans.mjs";
import { buildLocationStockLinePlan, locationStockQuantity } from "../../shared/operationalWritePlans.mjs";
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  writeBatch,
  where,
} from "firebase/firestore";
import { localDateTimeToDate, locationActivity, LOCATION_TYPES, normalizeOperatingCalendar } from "../../modules/locations/domain/locations";
import { assertUniqueInventoryProducts, effectiveLocationPrice } from "../../modules/inventory/domain/inventory";
import { invalidateRuntimeCache } from "./runtimeCache";
import { addProductToLocation, saveLocationProductSettings } from "./inventoryService";
import { can, normalizedRole } from "../permissions";
import { db } from "./firebase";

const docsToArray = (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
const userName = (profile) => profile.name || profile.email || "Usuario";
const uniqueIds = (values) => [...new Set((values || []).filter(Boolean))];

function auditFields(profile, fields) {
  return {
    ...fields,
    userId: profile.id,
    userName: userName(profile),
    createdAt: serverTimestamp(),
  };
}

function assertPermission(profile, action, message) {
  if (!can(profile, "locations", action)) throw new Error(message);
}

export async function listMasterProducts(profile) {
  const includeInactive = ["admin", "general_admin"].includes(normalizedRole(profile));
  const target = includeInactive
    ? query(collection(db, "products"), orderBy("name"))
    : query(collection(db, "products"), where("active", "==", true), orderBy("name"));
  return docsToArray(await getDocs(target))
    .filter((product) => product.deleted !== true);
}

export async function listProductCategories(profile) {
  const includeInactive = ["admin", "general_admin"].includes(normalizedRole(profile));
  const target = includeInactive
    ? collection(db, "productCategories")
    : query(collection(db, "productCategories"), where("active", "==", true));
  return docsToArray(await getDocs(target))
    .filter((category) => category.deleted !== true)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name || "").localeCompare(String(b.name || ""), "es"));
}

export async function listDiscounts(profile) {
  const includeInactive = ["admin", "general_admin"].includes(normalizedRole(profile));
  const target = includeInactive
    ? query(collection(db, "discounts"), orderBy("name"))
    : query(collection(db, "discounts"), where("active", "==", true), orderBy("name"));
  return docsToArray(await getDocs(target))
    .filter((discount) => discount.deleted !== true);
}

export async function listLocationStockConfiguration(locationId) {
  if (!locationId) return [];
  return docsToArray(await getDocs(query(
    collection(db, "locationStock", locationId, "items"),
    orderBy("productName"),
  )));
}

export async function listLocationStockCounts(locations) {
  const entries = await Promise.all((locations || []).map(async (location) => {
    const snapshot = await getCountFromServer(collection(db, "locationStock", location.id, "items"));
    return [location.id, snapshot.data().count];
  }));
  return Object.fromEntries(entries);
}

export async function listAssignableSellers() {
  return docsToArray(await getDocs(query(collection(db, "users"), orderBy("name"))))
    .filter((user) => normalizedRole(user) === "seller" && user.deleted !== true);
}

export async function saveManagedLocation(data, profile, locationId = null) {
  assertPermission(profile, locationId ? "edit" : "create", "No tenés permiso para guardar ubicaciones.");
  const locationRef = locationId ? doc(db, "locations", locationId) : data.requestId ? doc(db, "locations", data.requestId) : doc(collection(db, "locations"));
  const auditRef = doc(collection(db, "auditLogs"));
  const scheduleStartAt = localDateTimeToDate(data.scheduleStartAt || data.startDateTime || data.startDate);
  const scheduleEndAt = localDateTimeToDate(data.scheduleEndAt || data.endDateTime || data.endDate);
  const name = String(data.name || "").trim();
  const prefix = String(data.codePrefix || "").trim().toUpperCase();
  if (!name || !/^[A-Z0-9]{1,8}$/.test(prefix)) throw new Error("Completá un nombre y un prefijo de hasta 8 letras o números.");
  if (scheduleStartAt && scheduleEndAt && scheduleStartAt >= scheduleEndAt) throw new Error("La fecha final debe ser posterior a la inicial.");
  const result = await runTransaction(db, async (transaction) => {
    const previous = await transaction.get(locationRef);
    if (locationId && (!previous.exists() || previous.data().deleted === true)) throw new Error("La ubicación no está disponible.");
    if (!locationId && previous.exists()) {
      if (previous.data().createdBy !== profile.id) throw new Error("La ubicación ya existe.");
      return locationRef.id;
    }
    if (!Object.hasOwn(LOCATION_TYPES, data.type) && (!previous.exists() || previous.data().type !== data.type)) throw new Error("Elegí Local, Feria o Evento. Los depósitos se crean en su propio módulo.");
    const operatingCalendar = normalizeOperatingCalendar(data.operatingCalendar ?? (previous.exists() ? previous.data().operatingCalendar : undefined));
    transaction.set(locationRef, buildLocationPayload({ values: data, previous: previous.exists() ? previous.data() : null, profile, stamp: serverTimestamp(), startAt: scheduleStartAt, endAt: scheduleEndAt }), { merge: true });
    transaction.set(auditRef, auditFields(profile, {
      action: locationId ? "location.updated" : "location.created",
      title: locationId ? "Ubicación actualizada" : "Ubicación creada",
      description: data.name.trim(),
      moduleId: "locations",
      entityType: "location",
      entityId: locationRef.id,
      entityName: data.name.trim(),
      locationId: locationRef.id,
      locationName: data.name.trim(),
      previousCalendar: previous.exists() ? previous.data().operatingCalendar || null : null,
      operatingCalendar,
      previousSchedule: previous.exists() ? { startAt: previous.data().scheduleStartAt || null, endAt: previous.data().scheduleEndAt || null } : null,
      schedule: { startAt: scheduleStartAt || null, endAt: scheduleEndAt || null },
      status: "completed",
    }));
    return locationRef.id;
  });
  invalidateRuntimeCache("locations:");
  return result;
}

export async function setLocationLifecycle(location, action, profile) {
  const permission = action === "delete" ? "archive" : action === "restore" ? "restore" : "edit";
  assertPermission(profile, permission, "No tenés permiso para cambiar el estado de esta ubicación.");
  const updates = {
    updatedAt: serverTimestamp(),
    updatedBy: profile.id,
    updatedByName: userName(profile),
  };
  const labels = {
    pause: ["location.paused", "Ubicación pausada"],
    activate: ["location.activated", "Ubicación activada"],
    delete: ["location.deleted", "Ubicación dada de baja"],
    restore: ["location.restored", "Ubicación restaurada"],
  };
  if (action === "pause" || action === "activate") Object.assign(updates, { active: action === "activate", manualInactiveUntil: null, manualInactiveDays: null, ...(location.manualInactiveUntilDateTime ? { manualInactiveUntilDateTime: null } : {}) });
  else if (action === "delete") Object.assign(updates, { active: false, deleted: true, deletedAt: serverTimestamp(), deletedBy: profile.id });
  else if (action === "restore") Object.assign(updates, { active: true, deleted: false, deletedAt: null, restoredAt: serverTimestamp(), restoredBy: profile.id });
  else throw new Error("La acción solicitada no es válida.");
  const batch = writeBatch(db);
  batch.set(doc(db, "locations", location.id), updates, { merge: true });
  batch.set(doc(collection(db, "auditLogs")), auditFields(profile, {
    action: labels[action][0],
    title: labels[action][1],
    description: location.name,
    moduleId: "locations",
    entityType: "location",
    entityId: location.id,
    entityName: location.name,
    locationId: location.id,
    locationName: location.name,
    status: action === "delete" ? "archived" : "completed",
  }));
  await batch.commit();
  invalidateRuntimeCache("locations:");
}

function quantity(value, label, { allowZero = true } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || (!allowZero && number === 0)) {
    throw new Error(`${label} debe ser un número entero ${allowZero ? "mayor o igual a cero" : "mayor a cero"}.`);
  }
  return number;
}

export async function loadLocationStock({ location, entries, mode, reason, profile, operationId }) {
  const action = mode === "adjust" ? "adjustStock" : "loadStock";
  assertPermission(profile, action, "No tenés permiso para cargar este stock.");
  if (!location?.id || !locationActivity(location).active) {
    throw new Error("La ubicación no está habilitada para cargar stock.");
  }
  if (!["initial", "add", "adjust"].includes(mode)) throw new Error("Elegí un modo de carga válido.");
  const cleaned = (entries || []).filter((entry) => String(entry.quantity ?? "").trim() !== "");
  if (!cleaned.length) throw new Error("Ingresá al menos una cantidad.");
  assertUniqueInventoryProducts(cleaned);
  if (cleaned.length > 40) throw new Error("Podés actualizar hasta 40 productos por operación.");
  const safeOperationId = String(operationId || crypto.randomUUID());
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(safeOperationId)) throw new Error("El identificador de operación no es válido.");
  const operationRef = doc(db, "stockOperations", safeOperationId);
  const locationRef = doc(db, "locations", location.id);

  return runTransaction(db, async (transaction) => {
    const operationSnapshot = await transaction.get(operationRef);
    if (operationSnapshot.exists()) return operationSnapshot.data();
    const locationSnapshot = await transaction.get(locationRef);
    if (!locationSnapshot.exists() || !locationActivity(locationSnapshot.data()).active) {
      throw new Error("La ubicación dejó de estar disponible.");
    }
    const prepared = [];
    for (const entry of cleaned) {
      const productRef = doc(db, "products", entry.product.id);
      const stockRef = doc(db, "locationStock", location.id, "items", entry.product.id);
      const productSnapshot = await transaction.get(productRef);
      const stockSnapshot = await transaction.get(stockRef);
      if (!productSnapshot.exists() || productSnapshot.data().deleted === true || productSnapshot.data().active === false) {
        throw new Error(`${entry.product.name} ya no está disponible.`);
      }
      const requested = quantity(entry.quantity, `La cantidad de ${entry.product.name}`);
      const existing = stockSnapshot.exists() && stockSnapshot.data().deleted !== true ? stockSnapshot.data() : {};
      const { previousStock, previousInitial, currentStock } = locationStockQuantity({ existing, mode, requested });
      if (mode === "initial" && stockSnapshot.exists() && requested !== previousInitial) assertPermission(profile, "adjustStock", "La modificación del stock inicial existente requiere permiso de ajuste.");
      prepared.push({ entry, existing, stockRef, requested, previousStock, previousInitial, currentStock });
    }
    prepared.forEach(({ entry, existing, stockRef, requested }) => {
      const plan = buildLocationStockLinePlan({ product: entry.product, existing, mode, requested, entry: { ...entry, reason }, operationId: safeOperationId, location, profile, stamp: serverTimestamp() });
      transaction.set(stockRef, plan.stockData, { merge: true });
      transaction.set(doc(db, "stockMovements", plan.movementId), plan.movementData);
    });
    transaction.set(locationRef, {
      stockConfiguredAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: profile.id,
    }, { merge: true });
    const result = {
      operationId: safeOperationId,
      locationId: location.id,
      mode,
      itemCount: prepared.length,
      userId: profile.id,
      createdAt: serverTimestamp(),
      status: "completed",
    };
    transaction.set(operationRef, result);
    transaction.set(doc(db, "auditLogs", safeOperationId), auditFields(profile, {
      action: `stock.${mode}`,
      title: mode === "add" ? "Mercadería agregada" : mode === "adjust" ? "Inventario ajustado" : "Stock inicial configurado",
      description: `${prepared.length} producto${prepared.length === 1 ? "" : "s"} · ${location.name}`,
      moduleId: "locations",
      entityType: "stockOperation",
      entityId: safeOperationId,
      locationId: location.id,
      locationName: location.name,
      status: "completed",
    }));
    return result;
  });
}

export async function saveLocationProductConfiguration({ location, product, values, profile }) {
  // Adaptador legacy: la configuración no puede resetear stock por una UI obsoleta.
  assertPermission(profile, "configureLocationProducts", "No tenés permiso para configurar este producto.");
  const yellow = quantity(values.yellowAlertQty ?? 0, "La alerta amarilla");
  const red = quantity(values.redAlertQty ?? 0, "La alerta roja");
  if (yellow < red) throw new Error("La alerta amarilla debe ser mayor o igual a la roja.");
  const snapshot = await getDoc(doc(db, "locationStock", location.id, "items", product.id));
  if (!snapshot.exists() || snapshot.data().deleted === true) {
    await addProductToLocation({ location, product, initialStock: 0, useDefaultPrice: false, priceOverride: values.price ?? product.defaultPrice ?? 0, profile });
  }
  return saveLocationProductSettings({ location, productId: product.id, values: { ...values, useDefaultPrice: values.useDefaultPrice ?? false, priceOverride: values.priceOverride ?? values.price ?? product.defaultPrice ?? 0 }, profile });
}

export async function saveLocationSellers(location, sellerIds, profile) {
  if (!["admin", "general_admin"].includes(normalizedRole(profile))) {
    throw new Error("No tenés permiso para asignar vendedores.");
  }
  const nextIds = uniqueIds(sellerIds);
  const locationRef = doc(db, "locations", location.id);
  return runTransaction(db, async (transaction) => {
    const locationSnapshot = await transaction.get(locationRef);
    if (!locationSnapshot.exists() || locationSnapshot.data().deleted === true) throw new Error("La ubicación no está disponible.");
    const previousIds = uniqueIds(locationSnapshot.data().assignedSellerIds);
    const affectedIds = uniqueIds([...previousIds, ...nextIds]);
    const sellers = [];
    for (const sellerId of affectedIds) sellers.push(await transaction.get(doc(db, "users", sellerId)));
    sellers.forEach((seller) => {
      if (nextIds.includes(seller.id) && (!seller.exists() || seller.data().deleted === true || seller.data().active !== true)) {
        throw new Error("No se puede asignar un vendedor eliminado o inactivo.");
      }
    });
    transaction.set(locationRef, {
      assignedSellerIds: nextIds,
      updatedAt: serverTimestamp(),
      updatedBy: profile.id,
      updatedByName: userName(profile),
    }, { merge: true });
    sellers.forEach((seller) => {
      if (!seller.exists()) return;
      const ids = new Set(seller.data().allowedLocationIds || []);
      if (nextIds.includes(seller.id)) ids.add(location.id);
      else ids.delete(location.id);
      transaction.set(seller.ref, { allowedLocationIds: [...ids], updatedAt: serverTimestamp(), updatedBy: profile.id }, { merge: true });
    });
    transaction.set(doc(collection(db, "auditLogs")), auditFields(profile, {
      action: "location.sellersUpdated",
      title: "Vendedores actualizados",
      description: `${nextIds.length} vendedor${nextIds.length === 1 ? "" : "es"} asignado${nextIds.length === 1 ? "" : "s"}`,
      moduleId: "locations",
      entityType: "location",
      entityId: location.id,
      locationId: location.id,
      locationName: location.name,
      addedSellerIds: nextIds.filter((id) => !previousIds.includes(id)),
      removedSellerIds: previousIds.filter((id) => !nextIds.includes(id)),
      status: "completed",
    }));
    return nextIds;
  });
}

export async function saveLocationDiscounts(location, discountIds, profile) {
  assertPermission(profile, "assignDiscounts", "No tenés permiso para asignar descuentos.");
  const enabledDiscountIds = uniqueIds(discountIds);
  const activeDiscounts = await Promise.all(enabledDiscountIds.map((id) => getDoc(doc(db, "discounts", id))));
  if (activeDiscounts.some((snapshot) => !snapshot.exists() || snapshot.data().deleted === true || snapshot.data().active !== true)) {
    throw new Error("Uno de los descuentos ya no está activo.");
  }
  const batch = writeBatch(db);
  batch.set(doc(db, "locations", location.id), {
    enabledDiscountIds,
    updatedAt: serverTimestamp(),
    updatedBy: profile.id,
    updatedByName: userName(profile),
  }, { merge: true });
  batch.set(doc(collection(db, "auditLogs")), auditFields(profile, {
    action: "location.discountsUpdated",
    title: "Descuentos actualizados",
    description: `${enabledDiscountIds.length} descuento${enabledDiscountIds.length === 1 ? "" : "s"} habilitado${enabledDiscountIds.length === 1 ? "" : "s"}`,
    moduleId: "locations",
    entityType: "location",
    entityId: location.id,
    locationId: location.id,
    locationName: location.name,
    enabledDiscountIds,
    status: "completed",
  }));
  await batch.commit();
  return enabledDiscountIds;
}

export async function getLocation(locationId) {
  const snapshot = await getDoc(doc(db, "locations", locationId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}
