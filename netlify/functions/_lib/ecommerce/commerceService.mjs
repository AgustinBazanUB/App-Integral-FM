import {
  channelShipping,
  loadWebChannel,
  normalizeBilling,
  originStockPath,
  resolveChannelOrigin,
} from "./channelService.mjs";
import {
  reservationPatch,
  reservedStockQuantity,
} from "../../../../src/shared/stockReservations.mjs";
import { prepareCommerceCustomer } from "./customerLink.mjs";
import { createHash } from "node:crypto";
import {
  adminCommitDocuments,
  adminGetDocument,
  adminRunTransaction,
  adminListDocuments,
} from "../firestoreAdminRest.mjs";
import {
  authoritativeUnitPrice,
  authoritativeVatRate,
  commerceError,
  ecommerceLocationId,
  ecommercePickupEnabled,
  normalizeCheckoutItems,
  normalizeCustomer,
  normalizeEcommerceRequestId,
  prepareAuthoritativeCheckout,
  resolveRequestedPaymentStatus,
} from "./commerceDomain.mjs";

function slugFrom(value, fallback) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function publicProduct(product, stock, { locationConfigured }) {
  let price = null;
  let vatRate = null;
  let stockQuantity = null;
  let reason = null;
  if (!locationConfigured) {
    reason = "ecommerce-location-not-configured";
  } else {
    try {
      price = authoritativeUnitPrice(product, stock);
      vatRate = authoritativeVatRate(product);
      stockQuantity = Number(stock.currentStock);
      if (stockQuantity <= 0) reason = "out-of-stock";
    } catch (error) {
      reason = error?.code || "ecommerce-product-not-ready";
      if (stock?.id && Number.isInteger(Number(stock.currentStock))) {
        stockQuantity = Number(stock.currentStock);
      }
      try {
        price = authoritativeUnitPrice(product, stock);
      } catch {}
      try {
        vatRate = authoritativeVatRate(product);
      } catch {}
    }
  }

  return {
    id: product.id,
    editorialId:
      String(
        product.ecommerceEditorialId || product.editorialId || "",
      ).trim() || null,
    slug: slugFrom(product.ecommerceSlug || product.slug, product.id),
    name: product.name || "Producto",
    abbreviation: product.abbreviation || "",
    description: product.description || "",
    categoryId: product.categoryId || "",
    categoryName: product.categoryName || "",
    image: product.imageUrl || stock?.imageUrl || "",
    thumb: product.thumbUrl || stock?.thumbUrl || product.imageUrl || "",
    price,
    stock: stockQuantity,
    stockState:
      stockQuantity == null
        ? "unknown"
        : stockQuantity > 0
          ? "available"
          : "out",
    active: product.active !== false && product.deleted !== true,
    arcaVatRate: vatRate,
    commercialReady:
      !reason &&
      Number.isInteger(price) &&
      price > 0 &&
      Number.isInteger(stockQuantity) &&
      stockQuantity > 0,
    pendingReason: reason,
    dataStatus: !reason ? "ready" : "pending",
  };
}

