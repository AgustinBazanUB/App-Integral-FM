import { createHash } from "node:crypto";
import { adminRunTransaction } from "../firestoreAdminRest.mjs";
import {
  authoritativeUnitPrice,
  commerceError,
  currentStockQuantity,
  normalizeEcommerceRequestId,
} from "./commerceDomain.mjs";
import {
  ALL_ACTIVE_STOCK,
  SELECTED_STOCK,
  WEB_CHANNEL_ID,
  checkedOrigin,
  isActiveStockOrigin,
  loadWebChannel,
  orderReservationAllocations,
  originKey,
  originStockPath,
  resolveChannelOrigin,
  resolveChannelOrigins,
  webPricingStock,
} from "./channelService.mjs";
import {
  reservationPatch,
  reservedStockQuantity,
} from "../../../../src/shared/stockReservations.mjs";
import { canAccessAdministration } from "../../../../src/gestion/permissions.js";
import { normalizeDeliveryConfig } from "./deliveryRates.mjs";

const fail = (message, status = 409) => {
  throw commerceError("ecommerce-management-blocked", message, status);
};
const id = (value) => {
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(value || ""))
    fail("Identificador inválido.", 400);
  return value;
};
export async function configureWebChannel({
  body,
  session,
  env = process.env,
  runTransaction = adminRunTransaction,
  now = new Date(),
}) {
  const requestId = normalizeEcommerceRequestId(body.requestId);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ channel: body.channel, actor: session.uid }))
    .digest("hex");
  return runTransaction(
    async (transaction) => {
      const profile = (await transaction.getDocument(`users/${session.uid}`))
        ?.data;
      if (!profile?.active || !canAccessAdministration(profile))
        fail("Sólo administración puede configurar el canal.", 403);
      const receiptPath = `ecommerceOperations/channel_${requestId}`,
        receipt = (await transaction.getDocument(receiptPath))?.data;
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          fail("El intento corresponde a otra configuración.");
        return receipt.result;
      }
      const previous = await transaction.getDocument(
        `channels/${WEB_CHANNEL_ID}`,
      );
      const channel = body.channel || {};
      const stockScope = channel.stockScope ?? SELECTED_STOCK;
      if (![ALL_ACTIVE_STOCK, SELECTED_STOCK].includes(stockScope))
        fail("Elegí cómo abastecer el stock del canal web.", 400);
      const authorizedOrigins = [...new Map((channel.authorizedOrigins || [])
        .map(checkedOrigin).map((row) => [originKey(row), row])).values()];
      const excludedOrigins = [...new Map((channel.excludedOrigins || [])
        .map(checkedOrigin).map((row) => [originKey(row), row])).values()];
      if (stockScope === SELECTED_STOCK && (!authorizedOrigins.length || authorizedOrigins.length > 20))
        fail("Habilitá entre uno y veinte orígenes.", 400);
      const candidate = { ...channel, stockScope, authorizedOrigins, excludedOrigins };
      const origin = await resolveChannelOrigin(
        candidate,
        checkedOrigin(channel.defaultOrigin),
        { env, getDocument: transaction.getDocument, now },
      );
      if (stockScope === SELECTED_STOCK)
        await Promise.all(authorizedOrigins.map((entry) => resolveChannelOrigin(candidate, entry, {
          env, getDocument: transaction.getDocument, now,
        })));
      const pickup = {
        enabled: channel.pickup?.enabled === true,
        locationId: String(channel.pickup?.locationId || ""),
        name: String(channel.pickup?.name || "")
          .trim()
          .slice(0, 150),
        address: String(channel.pickup?.address || "")
          .trim()
          .slice(0, 300),
      };
      if (pickup.enabled) {
        const point = (
          await transaction.getDocument(`locations/${id(pickup.locationId)}`)
        )?.data;
        if (
          !isActiveStockOrigin("location", point, now) ||
          (point.type || "store") !== "store" ||
          !pickup.address
        )
          fail("Elegí un punto de retiro real y su dirección.", 400);
        pickup.name = point.name;
      }
      const delivery = normalizeDeliveryConfig(channel.delivery || {});
      const defaultTransport = channel.defaultTransport || "repository";
      if (!["repository", "uber", "manual"].includes(defaultTransport))
        fail("Elegí un transporte predeterminado válido.", 400);
      const authorizedUserIds = [
        ...new Set((channel.authorizedUserIds || []).map(id)),
      ];
      if (authorizedUserIds.length > 100)
        fail("El canal admite hasta cien usuarios autorizados.", 400);
      for (const uid of authorizedUserIds) {
        const user = (await transaction.getDocument(`users/${uid}`))?.data;
        if (!user?.active || !canAccessAdministration(user))
          fail(
            "Un usuario autorizado no está activo o no tiene acceso administrativo.",
            400,
          );
      }
      const data = {
        schemaVersion: 1,
        name: "Página web / E-commerce Flor Mía",
        type: "ecommerce",
        active: channel.active === true,
        stockScope,
        authorizedOrigins,
        excludedOrigins,
        defaultTransport,
        defaultOrigin: { type: origin.type, id: origin.id },
        authorizedUserIds,
        pickup,
        delivery,
        updatedAt: now,
        updatedBy: session.uid,
        ...(!previous ? { createdAt: now } : {}),
      };
      const result = { id: WEB_CHANNEL_ID, ...data };
      await transaction.commitDocuments([
        {
          type: "create",
          path: receiptPath,
          data: { fingerprint, result, createdAt: now },
        },
        {
          type: previous ? "update" : "create",
          path: `channels/${WEB_CHANNEL_ID}`,
          data,
        },
        {
          type: "create",
          path: `auditLogs/web_channel_${requestId}`,
          data: {
            moduleId: "ecommerce",
            action: "channel.configured",
            entityId: WEB_CHANNEL_ID,
            userId: session.uid,
            description: "Configuración del canal; sin inventario propio",
            createdAt: now,
          },
        },
      ]);
      return result;
    },
    { env },
  );
}

