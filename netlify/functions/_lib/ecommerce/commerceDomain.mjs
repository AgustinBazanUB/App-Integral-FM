const SUPPORTED_VAT_RATES = new Set([0, 10.5, 21, 27]);
export const ECOMMERCE_SOURCE_TYPE = "ecommerce";
export const ECOMMERCE_PAYMENT_STATUSES = Object.freeze([
  "pending",
  "simulated_approved",
  "approved",
  "rejected",
  "cancelled",
]);

export function commerceError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export function ecommerceLocationId(env = process.env) {
  return String(env.ECOMMERCE_LOCATION_ID || "").trim();
}

export function ecommercePickupEnabled(env = process.env) {
  return String(env.ECOMMERCE_PICKUP_ENABLED || "").trim().toLowerCase() === "true";
}

export function ecommerceSimulatedPaymentEnabled(env = process.env) {
  return (
    String(env.ECOMMERCE_LOCAL_TEST_MODE || "").trim().toLowerCase() === "true"
    && String(env.ECOMMERCE_ALLOW_SIMULATED_PAYMENTS || "").trim().toLowerCase() === "true"
  );
}

export function normalizeEcommerceRequestId(value) {
  const normalized = String(value || "").trim().replace(/[^A-Za-z0-9_-]/g, "");
  if (normalized.length < 8 || normalized.length > 96) {
    throw commerceError(
      "ecommerce-request-id-invalid",
      "No se pudo identificar de forma segura el intento de compra.",
      400,
    );
  }
  return normalized;
}

export function normalizeCheckoutItems(items) {
  if (!Array.isArray(items) || !items.length) {
    throw commerceError("ecommerce-cart-empty", "El carrito está vacío.", 400);
  }
  const combined = new Map();
  for (const raw of items) {
    const productId = String(raw?.productId || raw?.id || "").trim();
    if (!productId || productId.includes("/")) {
      throw commerceError("ecommerce-product-id-invalid", "Uno de los productos no es válido.", 400);
    }
    const quantity = Number(raw?.quantity ?? raw?.qty);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw commerceError("ecommerce-quantity-invalid", "Las cantidades deben ser números enteros mayores a cero.", 400);
    }
    if (quantity > 99) {
      throw commerceError("ecommerce-quantity-excessive", "La cantidad solicitada supera el máximo permitido por línea.", 400);
    }
    combined.set(productId, (combined.get(productId) || 0) + quantity);
  }
  const result = [...combined.entries()].map(([productId, quantity]) => {
    if (quantity > 99) {
      throw commerceError("ecommerce-quantity-excessive", "La cantidad solicitada supera el máximo permitido por línea.", 400);
    }
    return { productId, quantity };
  });
  return result;
}

