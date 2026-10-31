import {
  loadWebChannel,
  resolveChannelOrigin,
  originStockPath,
} from "./channelService.mjs";
import {
  reservationPatch,
  reservedStockQuantity,
} from "../../../../src/shared/stockReservations.mjs";
import { preparePaidEcommerceFulfillment } from "../shipping.mjs";
import { prepareCommerceCustomer } from "./customerLink.mjs";
import {
  adminCommitDocuments,
  adminGetDocument,
  adminRunTransaction,
} from "../firestoreAdminRest.mjs";
import {
  commerceError,
  ecommerceLocationId,
  normalizeCheckoutItems,
  normalizeEcommerceRequestId,
  prepareAuthoritativeCheckout,
} from "./commerceDomain.mjs";
import { createHash } from "node:crypto";
import { confirmPayment } from "./paymentContract.mjs";
import { normalizedRole } from "../../../../src/gestion/permissions.js";

function saleCodeFor(requestId) {
  return `WEB-${requestId.slice(0, 24).toUpperCase()}`;
}

async function loadAuthoritativeInputs({
  requestedItems,
  locationId,
  origin,
  channel,
  orderItems,
  orderId,
  now,
  env,
  getDocument,
}) {
  const uniqueProductIds = [
    ...new Set(requestedItems.map((item) => item.productId)),
  ];
  const physicalStocksByPath = {};
  const allocationsByProduct = {};
  const entries = await Promise.all(uniqueProductIds.map(async (productId) => {
    const productSnapshot = await getDocument(`products/${productId}`, { env });
    const settingSnapshot = channel
      ? await getDocument(`ecommerceProductSettings/${productId}`, { env })
      : null;
    const promotionSnapshot = channel
      ? await getDocument(`ecommercePromotions/${productId}`, { env })
      : null;
    const item = orderItems.find((row) => row.productId === productId);
    const allocationRows = Array.isArray(item?.stockAllocations) && item.stockAllocations.length
      ? item.stockAllocations
      : [{ type: origin?.type || "location", id: origin?.id || locationId, name: origin?.name || "", quantity: item?.quantity || 0 }];
    if (allocationRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0) !== Number(item?.quantity || 0))
      throw commerceError("ecommerce-reservation-invalid", "La distribución de stock del pedido no coincide con sus cantidades.", 409);
    const sourceRefs = channel?.authorizedOrigins?.length
      ? channel.authorizedOrigins
      : [{ type: origin?.type || "location", id: origin?.id || locationId, name: origin?.name || "" }];
    const configuredSourceKeys = new Set(sourceRefs.map((row) => `${row.type}:${row.id}`));
    if (allocationRows.some((row) => !configuredSourceKeys.has(`${row.type}:${row.id}`)))
      throw commerceError("ecommerce-origin-not-authorized", "El pedido conserva una reserva en un origen que ya no está habilitado.", 409);
    const sourceRows = [];
    for (const sourceRef of sourceRefs) {
      const source = channel
        ? await resolveChannelOrigin(channel, sourceRef, { env, getDocument })
        : { type: sourceRef.type, id: sourceRef.id, name: sourceRef.name || origin?.name || "Ecommerce" };
      const path = originStockPath(source, productId);
      const snapshot = await getDocument(path, { env });
      const stock = snapshot?.data || null;
      const available = stock && stock.active !== false && stock.deleted !== true && stock.productDeleted !== true
        ? Math.max(0, Number(stock.currentStock || 0) - reservedStockQuantity(stock, now, orderId))
        : 0;
      if (snapshot) physicalStocksByPath[path] = { snapshot, origin: source, productId };
      sourceRows.push({ origin: source, stock, snapshot, available, path });
    }
    const distinctSources = new Map();
    for (const allocation of allocationRows) {
      const key = `${allocation.type}:${allocation.id}`;
      distinctSources.set(key, allocation);
    }
    allocationsByProduct[productId] = [...distinctSources.values()];
    const pricingRow = sourceRows.find((row) => row.origin?.id === origin?.id && row.origin?.type === origin?.type && row.stock && row.stock.active !== false && row.stock.deleted !== true && row.stock.productDeleted !== true)
      || sourceRows.find((row) => row.stock && row.stock.active !== false && row.stock.deleted !== true)
      || null;
    const floor = Math.max(0, Number(settingSnapshot?.data?.minimumRemainingStock) || 0);
    const aggregateStock = {
      ...(pricingRow?.stock || { priceMode: "default" }),
      id: productId,
      currentStock: Math.max(0, sourceRows.reduce((sum, row) => sum + row.available, 0) - floor),
    };
    return [
      productId,
      productSnapshot ? { ...productSnapshot.data, id: productId } : null,
      aggregateStock,
      settingSnapshot?.data || {},
      promotionSnapshot?.data || null,
    ];
  }));
  return {
    productsById: Object.fromEntries(
      entries
        .filter(([, product]) => product)
        .map(([id, product]) => [id, product]),
    ),
    stocksById: Object.fromEntries(
      entries
        .map(([id, , stock]) => [id, stock]),
    ),
    ecommerceSettingsById: Object.fromEntries(entries.map(([id, , , settings]) => [id, settings])),
    promotionsByProductId: Object.fromEntries(entries.filter(([, , , , promotion]) => promotion).map(([id, , , , promotion]) => [id, promotion])),
    allocationsByProduct,
    physicalStocksByPath,
  };
}

