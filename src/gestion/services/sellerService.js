import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
} from "firebase/firestore";
import { calculateDiscountSummary } from "../../modules/locations/domain/discounts";
import { isDiscountAvailable } from "../../modules/locations/domain/dashboard";
import { isLocationActiveNow } from "../../modules/locations/domain/locations";
import { normalizePayment } from "../../modules/locations/domain/payments";
import {
  addArgentinaDays,
  argentinaDateKey,
  argentinaParts,
  argentinaStartOfDay,
} from "../../modules/locations/domain/time";
import {
  can,
  canAccessAdministration,
  effectiveSellerLocations,
} from "../permissions";
import { db } from "./firebase";
import { listDiscounts, listProductCategories } from "./locationManagementService";
import { listLocations } from "./managementService";

const docsToArray = (snapshot) =>
  snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
const userName = (profile) => profile.name || profile.email || "Usuario";

const wholeNumber = (value, label, minimum = 0) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) {
    throw new Error(`${label} debe ser un número entero mayor o igual a ${minimum}.`);
  }
  return number;
};

function cleanSaleItems(items = []) {
  const cleaned = items
    .map((item) => {
      const qty = wholeNumber(
        item.qty,
        `La cantidad de ${item.name || item.productName || "un producto"}`,
        0,
      );
      if (!qty) return null;
      const unitPrice = wholeNumber(
        item.unitPrice ?? item.price ?? 0,
        `El precio de ${item.name || item.productName || "un producto"}`,
        0,
      );
      return {
        productId: item.productId || item.id,
        name: item.name || item.productName,
        abbreviation: item.abbreviation || "",
        unitPrice,
        qty,
        subtotal: unitPrice * qty,
      };
    })
    .filter(Boolean);
  if (!cleaned.length) throw new Error("La venta está vacía.");
  return cleaned;
}

function insufficientStockError(item, available) {
  const error = new Error(
    `${item.name}: el stock disponible es ${available}. Corregí el carrito antes de continuar.`,
  );
  error.code = "seller/insufficient-stock";
  error.productId = item.productId;
  error.availableStock = available;
  return error;
}

export async function listSellerLocations(profile) {
  const locations = await listLocations(profile);
  return effectiveSellerLocations(profile, locations);
}

export async function assertSellerLocation(profile, locationId) {
  if (!can(profile, "quick-sales", "view")) {
    throw new Error("No tenés permiso para abrir el Panel Vendedor.");
  }
  const snapshot = await getDoc(doc(db, "locations", locationId));
  if (!snapshot.exists()) throw new Error("La ubicación ya no existe.");
  const location = { id: snapshot.id, ...snapshot.data() };
  if (!effectiveSellerLocations(profile, [location]).length) {
    throw new Error("No tenés permiso para vender desde esta ubicación activa.");
  }
  return location;
}

export async function subscribeSellerLocationStock({
  profile,
  locationId,
  onData,
  onError,
}) {
  await assertSellerLocation(profile, locationId);
  return onSnapshot(
    query(
      collection(db, "locationStock", locationId, "items"),
      orderBy("productName"),
    ),
    (snapshot) => onData(
      docsToArray(snapshot).filter((item) =>
        item.active !== false &&
        item.deleted !== true &&
        item.productDeleted !== true,
      ),
    ),
    onError,
  );
}

export async function loadSellerResources(profile) {
  const [categories, discounts, shortcutsSnapshot] = await Promise.all([
    listProductCategories(profile),
    listDiscounts(profile),
    getDoc(doc(db, "settings", "keyboardShortcuts")),
  ]);
  return {
    categories,
    discounts,
    shortcuts: shortcutsSnapshot.exists()
      ? shortcutsSnapshot.data()
      : { sellerActions: {} },
  };
}

