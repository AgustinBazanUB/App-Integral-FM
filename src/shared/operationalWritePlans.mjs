import { effectiveLocationPrice, wholeInventoryQuantity } from "../modules/inventory/domain/inventory.js";
import { saleStockDiscrepancies } from "../modules/locations/domain/saleStock.js";

const userName = profile => profile.name || profile.email || "Usuario";
const validationError = message => Object.assign(new Error(message), { code: "sale/validation" });

// The browser's manual services and the assistant backend use the same write
// plan. Adapters own authorization, transaction reads and timestamp sentinels.
export function cleanOperationalSaleItems(items = []) {
  const cleaned = items.map(item => {
    const qty = wholeInventoryQuantity(item.qty, `La cantidad de ${item.name || item.productName || "un producto"}`);
    if (!qty) return null;
    const unitPrice = wholeInventoryQuantity(item.unitPrice ?? item.price ?? 0, `El precio de ${item.name || item.productName || "un producto"}`);
    if (!Number.isSafeInteger(qty * unitPrice)) throw validationError("El importe supera el límite permitido.");
    return { productId: item.productId || item.id, name: item.name || item.productName, abbreviation: item.abbreviation || "", categoryId: item.categoryId || null, unitPrice, qty, subtotal: qty * unitPrice };
  }).filter(Boolean);
  if (!cleaned.length) throw validationError("La venta está vacía.");
  const ids = cleaned.map(item => item.productId);
  if (ids.some(id => !id || String(id).includes("/")) || new Set(ids).size !== ids.length) throw validationError("Cada producto debe aparecer una sola vez con su cantidad total.");
  return cleaned;
}

export function customerSaleSnapshot(customer) {
  return {
    customerId: customer?.id || null,
    customerPhoneSnapshot: customer ? customer.phone || customer.phoneNormalized : null,
    customerNameSnapshot: customer?.name || null,
    customerZoneSnapshot: customer ? customer.zoneName || customer.customZone || null : null,
  };
}

export function resolveOperationalCustomer(existing, prepared) {
  if (!prepared) return null;
  if (!existing) return prepared;
  if (existing.deleted === true || existing.active === false) throw validationError("Este teléfono fue reemplazado en Clientes Fidelizados. Usá el número actualizado.");
  return { id: prepared.id, phone: existing.phone || prepared.phone, phoneNormalized: existing.phoneNormalized || prepared.phoneNormalized, name: existing.name || prepared.name || "", zoneId: existing.zoneId || prepared.zoneId || "", zoneName: existing.zoneName || existing.customZone || prepared.zoneName, customZone: existing.customZone || prepared.customZone || "" };
}

export function customerSaleWrite({ existing, customer, profile, saleId, stamp, source = "seller_sale" }) {
  if (!customer) return null;
  if (existing) return {
    ...(!existing.name && customer.name ? { name: customer.name } : {}),
    ...(!existing.zoneName && customer.zoneName ? { zoneId: customer.zoneId || null, zoneName: customer.zoneName, customZone: customer.customZone || null } : {}),
    lastSaleId: saleId, lastPurchaseAt: stamp, updatedAt: stamp,
  };
  return { customerKey: customer.id, phone: customer.phone, phoneNormalized: customer.phoneNormalized, name: customer.name || null, zoneId: customer.zoneId || null, zoneName: customer.zoneName, customZone: customer.customZone || null, active: true, deleted: false, source, createdBy: profile.id, createdByName: userName(profile), createdAt: stamp, updatedAt: stamp, lastSaleId: saleId, lastPurchaseAt: stamp };
}

