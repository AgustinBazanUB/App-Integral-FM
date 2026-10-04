import { buildOperationalSalePlan, cleanOperationalSaleItems, customerSaleSnapshot, customerSaleWrite, resolveOperationalCustomer } from "../../shared/operationalWritePlans.mjs";
import { effectiveLocationPrice } from "../../modules/inventory/domain/inventory";
import { SALES_CHANNELS } from "../../modules/locations/domain/channels";
import { saleStockDiscrepancies } from "../../modules/locations/domain/saleStock";
import { invalidateDashboardSales } from "./dashboardService";
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
  ARGENTINA_TIME_ZONE,
} from "../../modules/locations/domain/time";
import {
  buildCustomerDraft,
  customerDocumentId,
} from "../customers/customerDomain";
import {
  can,
  canAccessAdministration,
  effectiveSellerLocations,
} from "../permissions";
import { db } from "./firebase";
import { requestPendingArcaInvoice } from "./arcaService";
import {
  listLocationsShared,
  loadSellerResourcesShared,
} from "./sharedResources";

const docsToArray = (snapshot) =>
  snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
const saleValidationError = message => Object.assign(new Error(message), { code: "sale/validation" });
const userName = (profile) => profile.name || profile.email || "Usuario";

const wholeNumber = (value, label, minimum = 0) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) {
    throw saleValidationError(`${label} debe ser un número entero mayor o igual a ${minimum}.`);
  }
  return number;
};

const permissionDenied = (error) =>
  error?.code === "permission-denied" || error?.code === "firestore/permission-denied";

async function runStockMutationWithRuleCompatibility(profile, execute) {
  try {
    return await execute(false);
  } catch (error) {
    if (!permissionDenied(error) || canAccessAdministration(profile)) throw error;
    return execute(true);
  }
}

const stockMutationFields = ({ currentStock, lastSaleId, lastMovementId, legacy }) => ({
  currentStock,
  lastSaleId,
  ...(legacy ? {} : { lastMovementId }),
  updatedAt: serverTimestamp(),
});

function saleLocalFields(date = new Date()) {
  return {
    saleDate: argentinaDateKey(date),
    saleTime: new Intl.DateTimeFormat("es-AR", {
      timeZone: ARGENTINA_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date),
  };
}

const cleanSaleItems = cleanOperationalSaleItems;

function insufficientStockError(item, available) {
  const error = /** @type {Error & {code?: string, productId?: string, availableStock?: number}} */ (new Error(
    `${item.name}: el stock disponible es ${available}. Corregí el carrito antes de continuar.`,
  ));
  error.code = "seller/insufficient-stock";
  error.productId = item.productId;
  error.availableStock = available;
  return error;
}

function normalizeManualDiscount(discount) {
  if (!["fixed", "percent"].includes(discount.type)) {
    throw saleValidationError("El tipo de descuento manual no es válido.");
  }
  const value = wholeNumber(discount.value, "El descuento manual", 1);
  if (discount.type === "percent" && value > 100) {
    throw saleValidationError("El porcentaje manual no puede superar 100.");
  }
  return {
    discountId: "manual",
    name: String(discount.name || "Descuento manual").trim() || "Descuento manual",
    type: discount.type,
    value,
    source: "manual",
  };
}

async function prepareSaleCustomer(customer) {
  if (!customer?.phone && !customer?.phoneNormalized) return null;
  const draft = buildCustomerDraft({
    phone: customer.phone || customer.phoneNormalized,
    name: customer.name || "",
    zoneId: customer.zoneId || "",
    zoneName: customer.zoneName || customer.zone || "",
    customZone: customer.customZone || "",
  });
  return {
    ...draft,
    id: await customerDocumentId(draft.phoneNormalized),
  };
}

const customerSnapshotFields = customerSaleSnapshot;
function resolvedCustomerFromSnapshot(snapshot, prepared) {
  return resolveOperationalCustomer(snapshot?.exists() ? snapshot.data() : null, prepared);
}
function writeCustomerForSale(transaction, customerRef, customerSnapshot, customer, profile, saleId, source = "seller_sale") {
  if (!customerRef || !customer) return;
  const fields = customerSaleWrite({ existing: customerSnapshot.exists() ? customerSnapshot.data() : null, customer, profile, saleId, stamp: serverTimestamp(), source });
  if (customerSnapshot.exists()) transaction.update(customerRef, fields);
  else transaction.set(customerRef, fields);
}

export async function listSellerLocations(profile) {
  const locations = await listLocationsShared(profile);
  return effectiveSellerLocations(profile, locations);
}

/** @returns {Promise<any>} */
export async function assertSellerLocation(profile, locationId) {
  if (!can(profile, "quick-sales", "view")) {
    throw saleValidationError("No tenés permiso para abrir el Panel Vendedor.");
  }
  const snapshot = await getDoc(doc(db, "locations", locationId));
  if (!snapshot.exists()) throw saleValidationError("La ubicación ya no existe.");
  const location = { id: snapshot.id, ...snapshot.data() };
  if (!effectiveSellerLocations(profile, [location]).length) {
    throw saleValidationError("No tenés permiso para vender desde esta ubicación activa.");
  }
  return location;
}

export async function subscribeSellerLocationStock({ profile, locationId, onData, onError }) {
  await assertSellerLocation(profile, locationId);
  return onSnapshot(
    query(collection(db, "locationStock", locationId, "items"), orderBy("productName")),
    (snapshot) => onData(
      docsToArray(snapshot).filter((item) =>
        item.active !== false && item.deleted !== true && item.productDeleted !== true,
      ),
    ),
    onError,
  );
}

export const loadSellerResources = (profile) => loadSellerResourcesShared(profile);

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
  ))).filter((sale) => sale.deleted !== true);
}

