export const INVENTORY_TYPES = Object.freeze({
  LOCATION: "location",
  WAREHOUSE: "warehouse",
});

export const PRICE_MODES = Object.freeze({
  DEFAULT: "default",
  CUSTOM: "custom",
});

export function wholeInventoryQuantity(value, label = "La cantidad", { allowZero = true } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || (!allowZero && number === 0)) {
    throw new Error(`${label} debe ser un número entero ${allowZero ? "mayor o igual a cero" : "mayor a cero"}.`);
  }
  return number;
}

export function normalizeLegacyLocationPrice(stockItem = {}, product = {}) {
  const hasExplicitMode = stockItem.priceMode === PRICE_MODES.DEFAULT || stockItem.priceMode === PRICE_MODES.CUSTOM;
  if (hasExplicitMode) {
    const override = stockItem.priceMode === PRICE_MODES.CUSTOM
      ? Number(stockItem.priceOverride ?? stockItem.price ?? 0)
      : null;
    return {
      priceMode: stockItem.priceMode,
      priceOverride: override,
      usesDefaultPrice: stockItem.priceMode === PRICE_MODES.DEFAULT,
    };
  }

  // Compatibilidad: los registros creados antes de esta normalización guardaban
  // un precio local sin indicar si era copia del maestro o precio especial.
  // Lo tratamos como especial para no cambiar silenciosamente precios reales.
  if (stockItem.price !== undefined && stockItem.price !== null) {
    return {
      priceMode: PRICE_MODES.CUSTOM,
      priceOverride: Number(stockItem.price || 0),
      usesDefaultPrice: false,
      legacyPrice: true,
    };
  }

  return {
    priceMode: PRICE_MODES.DEFAULT,
    priceOverride: null,
    usesDefaultPrice: true,
  };
}

export function effectiveLocationPrice(product = {}, stockItem = {}) {
  const pricing = normalizeLegacyLocationPrice(stockItem, product);
  return pricing.priceMode === PRICE_MODES.CUSTOM
    ? Number(pricing.priceOverride || 0)
    : Number(product.defaultPrice || 0);
}

export function mergeLocationInventoryItem(product = {}, stockItem = {}) {
  const pricing = normalizeLegacyLocationPrice(stockItem, product);
  const effectivePrice = effectiveLocationPrice(product, stockItem);
  return {
    ...stockItem,
    productId: stockItem.productId || product.id,
    productName: product.name || stockItem.productName || "Producto",
    abbreviation: product.abbreviation || stockItem.abbreviation || "",
    categoryId: product.categoryId ?? stockItem.categoryId ?? "",
    categoryName: product.categoryName || stockItem.categoryName || "Sin categoría",
    imageUrl: product.imageUrl || stockItem.imageUrl || "",
    thumbUrl: product.thumbUrl || stockItem.thumbUrl || "",
    masterActive: product.active !== false && product.deleted !== true,
    currentStock: Number(stockItem.currentStock || 0),
    initialStock: Number(stockItem.initialStock || 0),
    defaultPrice: Number(product.defaultPrice || 0),
    priceMode: pricing.priceMode,
    priceOverride: pricing.priceOverride,
    usesDefaultPrice: pricing.usesDefaultPrice,
    legacyPrice: pricing.legacyPrice === true,
    price: effectivePrice,
    effectivePrice,
    active: stockItem.active !== false && stockItem.deleted !== true,
  };
}

export function mergeWarehouseInventoryItem(product = {}, stockItem = {}) {
  // Aunque llegue un registro legacy contaminado con campos de precio, la capa
  // de dominio del depósito nunca los expone ni los propaga.
  const {
    price: _legacyPrice,
    effectivePrice: _legacyEffectivePrice,
    priceOverride: _legacyPriceOverride,
    priceMode: _legacyPriceMode,
    masterDefaultPrice: _legacyMasterDefaultPrice,
    ...priceFreeStock
  } = stockItem;
  return {
    ...priceFreeStock,
    productId: stockItem.productId || product.id,
    productName: product.name || stockItem.productName || "Producto",
    abbreviation: product.abbreviation || stockItem.abbreviation || "",
    categoryId: product.categoryId ?? stockItem.categoryId ?? "",
    categoryName: product.categoryName || stockItem.categoryName || "Sin categoría",
    imageUrl: product.imageUrl || stockItem.imageUrl || "",
    thumbUrl: product.thumbUrl || stockItem.thumbUrl || "",
    masterActive: product.active !== false && product.deleted !== true,
    defaultPrice: Number(product.defaultPrice || 0),
    currentStock: Number(stockItem.currentStock || 0),
    initialStock: Number(stockItem.initialStock || 0),
    active: stockItem.active !== false && stockItem.deleted !== true,
  };
}

export function nextStockAfterAddition(currentStock, quantity) {
  return wholeInventoryQuantity(currentStock, "El stock actual")
    + wholeInventoryQuantity(quantity, "La cantidad a agregar", { allowZero: false });
}

export function validateTransferLine(line = {}, availableStock = 0) {
  const quantity = wholeInventoryQuantity(
    line.quantity,
    `La cantidad de ${line.productName || "este producto"}`,
    { allowZero: false },
  );
  const available = wholeInventoryQuantity(availableStock, "El stock disponible");
  if (quantity > available) {
    throw new Error(
      `No hay suficiente stock de ${line.productName || "este producto"}. Hay ${available} unidades disponibles y estás intentando transferir ${quantity}.`,
    );
  }
  return quantity;
}

export function summarizeTransfer(lines = []) {
  const selected = lines.filter((line) => Number(line.quantity || 0) > 0);
  return {
    productCount: selected.length,
    totalQuantity: selected.reduce((sum, line) => sum + Number(line.quantity || 0), 0),
  };
}

export function movementLabel(movement = {}) {
  const labels = {
    initial: "Ingreso inicial",
    initial_adjustment: "Ajuste de stock inicial",
    add: "Ingreso de mercadería",
    adjustment: "Ajuste de inventario",
    transfer_out: "Transferencia enviada",
    transfer_in: "Transferencia recibida",
    sale: "Venta",
    sale_cancel: "Anulación de venta",
  };
  return labels[movement.type] || movement.reason || "Movimiento de stock";
}
