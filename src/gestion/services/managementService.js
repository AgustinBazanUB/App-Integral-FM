import { deleteApp, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signOut,
} from "firebase/auth";
import {
  addDoc,
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
} from "firebase/firestore";
import { calculateDiscountSummary } from "../../modules/locations/domain/discounts";
import { isDiscountAvailable } from "../../modules/locations/domain/dashboard";
import { isLocationActiveNow } from "../../modules/locations/domain/locations";
import { normalizePayment } from "../../modules/locations/domain/payments";
import { calculateStockAfterSale } from "../../modules/locations/domain/sales";
import { moduleById } from "../modules";
import { can, normalizedRole } from "../permissions";
import { auth, db, firebaseConfig } from "./firebase";

const docsToArray = (snapshot) =>
  snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));

export async function getUserProfile(uid) {
  const snapshot = await getDoc(doc(db, "users", uid));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export function observeSession(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      callback({ user: null, profile: null, error: null });
      return;
    }
    try {
      const profile = await getUserProfile(user.uid);
      callback({ user, profile, error: null });
    } catch (error) {
      callback({ user, profile: null, error });
    }
  });
}

export async function listModuleRecords(moduleId, pageSize = 40) {
  const definition = moduleById[moduleId];
  if (!definition?.collection) return [];
  const target = collection(db, definition.collection);
  try {
    return docsToArray(
      await getDocs(query(target, orderBy("updatedAt", "desc"), limit(pageSize))),
    );
  } catch (error) {
    if (error.code === "permission-denied") throw error;
    return docsToArray(await getDocs(query(target, limit(pageSize))));
  }
}

