// Shared commercial facts. Fiscal documents are deliberately not an input.
const CANCELLED_STATUSES = new Set(["cancelled", "canceled", "deleted", "anulada", "anulado", "cancelada", "cancelado"]);

export function isActiveSale(sale = {}) {
  return sale.deleted !== true && !CANCELLED_STATUSES.has(String(sale.status || "active").toLowerCase());
}

export function saleDate(sale) {
  for (const value of [sale?.createdAt, sale?.date, sale?.createdLocallyAt, sale?.updatedAt]) {
    const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
    if (date && !Number.isNaN(date.valueOf())) return date;
  }
  return null;
}

export function uniqueSales(sales = []) {
  return [...new Map(sales.map((sale, index) => [sale.id || `legacy-${index}`, sale])).values()];
}

export function summarizeSales(sales = []) {
  const active = uniqueSales(sales).filter(isActiveSale);
  const total = active.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  return { sales: active, count: active.length, total, average: active.length ? total / active.length : 0 };
}
