import { saleDiscountList, storedDiscountTotal } from "./discounts.js";
import { salePaymentParts } from "./payments.js";
import {
  addArgentinaDays,
  argentinaDateFromKey,
  argentinaDateKey,
  argentinaMonthKey,
  argentinaMonthRange,
  argentinaParts,
} from "./time.js";

const CANCELLED_STATUSES = new Set(["cancelled", "canceled", "deleted", "anulada", "anulado", "cancelada", "cancelado"]);
const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const DAY_MS = 86_400_000;
const pad = (value) => String(value).padStart(2, "0");

export const currentMetricsValue = (period, date = new Date()) => {
  const parts = argentinaParts(date);
  return period === "day"
    ? `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
    : period === "year"
      ? String(parts.year)
      : argentinaMonthKey(date);
};

export function buildMetricsDateRange(period, value) {
  const type = ["day", "month", "year"].includes(period) ? period : "month";
  const selected = String(value || currentMetricsValue(type));
  const parts = selected.split("-").map(Number);
  const year = parts[0];
  const month = type === "year" ? 1 : parts[1];
  const day = type === "day" ? parts[2] : 1;
  if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new Error("Seleccioná una fecha válida.");
  const monthRange = type === "month" ? argentinaMonthRange(selected) : null;
  const start = type === "day"
    ? argentinaDateFromKey(selected)
    : type === "month"
      ? monthRange.start
      : argentinaDateFromKey(`${year}-01-01`);
  const end = type === "day"
    ? addArgentinaDays(argentinaDateFromKey(`${year}-${pad(month)}-${pad(day)}`), 1)
    : type === "month"
      ? monthRange.end
      : argentinaDateFromKey(`${year + 1}-01-01`);
  return { period: type, value: selected, start, end };
}

export function buildMetricsCustomRange(from, to) {
  if (!from || !to) throw new Error("Elegí las fechas desde y hasta.");
  const start = argentinaDateFromKey(from);
  const end = addArgentinaDays(argentinaDateFromKey(to), 1);
  if (start >= end) throw new Error("La fecha final debe ser igual o posterior a la inicial.");
  return { period: "custom", value: `${from}:${to}`, start, end };
}

export function saleDate(sale) {
  for (const value of [sale?.createdAt, sale?.date, sale?.createdLocallyAt, sale?.updatedAt]) {
    const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
    if (date && !Number.isNaN(date.valueOf())) return date;
  }
  return null;
}

export function isActiveSale(sale) {
  return !CANCELLED_STATUSES.has(String(sale?.status || "active").toLowerCase());
}

const itemMatches = (item, id, name) => !id || item?.productId === id || (!item?.productId && name && item?.name === name);
const discountIdentity = (discount, index = 0) => discount.discountId || discount.id || discount.name || `legacy-${index}`;
const saleDiscountIds = (sale) => saleDiscountList(sale).map(discountIdentity);

export const metricLocations = (locations) => (Array.isArray(locations) ? locations : []).filter((location) => location?.deleted !== true);

export function metricSellersForLocations(locations, users, sales, selectedLocationIds) {
  const locationIds = new Set(selectedLocationIds || []);
  const selectedLocations = metricLocations(locations).filter((location) => locationIds.has(location.id));
  const locationNames = new Set(selectedLocations.map((location) => location.name).filter(Boolean));
  const sellers = (Array.isArray(users) ? users : []).filter((user) => user?.role === "seller" && user.deleted !== true);
  const sellerIds = new Set();
  selectedLocations.forEach((location) => (location.assignedSellerIds || []).forEach((id) => sellerIds.add(id)));
  sellers.forEach((seller) => {
    if ((seller.allowedLocationIds || []).some((id) => locationIds.has(id))) sellerIds.add(seller.id);
  });
  if (!sellerIds.size) {
    (Array.isArray(sales) ? sales : []).forEach((sale) => {
      if ((locationIds.has(sale.locationId) || (!sale.locationId && locationNames.has(sale.locationName))) && sale.sellerId) sellerIds.add(sale.sellerId);
    });
  }
  return sellers.filter((seller) => sellerIds.has(seller.id)).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

const includesAny = (selected, values) => !Array.isArray(selected) || !selected.length || values.some((value) => selected.includes(value));

export function applyMetricsFilters(sales, filters = {}, range) {
  const productIds = Array.isArray(filters.productIds) ? filters.productIds : [];
  const categoryProductIds = Array.isArray(filters.categoryProductIds) ? filters.categoryProductIds : [];
  const effectiveProducts = [...new Set([...productIds, ...categoryProductIds])];
  const discountIds = Array.isArray(filters.discountIds) ? filters.discountIds : [];
  const wantsNoDiscount = discountIds.includes("__none");
  const selectedDiscountIds = discountIds.filter((id) => id !== "__none");

  return (Array.isArray(sales) ? sales : []).filter((sale) => {
    const date = saleDate(sale);
    if (!date || date < range.start || date >= range.end) return false;
    if (!includesAny(filters.locationIds, [sale.locationId, sale.locationName].filter(Boolean))) return false;
    if (!includesAny(filters.sellerIds, [sale.sellerId, sale.sellerName].filter(Boolean))) return false;
    if (effectiveProducts.length && !(sale.items || []).some((item) => effectiveProducts.includes(item.productId))) return false;
    if (filters.productId && !(sale.items || []).some((item) => itemMatches(item, filters.productId, filters.productName))) return false;

    if (discountIds.length) {
      const totalDiscount = storedDiscountTotal(sale);
      const ids = saleDiscountIds(sale);
      const matchesSaved = selectedDiscountIds.some((id) => ids.includes(id));
      const matchesNone = wantsNoDiscount && totalDiscount <= 0;
      if (!matchesSaved && !matchesNone) return false;
    }

    if (Array.isArray(filters.paymentMethods) && filters.paymentMethods.length) {
      const methods = salePaymentParts(sale).map((part) => part.method);
      if (!methods.some((method) => filters.paymentMethods.includes(method))) return false;
    }
    return true;
  });
}

function row(map, key, name) {
  if (!map.has(key)) map.set(key, { key, name, total: 0, sales: 0, items: 0 });
  return map.get(key);
}

function sorted(map, field = "total") {
  return [...map.values()].sort((a, b) => b[field] - a[field] || String(a.name).localeCompare(String(b.name)));
}

function timelineMode(range) {
  if (range.period === "day") return "hour";
  if (range.period === "month") return "day";
  if (range.period === "year") return "month";
  const days = Math.max(1, Math.ceil((range.end - range.start) / DAY_MS));
  if (days <= 45) return "day";
  if (days <= 180) return "week";
  return "month";
}

function buildTimeline(active, range) {
  const mode = timelineMode(range);
  let points = [];
  if (mode === "hour") {
    points = Array.from({ length: 24 }, (_, index) => ({ key: String(index), label: `${pad(index)}:00`, total: 0, sales: 0 }));
  } else if (mode === "day") {
    for (let date = new Date(range.start); date < range.end && points.length < 62; date = addArgentinaDays(date, 1)) {
      const key = argentinaDateKey(date);
      points.push({ key, label: new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(date), total: 0, sales: 0 });
    }
  } else if (mode === "week") {
    for (let date = new Date(range.start), index = 0; date < range.end && index < 30; date = addArgentinaDays(date, 7), index += 1) {
      points.push({ key: String(index), start: new Date(date), label: `Sem ${index + 1}`, total: 0, sales: 0 });
    }
  } else {
    const cursor = argentinaParts(range.start);
    let year = cursor.year;
    let month = cursor.month;
    while (points.length < 36) {
      const start = argentinaDateFromKey(`${year}-${pad(month)}-01`);
      if (start >= range.end) break;
      const key = `${year}-${pad(month)}`;
      points.push({ key, label: range.period === "year" ? MONTHS[month - 1] : new Intl.DateTimeFormat("es-AR", { month: "short", year: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }).format(start), total: 0, sales: 0 });
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
  }

  const byKey = new Map(points.map((point) => [point.key, point]));
  active.forEach((sale) => {
    const date = saleDate(sale);
    if (!date) return;
    let key;
    if (mode === "hour") {
      key = String(Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", hourCycle: "h23" }).format(date)));
    } else if (mode === "day") {
      key = argentinaDateKey(date);
    } else if (mode === "week") {
      const index = Math.max(0, Math.floor((date.getTime() - range.start.getTime()) / DAY_MS / 7));
      key = String(index);
    } else {
      const parts = argentinaParts(date);
      key = `${parts.year}-${pad(parts.month)}`;
    }
    const point = byKey.get(key);
    if (point) {
      point.total += Number(sale.total || 0);
      point.sales += 1;
    }
  });
  return { mode, points };
}

export function calculateMetrics(sales, range, filters = {}) {
  const active = sales.filter(isActiveSale);
  const cancelled = sales.filter((sale) => !isActiveSale(sale));
  const total = active.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const totalItems = active.reduce((sum, sale) => sum + (sale.items || []).reduce((itemSum, item) => itemSum + Number(item.qty || 0), 0), 0);
  const byLocation = new Map();
  const bySeller = new Map();
  const byProduct = new Map();
  const byDiscount = new Map();
  const byPayment = new Map();
  let discountTotal = 0;
  let discountedSales = 0;
  let selectedProductAmount = 0;
  let selectedProductUnits = 0;

  active.forEach((sale) => {
    const saleTotal = Number(sale.total || 0);
    const items = sale.items || [];
    const itemCount = items.reduce((sum, item) => sum + Number(item.qty || 0), 0);
    const location = row(byLocation, sale.locationId || sale.locationName || "unknown", sale.locationName || "Ubicación desconocida");
    location.total += saleTotal; location.sales += 1; location.items += itemCount;
    const seller = row(bySeller, sale.sellerId || sale.sellerName || "unknown", sale.sellerName || "Vendedor desconocido");
    seller.total += saleTotal; seller.sales += 1; seller.items += itemCount;

    const productsInSale = new Set();
    items.forEach((item) => {
      const key = item.productId || item.name || "unknown";
      const name = item.name || item.abbreviation || "Producto sin nombre";
      const qty = Number(item.qty || 0);
      const amount = Number(item.subtotal ?? Number(item.unitPrice || 0) * qty);
      const product = row(byProduct, key, name);
      product.items += qty;
      product.total += amount;
      if (!productsInSale.has(key)) { product.sales += 1; productsInSale.add(key); }
      if (filters.productId && itemMatches(item, filters.productId, filters.productName)) {
        selectedProductAmount += amount;
        selectedProductUnits += qty;
      }
    });

    salePaymentParts(sale).forEach((part) => {
      const payment = row(byPayment, part.method || "unknown", part.label || "Sin forma de pago");
      payment.total += Number(part.amount || 0);
      payment.sales += 1;
    });

    const saleDiscountTotal = storedDiscountTotal(sale);
    discountTotal += saleDiscountTotal;
    if (saleDiscountTotal > 0) discountedSales += 1;
    const discounts = saleDiscountList(sale);
    discounts.forEach((discount, index) => {
      const key = discountIdentity(discount, index);
      const name = discount.name || (discount.source === "manual" ? "Descuento manual" : "Descuento");
      const amount = Number(discount.amountApplied ?? (discounts.length === 1 ? saleDiscountTotal : 0));
      const entry = row(byDiscount, key, name);
      entry.sales += 1;
      entry.total += amount;
      entry.salesTotal = Number(entry.salesTotal || 0) + saleTotal;
      entry.source = discount.source || (key === "manual" ? "manual" : "saved");
      entry.type = discount.type || "";
    });
  });

  const withAverage = (rows) => rows.map((entry) => ({ ...entry, ticket: entry.sales ? entry.total / entry.sales : 0 }));
  const timeline = buildTimeline(active, range);
  return {
    active,
    cancelled,
    total,
    salesCount: active.length,
    ticket: active.length ? total / active.length : 0,
    totalItems,
    discountTotal,
    discountedSales,
    cancelledTotal: cancelled.reduce((sum, sale) => sum + Number(sale.total || 0), 0),
    selectedProductAmount,
    selectedProductUnits,
    timeline: timeline.points,
    timelineMode: timeline.mode,
    byLocation: withAverage(sorted(byLocation)),
    bySeller: withAverage(sorted(bySeller)),
    byProduct: sorted(byProduct, "items"),
    byDiscount: sorted(byDiscount, "sales"),
    byPayment: sorted(byPayment),
  };
}