async function verifiedDiscounts({ profile, location, discounts, items }) {
  const requested = Array.isArray(discounts) ? discounts.filter(Boolean) : [];
  if (!requested.length) return [];
  if (!can(profile, "quick-sales", "useDiscounts")) {
    throw saleValidationError("No tenés permiso para aplicar descuentos.");
  }

  const manual = requested.filter((discount) =>
    discount.source === "manual" || discount.discountId === "manual",
  );
  if (manual.length && !can(profile, "quick-sales", "useManualDiscounts")) {
    throw saleValidationError("No tenés permiso para aplicar descuentos manuales.");
  }
  const normalizedManual = manual.map(normalizeManualDiscount);

  const saved = requested.filter((discount) =>
    discount.source !== "manual" && discount.discountId !== "manual",
  );
  const ids = [...new Set(saved.map((discount) => discount.discountId || discount.id).filter(Boolean))];
  const snapshots = await Promise.all(ids.map((id) => getDoc(doc(db, "discounts", id))));
  const normalizedSaved = snapshots.map((snapshot) => {
    if (!snapshot.exists()) throw saleValidationError("Uno de los descuentos ya no existe.");
    const discount = /** @type {any} */ ({ id: snapshot.id, ...snapshot.data() });
    if (!isDiscountAvailable(discount, location, new Date(), { profile, items })) {
      throw saleValidationError(`${discount.name || "El descuento"} ya no está disponible para esta venta.`);
    }
    return {
      discountId: discount.id,
      name: discount.name,
      type: discount.type,
      value: discount.value,
      source: "saved",
    };
  });
  return [...normalizedSaved, ...normalizedManual];
}