export async function createModuleRecord(moduleId, data, profile) {
  const definition = moduleById[moduleId];
  if (!definition?.collection) throw new Error("El módulo no tiene una colección configurada.");
  if (!can(profile, moduleId, "create")) throw new Error("No tenés permiso para crear registros en este módulo.");
  const target = await addDoc(collection(db, definition.collection), {
    ...data,
    moduleId,
    active: true,
    deleted: false,
    createdBy: profile.id,
    createdByName: profile.name || profile.email || "Usuario",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return target.id;
}

export async function saveLocation(data, profile, locationId = null) {
  if (!can(profile, "locations", locationId ? "edit" : "create")) {
    throw new Error("No tenés permiso para guardar ubicaciones.");
  }
  const target = locationId
    ? doc(db, "locations", locationId)
    : doc(collection(db, "locations"));
  await setDoc(
    target,
    {
      name: data.name.trim(),
      type: data.type,
      codePrefix: data.codePrefix.trim().toUpperCase(),
      dniMode: data.dniMode,
      active: data.active !== false,
      deleted: false,
      updatedBy: profile.id,
      updatedByName: profile.name || profile.email,
      updatedAt: serverTimestamp(),
      ...(locationId ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true },
  );
  return target.id;
}

export async function listUsers() {
  return docsToArray(await getDocs(query(collection(db, "users"), limit(100))));
}

export async function createManagedUser(data, administrator) {
  if (normalizedRole(administrator) !== "admin") {
    throw new Error("Sólo un administrador puede crear usuarios.");
  }
  const secondaryApp = initializeApp(
    firebaseConfig,
    `flor-mia-user-creator-${Date.now()}`,
  );
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      data.email.trim(),
      data.password,
    );
    await setDoc(doc(db, "users", credential.user.uid), {
      name: data.name.trim(),
      email: data.email.trim().toLowerCase(),
      role: data.role,
      active: true,
      allowedLocationIds: data.allowedLocationIds || [],
      createdBy: administrator.id,
      createdByName: administrator.name || administrator.email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await signOut(secondaryAuth);
    return credential.user.uid;
  } finally {
    await deleteApp(secondaryApp);
  }
}

export async function setManagedUserActive(userId, active, administrator) {
  if (normalizedRole(administrator) !== "admin") {
    throw new Error("Sólo un administrador puede cambiar este estado.");
  }
  if (userId === administrator.id && active === false) {
    throw new Error("No podés desactivar tu propia sesión.");
  }
  await setDoc(
    doc(db, "users", userId),
    {
      active,
      updatedBy: administrator.id,
      updatedByName: administrator.name || administrator.email,
      updatedAt: serverTimestamp(),
      ...(active
        ? { restoredAt: serverTimestamp() }
        : { deleted: true, deletedAt: serverTimestamp() }),
    },
    { merge: true },
  );
}

export async function listAuditLogs(pageSize = 50) {
  return docsToArray(
    await getDocs(
      query(collection(db, "auditLogs"), orderBy("createdAt", "desc"), limit(pageSize)),
    ),
  );
}

export async function listLocations(profile, { includeDeleted = false } = {}) {
  if (!profile) return [];
  const isAdmin = normalizedRole(profile) === "admin";
  if (isAdmin || can(profile, "locations", "viewAllLocations")) {
    return docsToArray(
      await getDocs(query(collection(db, "locations"), orderBy("name"))),
    ).filter((item) => includeDeleted || item.deleted !== true);
  }
  const ids = [...new Set(profile.allowedLocationIds || [])].slice(0, 30);
  const snapshots = await Promise.all(ids.map((id) => getDoc(doc(db, "locations", id))));
  return snapshots
    .filter((snapshot) => snapshot.exists())
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
    .filter((item) => item.deleted !== true)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));
}

export async function listLocationStock(locationId) {
  if (!locationId) return [];
  return docsToArray(
    await getDocs(
      query(
        collection(db, "locationStock", locationId, "items"),
        orderBy("productName"),
      ),
    ),
  ).filter((item) => item.deleted !== true && item.active !== false);
}

export async function listRecentSales({ profile, locationId, pageSize = 25 }) {
  const sales = collection(db, "sales");
  if (locationId) {
    return docsToArray(
      await getDocs(
        query(
          sales,
          where("locationId", "==", locationId),
          orderBy("createdAt", "desc"),
          limit(pageSize),
        ),
      ),
    );
  }
  if (normalizedRole(profile) === "seller") {
    return docsToArray(
      await getDocs(
        query(
          sales,
          where("sellerId", "==", profile.id),
          orderBy("createdAt", "desc"),
          limit(pageSize),
        ),
      ),
    );
  }
  return docsToArray(
    await getDocs(query(sales, orderBy("createdAt", "desc"), limit(pageSize))),
  );
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function wholeQuantity(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${label} debe ser un número entero mayor o igual a cero.`);
  }
  return number;
}

function cleanSaleItems(items) {
  return items.reduce((result, item) => {
    const qty = wholeQuantity(
      item.qty,
      `La cantidad de ${item.name || item.productName || "un producto"}`,
    );
    if (!qty) return result;
    const unitPrice = wholeQuantity(
      item.unitPrice ?? item.price ?? 0,
      `El precio de ${item.name || item.productName || "un producto"}`,
    );
    result.push({
      productId: item.productId || item.id,
      name: item.name || item.productName,
      abbreviation: item.abbreviation || "",
      unitPrice,
      qty,
      subtotal: unitPrice * qty,
    });
    return result;
  }, []);
}

export async function createQuickSale({
  location,
  seller,
  items,
  discounts = [],
  paymentMethod,
  paymentMethodLabel,
  payments = [],
  channel = "manual",
  customerDni = "",
  invoiceRequested = false,
  deliveryMethod = "pickup",
}) {
  if (!location?.id) throw new Error("Elegí una ubicación.");
  if (!isLocationActiveNow(location)) {
    throw new Error("La ubicación no está activa en este momento.");
  }
  const saleItems = cleanSaleItems(items);
  if (!saleItems.length) throw new Error("La venta está vacía.");
  const requestedDiscountIds = [...new Set(discounts.map((discount) => discount.discountId || discount.id).filter(Boolean))];
  const discountSnapshots = await Promise.all(requestedDiscountIds.map((id) => getDoc(doc(db, "discounts", id))));
  const verifiedDiscounts = discountSnapshots.map((snapshot) => {
    if (!snapshot.exists()) throw new Error("Uno de los descuentos ya no existe.");
    return { id: snapshot.id, ...snapshot.data() };
  });
  if (verifiedDiscounts.some((discount) => !isDiscountAvailable(discount, location, new Date(), { profile: seller, items: saleItems }))) {
    throw new Error("Uno de los descuentos no está vigente o no aplica a esta venta.");
  }
  const subtotal = saleItems.reduce((sum, item) => sum + item.subtotal, 0);
  const discountSummary = calculateDiscountSummary(verifiedDiscounts, subtotal);
  const total = discountSummary.total;
  const payment = normalizePayment(
    paymentMethod,
    paymentMethodLabel,
    payments,
    total,
  );
  const dateKey = localDateKey();
  const prefix = String(location.codePrefix || "LOC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  const counterRef = doc(db, "counters", `${prefix}_${dateKey}`);
  const saleRef = doc(collection(db, "sales"));
  const stockRefs = saleItems.map((item) =>
    doc(db, "locationStock", location.id, "items", item.productId),
  );
  const movementRefs = saleItems.map(() => doc(collection(db, "stockMovements")));
  const auditRef = doc(collection(db, "auditLogs"));

  return runTransaction(db, async (transaction) => {
    const counterSnapshot = await transaction.get(counterRef);
    const stockSnapshots = [];
    for (const stockRef of stockRefs) {
      stockSnapshots.push(await transaction.get(stockRef));
    }
    const next = Number(counterSnapshot.data()?.lastNumber || 0) + 1;
    const saleCode = `FM-${prefix}-${dateKey}-${String(next).padStart(4, "0")}`;
    transaction.set(
      counterRef,
      { locationId: location.id, date: dateKey, lastNumber: next },
      { merge: true },
    );
    stockSnapshots.forEach((snapshot, index) => {
      const item = saleItems[index];
      if (
        !snapshot.exists() ||
        snapshot.data().active === false ||
        snapshot.data().deleted === true
      ) {
        throw new Error(`${item.name} no está habilitado en esta ubicación.`);
      }
      const previousStock = Number(snapshot.data().currentStock || 0);
      const newStock = calculateStockAfterSale(previousStock, item.qty, item.name);
      transaction.update(stockRefs[index], {
        currentStock: newStock,
        lastSaleId: saleRef.id,
        updatedAt: serverTimestamp(),
      });
      transaction.set(movementRefs[index], {
        locationId: location.id,
        productId: item.productId,
        type: "sale",
        qty: -item.qty,
        previousStock,
        newStock,
        reason: `Venta ${saleCode}`,
        userId: seller.id,
        userName: seller.name,
        saleId: saleRef.id,
        createdAt: serverTimestamp(),
      });
    });
    transaction.set(saleRef, {
      saleCode,
      locationId: location.id,
      locationName: location.name,
      locationPrefix: prefix,
      sellerId: seller.id,
      sellerName: seller.name,
      items: saleItems,
      discounts: discountSummary.discounts,
      discount: null,
      discountTotal: discountSummary.discountTotal,
      totalBeforeDiscounts: discountSummary.totalBeforeDiscounts,
      ...payment,
      subtotal,
      totalItems: saleItems.reduce((sum, item) => sum + item.qty, 0),
      total,
      status: "active",
      sourceChannel: channel,
      customerDni: customerDni.trim() || null,
      invoiceStatus: invoiceRequested ? "pending" : "not_requested",
      deliveryMethod,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      deletedAt: null,
    });
    transaction.set(auditRef, {
      action: "sale.created",
      title: "Venta registrada",
      description: `${saleCode} · ${location.name}`,
      moduleId: "quick-sales",
      entityType: "sale",
      entityId: saleRef.id,
      locationId: location.id,
      locationName: location.name,
      userId: seller.id,
      userName: seller.name || seller.email || "Vendedor",
      status: "completed",
      amount: total,
      createdAt: serverTimestamp(),
    });
    return { id: saleRef.id, saleCode, total, ...payment, createdAt: new Date() };
  });
}
