import { addArgentinaDays, argentinaDateKey, argentinaHour, argentinaParts } from "./time.js";
import { isActiveSale, saleDate, summarizeSales } from "./saleFacts.js";

export function validateHolidays(year, dates) {
  if (!/^20\d\d$/.test(String(year))) throw new Error("Indicá un año válido.");
  const result = [...new Set(dates)].sort();
  if (result.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date) || !date.startsWith(`${year}-`) || Number.isNaN(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date)) throw new Error("Usá fechas reales del año seleccionado (AAAA-MM-DD).");
  return result;
}
export function operatingAverage(sales, range, location = {}, holidays = {}) {
  const facts = summarizeSales(sales.filter(sale => !location.id || sale.locationId === location.id));
  const calendar = location.operatingCalendar || {};
  if (range.period === "year" || range.type === "year") return { denominator: 12, average: facts.total / 12, unit: "mes", note: "Total anual / 12. El tratamiento de años parciales está pendiente." };
  if (range.period === "day" || range.type === "day") {
    if (calendar.overnight) return { denominator: null, average: null, unit: "hora", note: "Distribución de jornada nocturna pendiente de definir." };
    const hours = facts.sales.map(saleDate).filter(Boolean).map(argentinaHour);
    const opening = calendar.openingTime ? Number(calendar.openingTime.slice(0, 2)) : null;
    const closing = calendar.closingTime ? Number(calendar.closingTime.slice(0, 2)) : null;
    if (!hours.length && opening == null) return { denominator: null, average: null, unit: "hora", note: "Sin horario configurado ni ventas para definir bloques." };
    const first = Math.min(...hours, ...(opening != null ? [opening] : []));
    const last = Math.max(...hours, ...(closing != null ? [closing] : []));
    const denominator = last - first + 1;
    return { denominator, average: facts.total / denominator, unit: "hora", note: `Bloques inclusivos ${first}:00–${last}:59; incluye ventas fuera del horario.` };
  }
  if (range.period !== "month" && range.type !== "month") return { denominator: null, average: null, unit: "día", note: "Promedio operativo disponible en día, mes y año." };
  const year = argentinaParts(range.start).year;
  if (!Array.isArray(holidays[String(year)])) return { denominator: null, average: null, unit: "día", note: `Feriados ${year} sin configurar.` };
  const holidayDates = new Set(holidays[String(year)]);
  const soldDates = new Set(facts.sales.filter(isActiveSale).map(saleDate).filter(Boolean).map(argentinaDateKey));
  const eventDates = new Set(calendar.dates || []), weekdays = new Set(calendar.weekdays || []);
  if (!weekdays.size && !eventDates.size) return { denominator: null, average: null, unit: "día", note: "Configurá días de atención o fechas del evento." };
  const calendarKey = value => value?.toDate ? argentinaDateKey(value.toDate()) : value instanceof Date ? argentinaDateKey(value) : String(value || "").slice(0, 10);
  const firstDate = calendarKey(location.scheduleStartAt || location.startDate);
  const lastDate = calendarKey(location.scheduleEndAt || location.endDate);
  let denominator = 0;
  for (let day = range.start; day < range.end; day = addArgentinaDays(day, 1)) {
    const key = argentinaDateKey(day), weekday = day.getUTCDay() || 7;
    const scheduled = eventDates.size ? eventDates.has(key) : weekdays.has(weekday);
    const inWindow = (!/^\d{4}-/.test(firstDate) || key >= firstDate) && (!/^\d{4}-/.test(lastDate) || key <= lastDate);
    if (soldDates.has(key) || (scheduled && inWindow && !holidayDates.has(key))) denominator++;
  }
  return { denominator, average: denominator ? facts.total / denominator : null, unit: "día", note: "Días programados del mes, excluye feriados sin ventas e incluye días con ventas." };
}

export function metricsByCategory(sales, products = [], categories = []) {
  const productMap = new Map(products.map(product => [product.id, product]));
  const names = new Map(categories.map(category => [category.id, category.name]));
  const rows = new Map();
  summarizeSales(sales).sales.forEach(sale => {
    const seen = new Set();
    (sale.items || []).forEach(item => {
      const id = item.categoryId || productMap.get(item.productId)?.categoryId || "unknown";
      const row = rows.get(id) || { id, name: names.get(id) || item.categoryName || productMap.get(item.productId)?.categoryName || (id === "unknown" ? "Sin categoría informada" : id), sales: 0, items: 0, total: 0 };
      const quantity = Number(item.qty ?? item.quantity ?? 0);
      row.items += quantity; row.total += Number(item.subtotal ?? item.total ?? Number(item.unitPrice || item.price || 0) * quantity);
      if (!seen.has(id)) { row.sales++; seen.add(id); }
      rows.set(id, row);
    });
  });
  return [...rows.values()].sort((a, b) => b.total - a.total);
}
