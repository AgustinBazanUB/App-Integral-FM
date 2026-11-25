import { createHash } from "node:crypto";
import { activeStockReservations, reservationPatch } from "../../../../src/shared/stockReservations.mjs";
import { shippingError } from "../../../../src/shared/shippingDomain.mjs";
import {
  isActiveWebStock,
  loadWebChannel,
  originKey,
  originStockPath,
  resolveChannelOrigins,
} from "./channelService.mjs";

export function ecommerceMovementId(requestId, productId, origin) {
  const productHash = createHash("sha256").update(productId).digest("hex").slice(0, 20);
  const originHash = createHash("sha256").update(originKey(origin)).digest("hex").slice(0, 12);
  return "ecommerce_" + requestId + "_" + productHash + "_" + originHash;
}

function assertStock(condition, message) {
  if (!condition) throw shippingError(message);
}

function freeUnits(stock) {
  return Math.max(0, stock.currentStock - Object.values(stock.holds).reduce((total, hold) => total + hold.quantity, 0));
}

// Existing stock guards protect each backing hold. Move backing for other web
// orders in the same transaction when the selected origin needs those units.
function moveBacking(selected, candidates, missing, onMove) {
  for (const [orderId, hold] of Object.entries(selected.holds)) {
    if (!hold.pooled || missing === 0) continue;
    let moved = 0;
    for (const candidate of candidates) {
      const existing = candidate.holds[orderId];
      if (!existing && Object.keys(candidate.holds).length >= 100) continue;
      const quantity = Math.min(hold.quantity - moved, missing, freeUnits(candidate));
      if (!quantity) continue;
      candidate.holds[orderId] = { ...hold, quantity: (existing?.quantity || 0) + quantity };
      candidate.changed = true;
      onMove(orderId, candidate.origin, quantity);
      moved += quantity;
      missing -= quantity;
      if (missing === 0 || moved === hold.quantity) break;
    }
    if (moved === hold.quantity) delete selected.holds[orderId];
    else selected.holds[orderId] = { ...hold, quantity: hold.quantity - moved };
  }
  return missing === 0;
}

function applyAllocationChanges(items, products) {
  return items.map(item => {
    const changes = products.get(item.productId);
    if (!changes) return item;
    products.delete(item.productId);
    const allocations = new Map((item.reservationAllocations || []).map(row => [originKey(row), row]));
    for (const { origin, delta } of changes.values()) {
      const key = originKey(origin);
      const quantity = (allocations.get(key)?.quantity || 0) + delta;
      assertStock(quantity >= 0, "La reserva de otro pedido cambió. Volvé a intentar.");
      if (quantity) allocations.set(key, { ...origin, quantity });
      else allocations.delete(key);
    }
    const reservationAllocations = [...allocations.values()];
    assertStock(reservationAllocations.reduce((total, row) => total + row.quantity, 0) === item.quantity,
      "El cambio de origen afectaría la reserva de otro pedido.");
    return { ...item, reservationAllocations };
  });
}

