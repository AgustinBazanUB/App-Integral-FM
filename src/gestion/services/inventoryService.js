import { buildMasterProductPayload } from "../../shared/productWritePlans.mjs";
import { buildStockTransferWrites } from "../../shared/stockTransferWritePlans.mjs";
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
  where,
  writeBatch,
} from "firebase/firestore";
import {
  INVENTORY_TYPES,
  PRICE_MODES,
  effectiveLocationPrice,
  assertUniqueInventoryProducts,
  mergeLocationInventoryItem,
  mergeWarehouseInventoryItem,
  reconcileTransferLine,
  wholeInventoryQuantity,
} from "../../modules/inventory/domain/inventory";
import { can, normalizedRole } from "../permissions";
import { locationActivity } from "../../modules/locations/domain/locations";
import { db } from "./firebase";

const docsToArray = (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
const userName = (profile) => profile.name || profile.email || "Usuario";
const normalizedText = (value) => String(value || "").trim().toLocaleLowerCase("es");
const operationId = (value = "") => {
  const id = String(value || crypto.randomUUID());
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error("El identificador de operación no es válido.");
  return id;
};

// POS already loads the master catalog once; avoid hydrating each stock row with another product read.
export async function listQuickSaleStock({ type, id }, profile) {
  if (!["location", "warehouse"].includes(type) || !id) return [];
  if (!can(profile, "quick-sales", "create")) throw new Error("No tenés permiso para registrar ventas.");
  return docsToArray(await getDocs(query(collection(db, type === "warehouse" ? "warehouseStock" : "locationStock", id, "items"), orderBy("productName"))))
    .filter(item => item.deleted !== true);
}

function assertPermission(profile, moduleId, action, message) {
  if (!can(profile, moduleId, action)) throw new Error(message);
}

async function safeProduct(productId) {
  try {
    const snapshot = await getDoc(doc(db, "products", productId));
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  } catch (error) {
    if (error?.code === "permission-denied" || error?.code === "firestore/permission-denied") return null;
    throw error;
  }
}

async function hydrateInventory(items, type) {
  const products = await Promise.all(items.map((item) => safeProduct(item.productId || item.id)));
  return items
    .filter((item) => item.deleted !== true)
    .map((item, index) => {
      const product = products[index] || {
        id: item.productId || item.id,
        name: item.productName,
        abbreviation: item.abbreviation,
        categoryId: item.categoryId,
        categoryName: item.categoryName,
        imageUrl: item.imageUrl,
        thumbUrl: item.thumbUrl,
        defaultPrice: item.masterDefaultPrice ?? item.price ?? 0,
        active: item.productDeleted !== true,
      };
      return type === INVENTORY_TYPES.LOCATION
        ? mergeLocationInventoryItem(product, item)
        : mergeWarehouseInventoryItem(product, item);
    })
    .sort((a, b) => String(a.productName || "").localeCompare(String(b.productName || ""), "es"));
}

/** @param {*} profile @param {{ includeInactive?: boolean }} [options] */
export async function listMasterProductsForInventory(profile, { includeInactive } = {}) {
  const showInactive = includeInactive ?? ["admin", "general_admin"].includes(normalizedRole(profile));
  const target = showInactive
    ? query(collection(db, "products"), orderBy("name"))
    : query(collection(db, "products"), where("active", "==", true), orderBy("name"));
  return docsToArray(await getDocs(target)).filter((product) => product.deleted !== true);
}

export async function listProductCategoriesForInventory(profile) {
  const showInactive = ["admin", "general_admin"].includes(normalizedRole(profile));
  const target = showInactive
    ? collection(db, "productCategories")
    : query(collection(db, "productCategories"), where("active", "==", true));
  return docsToArray(await getDocs(target))
    .filter((category) => category.deleted !== true)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
      || String(a.name || "").localeCompare(String(b.name || ""), "es"));
}

const productPayload = (values, categoryName, profile, editing) => buildMasterProductPayload(values, categoryName, profile, editing, serverTimestamp());