export async function listSellerDailySales(profile, locationId) {
  await assertSellerLocation(profile, locationId);
  const parts = argentinaParts();
  const start = argentinaStartOfDay(parts.year, parts.month, parts.day);
  const end = addArgentinaDays(start, 1);
  return docsToArray(await getDocs(query(
    collection(db, "sales"),
    where("locationId", "==", locationId),
    where("sellerId", "==", profile.id),
    where("createdAt", ">=", Timestamp.fromDate(start)),
    where("createdAt", "<", Timestamp.fromDate(end)),
    orderBy("createdAt", "desc"),
    limit(150),
  )));
}

async function verifiedDiscounts({ profile, location, discounts, items }) {
  if (!discounts?.length) return [];
  if (!can(profile, "quick-sales", "useDiscounts")) {
    throw new Error("No tenés permiso para aplicar descuentos.");
  }
  const ids = [...new Set(discounts.map((discount) =>
    discount.discountId || discount.id,
  ).filter(Boolean))];
  const snapshots = await Promise.all(ids.map((id) => getDoc(doc(db, "discounts", id))));
  return snapshots.map((snapshot) => {
    if (!snapshot.exists()) throw new Error("Uno de los descuentos ya no existe.");
    const discount = { id: snapshot.id, ...snapshot.data() };
    if (!isDiscountAvailable(discount, location, new Date(), { profile, items })) {
      throw new Error(`${discount.name || "El descuento"} ya no está disponible para esta venta.`);
    }
    return discount;
  });
}