export async function configureWebProduct({
  body,
  session,
  env = process.env,
  runTransaction = adminRunTransaction,
  now = new Date(),
}) {
  const requestId = normalizeEcommerceRequestId(body.requestId);
  const productId = id(body.productId);
  const settings = body.settings || {};
  const enabled = settings.enabled !== false;
  const priceOverride = settings.priceOverride == null || settings.priceOverride === ""
    ? null
    : Number(settings.priceOverride);
  const minimumRemainingStock = Number(settings.minimumRemainingStock ?? 0);
  const sourceAlertThresholds = settings.sourceAlertThresholds || {};
  const parcel = settings.parcel == null ? null : {
    grams: Number(settings.parcel.grams),
    volumeCm3: Number(settings.parcel.volumeCm3),
  };
  if (parcel && Object.values(parcel).some((value) => !Number.isSafeInteger(value) || value <= 0))
    fail("Completá el peso en gramos y el volumen en cm³ de la unidad embalada.", 400);
  const parcelSettings = Object.hasOwn(settings, "parcel") ? { parcel } : {};
  if (priceOverride !== null && (!Number.isSafeInteger(priceOverride) || priceOverride <= 0))
    fail("El precio web tiene que ser un importe entero mayor que cero.", 400);
  if (!Number.isSafeInteger(minimumRemainingStock) || minimumRemainingStock < 0 || minimumRemainingStock > 1000000)
    fail("El stock reservado debe ser un entero entre 0 y 1.000.000.", 400);
  if (!sourceAlertThresholds || typeof sourceAlertThresholds !== "object" || Array.isArray(sourceAlertThresholds) || Object.keys(sourceAlertThresholds).length > 100)
    fail("Configurá hasta cien umbrales de alerta de stock.", 400);

  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ productId, settings: { enabled, priceOverride, minimumRemainingStock, sourceAlertThresholds, ...parcelSettings }, actor: session.uid }))
    .digest("hex");
  return runTransaction(async (transaction) => {
    const profile = (await transaction.getDocument(`users/${session.uid}`))?.data;
    if (!profile?.active || !canAccessAdministration(profile))
      fail("Sólo administración puede configurar los productos web.", 403);
    const receiptPath = `ecommerceOperations/product_${requestId}`;
    const receipt = (await transaction.getDocument(receiptPath))?.data;
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) fail("El intento corresponde a otra configuración.");
      return receipt.result;
    }
    const [productSnapshot, promotionSnapshot, channelSnapshot] = await Promise.all([
      transaction.getDocument(`products/${productId}`),
      transaction.getDocument(`ecommercePromotions/${productId}`),
      transaction.getDocument(`channels/${WEB_CHANNEL_ID}`),
    ]);
    const product = productSnapshot?.data;
    if (!product || product.deleted === true) fail("El producto no existe en el catálogo.", 404);
    const channel = channelSnapshot?.data;
    const origins = channel && channel.stockScope !== ALL_ACTIVE_STOCK
      ? await resolveChannelOrigins(channel, { env, ...transaction, now })
      : [];
    const stockSnapshots = await Promise.all(origins.map((row) => transaction.getDocument(originStockPath(row, productId))));
    const preferredStock = webPricingStock(channel, stockSnapshots.map((row) => row?.data));
    let effectiveWebPrice = priceOverride ?? Number(product.defaultPrice);
    try {
      effectiveWebPrice = authoritativeUnitPrice({ ...product, id: productId }, { ...preferredStock, id: productId }, { webPriceOverride: priceOverride });
    } catch {}
    if (promotionSnapshot?.data?.active === true && (!Number.isSafeInteger(effectiveWebPrice) || effectiveWebPrice <= promotionSnapshot.data.price))
      fail("El precio web debe quedar por encima de la promoción activa. Actualizá o deshabilitá esa promoción antes de guardar.", 409);
    const cleanThresholds = {};
    for (const [sourceKey, rawThreshold] of Object.entries(sourceAlertThresholds)) {
      const [type, sourceId, ...extra] = String(sourceKey).split(":");
      const threshold = Number(rawThreshold);
      if (extra.length || !["location", "warehouse"].includes(type) || !/^[A-Za-z0-9_-]{1,150}$/.test(sourceId || "") || !Number.isSafeInteger(threshold) || threshold < 0 || threshold > 1000000)
        fail("Cada alerta debe corresponder a un local o depósito y usar un entero entre 0 y 1.000.000.", 400);
      const source = (await transaction.getDocument(`${type === "warehouse" ? "warehouses" : "locations"}/${sourceId}`))?.data;
      if (!source || source.deleted === true) continue;
      cleanThresholds[`${type}:${sourceId}`] = threshold;
    }
    const path = `ecommerceProductSettings/${productId}`;
    const previous = await transaction.getDocument(path);
    const data = {
      schemaVersion: 1,
      productId,
      enabled,
      priceOverride,
      minimumRemainingStock,
      sourceAlertThresholds: cleanThresholds,
      ...parcelSettings,
      updatedAt: now,
      updatedBy: session.uid,
      ...(!previous ? { createdAt: now, createdBy: session.uid } : {}),
    };
    const result = { id: productId, ...data };
    await transaction.commitDocuments([
      { type: previous ? "update" : "create", path, data },
      { type: "create", path: receiptPath, data: { fingerprint, result, createdAt: now } },
      { type: "create", path: `auditLogs/ecommerce_product_${requestId}`, data: { moduleId: "ecommerce", action: "product.configured", entityId: productId, entityType: "product", userId: session.uid, description: `Configuración web actualizada: ${enabled ? "habilitado" : "deshabilitado"}; precio ${priceOverride ?? "habitual"}; reserva ${minimumRemainingStock} unidades`, createdAt: now } },
    ]);
    return result;
  }, { env });
}