export async function saveMasterProduct({ productId = "", values, profile }) {
  assertPermission(
    profile,
    "products",
    productId ? "edit" : "create",
    productId ? "No tenés permiso para editar productos." : "No tenés permiso para crear productos.",
  );
  let categoryName = "Sin categoría";
  const categoryId = String(values.categoryId || "").trim();
  if (categoryId) {
    const categorySnapshot = await getDoc(doc(db, "productCategories", categoryId));
    if (!categorySnapshot.exists() || categorySnapshot.data().deleted === true) {
      throw new Error("La categoría seleccionada ya no está disponible.");
    }
    categoryName = categorySnapshot.data().name || "Sin categoría";
  }

  // Crear/editar productos es una acción infrecuente. Esta lectura acotada prioriza
  // no generar duplicados incluso con productos legacy que todavía no tienen nameKey.
  const existingProducts = docsToArray(await getDocs(query(collection(db, "products"), limit(500))));
  const candidateName = normalizedText(values.name);
  const candidateAbbreviation = normalizedText(values.abbreviation);
  const duplicate = existingProducts.find((product) => product.id !== productId
    && product.deleted !== true
    && (normalizedText(product.name) === candidateName
      || normalizedText(product.abbreviation) === candidateAbbreviation));
  if (duplicate) throw new Error("Ya existe un producto con ese nombre o abreviación.");

  const productRef = productId ? doc(db, "products", productId) : doc(collection(db, "products"));
  const payload = productPayload(values, categoryName, profile, Boolean(productId));
  const auditRef = doc(collection(db, "auditLogs"));
  const batch = writeBatch(db);
  batch.set(productRef, payload, { merge: true });
  batch.set(auditRef, {
    action: productId ? "product.updated" : "product.created",
    title: productId ? "Producto actualizado" : "Producto creado",
    description: payload.name,
    moduleId: "products",
    entityType: "product",
    entityId: productRef.id,
    entityName: payload.name,
    userId: profile.id,
    userName: userName(profile),
    status: "completed",
    createdAt: serverTimestamp(),
  });
  await batch.commit();
  return productRef.id;
}

export async function listLocationInventory(locationId) {
  if (!locationId) return [];
  const items = docsToArray(await getDocs(query(
    collection(db, "locationStock", locationId, "items"),
    orderBy("productName"),
  ))).filter((item) => item.deleted !== true);
  return hydrateInventory(items, INVENTORY_TYPES.LOCATION);
}