export function buildOperationalSalePlan({ profile, location, items, stocks, counter = {}, saleId, movementIds, dateKey, prefix, stamp, localFields, discountSummary, payment, customer = null, stockType = "location", administrative = false, requestId = null, requestFingerprint = null, priceOverrides = [], offlineSale = null, ticketRequested = false, customerDni = "", invoiceRequested = false, deliveryMethod = "pickup", channel = "in_person", legacyStockMutation = false }) {
  if (stocks.length !== items.length || movementIds.length !== items.length) throw validationError("La lectura de stock está incompleta.");
  const next = Number(counter.lastNumber || 0) + 1;
  if (!Number.isSafeInteger(next) || next <= 0) throw validationError("El contador de ventas no es válido.");
  const saleCode = `FM-${prefix}-${dateKey}-${String(next).padStart(4, "0")}`;
  const stockWrites = stocks.map((stock, index) => {
    const item = items[index];
    if (!stock || stock.active === false || stock.deleted === true || stock.productDeleted === true) throw validationError(`${item.name} ya no está habilitado en esta ubicación.`);
    const previousStock = Number(stock.currentStock || 0);
    if (!Number.isSafeInteger(previousStock)) throw validationError(`El stock registrado de ${item.name} no es válido.`);
    if (stockType === "warehouse" && previousStock < item.qty) throw Object.assign(new Error(`${item.name}: el stock disponible es ${previousStock}. Corregí el carrito antes de continuar.`), { code: "seller/insufficient-stock", productId: item.productId, availableStock: previousStock });
    const currentStock = previousStock - item.qty;
    if (!Number.isSafeInteger(currentStock)) throw validationError("El saldo de stock supera el límite permitido.");
    return {
      productId: item.productId,
      stockData: { currentStock, lastSaleId: saleId, ...(legacyStockMutation ? {} : { lastMovementId: movementIds[index] }), updatedAt: stamp },
      movementData: { inventoryType: stockType, ...(stockType === "warehouse" ? { warehouseId: location.id, warehouseName: location.name } : { locationId: location.id, locationName: location.name }), productId: item.productId, productName: item.name, type: "sale", qty: -item.qty, previousStock, newStock: currentStock, reason: `Venta ${saleCode}`, userId: profile.id, userName: userName(profile), saleId, saleItemIndex: index, previousSaleItemIndex: -1, createdAt: stamp },
    };
  });
  const stockDiscrepancies = stockType === "location" ? saleStockDiscrepancies(items, item => Number(stocks[items.indexOf(item)]?.currentStock || 0)) : [];
  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(discountSummary.total)) throw validationError("El total de la venta supera el límite permitido.");
  const ticketStatus = ticketRequested ? "pending" : "not_requested";
  const origin = { locationId: stockType === "location" ? location.id : null, locationName: stockType === "location" ? location.name : null, stockOriginType: stockType, stockOriginId: location.id, stockOriginName: location.name };
  const saleData = {
    saleCode, ...origin,
    ...(stockType === "warehouse" ? { warehouseId: location.id, warehouseName: location.name } : {}),
    ...(administrative ? { sourceType: "admin_quick_sale", requestId, requestFingerprint, priceOverrides, customerDni: String(customerDni).trim() || null, invoiceStatus: invoiceRequested ? "pending" : "not_requested", deliveryMethod } : {}),
    locationPrefix: prefix, sellerId: profile.id, sellerName: userName(profile), createdBy: profile.id, createdByName: userName(profile), items,
    ...(stockDiscrepancies.length ? { stockDiscrepancies } : {}),
    discounts: discountSummary.discounts, discount: null, fixedDiscountTotal: discountSummary.fixedDiscountTotal, percentageDiscountTotal: discountSummary.percentageDiscountTotal, discountTotal: discountSummary.discountTotal, totalBeforeDiscounts: discountSummary.totalBeforeDiscounts,
    ...payment, ...customerSaleSnapshot(customer), subtotal, totalItems: items.reduce((sum, item) => sum + item.qty, 0), total: discountSummary.total,
    status: "active", sourceChannel: administrative ? channel : "in_person", ticketRequested: Boolean(ticketRequested), ticketStatus, ...localFields,
    ...(offlineSale ? { offlineLocalId: offlineSale.localId, createdOffline: true, createdLocallyAt: new Date(offlineSale.createdLocallyAt).toISOString(), syncedAt: stamp } : {}),
    createdAt: stamp, updatedAt: stamp, deletedAt: null,
  };
  const auditData = { action: "sale.created", title: offlineSale ? "Venta pendiente sincronizada" : "Venta registrada", description: `${saleCode} · ${location.name}`, moduleId: "quick-sales", entityType: "sale", entityId: saleId, locationId: origin.locationId, locationName: origin.locationName, stockOriginType: stockType, stockOriginId: location.id, sourceChannel: saleData.sourceChannel, userId: profile.id, userName: userName(profile), status: "completed", amount: discountSummary.total, ...(priceOverrides.length ? { priceOverrides } : {}), ...(stockDiscrepancies.length ? { stockDiscrepancies } : {}), ticketRequested: Boolean(ticketRequested), ...(customer ? { customerId: customer.id } : {}), createdAt: stamp };
  return { saleData, auditData, stockWrites, counterData: { locationId: origin.locationId, stockOriginType: stockType, stockOriginId: location.id, date: dateKey, lastNumber: next }, result: { id: saleId, saleCode, total: discountSummary.total, ...payment, stockDiscrepancies, customerId: customer?.id || null, ticketRequested: Boolean(ticketRequested), ticketStatus } };
}

