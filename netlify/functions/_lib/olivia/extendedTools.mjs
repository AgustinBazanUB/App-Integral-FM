import { OLIVIA_CAPABILITIES, selectCapabilities } from "../../../../src/shared/oliviaCapabilities.mjs";
import { fairForecast, aggregateSales } from "../../../../src/shared/oliviaAnalytics.mjs";
import { oliviaError, safeId } from "../../../../src/shared/oliviaContracts.mjs";
import { normalizedSearchText } from "../../../../src/gestion/customers/customerDomain.js";
import { argentinaDateKey } from "../../../../src/modules/locations/domain/time.js";
import { financeSummary } from "../../../../src/gestion/finance/financeDomain.js";
import { can } from "../../../../src/gestion/permissions.js";
import { readSales, salesMetrics, analyticsPeriod } from "./analytics.mjs";
import { prepareExtendedOperation } from "./extendedOperations.mjs";
import { discoverSkills, loadSkill } from "./skills.mjs";
import { retrieveKnowledge } from "./knowledge.mjs";
import { customerHistoryGroups } from "../../../../src/shared/customerHistoryQueries.mjs";
import { saleDate } from "../../../../src/modules/locations/domain/saleFacts.js";
import { researchWebMetric } from "./research.mjs";
const project = (row, fields) => Object.fromEntries(["id", ...fields].filter((key) => row[key] !== undefined).map((key) => [key, row[key]]));
const common = ["name", "title", "code", "notes", "status", "active", "createdAt", "updatedAt", "responsibleId"];
const sources = {
  get_shipments: ["shipments", [...common, "orderId", "locationId", "deliveryMethod"]],
  get_alerts: ["alerts", [...common, "severity", "moduleId", "locationId", "productId"]],
  get_suppliers: ["suppliers", [...common, "phone", "leadTimeDays"]],
  get_orders: ["orders", ["orderCode", "status", "paymentStatus", "total", "createdAt", "deliveryMethod", "customerId"]],
  get_marketing_campaigns: ["campaigns", [...common, "budget", "channel"]],
  get_whatsapp_campaigns: ["whatsappCampaigns", [...common, "totalRecipients", "sentCount", "errorCount", "progress", "emitterReleased"]],
  get_meta_ads_campaigns: ["metaCampaignProjects", [...common, "objective", "productId", "theoryId", "currentPlanId", "driveFolderId"]],
  get_social_leads: ["socialLeads", [...common, "channel", "customerId"]],
  get_audit_activity: ["auditLogs", ["action", "title", "description", "moduleId", "entityId", "userId", "userName", "role", "createdAt", "status", "origin", "conversationId", "requestId", "confirmationId", "skill", "tool"]],
  get_users: ["users", ["name", "role", "active", "allowedLocationIds"]],
};
export async function runExtendedTool({ session, name, args, store, context, now, provider, env, researchOptions }) {
  if (name === "research_web_metric") return researchWebMetric({ topic: args.topic, provider, env, now, ...researchOptions });
  if (name === "get_all_time_sales_metrics") return { data: await salesMetrics({ store, args: { ...args, allTime: true }, now }) };
  if (name === "search_knowledge") return { data: await retrieveKnowledge({ session, query: args.query, context, store, ...(provider ? { provider } : {}), ...(env ? { env } : {}) }) };
  if (name === "discover_skills") return { data: { skills: discoverSkills(session) } };
  if (name === "load_skill") { const skill = await loadSkill(session, args.name); return { data: skill, skill, loadTools: skill.requiredTools }; }
  if (name === "search_tools") {
    const names = selectCapabilities(session, args.query, {});
    return { data: { capabilities: names.filter((id) => id !== "search_tools").map((id) => ({ name: id, module: OLIVIA_CAPABILITIES[id].module, description: OLIVIA_CAPABILITIES[id].description })), instructions: "Estas herramientas pueden cargarse en el próximo paso, sin conceder permisos." }, loadTools: names };
  }
  if (name.startsWith("prepare_")) {
    const prepared = await prepareExtendedOperation({ session, toolName: name, args, store, now });
    return prepared.canonicalArgs ? { prepared, data: { state: "ESPERANDO_CONFIRMACION", summary: prepared.summary } } : { state: prepared.state || "DATOS_INCOMPLETOS", data: prepared };
  }
  if (name === "resolve_transfer_origin") {
    const product = await store.get(`products/${safeId(args.productId)}`);
    if (!product || product.deleted || product.active === false) throw oliviaError("product-unavailable", "El producto no está disponible.", 404);
    const warehouses = await store.query("warehouses", [], 100);
    const locations = can(session.profile, "locations", "viewStock") && can(session.profile, "locations", "viewAllLocations") ? await store.query("locations", [], 100) : [];
    const owners = [...warehouses.map((owner) => ({ ...owner, type: "warehouse" })), ...locations.map((owner) => ({ ...owner, type: "location" }))].filter((owner) => !owner.deleted && owner.active !== false && !(owner.type === args.destinationType && owner.id === args.destinationId));
    const candidates = [];
    for (let index = 0; index < owners.length; index += 3) {
      const batch = await Promise.all(owners.slice(index, index + 3).map(async (owner) => {
        const stock = await store.get(`${owner.type === "warehouse" ? "warehouseStock" : "locationStock"}/${safeId(owner.id)}/items/${safeId(args.productId)}`);
        return stock && !stock.deleted && stock.active !== false && Number.isSafeInteger(stock.currentStock) && stock.currentStock >= args.quantity ? { id: owner.id, type: owner.type, name: owner.name, available: stock.currentStock } : null;
      }));
      candidates.push(...batch.filter(Boolean));
    }
    const partial = warehouses.length === 100 || locations.length === 100;
    return { data: { product: { id: args.productId, name: product.name }, quantity: args.quantity, candidates, recommendedOrigin: candidates.length === 1 && !partial ? candidates[0] : null, requiresChoice: candidates.length > 1 || partial, partial, observedAt: now.toISOString() } };
  }
  if (name === "list_fair_events") {
    const rows = await store.query("locations", [], 150, [["name", "ASCENDING"]]);
    const query = normalizedSearchText(args.query);
    return { data: { locations: rows.filter((row) => !row.deleted && ["fair", "event"].includes(row.type) && normalizedSearchText(row.name).includes(query)).map((row) => project(row, ["name", "type", "active", "scheduleStartAt", "scheduleEndAt", "startDateTime", "endDateTime", "operatingCalendar"])), partial: rows.length === 150, observedAt: now.toISOString() } };
  }
  if (["get_sales_metrics", "get_location_metrics", "compare_locations", "get_product_performance", "get_seller_performance"].includes(name)) {
    if (!args.startDate || !args.endDate) return { state: "DATOS_INCOMPLETOS", data: { message: "¿Qué período querés consultar: un mes, un rango de fechas o todo el historial?" } };
    return { data: await salesMetrics({ store, args, now }) };
  }
  if (["get_sales_history", "get_product_sales_history"].includes(name)) {
    if (!args.startDate || !args.endDate) return { state: "DATOS_INCOMPLETOS", data: { message: "¿Qué período querés consultar: un mes, un rango de fechas o todo el historial?" } };
    const result = await readSales({ store, args, now });
    return { data: { ...result, sales: result.sales.slice(0, 100).map((sale) => project(sale, ["saleCode", "locationId", "sellerId", "total", "items", "payments", "status", "createdAt"])), summary: aggregateSales(result.sales), displayedLimit: 100 } };
  }
  if (["get_inventory_summary", "get_stock_movements"].includes(name)) {
    const id = args.inventoryId || (args.inventoryType === "warehouse" ? context.warehouseId : context.locationId);
    if (!id) return { state: "DATOS_INCOMPLETOS", data: { message: "Indicá el depósito o ubicación que querés consultar." } };
    if (args.inventoryType === "location" && !can(session.profile, "locations", "viewStock")) throw oliviaError("permission-denied", "No tenés permiso para consultar stock de ubicaciones.", 403);
    const owner = await store.get(`${args.inventoryType === "warehouse" ? "warehouses" : "locations"}/${safeId(id)}`);
    if (!owner || owner.deleted) throw oliviaError("inventory-unavailable", "El inventario no está disponible.", 404);
    const rows = name === "get_stock_movements"
      ? await store.query("stockMovements", [[args.inventoryType === "warehouse" ? "warehouseId" : "locationId", "EQUAL", id], ...(args.productId ? [["productId", "EQUAL", args.productId]] : [])], 100, [["createdAt", "DESCENDING"]])
      : await store.query(`${args.inventoryType === "warehouse" ? "warehouseStock" : "locationStock"}/${safeId(id)}/items`, [], 150);
    const items = rows.filter((row) => !row.deleted).map((row) => project(row, ["productId", "productName", "currentStock", "previousStock", "newStock", "type", "qty", "requestedQty", "receivedQty", "reason", "createdAt"]));
    if (name === "get_inventory_summary") {
      // Old inventory records may omit the display name. Resolve only those
      // products, with bounded concurrency; unknown quantities remain unknown.
      const missingNames = items.filter((item) => !item.productName);
      for (let index = 0; index < missingNames.length; index += 3) {
        await Promise.all(missingNames.slice(index, index + 3).map(async (item) => {
          const product = await store.get(`products/${safeId(item.productId || item.id)}`);
          if (product?.name) item.productName = product.name;
        }));
      }
    }
    return { data: { owner: { id, name: owner.name, type: args.inventoryType }, items, partial: rows.length === (name === "get_stock_movements" ? 100 : 150), observedAt: now.toISOString() } };
  }
  if (name === "list_warehouses" || name === "get_transfer_history") {
    const rows = await store.query(name === "list_warehouses" ? "warehouses" : "stockTransfers", [], 100, name === "list_warehouses" ? [] : [["createdAt", "DESCENDING"]]);
    return { data: { records: rows.filter((row) => !row.deleted).map((row) => project(row, name === "list_warehouses" ? common : ["sourceType", "sourceId", "sourceName", "destinationType", "destinationId", "destinationName", "status", "totalQuantity", "preparedQuantity", "receivedQuantity", "missingQuantity", "lostQuantity", "items", "createdAt"])), limit: 100, partial: rows.length === 100, observedAt: now.toISOString() } };
  }
  if (["search_customers", "get_customer", "get_customer_history"].includes(name)) {
    if (name !== "search_customers" && !args.customerId && !context.customerId) return { state: "DATOS_INCOMPLETOS", data: { message: "Indicá el cliente que querés consultar." } };
    const id = args.customerId || context.customerId;
    if (name === "get_customer_history") {
      const customer = await store.get(`customers/${safeId(id)}`);
      if (!customer || customer.deleted) throw oliviaError("customer-unavailable", "El cliente no está disponible.", 404);
      const identities = new Set([id, ...(customer.previousCustomerIds || []), customer.migratedFromCustomerId].filter(Boolean));
      let legacyId = customer.migratedFromCustomerId;
      for (let depth = 0; legacyId && depth < 20; depth++) {
        const previous = await store.get(`customers/${safeId(legacyId)}`), parent = previous?.migratedFromCustomerId;
        if (!parent || identities.has(parent)) break;
        identities.add(parent); legacyId = parent;
      }
      const groups = customerHistoryGroups({ ...customer, id }, [...identities]);
      const pages = [];
      for (let offset = 0; offset < groups.length; offset += 3) pages.push(...await Promise.all(groups.slice(offset, offset + 3).map((group) => store.query("sales", [[group.field, "IN", group.values]], 100, [["createdAt", "DESCENDING"]]))));
      const unique = [...new Map(pages.flat().filter((sale) => !sale.deleted).map((sale) => [sale.id, sale])).values()].sort((a, b) => (saleDate(b)?.getTime() || 0) - (saleDate(a)?.getTime() || 0));
      const rows = unique.slice(0, 100);
      return { data: { customerId: id, sales: rows.map((row) => project(row, ["saleCode", "total", "status", "createdAt", "locationId", "items"])), summary: aggregateSales(rows), partial: unique.length > 100 || pages.some((page) => page.length === 100), displayedLimit: 100 } };
    }
    const rows = name === "get_customer" ? [await store.get(`customers/${safeId(id)}`)] : await store.query("customers", [], 150, [["updatedAt", "DESCENDING"]]);
    const query = normalizedSearchText(args.query || "");
    return { data: { customers: rows.filter((row) => row && !row.deleted && (name === "get_customer" || normalizedSearchText(`${row.name} ${row.phoneNormalized}`).includes(query))).map((row) => project(row, ["name", "phone", "phoneNormalized", "zoneId", "zoneName", "active", "updatedAt"])), searchedLimit: name === "search_customers" ? 150 : 1, partial: rows.length === 150 } };
  }
  if (["get_financial_summary", "get_expenses"].includes(name)) {
    const period = analyticsPeriod(args, now);
    const [facts, groups, config] = await Promise.all([readSales({ store, args, now }), Promise.all(["occurredAt", "paidAt", "dueAt"].map((field) => store.query("financialEntries", [[field, "GREATER_THAN_OR_EQUAL", period.start], [field, "LESS_THAN", period.end]], 150, [[field, "DESCENDING"]])).concat([store.query("financialEntries", [["type", "EQUAL", "budget"], ["month", "EQUAL", period.startKey.slice(0, 7)]], 150)])), store.get("settings/financeConfig")]);
    const entries = new Map(groups.flat().map((row) => [row.id, row]));
    const saleIds = [...new Set(facts.sales.map((sale) => sale.id))];
    const batches = [0, 10, 20].map((offset) => saleIds.slice(offset, offset + 10)).filter((batch) => batch.length);
    const settlementGroups = await Promise.all(batches.map((batch) => store.query("financialEntries", [["type", "EQUAL", "settlement"], ["saleId", "IN", batch]], 150, [])));
    for (const row of settlementGroups.flat()) entries.set(row.id, row);
    const scoped = [...entries.values()].filter((entry) => !args.locationId || entry.scope !== "location" || entry.locationId === args.locationId);
    return { data: { summary: financeSummary(facts.sales, scoped, config || {}, period, args.locationId ? [args.locationId] : [], now), expenses: scoped.filter((entry) => entry.type === "expense").map((row) => project(row, ["name", "amount", "nature", "scope", "locationId", "category", "accruedOn", "paidOn", "dueOn", "status"])), partial: facts.partial || groups.some((rows) => rows.length === 150) || settlementGroups.some((rows) => rows.length === 150) || saleIds.length > 30, period: facts.period, settlementSalesLimit: 30 } };
  }
  if (name === "forecast_fair") {
    const locationId = args.locationId || context.locationId;
    if (!locationId || !args.startDate) return { state: "DATOS_INCOMPLETOS", data: { message: "Indicá la ubicación futura y la fecha de inicio de la feria." } };
    if (!can(session.profile, "locations", "view")) throw oliviaError("permission-denied", "No tenés permiso para consultar ubicaciones.", 403);
    const location = await store.get(`locations/${safeId(locationId)}`);
    if (!location || location.deleted) throw oliviaError("location-unavailable", "La feria no está disponible.", 404);
    const comparables = await Promise.all(args.comparableLocationIds.map((id) => store.get(`locations/${safeId(id)}`)));
    const liveComparables = comparables.filter((row) => row && !row.deleted && row.type === location.type);
    const start = argentinaDateKey(new Date(now.getTime() - 180 * 86400000));
    const stockAllowed = can(session.profile, "locations", "viewStock");
    const [facts, configuration, stock] = await Promise.all([readSales({ store, args: { startDate: start, endDate: argentinaDateKey(now) }, now }), store.get("oliviaConfiguration/global"), stockAllowed ? store.query(`locationStock/${safeId(locationId)}/items`, [], 150) : []]);
    const forecast = fairForecast({ sales: facts.sales, location: { ...location, id: locationId }, comparableLocations: liveComparables, startDate: args.startDate, days: args.days, safetyStockPercent: configuration?.forecast?.safetyStockPercent ?? 20, observedAt: now, partial: facts.partial });
    forecast.products = forecast.products.map((item) => { const current = stock.find((row) => !row.deleted && (row.productId || row.id) === item.productId); const currentStock = stockAllowed ? current ? Number(current.currentStock || 0) : stock.length === 150 ? null : 0 : null; return { ...item, currentStock, suggestedTransferQuantity: currentStock == null ? null : Math.max(0, item.recommendedStock - currentStock) }; });
    forecast.stockPartial = stock.length === 150;
    forecast.stockObservedAt = stockAllowed ? now.toISOString() : null;
    return { data: forecast };
  }
  if (sources[name]) {
    const [collection, fields] = sources[name];
    const rows = args.entityId ? [await store.get(`${collection}/${safeId(args.entityId)}`)] : await store.query(collection, [], 100, [[name === "get_users" ? "name" : name === "get_meta_ads_campaigns" ? "updatedAt" : "createdAt", "DESCENDING"]]);
    return { data: { records: rows.filter((row) => row && !row.deleted).map((row) => project(row, fields)), limit: args.entityId ? 1 : 100, partial: rows.length === 100, observedAt: now.toISOString() } };
  }
  if (name === "get_configuration_summary") {
    const config = await store.get("oliviaConfiguration/global");
    return { data: { olivia: config ? { enabled: config.enabled, retentionMonths: config.retentionMonths, forecast: config.forecast, audioLimits: config.audioLimits } : null, credentialPolicy: "Credenciales y parámetros sensibles se revisan en Configuración, nunca por chat." } };
  }
  if (name === "get_invoice_status") {
    if (!args.entityId) return { state: "DATOS_INCOMPLETOS", data: { message: "Indicá la venta para consultar su estado fiscal." } };
    const sale = await store.get(`sales/${safeId(args.entityId)}`);
    if (!sale) throw oliviaError("sale-unavailable", "La venta no está disponible.", 404);
    const invoices = await store.query("invoices", [["sourceId", "EQUAL", args.entityId]], 20, []);
    return { data: { sale: { ...project(sale, ["saleCode", "fiscalInvoiceId", "fiscalInvoiceStatus", "invoiceId", "invoiceStatus", "arcaStatus", "invoiceRequested", "ticketRequested", "ticketStatus", "status"]), fiscalInvoice: sale.fiscalInvoice ? project(sale.fiscalInvoice, ["id", "sourceType", "status", "voucherType", "voucherNumber", "pointOfSale", "cae", "caeExpiration"]) : null }, invoices: invoices.map((invoice) => ({ ...project(invoice, ["sourceId", "sourceType", "status", "fiscalEnvironment", "authorizationStatus", "voucherClass", "voucherNumber", "pointOfSale", "verifiedAt", "updatedAt"]), authorization: invoice.authorization ? project(invoice.authorization, ["status", "voucherType", "voucherNumber", "pointOfSale", "cae", "caeExpiration", "result", "authorizedAt"]) : null })), partial: invoices.length === 20 } };
  }
  throw oliviaError("invalid-tool", "Herramienta no disponible.", 422);
}