export async function addProductToLocation({
  location,
  product,
  initialStock,
  useDefaultPrice = true,
  priceOverride = null,
  profile,
  requestId = "",
}) {
  assertPermission(profile, "locations", "configureLocationProducts", "No tenés permiso para agregar productos a esta ubicación.");
  if (!location?.id) throw new Error("La ubicación no está disponible.");
  const initial = wholeInventoryQuantity(initialStock || 0, "El stock inicial");
  if (initial > 0) assertPermission(profile, "locations", "loadStock", "No tenés permiso para cargar cantidades en esta ubicación.");
  const customPrice = useDefaultPrice
    ? null
    : wholeInventoryQuantity(priceOverride, "El precio especial");
  const safeId = operationId(requestId);
  const operationRef = doc(db, "inventoryOperations", safeId);
  const locationRef = doc(db, "locations", location.id);
  const productRef = doc(db, "products", product.id);
  const stockRef = doc(db, "locationStock", location.id, "items", product.id);
  const movementRef = doc(db, "stockMovements", `${safeId}_${product.id}`);
  const auditRef = doc(db, "auditLogs", safeId);

  return runTransaction(db, async (transaction) => {
    const operationSnapshot = await transaction.get(operationRef);
    if (operationSnapshot.exists()) return operationSnapshot.data();
    const locationSnapshot = await transaction.get(locationRef);
    const productSnapshot = await transaction.get(productRef);
    const stockSnapshot = await transaction.get(stockRef);
    if (!locationSnapshot.exists() || locationSnapshot.data().deleted === true) throw new Error("La ubicación ya no está disponible.");
    if (initial > 0 && !locationActivity(locationSnapshot.data()).active) throw new Error("Activá la ubicación para ingresar stock; podés habilitar el producto con cantidad cero.");
    if (!productSnapshot.exists() || productSnapshot.data().deleted === true || productSnapshot.data().active === false) {
      throw new Error("El producto seleccionado ya no está disponible.");
    }
    if (stockSnapshot.exists() && stockSnapshot.data().deleted !== true) {
      throw new Error(`${productSnapshot.data().name} ya está agregado a ${locationSnapshot.data().name}.`);
    }
    const master = productSnapshot.data();
    const effectivePrice = useDefaultPrice ? Number(master.defaultPrice || 0) : customPrice;
    transaction.set(stockRef, {
      productId: product.id,
      productName: master.name,
      abbreviation: master.abbreviation || "",
      categoryId: master.categoryId || "",
      categoryName: master.categoryName || "Sin categoría",
      imageUrl: master.imageUrl || "",
      thumbUrl: master.thumbUrl || "",
      priceMode: useDefaultPrice ? PRICE_MODES.DEFAULT : PRICE_MODES.CUSTOM,
      priceOverride: customPrice,
      price: effectivePrice,
      masterDefaultPrice: Number(master.defaultPrice || 0),
      initialStock: initial,
      currentStock: initial,
      yellowAlertQty: 0,
      redAlertQty: 0,
      active: true,
      deleted: false,
      deletedAt: null,
      productDeleted: false,
      assignedAt: serverTimestamp(),
      assignedBy: profile.id,
      updatedAt: serverTimestamp(),
      updatedBy: profile.id,
      lastMovementId: movementRef.id,
    }, { merge: true });
    transaction.set(movementRef, {
      operationId: safeId,
      inventoryType: INVENTORY_TYPES.LOCATION,
      inventoryId: location.id,
      locationId: location.id,
      locationName: locationSnapshot.data().name,
      productId: product.id,
      productName: master.name,
      type: "initial",
      qty: initial,
      requestedQty: initial,
      previousStock: 0,
      newStock: initial,
      reason: "Ingreso inicial",
      userId: profile.id,
      userName: userName(profile),
      saleId: "",
      transferId: "",
      createdAt: serverTimestamp(),
    });
    const result = {
      operationId: safeId,
      operationType: "assign_location_product",
      inventoryType: INVENTORY_TYPES.LOCATION,
      inventoryId: location.id,
      productId: product.id,
      userId: profile.id,
      status: "completed",
      createdAt: serverTimestamp(),
    };
    transaction.set(operationRef, result);
    transaction.set(auditRef, {
      action: "locationProduct.added",
      title: "Producto agregado a ubicación",
      description: `${master.name} · ${locationSnapshot.data().name}`,
      moduleId: "locations",
      entityType: "locationProduct",
      entityId: product.id,
      locationId: location.id,
      locationName: locationSnapshot.data().name,
      userId: profile.id,
      userName: userName(profile),
      status: "completed",
      createdAt: serverTimestamp(),
    });
    return result;
  });
}