function saleRefs({ location, saleItems, seller, offlineSale, stockType = "location", requestId = null }) {
  const dateKey = argentinaDateKey().replaceAll("-", "");
  const prefix = String(location.codePrefix || "LOC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  const localId = String(offlineSale?.localId || "").trim();
  if (localId && !/^local_[A-Za-z0-9_-]+$/.test(localId)) {
    throw saleValidationError("El identificador de la venta pendiente no es válido.");
  }
  return {
    dateKey,
    prefix,
    localId,
    requestId,
    counterRef: doc(db, "counters", `${prefix}_${dateKey}`),
    saleRef: localId
      ? doc(db, "sales", `offline_${seller.id}_${localId}`.replaceAll("/", "_"))
      : requestId ? doc(db, "sales", `quick_${seller.id}_${requestId}`) : doc(collection(db, "sales")),
    stockRefs: saleItems.map((item) => doc(db, stockType === "warehouse" ? "warehouseStock" : "locationStock", location.id, "items", item.productId)),
    movementRefs: saleItems.map(() => doc(collection(db, "stockMovements"))),
    auditRef: doc(collection(db, "auditLogs")),
  };
}

export const createSellerSale = (sale) => createSale({ ...sale, administrative: false, requestId: null, requestFingerprint: null });

const pendingAdministrativeSales = new Map();

export async function createAdministrativeSale(sale) {
  if (!canAccessAdministration(sale.profile) || !sale.profile?.active) {
    throw saleValidationError("Venta Rápida administrativa requiere un Administrador.");
  }
  const requestId = sale.requestId || crypto.randomUUID();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) throw saleValidationError("Identificador de venta inválido.");
  if (!SALES_CHANNELS.some(option => option.value === sale.channel)) throw saleValidationError("Elegí el canal comercial real.");
  const fingerprint = administrativeFingerprint(sale);
  const key = `${sale.profile.id}:${requestId}`;
  const pending = pendingAdministrativeSales.get(key);
  if (pending) {
    if (pending.fingerprint !== fingerprint) throw Object.assign(new Error("Este intento ya corresponde a otra venta. Recuperá la confirmación original."), { code: "sale/request-conflict" });
    return pending.promise;
  }
  const promise = resumeAdministrativeSale(sale, requestId, fingerprint);
  pendingAdministrativeSales.set(key, { fingerprint, promise });
  try {
    return await promise;
  } finally {
    pendingAdministrativeSales.delete(key);
  }
}

async function resumeAdministrativeSale(sale, requestId, fingerprint) {
  const existing = await getDoc(doc(db, "sales", `quick_${sale.profile.id}_${requestId}`));
  if (existing.exists()) {
    if (existing.data().sellerId !== sale.profile.id || existing.data().requestFingerprint !== fingerprint) throw Object.assign(new Error("Este intento ya corresponde a otra venta. Recuperá la confirmación original."), { code: "sale/request-conflict" });
    invalidateDashboardSales();
    return { id: existing.id, ...existing.data(), alreadySynced: true };
  }
  return createSale({ ...sale, administrative: true, requestId, requestFingerprint: fingerprint });
}

function administrativeFingerprint(sale) {
  return JSON.stringify({ origin: sale.stockOrigin, channel: sale.channel, items: sale.items, discounts: sale.discounts || [], paymentMethod: sale.paymentMethod, payments: sale.payments || [], customer: sale.customer || null, customerDni: sale.customerDni || "", invoiceRequested: sale.invoiceRequested === true, deliveryMethod: sale.deliveryMethod || "pickup" });
}