function numberOrNull(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function authoritativeUnitPrice(product = {}, stock = {}) {
  if (!product?.id) {
    throw commerceError("ecommerce-product-not-found", "Uno de los productos ya no existe.", 409);
  }
  if (product.deleted === true) {
    throw commerceError("ecommerce-product-deleted", "Uno de los productos fue eliminado.", 409);
  }
  if (product.active === false) {
    throw commerceError("ecommerce-product-inactive", "Uno de los productos está inactivo.", 409);
  }
  if (!stock?.id) {
    throw commerceError("ecommerce-stock-not-configured", "Uno de los productos no tiene stock Ecommerce configurado.", 409);
  }
  if (stock.deleted === true || stock.active === false || stock.productDeleted === true) {
    throw commerceError("ecommerce-stock-inactive", "Uno de los productos no está habilitado para Ecommerce.", 409);
  }
  if (stock.productId && stock.productId !== product.id) {
    throw commerceError("ecommerce-stock-product-mismatch", "La configuración de stock no coincide con el producto.", 409);
  }

  let price;
  if (stock.priceMode === "custom") {
    price = numberOrNull(stock.priceOverride ?? stock.price);
  } else if (stock.priceMode === "default") {
    price = numberOrNull(product.defaultPrice);
  } else if (stock.price !== undefined && stock.price !== null) {
    // Compatibilidad con relaciones de stock anteriores a priceMode:
    // un precio local existente se considera explícito para no alterarlo silenciosamente.
    price = numberOrNull(stock.price);
  } else {
    price = numberOrNull(product.defaultPrice);
  }

  if (!Number.isInteger(price) || price <= 0) {
    throw commerceError("ecommerce-price-not-configured", "Uno de los productos no tiene un precio comercial válido.", 409);
  }
  return price;
}

export function authoritativeVatRate(product = {}) {
  const rate = numberOrNull(product.arcaVatRate);
  if (rate == null || !SUPPORTED_VAT_RATES.has(rate)) {
    throw commerceError(
      "ecommerce-vat-not-configured",
      "Uno de los productos todavía no tiene su dato fiscal de IVA configurado.",
      409,
    );
  }
  return rate;
}

export function currentStockQuantity(stock = {}) {
  const value = Number(stock.currentStock);
  if (!Number.isInteger(value) || value < 0) {
    throw commerceError("ecommerce-stock-invalid", "El stock comercial tiene un valor inválido.", 409);
  }
  return value;
}

export function normalizeCustomer(raw = {}) {
  const fullName = String(raw.fullName || "").trim().slice(0, 120);
  const email = String(raw.email || "").trim().toLowerCase().slice(0, 180);
  const phone = String(raw.phone || "").trim().slice(0, 60);
  if (!fullName) throw commerceError("ecommerce-customer-name-required", "Ingresá tu nombre y apellido.", 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw commerceError("ecommerce-customer-email-invalid", "Ingresá un email válido.", 400);
  }
  if (phone.replace(/\D/g, "").length < 8) {
    throw commerceError("ecommerce-customer-phone-invalid", "Ingresá un teléfono válido.", 400);
  }
  return {
    fullName,
    email,
    phone,
    marketingConsent: raw.marketingConsent === true,
  };
}

export function resolveShipping(raw = {}, env = process.env) {
  const method = String(raw.method || raw.deliveryMethod || "pickup").trim().toLowerCase();
  if (method === "pickup") {
    if (!ecommercePickupEnabled(env)) {
      throw commerceError(
        "ecommerce-pickup-not-configured",
        "El retiro todavía no está habilitado comercialmente.",
        409,
      );
    }
    return {
      method: "pickup",
      amount: 0,
      status: "configured",
      address: null,
      city: null,
      postalCode: null,
      notes: String(raw.notes || "").trim().slice(0, 500) || null,
    };
  }
  if (method === "delivery") {
    throw commerceError(
      "ecommerce-delivery-not-configured",
      "El costo y las reglas de envío están PENDIENTE DE DEFINIR.",
      409,
    );
  }
  throw commerceError("ecommerce-shipping-method-invalid", "La forma de entrega no es válida.", 400);
}

export function resolveRequestedPaymentStatus(rawMode, env = process.env) {
  const mode = String(rawMode || "pending").trim().toLowerCase();
  if (mode === "pending") return "pending";
  if (mode === "simulate_approved" && ecommerceSimulatedPaymentEnabled(env)) {
    return "simulated_approved";
  }
  if (mode === "simulate_approved") {
    throw commerceError(
      "ecommerce-simulated-payment-disabled",
      "La simulación de pago sólo está disponible en el entorno local de pruebas.",
      409,
    );
  }
  throw commerceError("ecommerce-payment-mode-invalid", "El modo de pago solicitado no es válido.", 400);
}

export function prepareAuthoritativeCheckout({
  requestedItems,
  productsById,
  stocksById,
  customer,
  shipping,
  paymentMode = "pending",
  env = process.env,
} = {}) {
  const items = normalizeCheckoutItems(requestedItems);
  const normalizedCustomer = normalizeCustomer(customer);
  const normalizedShipping = resolveShipping(shipping, env);
  const paymentStatus = resolveRequestedPaymentStatus(paymentMode, env);

  const preparedItems = items.map(({ productId, quantity }) => {
    const product = productsById?.[productId];
    const stock = stocksById?.[productId];
    if (!product) {
      throw commerceError("ecommerce-product-not-found", "Uno de los productos ya no existe.", 409);
    }
    const unitPrice = authoritativeUnitPrice(product, stock);
    const vatRate = authoritativeVatRate(product);
    const availableStock = currentStockQuantity(stock);
    if (quantity > availableStock) {
      throw commerceError(
        "ecommerce-stock-insufficient",
        `No hay stock suficiente de ${product.name || "uno de los productos"}.`,
        409,
      );
    }
    return {
      productId,
      name: product.name || stock.productName || "Producto",
      abbreviation: product.abbreviation || stock.abbreviation || "",
      categoryId: product.categoryId || stock.categoryId || "",
      categoryName: product.categoryName || stock.categoryName || "",
      quantity,
      qty: quantity,
      unitPrice,
      subtotal: unitPrice * quantity,
      arcaVatRate: vatRate,
      availableStock,
    };
  });

  const subtotal = preparedItems.reduce((sum, item) => sum + item.subtotal, 0);
  const discountTotal = 0;
  const shippingAmount = normalizedShipping.amount;
  const total = subtotal - discountTotal + shippingAmount;

  return {
    sourceType: ECOMMERCE_SOURCE_TYPE,
    customer: normalizedCustomer,
    items: preparedItems,
    subtotal,
    discountTotal,
    shipping: normalizedShipping,
    shippingAmount,
    total,
    paymentStatus,
    invoiceStatus: "not_requested",
    stockCommitRequired: paymentStatus === "simulated_approved" || paymentStatus === "approved",
  };
}
