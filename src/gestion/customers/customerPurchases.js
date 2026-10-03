import { isActiveSale, saleDate, uniqueSales } from "../../modules/locations/domain/saleFacts.js";
import { normalizeCustomerPhone, customerZoneLabel, normalizedSearchText } from "./customerDomain.js";
import { argentinaDateFromKey, argentinaDateKey, addArgentinaDays } from "../../modules/locations/domain/time.js";

export function validateLoyaltyPolicy(policy = {}) {
  if (policy.enabled !== true) return { enabled: false, minPurchases: null, windowDays: null, minCategories: null, maxFrequencyDays: null };
  const minPurchases = Number(policy.minPurchases);
  const windowDays = Number(policy.windowDays);
  const minCategories = policy.minCategories === "" || policy.minCategories == null ? null : Number(policy.minCategories);
  const maxFrequencyDays = policy.maxFrequencyDays === "" || policy.maxFrequencyDays == null ? null : Number(policy.maxFrequencyDays);
  if (maxFrequencyDays != null && (!Number.isFinite(maxFrequencyDays) || maxFrequencyDays <= 0)) throw new Error("La frecuencia debe ser una cantidad positiva de días, o quedar vacía.");
  if (!Number.isInteger(minPurchases) || minPurchases < 1 || !Number.isInteger(windowDays) || windowDays < 1 || windowDays > 3660) throw new Error("Definí una cantidad positiva de compras y una ventana de 1 a 3660 días.");
  if (minCategories != null && (!Number.isInteger(minCategories) || minCategories < 1)) throw new Error("La cantidad mínima de categorías debe ser un entero positivo, o quedar vacía.");
  return { enabled: true, minPurchases, windowDays, minCategories, maxFrequencyDays };
}

export function customerPurchaseIndex(customers, sales, products = [], policy = {}, now = new Date()) {
  const parameters = validateLoyaltyPolicy(policy);
  const categories = new Map(products.map(product => [product.id, product.categoryId]));
  const byIdentity = new Map();
  const byPhone = new Map();
  const result = new Map(customers.map(customer => {
    [customer.id, ...(customer.previousCustomerIds || []), customer.migratedFromCustomerId].filter(Boolean).forEach(id => byIdentity.set(id, customer.id));
    const phone = normalizeCustomerPhone(customer.phoneNormalized || customer.phone);
    if (phone) byPhone.set(phone, customer.id);
    return [customer.id, { count: 0, total: 0, lastPurchaseAt: null, categoryIds: new Set(), productIds: new Set(), averageDays: null, loyal: null, dates: [] }];
  }));
  const start = parameters.enabled ? addArgentinaDays(argentinaDateFromKey(argentinaDateKey(now)), 1 - parameters.windowDays) : null;
  uniqueSales(sales).filter(isActiveSale).forEach(sale => {
    const id = byIdentity.get(sale.customerId) || byPhone.get(normalizeCustomerPhone(sale.customerPhoneSnapshot || sale.customer?.phone));
    const stats = result.get(id);
    const date = saleDate(sale);
    if (!stats || !date || date > now || (start && date < start)) return;
    stats.count++; stats.total += Number(sale.total || 0); stats.dates.push(date);
    if (!stats.lastPurchaseAt || date > stats.lastPurchaseAt) stats.lastPurchaseAt = date;
    (sale.items || []).forEach(item => { if (item.productId) stats.productIds.add(item.productId); const category = item.categoryId || categories.get(item.productId); if (category) stats.categoryIds.add(category); });
  });
  result.forEach(stats => {
    stats.dates.sort((a, b) => a - b);
    if (stats.count > 1) stats.averageDays = (stats.dates.at(-1) - stats.dates[0]) / 86400000 / (stats.count - 1);
    stats.loyal = parameters.enabled ? stats.count >= parameters.minPurchases && (!parameters.minCategories || stats.categoryIds.size >= parameters.minCategories) && (parameters.maxFrequencyDays == null || stats.averageDays != null && stats.averageDays <= parameters.maxFrequencyDays) : null;
  });
  return result;
}

export function matchesCustomerSegment(customer, stats, filters = {}) {
  if (filters.loyalty === "loyal" && stats?.loyal !== true) return false;
  if (filters.loyalty === "not_loyal" && stats?.loyal !== false) return false;
  if (filters.zone && normalizedSearchText(customerZoneLabel(customer)) !== normalizedSearchText(filters.zone)) return false;
  if (filters.productId && !stats?.productIds.has(filters.productId)) return false;
  if (filters.categoryId && !stats?.categoryIds.has(filters.categoryId)) return false;
  if (filters.minPurchases && (stats?.count || 0) < Number(filters.minPurchases)) return false;
  if (filters.maxFrequencyDays && (stats?.averageDays == null || stats.averageDays > Number(filters.maxFrequencyDays))) return false;
  if (filters.lastSince && (!stats?.lastPurchaseAt || stats.lastPurchaseAt < argentinaDateFromKey(filters.lastSince))) return false;
  return true;
}
