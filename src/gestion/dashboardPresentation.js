import { summarizeSales } from "../modules/locations/domain/dashboard.js";
import { PAYMENT_LABELS, SINGLE_PAYMENT_METHODS, salePaymentParts } from "../modules/locations/domain/payments.js";
import { argentinaHour } from "../modules/locations/domain/time.js";

/** @typedef {{id?: string, total?: number, status?: string, deleted?: boolean, paymentMethod?: string, payments?: Array<{method: string, amount: number}>}} DashboardSale */

export function dashboardGreeting(name = "", now = new Date()) {
  const hour = argentinaHour(now);
  const greeting = hour < 12 ? "Buen día" : hour < 20 ? "Buenas tardes" : "Buenas noches";
  return `${greeting}, ${name.trim().split(/\s+/)[0] || "equipo"}.`;
}

// Los cobros se derivan exclusivamente de ventas; una factura no agrega un ingreso.
/** @param {DashboardSale[]} sales */
export function summarizeDashboardPayments(sales = []) {
  const summary = summarizeSales(sales);
  const rows = SINGLE_PAYMENT_METHODS.map((key) => ({ key, name: PAYMENT_LABELS[/** @type {keyof typeof PAYMENT_LABELS} */ (key)], total: 0 }));
  const byMethod = new Map(rows.map((row) => [row.key, row]));
  let unclassified = 0;
  let inconsistentSales = 0;
  summary.sales.forEach((sale) => {
    const total = Number(sale.total || 0);
    const parts = salePaymentParts(sale);
    let allocated = 0;
    parts.forEach((part) => {
      if (!Number.isFinite(part.amount) || part.amount < 0) return;
      const row = byMethod.get(part.method);
      if (!row) return;
      row.total += part.amount;
      allocated += part.amount;
    });
    if (allocated > total) inconsistentSales += 1;
    unclassified += Math.max(0, total - allocated);
  });
  if (unclassified > 0) rows.push({ key: "unclassified", name: "Sin forma de pago identificada", total: unclassified });
  return {
    rows: rows.map((row) => ({ ...row, percentage: summary.total > 0 ? row.total / summary.total * 100 : 0 })),
    total: summary.total,
    count: summary.count,
    inconsistentSales,
  };
}
