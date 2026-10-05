import { argentinaDateFromKey, argentinaDateKey } from "../../../../src/modules/locations/domain/time.js";
import { oliviaError } from "../../../../src/shared/oliviaContracts.mjs";
import { calculateMetrics, buildMetricsCustomRange } from "../../../../src/modules/locations/domain/metrics.js";
import { saleDate } from "../../../../src/modules/locations/domain/saleFacts.js";

// The assistant and Metrics panel share the same commercial calculations.
// Keep the compact tool contract, including cancelled sales outside revenue.
export function panelMetricsSummary(rows, period, args = {}) {
  const panel = calculateMetrics(rows, buildMetricsCustomRange(period.startKey, period.endKey), args.productId ? { productId: args.productId } : {});
  const groups = (items) => items.map((item) => ({ id: item.key, name: item.name, amount: item.total }));
  const daily = new Map();
  for (const sale of panel.active) {
    const date = saleDate(sale);
    if (date) {
      const day = argentinaDateKey(date);
      daily.set(day, (daily.get(day) || 0) + Number(sale.total || 0));
    }
  }
  return {
    source: "Panel de Métricas generales · cálculos compartidos",
    count: panel.salesCount, total: panel.total, averageTicket: panel.salesCount ? panel.ticket : null, units: panel.totalItems,
    products: panel.byProduct.map((item) => ({ productId: item.key, name: item.name, units: item.items, revenue: item.total, mix: panel.totalItems ? item.items / panel.totalItems : 0 })),
    locations: groups(panel.byLocation), sellers: groups(panel.bySeller), payments: groups(panel.byPayment),
    channels: groups(panel.byChannel), stockOrigins: groups(panel.byStockOrigin),
    promotions: panel.byDiscount.map((item) => ({ id: item.key, name: item.name, amount: item.salesTotal, discount: item.total })),
    daily: [...daily].map(([id, amount]) => ({ id, amount })),
    discounts: { total: panel.discountTotal, sales: panel.discountedSales },
    cancelled: { count: panel.cancelled.length, total: panel.cancelledTotal },
    attribution: "La facturación asociada a promociones no mide causalidad ni ganancia incremental.",
  };
}
export function analyticsPeriod(args = {}, now = new Date()) {
  const startKey = args.startDate || argentinaDateKey(new Date(now.getTime() - 30 * 86400000));
  const endKey = args.endDate || argentinaDateKey(now);
  let start, end;
  try { start = argentinaDateFromKey(startKey); end = new Date(argentinaDateFromKey(endKey).getTime() + 86400000); } catch { throw oliviaError("invalid-period", "Indicá un período válido."); }
  if (end <= start || end - start > 366 * 86400000) throw oliviaError("invalid-period", "El período debe ser de hasta un año.");
  return { start, end, startKey, endKey };
}
export async function readSales({ store, args = {}, now = new Date(), maxPages = 10 }) {
  const period = analyticsPeriod(args, now), sales = [];
  let after, partial = false;
  const filters = [["createdAt", "GREATER_THAN_OR_EQUAL", period.start], ["createdAt", "LESS_THAN", period.end]];
  if (args.locationId) filters.push(["locationId", "EQUAL", args.locationId]);
  if (args.sellerId) filters.push(["sellerId", "EQUAL", args.sellerId]);
  for (let page = 0; page < maxPages; page++) {
    const rows = await store.query("sales", filters, 150, [["createdAt", "DESCENDING"], ["__name__", "DESCENDING"]], after ? { after } : {});
    sales.push(...rows);
    if (rows.length < 150) { partial = false; break; }
    partial = true; after = { id: rows.at(-1).id, createdAt: rows.at(-1).createdAt };
  }
  const scoped = args.productId ? sales.filter((sale) => (sale.items || []).some((item) => (item.productId || item.id) === args.productId)) : sales;
  return { sales: scoped, partial, fetched: sales.length, limit: 150 * maxPages, period: { start: period.startKey, end: period.endKey }, observedAt: now.toISOString() };
}
export async function salesMetrics({ store, args, now }) {
  const period = analyticsPeriod(args, now), duration = period.end - period.start;
  const previousArgs = { ...args, startDate: argentinaDateKey(new Date(period.start - duration)), endDate: argentinaDateKey(new Date(period.start - 1)) };
  const [current, previous] = await Promise.all([readSales({ store, args, now }), readSales({ store, args: previousArgs, now })]);
  const metrics = panelMetricsSummary(current.sales, period, args), previousMetrics = panelMetricsSummary(previous.sales, analyticsPeriod(previousArgs, now), args);
  const compare = (rows, old) => [...new Set([...rows, ...old].map((row) => row.id))].map((id) => { const row = rows.find((item) => item.id === id) || { id, amount: 0 }; const previous = old.find((item) => item.id === id)?.amount || 0; return { ...row, previous, changePercent: previous ? (row.amount - previous) / previous * 100 : null }; });
  return { ...metrics, period: current.period, previous: { ...previousMetrics, period: previous.period }, changePercent: previousMetrics.total ? (metrics.total - previousMetrics.total) / previousMetrics.total * 100 : null,
    locations: compare(metrics.locations, previousMetrics.locations), sellers: compare(metrics.sellers, previousMetrics.sellers),
    products: [...new Set([...metrics.products, ...previousMetrics.products].map((item) => item.productId))].filter((id) => !args.productId || args.productId === id).map((id) => { const prior = previousMetrics.products.find((old) => old.productId === id), item = metrics.products.find((item) => item.productId === id) || { productId: id, name: prior.name, units: 0, revenue: 0, mix: 0 }; return { ...item, previousUnits: prior?.units || 0, unitsChangePercent: prior?.units ? (item.units - prior.units) / prior.units * 100 : null }; }),
    amountBasis: "Total cobrado por ventas; facturación por producto basada en renglones, antes de descuentos globales y envío.",
    productFilterBasis: args.productId ? "Operaciones que contienen el producto. El total de cada operación puede incluir otros productos; consultá products para sus unidades y renglones." : null,
    partial: current.partial || previous.partial, limit: current.limit, observedAt: now.toISOString() };
}