function publicOrder(orderId, order = {}) {
  return { ...order, id: orderId };
}

function normalizedOrderItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      productId: String(item.productId || ""),
      quantity: Number(item.quantity ?? item.qty),
      unitPrice: Number(item.unitPrice),
      subtotal: Number(item.subtotal),
      arcaVatRate: Number(item.arcaVatRate),
    }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
}

function assertCommercialSnapshotMatches(order, prepared) {
  if (
    Number(order.total) !== Number(prepared.total) ||
    Number(order.subtotal) !== Number(prepared.subtotal) ||
    Number(order.shippingAmount || 0) !== Number(prepared.shippingAmount || 0)
  ) {
    throw commerceError(
      "ecommerce-order-commercial-drift",
      "El precio o total cambió desde que se creó el pedido. Debe generarse un nuevo checkout.",
      409,
    );
  }
  const stored = normalizedOrderItems(order.items);
  const current = normalizedOrderItems(prepared.items);
  if (stored.length !== current.length) {
    throw commerceError(
      "ecommerce-order-commercial-drift",
      "Los productos del pedido cambiaron.",
      409,
    );
  }
  for (let index = 0; index < stored.length; index += 1) {
    const before = stored[index];
    const now = current[index];
    if (
      before.productId !== now.productId ||
      before.quantity !== now.quantity ||
      before.unitPrice !== now.unitPrice ||
      before.subtotal !== now.subtotal ||
      before.arcaVatRate !== now.arcaVatRate
    ) {
      throw commerceError(
        "ecommerce-order-commercial-drift",
        "El pedido ya no coincide con precio, cantidad o configuración fiscal autoritativa.",
        409,
      );
    }
  }
}

function actorIsAdmin(actor = {}) {
  return (
    actor.isAdmin === true ||
    ["admin", "general_admin"].includes(
      String(actor.role || "")
        .trim()
        .toLowerCase(),
    )
  );
}

function sameFinalPayment(order = {}, confirmation = {}) {
  return (
    order.paymentStatus === confirmation.paymentStatus &&
    order.paymentProvider === confirmation.paymentProvider &&
    order.paymentReference === confirmation.reference &&
    Boolean(order.saleId) ===
      ["approved", "simulated_approved"].includes(confirmation.paymentStatus)
  );
}

function paymentResult(orderId, order, { idempotent = false } = {}) {
  return {
    idempotent,
    order: publicOrder(orderId, order),
    saleId: order.saleId || null,
    paymentProvider: order.paymentProvider || null,
    paymentStatus: order.paymentStatus || "pending",
  };
}

