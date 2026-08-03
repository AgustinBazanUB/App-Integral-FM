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
  setDoc,
  writeBatch,
  where,
} from "firebase/firestore";
import { localDateTimeToDate } from "../../modules/locations/domain/locations";
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
  const locationRef = locationId ? doc(db, "locations", locationId) : doc(collection(db, "locations"));
  const auditRef = doc(collection(db, "auditLogs"));
  const batch = writeBatch(db);
  const scheduleStartAt = localDateTimeToDate(data.scheduleStartAt || data.startDateTime || data.startDate);
  const scheduleEndAt = localDateTimeToDate(data.scheduleEndAt || data.endDateTime || data.endDate);
  batch.set(locationRef, {
    name: data.name.trim(),
    type: data.type,
    codePrefix: data.codePrefix.trim().toUpperCase(),
    dniMode: data.dniMode,
    active: data.active !== false,
    deleted: false,
    scheduleStartAt: scheduleStartAt || null,
    scheduleEndAt: scheduleEndAt || null,
    startDateTime: data.scheduleStartAt || "",
    endDateTime: data.scheduleEndAt || "",
    updatedBy: profile.id,
    updatedByName: userName(profile),
    updatedAt: serverTimestamp(),
    ...(locationId ? {} : { createdAt: serverTimestamp(), assignedSellerIds: [], enabledDiscountIds: [] }),
  }, { merge: true });
  batch.set(auditRef, auditFields(profile, {
    action: locationId ? "location.updated" : "location.created",
    title: locationId ? "Ubicación actualizada" : "Ubicación creada",
    description: data.name.trim(),
    moduleId: "locations",
    entityType: "location",
    entityId: locationRef.id,
    entityName: data.name.trim(),
    locationId: locationRef.id,
    locationName: data.name.trim(),
    status: "completed",
  }));
  await batch.commit();
  return locationRef.id;
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
  if (action === "pause") Object.assign(updates, { active: false, manualInactiveUntil: null });
  else if (action === "activate") Object.assign(updates, { active: true, manualInactiveUntil: null });
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
  if (!location?.id || location.deleted === true || location.active === false) {
    throw new Error("La ubicación no está habilitada para cargar stock.");
  }
  if (!["initial", "add", "adjust"].includes(mode)) throw new Error("Elegí un modo de carga válido.");
  const cleaned = (entries || []).filter((entry) => String(entry.quantity ?? "").trim() !== "");
  if (!cleaned.length) throw new Error("Ingresá al menos una cantidad.");
  if (cleaned.length > 40) throw new Error("Podés actualizar hasta 40 productos por operación.");
  const safeOperationId = String(operationId || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "");
  const operationRef = doc(db, "stockOperations", safeOperationId);
  const locationRef = doc(db, "locations", location.id);

  return runTransaction(db, async (transaction) => {
    const operationSnapshot = await transaction.get(operationRef);
    if (operationSnapshot.exists()) return operationSnapshot.data();
    const locationSnapshot = await transaction.get(locationRef);
    if (!locationSnapshot.exists() || locationSnapshot.data().deleted === true || locationSnapshot.data().active === false) {
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
      const previousStock = Number(existing.currentStock || 0);
      const previousInitial = Number(existing.initialStock || 0);
      const currentStock = mode === "add" ? previousStock + requested : mode === "adjust" ? requested : previousStock + requested - previousInitial;
      if (currentStock < 0) throw new Error(`El ajuste de ${entry.product.name} dejaría stock negativo.`);
      prepared.push({ entry, existing, stockRef, requested, previousStock, previousInitial, currentStock });
    }
    prepared.forEach(({ entry, existing, stockRef, requested, previousStock, previousInitial, currentStock }) => {
      const delta = currentStock - previousStock;
      const product = entry.product;
      const yellowAlertQty = quantity(entry.yellowAlertQty ?? existing.yellowAlertQty ?? 0, `La alerta amarilla de ${product.name}`);
      const redAlertQty = quantity(entry.redAlertQty ?? existing.redAlertQty ?? 0, `La alerta roja de ${product.name}`);
      if (yellowAlertQty < redAlertQty) throw new Error(`La alerta amarilla de ${product.name} debe ser mayor o igual a la roja.`);
      transaction.set(stockRef, {
        productId: product.id,
        productName: product.name,
        abbreviation: product.abbreviation || "",
        categoryId: product.categoryId || "",
        categoryName: product.categoryName || "",
        imageUrl: product.imageUrl || "",
        thumbUrl: product.thumbUrl || "",
        price: quantity(entry.price ?? existing.price ?? product.defaultPrice ?? 0, `El precio de ${product.name}`),
        initialStock: mode === "initial" ? requested : previousInitial,
        currentStock,
        yellowAlertQty,
        redAlertQty,
        active: entry.active !== false,
        deleted: false,
        deletedAt: null,
        productDeleted: false,
        updatedAt: serverTimestamp(),
        updatedBy: profile.id,
      }, { merge: true });
      transaction.set(doc(db, "stockMovements", `${safeOperationId}_${product.id}`), {
        operationId: safeOperationId,
        locationId: location.id,
        locationName: location.name,
        productId: product.id,
        productName: product.name,
        type: mode === "initial" ? (Object.keys(existing).length ? "initial_adjustment" : "initial") : mode === "add" ? "add" : "adjustment",
        qty: delta,
        requestedQty: requested,
        previousStock,
        newStock: currentStock,
        reason: String(reason || (mode === "add" ? "Ingreso de mercadería" : mode === "adjust" ? "Ajuste de inventario" : "Configuración de stock inicial")).trim(),
        userId: profile.id,
        userName: userName(profile),
        saleId: "",
        createdAt: serverTimestamp(),
      });
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
  assertPermission(profile, "configureLocationProducts", "No tenés permiso para configurar productos en esta ubicación.");
  const yellowAlertQty = quantity(values.yellowAlertQty || 0, "La alerta amarilla");
  const redAlertQty = quantity(values.redAlertQty || 0, "La alerta roja");
  if (yellowAlertQty < redAlertQty) throw new Error("La alerta amarilla debe ser mayor o igual a la roja.");
  const stockRef = doc(db, "locationStock", location.id, "items", product.id);
  const batch = writeBatch(db);
  batch.set(stockRef, {
    productId: product.id,
    productName: product.name,
    abbreviation: product.abbreviation || "",
    categoryId: product.categoryId || "",
    categoryName: product.categoryName || "",
    imageUrl: product.imageUrl || "",
    thumbUrl: product.thumbUrl || "",
    price: quantity(values.price || 0, "El precio"),
    yellowAlertQty,
    redAlertQty,
    ...(!product.hasLocalRecord ? { currentStock: 0, initialStock: 0 } : {}),
    active: values.active !== false,
    deleted: false,
    updatedAt: serverTimestamp(),
    updatedBy: profile.id,
  }, { merge: true });
  batch.set(doc(collection(db, "auditLogs")), auditFields(profile, {
    action: "locationProduct.configured",
    title: "Producto configurado",
    description: `${product.name} · ${location.name}`,
    moduleId: "locations",
    entityType: "locationProduct",
    entityId: product.id,
    locationId: location.id,
    locationName: location.name,
    status: "completed",
  }));
  await batch.commit();
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
