import { saleChannelId } from "./channels.js";

// Use the same deduplicated, filtered commercial facts as the general report.
// Orders and invoices never contribute a second sale.
export function summarizeEcommerceMetrics(metrics) {
  const sales = metrics.active.filter(sale => saleChannelId(sale) === "ecommerce");
  const groups = new Map();
  let total = 0, units = 0;
  for (const sale of sales) {
    const amount = Number(sale.total || 0);
    const quantity = (sale.items || []).reduce((sum, item) => sum + Number(item.qty || 0), 0);
    const method = sale.deliveryMethod || sale.shipping?.method;
    const key = ["delivery", "pickup"].includes(method) ? method : "unknown";
    if (!groups.has(key)) groups.set(key, { key, name: { delivery: "Envío a domicilio", pickup: "Retiro en local", unknown: "Modalidad no informada" }[key], sales: 0, units: 0, total: 0, shippingTotal: 0, missingShipping: 0 });
    const group = groups.get(key);
    const shipping = sale.shippingAmount;
    if (shipping == null || !Number.isFinite(Number(shipping)) || Number(shipping) < 0 || Number(shipping) > amount) group.missingShipping += 1;
    else group.shippingTotal += Number(shipping);
    group.sales += 1; group.units += quantity; group.total += amount;
    total += amount; units += quantity;
  }
  return {
    total, units, count: sales.length, ticket: sales.length ? total / sales.length : 0,
    share: metrics.total > 0 ? total / metrics.total * 100 : 0,
    byDelivery: [...groups.values()].map(group => ({ ...group, productsTotal: group.missingShipping ? null : group.total - group.shippingTotal })),
  };
}