export async function configureWebPromotion({
  body,
  session,
  env = process.env,
  runTransaction = adminRunTransaction,
  now = new Date(),
}) {
  const requestId = normalizeEcommerceRequestId(body.requestId);
  const productId = id(body.productId);
  const name = String(body.promotion?.name || "").trim().slice(0, 150);
  const price = Number(body.promotion?.price);
  const active = body.promotion?.active === true;
  const shippingPromotion = Object.hasOwn(body.promotion || {}, "freeShippingAmba")
    ? { freeShippingAmba: body.promotion.freeShippingAmba === true }
    : {};
  if (!name || !Number.isSafeInteger(price) || price <= 0)
    fail("La promoción necesita un nombre y un precio entero mayor que cero.", 400);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ productId, promotion: { name, price, active, ...shippingPromotion }, actor: session.uid }))
    .digest("hex");
  return runTransaction(async (transaction) => {
    const profile = (await transaction.getDocument(`users/${session.uid}`))?.data;
    if (!profile?.active || !canAccessAdministration(profile))
      fail("Sólo administración puede configurar promociones web.", 403);
    const receiptPath = `ecommerceOperations/promotion_${requestId}`;
    const receipt = (await transaction.getDocument(receiptPath))?.data;
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) fail("El intento corresponde a otra promoción.");
      return receipt.result;
    }
    const [product, productSettings, channel] = await Promise.all([
      transaction.getDocument(`products/${productId}`),
      transaction.getDocument(`ecommerceProductSettings/${productId}`),
      transaction.getDocument(`channels/${WEB_CHANNEL_ID}`),
    ]);
    if (!product?.data || product.data.deleted === true) fail("El producto no existe en el catálogo.", 404);
    const origins = channel?.data
      ? await resolveChannelOrigins(channel.data, { env, ...transaction, now })
      : [];
    const stockSnapshots = channel?.data?.stockScope === ALL_ACTIVE_STOCK
      ? []
      : await Promise.all(origins.map((row) => transaction.getDocument(originStockPath(row, productId))));
    const pricingStock = webPricingStock(channel?.data, stockSnapshots.map((row) => row?.data));
    let basePrice = Number(productSettings?.data?.priceOverride ?? product.data.defaultPrice);
    try {
      basePrice = authoritativeUnitPrice({ ...product.data, id: productId }, { ...pricingStock, id: productId }, { webPriceOverride: productSettings?.data?.priceOverride });
    } catch {}
    if (active && (!Number.isSafeInteger(basePrice) || basePrice <= 0 || price >= basePrice))
      fail("El precio promocional debe ser menor que un precio web habitual válido.", 400);
    if (!origins.length)
      fail("Configurá primero los orígenes de stock del canal web.", 409);
    const path = `ecommercePromotions/${productId}`;
    const previous = await transaction.getDocument(path);
    const data = {
      schemaVersion: 1,
      productId,
      name,
      price,
      active,
      ...shippingPromotion,
      updatedAt: now,
      updatedBy: session.uid,
      ...(!previous ? { createdAt: now, createdBy: session.uid } : {}),
    };
    const result = { id: productId, ...data };
    await transaction.commitDocuments([
      { type: previous ? "update" : "create", path, data },
      { type: "create", path: receiptPath, data: { fingerprint, result, createdAt: now } },
      { type: "create", path: `auditLogs/ecommerce_promotion_${requestId}`, data: { moduleId: "ecommerce", action: "promotion.configured", entityId: productId, entityType: "promotion", userId: session.uid, description: `${name}: ${active ? "habilitada" : "deshabilitada"} a $${price}`, createdAt: now } },
    ]);
    return result;
  }, { env });
}

