import {
  adminCommitDocuments,
  adminGetDocument,
  adminListDocuments,
} from "../firestoreAdminRest.mjs";
import {
  authoritativeUnitPrice,
  authoritativeVatRate,
  commerceError,
  ecommerceLocationId,
  ecommercePickupEnabled,
  normalizeCheckoutItems,
  normalizeEcommerceRequestId,
  prepareAuthoritativeCheckout,
} from "./commerceDomain.mjs";

const docsById = (documents = []) => Object.fromEntries(
  documents.map((document) => [document.id, document]),
);

function slugFrom(value, fallback) {
  const normalized = String(value || "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
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
      try { price = authoritativeUnitPrice(product, stock); } catch {}
      try { vatRate = authoritativeVatRate(product); } catch {}
    }
  }

  return {
    id: product.id,
    editorialId: String(product.ecommerceEditorialId || product.editorialId || "").trim() || null,
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
    stockState: stockQuantity == null ? "unknown" : stockQuantity > 0 ? "available" : "out",
    active: product.active !== false && product.deleted !== true,
    arcaVatRate: vatRate,
    commercialReady: !reason && Number.isInteger(price) && price > 0 && Number.isInteger(stockQuantity) && stockQuantity > 0,
    pendingReason: reason,
    dataStatus: !reason ? "ready" : "pending",
  };
}

export async function loadEcommerceCatalog({
  env = process.env,
  listDocuments = adminListDocuments,
  getDocument = adminGetDocument,
} = {}) {
  const locationId = ecommerceLocationId(env);
  const products = (await listDocuments("products", { env, pageSize: 500 }))
    .filter((product) => product.deleted !== true && product.active !== false)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"));

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
      products: products.map((product) => publicProduct(product, null, { locationConfigured: false })),
    };
  }

  const locationSnapshot = await getDocument(`locations/${locationId}`, { env });
  if (!locationSnapshot || locationSnapshot.data?.deleted === true || locationSnapshot.data?.active === false) {
    throw commerceError("ecommerce-location-unavailable", "La ubicación Ecommerce no está disponible.", 409);
  }

  const stocks = await Promise.all(products.map(async (product) => {
    const stockSnapshot = await getDocument(`locationStock/${locationId}/items/${product.id}`, { env });
    return stockSnapshot ? { id: stockSnapshot.path?.split("/").at(-1) || product.id, ...stockSnapshot.data } : null;
  }));

  return {
    ready: true,
    pending: ecommercePickupEnabled(env) ? ["DELIVERY_PRICING"] : ["PICKUP_CONFIGURATION", "DELIVERY_PRICING"],
    location: {
      id: locationId,
      name: locationSnapshot.data?.name || "Ecommerce",
    },
    config: {
      pickupEnabled: ecommercePickupEnabled(env),
      deliveryEnabled: false,
      paymentProvider: "pending_payway",
    },
    products: products.map((product, index) =>
      publicProduct(product, stocks[index], { locationConfigured: true })),
  };
}

function deterministicIds(requestId) {
  return {
    orderId: `ecommerce_order_${requestId}`,
    paymentId: `ecommerce_payment_${requestId}`,
    saleId: `ecommerce_sale_${requestId}`,
  };
}

function saleCodeFor(requestId) {
  return `WEB-${requestId.slice(0, 24).toUpperCase()}`;
}

