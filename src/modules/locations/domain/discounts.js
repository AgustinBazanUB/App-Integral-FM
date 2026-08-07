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

export function calculateDiscountSummary(discounts, subtotal) {
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

  const discountTotal = fixedDiscountTotal + percentageDiscountTotal;
  return {
    discounts: cleaned,
    fixedDiscountTotal,
    percentageDiscountTotal,
    discountTotal,
    totalBeforeDiscounts,
    total: Math.max(0, totalBeforeDiscounts - discountTotal),
  };
}

export function saleDiscountList(sale) {
  if (Array.isArray(sale?.discounts)) return sale.discounts.filter(Boolean);
  return sale?.discount ? [sale.discount] : [];
}

export function storedDiscountTotal(sale) {
  const stored = Number(sale?.discountTotal);
  if (Number.isFinite(stored) && stored >= 0) return stored;
  return saleDiscountList(sale).reduce(
    (sum, discount) => sum + Math.max(0, Number(discount.amountApplied || 0)),
    0,
  );
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
  return {
    fixedDiscountTotal,
    percentageDiscountTotal,
    discountTotal: fixedDiscountTotal + percentageDiscountTotal,
  };
}