export async function confirmEcommercePayment({
  orderId,
  idempotencyKey,
  provider,
  status,
  reference,
  actor = {},
  env = process.env,
  now = new Date(),
  getDocument = adminGetDocument,
  commitDocuments = adminCommitDocuments,
  listDocuments = async () => [],
} = {}) {
  if (
    getDocument === adminGetDocument &&
    commitDocuments === adminCommitDocuments
  ) {
    // Test-mode exceptions require injected adapters, never real Firestore.
    if (String(provider).toLowerCase() === "simulation" && (env.FIREBASE_PROJECT_ID !== "app-integral-fm-pruebas" || env.VITE_PREVIEW_FIREBASE_PROJECT_ID !== "app-integral-fm-pruebas" || env.ARCA_ENVIRONMENT !== "homologation")) throw commerceError("ecommerce-simulation-isolation-required", "Las simulaciones requieren Firebase de pruebas y ARCA homologación.",403);
    return adminRunTransaction(
      (transaction) =>
        confirmEcommercePayment({
          orderId,
          idempotencyKey,
          provider,
          status,
          reference,
          actor,
          env,
          now,
          ...transaction,
        }),
      { env },
    );
  }
  const safeOrderId = String(orderId || "").trim();
  if (!/^ecommerce_order_[A-Za-z0-9_-]{8,96}$/.test(safeOrderId)) {
    throw commerceError(
      "ecommerce-order-id-invalid",
      "El pedido Ecommerce no es válido.",
      400,
    );
  }
  const stableKey = normalizeEcommerceRequestId(idempotencyKey);
  const confirmation = confirmPayment({ provider, status, reference }, { env });
  if (confirmation.paymentProvider === "simulation" && !actorIsAdmin(actor)) {
    throw commerceError(
      "ecommerce-simulation-admin-required",
      "Sólo un administrador puede simular un pago aprobado.",
      403,
    );
  }

  const orderSnapshot = await getDocument(`orders/${safeOrderId}`, { env });
  const order = orderSnapshot?.data || null;
  if (!order || order.sourceType !== "ecommerce") {
    throw commerceError(
      "ecommerce-order-not-found",
      "El pedido Ecommerce no existe.",
      404,
    );
  }
  if (String(order.idempotencyKey || order.requestId || "") !== stableKey) {
    throw commerceError(
      "ecommerce-idempotency-conflict",
      "La clave de idempotencia no corresponde a este pedido.",
      409,
    );
  }
  const replay = sameFinalPayment(order, confirmation);
  if (
    !replay &&
    ["approved", "simulated_approved", "rejected", "cancelled"].includes(
      String(order.paymentStatus || ""),
    )
  ) {
    throw commerceError(
      "ecommerce-payment-transition-conflict",
      "El pago ya tiene un estado final incompatible con esta confirmación.",
      409,
    );
  }

  const paymentId = String(order.paymentId || "").trim();
  const paymentSnapshot = paymentId
    ? await getDocument(`payments/${paymentId}`, { env })
    : null;
  const payment = paymentSnapshot?.data || null;
  if (
    !payment ||
    paymentId !== `ecommerce_payment_${stableKey}` ||
    payment.sourceType !== "ecommerce" ||
    payment.orderId !== safeOrderId ||
    String(payment.idempotencyKey || "") !== stableKey
  ) {
    throw commerceError(
      "ecommerce-payment-invalid",
      "El pago asociado al pedido no es válido.",
      409,
    );
  }
  if (
    Number(payment.amount) !== Number(order.total) ||
    payment.currency !== "ARS"
  ) {
    throw commerceError(
      "ecommerce-payment-amount-conflict",
      "El monto del pago no coincide con el pedido.",
      409,
    );
  }

  if (replay) {
    if (
      payment.status !== confirmation.paymentStatus ||
      payment.provider !== confirmation.paymentProvider ||
      payment.providerReference !== confirmation.reference ||
      payment.saleId !== order.saleId
    ) {
      throw commerceError(
        "ecommerce-payment-transition-conflict",
        "El pago persistido no coincide con el pedido.",
        409,
      );
    }
    return paymentResult(safeOrderId, order, { idempotent: true });
  }
  if (
    payment.status !== "pending" ||
    order.paymentStatus !== "pending" ||
    order.status !== "pending_payment"
  ) {
    throw commerceError(
      "ecommerce-payment-transition-conflict",
      "El pago o pedido no está pendiente.",
      409,
    );
  }
  const timestamp = now instanceof Date ? now : new Date(now);
  const approved = ["approved", "simulated_approved"].includes(
    confirmation.paymentStatus,
  );
  const operations = [];
  let saleId = null;

  if (approved) {
    const channel = order.channelId
      ? await loadWebChannel({ env, getDocument })
      : null;
    const origin = channel
      ? await resolveChannelOrigin(
          channel,
          { type: order.stockOriginType, id: order.stockOriginId },
          { env, getDocument },
        )
      : { type: "location", id: order.locationId, name: order.locationName };
    if (channel && confirmation.simulated) {
      const profile = (await getDocument(`users/${actor.uid}`, { env }))?.data;
      if (
        profile?.active !== true ||
        !actorIsAdmin({ ...profile, role: normalizedRole(profile) })
      )
        throw commerceError(
          "ecommerce-simulation-admin-required",
          "El administrador ya no está activo o autorizado.",
          403,
        );
    }
    if (
      channel?.authorizedUserIds?.length &&
      !channel.authorizedUserIds.includes(actor.uid)
    )
      throw commerceError(
        "ecommerce-channel-user-denied",
        "El usuario no está autorizado para confirmar operaciones del canal.",
        403,
      );
    if (
      channel &&
      (order.reservationStatus !== "active" ||
        new Date(order.reservationExpiresAt) <= timestamp)
    )
      throw commerceError(
        "ecommerce-reservation-expired",
        "La reserva venció; generá un nuevo pedido.",
        409,
      );
    const locationId = origin.id;
    if (!locationId || (!channel && locationId !== ecommerceLocationId(env))) {
      throw commerceError(
        "ecommerce-location-conflict",
        "La ubicación Ecommerce del pedido no coincide con la configuración actual.",
        409,
      );
    }
    const locationSnapshot = await getDocument(
      `${origin.type === "warehouse" ? "warehouses" : "locations"}/${locationId}`,
      { env },
    );
    if (
      !locationSnapshot ||
      locationSnapshot.data?.deleted === true ||
      locationSnapshot.data?.active === false
    ) {
      throw commerceError(
        "ecommerce-location-unavailable",
        "La ubicación Ecommerce no está disponible.",
        409,
      );
    }

    const requestedItems = normalizeCheckoutItems(order.items);
    const { productsById, stocksById, ecommerceSettingsById, promotionsByProductId, allocationsByProduct, physicalStocksByPath } = await loadAuthoritativeInputs({
      requestedItems,
      locationId,
      origin,
      channel,
      orderItems: order.items || [],
      orderId: safeOrderId,
      now: timestamp,
      env,
      getDocument,
    });
    const prepared = prepareAuthoritativeCheckout({
      requestedItems,
      productsById,
      stocksById,
      customer: order.customer,
      shipping: order.shipping,
      resolvedShipping: channel ? order.shipping : null,
      ecommerceSettingsById,
      promotionsByProductId,
      env,
    });
    assertCommercialSnapshotMatches(order, prepared);
    if (channel) {
      for (const item of prepared.items) {
        for (const allocation of allocationsByProduct[item.productId] || []) {
          const path = originStockPath(allocation, item.productId);
          const stock = physicalStocksByPath[path]?.snapshot?.data;
          const hold = stock?.ecommerceReservations?.[safeOrderId];
          const expected = Number(allocation.quantity);
        if (
          !hold ||
          hold.quantity !== expected ||
          new Date(hold.expiresAt) <= timestamp
        )
          throw commerceError(
            "ecommerce-reservation-invalid",
            "La reserva de stock del pedido no está vigente.",
            409,
          );
        }
      }
    }

    saleId = `ecommerce_sale_${stableKey}`;
    const crm = await prepareCommerceCustomer({
      customer: prepared.customer,
      saleId,
      orderId: safeOrderId,
      simulated: confirmation.simulated,
      timestamp,
      getDocument,
      env,
    });
    operations.push(...crm.operations);
    const sale = {
      schemaVersion: 2,
      sourceType: "ecommerce",
      sourceChannel: "ecommerce",
      channelId: order.channelId || null,
      simulated: confirmation.simulated,
      billing: order.billing || null,
      stockOriginType: origin.type,
      stockOriginId: origin.id,
      stockOriginName: origin.name,
      stockCommitState: "committed",
      orderId: safeOrderId,
      idempotencyKey: stableKey,
      locationId: origin.type === "location" ? locationId : null,
      locationName:
        order.locationName || locationSnapshot.data?.name || "Ecommerce",
      sellerId: null,
      sellerName: "Ecommerce",
      customerId: crm.customerId,
      customerPhoneNormalized: crm.customerPhoneNormalized,
      crmLinkStatus: crm.crmLinkStatus,
      customerNameSnapshot: prepared.customer.fullName,
      customerPhoneSnapshot: prepared.customer.phone,
      customerEmailSnapshot: prepared.customer.email,
      items: prepared.items.map((item) => ({
        productId: item.productId,
        name: item.name,
        abbreviation: item.abbreviation,
        qty: item.quantity,
        unitPrice: item.unitPrice,
        subtotal: item.subtotal,
        arcaVatRate: item.arcaVatRate,
        promotionName: item.promotionName || null,
        stockAllocations: allocationsByProduct[item.productId] || [],
      })),
      discounts: [],
      discountTotal: 0,
      subtotal: prepared.subtotal,
      shippingAmount: prepared.shippingAmount,
      shippingVatRate: prepared.shipping.arcaVatRate ?? null,
      totalBeforeDiscounts: prepared.subtotal,
      totalItems: prepared.items.reduce((sum, item) => sum + item.quantity, 0),
      total: prepared.total,
      paymentMethod: confirmation.paymentProvider,
      paymentMethodLabel: confirmation.simulated
        ? "Simulación local"
        : "Payway",
      payments: [
        {
          method: confirmation.paymentProvider,
          amount: prepared.total,
          reference: confirmation.reference,
        },
      ],
      paymentProvider: confirmation.paymentProvider,
      paymentReference: confirmation.reference,
      paymentStatus: confirmation.paymentStatus,
      invoiceStatus: "pending",
      status: "active",
      saleCode: saleCodeFor(stableKey),
      deliveryMethod: prepared.shipping.method,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    let fulfillment = null;
    if (channel) {
      fulfillment = await preparePaidEcommerceFulfillment({
        transaction: { getDocument, listDocuments },
        order: { ...order, id: safeOrderId },
        sale,
        saleId,
        origin,
        actor: actor.uid,
        env,
        now: timestamp,
      });
      Object.assign(sale, {
        shipmentId: fulfillment.shipmentId,
        fulfillmentId: fulfillment.shipmentId,
      });
      Object.assign(order, {
        shipmentId: fulfillment.shipmentId,
        fulfillmentId: fulfillment.shipmentId,
        pickupCode: fulfillment.pickupCode,
      });
      operations.push(...fulfillment.operations);
    }
    operations.push({ type: "create", path: `sales/${saleId}`, data: sale });

    for (const item of prepared.items) {
      for (const allocation of allocationsByProduct[item.productId] || []) {
        const path = originStockPath(allocation, item.productId);
        const snapshot = physicalStocksByPath[path]?.snapshot;
        const stock = snapshot?.data;
        if (!stock || stock.active === false || stock.deleted === true || stock.productDeleted === true)
          throw commerceError("ecommerce-stock-inactive", `${item.name}: el stock de ${allocation.name || allocation.id} dejó de estar disponible.`, 409);
        const newStock = Number(stock.currentStock) - Number(allocation.quantity);
        const safeSourceId = createHash("sha256")
          .update(`${allocation.type}:${allocation.id}`)
          .digest("hex")
          .slice(0, 12);
        const safeProductId = createHash("sha256")
          .update(item.productId)
          .digest("hex")
          .slice(0, 20);
        const movementId = `ecommerce_${stableKey}_${safeProductId}_${safeSourceId}`;
        operations.push({
          type: "update",
          path,
          data: {
            currentStock: newStock,
            ...(channel
              ? reservationPatch(stock, safeOrderId, null, timestamp)
              : {}),
            lastSaleId: saleId,
            lastMovementId: movementId,
            updatedAt: timestamp,
          },
          currentUpdateTime: snapshot.updateTime || null,
        });
        operations.push({
          type: "create",
          path: `stockMovements/${movementId}`,
          data: {
            sourceType: "ecommerce",
            orderId: safeOrderId,
            saleId,
            inventoryType: allocation.type,
            inventoryId: allocation.id,
            ...(allocation.type === "warehouse"
              ? { warehouseId: allocation.id, warehouseName: allocation.name }
              : { locationId: allocation.id, locationName: allocation.name }),
            simulated: confirmation.simulated,
            productId: item.productId,
            productName: item.name,
            type: "sale",
            qty: -Number(allocation.quantity),
            previousStock: Number(stock.currentStock),
            newStock,
            reason: `Venta Ecommerce ${sale.saleCode}`,
            userId: confirmation.simulated
              ? actor.uid || "ecommerce-admin-simulation"
              : "ecommerce-payment-backend",
            userName: confirmation.simulated
              ? actor.name || "Administrador"
              : "Ecommerce",
            createdAt: timestamp,
          },
        });
      }
    }
  }

  if (approved)
    operations.push({
      type: "create",
      path: `auditLogs/web_payment_${stableKey}`,
      data: {
        moduleId: "ecommerce",
        action: "payment.simulated_approved",
        entityId: safeOrderId,
        entityType: "order",
        userId: actor.uid || "backend",
        simulated: confirmation.simulated,
        description: "Venta, stock y logística registrados en una transacción",
        createdAt: timestamp,
      },
    });
  const nextOrderStatus = approved
    ? "confirmed"
    : confirmation.paymentStatus === "rejected"
      ? "payment_rejected"
      : confirmation.paymentStatus === "cancelled"
        ? "payment_cancelled"
        : "pending_payment";
  operations.unshift({
    type: "update",
    path: `payments/${paymentId}`,
    data: {
      provider: confirmation.paymentProvider,
      providerStatus: confirmation.providerStatus,
      providerReference: confirmation.reference,
      status: confirmation.paymentStatus,
      saleId,
      confirmedAt: approved ? timestamp : null,
      updatedAt: timestamp,
    },
    currentUpdateTime: paymentSnapshot.updateTime || null,
  });
  operations.unshift({
    type: "update",
    path: `orders/${safeOrderId}`,
    data: {
      status: nextOrderStatus,
      paymentProvider: confirmation.paymentProvider,
      paymentStatus: confirmation.paymentStatus,
      paymentReference: confirmation.reference,
      saleId,
      invoiceStatus: approved
        ? "pending"
        : order.invoiceStatus || "not_requested",
      ...(order.channelId && approved
        ? {
            reservationStatus: "consumed",
            shipmentId: order.shipmentId,
            fulfillmentId: order.fulfillmentId,
            pickupCode: order.pickupCode,
            simulated: confirmation.simulated,
          }
        : {}),
      updatedAt: timestamp,
    },
    currentUpdateTime: orderSnapshot.updateTime || null,
  });

  try {
    await commitDocuments(operations, { env });
  } catch (error) {
    if (error?.retryable) throw error;
    if (
      [
        "firebase-admin-already-exists",
        "firebase-admin-precondition-failed",
      ].includes(error?.code)
    ) {
      const raced = await getDocument(`orders/${safeOrderId}`, { env });
      if (raced?.data && sameFinalPayment(raced.data, confirmation)) {
        return paymentResult(safeOrderId, raced.data, { idempotent: true });
      }
      throw commerceError(
        "ecommerce-idempotency-conflict",
        "La operación cambió mientras se confirmaba el pago. No se duplicó la venta.",
        409,
      );
    }
    throw error;
  }

  return paymentResult(safeOrderId, {
    ...order,
    status: nextOrderStatus,
    paymentProvider: confirmation.paymentProvider,
    paymentStatus: confirmation.paymentStatus,
    paymentReference: confirmation.reference,
    saleId,
    invoiceStatus: approved
      ? "pending"
      : order.invoiceStatus || "not_requested",
    updatedAt: timestamp,
  });
}
