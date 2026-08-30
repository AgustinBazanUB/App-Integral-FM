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
  where,
  writeBatch,
} from "firebase/firestore";
import {
  INVENTORY_TYPES,
  PRICE_MODES,
  effectiveLocationPrice,
  mergeLocationInventoryItem,
  mergeWarehouseInventoryItem,
  validateTransferLine,
  wholeInventoryQuantity,
} from "../../modules/inventory/domain/inventory";
import { can, normalizedRole } from "../permissions";
import { db } from "./firebase";

const docsToArray = (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
const userName = (profile) => profile.name || profile.email || "Usuario";
const normalizedText = (value) => String(value || "").trim().toLocaleLowerCase("es");
const operationId = (value = "") => String(value || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "");

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

function productPayload(values, categoryName, profile, editing) {
  const name = String(values.name || "").trim();
  const abbreviation = String(values.abbreviation || "").trim().toUpperCase();
  const defaultPrice = wholeInventoryQuantity(values.defaultPrice || 0, "El precio predeterminado");
  const yellowAlertQty = wholeInventoryQuantity(values.yellowAlertQty || 0, "La alerta amarilla");
  const redAlertQty = wholeInventoryQuantity(values.redAlertQty || 0, "La alerta roja");
  if (!name) throw new Error("Ingresá el nombre del producto.");
  if (!abbreviation) throw new Error("Ingresá una abreviación.");
  if (abbreviation.length > 8) throw new Error("La abreviación admite hasta 8 caracteres.");
  if (yellowAlertQty < redAlertQty) throw new Error("La alerta amarilla debe ser mayor o igual a la roja.");
  return {
    name,
    nameKey: normalizedText(name),
    abbreviation,
    abbreviationKey: normalizedText(abbreviation),
    description: String(values.description || "").trim(),
    defaultPrice,
    yellowAlertQty,
    redAlertQty,
    categoryId: String(values.categoryId || "").trim(),
    categoryName,
    imageUrl: String(values.imageUrl || "").trim(),
    thumbUrl: String(values.thumbUrl || values.imageUrl || "").trim(),
    imageAlt: String(values.imageAlt || name).trim(),
    imageStatus: values.imageStatus || "available",
    originalImageFileName: String(values.originalImageFileName || "").trim(),
    buttonKey: String(values.buttonKey || "").trim(),
    buttonCode: String(values.buttonCode || "").trim(),
    buttonLocation: Number(values.buttonLocation || 0),
    buttonLabel: String(values.buttonLabel || values.buttonKey || "").trim(),
    active: values.active !== false,
    deleted: false,
    updatedAt: serverTimestamp(),
    updatedBy: profile.id,
    updatedByName: userName(profile),
    ...(editing ? {} : {
      createdAt: serverTimestamp(),
      createdBy: profile.id,
      createdByName: userName(profile),
    }),
  };
}

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
  requestId,
}) {
  assertPermission(profile, "locations", "configureLocationProducts", "No tenés permiso para agregar productos a esta ubicación.");
  if (!location?.id) throw new Error("La ubicación no está disponible.");
  const initial = wholeInventoryQuantity(initialStock || 0, "El stock inicial");
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
      yellowAlertQty: Number(master.yellowAlertQty || 0),
      redAlertQty: Number(master.redAlertQty || 0),
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
    const stockSnapshot = await transaction.get(stockRef);
    if (!ownerSnapshot.exists() || ownerSnapshot.data().deleted === true || ownerSnapshot.data().active === false) {
      throw new Error(type === INVENTORY_TYPES.LOCATION ? "La ubicación ya no está disponible." : "El depósito ya no está disponible.");
    }
    if (!stockSnapshot.exists() || stockSnapshot.data().deleted === true || stockSnapshot.data().active === false) {
      throw new Error(`${product.productName || product.name} todavía no forma parte del stock de este lugar.`);
    }
    const previousStock = wholeInventoryQuantity(stockSnapshot.data().currentStock || 0, "El stock actual");
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
        limit(max),
      )
    : query(
        collection(db, "stockMovements"),
        where("productId", "==", productId),
        where("warehouseId", "==", inventoryId),
        limit(max),
      );
  return docsToArray(await getDocs(target))
    .sort((a, b) => {
      const left = a.createdAt?.toMillis?.() || new Date(a.createdAt || 0).getTime();
      const right = b.createdAt?.toMillis?.() || new Date(b.createdAt || 0).getTime();
      return right - left;
    });
}