export async function createEcommerceOrder({
  body,
  env = process.env,
  now = new Date(),
  getDocument = adminGetDocument,
  commitDocuments = adminCommitDocuments,
} = {}) {
  resolveRequestedPaymentStatus(body?.paymentMode);
  if (
    getDocument === adminGetDocument &&
    commitDocuments === adminCommitDocuments
  )
    return adminRunTransaction(
      (transaction) => createEcommerceOrder({ body, env, now, ...transaction }),
      { env },
    );
  const requestId = normalizeEcommerceRequestId(body?.requestId),
    orderId = `ecommerce_order_${requestId}`,
    paymentId = `ecommerce_payment_${requestId}`;
  const requestedItems = normalizeCheckoutItems(body?.items),
    customer = normalizeCustomer(body?.customer);
  const billing = normalizeBilling(body?.billing);
  const shippingRequest = {
    ...body?.shipping,
    method: body?.deliveryMethod || body?.shipping?.method || "pickup",
    notes: body?.notes || body?.shipping?.notes || "",
  };
  const accessToken = String(body?.accessToken || "");
  const accessHash = /^[A-Za-z0-9_-]{32,128}$/.test(accessToken)
    ? createHash("sha256").update(accessToken).digest("hex")
    : null;
  const requestFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        items: [...requestedItems].sort((a, b) =>
          a.productId.localeCompare(b.productId),
        ),
        customer,
        shippingRequest,
        billing,
        accessHash,
      }),
    )
    .digest("hex");
  const existing = await getDocument(`orders/${orderId}`, { env });
  if (existing) {
    if (
      existing.data.requestFingerprint &&
      existing.data.requestFingerprint !== requestFingerprint
    )
      throw commerceError(
        "ecommerce-idempotency-conflict",
        "El intento ya corresponde a otro pedido.",
        409,
      );
    return {
      created: false,
      idempotent: true,
      order: { ...existing.data, id: orderId },
    };
  }
  const channel = await loadWebChannel({ env, getDocument });
  if (channel && !accessHash)
    throw commerceError(
      "ecommerce-access-token-required",
      "No se pudo crear el acceso privado al pedido.",
      400,
    );
  let origin;
  if (channel)
    origin = await resolveChannelOrigin(channel, null, { env, getDocument });
  else {
    const locationId = ecommerceLocationId(env);
    if (!locationId)
      throw commerceError(
        "ecommerce-location-not-configured",
        "Falta configurar el origen web.",
        409,
      );
    const location = (await getDocument(`locations/${locationId}`, { env }))
      ?.data;
    if (!location || location.deleted === true || location.active === false)
      throw commerceError(
        "ecommerce-location-unavailable",
        "El origen no está disponible.",
        409,
      );
    origin = { type: "location", id: locationId, name: location.name };
  }
  const productsById = {},
    stocksById = {},
    physicalStocks = {};
  for (const item of requestedItems) {
    const [product, stock] = await Promise.all([
      getDocument(`products/${item.productId}`, { env }),
      getDocument(originStockPath(origin, item.productId), { env }),
    ]);
    if (product)
      productsById[item.productId] = { ...product.data, id: item.productId };
    if (stock) {
      physicalStocks[item.productId] = stock;
      stocksById[item.productId] = {
        ...stock.data,
        id: item.productId,
        currentStock: Math.max(
          0,
          Number(stock.data.currentStock) -
            reservedStockQuantity(stock.data, now),
        ),
      };
    }
  }
  const shipping = channel ? channelShipping(shippingRequest, channel) : null;
  const prepared = prepareAuthoritativeCheckout({
    requestedItems,
    productsById,
    stocksById,
    customer,
    shipping: shippingRequest,
    resolvedShipping: shipping,
    env,
  });
  const reservationExpiresAt = channel
    ? new Date(now.valueOf() + 15 * 60 * 1000)
    : null;
  const crm = channel
    ? await prepareCommerceCustomer({
        customer,
        orderId,
        saleId: null,
        timestamp: now,
        getDocument,
        env,
      })
    : null;
  const order = {
    schemaVersion: channel ? 3 : 1,
    sourceType: "ecommerce",
    requestId,
    idempotencyKey: requestId,
    requestFingerprint,
    orderCode: `WEB-${requestId.slice(0, 24).toUpperCase()}`,
    status: "pending_payment",
    channelId: channel?.id || null,
    defaultTransport: channel?.defaultTransport || "repository",
    stockOriginType: origin.type,
    stockOriginId: origin.id,
    stockOriginName: origin.name,
    initialStockOrigin: origin,
    originHistory: [],
    locationId: origin.type === "location" ? origin.id : null,
    locationName: origin.name,
    customer,
    customerId: crm?.customerId || null,
    billing,
    items: prepared.items.map(({ availableStock, ...item }) => item),
    subtotal: prepared.subtotal,
    discountTotal: prepared.discountTotal,
    shipping: prepared.shipping,
    shippingAmount: prepared.shippingAmount,
    total: prepared.total,
    paymentId,
    paymentStatus: "pending",
    saleId: null,
    invoiceId: null,
    invoiceStatus: "not_requested",
    reservationStatus: channel ? "active" : "not_reserved",
    reservationExpiresAt,
    accessHash,
    createdAt: now,
    updatedAt: now,
  };
  const operations = [
    { type: "create", path: `orders/${orderId}`, data: order },
    {
      type: "create",
      path: `payments/${paymentId}`,
      data: {
        schemaVersion: 2,
        sourceType: "ecommerce",
        orderId,
        idempotencyKey: requestId,
        saleId: null,
        provider: null,
        status: "pending",
        amount: order.total,
        currency: "ARS",
        providerTransactionId: null,
        createdAt: now,
        updatedAt: now,
      },
    },
    ...(crm?.operations || []),
  ];
  if (channel) {
    for (const item of prepared.items) {
      const stock = physicalStocks[item.productId];
      operations.push({
        type: "update",
        path: originStockPath(origin, item.productId),
        currentUpdateTime: stock.updateTime,
        data: {
          ...reservationPatch(
            stock.data,
            orderId,
            { quantity: item.quantity, expiresAt: reservationExpiresAt },
            now,
          ),
          updatedAt: now,
        },
      });
    }
    operations.push({
      type: "create",
      path: `auditLogs/web_order_${requestId}`,
      data: {
        moduleId: "ecommerce",
        action: "order.created",
        entityId: orderId,
        entityType: "order",
        userId: "ecommerce-backend",
        description:
          "Pedido web pendiente; reserva sin salida física ni ingreso",
        createdAt: now,
      },
    });
  }
  try {
    await commitDocuments(operations, { env });
  } catch (error) {
    if (error.retryable) throw error;
    if (error.code === "firebase-admin-already-exists") {
      const raced = await getDocument(`orders/${orderId}`, { env });
      if (raced?.data.requestFingerprint === requestFingerprint)
        return {
          created: false,
          idempotent: true,
          order: { ...raced.data, id: orderId },
        };
      throw commerceError(
        "ecommerce-idempotency-conflict",
        "El intento ya corresponde a otro pedido.",
        409,
      );
    }
    if (error.code === "firebase-admin-precondition-failed")
      throw commerceError(
        "ecommerce-order-conflict",
        "Cambió el stock; reintentá el pedido.",
        409,
      );
    throw error;
  }
  return { created: true, idempotent: false, order: { ...order, id: orderId } };
}

