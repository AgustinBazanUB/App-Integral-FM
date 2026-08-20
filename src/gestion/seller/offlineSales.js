import { calculateDiscountSummary } from "../../modules/locations/domain/discounts";
import { normalizePayment } from "../../modules/locations/domain/payments";
import { buildCustomerDraft } from "../customers/customerDomain";

const DB_NAME = "flor_mia_integral_offline";
const DB_VERSION = 1;
const STORE_NAME = "seller_pending_sales";
let databasePromise = null;

export function openSellerOfflineDb() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("Este navegador no permite guardar ventas sin conexión."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? request.transaction.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: "localId" });
      if (!store.indexNames.contains("sellerId")) {
        store.createIndex("sellerId", "sellerId", { unique: false });
      }
      if (!store.indexNames.contains("status")) {
        store.createIndex("status", "status", { unique: false });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(
      request.error || new Error("No se pudo abrir el almacenamiento local."),
    );
    request.onblocked = () => reject(
      new Error("Cerrá otras pestañas de Flor Mía para actualizar el almacenamiento local."),
    );
  }).catch((error) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

async function requestStore(mode, createRequest) {
  const database = await openSellerOfflineDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let request;
    try {
      request = createRequest(store);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(
      transaction.error || request?.error || new Error("Falló el almacenamiento local."),
    );
    transaction.onabort = () => reject(
      transaction.error || new Error("Se canceló el almacenamiento local."),
    );
  });
}

const requiredText = (value, label) => {
  const text = String(value || "").trim();
  if (!text) throw new Error(`Falta ${label} en la venta pendiente.`);
  return text;
};

const wholeNumber = (value, label, minimum = 0) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) {
    throw new Error(`${label} debe ser un número entero válido.`);
  }
  return number;
};

function normalizePendingSale(sale) {
  const items = (sale.items || []).map((item) => {
    const unitPrice = wholeNumber(
      item.unitPrice ?? item.price,
      `El precio de ${item.name || "un producto"}`,
    );
    const qty = wholeNumber(item.qty, `La cantidad de ${item.name || "un producto"}`, 1);
    return {
      productId: requiredText(item.productId || item.id, "el producto"),
      name: requiredText(item.name || item.productName, "el nombre del producto"),
      abbreviation: String(item.abbreviation || "").trim(),
      unitPrice,
      qty,
      subtotal: unitPrice * qty,
    };
  });
  if (!items.length) throw new Error("La venta pendiente está vacía.");
  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  const discounts = Array.isArray(sale.discounts) ? sale.discounts : [];
  const discountSummary = calculateDiscountSummary(discounts, subtotal);
  const total = wholeNumber(sale.total, "El total");
  if (total !== discountSummary.total) {
    throw new Error("El total pendiente no coincide con los descuentos aplicados.");
  }
  const payment = normalizePayment(
    requiredText(sale.paymentMethod, "la forma de pago"),
    sale.paymentMethodLabel,
    sale.payments,
    total,
  );
  const createdLocallyAt = new Date(sale.createdLocallyAt || Date.now());
  if (Number.isNaN(createdLocallyAt.valueOf())) {
    throw new Error("La fecha local de la venta no es válida.");
  }
  const ticketRequested = sale.ticketRequested === true;
  const customer = sale.customer ? buildCustomerDraft(sale.customer) : null;
  return {
    localId: requiredText(sale.localId, "el identificador local"),
    localCode: requiredText(sale.localCode || sale.localId, "el código local"),
    status: ["pending", "sync_error", "synced"].includes(sale.status)
      ? sale.status
      : "pending",
    createdLocallyAt: createdLocallyAt.toISOString(),
    lastSyncAttemptAt: sale.lastSyncAttemptAt || null,
    syncError: String(sale.syncError || ""),
    retryCount: wholeNumber(sale.retryCount || 0, "Los reintentos"),
    remoteSaleId: String(sale.remoteSaleId || ""),
    locationId: requiredText(sale.locationId, "la ubicación"),
    locationName: requiredText(sale.locationName, "el nombre de la ubicación"),
    locationPrefix: requiredText(sale.locationPrefix || "LOC", "el código de ubicación"),
    sellerId: requiredText(sale.sellerId, "el vendedor"),
    sellerName: requiredText(sale.sellerName, "el nombre del vendedor"),
    items,
    discounts: discountSummary.discounts,
    subtotal,
    fixedDiscountTotal: discountSummary.fixedDiscountTotal,
    percentageDiscountTotal: discountSummary.percentageDiscountTotal,
    discountTotal: discountSummary.discountTotal,
    totalItems: items.reduce((sum, item) => sum + item.qty, 0),
    total,
    ...payment,
    customer,
    ticketRequested,
    ticketStatus: ticketRequested ? "pending" : "not_requested",
    clientStatus: "offline_pending",
  };
}

export async function saveSellerPendingSale(sale) {
  const normalized = normalizePendingSale(sale);
  await requestStore("readwrite", (store) => store.put(normalized));
  return normalized;
}

export async function listSellerPendingSales(sellerId) {
  const sales = await requestStore("readonly", (store) => store.getAll());
  return (sales || [])
    .filter((sale) => sale.sellerId === sellerId && sale.status !== "synced")
    .sort((a, b) => String(a.createdLocallyAt).localeCompare(String(b.createdLocallyAt)));
}

function updatePendingSale(localId, updater) {
  return requestStore("readwrite", (store) => {
    const request = store.get(localId);
    request.onsuccess = () => {
      if (!request.result) return;
      store.put({ ...request.result, ...updater(request.result) });
    };
    return request;
  });
}

export const markSellerPendingSynced = (localId, remoteSaleId) =>
  updatePendingSale(localId, () => ({
    status: "synced",
    remoteSaleId: String(remoteSaleId || ""),
    syncError: "",
    lastSyncAttemptAt: new Date().toISOString(),
  }));

export const markSellerPendingError = (localId, errorMessage) =>
  updatePendingSale(localId, (sale) => ({
    status: "sync_error",
    syncError: String(errorMessage || "No se pudo sincronizar."),
    retryCount: Number(sale.retryCount || 0) + 1,
    lastSyncAttemptAt: new Date().toISOString(),
  }));

export const deleteSellerPendingSale = (localId) =>
  requestStore("readwrite", (store) => store.delete(localId));
