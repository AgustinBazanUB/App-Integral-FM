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

function publicProduct(product, stock, { locationConfigured, settings = {}, promotion = null }) {
  let price = null;
  let vatRate = null;
  const stockQuantity = Number.isInteger(stock?.currentStock)
    ? Math.max(0, stock.currentStock)
    : null;
  let reason = null;
  if (!locationConfigured) {
    reason = "ecommerce-location-not-configured";
  } else {
    try {
      price = authoritativeUnitPrice(product, stock, {
        webPriceOverride: settings.priceOverride,
        promotion,
      });
      vatRate = authoritativeVatRate(product);
      if (settings.enabled === false) reason = "ecommerce-product-disabled";
      else if (stockQuantity <= 0) reason = "out-of-stock";
    } catch (error) {
      reason = error?.code || "ecommerce-product-not-ready";
      try {
        price = authoritativeUnitPrice(product, stock, {
          webPriceOverride: settings.priceOverride,
        });
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
    // The API communicates availability without publishing physical quantities.
    stock: null,
    stockState:
      settings.enabled === false
        ? "out"
        : stockQuantity == null
        ? "unknown"
        : stockQuantity > 0
          ? "available"
          : "out",
    active: product.active !== false && product.deleted !== true && settings.enabled !== false,
    promotionName: promotion?.active === true ? promotion.name : null,
    compareAtPrice: promotion?.active === true
      ? (() => { try { return authoritativeUnitPrice(product, stock, { webPriceOverride: settings.priceOverride }); } catch { return null; } })()
      : null,
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

const stockCollectionPath = (origin) => `${origin.type === "warehouse" ? "warehouseStock" : "locationStock"}/${origin.id}/items`;

async function configuredWebOrigins(channel, { env, getDocument }) {
  if (channel) {
    const requested = channel.authorizedOrigins?.length
      ? channel.authorizedOrigins
      : [channel.defaultOrigin].filter(Boolean);
    if (!requested.length)
      throw commerceError("ecommerce-location-not-configured", "Configurá al menos un local o depósito para abastecer la web.", 409);
    const origins = await Promise.all(requested.map((origin) => resolveChannelOrigin(channel, origin, { env, getDocument })));
    const unique = new Map(origins.map((origin) => [`${origin.type}:${origin.id}`, origin]));
    return [...unique.values()].sort((a, b) => (a.type === channel.defaultOrigin?.type && a.id === channel.defaultOrigin?.id ? -1 : b.type === channel.defaultOrigin?.type && b.id === channel.defaultOrigin?.id ? 1 : 0));
  }
  const locationId = ecommerceLocationId(env);
  if (!locationId) return [];
  const origin = { type: "location", id: locationId };
  const snapshot = await getDocument(`locations/${locationId}`, { env });
  if (!snapshot || snapshot.data?.deleted === true || snapshot.data?.active === false)
    throw commerceError("ecommerce-location-unavailable", "La ubicación Ecommerce no está disponible.", 409);
  if ((snapshot.data.type || "store") !== "store")
    throw commerceError("ecommerce-location-type-not-allowed", "La página web sólo puede tomar stock de locales activos; las ferias y eventos quedan excluidos.", 409);
  return [{ ...origin, name: snapshot.data?.name || "Ecommerce" }];
}

function stockAvailability(stock, now) {
  if (!stock || stock.active === false || stock.deleted === true || stock.productDeleted === true) return 0;
  return Math.max(0, Number(stock.currentStock || 0) - reservedStockQuantity(stock, now));
}

function allocateStock(quantity, sourceRows, productName) {
  let remaining = quantity;
  const allocations = [];
  for (const row of sourceRows) {
    const take = Math.min(remaining, row.available);
    if (take > 0) allocations.push({ ...row.origin, quantity: take });
    remaining -= take;
    if (!remaining) break;
  }
  if (remaining > 0)
    throw commerceError("ecommerce-stock-insufficient", `No hay stock suficiente de ${productName || "uno de los productos"}.`, 409);
  return allocations;
}

function publicEcommerceOrder(orderId, order = {}) {
  const { items = [], ...safeOrder } = order;
  return {
    ...safeOrder,
    id: orderId,
    items: items.map(({ stockAllocations, ...item }) => item),
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
      order: publicEcommerceOrder(orderId, existing.data),
    };
  }
  const channel = await loadWebChannel({ env, getDocument });
  if (channel && !accessHash)
    throw commerceError(
      "ecommerce-access-token-required",
      "No se pudo crear el acceso privado al pedido.",
      400,
    );
  const origins = await configuredWebOrigins(channel, { env, getDocument });
  const origin = origins[0];
  if (!origin)
    throw commerceError(
      "ecommerce-location-not-configured",
      "Falta configurar los orígenes de stock web.",
      409,
    );
  const productsById = {},
    stocksById = {},
    ecommerceSettingsById = {},
    promotionsByProductId = {},
    sourceSnapshotsByProduct = {};
  for (const item of requestedItems) {
    const [product, setting, promotion, ...sourceSnapshots] = await Promise.all([
      getDocument(`products/${item.productId}`, { env }),
      getDocument(`ecommerceProductSettings/${item.productId}`, { env }),
      getDocument(`ecommercePromotions/${item.productId}`, { env }),
      ...origins.map((source) => getDocument(originStockPath(source, item.productId), { env })),
    ]);
    if (product)
      productsById[item.productId] = { ...product.data, id: item.productId };
    ecommerceSettingsById[item.productId] = setting?.data || {};
    if (promotion?.data) promotionsByProductId[item.productId] = promotion.data;
    const sourceRows = origins.map((source, index) => ({
      origin: source,
      snapshot: sourceSnapshots[index],
      available: stockAvailability(sourceSnapshots[index]?.data, now),
    }));
    const preferredStock = sourceRows.find((row) => row.origin.id === origin.id && row.origin.type === origin.type && row.snapshot?.data && row.snapshot.data.active !== false && row.snapshot.data.deleted !== true && row.snapshot.data.productDeleted !== true)?.snapshot?.data
      || sourceRows.find((row) => row.snapshot?.data && row.snapshot.data.active !== false && row.snapshot.data.deleted !== true)?.snapshot?.data
      || { id: item.productId, priceMode: "default" };
    const floor = Math.max(0, Number(setting?.data?.minimumRemainingStock) || 0);
    stocksById[item.productId] = {
      ...preferredStock,
      id: item.productId,
      currentStock: Math.max(0, sourceRows.reduce((sum, row) => sum + row.available, 0) - floor),
    };
    sourceSnapshotsByProduct[item.productId] = sourceRows;
  }
  const shipping = channel ? channelShipping(shippingRequest, channel) : null;
  const prepared = prepareAuthoritativeCheckout({
    requestedItems,
    productsById,
    stocksById,
    customer,
    shipping: shippingRequest,
    resolvedShipping: shipping,
    ecommerceSettingsById,
    promotionsByProductId,
    env,
  });
  const itemsWithAllocations = prepared.items.map((item) => ({
    ...item,
    stockAllocations: allocateStock(
      item.quantity,
      sourceSnapshotsByProduct[item.productId] || [],
      item.name,
    ),
  }));
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
    items: itemsWithAllocations.map(({ availableStock, ...item }) => item),
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
    for (const item of itemsWithAllocations) {
      for (const allocation of item.stockAllocations) {
        const source = sourceSnapshotsByProduct[item.productId].find((row) => row.origin.type === allocation.type && row.origin.id === allocation.id)?.snapshot;
        if (!source?.data)
          throw commerceError("ecommerce-stock-insufficient", `${item.name}: el origen asignado dejó de tener stock.`, 409);
        operations.push({
          type: "update",
          path: originStockPath(allocation, item.productId),
          currentUpdateTime: source.updateTime,
          data: {
            ...reservationPatch(
              source.data,
              orderId,
              { quantity: allocation.quantity, expiresAt: reservationExpiresAt },
              now,
            ),
            updatedAt: now,
          },
        });
      }
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
  if (operations.length > 450)
    throw commerceError("ecommerce-order-too-large", "El pedido usa demasiados orígenes de stock. Reducí productos u orígenes y volvé a intentar.", 400);
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
          order: publicEcommerceOrder(orderId, raced.data),
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
  return { created: true, idempotent: false, order: publicEcommerceOrder(orderId, order) };
}

export async function loadEcommerceCatalog({
  env = process.env,
  now = new Date(),
  listDocuments = adminListDocuments,
  getDocument = adminGetDocument,
} = {}) {
  const channel = await loadWebChannel({ env, getDocument });
  const origins = await configuredWebOrigins(channel, { env, getDocument });
  const origin = origins[0] || null;
  const locationId = origin?.id || (channel ? "" : ecommerceLocationId(env));
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

  const configuredOrigins = origins.length ? origins : [{ type: "location", id: locationId, name: locationSnapshot.data?.name || "Ecommerce" }];
  const [settingsRows, promotionRows, ...stockRows] = await Promise.all([
    listDocuments("ecommerceProductSettings", { env, pageSize: 500 }),
    listDocuments("ecommercePromotions", { env, pageSize: 500 }),
    ...configuredOrigins.map((source) => listDocuments(stockCollectionPath(source), { env, pageSize: 500 })),
  ]);
  const settingsById = Object.fromEntries(settingsRows.map((row) => [row.productId || row.id, row]));
  const promotionById = Object.fromEntries(promotionRows.map((row) => [row.productId || row.id, row]));
  const stockRowsBySource = configuredOrigins.map((source, index) => ({
    origin: source,
    rows: new Map(stockRows[index].map((row) => [row.id, row])),
  }));
  const computedStocks = products.map((product) => {
    const settings = settingsById[product.id] || {};
    const sources = stockRowsBySource.map(({ origin: source, rows }) => {
      const stock = rows.get(product.id);
      return { origin: source, stock, available: stockAvailability(stock, now) };
    });
    const preferred = sources.find((row) => row.origin.id === origin?.id && row.origin.type === origin?.type && row.stock && row.stock.active !== false && row.stock.deleted !== true && row.stock.productDeleted !== true)
      || sources.find((row) => row.stock && row.stock.active !== false && row.stock.deleted !== true)
      || null;
    const pricingStock = {
      ...(preferred?.stock || {}),
      id: product.id,
      priceMode: preferred?.stock?.priceMode || "default",
      currentStock: Math.max(0, sources.reduce((sum, row) => sum + row.available, 0) - Math.max(0, Number(settings.minimumRemainingStock) || 0)),
    };
    return { pricingStock, settings, promotion: promotionById[product.id] || null };
  });

  return {
    ready: true,
    pending: channel
      ? []
      : ecommercePickupEnabled(env)
        ? ["DELIVERY_PRICING"]
        : ["PICKUP_CONFIGURATION", "DELIVERY_PRICING"],
    location: {
      id: locationId,
      name: configuredOrigins.length > 1
        ? "Locales y depósitos configurados"
        : locationSnapshot.data?.name || "Ecommerce",
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
    products: products.map((product, index) => publicProduct(product, computedStocks[index].pricingStock, {
      locationConfigured: true,
      settings: computedStocks[index].settings,
      promotion: computedStocks[index].promotion,
    })),
  };
}
