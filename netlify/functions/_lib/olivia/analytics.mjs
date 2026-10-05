import { aggregateSales } from "../../../../src/shared/oliviaAnalytics.mjs";
import { argentinaDateFromKey, argentinaDateKey } from "../../../../src/modules/locations/domain/time.js";
import { oliviaError } from "../../../../src/shared/oliviaContracts.mjs";
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
  const metrics = aggregateSales(current.sales), previousMetrics = aggregateSales(previous.sales);
  const compare = (rows, old) => [...new Set([...rows, ...old].map((row) => row.id))].map((id) => { const row = rows.find((item) => item.id === id) || { id, amount: 0 }; const previous = old.find((item) => item.id === id)?.amount || 0; return { ...row, previous, changePercent: previous ? (row.amount - previous) / previous * 100 : null }; });
  return { ...metrics, period: current.period, previous: { ...previousMetrics, period: previous.period }, changePercent: previousMetrics.total ? (metrics.total - previousMetrics.total) / previousMetrics.total * 100 : null,
    locations: compare(metrics.locations, previousMetrics.locations), sellers: compare(metrics.sellers, previousMetrics.sellers),
    products: [...new Set([...metrics.products, ...previousMetrics.products].map((item) => item.productId))].filter((id) => !args.productId || args.productId === id).map((id) => { const prior = previousMetrics.products.find((old) => old.productId === id), item = metrics.products.find((item) => item.productId === id) || { productId: id, name: prior.name, units: 0, revenue: 0, mix: 0 }; return { ...item, previousUnits: prior?.units || 0, unitsChangePercent: prior?.units ? (item.units - prior.units) / prior.units * 100 : null }; }),
    amountBasis: "Total cobrado por ventas; facturación por producto basada en renglones, antes de descuentos globales y envío.",
    productFilterBasis: args.productId ? "Operaciones que contienen el producto. El total de cada operación puede incluir otros productos; consultá products para sus unidades y renglones." : null,
    partial: current.partial || previous.partial, limit: current.limit, observedAt: now.toISOString() };
}
