export const BILLING_SOURCE_TYPES = Object.freeze([
  "seller_sale",
  "admin_quick_sale",
  "ecommerce",
]);

export const INVOICE_STATES = Object.freeze([
  "not_requested",
  "pending",
  "authorizing",
  "authorized",
  "rejected",
  "error",
  "credited",
]);

export const ARCA_VAT_RATE_IDS = Object.freeze({
  "0": 3,
  "10.5": 4,
  "21": 5,
  "27": 6,
});

function moneyCents(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} inválido.`);
  return Math.round((number + Number.EPSILON) * 100);
}

function fromCents(value) {
  return Number((value / 100).toFixed(2));
}

function cleanSourceId(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 180 || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new Error("ID de origen inválido.");
  }
  return normalized;
}

export function invoiceIdFor(sourceType, sourceId) {
  if (!BILLING_SOURCE_TYPES.includes(sourceType)) throw new Error("Origen de facturación inválido.");
  return `invoice_${sourceType}_${cleanSourceId(sourceId)}`;
}

export function normalizeVatRate(value) {
  const numeric = Number(value);
  const key = Number.isInteger(numeric) ? String(numeric) : String(numeric);
  if (!(key in ARCA_VAT_RATE_IDS)) {
    const error = new Error("El producto no tiene una alícuota IVA compatible configurada.");
    error.code = "arca-vat-rate-missing";
    throw error;
  }
  return { rate: numeric, arcaId: ARCA_VAT_RATE_IDS[key] };
}

export function allocateDiscount({ items, discountTotal = 0 }) {
  if (!Array.isArray(items) || !items.length) throw new Error("La venta no tiene ítems.");
  const rows = items.map((item) => {
    const productId = cleanSourceId(item.productId || item.id);
    const qty = Number(item.qty);
    const unitPrice = Number(item.unitPrice ?? item.price);
    if (!Number.isInteger(qty) || qty <= 0) throw new Error("Cantidad de producto inválida.");
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("Precio de producto inválido.");
    const grossCents = moneyCents(item.subtotal ?? unitPrice * qty, "Subtotal");
    return { ...item, productId, qty, unitPrice, grossCents };
  });
  const subtotalCents = rows.reduce((sum, row) => sum + row.grossCents, 0);
  const discountCents = moneyCents(discountTotal, "Descuento");
  if (discountCents > subtotalCents) throw new Error("El descuento supera el subtotal.");

  let allocated = 0;
  return rows.map((row, index) => {
    const share = index === rows.length - 1
      ? discountCents - allocated
      : Math.floor((discountCents * row.grossCents) / Math.max(subtotalCents, 1));
    allocated += share;
    return {
      ...row,
      discountCents: share,
      finalGrossCents: row.grossCents - share,
    };
  });
}

export function buildFiscalAmounts({ items, discountTotal = 0, vatRateByProduct = {} } = {}) {
  const allocated = allocateDiscount({ items, discountTotal });
  const groups = new Map();

  for (const row of allocated) {
    const { rate, arcaId } = normalizeVatRate(vatRateByProduct[row.productId]);
    const netCents = rate === 0
      ? row.finalGrossCents
      : Math.round(row.finalGrossCents / (1 + rate / 100));
    const vatCents = row.finalGrossCents - netCents;
    const group = groups.get(arcaId) || { id: arcaId, baseCents: 0, vatCents: 0 };
    group.baseCents += netCents;
    group.vatCents += vatCents;
    groups.set(arcaId, group);
  }

  const totalCents = allocated.reduce((sum, row) => sum + row.finalGrossCents, 0);
  const netCents = [...groups.values()].reduce((sum, group) => sum + group.baseCents, 0);
  const vatCents = [...groups.values()].reduce((sum, group) => sum + group.vatCents, 0);
  if (netCents + vatCents !== totalCents) throw new Error("Los importes fiscales no cierran con el total.");

  return {
    total: fromCents(totalCents),
    net: fromCents(netCents),
    vat: fromCents(vatCents),
    nonTaxed: 0,
    exempt: 0,
    tributes: 0,
    vatBreakdown: [...groups.values()]
      .sort((a, b) => a.id - b.id)
      .map((group) => ({
        id: group.id,
        base: fromCents(group.baseCents),
        amount: fromCents(group.vatCents),
      })),
  };
}

export function assertSaleMatchesFiscalTotal(sale, fiscal) {
  if (moneyCents(sale?.total, "Total de venta") !== moneyCents(fiscal?.total, "Total fiscal")) {
    const error = new Error("El total fiscal no coincide con la venta confirmada.");
    error.code = "arca-sale-total-mismatch";
    throw error;
  }
  return true;
}