async function createSale({
  profile,
  location,
  items,
  discounts = [],
  paymentMethod,
  paymentMethodLabel,
  payments = [],
  ticketRequested = false,
  customer = null,
  offlineSale = null,
  administrative = false,
  stockOrigin = null,
  channel = "in_person",
  requestId = null,
  requestFingerprint = null,
  customerDni = "",
  invoiceRequested = false,
  deliveryMethod = "pickup",
}) {
  if (!can(profile, "quick-sales", "create")) {
    throw saleValidationError("No tenés permiso para registrar ventas.");
  }
  if (ticketRequested && !can(profile, "quick-sales", "requestTicket")) {
    throw saleValidationError("No tenés permiso para solicitar ticket.");
  }
  const stockType = administrative ? stockOrigin?.type : "location";
  if (!["location", "warehouse"].includes(stockType)) throw saleValidationError("Elegí el origen físico del stock.");
  const originId = administrative ? stockOrigin?.id : location?.id;
  if (!originId || String(originId).includes("/")) throw saleValidationError("Elegí el origen físico del stock.");
  /** @type {any} */
  let permittedLocation;
  if (stockType === "warehouse") {
    if (!can(profile, "warehouse", "edit")) throw saleValidationError("No tenés permiso para descontar stock del depósito.");
    const snapshot = await getDoc(doc(db, "warehouses", originId));
    if (!snapshot.exists() || snapshot.data().active === false || snapshot.data().deleted === true) throw saleValidationError("El depósito no está activo.");
    permittedLocation = { id: snapshot.id, ...snapshot.data(), codePrefix: "VR" };
  } else {
    permittedLocation = await assertSellerLocation(profile, originId);
  }
  const saleItems = cleanSaleItems(items);
  const safeDiscounts = await verifiedDiscounts({ profile, location: stockType === "warehouse" ? {} : permittedLocation, discounts, items: saleItems });
  const subtotal = saleItems.reduce((sum, item) => sum + item.subtotal, 0);
  const discountSummary = calculateDiscountSummary(safeDiscounts, subtotal);
  const payment = normalizePayment(paymentMethod, paymentMethodLabel, payments, discountSummary.total);
  if (paymentMethod === "multiple" && !can(profile, "quick-sales", "useMultiplePayments")) throw saleValidationError("No tenés permiso para combinar pagos.");
  const preparedCustomer = await prepareSaleCustomer(customer);
  const refs = saleRefs({ location: permittedLocation, saleItems, seller: profile, offlineSale, stockType, requestId });
  const fingerprint = requestFingerprint;
  const customerRef = preparedCustomer ? doc(db, "customers", preparedCustomer.id) : null;
  const createdLocallyAt = refs.localId ? new Date(offlineSale.createdLocallyAt) : null;
  if (createdLocallyAt && Number.isNaN(createdLocallyAt.valueOf())) {
    throw saleValidationError("La fecha local de la venta pendiente no es válida.");
  }

  const result = await runStockMutationWithRuleCompatibility(profile, (legacyStockMutation) => runTransaction(db, async (transaction) => {
    if (refs.localId || refs.requestId) {
      const existing = await transaction.get(refs.saleRef);
      if (existing.exists()) {
        const data = existing.data();
        if (data.sellerId !== profile.id || (refs.localId && data.offlineLocalId !== refs.localId) || (refs.requestId && data.requestFingerprint !== fingerprint)) {
          throw saleValidationError("El identificador pendiente ya está en uso.");
        }
        return {
          id: refs.saleRef.id,
          saleCode: data.saleCode,
          total: data.total,
          paymentMethod: data.paymentMethod,
          paymentMethodLabel: data.paymentMethodLabel,
          payments: data.payments || [],
          ticketRequested: data.ticketRequested === true,
          ticketStatus: data.ticketStatus || "not_requested",
          customerId: data.customerId || null,
          stockDiscrepancies: data.stockDiscrepancies || [],
          createdAt: data.createdAt,
          alreadySynced: true,
        };
      }
    }

    const locationSnapshot = await transaction.get(doc(db, stockType === "warehouse" ? "warehouses" : "locations", permittedLocation.id));
    if (!locationSnapshot.exists() || locationSnapshot.data().deleted === true || (stockType === "warehouse" ? locationSnapshot.data().active === false : !isLocationActiveNow({ id: locationSnapshot.id, ...locationSnapshot.data() }))) {
      throw saleValidationError("La ubicación dejó de estar activa.");
    }
    const customerSnapshot = customerRef ? await transaction.get(customerRef) : null;
    const counterSnapshot = await transaction.get(refs.counterRef);
    const stockSnapshots = [];
    for (const stockRef of refs.stockRefs) stockSnapshots.push(await transaction.get(stockRef));

    const priceOverrides = [];
    if (administrative) {
      for (const [index, item] of saleItems.entries()) {
        const product = await transaction.get(doc(db, "products", item.productId));
        if (!product.exists() || product.data().active === false || product.data().deleted === true) throw saleValidationError(`${item.name} ya no está activo en el catálogo global.`);
        const suggestedPrice = stockType === "warehouse" ? Number(product.data().defaultPrice || 0) : effectiveLocationPrice(product.data(), stockSnapshots[index].data() || {});
        item.categoryId = product.data().categoryId || null;
        if (item.unitPrice !== suggestedPrice) priceOverrides.push({ productId: item.productId, suggestedPrice, unitPrice: item.unitPrice });
      }
    }
    const resolvedCustomer = resolvedCustomerFromSnapshot(customerSnapshot, preparedCustomer);
    const plan = buildOperationalSalePlan({
      profile, location: permittedLocation, items: saleItems,
      stocks: stockSnapshots.map(snapshot => snapshot.exists() ? snapshot.data() : null),
      counter: counterSnapshot.data() || {}, saleId: refs.saleRef.id,
      movementIds: refs.movementRefs.map(reference => reference.id),
      dateKey: refs.dateKey, prefix: refs.prefix, stamp: serverTimestamp(),
      localFields: saleLocalFields(), discountSummary, payment, customer: resolvedCustomer,
      stockType, administrative, requestId, requestFingerprint: fingerprint,
      priceOverrides, offlineSale: refs.localId ? { localId: refs.localId, createdLocallyAt } : null,
      ticketRequested, customerDni, invoiceRequested, deliveryMethod, channel, legacyStockMutation,
    });
    transaction.set(refs.counterRef, plan.counterData, { merge: true });
    plan.stockWrites.forEach((write, index) => {
      transaction.update(refs.stockRefs[index], write.stockData);
      transaction.set(refs.movementRefs[index], write.movementData);
    });
    writeCustomerForSale(transaction, customerRef, customerSnapshot, resolvedCustomer, profile, refs.saleRef.id, administrative ? "admin_quick_sale" : "seller_sale");
    transaction.set(refs.saleRef, plan.saleData);
    transaction.set(refs.auditRef, plan.auditData);
    return { ...plan.result, createdAt: new Date() };
  }));

  invalidateDashboardSales();
  if (!ticketRequested || administrative) return result;

  try {
    const invoice = await requestPendingArcaInvoice({
      sourceType: "seller_sale",
      sourceId: result.id,
    });
    return {
      ...result,
      fiscalPreparationStatus: "prepared",
      fiscalInvoiceId: invoice?.id || null,
      fiscalReadiness: invoice?.fiscalReadiness || null,
    };
  } catch (error) {
    return {
      ...result,
      fiscalPreparationStatus: "error",
      fiscalPreparationError: String(error?.message || "No se pudo preparar la solicitud fiscal."),
    };
  }
}

