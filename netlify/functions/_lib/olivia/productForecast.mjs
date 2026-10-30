import { analyticsPeriod, readSales, panelMetricsSummary } from "./analytics.mjs";
import { argentinaDateKey } from "../../../../src/modules/locations/domain/time.js";
import { safeId, oliviaError } from "../../../../src/shared/oliviaContracts.mjs";

export async function forecastProductDemand({ store, args, now = new Date() }) {
  if (!args.productId) return { state: "DATOS_INCOMPLETOS", data: { message: "¿Qué producto y presentación querés estimar?" } };
  const productId = safeId(args.productId, "producto");
  const product = await store.get(`products/${productId}`);
  if (!product || product.deleted) throw oliviaError("product-unavailable", "No encontré esa presentación en el catálogo.", 404);
  if (!args.startDate || !args.endDate || !args.forecastDays) return { state: "DATOS_INCOMPLETOS", data: { message: "¿Qué período usamos como base y para cuántos días querés la estimación?" } };
  const period = analyticsPeriod(args, now);
  if (args.endDate > argentinaDateKey(now)) throw oliviaError("invalid-period", "El período de referencia debe corresponder a datos ya registrados.");
  const result = await readSales({ store, args: { ...args, productId }, now });
  const summary = panelMetricsSummary(result.sales, period, { productId });
  const units = summary.products.find((item) => item.productId === productId)?.units || 0;
  const days = Math.round((period.end - period.start) / 86400000), dailyRate = units / days;
  const central = units > 0 ? Math.round(dailyRate * args.forecastDays) : null;
  return { data: {
    source: "Ventas registradas · cálculos compartidos con Métricas generales",
    productId, productName: product.name, locationId: args.locationId || null, period: result.period,
    historicalUnits: units, baseCalendarDays: days, dailyUnits: dailyRate, forecastDays: args.forecastDays,
    scenarios: central == null ? null : { conservative: Math.floor(dailyRate * args.forecastDays * 0.8), central, optimistic: Math.ceil(dailyRate * args.forecastDays * 1.2) },
    formula: "unidades del producto / días calendario del período base × días del horizonte",
    scenarioBasis: "Sensibilidad de planificación de −20% y +20%; no es un intervalo de confianza estadístico ni una tendencia medida.",
    evidence: units > 0 ? result.partial ? "limited" : "recorded-sales-baseline" : "insufficient",
    limitations: ["No corrige días cerrados ni quiebres de stock: las ventas observadas no miden toda la demanda.", "Supone igual ritmo diario; no aplica crecimiento, campañas ni estacionalidad sin evidencia adicional.", ...(units ? [] : ["Sin unidades vendidas registradas no hay base para cuantificar una venta futura."]), ...(result.partial ? ["La lectura histórica llegó al límite: la estimación usa una muestra incompleta."] : [])],
    partial: result.partial, fetched: result.fetched, limit: result.limit, observedAt: now.toISOString(),
  } };
}
