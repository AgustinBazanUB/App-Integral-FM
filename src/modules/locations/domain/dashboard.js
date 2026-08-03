import {
  ARGENTINA_TIME_ZONE,
  addArgentinaDays,
  argentinaDateKey,
  lastSevenArgentinaDays,
} from "./time.js";

const CANCELLED_STATUSES = new Set([
  "cancelled",
  "canceled",
  "deleted",
  "anulada",
  "anulado",
  "cancelada",
  "cancelado",
]);

export function isActiveDashboardSale(sale = {}) {
  return sale.deleted !== true && !CANCELLED_STATUSES.has(String(sale.status || "active").toLowerCase());
}

export function uniqueSales(sales = []) {
  const unique = new Map();
  sales.forEach((sale, index) => unique.set(sale.id || `legacy-${index}`, sale));
  return [...unique.values()];
}

export function summarizeSales(sales = []) {
  const active = uniqueSales(sales).filter(isActiveDashboardSale);
  const total = active.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  return {
    sales: active,
    count: active.length,
    total,
    average: active.length ? total / active.length : 0,
  };
}

export function buildSevenDaySalesSeries(sales = [], now = new Date()) {
  const { start } = lastSevenArgentinaDays(now);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addArgentinaDays(start, index);
    return {
      key: argentinaDateKey(date),
      label: new Intl.DateTimeFormat("es-AR", {
        timeZone: ARGENTINA_TIME_ZONE,
        weekday: "short",
        day: "numeric",
      }).format(date),
      value: 0,
      sales: 0,
    };
  });
  const byKey = new Map(days.map((day) => [day.key, day]));
  uniqueSales(sales).filter(isActiveDashboardSale).forEach((sale) => {
    const value = sale.createdAt?.toDate?.() || sale.createdAt || sale.date;
    if (!value) return;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.valueOf())) return;
    const day = byKey.get(argentinaDateKey(date));
    if (!day) return;
    day.value += Number(sale.total || 0);
    day.sales += 1;
  });
  return days;
}

export function joinMasterProducts(products = [], stock = []) {
  const stockByProduct = new Map(stock.map((item) => [item.productId || item.id, item]));
  return products
    .filter((product) => product.deleted !== true)
    .map((product) => {
      const local = stockByProduct.get(product.id);
      return {
        ...product,
        ...local,
        id: product.id,
        productId: product.id,
        productName: product.name,
        masterActive: product.active !== false,
        hasLocalRecord: Boolean(local),
        configured: Boolean(local && local.deleted !== true),
        currentStock: Number(local?.currentStock || 0),
        price: Number(local?.price ?? product.defaultPrice ?? 0),
        active: local ? local.active !== false && local.deleted !== true : product.active !== false,
      };
    })
    .sort((a, b) => String(a.productName || "").localeCompare(String(b.productName || ""), "es"));
}

export function isDiscountAvailable(discount = {}, location = {}, now = new Date(), context = {}) {
  if (discount.active === false || discount.deleted === true) return false;
  const start = discount.validFrom?.toDate?.() || (discount.validFrom ? new Date(discount.validFrom) : null);
  const end = discount.validUntil?.toDate?.() || (discount.validUntil ? new Date(discount.validUntil) : null);
  if (start && start > now) return false;
  if (end && end < now) return false;
  if (Array.isArray(discount.locationIds) && discount.locationIds.length && !discount.locationIds.includes(location.id)) return false;
  const role = context.profile?.role;
  if (Array.isArray(discount.allowedRoles) && discount.allowedRoles.length && !discount.allowedRoles.includes(role)) return false;
  const items = context.items || [];
  if (Array.isArray(discount.productIds) && discount.productIds.length && !items.some((item) => discount.productIds.includes(item.productId || item.id))) return false;
  if (Array.isArray(discount.categoryIds) && discount.categoryIds.length && !items.some((item) => discount.categoryIds.includes(item.categoryId))) return false;
  if (context.ignoreAssignment) return true;
  const enabled = location.enabledDiscountIds;
  return !Array.isArray(enabled) || enabled.includes(discount.id);
}
