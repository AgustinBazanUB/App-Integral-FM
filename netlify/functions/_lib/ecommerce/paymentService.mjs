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

function saleCodeFor(requestId) {
  return `WEB-${requestId.slice(0, 24).toUpperCase()}`;
}

async function loadAuthoritativeInputs({ requestedItems, locationId, env, getDocument }) {
  const uniqueProductIds = [...new Set(requestedItems.map((item) => item.productId))];
  const entries = await Promise.all(uniqueProductIds.map(async (productId) => {
    const [productSnapshot, stockSnapshot] = await Promise.all([
      getDocument(`products/${productId}`, { env }),
      getDocument(`locationStock/${locationId}/items/${productId}`, { env }),
    ]);
    return [
      productId,
      productSnapshot ? { ...productSnapshot.data, id: productId } : null,
      stockSnapshot ? {
        ...stockSnapshot.data,
        id: productId,
        __updateTime: stockSnapshot.updateTime || stockSnapshot.data?.__updateTime || null,
      } : null,
    ];
  }));
  return {
    productsById: Object.fromEntries(entries.filter(([, product]) => product).map(([id, product]) => [id, product])),
    stocksById: Object.fromEntries(entries.filter(([, , stock]) => stock).map(([id, , stock]) => [id, stock])),
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
  if (Number(order.total) !== Number(prepared.total)
      || Number(order.subtotal) !== Number(prepared.subtotal)
      || Number(order.shippingAmount || 0) !== Number(prepared.shippingAmount || 0)) {
    throw commerceError(
      "ecommerce-order-commercial-drift",
      "El precio o total cambió desde que se creó el pedido. Debe generarse un nuevo checkout.",
      409,
    );
  }
  const stored = normalizedOrderItems(order.items);
  const current = normalizedOrderItems(prepared.items);
  if (stored.length !== current.length) {
    throw commerceError("ecommerce-order-commercial-drift", "Los productos del pedido cambiaron.", 409);
  }
  for (let index = 0; index < stored.length; index += 1) {
    const before = stored[index];
    const now = current[index];
    if (
      before.productId !== now.productId
      || before.quantity !== now.quantity
      || before.unitPrice !== now.unitPrice
      || before.subtotal !== now.subtotal
      || before.arcaVatRate !== now.arcaVatRate
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
  return actor.isAdmin === true || ["admin", "general_admin"].includes(String(actor.role || "").trim().toLowerCase());
}

function sameFinalPayment(order = {}, confirmation = {}) {
  return (
    order.paymentStatus === confirmation.paymentStatus
    && order.paymentProvider === confirmation.paymentProvider
    && order.paymentReference === confirmation.reference
    && Boolean(order.saleId) === ["approved", "simulated_approved"].includes(confirmation.paymentStatus)
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
} = {}) {
  if (getDocument === adminGetDocument && commitDocuments === adminCommitDocuments) {
    return adminRunTransaction((transaction) => confirmEcommercePayment({ orderId, idempotencyKey, provider, status, reference, actor, env, now, ...transaction }), {env});
  }
  const safeOrderId = String(orderId || "").trim();
  if (!/^ecommerce_order_[A-Za-z0-9_-]{8,96}$/.test(safeOrderId)) {
    throw commerceError("ecommerce-order-id-invalid", "El pedido Ecommerce no es válido.", 400);
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
    throw commerceError("ecommerce-order-not-found", "El pedido Ecommerce no existe.", 404);
  }
  if (String(order.idempotencyKey || order.requestId || "") !== stableKey) {
    throw commerceError(
      "ecommerce-idempotency-conflict",
      "La clave de idempotencia no corresponde a este pedido.",
      409,
    );
  }
  const replay = sameFinalPayment(order, confirmation);
  if (!replay && ["approved", "simulated_approved", "rejected", "cancelled"].includes(String(order.paymentStatus || ""))) {
    throw commerceError(
      "ecommerce-payment-transition-conflict",
      "El pago ya tiene un estado final incompatible con esta confirmación.",
      409,
    );
  }

  const paymentId = String(order.paymentId || "").trim();
  const paymentSnapshot = paymentId ? await getDocument(`payments/${paymentId}`, { env }) : null;
  const payment = paymentSnapshot?.data || null;
  if (!payment || paymentId !== `ecommerce_payment_${stableKey}` || payment.sourceType !== "ecommerce" || payment.orderId !== safeOrderId || String(payment.idempotencyKey || "") !== stableKey) {
    throw commerceError("ecommerce-payment-invalid", "El pago asociado al pedido no es válido.", 409);
  }
  if (Number(payment.amount) !== Number(order.total) || payment.currency !== "ARS") {
    throw commerceError("ecommerce-payment-amount-conflict", "El monto del pago no coincide con el pedido.", 409);
  }

  if (replay) {
    if (payment.status !== confirmation.paymentStatus || payment.provider !== confirmation.paymentProvider || payment.providerReference !== confirmation.reference || payment.saleId !== order.saleId) {
      throw commerceError("ecommerce-payment-transition-conflict", "El pago persistido no coincide con el pedido.", 409);
    }
    return paymentResult(safeOrderId, order, {idempotent:true});
  }
  if (payment.status !== "pending" || order.paymentStatus !== "pending" || order.status !== "pending_payment") {
    throw commerceError("ecommerce-payment-transition-conflict", "El pago o pedido no está pendiente.", 409);
  }
  const timestamp = now instanceof Date ? now : new Date(now);
  const approved = ["approved", "simulated_approved"].includes(confirmation.paymentStatus);
  const operations = [];
  let saleId = null;

  if (approved) {
    const locationId = String(order.locationId || "").trim();
    if (!locationId || locationId !== ecommerceLocationId(env)) {
      throw commerceError("ecommerce-location-conflict", "La ubicación Ecommerce del pedido no coincide con la configuración actual.", 409);
    }
    const locationSnapshot = await getDocument(`locations/${locationId}`, { env });
    if (!locationSnapshot || locationSnapshot.data?.deleted === true || locationSnapshot.data?.active === false) {
      throw commerceError("ecommerce-location-unavailable", "La ubicación Ecommerce no está disponible.", 409);
    }

    const requestedItems = normalizeCheckoutItems(order.items);
    const { productsById, stocksById } = await loadAuthoritativeInputs({
      requestedItems,
      locationId,
      env,
      getDocument,
    });
    const prepared = prepareAuthoritativeCheckout({
      requestedItems,
      productsById,
      stocksById,
      customer: order.customer,
      shipping: order.shipping,
      env,
    });
    assertCommercialSnapshotMatches(order, prepared);

    saleId = `ecommerce_sale_${stableKey}`;
    const crm = await prepareCommerceCustomer({ customer: prepared.customer, saleId, timestamp, getDocument, env });
    operations.push(...crm.operations);
    const sale = {
      schemaVersion: 2,
      sourceType: "ecommerce",
      sourceChannel: "ecommerce",
      orderId: safeOrderId,
      idempotencyKey: stableKey,
      locationId,
      locationName: order.locationName || locationSnapshot.data?.name || "Ecommerce",
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
      })),
      discounts: [],
      discountTotal: 0,
      subtotal: prepared.subtotal,
      shippingAmount: prepared.shippingAmount,
      totalBeforeDiscounts: prepared.subtotal,
      totalItems: prepared.items.reduce((sum, item) => sum + item.quantity, 0),
      total: prepared.total,
      paymentMethod: confirmation.paymentProvider,
      paymentMethodLabel: confirmation.simulated ? "Simulación local" : "Payway",
      payments: [{
        method: confirmation.paymentProvider,
        amount: prepared.total,
        reference: confirmation.reference,
      }],
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
    operations.push({ type: "create", path: `sales/${saleId}`, data: sale });

    for (const item of prepared.items) {
      const stock = stocksById[item.productId];
      const newStock = item.availableStock - item.quantity;
      const safeProductId = createHash("sha256").update(item.productId).digest("hex").slice(0,32);
      const movementId = `ecommerce_${stableKey}_${safeProductId}`;
      operations.push({
        type: "update",
        path: `locationStock/${locationId}/items/${item.productId}`,
        data: {
          currentStock: newStock,
          lastSaleId: saleId,
          lastMovementId: movementId,
          updatedAt: timestamp,
        },
        currentUpdateTime: stock.__updateTime || null,
      });
      operations.push({
        type: "create",
        path: `stockMovements/${movementId}`,
        data: {
          sourceType: "ecommerce",
          orderId: safeOrderId,
          saleId,
          locationId,
          locationName: sale.locationName,
          productId: item.productId,
          productName: item.name,
          type: "sale",
          qty: -item.quantity,
          previousStock: item.availableStock,
          newStock,
          reason: `Venta Ecommerce ${sale.saleCode}`,
          userId: confirmation.simulated ? actor.uid || "ecommerce-admin-simulation" : "ecommerce-payment-backend",
          userName: confirmation.simulated ? actor.name || "Administrador" : "Ecommerce",
          createdAt: timestamp,
        },
      });
    }
  }

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
      invoiceStatus: approved ? "pending" : order.invoiceStatus || "not_requested",
      updatedAt: timestamp,
    },
    currentUpdateTime: orderSnapshot.updateTime || null,
  });

  try {
    await commitDocuments(operations, { env });
  } catch (error) {
    if (error?.retryable) throw error;
    if (["firebase-admin-already-exists", "firebase-admin-precondition-failed"].includes(error?.code)) {
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
    invoiceStatus: approved ? "pending" : order.invoiceStatus || "not_requested",
    updatedAt: timestamp,
  });
}
