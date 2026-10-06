import { createHash } from "node:crypto";
import { canAccessAdministration } from "../../../../src/gestion/permissions.js";
import { oliviaError } from "../../../../src/shared/oliviaContracts.mjs";
import { canonicalSaleArgs, saleContext } from "./operations.mjs";
import { buildOperationalSalePlan, customerSaleWrite } from "../../../../src/shared/operationalWritePlans.mjs";
import { ARGENTINA_TIME_ZONE } from "../../../../src/modules/locations/domain/time.js";
import { customerDocumentId } from "../../../../src/gestion/customers/customerDomain.js";
const clean = value => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(clean) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).filter(key => key !== "id" && !key.startsWith("__")).sort().map(key => [key, clean(value[key])])) : value;
const md = value => String(value).replace(/[\\`*_{}\[\]<>#|]/g, "\\$&").replace(/[\r\n]/g, " ");
const money = value => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value);
export async function batchSalesPlan({ session, args, store, now, entityId, correlation }) {
  if (!args.sales?.length || args.sales.length > 20 || args.sales.reduce((sum, sale) => sum + sale.items.length, 0) > 100)
    throw oliviaError("sale-list-limit", "Podés preparar hasta 20 ventas y 100 renglones de productos por lista.", 422);
  const missing = [], canonical = [];
  for (const [index, sale] of args.sales.entries()) {
    const key = `sales.${index}`;
    if (!sale.stockOrigin.type) missing.push(`${key}.stockOrigin.type`);
    if (!sale.channel) missing.push(`${key}.channel`);
    const row = canonicalSaleArgs({ ...sale, locationId: sale.stockOrigin.id });
    if (row.state === "RECHAZADA") return row;
    if (row.state) missing.push(...row.missing.map(field => `${key}.${field}`));
    else canonical.push({ ...row, stockOriginType: sale.stockOrigin.type, channel: sale.channel, reference: sale.reference });
  }
  if (missing.length) return { state: "DATOS_INCOMPLETOS", missing, summary: "Para preparar la lista falta indicar: " + missing.map(field => {
    const [_, index, ...name] = field.split(".");
    const label = { locationId: "origen físico", "stockOrigin.type": "tipo de origen", channel: "canal", items: "productos", paymentMethod: "forma de pago", ticketRequested: "si necesita ticket", customerDecision: "si lleva cliente", promotionDecision: "si lleva descuentos", payments: "importes de cada pago", discounts: "descuentos" }[name.join(".")] || "datos del cliente";
    return `venta ${Number(index) + 1}: ${label}`;
  }).join("; ") + ". Todavía no se registró ninguna venta." };
  const original = new Map(), overlay = new Map(), writes = new Map(), reads = new Map();
  const read = async path => {
    if (!original.has(path)) {
      if (!reads.has(path)) reads.set(path, store.get(path));
      original.set(path, await reads.get(path));
    }
    const row = overlay.has(path) ? overlay.get(path) : original.get(path);
    return row ? { ...row, id: path.split("/").at(-1) } : null;
  };
  const write = (path, data, forceCreate = false) => {
    const previous = writes.get(path), existing = original.get(path);
    writes.set(path, { type: previous?.type || (forceCreate || !existing ? "create" : "update"), path, data: { ...(previous?.data || {}), ...data } });
    overlay.set(path, { ...(overlay.get(path) || existing || {}), ...data });
  };
  original.set(`users/${session.uid}`, { ...session.profile });
  const paths = new Set();
  for (const row of canonical) {
    paths.add(`${row.stockOriginType === "warehouse" ? "warehouses" : "locations"}/${row.locationId}`);
    for (const item of row.items) { paths.add(`products/${item.productId}`); paths.add(`${row.stockOriginType === "warehouse" ? "warehouseStock" : "locationStock"}/${row.locationId}/items/${item.productId}`); }
    for (const discount of row.discounts) if (discount.source !== "manual" && discount.discountId && discount.discountId !== "manual") paths.add(`discounts/${discount.discountId}`);
    if (row.customerDecision === "associate") paths.add(`customers/${await customerDocumentId(row.customer.phoneNormalized)}`);
  }
  // Bound parallel reads, including during transaction revalidation. Planning
  // remains sequential so shared stock and counters always accumulate correctly.
  const prefetch = [...paths];
  for (let offset = 0; offset < prefetch.length; offset += 3) await Promise.all(prefetch.slice(offset, offset + 3).map(read));
  const summary = [`### Registrar ${canonical.length} ventas`], results = [];
  let total = 0;
  for (const [index, row] of canonical.entries()) {
    const administrative = canAccessAdministration(session.profile);
    if (!administrative && row.channel !== "in_person") throw oliviaError("permission-denied", "Los canales a distancia se registran desde Venta Rápida administrativa.", 403);
    const context = await saleContext({ session, args: row, store: { get: read }, now });
    const prefix = row.stockOriginType === "warehouse" ? "VR" : String(context.location.codePrefix || "LOC").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    const dateKey = context.day.replaceAll("-", ""), counterPath = `counters/${prefix}_${dateKey}`;
    const counter = await read(counterPath), saleId = `olivia_sale_${entityId}_${index}`;
    const movementIds = context.items.map((_, line) => `${saleId}_${line}`);
    const plan = buildOperationalSalePlan({ profile: context.profile, location: context.location, items: context.items, stocks: context.stocks, counter: counter || {}, saleId, movementIds, dateKey, prefix, stamp: now,
      localFields: { saleDate: context.day, saleTime: new Intl.DateTimeFormat("es-AR", { timeZone: ARGENTINA_TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now) },
      discountSummary: context.discountSummary, payment: context.payment, customer: context.customer,
      stockType: row.stockOriginType, administrative, channel: row.channel, requestId: correlation.requestId || entityId, requestFingerprint: entityId });
    write(counterPath, plan.counterData);
    plan.stockWrites.forEach((line, lineIndex) => {
      write(`${row.stockOriginType === "warehouse" ? "warehouseStock" : "locationStock"}/${context.location.id}/items/${line.productId}`, line.stockData);
      write(`stockMovements/${movementIds[lineIndex]}`, { ...line.movementData, ...correlation }, true);
    });
    if (context.customer) write(`customers/${context.customer.id}`, customerSaleWrite({ existing: context.customerExisting, customer: context.customer, profile: context.profile, saleId, stamp: now, source: administrative ? "admin_quick_sale" : "seller_sale" }));
    write(`sales/${saleId}`, { ...plan.saleData, assistantOrigin: "Asistente IA / Olivia", assistantCorrelation: correlation }, true);
    write(`auditLogs/${saleId}`, { ...plan.auditData, ...correlation, origin: "Asistente IA / Olivia" }, true);
    results.push(plan.result); total += plan.result.total;
    const channel = { in_person: "Presencial", whatsapp: "WhatsApp", instagram: "Instagram", phone: "Teléfono" }[row.channel];
    summary.push(`\n**${index + 1}. ${md(row.reference || "Venta")} · ${md(context.location.name)} · ${channel}**`,
      ...context.items.map(item => `- ${item.qty} × ${md(item.name)} · ${money(item.unitPrice)}`),
      `- Total: **${money(plan.result.total)}** · Pago: ${md(plan.result.paymentMethodLabel)}${row.payments.length ? " (" + row.payments.map(payment => `${payment.method}: ${money(payment.amount)}`).join(" + ") + ")" : ""}`,
      `- ${context.discountSummary.discounts.length ? "Descuentos: " + context.discountSummary.discounts.map(discount => `${md(discount.name)} ${discount.type === "percent" ? discount.value + "%" : money(discount.value)}`).join(", ") : "Sin descuentos"} · ${context.customer ? "Cliente: " + md(context.customer.name || context.customer.phone) : "Sin cliente"} · Sin ticket fiscal`);
    if (context.discountSummary.cashRoundingDiscountTotal > 0) summary.push(`- Redondeo por efectivo: − ${money(context.discountSummary.cashRoundingDiscountTotal)} (incluido en el total).`);
    if (plan.stockWrites.some(line => line.stockData.currentStock < 0)) summary.push("- **Atención:** el stock local quedará negativo; el faltante queda auditado.");
  }
  summary.push(`\n**Total de la lista: ${money(total)}.**\nSe registran todas juntas únicamente al tocar Sí.`);
  return { toolName: "prepare_batch_sales", module: "quick-sales", canonicalArgs: args, summary: summary.join("\n"), snapshotFingerprint: createHash("sha256").update(JSON.stringify(clean({ pricingPolicy: "admin-cash-discount-floor-1000-v1", totals: results.map(result => result.total), documents: Object.fromEntries(original), day: canonical[0] && results.length ? new Intl.DateTimeFormat("en-CA", { timeZone: ARGENTINA_TIME_ZONE }).format(now) : null, args }))).digest("hex"), writes: [...writes.values()], navigation: null, affectedId: entityId, completedMessage: `Se registraron ${results.length} ventas por ${money(total)}.\n\n${results.map(result => `- ${result.saleCode}: ${money(result.total)}`).join("\n")}` };
}