export async function updateSellerSale({
  profile,
  saleId,
  items,
  discounts = [],
  paymentMethod,
  paymentMethodLabel,
  payments = [],
  ticketRequested,
  customer = undefined,
}) {
  if (!can(profile, "quick-sales", "edit")) {
    throw new Error("No tenés permiso para editar ventas.");
  }
  const saleReference = doc(db, "sales", saleId);
  const initialSale = await getDoc(saleReference);
  if (!initialSale.exists()) throw new Error("La venta ya no existe.");
  const original = initialSale.data();
  if (original.fiscalInvoiceId || original.fiscalInvoice) throw new Error("La venta tiene una solicitud fiscal asociada. Requiere revisión administrativa.");
  if (!canAccessAdministration(profile) && original.sellerId !== profile.id) {
    throw new Error("No podés editar una venta ajena.");
  }
  const location = await assertSellerLocation(profile, original.locationId);
  const newItems = cleanSaleItems(items);
  const safeDiscounts = await verifiedDiscounts({ profile, location, discounts, items: newItems });
  const subtotal = newItems.reduce((sum, item) => sum + item.subtotal, 0);
  const discountSummary = calculateDiscountSummary(safeDiscounts, subtotal);
  const payment = normalizePayment(paymentMethod, paymentMethodLabel, payments, discountSummary.total);
  const nextTicketRequested = ticketRequested == null ? original.ticketRequested === true : Boolean(ticketRequested);
  if (nextTicketRequested && !can(profile, "quick-sales", "requestTicket")) {
    throw new Error("No tenés permiso para solicitar ticket.");
  }
  const preparedCustomer = customer === undefined
    ? (original.customerId ? await prepareSaleCustomer({
        phone: original.customerPhoneSnapshot,
        name: original.customerNameSnapshot || "",
        zoneName: original.customerZoneSnapshot || "",
      }) : null)
    : await prepareSaleCustomer(customer);
  const customerRef = preparedCustomer ? doc(db, "customers", preparedCustomer.id) : null;

  return runStockMutationWithRuleCompatibility(profile, (legacyStockMutation) => runTransaction(db, async (transaction) => {
    const saleSnapshot = await transaction.get(saleReference);
    if (!saleSnapshot.exists()) throw new Error("La venta ya no existe.");
    const sale = saleSnapshot.data();
    if (sale.fiscalInvoiceId || sale.fiscalInvoice) throw new Error("La venta tiene una solicitud fiscal asociada. Requiere revisión administrativa.");
    if (sale.status !== "active") throw new Error("La venta está anulada.");
    if (!canAccessAdministration(profile) && sale.sellerId !== profile.id) {
      throw new Error("No podés editar una venta ajena.");
    }
    const customerSnapshot = customerRef ? await transaction.get(customerRef) : null;
    const resolvedCustomer = resolvedCustomerFromSnapshot(customerSnapshot, preparedCustomer);
    const oldQty = new Map((sale.items || []).map((item) => [item.productId, Number(item.qty)]));
    const newQty = new Map(newItems.map((item) => [item.productId, Number(item.qty)]));
    const productIds = [...new Set([...oldQty.keys(), ...newQty.keys()])];
    const stockRefs = productIds.map((productId) => doc(db, "locationStock", sale.locationId, "items", productId));
    const movementRefs = productIds.map(() => doc(collection(db, "stockMovements")));
    const stockSnapshots = [];
    for (const stockRef of stockRefs) stockSnapshots.push(await transaction.get(stockRef));

    const stockDiscrepancies = saleStockDiscrepancies(newItems, item => {
      const index = productIds.indexOf(item.productId);
      return Number(stockSnapshots[index].data()?.currentStock || 0) + (oldQty.get(item.productId) || 0);
    });

    productIds.forEach((productId, index) => {
      const difference = (oldQty.get(productId) || 0) - (newQty.get(productId) || 0);
      if (!difference) return;
      const snapshot = stockSnapshots[index];
      const item = newItems.find((entry) => entry.productId === productId) || sale.items.find((entry) => entry.productId === productId);
      if (!snapshot.exists()) throw new Error(`Falta el stock de ${item.name}.`);
      if (difference < 0 && (snapshot.data().active === false || snapshot.data().deleted === true || snapshot.data().productDeleted === true)) {
        throw saleValidationError(`${item.name} no está habilitado en esta ubicación.`);
      }
      const previousStock = Number(snapshot.data().currentStock || 0);
      const newStock = previousStock + difference;
      if (!Number.isInteger(previousStock)) throw saleValidationError(`El stock registrado de ${item.name} no es válido.`);
      transaction.update(stockRefs[index], stockMutationFields({
        currentStock: newStock,
        lastSaleId: saleId,
        lastMovementId: movementRefs[index].id,
        legacy: legacyStockMutation,
      }));
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
        saleItemIndex: newItems.findIndex(entry => entry.productId === productId),
        previousSaleItemIndex: sale.items.findIndex(entry => entry.productId === productId),
        createdAt: serverTimestamp(),
      });
    });

    writeCustomerForSale(transaction, customerRef, customerSnapshot, resolvedCustomer, profile, saleId);

    const ticketStatus = nextTicketRequested
      ? (sale.ticketRequested ? sale.ticketStatus || "pending" : "pending")
      : "not_requested";
    transaction.update(saleReference, {
      items: newItems,
      stockDiscrepancies,
      discounts: discountSummary.discounts,
      discount: null,
      fixedDiscountTotal: discountSummary.fixedDiscountTotal,
      percentageDiscountTotal: discountSummary.percentageDiscountTotal,
      discountTotal: discountSummary.discountTotal,
      totalBeforeDiscounts: discountSummary.totalBeforeDiscounts,
      ...payment,
      ...customerSnapshotFields(resolvedCustomer),
      subtotal,
      totalItems: newItems.reduce((sum, item) => sum + item.qty, 0),
      total: discountSummary.total,
      ticketRequested: nextTicketRequested,
      ticketStatus,
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
      ...(stockDiscrepancies.length ? { stockDiscrepancies } : {}),
      ...(resolvedCustomer ? { customerId: resolvedCustomer.id } : {}),
      createdAt: serverTimestamp(),
    });
    return {
      id: saleId,
      saleCode: sale.saleCode,
      total: discountSummary.total,
      ...payment,
      stockDiscrepancies,
      customerId: resolvedCustomer?.id || null,
      ticketRequested: nextTicketRequested,
      ticketStatus,
      createdAt: sale.createdAt,
    };
  }));
}