export async function planDeferredWebStock({ transaction, shipment, sale, origin, profile, env, now }) {
  const orderPath = "orders/" + shipment.orderId;
  const order = (await transaction.getDocument(orderPath))?.data;
  const paymentApproved = ["approved", "simulated_approved"].includes(order?.paymentStatus);
  assertStock(order?.stockCommitMode === "deferred" && order.status === "confirmed" && paymentApproved &&
    order.reservationStatus === "awaiting_origin" && order.saleId === shipment.saleId &&
    order.shipmentId === shipment.id && order.channelId === shipment.channelId,
    "El pedido no conserva una reserva pagada para imputar.");
  assertStock(sale.sourceType === "ecommerce" && sale.orderId === shipment.orderId &&
    sale.paymentStatus === order.paymentStatus, "La venta no corresponde al pedido pagado.");
  const channel = await loadWebChannel({ env, getDocument: transaction.getDocument, requireActive: false });
  assertStock(channel, "El canal web no está configurado.");
  const configured = await resolveChannelOrigins(channel, { env, ...transaction, now });
  const selectedKey = originKey(origin);
  assertStock(configured.some(source => originKey(source) === selectedKey), "El origen no está habilitado para el canal web.");

  const operations = [];
  const movementIds = [];
  const reallocations = new Map();
  function recordAllocationChange(orderId, productId, source, delta) {
    if (!reallocations.has(orderId)) reallocations.set(orderId, new Map());
    const products = reallocations.get(orderId);
    if (!products.has(productId)) products.set(productId, new Map());
    const changes = products.get(productId);
    const key = originKey(source);
    changes.set(key, { origin: source, delta: (changes.get(key)?.delta || 0) + delta });
  }

  for (const item of order.items) {
    const allocations = item.reservationAllocations || [];
    assertStock(allocations.reduce((total, row) => total + row.quantity, 0) === item.quantity,
      item.name + ": la reserva ya no coincide con el pedido.");
    const reserved = new Map(allocations.map(row => [originKey(row), row]));
    assertStock(reserved.size === allocations.length, "Los orígenes de la reserva están repetidos.");
    const sources = new Map([...allocations, ...configured].map(source => [originKey(source), source]));
    const rows = new Map(await Promise.all([...sources].map(async ([key, source]) => {
      const path = originStockPath(source, item.productId);
      const stock = (await transaction.getDocument(path))?.data;
      const holds = activeStockReservations(stock, now);
      const own = reserved.get(key);
      if (own) {
        assertStock(holds[shipment.orderId]?.quantity === own.quantity, item.name + ": falta una parte de la reserva pagada.");
        delete holds[shipment.orderId];
      }
      return [key, { origin: { type: source.type, id: source.id, name: source.name }, stock, holds, path, currentStock: stock?.currentStock || 0, changed: Boolean(own) }];
    })));
    const selected = rows.get(selectedKey);
    assertStock(isActiveWebStock(selected.stock) && Number.isSafeInteger(selected.currentStock) && selected.currentStock >= item.quantity,
      item.name + ": el origen elegido no tiene unidades físicas suficientes para el pedido.");
    const previousStock = selected.currentStock;
    selected.currentStock -= item.quantity;
    selected.changed = true;
    const reservedAtOrigin = Object.values(selected.holds).reduce((total, hold) => total + hold.quantity, 0);
    const missing = Math.max(0, reservedAtOrigin - selected.currentStock);
    if (missing) {
      const candidates = configured.filter(source => originKey(source) !== selectedKey)
        .map(source => rows.get(originKey(source))).filter(row => isActiveWebStock(row.stock) && Number.isSafeInteger(row.currentStock));
      assertStock(moveBacking(selected, candidates, missing, (orderId, target, quantity) => {
        recordAllocationChange(orderId, item.productId, selected.origin, -quantity);
        recordAllocationChange(orderId, item.productId, target, quantity);
      }), item.name + ": este origen no tiene stock suficiente para respetar los otros pedidos reservados.");
    }

    const movementId = ecommerceMovementId(order.idempotencyKey, item.productId, origin);
    movementIds.push(movementId);
    for (const row of rows.values()) {
      if (!row.changed) continue;
      const holds = reservationPatch({ ecommerceReservations: row.holds }, null, null, now);
      operations.push({
        type: "update", path: row.path,
        data: {
          ...holds, updatedAt: now,
          ...(row === selected ? { currentStock: selected.currentStock, lastSaleId: shipment.saleId, lastMovementId: movementId } : {}),
        },
      });
    }
    operations.push({
      type: "create", path: "stockMovements/" + movementId,
      data: {
        sourceType: "ecommerce", inventoryType: origin.type, inventoryId: origin.id,
        ...(origin.type === "warehouse" ? { warehouseId: origin.id, warehouseName: origin.name } : { locationId: origin.id, locationName: origin.name }),
        orderId: shipment.orderId, saleId: shipment.saleId, shipmentId: shipment.id,
        productId: item.productId, productName: item.name, type: "sale", qty: -item.quantity,
        previousStock, newStock: selected.currentStock, reason: "Origen confirmado para venta Ecommerce",
        userId: profile.id, userName: profile.name || "Gestión",
        simulated: sale.simulated === true,
        ...(sale.testData ? { testData: true, paymentEnvironment: sale.paymentEnvironment || null } : {}),
        createdAt: now,
      },
    });
  }

  for (const [orderId, products] of reallocations) {
    const path = "orders/" + orderId;
    const other = (await transaction.getDocument(path))?.data;
    assertStock(other?.stockCommitMode === "deferred" && ["active", "awaiting_origin"].includes(other.reservationStatus),
      "Otro pedido cambió de estado. Volvé a intentar la asignación.");
    const items = applyAllocationChanges(other.items, products);
    assertStock(products.size === 0, "No se pudo ubicar un producto de otro pedido reservado.");
    operations.push({ type: "update", path, data: { items, updatedAt: now } });
  }

  const originFields = { stockOriginType: origin.type, stockOriginId: origin.id, stockOriginName: origin.name, stockCommitState: "committed" };
  const saleItems = sale.items.map(item => ({
    ...item, stockAllocations: [{ type: origin.type, id: origin.id, name: origin.name, quantity: item.qty }],
  }));
  const items = order.items.map(({ reservationAllocations, ...item }) => ({
    ...item, stockAllocations: [{ type: origin.type, id: origin.id, name: origin.name, quantity: item.quantity }],
  }));
  operations.push(
    { type: "update", path: orderPath, data: { ...originFields, items, reservationStatus: "consumed", updatedAt: now } },
    { type: "update", path: "sales/" + shipment.saleId, data: { ...originFields, items: saleItems, updatedAt: now } },
  );
  return { operations, movementIds, originFields, saleItems };
}