export function locationStockQuantity({ existing = {}, mode, requested }) {
  const safeRequested = wholeInventoryQuantity(requested);
  const previousStock = Number(existing.currentStock || 0);
  const previousInitial = Number(existing.initialStock || 0);
  if (!Number.isSafeInteger(previousStock) || !Number.isSafeInteger(previousInitial)) throw new Error("El stock registrado no es válido.");
  const currentStock = mode === "add" ? previousStock + safeRequested : mode === "adjust" ? safeRequested : previousStock + safeRequested - previousInitial;
  if (!Number.isSafeInteger(currentStock) || currentStock < 0) throw new Error("El ajuste dejaría stock negativo o un saldo inválido.");
  return { requested: safeRequested, previousStock, previousInitial, currentStock };
}

export function buildLocationStockLinePlan({ product, existing = {}, mode, requested, entry = {}, operationId, location, profile, stamp }) {
  if (!["initial", "add", "adjust"].includes(mode)) throw new Error("Elegí un modo de carga válido.");
  const quantities = locationStockQuantity({ existing, mode, requested });
  const yellowAlertQty = wholeInventoryQuantity(entry.yellowAlertQty ?? existing.yellowAlertQty ?? 0, `La alerta amarilla de ${product.name}`);
  const redAlertQty = wholeInventoryQuantity(entry.redAlertQty ?? existing.redAlertQty ?? 0, `La alerta roja de ${product.name}`);
  if (yellowAlertQty < redAlertQty) throw new Error(`La alerta amarilla de ${product.name} debe ser mayor o igual a la roja.`);
  const movementId = `${operationId}_${product.id}`;
  const stockData = { productId: product.id, productName: product.name, abbreviation: product.abbreviation || "", categoryId: product.categoryId || "", categoryName: product.categoryName || "", imageUrl: product.imageUrl || "", thumbUrl: product.thumbUrl || "", price: effectiveLocationPrice(product, existing), ...(!Object.keys(existing).length ? { priceMode: "default", priceOverride: null } : {}), initialStock: mode === "initial" ? quantities.requested : quantities.previousInitial, currentStock: quantities.currentStock, yellowAlertQty, redAlertQty, active: entry.active !== false, deleted: false, deletedAt: null, productDeleted: false, lastMovementId: movementId, updatedAt: stamp, updatedBy: profile.id };
  const movementData = { operationId, inventoryType: "location", inventoryId: location.id, locationId: location.id, locationName: location.name, productId: product.id, productName: product.name, type: mode === "initial" ? (Object.keys(existing).length ? "initial_adjustment" : "initial") : mode === "add" ? "add" : "adjustment", qty: quantities.currentStock - quantities.previousStock, requestedQty: quantities.requested, previousStock: quantities.previousStock, newStock: quantities.currentStock, reason: String(entry.reason || (mode === "add" ? "Ingreso de mercadería" : mode === "adjust" ? "Ajuste de inventario" : "Configuración de stock inicial")).trim(), userId: profile.id, userName: userName(profile), saleId: "", createdAt: stamp };
  return { stockData, movementData, movementId, ...quantities };
}