export async function cancelSellerSale({ profile, saleId, reason }) {
  if (!can(profile, "quick-sales", "cancelOwn") && !canAccessAdministration(profile)) {
    throw new Error("No tenés permiso para anular ventas.");
  }
  const safeReason = String(reason || "").trim() || null;
  const saleReference = doc(db, "sales", saleId);
  return runStockMutationWithRuleCompatibility(profile, (legacyStockMutation) => runTransaction(db, async (transaction) => {
    const saleSnapshot = await transaction.get(saleReference);
    if (!saleSnapshot.exists()) throw new Error("La venta ya no existe.");
    const sale = saleSnapshot.data();
    if (sale.fiscalInvoiceId || sale.fiscalInvoice) throw new Error("La venta tiene una solicitud fiscal asociada. Requiere revisión administrativa.");
    if (sale.status !== "active") throw new Error("La venta ya está anulada.");
    if (!canAccessAdministration(profile) && sale.sellerId !== profile.id) {
      throw new Error("No podés anular una venta ajena.");
    }
    const locationSnapshot = await transaction.get(doc(db, "locations", sale.locationId));
    if (!locationSnapshot.exists() || locationSnapshot.data().deleted === true) {
      throw new Error("La ubicación de la venta ya no existe.");
    }
    const stockRefs = sale.items.map((item) => doc(db, "locationStock", sale.locationId, "items", item.productId));
    const movementRefs = sale.items.map(() => doc(collection(db, "stockMovements")));
    const stockSnapshots = [];
    for (const stockRef of stockRefs) stockSnapshots.push(await transaction.get(stockRef));
    sale.items.forEach((item, index) => {
      if (!stockSnapshots[index].exists()) throw new Error(`Falta el stock de ${item.name}.`);
      const previousStock = Number(stockSnapshots[index].data().currentStock || 0);
      const newStock = previousStock + Number(item.qty || 0);
      transaction.update(stockRefs[index], stockMutationFields({
        currentStock: newStock,
        lastSaleId: saleId,
        lastMovementId: movementRefs[index].id,
        legacy: legacyStockMutation,
      }));
      transaction.set(movementRefs[index], {
        locationId: sale.locationId,
        locationName: sale.locationName,
        productId: item.productId,
        productName: item.name,
        type: "sale_cancel",
        qty: Number(item.qty || 0),
        previousStock,
        newStock,
        reason: safeReason ? `Anulación ${sale.saleCode}: ${safeReason}` : `Anulación ${sale.saleCode}`,
        userId: profile.id,
        userName: userName(profile),
        saleId,
        saleItemIndex: -1,
        previousSaleItemIndex: index,
        createdAt: serverTimestamp(),
      });
    });
    transaction.update(saleReference, {
      status: "cancelled",
      cancelledAt: serverTimestamp(),
      cancelledBy: profile.id,
      cancelledByName: userName(profile),
      ...(safeReason ? { cancelReason: safeReason } : {}),
      ...(sale.ticketRequested ? { ticketStatus: "cancelled" } : {}),
      updatedAt: serverTimestamp(),
    });
    transaction.set(doc(collection(db, "auditLogs")), {
      action: "sale.cancelled",
      title: "Venta anulada",
      description: safeReason ? `${sale.saleCode} · ${safeReason}` : sale.saleCode,
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
  }));
}