export async function saveLocationProductSettings({ location, productId, values, profile }) {
  assertPermission(profile, "locations", "configureLocationProducts", "No tenés permiso para configurar este producto.");
  const stockRef = doc(db, "locationStock", location.id, "items", productId);
  const productRef = doc(db, "products", productId);
  return runTransaction(db, async (transaction) => {
    const productSnapshot = await transaction.get(productRef);
    const stockSnapshot = await transaction.get(stockRef);
    if (!productSnapshot.exists() || productSnapshot.data().deleted === true) throw new Error("El producto ya no está disponible.");
    if (!stockSnapshot.exists() || stockSnapshot.data().deleted === true) throw new Error("El producto ya no forma parte de esta ubicación.");
    const useDefaultPrice = values.useDefaultPrice !== false;
    const customPrice = useDefaultPrice ? null : wholeInventoryQuantity(values.priceOverride, "El precio especial");
    const yellowAlertQty = wholeInventoryQuantity(values.yellowAlertQty ?? stockSnapshot.data().yellowAlertQty ?? 0, "La alerta amarilla");
    const redAlertQty = wholeInventoryQuantity(values.redAlertQty ?? stockSnapshot.data().redAlertQty ?? 0, "La alerta roja");
    if (yellowAlertQty < redAlertQty) throw new Error("La alerta amarilla debe ser mayor o igual a la roja.");
    transaction.update(stockRef, {
      priceMode: useDefaultPrice ? PRICE_MODES.DEFAULT : PRICE_MODES.CUSTOM,
      priceOverride: customPrice,
      price: useDefaultPrice ? Number(productSnapshot.data().defaultPrice || 0) : customPrice,
      masterDefaultPrice: Number(productSnapshot.data().defaultPrice || 0),
      yellowAlertQty,
      redAlertQty,
      active: values.active !== false,
      updatedAt: serverTimestamp(),
      updatedBy: profile.id,
    });
    transaction.set(doc(collection(db, "auditLogs")), {
      action: "locationProduct.configured", title: "Producto configurado",
      description: `${productSnapshot.data().name} · ${location.name}`,
      moduleId: "locations", entityType: "locationProduct", entityId: productId,
      locationId: location.id, locationName: location.name,
      previousSettings: { priceMode: stockSnapshot.data().priceMode || "legacy", price: stockSnapshot.data().price ?? null, priceOverride: stockSnapshot.data().priceOverride ?? null, yellowAlertQty: stockSnapshot.data().yellowAlertQty ?? 0, redAlertQty: stockSnapshot.data().redAlertQty ?? 0, active: stockSnapshot.data().active !== false },
      newSettings: { useDefaultPrice, priceOverride: customPrice, yellowAlertQty, redAlertQty, active: values.active !== false },
      userId: profile.id, userName: userName(profile), status: "completed", createdAt: serverTimestamp(),
    });
    return {
      effectivePrice: useDefaultPrice ? Number(productSnapshot.data().defaultPrice || 0) : customPrice,
      useDefaultPrice,
    };
  });
}

export async function listWarehouses(profile, { includeInactive = false } = {}) {
  if (!can(profile, "warehouse", "view")) return [];
  return docsToArray(await getDocs(query(collection(db, "warehouses"), orderBy("name"))))
    .filter((warehouse) => warehouse.deleted !== true)
    .filter((warehouse) => includeInactive || warehouse.active !== false);
}

