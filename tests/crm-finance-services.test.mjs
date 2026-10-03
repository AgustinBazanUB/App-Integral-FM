import test from "node:test";
import assert from "node:assert/strict";
import { memoryServices } from "./helpers/memoryFirestore.mjs";
import { customerDocumentId } from "../src/gestion/customers/customerDomain.js";
import { financeSummary } from "../src/gestion/finance/financeDomain.js";
import { buildMetricsDateRange } from "../src/modules/locations/domain/metrics.js";
const { state, service } = await memoryServices('export * from "./src/gestion/services/customerService.js"; export * from "./src/gestion/customers/crmService.js"; export * from "./src/gestion/finance/financeService.js";');
const admin = { id: "admin", role: "admin", active: true, name: "Admin QA" };
const input = { type: "expense", name: "Servicio", amount: 100, category: "Servicios", nature: "fixed", scope: "general", accruedOn: "2026-10-02" };
const reset = () => { state.data.clear(); state.queries.length = 0; state.writes.length = 0; };
test("Alta/importación concurrente por teléfono evita duplicados, completa vacíos y audita sólo cambios", async () => {
  reset(); const original = { phone: "11 1234-5678", name: "" };
  const concurrent = [original, { ...original, phone: "+54 9 11 1234-5678", name: "Ana", zoneName: "CABA" }];
  const outcomes = await Promise.all(concurrent.map(customer => service.mergeCustomerFromAdmin(admin, customer)));
  const id = await customerDocumentId(original.phone), stored = state.data.get(`customers/${id}`);
  assert.equal(stored.name, "Ana"); assert.equal(stored.zoneName, "CABA"); assert.equal(stored.phone, concurrent[outcomes.findIndex(result => result.created)].phone);
  const result = await service.mergeCustomerFromAdmin(admin, { ...original, name: "Otro", zoneName: "Sur" });
  assert.equal(result.updated, false); assert.equal(result.conflicts.length, 2); assert.equal([...state.data.keys()].filter(key => key.startsWith("customers/")).length, 1); assert.equal([...state.data.keys()].filter(key => key.startsWith("auditLogs/")).length, outcomes.filter(outcome => outcome.created || outcome.updated).length);
});
test("Historial paginado conserva anuladas; última compra válida se resuelve desde ventas y alias", async () => {
  reset(); const customer = { id: "new", previousCustomerIds: ["old"], phoneNormalized: "1112345678" };
  for (let index = 1; index <= 25; index++) state.data.set(`sales/s${String(index).padStart(2, "0")}`, { customerId: index < 10 ? "old" : "new", customerPhoneSnapshot: "1112345678", createdAt: new Date(Date.UTC(2026, 8, index, 15)), status: index === 25 ? "cancelled" : "active", total: 100 });
  const first = await service.customerHistoryPage(admin, customer), second = await service.customerHistoryPage(admin, customer, first.cursor);
  assert.equal(first.items.length, 20); assert.equal(first.hasMore, true); assert.equal(second.items.length, 5); assert.equal(new Set([...first.items, ...second.items].map(sale => sale.id)).size, 25);
  assert.equal((await service.customerLastPurchase(admin, customer)).getUTCDate(), 24);
  assert.ok(state.queries.every(query => query.constraints.some(constraint => constraint.kind === "limit")));
});
test("CRM pagina clientes y guarda regla configurable con versión y auditoría", async () => {
  reset(); for (let index = 0; index < 55; index++) state.data.set(`customers/c${index}`, { updatedAt: new Date(2026, 8, 1, 12, index), active: true });
  const first = await service.listCustomerPage(admin), second = await service.listCustomerPage(admin, first.cursor); assert.equal(first.items.length, 50); assert.equal(second.items.length, 5);
  assert.equal((await service.getLoyaltyPolicy(admin)).enabled, false);
  await service.saveLoyaltyPolicy(admin, { enabled: true, minPurchases: 3, windowDays: 60 });
  assert.equal(state.data.get("settings/crmLoyalty").version, 1); await assert.rejects(service.saveLoyaltyPolicy({ ...admin, role: "marketing_manager" }, {}), /Administración/);
});
test("Última compra usa vigencia compartida de ventas legadas sin estado y omite bajas lógicas", async () => {
  reset(); const customer = { id: "legacy-customer" };
  state.data.set("sales/old", { customerId: customer.id, status: "active", createdAt: new Date("2026-10-01T15:00:00Z"), total: 100 });
  state.data.set("sales/legacy", { customerId: customer.id, createdAt: new Date("2026-10-02T15:00:00Z"), total: 100 });
  state.data.set("sales/deleted", { customerId: customer.id, status: "active", deleted: true, createdAt: new Date("2026-10-03T15:00:00Z"), total: 100 });
  assert.equal((await service.customerLastPurchase(admin, customer)).getUTCDate(), 2);
});
test("Gasto idempotente con reintentos concurrentes; anulación con motivo conserva historial", async () => {
  reset(); await Promise.all([service.saveFinancialEntry(admin, input, "intent"), service.saveFinancialEntry(admin, input, "intent")]);
  assert.equal([...state.data.keys()].filter(key => key.startsWith("financialEntries/")).length, 1); assert.equal([...state.data.keys()].filter(key => key.startsWith("auditLogs/")).length, 1);
  await assert.rejects(service.saveFinancialEntry(admin, { ...input, amount: 200 }, "intent"), /otro movimiento/);
  await assert.rejects(service.cancelFinancialEntry(admin, { id: "intent", type: "expense" }, ""), /motivo/);
  await service.cancelFinancialEntry(admin, { id: "intent", type: "expense" }, "Duplicado externo corregido"); assert.equal(state.data.get("financialEntries/intent").status, "cancelled");
});
test("Presupuesto no duplica registros y discrepancia posterior se cierra con acreditación auditada", async () => {
  reset(); await service.saveFinanceConfig(admin, { effectiveFrom: "2026-10-01", fees: { alias: { percent: 10, settlementDays: 0 } }, taxPercent: 0 });
  const sale = { id: "sale", saleCode: "V1", status: "active", createdAt: new Date("2026-10-01T15:00:00Z"), total: 1000, paymentMethod: "alias", items: [] }; state.data.set("sales/sale", sale);
  const range = buildMetricsDateRange("month", "2026-10"), config = await service.getFinanceConfig(admin);
  let summary = financeSummary([sale], [], config, range, [], new Date("2026-10-03T15:00:00Z"));
  await service.syncFinanceAlerts(admin, summary); const part = summary.settlements[0]; assert.equal(state.data.get(`alerts/finance_${part.id}`).active, true);
  await assert.rejects(service.resolveFinanceAlert(admin, part.id, "Acreditación vencida: V1", ""), /motivo/);
  await service.recordSettlement(admin, part, { amount: 900, paidOn: "2026-10-02", reference: "QA comprobante" }); assert.equal(state.data.get(`alerts/finance_${part.id}`).status, "resolved");
  const before = state.writes.length; await service.recordSettlement(admin, part, { amount: 900, paidOn: "2026-10-02", reference: "QA comprobante" }); assert.equal(state.writes.length, before);
  await service.saveBudget(admin, { month: "2026-10", category: "Servicios", amount: 1000, threshold: 80 }); await service.saveBudget(admin, { month: "2026-10", category: "Servicios", amount: 2000, threshold: 80 }); assert.equal([...state.data.values()].filter(item => item.type === "budget").length, 1);
  summary = financeSummary([sale], [...state.data].filter(([path]) => path.startsWith("financialEntries/")).map(([path, data]) => ({ id: path.split("/").at(-1), ...data })), config, range);
  assert.equal(summary.saleIncome, 1000); assert.equal(summary.extraIncome, 0); assert.equal(summary.bankMovement, 900);
});
test("Queries financieras acotadas incluyen devengamiento, pago, vencimiento y referencias; vendedor rechazado", async () => {
  reset(); const range = buildMetricsDateRange("month", "2026-10"); await service.listFinancialEntries(admin, range, ["sale"]);
  assert.equal(state.queries.length, 5); assert.ok(state.queries.slice(0, 3).every(query => query.constraints.some(constraint => constraint.op === ">=") && query.constraints.some(constraint => constraint.op === "<")));
  await assert.rejects(service.listFinancialEntries({ id: "seller", role: "seller", active: true }, range), /permiso/);
});
