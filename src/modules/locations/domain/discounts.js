function wholeDiscountValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < 0) {
    throw new Error("El descuento debe ser un número entero mayor o igual a cero");
  }
  return number;
}

function normalizedDiscount(discount, index) {
  if (!["fixed", "percent"].includes(discount.type)) {
    throw new Error("El tipo de descuento no es válido");
  }
  const value = wholeDiscountValue(discount.value);
  if (value <= 0) throw new Error("El descuento debe ser mayor a cero");
  if (discount.type === "percent" && value > 100) {
    throw new Error("El porcentaje no puede superar 100");
  }
  const discountId = String(discount.discountId || discount.id || "manual").trim() || "manual";
  const source = discount.source === "manual" || discountId === "manual"
    ? "manual"
    : discount.source === "saved" ? "saved" : "preset";
  const name = String(
    discount.name || (source === "manual" ? "Descuento manual" : "Descuento"),
  ).trim() || "Descuento manual";
  return {
    discountId,
    name,
    type: discount.type,
    value,
    source,
    originalIndex: index,
  };
}

/** @param {{ paymentMethod?: string, roundCashTotal?: boolean }} [options] */
export function calculateDiscountSummary(discounts, subtotal, options = {}) {
  const { paymentMethod, roundCashTotal = false } = options;
  const totalBeforeDiscounts = Number(subtotal);
  if (!Number.isFinite(totalBeforeDiscounts) || totalBeforeDiscounts < 0) {
    throw new Error("El subtotal no es válido");
  }

  const normalized = (Array.isArray(discounts) ? discounts : [])
    .filter(Boolean)
    .map(normalizedDiscount);
  const ordered = [
    ...normalized.filter((discount) => discount.type === "fixed"),
    ...normalized.filter((discount) => discount.type === "percent"),
  ];

  let remainingTotal = totalBeforeDiscounts;
  let fixedDiscountTotal = 0;
  let percentageDiscountTotal = 0;
  const cleaned = ordered.map((discount) => {
    const amountApplied = discount.type === "fixed"
      ? Math.min(discount.value, remainingTotal)
      : Math.min(remainingTotal, Math.round(remainingTotal * discount.value / 100));
    remainingTotal = Math.max(0, remainingTotal - amountApplied);
    if (discount.type === "fixed") fixedDiscountTotal += amountApplied;
    else percentageDiscountTotal += amountApplied;
    return {
      discountId: discount.discountId,
      name: discount.name,
      type: discount.type,
      value: discount.value,
      amountApplied,
      source: discount.source,
    };
  });

  const appliedDiscountTotal = fixedDiscountTotal + percentageDiscountTotal;
  const cashRoundingDiscountTotal = roundCashTotal && paymentMethod === "cash" && appliedDiscountTotal > 0
    ? remainingTotal - Math.floor(remainingTotal / 1000) * 1000
    : 0;
  const discountTotal = appliedDiscountTotal + cashRoundingDiscountTotal;
  return {
    discounts: cleaned,
    fixedDiscountTotal,
    percentageDiscountTotal,
    cashRoundingEnabled: roundCashTotal,
    cashRoundingDiscountTotal,
    discountTotal,
    totalBeforeDiscounts,
    total: Math.max(0, totalBeforeDiscounts - discountTotal),
  };
}

export function saleDiscountList(sale) {
  if (Array.isArray(sale?.discounts)) return sale.discounts.filter(Boolean);
  return sale?.discount ? [sale.discount] : [];
}

export function calculateOperationalDiscountSummary(items, discounts, options) {
  const gross = item => Number(item.subtotal ?? Number(item.unitPrice ?? item.price ?? 0) * item.qty);
  const subtotal = items.reduce((sum, item) => sum + gross(item), 0);
  if (!Number.isSafeInteger(subtotal) || subtotal < 0) throw new Error("El subtotal de la venta supera el límite permitido o es inválido.");
  const giftDiscountTotal = items.reduce((sum, item) => sum + (item.gift === true ? gross(item) : 0), 0);
  const summary = calculateDiscountSummary(discounts, subtotal - giftDiscountTotal, options);
  return { ...summary, totalBeforeDiscounts: subtotal, giftDiscountTotal, discountTotal: summary.discountTotal + giftDiscountTotal };
}

export function requiresFullDiscountPermission(items, summary) {
  return items.some(item => item.gift === true) ||
    summary.discounts.some(discount => discount.type === "percent" && discount.value === 100) ||
    summary.total === 0;
}

// Allocate sale-level discounts over the paid lines in whole currency units.
// The cumulative method reconciles exactly and never over-discounts any line.
export function allocateOperationalSaleItems(items, { giftDiscountTotal = 0, discountTotal = 0, totalBeforeDiscounts }) {
  const base = totalBeforeDiscounts - giftDiscountTotal;
  const sharedDiscount = discountTotal - giftDiscountTotal;
  let grossSoFar = 0;
  let allocated = 0;
  return items.map(item => {
    let lineDiscount = item.gift ? item.subtotal : 0;
    if (!item.gift && base > 0 && sharedDiscount > 0) {
      grossSoFar += item.subtotal;
      const target = Number(BigInt(grossSoFar) * BigInt(sharedDiscount) / BigInt(base));
      lineDiscount = target - allocated;
      allocated = target;
    }
    const netAmount = item.subtotal - lineDiscount;
    return { ...item, lineDiscount, netAmount, bonified: item.gift === true || (item.subtotal > 0 && netAmount === 0) };
  });
}

export function storedDiscountTotal(sale) {
  const stored = Number(sale?.discountTotal);
  if (Number.isFinite(stored) && stored >= 0) return stored;
  return saleDiscountList(sale).reduce(
    (sum, discount) => sum + Math.max(0, Number(discount.amountApplied || 0)),
    0,
  ) + Math.max(0, Number(sale?.cashRoundingDiscountTotal || 0)) + Math.max(0, Number(sale?.giftDiscountTotal || 0));
}

export function storedDiscountTotals(sale) {
  const discounts = saleDiscountList(sale);
  const fixedStored = Number(sale?.fixedDiscountTotal);
  const percentageStored = Number(sale?.percentageDiscountTotal);
  const fixedDiscountTotal = Number.isFinite(fixedStored) && fixedStored >= 0
    ? fixedStored
    : discounts
      .filter((discount) => discount.type === "fixed")
      .reduce((sum, discount) => sum + Math.max(0, Number(discount.amountApplied || 0)), 0);
  const percentageDiscountTotal = Number.isFinite(percentageStored) && percentageStored >= 0
    ? percentageStored
    : discounts
      .filter((discount) => discount.type === "percent")
      .reduce((sum, discount) => sum + Math.max(0, Number(discount.amountApplied || 0)), 0);
  const giftDiscountTotal = Math.max(0, Number(sale?.giftDiscountTotal || 0));
  return {
    fixedDiscountTotal,
    percentageDiscountTotal,
    cashRoundingDiscountTotal: Math.max(0, Number(sale?.cashRoundingDiscountTotal || 0)),
    giftDiscountTotal,
    discountTotal: fixedDiscountTotal + percentageDiscountTotal + giftDiscountTotal + Math.max(0, Number(sale?.cashRoundingDiscountTotal || 0)),
  };
}