function saleRefs({ location, saleItems, seller, offlineSale }) {
  const dateKey = argentinaDateKey().replaceAll("-", "");
  const prefix = String(location.codePrefix || "LOC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  const localId = String(offlineSale?.localId || "").trim();
  if (localId && !/^local_[A-Za-z0-9_-]+$/.test(localId)) {
    throw new Error("El identificador de la venta pendiente no es válido.");
  }
  return {
    dateKey,
    prefix,
    localId,
    counterRef: doc(db, "counters", `${prefix}_${dateKey}`),
    saleRef: localId
      ? doc(db, "sales", `offline_${seller.id}_${localId}`.replaceAll("/", "_"))
      : doc(collection(db, "sales")),
    stockRefs: saleItems.map((item) =>
      doc(db, "locationStock", location.id, "items", item.productId),
    ),
    movementRefs: saleItems.map(() => doc(collection(db, "stockMovements"))),
    auditRef: doc(collection(db, "auditLogs")),
  };
}

export async function createSellerSale({
  profile,
  location,
  items,
  discounts = [],
  paymentMethod,
  paymentMethodLabel,
  payments = [],
  offlineSale = null,
}) {
  if (!can(profile, "quick-sales", "create")) {
    throw new Error("No tenés permiso para registrar ventas.");
  }
  const permittedLocation = await assertSellerLocation(profile, location?.id);
  const saleItems = cleanSaleItems(items);
  const safeDiscounts = await verifiedDiscounts({
    profile,
    location: permittedLocation,
    discounts,
    items: saleItems,
  });
  const subtotal = saleItems.reduce((sum, item) => sum + item.subtotal, 0);
  const discountSummary = calculateDiscountSummary(safeDiscounts, subtotal);
  const payment = normalizePayment(
    paymentMethod,
    paymentMethodLabel,
    payments,
    discountSummary.total,
  );
  const refs = saleRefs({
    location: permittedLocation,
    saleItems,
    seller: profile,
    offlineSale,
  });
  const createdLocallyAt = refs.localId
    ? new Date(offlineSale.createdLocallyAt)
    : null;
  if (createdLocallyAt && Number.isNaN(createdLocallyAt.valueOf())) {
    throw new Error("La fecha local de la venta pendiente no es válida.");
  }

  return runTransaction(db, async (transaction) => {
    if (refs.localId) {
      const existing = await transaction.get(refs.saleRef);
      if (existing.exists()) {
        const data = existing.data();
        if (data.offlineLocalId !== refs.localId || data.sellerId !== profile.id) {
          throw new Error("El identificador pendiente ya está en uso.");
        }
        return {
          id: refs.saleRef.id,
          saleCode: data.saleCode,
          total: data.total,
          ...payment,
          createdAt: data.createdAt,
          alreadySynced: true,
        };
      }
    }
    const locationSnapshot = await transaction.get(
      doc(db, "locations", permittedLocation.id),
    );
    if (
      !locationSnapshot.exists() ||
      !isLocationActiveNow({ id: locationSnapshot.id, ...locationSnapshot.data() })
    ) {
      throw new Error("La ubicación dejó de estar activa.");
    }
    const counterSnapshot = await transaction.get(refs.counterRef);
    const stockSnapshots = [];
    for (const stockRef of refs.stockRefs) {
      stockSnapshots.push(await transaction.get(stockRef));
    }
    const next = Number(counterSnapshot.data()?.lastNumber || 0) + 1;
    const saleCode = `FM-${refs.prefix}-${refs.dateKey}-${String(next).padStart(4, "0")}`;
    transaction.set(refs.counterRef, {
      locationId: permittedLocation.id,
      date: refs.dateKey,
      lastNumber: next,
    }, { merge: true });
    stockSnapshots.forEach((snapshot, index) => {
      const item = saleItems[index];
      if (
        !snapshot.exists() ||
        snapshot.data().active === false ||
        snapshot.data().deleted === true ||
        snapshot.data().productDeleted === true
      ) {
        throw new Error(`${item.name} ya no está habilitado en esta ubicación.`);
      }
      const previousStock = Number(snapshot.data().currentStock || 0);
      if (previousStock < item.qty) throw insufficientStockError(item, previousStock);
      const newStock = previousStock - item.qty;
      transaction.update(refs.stockRefs[index], {
        currentStock: newStock,
        lastSaleId: refs.saleRef.id,
        lastMovementId: refs.movementRefs[index].id,
        updatedAt: serverTimestamp(),
      });
      transaction.set(refs.movementRefs[index], {
        locationId: permittedLocation.id,
        locationName: permittedLocation.name,
        productId: item.productId,
        productName: item.name,
        type: "sale",
        qty: -item.qty,
        previousStock,
        newStock,
        reason: `Venta ${saleCode}`,
        userId: profile.id,
        userName: userName(profile),
        saleId: refs.saleRef.id,
        createdAt: serverTimestamp(),
      });
    });
    transaction.set(refs.saleRef, {
      saleCode,
      locationId: permittedLocation.id,
      locationName: permittedLocation.name,
      locationPrefix: refs.prefix,
      sellerId: profile.id,
      sellerName: userName(profile),
      items: saleItems,
      discounts: discountSummary.discounts,
      discount: null,
      discountTotal: discountSummary.discountTotal,
      totalBeforeDiscounts: discountSummary.totalBeforeDiscounts,
      ...payment,
      subtotal,
      totalItems: saleItems.reduce((sum, item) => sum + item.qty, 0),
      total: discountSummary.total,
      status: "active",
      sourceChannel: "in_person",
      ...(refs.localId ? {
        offlineLocalId: refs.localId,
        createdOffline: true,
        createdLocallyAt: createdLocallyAt.toISOString(),
        syncedAt: serverTimestamp(),
      } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      deletedAt: null,
    });
    transaction.set(refs.auditRef, {
      action: "sale.created",
      title: refs.localId ? "Venta pendiente sincronizada" : "Venta registrada",
      description: `${saleCode} · ${permittedLocation.name}`,
      moduleId: "quick-sales",
      entityType: "sale",
      entityId: refs.saleRef.id,
      locationId: permittedLocation.id,
      locationName: permittedLocation.name,
      userId: profile.id,
      userName: userName(profile),
      status: "completed",
      amount: discountSummary.total,
      createdAt: serverTimestamp(),
    });
    return {
      id: refs.saleRef.id,
      saleCode,
      total: discountSummary.total,
      ...payment,
      createdAt: new Date(),
    };
  });
}

export async function updateSellerSale({
  profile,
  saleId,
  items,
  discounts = [],
  paymentMethod,
  paymentMethodLabel,
  payments = [],
}) {
  if (!can(profile, "quick-sales", "edit")) {
    throw new Error("No tenés permiso para editar ventas.");
  }
  const saleReference = doc(db, "sales", saleId);
  const initialSale = await getDoc(saleReference);
  if (!initialSale.exists()) throw new Error("La venta ya no existe.");
  const original = initialSale.data();
  if (!canAccessAdministration(profile) && original.sellerId !== profile.id) {
    throw new Error("No podés editar una venta ajena.");
  }
  const location = await assertSellerLocation(profile, original.locationId);
  const newItems = cleanSaleItems(items);
  const safeDiscounts = await verifiedDiscounts({
    profile,
    location,
    discounts,
    items: newItems,
  });
  const subtotal = newItems.reduce((sum, item) => sum + item.subtotal, 0);
  const discountSummary = calculateDiscountSummary(safeDiscounts, subtotal);
  const payment = normalizePayment(
    paymentMethod,
    paymentMethodLabel,
    payments,
    discountSummary.total,
  );

  return runTransaction(db, async (transaction) => {
    const saleSnapshot = await transaction.get(saleReference);
    if (!saleSnapshot.exists()) throw new Error("La venta ya no existe.");
    const sale = saleSnapshot.data();
    if (sale.status !== "active") throw new Error("La venta está anulada.");
    if (!canAccessAdministration(profile) && sale.sellerId !== profile.id) {
      throw new Error("No podés editar una venta ajena.");
    }
    const oldQty = new Map((sale.items || []).map((item) => [item.productId, Number(item.qty)]));
    const newQty = new Map(newItems.map((item) => [item.productId, Number(item.qty)]));
    const productIds = [...new Set([...oldQty.keys(), ...newQty.keys()])];
    const stockRefs = productIds.map((productId) =>
      doc(db, "locationStock", sale.locationId, "items", productId),
    );
    const movementRefs = productIds.map(() => doc(collection(db, "stockMovements")));
    const stockSnapshots = [];
    for (const stockRef of stockRefs) stockSnapshots.push(await transaction.get(stockRef));
    productIds.forEach((productId, index) => {
      const difference = (oldQty.get(productId) || 0) - (newQty.get(productId) || 0);
      if (!difference) return;
      const snapshot = stockSnapshots[index];
      const item = newItems.find((entry) => entry.productId === productId) ||
        sale.items.find((entry) => entry.productId === productId);
      if (!snapshot.exists()) throw new Error(`Falta el stock de ${item.name}.`);
      const previousStock = Number(snapshot.data().currentStock || 0);
      const newStock = previousStock + difference;
      if (newStock < 0) throw insufficientStockError(item, previousStock + (oldQty.get(productId) || 0));
      transaction.update(stockRefs[index], {
        currentStock: newStock,
        lastSaleId: saleId,
        lastMovementId: movementRefs[index].id,
        updatedAt: serverTimestamp(),
      });
      transaction.set(movementRefs[index], {
        locationId: sale.locationId,
        locationName: sale.locationName,
        productId,
        productName: item.name,
        type: "sale_edit",
        qty: difference,
        previousStock,
        newStock,
        reason: `Edición ${sale.saleCode}`,
        userId: profile.id,
        userName: userName(profile),
        saleId,
        createdAt: serverTimestamp(),
      });
    });
    transaction.update(saleReference, {
      items: newItems,
      discounts: discountSummary.discounts,
      discount: null,
      discountTotal: discountSummary.discountTotal,
      totalBeforeDiscounts: discountSummary.totalBeforeDiscounts,
      ...payment,
      subtotal,
      totalItems: newItems.reduce((sum, item) => sum + item.qty, 0),
      total: discountSummary.total,
      editedAt: serverTimestamp(),
      editedBy: profile.id,
      editedByName: userName(profile),
      updatedAt: serverTimestamp(),
    });
    transaction.set(doc(collection(db, "auditLogs")), {
      action: "sale.updated",
      title: "Venta editada",
      description: `${sale.saleCode} · ${sale.locationName}`,
      moduleId: "quick-sales",
      entityType: "sale",
      entityId: saleId,
      locationId: sale.locationId,
      locationName: sale.locationName,
      userId: profile.id,
      userName: userName(profile),
      status: "completed",
      amount: discountSummary.total,
      createdAt: serverTimestamp(),
    });
    return {
      id: saleId,
      saleCode: sale.saleCode,
      total: discountSummary.total,
      ...payment,
      createdAt: sale.createdAt,
    };
  });
}

export async function cancelSellerSale({ profile, saleId, reason }) {
  if (!can(profile, "quick-sales", "cancelOwn") && !canAccessAdministration(profile)) {
    throw new Error("No tenés permiso para anular ventas.");
  }
  const safeReason = String(reason || "").trim();
  if (safeReason.length < 3) throw new Error("Indicá el motivo de la anulación.");
  const saleReference = doc(db, "sales", saleId);
  return runTransaction(db, async (transaction) => {
    const saleSnapshot = await transaction.get(saleReference);
    if (!saleSnapshot.exists()) throw new Error("La venta ya no existe.");
    const sale = saleSnapshot.data();
    if (sale.status !== "active") throw new Error("La venta ya está anulada.");
    if (!canAccessAdministration(profile) && sale.sellerId !== profile.id) {
      throw new Error("No podés anular una venta ajena.");
    }
    const locationSnapshot = await transaction.get(doc(db, "locations", sale.locationId));
    if (!locationSnapshot.exists() || locationSnapshot.data().deleted === true) {
      throw new Error("La ubicación de la venta ya no existe.");
    }
    const stockRefs = sale.items.map((item) =>
      doc(db, "locationStock", sale.locationId, "items", item.productId),
    );
    const movementRefs = sale.items.map(() => doc(collection(db, "stockMovements")));
    const stockSnapshots = [];
    for (const stockRef of stockRefs) stockSnapshots.push(await transaction.get(stockRef));
    sale.items.forEach((item, index) => {
      if (!stockSnapshots[index].exists()) throw new Error(`Falta el stock de ${item.name}.`);
      const previousStock = Number(stockSnapshots[index].data().currentStock || 0);
      const newStock = previousStock + Number(item.qty || 0);
      transaction.update(stockRefs[index], {
        currentStock: newStock,
        lastSaleId: saleId,
        lastMovementId: movementRefs[index].id,
        updatedAt: serverTimestamp(),
      });
      transaction.set(movementRefs[index], {
        locationId: sale.locationId,
        locationName: sale.locationName,
        productId: item.productId,
        productName: item.name,
        type: "sale_cancel",
        qty: Number(item.qty || 0),
        previousStock,
        newStock,
        reason: `Anulación ${sale.saleCode}: ${safeReason}`,
        userId: profile.id,
        userName: userName(profile),
        saleId,
        createdAt: serverTimestamp(),
      });
    });
    transaction.update(saleReference, {
      status: "cancelled",
      cancelledAt: serverTimestamp(),
      cancelledBy: profile.id,
      cancelledByName: userName(profile),
      cancelReason: safeReason,
      updatedAt: serverTimestamp(),
    });
    transaction.set(doc(collection(db, "auditLogs")), {
      action: "sale.cancelled",
      title: "Venta anulada",
      description: `${sale.saleCode} · ${safeReason}`,
      moduleId: "quick-sales",
      entityType: "sale",
      entityId: saleId,
      locationId: sale.locationId,
      locationName: sale.locationName,
      userId: profile.id,
      userName: userName(profile),
      status: "cancelled",
      amount: Number(sale.total || 0),
      createdAt: serverTimestamp(),
    });
    return { id: saleId, saleCode: sale.saleCode };
  });
}