export async function createEcommerceOrder({
  body,
  env = process.env,
  now = new Date(),
  getDocument = adminGetDocument,
  commitDocuments = adminCommitDocuments,
} = {}) {
  const requestId = normalizeEcommerceRequestId(body?.requestId);
  const ids = deterministicIds(requestId);
  const existing = await getDocument(`orders/${ids.orderId}`, { env });
  if (existing) {
    return {
      created: false,
      idempotent: true,
      order: { id: ids.orderId, ...existing.data },
    };
  }

  const locationId = ecommerceLocationId(env);
  if (!locationId) {
    throw commerceError(
      "ecommerce-location-not-configured",
      "La ubicación de stock Ecommerce está PENDIENTE DE DEFINIR.",
      409,
    );
  }
  const locationSnapshot = await getDocument(`locations/${locationId}`, { env });
  if (!locationSnapshot || locationSnapshot.data?.deleted === true || locationSnapshot.data?.active === false) {
    throw commerceError("ecommerce-location-unavailable", "La ubicación Ecommerce no está disponible.", 409);
  }

  const requestedItems = normalizeCheckoutItems(body?.items);
  const uniqueProductIds = [...new Set(requestedItems.map((item) => item.productId))];
  const productEntries = await Promise.all(uniqueProductIds.map(async (productId) => {
    const [productSnapshot, stockSnapshot] = await Promise.all([
      getDocument(`products/${productId}`, { env }),
      getDocument(`locationStock/${locationId}/items/${productId}`, { env }),
    ]);
    return [
      productId,
      productSnapshot ? { id: productId, ...productSnapshot.data } : null,
      stockSnapshot ? {
        id: productId,
        ...stockSnapshot.data,
        __updateTime: stockSnapshot.updateTime || null,
      } : null,
    ];
  }));
  const productsById = {};
  const stocksById = {};
  for (const [productId, product, stock] of productEntries) {
    if (product) productsById[productId] = product;
    if (stock) stocksById[productId] = stock;
  }

  const prepared = prepareAuthoritativeCheckout({
    requestedItems,
    productsById,
    stocksById,
    customer: body?.customer,
    shipping: {
      method: body?.deliveryMethod || body?.shipping?.method,
      notes: body?.notes || body?.shipping?.notes,
    },
    paymentMode: body?.paymentMode || "pending",
    env,
  });

  const timestamp = now instanceof Date ? now : new Date(now);
  const orderStatus = prepared.stockCommitRequired ? "confirmed" : "pending_payment";
  const paymentProvider = prepared.paymentStatus === "simulated_approved" ? "local_simulation" : "payway_pending";
  const saleId = prepared.stockCommitRequired ? ids.saleId : null;

  const order = {
    schemaVersion: 1,
    sourceType: "ecommerce",
    requestId,
    status: orderStatus,
    locationId,
    locationName: locationSnapshot.data?.name || "Ecommerce",
    customer: prepared.customer,
    items: prepared.items.map(({ availableStock: _availableStock, ...item }) => item),
    subtotal: prepared.subtotal,
    discountTotal: prepared.discountTotal,
    shipping: prepared.shipping,
    shippingAmount: prepared.shippingAmount,
    total: prepared.total,
    paymentId: ids.paymentId,
    paymentStatus: prepared.paymentStatus,
    saleId,
    invoiceId: null,
    invoiceStatus: "not_requested",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const payment = {
    schemaVersion: 1,
    sourceType: "ecommerce",
    orderId: ids.orderId,
    saleId,
    provider: paymentProvider,
    status: prepared.paymentStatus,
    amount: prepared.total,
    currency: "ARS",
    providerTransactionId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const operations = [
    { type: "create", path: `orders/${ids.orderId}`, data: order },
    { type: "create", path: `payments/${ids.paymentId}`, data: payment },
  ];

  if (prepared.stockCommitRequired) {
    const sale = {
      schemaVersion: 1,
      sourceType: "ecommerce",
      sourceChannel: "ecommerce",
      orderId: ids.orderId,
      locationId,
      locationName: locationSnapshot.data?.name || "Ecommerce",
      sellerId: null,
      sellerName: "Ecommerce",
      customerId: null,
      customerNameSnapshot: prepared.customer.fullName,
      customerPhoneSnapshot: prepared.customer.phone,
      customerEmailSnapshot: prepared.customer.email,
      items: order.items.map((item) => ({
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
      totalItems: order.items.reduce((sum, item) => sum + item.quantity, 0),
      total: prepared.total,
      paymentMethod: "ecommerce",
      paymentMethodLabel: "Ecommerce",
      payments: [{ method: "ecommerce", amount: prepared.total }],
      paymentStatus: prepared.paymentStatus,
      invoiceStatus: "not_requested",
      status: "active",
      saleCode: saleCodeFor(requestId),
      deliveryMethod: prepared.shipping.method,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    operations.push({ type: "create", path: `sales/${ids.saleId}`, data: sale });

    for (const item of prepared.items) {
      const stock = stocksById[item.productId];
      const newStock = item.availableStock - item.quantity;
      const safeProductId = item.productId.replace(/[^A-Za-z0-9_-]/g, "_");
      const movementId = `ecommerce_${requestId}_${safeProductId}`;
      operations.push({
        type: "update",
        path: `locationStock/${locationId}/items/${item.productId}`,
        data: {
          currentStock: newStock,
          lastSaleId: ids.saleId,
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
          orderId: ids.orderId,
          saleId: ids.saleId,
          locationId,
          locationName: locationSnapshot.data?.name || "Ecommerce",
          productId: item.productId,
          productName: item.name,
          type: "sale",
          qty: -item.quantity,
          previousStock: item.availableStock,
          newStock,
          reason: `Venta Ecommerce ${sale.saleCode}`,
          userId: "ecommerce-backend",
          userName: "Ecommerce",
          createdAt: timestamp,
        },
      });
    }
  }

  try {
    await commitDocuments(operations, { env });
  } catch (error) {
    if (error?.code === "firebase-admin-already-exists") {
      const existingAfterRace = await getDocument(`orders/${ids.orderId}`, { env });
      if (existingAfterRace) {
        return {
          created: false,
          idempotent: true,
          order: { id: ids.orderId, ...existingAfterRace.data },
        };
      }
    }
    if (error?.code === "firebase-admin-precondition-failed") {
      throw commerceError("ecommerce-order-conflict", "El stock cambió durante la operación. Volvé a intentarlo.", 409);
    }
    throw error;
  }

  return {
    created: true,
    idempotent: false,
    order: { id: ids.orderId, ...order },
  };
}