export async function manageWebOrder({
  body,
  session,
  env = process.env,
  runTransaction = adminRunTransaction,
  now = new Date(),
}) {
  const requestId = normalizeEcommerceRequestId(body.requestId),
    orderId = id(body.orderId);
  return runTransaction(
    async (transaction) => {
      const profile = (await transaction.getDocument(`users/${session.uid}`))
        ?.data;
      if (!profile?.active || !canAccessAdministration(profile))
        fail("Sólo administración puede modificar pedidos web.", 403);
      const receiptPath = `ecommerceOperations/${requestId}`;
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            mode: body.mode,
            orderId,
            origin: body.origin || null,
            reason: body.reason,
            actor: session.uid,
          }),
        )
        .digest("hex");
      const receipt = (await transaction.getDocument(receiptPath))?.data;
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          fail("El intento corresponde a otra operación.");
        return receipt.result;
      }
      const snapshot = await transaction.getDocument(`orders/${orderId}`),
        order = snapshot?.data;
      if (!order?.channelId)
        fail("El pedido no pertenece al canal configurado.");
      const reason = String(body.reason || "")
        .trim()
        .slice(0, 1000);
      if (reason.length < 4)
        fail("Indicá un motivo de al menos cuatro caracteres.", 400);
      const oldOrigin = {
        type: order.stockOriginType,
        id: order.stockOriginId,
        name: order.stockOriginName,
      };
      const paid = ["approved", "simulated_approved"].includes(
        order.paymentStatus,
      );
      const operations = [],
        changes = { updatedAt: now };
      const paywayAttempt = (await transaction.getDocument(`payments/${order.paymentId}`))?.data?.gateway;
      if (paywayAttempt && !paid && !["rejected", "cancelled"].includes(paywayAttempt.receipt?.status))
        fail("El pago Payway debe conciliarse antes de modificar el pedido.");
      if (body.mode === "origin") {
        if (order.stockCommitMode === "deferred")
          fail("El origen físico de este pedido se confirma en Gestión de envíos.");
        const allocatedOrigins = new Map();
        for (const item of order.items || [])
          for (const allocation of item.stockAllocations || [])
            allocatedOrigins.set(`${allocation.type}:${allocation.id}`, allocation);
        if (allocatedOrigins.size > 1 || [...allocatedOrigins.values()].some((entry) => entry.type !== oldOrigin.type || entry.id !== oldOrigin.id))
          fail("Este pedido distribuyó productos entre varios orígenes. Para conservar el stock y la trazabilidad, no se puede cambiar a un único origen.");
        const channel = await loadWebChannel({
          env,
          getDocument: transaction.getDocument,
        });
        const origin = await resolveChannelOrigin(channel, body.origin, {
          env,
          getDocument: transaction.getDocument,
          now,
        });
        if (origin.id === oldOrigin.id && origin.type === oldOrigin.type)
          fail("El origen elegido ya está asignado.");
        if (order.status !== (paid ? "confirmed" : "pending_payment"))
          fail("El pedido ya no admite cambios de origen.");
        if (
          !paid &&
          (order.reservationStatus !== "active" ||
            new Date(order.reservationExpiresAt) <= now)
        )
          fail("La reserva venció; creá un nuevo pedido.");
        let shipment;
        if (paid) {
          shipment = (
            await transaction.getDocument(`shipments/${order.shipmentId}`)
          )?.data;
          if (
            !shipment ||
            shipment.status !== "aprobado" ||
            shipment.incident ||
            shipment.courierSessionId
          )
            fail(
              "Sólo se reasigna stock pagado antes de empezar la preparación.",
            );
        }
        for (const item of order.items) {
          const oldPath = originStockPath(oldOrigin, item.productId),
            newPath = originStockPath(origin, item.productId);
          const [oldStock, newStock] = await Promise.all([
            transaction.getDocument(oldPath),
            transaction.getDocument(newPath),
          ]);
          if (
            !oldStock?.data ||
            !newStock?.data ||
            newStock.data.active === false ||
            newStock.data.deleted === true ||
            newStock.data.productDeleted === true
          )
            fail(`${item.name}: el origen no tiene stock habilitado.`);
          const oldQty = currentStockQuantity(oldStock.data),
            newQty = currentStockQuantity(newStock.data);
          if (
            newQty - reservedStockQuantity(newStock.data, now) <
            item.quantity
          )
            fail(`${item.name}: stock insuficiente en ${origin.name}.`);
          if (!paid) {
            const hold = oldStock.data.ecommerceReservations?.[orderId];
            if (
              !hold ||
              hold.quantity !== item.quantity ||
              new Date(hold.expiresAt) <= now
            )
              fail("La reserva original no es consistente.");
            operations.push(
              {
                type: "update",
                path: oldPath,
                data: reservationPatch(oldStock.data, orderId, null, now),
              },
              {
                type: "update",
                path: newPath,
                data: reservationPatch(newStock.data, orderId, hold, now),
              },
            );
          } else {
            for (const [suffix, path, stock, originRef, delta] of [
              ["return", oldPath, oldQty, oldOrigin, item.quantity],
              ["out", newPath, newQty, origin, -item.quantity],
            ]) {
              const movementId = `web_origin_${requestId}_${createHash("sha256").update(item.productId).digest("hex").slice(0, 16)}_${suffix}`;
              operations.push(
                {
                  type: "update",
                  path,
                  data: {
                    currentStock: stock + delta,
                    lastMovementId: movementId,
                    updatedAt: now,
                  },
                },
                {
                  type: "create",
                  path: `stockMovements/${movementId}`,
                  data: {
                    sourceType: "ecommerce",
                    inventoryType: originRef.type,
                    inventoryId: originRef.id,
                    ...(originRef.type === "warehouse"
                      ? { warehouseId: originRef.id }
                      : { locationId: originRef.id }),
                    orderId,
                    saleId: order.saleId,
                    productId: item.productId,
                    type: "origin_reassignment",
                    qty: delta,
                    previousStock: stock,
                    newStock: stock + delta,
                    reason,
                    userId: session.uid,
                    simulated: order.simulated === true,
                    createdAt: now,
                  },
                },
              );
            }
          }
        }
        Object.assign(changes, {
          items: order.items.map(item => ({ ...item, stockAllocations: [{ ...origin, quantity: item.quantity }] })),
          stockOriginType: origin.type,
          stockOriginId: origin.id,
          stockOriginName: origin.name,
          originHistory: [
            ...(order.originHistory || []),
            {
              from: oldOrigin,
              to: origin,
              reason,
              userId: session.uid,
              at: now,
              afterPayment: paid,
            },
          ],
        });
        if (!paid)
          Object.assign(changes, {
            locationId: origin.type === "location" ? origin.id : null,
            locationName: origin.name,
          });
        if (paid)
          operations.push({
            type: "update",
            path: `shipments/${order.shipmentId}`,
            data: {
              stockOriginType: origin.type,
              stockOriginId: origin.id,
              stockOriginName: origin.name,
              revision: (shipment.revision || 0) + 1,
              updatedAt: now,
            },
          });
      } else if (["cancel", "expire"].includes(body.mode)) {
        const paymentAttempt = (await transaction.getDocument(`payments/${order.paymentId}`))?.data?.gateway;
        if (paymentAttempt && !["rejected", "cancelled"].includes(paymentAttempt.receipt?.status))
          fail("El pago Payway debe conciliarse antes de cancelar o liberar la reserva.");
        if (paid)
          fail(
            "La venta ya está registrada. Usá la gestión logística y la devolución comercial/fiscal correspondiente.",
          );
        if (order.status !== "pending_payment")
          fail("El pedido ya tiene estado final.");
        if (
          body.mode === "expire" &&
          new Date(order.reservationExpiresAt) > now
        )
          fail("La reserva aún no venció.");
        for (const item of order.items) {
          const reserved = orderReservationAllocations(order, item);
          const allocations = reserved.length ? reserved : [{ ...oldOrigin, quantity: item.quantity }];
          for (const allocation of allocations) {
            const path = originStockPath(allocation, item.productId);
            const stock = await transaction.getDocument(path);
            if (stock)
              operations.push({
                type: "update",
                path,
                data: reservationPatch(stock.data, orderId, null, now),
              });
          }
        }
        Object.assign(changes, {
          status: body.mode === "expire" ? "expired" : "cancelled",
          reservationStatus: "released",
          paymentStatus: "cancelled",
        });
        operations.push({
          type: "update",
          path: `payments/${order.paymentId}`,
          data: { status: "cancelled", updatedAt: now },
        });
      } else fail("Operación inválida.", 400);
      const result = { id: orderId, ...changes };
      operations.push(
        { type: "update", path: `orders/${orderId}`, data: changes },
        {
          type: "create",
          path: receiptPath,
          data: { fingerprint, result, createdAt: now },
        },
        {
          type: "create",
          path: `auditLogs/web_manage_${requestId}`,
          data: {
            moduleId: "ecommerce",
            action: `order.${body.mode}`,
            entityId: orderId,
            userId: session.uid,
            description: reason,
            createdAt: now,
          },
        },
      );
      await transaction.commitDocuments(operations);
      return result;
    },
    { env },
  );
}