export async function transferStock({ originWarehouse, destination, lines, profile, transferId: requestedTransferId }) {
  assertPermission(profile, "warehouse", "transferStock", "No tenés permiso para transferir stock.");
  if (!originWarehouse?.id) throw new Error("Elegí un depósito de origen.");
  if (!destination?.id || ![INVENTORY_TYPES.LOCATION, INVENTORY_TYPES.WAREHOUSE].includes(destination.type)) {
    throw new Error("Elegí un destino válido.");
  }
  if (destination.type === INVENTORY_TYPES.WAREHOUSE && destination.id === originWarehouse.id) {
    throw new Error("El origen y el destino deben ser distintos.");
  }
  const selected = (lines || []).filter((line) => Number(line.quantity || 0) > 0);
  if (!selected.length) throw new Error("Elegí al menos un producto para transferir.");
  if (selected.length > 40) throw new Error("Podés transferir hasta 40 productos por operación.");
  const safeId = operationId(requestedTransferId);
  const transferRef = doc(db, "stockTransfers", safeId);
  const originRef = doc(db, "warehouses", originWarehouse.id);
  const destinationRef = ownerReference(destination.type, destination.id);
  const auditRef = doc(db, "auditLogs", safeId);

  return runTransaction(db, async (transaction) => {
    const transferSnapshot = await transaction.get(transferRef);
    if (transferSnapshot.exists()) return { id: transferRef.id, ...transferSnapshot.data() };
    const originSnapshot = await transaction.get(originRef);
    const destinationSnapshot = await transaction.get(destinationRef);
    if (!originSnapshot.exists() || originSnapshot.data().deleted === true || originSnapshot.data().active === false) {
      throw new Error("El depósito de origen ya no está disponible.");
    }
    if (!destinationSnapshot.exists() || destinationSnapshot.data().deleted === true || destinationSnapshot.data().active === false) {
      throw new Error("El destino ya no está disponible.");
    }

    const prepared = [];
    for (const line of selected) {
      const productId = line.productId || line.id;
      const productRef = doc(db, "products", productId);
      const originStockRef = doc(db, "warehouseStock", originWarehouse.id, "items", productId);
      const destinationStockRef = stockReference(destination.type, destination.id, productId);
      const productSnapshot = await transaction.get(productRef);
      const originStockSnapshot = await transaction.get(originStockRef);
      const destinationStockSnapshot = await transaction.get(destinationStockRef);
      if (!productSnapshot.exists() || productSnapshot.data().deleted === true) {
        throw new Error(`${line.productName || "Un producto"} ya no existe en Productos.`);
      }
      if (!originStockSnapshot.exists() || originStockSnapshot.data().deleted === true || originStockSnapshot.data().active === false) {
        throw new Error(`${productSnapshot.data().name} ya no forma parte del depósito de origen.`);
      }
      const available = Number(originStockSnapshot.data().currentStock || 0);
      const quantity = validateTransferLine({ ...line, productName: productSnapshot.data().name }, available);
      prepared.push({
        line,
        productId,
        product: productSnapshot.data(),
        quantity,
        originStockRef,
        originStock: originStockSnapshot.data(),
        destinationStockRef,
        destinationStock: destinationStockSnapshot.exists() && destinationStockSnapshot.data().deleted !== true
          ? destinationStockSnapshot.data()
          : null,
      });
    }

    const originName = originSnapshot.data().name;
    const destinationName = destinationSnapshot.data().name;
    prepared.forEach((item) => {
      const originPrevious = Number(item.originStock.currentStock || 0);
      const originNew = originPrevious - item.quantity;
      const destinationPrevious = Number(item.destinationStock?.currentStock || 0);
      const destinationNew = destinationPrevious + item.quantity;
      const outMovementRef = doc(db, "stockMovements", `${safeId}_${item.productId}_out`);
      const inMovementRef = doc(db, "stockMovements", `${safeId}_${item.productId}_in`);

      transaction.update(item.originStockRef, {
        currentStock: originNew,
        lastMovementId: outMovementRef.id,
        updatedAt: serverTimestamp(),
        updatedBy: profile.id,
      });

      if (item.destinationStock) {
        // Si ya existía en el destino se modifica únicamente el stock: precio,
        // alertas y demás configuración local quedan exactamente como estaban.
        transaction.update(item.destinationStockRef, {
          currentStock: destinationNew,
          lastMovementId: inMovementRef.id,
          updatedAt: serverTimestamp(),
          updatedBy: profile.id,
        });
      } else if (destination.type === INVENTORY_TYPES.LOCATION) {
        const wantsCustomPrice = item.line.destinationUseDefaultPrice === false;
        const priceOverride = wantsCustomPrice
          ? wholeInventoryQuantity(item.line.destinationPriceOverride, `El precio especial de ${item.product.name}`)
          : null;
        transaction.set(item.destinationStockRef, {
          productId: item.productId,
          productName: item.product.name,
          abbreviation: item.product.abbreviation || "",
          categoryId: item.product.categoryId || "",
          categoryName: item.product.categoryName || "Sin categoría",
          imageUrl: item.product.imageUrl || "",
          thumbUrl: item.product.thumbUrl || "",
          priceMode: wantsCustomPrice ? PRICE_MODES.CUSTOM : PRICE_MODES.DEFAULT,
          priceOverride,
          price: wantsCustomPrice ? priceOverride : Number(item.product.defaultPrice || 0),
          masterDefaultPrice: Number(item.product.defaultPrice || 0),
          initialStock: item.quantity,
          currentStock: item.quantity,
          yellowAlertQty: Number(item.product.yellowAlertQty || 0),
          redAlertQty: Number(item.product.redAlertQty || 0),
          active: true,
          deleted: false,
          productDeleted: false,
          assignedAt: serverTimestamp(),
          assignedBy: profile.id,
          updatedAt: serverTimestamp(),
          updatedBy: profile.id,
          lastMovementId: inMovementRef.id,
        });
      } else {
        transaction.set(item.destinationStockRef, {
          productId: item.productId,
          productName: item.product.name,
          abbreviation: item.product.abbreviation || "",
          categoryId: item.product.categoryId || "",
          categoryName: item.product.categoryName || "Sin categoría",
          imageUrl: item.product.imageUrl || "",
          thumbUrl: item.product.thumbUrl || "",
          initialStock: item.quantity,
          currentStock: item.quantity,
          active: true,
          deleted: false,
          productDeleted: false,
          assignedAt: serverTimestamp(),
          assignedBy: profile.id,
          updatedAt: serverTimestamp(),
          updatedBy: profile.id,
          lastMovementId: inMovementRef.id,
        });
      }

      transaction.set(outMovementRef, {
        operationId: safeId,
        transferId: safeId,
        inventoryType: INVENTORY_TYPES.WAREHOUSE,
        inventoryId: originWarehouse.id,
        warehouseId: originWarehouse.id,
        warehouseName: originName,
        productId: item.productId,
        productName: item.product.name,
        type: "transfer_out",
        qty: -item.quantity,
        requestedQty: item.quantity,
        previousStock: originPrevious,
        newStock: originNew,
        reason: `Transferencia a ${destinationName}`,
        originType: INVENTORY_TYPES.WAREHOUSE,
        originId: originWarehouse.id,
        originName,
        destinationType: destination.type,
        destinationId: destination.id,
        destinationName,
        userId: profile.id,
        userName: userName(profile),
        saleId: "",
        createdAt: serverTimestamp(),
      });
      transaction.set(inMovementRef, {
        operationId: safeId,
        transferId: safeId,
        inventoryType: destination.type,
        inventoryId: destination.id,
        ...(destination.type === INVENTORY_TYPES.LOCATION
          ? { locationId: destination.id, locationName: destinationName }
          : { warehouseId: destination.id, warehouseName: destinationName }),
        productId: item.productId,
        productName: item.product.name,
        type: "transfer_in",
        qty: item.quantity,
        requestedQty: item.quantity,
        previousStock: destinationPrevious,
        newStock: destinationNew,
        reason: `Transferencia desde ${originName}`,
        originType: INVENTORY_TYPES.WAREHOUSE,
        originId: originWarehouse.id,
        originName,
        destinationType: destination.type,
        destinationId: destination.id,
        destinationName,
        userId: profile.id,
        userName: userName(profile),
        saleId: "",
        createdAt: serverTimestamp(),
      });
    });

    const totalQuantity = prepared.reduce((sum, item) => sum + item.quantity, 0);
    const payload = {
      createdBy: profile.id,
      createdByName: userName(profile),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      status: "completed",
      sourceType: INVENTORY_TYPES.WAREHOUSE,
      sourceId: originWarehouse.id,
      sourceName: originName,
      destinationType: destination.type,
      destinationId: destination.id,
      destinationName,
      itemCount: prepared.length,
      totalQuantity,
      items: prepared.map((item) => ({
        productId: item.productId,
        productName: item.product.name,
        quantity: item.quantity,
      })),
      note: String(destination.note || "").trim(),
    };
    transaction.set(transferRef, payload);
    transaction.set(auditRef, {
      action: "stock.transfer",
      title: "Transferencia de stock",
      description: `${originName} → ${destinationName} · ${prepared.length} producto${prepared.length === 1 ? "" : "s"}`,
      moduleId: "warehouse",
      entityType: "stockTransfer",
      entityId: safeId,
      sourceWarehouseId: originWarehouse.id,
      destinationType: destination.type,
      destinationId: destination.id,
      userId: profile.id,
      userName: userName(profile),
      status: "completed",
      createdAt: serverTimestamp(),
    });
    return { id: safeId, ...payload };
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