export async function createWarehouse({ values, profile }) {
  assertPermission(profile, "warehouse", "create", "No tenés permiso para crear depósitos.");
  const name = String(values.name || "").trim();
  if (!name) throw new Error("Ingresá el nombre del depósito.");
  const warehouseRef = doc(collection(db, "warehouses"));
  const batch = writeBatch(db);
  batch.set(warehouseRef, {
    name,
    description: String(values.description || "").trim(),
    address: String(values.address || "").trim(),
    active: values.active !== false,
    deleted: false,
    createdBy: profile.id,
    createdByName: userName(profile),
    createdAt: serverTimestamp(),
    updatedBy: profile.id,
    updatedByName: userName(profile),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(collection(db, "auditLogs")), {
    action: "warehouse.created",
    title: "Depósito creado",
    description: name,
    moduleId: "warehouse",
    entityType: "warehouse",
    entityId: warehouseRef.id,
    userId: profile.id,
    userName: userName(profile),
    status: "completed",
    createdAt: serverTimestamp(),
  });
  await batch.commit();
  return warehouseRef.id;
}

export async function getWarehouse(warehouseId) {
  const snapshot = await getDoc(doc(db, "warehouses", warehouseId));
  return snapshot.exists() && snapshot.data().deleted !== true
    ? { id: snapshot.id, ...snapshot.data() }
    : null;
}

export async function listWarehouseInventory(warehouseId) {
  if (!warehouseId) return [];
  const items = docsToArray(await getDocs(query(
    collection(db, "warehouseStock", warehouseId, "items"),
    orderBy("productName"),
  ))).filter((item) => item.deleted !== true);
  return hydrateInventory(items, INVENTORY_TYPES.WAREHOUSE);
}

export async function addProductToWarehouse({ warehouse, product, initialStock, profile, requestId }) {
  assertPermission(profile, "warehouse", "edit", "No tenés permiso para agregar productos a este depósito.");
  if (!warehouse?.id) throw new Error("El depósito no está disponible.");
  const initial = wholeInventoryQuantity(initialStock || 0, "El stock inicial");
  const safeId = operationId(requestId);
  const operationRef = doc(db, "inventoryOperations", safeId);
  const warehouseRef = doc(db, "warehouses", warehouse.id);
  const productRef = doc(db, "products", product.id);
  const stockRef = doc(db, "warehouseStock", warehouse.id, "items", product.id);
  const movementRef = doc(db, "stockMovements", `${safeId}_${product.id}`);
  const auditRef = doc(db, "auditLogs", safeId);
  return runTransaction(db, async (transaction) => {
    const operationSnapshot = await transaction.get(operationRef);
    if (operationSnapshot.exists()) return operationSnapshot.data();
    const warehouseSnapshot = await transaction.get(warehouseRef);
    const productSnapshot = await transaction.get(productRef);
    const stockSnapshot = await transaction.get(stockRef);
    if (!warehouseSnapshot.exists() || warehouseSnapshot.data().deleted === true || warehouseSnapshot.data().active === false) {
      throw new Error("El depósito ya no está disponible.");
    }
    if (!productSnapshot.exists() || productSnapshot.data().deleted === true || productSnapshot.data().active === false) {
      throw new Error("El producto seleccionado ya no está disponible.");
    }
    if (stockSnapshot.exists() && stockSnapshot.data().deleted !== true) {
      throw new Error(`${productSnapshot.data().name} ya está agregado a ${warehouseSnapshot.data().name}.`);
    }
    const master = productSnapshot.data();
    transaction.set(stockRef, {
      productId: product.id,
      productName: master.name,
      abbreviation: master.abbreviation || "",
      categoryId: master.categoryId || "",
      categoryName: master.categoryName || "Sin categoría",
      imageUrl: master.imageUrl || "",
      thumbUrl: master.thumbUrl || "",
      initialStock: initial,
      currentStock: initial,
      active: true,
      deleted: false,
      productDeleted: false,
      assignedAt: serverTimestamp(),
      assignedBy: profile.id,
      updatedAt: serverTimestamp(),
      updatedBy: profile.id,
      lastMovementId: movementRef.id,
    }, { merge: true });
    transaction.set(movementRef, {
      operationId: safeId,
      inventoryType: INVENTORY_TYPES.WAREHOUSE,
      inventoryId: warehouse.id,
      warehouseId: warehouse.id,
      warehouseName: warehouseSnapshot.data().name,
      productId: product.id,
      productName: master.name,
      type: "initial",
      qty: initial,
      requestedQty: initial,
      previousStock: 0,
      newStock: initial,
      reason: "Ingreso inicial",
      userId: profile.id,
      userName: userName(profile),
      saleId: "",
      transferId: "",
      createdAt: serverTimestamp(),
    });
    const result = {
      operationId: safeId,
      operationType: "assign_warehouse_product",
      inventoryType: INVENTORY_TYPES.WAREHOUSE,
      inventoryId: warehouse.id,
      productId: product.id,
      userId: profile.id,
      status: "completed",
      createdAt: serverTimestamp(),
    };
    transaction.set(operationRef, result);
    transaction.set(auditRef, {
      action: "warehouseProduct.added",
      title: "Producto agregado a depósito",
      description: `${master.name} · ${warehouseSnapshot.data().name}`,
      moduleId: "warehouse",
      entityType: "warehouseProduct",
      entityId: product.id,
      warehouseId: warehouse.id,
      warehouseName: warehouseSnapshot.data().name,
      userId: profile.id,
      userName: userName(profile),
      status: "completed",
      createdAt: serverTimestamp(),
    });
    return result;
  });
}

function stockReference(type, inventoryId, productId) {
  return type === INVENTORY_TYPES.LOCATION
    ? doc(db, "locationStock", inventoryId, "items", productId)
    : doc(db, "warehouseStock", inventoryId, "items", productId);
}

function ownerReference(type, inventoryId) {
  return type === INVENTORY_TYPES.LOCATION
    ? doc(db, "locations", inventoryId)
    : doc(db, "warehouses", inventoryId);
}

export async function addStockToInventory({ type, inventory, product, quantity, reason, profile, requestId }) {
  if (!Object.values(INVENTORY_TYPES).includes(type)) throw new Error("El tipo de inventario no es válido.");
  if (type === INVENTORY_TYPES.LOCATION) {
    assertPermission(profile, "locations", "loadStock", "No tenés permiso para agregar stock en esta ubicación.");
  } else {
    assertPermission(profile, "warehouse", "edit", "No tenés permiso para agregar stock en este depósito.");
  }
  const requested = wholeInventoryQuantity(quantity, "La cantidad a agregar", { allowZero: false });
  const safeId = operationId(requestId);
  const operationRef = doc(db, "inventoryOperations", safeId);
  const ownerRef = ownerReference(type, inventory.id);
  const stockRef = stockReference(type, inventory.id, product.productId || product.id);
  const movementRef = doc(db, "stockMovements", `${safeId}_${product.productId || product.id}`);
  const auditRef = doc(db, "auditLogs", safeId);

  return runTransaction(db, async (transaction) => {
    const operationSnapshot = await transaction.get(operationRef);
    if (operationSnapshot.exists()) return operationSnapshot.data();
    const ownerSnapshot = await transaction.get(ownerRef);
    const masterSnapshot = await transaction.get(doc(db, "products", product.productId || product.id));
    const stockSnapshot = await transaction.get(stockRef);
    if (!ownerSnapshot.exists() || ownerSnapshot.data().deleted === true || ownerSnapshot.data().active === false) {
      throw new Error(type === INVENTORY_TYPES.LOCATION ? "La ubicación ya no está disponible." : "El depósito ya no está disponible.");
    }
    if (!stockSnapshot.exists() || stockSnapshot.data().deleted === true || stockSnapshot.data().active === false) {
      throw new Error(`${product.productName || product.name} todavía no forma parte del stock de este lugar.`);
    }
    if (type === INVENTORY_TYPES.LOCATION && !locationActivity(ownerSnapshot.data()).active) throw new Error("Activá la ubicación para ingresar mercadería.");
    if (!masterSnapshot.exists() || masterSnapshot.data().active === false || masterSnapshot.data().deleted === true) throw new Error("El producto ya no está disponible.");
    const previousStock = wholeInventoryQuantity(stockSnapshot.data().currentStock || 0, "El stock actual", { allowNegative: type === INVENTORY_TYPES.LOCATION });
    const newStock = previousStock + requested;
    transaction.update(stockRef, {
      currentStock: newStock,
      lastMovementId: movementRef.id,
      updatedAt: serverTimestamp(),
      updatedBy: profile.id,
    });
    const ownerName = ownerSnapshot.data().name;
    transaction.set(movementRef, {
      operationId: safeId,
      inventoryType: type,
      inventoryId: inventory.id,
      ...(type === INVENTORY_TYPES.LOCATION
        ? { locationId: inventory.id, locationName: ownerName }
        : { warehouseId: inventory.id, warehouseName: ownerName }),
      productId: product.productId || product.id,
      productName: product.productName || product.name,
      type: "add",
      qty: requested,
      requestedQty: requested,
      previousStock,
      newStock,
      reason: String(reason || "Ingreso de mercadería").trim() || "Ingreso de mercadería",
      userId: profile.id,
      userName: userName(profile),
      saleId: "",
      transferId: "",
      createdAt: serverTimestamp(),
    });
    const result = {
      operationId: safeId,
      operationType: "add_stock",
      inventoryType: type,
      inventoryId: inventory.id,
      productId: product.productId || product.id,
      previousStock,
      newStock,
      quantity: requested,
      userId: profile.id,
      status: "completed",
      createdAt: serverTimestamp(),
    };
    transaction.set(operationRef, result);
    transaction.set(auditRef, {
      action: "stock.add",
      title: "Mercadería agregada",
      description: `${product.productName || product.name} · +${requested} · ${ownerName}`,
      moduleId: type === INVENTORY_TYPES.LOCATION ? "locations" : "warehouse",
      entityType: "inventoryOperation",
      entityId: safeId,
      ...(type === INVENTORY_TYPES.LOCATION
        ? { locationId: inventory.id, locationName: ownerName }
        : { warehouseId: inventory.id, warehouseName: ownerName }),
      userId: profile.id,
      userName: userName(profile),
      status: "completed",
      createdAt: serverTimestamp(),
    });
    return result;
  });
}

export async function listInventoryMovements({ type, inventoryId, productId, pageSize = 30 }) {
  const max = Math.min(120, Math.max(10, Number(pageSize) || 30));
  const target = type === INVENTORY_TYPES.LOCATION
    ? query(
        collection(db, "stockMovements"),
        where("productId", "==", productId),
        where("locationId", "==", inventoryId),
        orderBy("createdAt", "desc"),
        limit(max),
      )
    : query(
        collection(db, "stockMovements"),
        where("productId", "==", productId),
        where("warehouseId", "==", inventoryId),
        orderBy("createdAt", "desc"),
        limit(max),
      );
  return docsToArray(await getDocs(target))
    .sort((a, b) => {
      const left = a.createdAt?.toMillis?.() || new Date(a.createdAt || 0).getTime();
      const right = b.createdAt?.toMillis?.() || new Date(b.createdAt || 0).getTime();
      return right - left;
    });
}

export async function adjustInventoryStock({ type, inventory, product, quantity, reason, profile, requestId }) {
  if (!Object.values(INVENTORY_TYPES).includes(type)) throw new Error("El tipo de inventario no es válido.");
  const moduleId = type === INVENTORY_TYPES.LOCATION ? "locations" : "warehouse";
  assertPermission(profile, moduleId, "adjustStock", "No tenés permiso para ajustar inventario.");
  if (type === INVENTORY_TYPES.WAREHOUSE) assertPermission(profile, "warehouse", "edit", "El ajuste también requiere permiso para editar el depósito.");
  const requested = wholeInventoryQuantity(quantity, "La cantidad física real");
  const safeId = operationId(requestId);
  const productId = product.productId || product.id;
  const operationRef = doc(db, "inventoryOperations", safeId);
  const stockRef = stockReference(type, inventory.id, productId);
  const movementRef = doc(db, "stockMovements", `${safeId}_${productId}`);
  return runTransaction(db, async (transaction) => {
    const previousOperation = await transaction.get(operationRef);
    if (previousOperation.exists()) return previousOperation.data();
    const ownerSnapshot = await transaction.get(ownerReference(type, inventory.id));
    const stockSnapshot = await transaction.get(stockRef);
    if (!ownerSnapshot.exists() || ownerSnapshot.data().deleted === true || !stockSnapshot.exists() || stockSnapshot.data().deleted === true) throw new Error("El inventario ya no está disponible.");
    const previousStock = wholeInventoryQuantity(stockSnapshot.data().currentStock || 0, "El stock anterior", { allowNegative: type === INVENTORY_TYPES.LOCATION });
    const note = String(reason || "Ajuste por conteo físico").trim() || "Ajuste por conteo físico";
    const context = type === INVENTORY_TYPES.LOCATION ? { locationId: inventory.id, locationName: ownerSnapshot.data().name } : { warehouseId: inventory.id, warehouseName: ownerSnapshot.data().name };
    const result = { operationId: safeId, operationType: "adjust_stock", inventoryType: type, inventoryId: inventory.id, productId, previousStock, newStock: requested, quantity: requested - previousStock, reason: note, userId: profile.id, status: "completed", createdAt: serverTimestamp() };
    transaction.update(stockRef, { currentStock: requested, lastMovementId: movementRef.id, updatedAt: serverTimestamp(), updatedBy: profile.id });
    transaction.set(movementRef, { ...result, ...context, type: "adjustment", qty: requested - previousStock, requestedQty: requested, productName: stockSnapshot.data().productName || product.productName || product.name, userName: userName(profile), saleId: "", transferId: "" });
    transaction.set(operationRef, result);
    transaction.set(doc(db, "auditLogs", safeId), { ...context, action: "stock.adjust", title: "Inventario ajustado", description: `${product.productName || product.name} · ${previousStock} → ${requested} · ${note}`, moduleId, entityType: "inventoryOperation", entityId: safeId, previousStock, newStock: requested, userId: profile.id, userName: userName(profile), status: "completed", createdAt: serverTimestamp() });
    return result;
  });
}

export async function transferStock({ origin: requestedOrigin, originWarehouse, destination, lines, profile, carrierName = "", transferId: requestedTransferId }) {
  const origin = requestedOrigin || { ...originWarehouse, type: INVENTORY_TYPES.WAREHOUSE };
  assertPermission(profile, "warehouse", "transferStock", "No tenés permiso para transferir stock.");
  if (!origin?.id || !Object.values(INVENTORY_TYPES).includes(origin.type)) throw new Error("Elegí un origen válido.");
  if (!destination?.id || ![INVENTORY_TYPES.LOCATION, INVENTORY_TYPES.WAREHOUSE].includes(destination.type)) {
    throw new Error("Elegí un destino válido.");
  }
  if (destination.type === origin.type && destination.id === origin.id) {
    throw new Error("El origen y el destino deben ser distintos.");
  }
  const selected = (lines || []).filter((line) => Number(line.quantity || 0) !== 0);
  if (!selected.length) throw new Error("Elegí al menos un producto para transferir.");
  assertUniqueInventoryProducts(selected);
  if (selected.length > 40) throw new Error("Podés transferir hasta 40 productos por operación.");
  const safeId = operationId(requestedTransferId);
  const transferRef = doc(db, "stockTransfers", safeId);
  const originRef = ownerReference(origin.type, origin.id);
  const destinationRef = ownerReference(destination.type, destination.id);
  const auditRef = doc(db, "auditLogs", safeId);

  return runTransaction(db, async (transaction) => {
    const transferSnapshot = await transaction.get(transferRef);
    if (transferSnapshot.exists()) return { id: transferRef.id, ...transferSnapshot.data() };
    const originSnapshot = await transaction.get(originRef);
    const destinationSnapshot = await transaction.get(destinationRef);
    if (!originSnapshot.exists() || originSnapshot.data().deleted === true || (origin.type === INVENTORY_TYPES.WAREHOUSE && originSnapshot.data().active === false)) {
      throw new Error("El origen ya no está disponible.");
    }
    if (!destinationSnapshot.exists() || destinationSnapshot.data().deleted === true || (destination.type === INVENTORY_TYPES.WAREHOUSE && destinationSnapshot.data().active === false)) {
      throw new Error("El destino ya no está disponible.");
    }

    const prepared = [];
    for (const line of selected) {
      const productId = line.productId || line.id;
      const productRef = doc(db, "products", productId);
      const originStockRef = stockReference(origin.type, origin.id, productId);
      const destinationStockRef = stockReference(destination.type, destination.id, productId);
      const productSnapshot = await transaction.get(productRef);
      const originStockSnapshot = await transaction.get(originStockRef);
      const destinationStockSnapshot = await transaction.get(destinationStockRef);
      if (!productSnapshot.exists() || productSnapshot.data().deleted === true) {
        throw new Error(`${line.productName || "Un producto"} ya no existe en Productos.`);
      }
      if (!originStockSnapshot.exists() || originStockSnapshot.data().deleted === true || originStockSnapshot.data().active === false) {
        throw new Error(`${productSnapshot.data().name} ya no forma parte del inventario de origen.`);
      }
      const available = Number(originStockSnapshot.data().currentStock || 0);
      const reconciled = reconcileTransferLine({ ...line, productName: productSnapshot.data().name }, available);
      prepared.push({
        line,
        productId,
        product: productSnapshot.data(),
        ...reconciled,
        originStockRef,
        originStock: originStockSnapshot.data(),
        destinationStockRef,
        destinationStock: destinationStockSnapshot.exists() && destinationStockSnapshot.data().deleted !== true
          ? destinationStockSnapshot.data()
          : null,
      });
    }

    const plan = buildStockTransferWrites({ prepared, origin: { ...origin, name: originSnapshot.data().name }, destination: { ...destination, name: destinationSnapshot.data().name }, profile, carrierName, transferId: safeId, stamp: serverTimestamp() });
    for (const write of plan.writes) {
      const reference = doc(db, write.path);
      if (write.type === "update") transaction.update(reference, write.data);
      else transaction.set(reference, write.data);
    }
    return plan.result;
  });
}

export async function getTransferDestinationInventory(destination) {
  if (!destination?.id) return [];
  return destination.type === INVENTORY_TYPES.LOCATION
    ? listLocationInventory(destination.id)
    : listWarehouseInventory(destination.id);
}

export function resolvedLocationPrice(item, product) {
  return effectiveLocationPrice(product, item);
}
