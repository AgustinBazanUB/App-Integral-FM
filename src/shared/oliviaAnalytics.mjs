import { isActiveSale, saleDate, uniqueSales } from "../modules/locations/domain/saleFacts.js";
import { salePaymentParts } from "../modules/locations/domain/payments.js";
import { argentinaDateKey } from "../modules/locations/domain/time.js";
export const commercialSales = (sales) => uniqueSales(sales).filter((sale) => isActiveSale(sale) && !["pending", "draft", "rejected"].includes(sale.status));
const add = (map, key, value) => map.set(key, (map.get(key) || 0) + value);
export function aggregateSales(rows = []) {
  const sales = commercialSales(rows), products = new Map(), locations = new Map(), sellers = new Map(), payments = new Map(), promotions = new Map(), daily = new Map();
  let total = 0, units = 0;
  for (const sale of sales) {
    const revenue = Number(sale.total || 0); total += revenue;
    add(locations, sale.locationId || sale.channel || "Sin ubicación", revenue);
    add(sellers, sale.sellerId || sale.createdBy || "Sin vendedor", revenue);
    if (saleDate(sale)) add(daily, argentinaDateKey(saleDate(sale)), revenue);
    for (const part of salePaymentParts(sale)) add(payments, part.method, Number(part.amount || 0));
    for (const promo of sale.discounts || sale.appliedDiscounts || []) add(promotions, promo.id || promo.discountId || promo.name || "Sin identificar", revenue);
    for (const item of sale.items || []) {
      const quantity = Number(item.qty ?? item.quantity ?? 0), id = item.productId || item.id;
      if (!id || !Number.isFinite(quantity)) continue;
      units += quantity;
      const existing = products.get(id) || { productId: id, name: item.name || item.productName || id, units: 0, revenue: 0 };
      existing.units += quantity; existing.revenue += Number(item.total ?? Number(item.unitPrice ?? item.price ?? 0) * quantity);
      products.set(id, existing);
    }
  }
  const groups = (map) => [...map].map(([id, amount]) => ({ id, amount })).sort((a, b) => b.amount - a.amount);
  return { count: sales.length, total, averageTicket: sales.length ? total / sales.length : null, units,
    products: [...products.values()].map((item) => ({ ...item, mix: units ? item.units / units : 0 })).sort((a, b) => b.revenue - a.revenue),
    locations: groups(locations), sellers: groups(sellers), payments: groups(payments), promotions: groups(promotions), daily: groups(daily),
    attribution: "La facturación asociada a promociones no mide causalidad ni ganancia incremental." };
}
const round = (value) => Math.round(value * 100) / 100;
const stockCeiling = (value) => Math.ceil(value - Number.EPSILON * Math.max(1, Math.abs(value)) * 8);
const weekday = (key) => new Date(`${key}T12:00:00-03:00`).getUTCDay() || 7;
function operatingHours(location) {
  const { openingTime, closingTime } = location?.operatingCalendar || {};
  if (![openingTime, closingTime].every((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time || ""))) return null;
  const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const span = (minutes(closingTime) - minutes(openingTime) + 1440) % 1440;
  return span ? span / 60 : null;
}
export function fairForecast({ sales = [], location, comparableLocations = [], startDate, days = 2, safetyStockPercent = 20, observedAt = new Date(), partial = false }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || "") || !Number.isInteger(days) || days < 1 || days > 14 || !Number.isFinite(safetyStockPercent) || safetyStockPercent < 0 || safetyStockPercent > 100) throw new Error("Indicá fecha real, de 1 a 14 días y buffer entre 0 y 100.");
  const begin = new Date(`${startDate}T12:00:00-03:00`);
  if (Number.isNaN(begin.getTime()) || argentinaDateKey(begin) !== startDate) throw new Error("La fecha no es válida.");
  const allowed = new Set([location.id, ...comparableLocations.map((item) => item.id)]), grouped = new Map();
  const targetHours = operatingHours(location), locationsById = new Map([location, ...comparableLocations].map((item) => [item.id, item]));
  for (const sale of commercialSales(sales)) {
    const date = saleDate(sale);
    if (!date || date >= begin || !allowed.has(sale.locationId)) continue;
    const day = argentinaDateKey(date), key = `${sale.locationId}:${day}`;
    if (!grouped.has(key)) grouped.set(key, { locationId: sale.locationId, day, sales: [] });
    grouped.get(key).sales.push(sale);
  }
  const rows = [...grouped.values()].map((day) => ({ ...day, metrics: aggregateSales(day.sales) }));
  const own = rows.filter((row) => row.locationId === location.id);
  const source = rows;
  if (!source.length) return { kind: "estimate", method: "heuristic-v1", insufficientData: true, confidence: "muy baja", scenarios: null, daily: [], products: [], evidence: { saleCount: 0, sampleDays: 0, partial }, message: "No hay ventas históricas comparables. No se puede calcular un pronóstico numérico sin inventar datos.", safetyStockPercent };
  const projected = [], productTotals = new Map();
  const recentOwn = own.sort((a, b) => b.day.localeCompare(a.day));
  const recent = recentOwn.slice(0, 4), previous = recentOwn.slice(4, 8);
  const average = (items) => items.reduce((sum, row) => sum + row.metrics.total, 0) / Math.max(1, items.length);
  const trend = previous.length >= 2 && average(previous) > 0 ? Math.max(0.75, Math.min(1.25, average(recent) / average(previous))) : 1;
  let totalExpected = 0, totalOperations = 0;
  for (let index = 0; index < days; index++) {
    const dayDate = new Date(begin.getTime() + index * 86400000), day = argentinaDateKey(dayDate), wd = weekday(day);
    const explicitDates = location.operatingCalendar?.dates || [], weekDays = location.operatingCalendar?.weekdays || [];
    const closed = explicitDates.length ? !explicitDates.includes(day) : weekDays.length ? !weekDays.includes(wd) : false;
    const sample = source.map((row) => {
      const ageDays = Math.max(0, (observedAt.getTime() - new Date(`${row.day}T12:00:00-03:00`).getTime()) / 86400000);
      const historicalHours = operatingHours(locationsById.get(row.locationId));
      return { ...row, durationFactor: targetHours && historicalHours ? targetHours / historicalHours : 1, weight: (row.locationId === location.id ? 1 : 0.35) * (weekday(row.day) === wd ? 1 : 0.3) * Math.exp(-ageDays / 90) };
    });
    const weight = sample.reduce((sum, row) => sum + row.weight, 0);
    const expected = closed ? 0 : sample.reduce((sum, row) => sum + row.metrics.total * row.durationFactor * row.weight, 0) / weight * trend;
    const operations = closed ? 0 : sample.reduce((sum, row) => sum + row.metrics.count * row.durationFactor * row.weight, 0) / weight * trend;
    const variance = sample.reduce((sum, row) => sum + row.weight * (row.metrics.total * row.durationFactor * trend - expected) ** 2, 0) / weight;
    const spread = Math.max(expected * (source.length < 5 || partial ? 0.5 : 0.2), Math.sqrt(variance));
    projected.push({ date: day, weekday: wd, closedByCalendar: closed, conservative: round(Math.max(0, expected - spread)), expected: round(expected), high: round(closed ? 0 : expected + spread), expectedOperations: round(operations) });
    totalExpected += expected; totalOperations += operations;
    if (!closed) for (const row of sample) for (const item of row.metrics.products) {
      const current = productTotals.get(item.productId) || { productId: item.productId, name: item.name, expectedUnits: 0 };
      current.expectedUnits += item.units * row.durationFactor * row.weight / weight * trend;
      productTotals.set(item.productId, current);
    }
  }
  const totalUnits = [...productTotals.values()].reduce((sum, item) => sum + item.expectedUnits, 0);
  const products = [...productTotals.values()].map((item) => ({ ...item, expectedUnits: round(item.expectedUnits), mix: totalUnits ? item.expectedUnits / totalUnits : 0, recommendedStock: stockCeiling(item.expectedUnits * (1 + safetyStockPercent / 100)) }));
  return { kind: "estimate", method: "heuristic-v1", insufficientData: source.length < 3, confidence: partial || own.length < 3 ? "baja" : own.length >= 12 ? "media" : "baja",
    locationId: location.id, locationName: location.name, startDate, days, daily: projected,
    scenarios: { conservative: round(projected.reduce((sum, day) => sum + day.conservative, 0)), expected: round(totalExpected), high: round(projected.reduce((sum, day) => sum + day.high, 0)) },
    expectedOperations: round(totalOperations), expectedTicket: totalOperations ? round(totalExpected / totalOperations) : null, products, safetyStockPercent,
    evidence: { saleCount: source.reduce((sum, row) => sum + row.metrics.count, 0), sampleDays: source.length, ownDays: own.length, locations: [...allowed], dateRange: [source.map((row) => row.day).sort()[0], source.map((row) => row.day).sort().at(-1)], partial, zeroSalesDaysObserved: false },
    factors: { ownLocationWeight: 1, comparableWeight: 0.35, weekdayWeight: 1, otherWeekdayWeight: 0.3, recencyDecayDays: 90, trend, targetOperatingHours: targetHours, durationScaling: "Solo entre calendarios explícitos; sin horarios se mantiene factor 1." },
    limitations: ["Heurística inicial, no modelo científico.", "Los días sin ventas no se presumen abiertos.", "No incluye clima, afluencia ni eventos externos sin una fuente registrada.", "La confianza máxima inicial es media; muestras truncadas reducen la confianza."],
    recommendation: "Podés preparar una transferencia con estas cantidades; origen y recepción física deben decidirse y confirmarse visualmente." };
}