export async function loadEcommerceCatalog({
  env = process.env,
  now = new Date(),
  listDocuments = adminListDocuments,
  getDocument = adminGetDocument,
} = {}) {
  const channel = await loadWebChannel({ env, getDocument });
  const origin = channel
    ? await resolveChannelOrigin(channel, null, { env, getDocument })
    : null;
  const locationId = origin?.id || ecommerceLocationId(env);
  const products = (await listDocuments("products", { env, pageSize: 500 }))
    .filter((product) => product.deleted !== true && product.active !== false)
    .sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), "es"),
    );

  if (!locationId) {
    return {
      ready: false,
      pending: ["ECOMMERCE_LOCATION_ID"],
      location: null,
      config: {
        pickupEnabled: ecommercePickupEnabled(env),
        deliveryEnabled: false,
        paymentProvider: "pending_payway",
      },
      products: products.map((product) =>
        publicProduct(product, null, { locationConfigured: false }),
      ),
    };
  }

  const locationSnapshot = await getDocument(
    `${origin?.type === "warehouse" ? "warehouses" : "locations"}/${locationId}`,
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

  const stocks = await Promise.all(
    products.map(async (product) => {
      const stockSnapshot = await getDocument(
        originStockPath(
          origin || { type: "location", id: locationId },
          product.id,
        ),
        { env },
      );
      return stockSnapshot
        ? {
            ...stockSnapshot.data,
            currentStock: Math.max(
              0,
              Number(stockSnapshot.data.currentStock) -
                reservedStockQuantity(stockSnapshot.data, now),
            ),
            id: stockSnapshot.path?.split("/").at(-1) || product.id,
          }
        : null;
    }),
  );

  return {
    ready: true,
    pending: channel
      ? []
      : ecommercePickupEnabled(env)
        ? ["DELIVERY_PRICING"]
        : ["PICKUP_CONFIGURATION", "DELIVERY_PRICING"],
    location: {
      id: locationId,
      name: locationSnapshot.data?.name || "Ecommerce",
    },
    config: {
      pickupEnabled: channel
        ? channel.pickup?.enabled === true
        : ecommercePickupEnabled(env),
      deliveryEnabled: channel?.delivery?.enabled === true,
      pickup: channel?.pickup || null,
      deliveryRates: (channel?.delivery?.rates || []).filter(
        (rate) => rate.active !== false,
      ),
      channelId: channel?.id || null,
      paymentProvider: "pending_payway",
    },
    products: products.map((product, index) =>
      publicProduct(product, stocks[index], { locationConfigured: true }),
    ),
  };
}
