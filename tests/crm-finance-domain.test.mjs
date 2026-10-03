import test from "node:test";
import assert from "node:assert/strict";
import { customerEnrichment } from "../src/gestion/customers/customerDomain.js";
import { customerPurchaseIndex, matchesCustomerSegment, validateLoyaltyPolicy } from "../src/gestion/customers/customerPurchases.js";
import { applyMetricsFilters, buildMetricsDateRange, calculateMetrics } from "../src/modules/locations/domain/metrics.js";
import { metricsByCategory, operatingAverage, validateHolidays } from "../src/modules/locations/domain/operatingMetrics.js";
import { financeSummary, expectedSettlements, validateFinancePolicy, validateFinancialEntry } from "../src/gestion/finance/financeDomain.js";
const date = value => new Date(`2026-10-${value}T15:00:00Z`);
const sale = (id = "a", extra = {}) => ({ id, status: "active", createdAt: date("02"), locationId: "local", total: 1000, paymentMethod: "cash", items: [{ productId: "oil", name: "Aceite", qty: 2, unitPrice: 500, subtotal: 1000, unitCost: 200 }], ...extra });
const month = buildMetricsDateRange("month", "2026-10"), day = buildMetricsDateRange("day", "2026-10-02");
const config = { versions: [{ version: 1, effectiveFrom: "2026-01-01", fees: { cash: { percent: 0 }, alias: { percent: 10, settlementDays: 2 }, payway: { percent: 5, settlementDays: 2 } }, taxPercent: 0 }] };

test("CRM enriquece campos vacíos, conserva datos conocidos y declara conflictos", () => {
  const result = customerEnrichment({ name: "Ana", phone: "11-1234-5678" }, { name: "Otro nombre", zoneName: "CABA", phone: "+54 9 11 1234-5678" });
  assert.equal(result.patch.name, undefined); assert.equal(result.patch.zoneName, "CABA"); assert.equal(result.conflicts[0].field, "name"); assert.equal(result.patch.phone, undefined);
});
test("CRM usa identidad/alias/teléfono, excluye anulaciones y no inventa fidelización", () => {
  const customers = [{ id: "customer", previousCustomerIds: ["old"], phoneNormalized: "1112345678" }];
  const sales = [sale("a", { customerId: "old" }), sale("b", { customerPhoneSnapshot: "+54 9 11 1234-5678", createdAt: date("03") }), sale("c", { customerId: "customer", status: "cancelled" }), sale("d", { customerId: "customer", deleted: true })];
  const stats = customerPurchaseIndex(customers, sales, [{ id: "oil", categoryId: "food" }], {}, date("05")).get("customer");
  assert.equal(stats.count, 2); assert.equal(stats.total, 2000); assert.equal(stats.loyal, null); assert.equal(stats.averageDays, 1); assert.equal(stats.lastPurchaseAt.getTime(), date("03").getTime());
  const configured = customerPurchaseIndex(customers, sales, [{ id: "oil", categoryId: "food" }], { enabled: true, minPurchases: 2, windowDays: 4, minCategories: 1 }, date("05")).get("customer");
  assert.equal(configured.loyal, true); assert.equal(matchesCustomerSegment(customers[0], configured, { loyalty: "loyal", categoryId: "food", productId: "oil", maxFrequencyDays: 2, lastSince: "2026-10-03" }), true);
  assert.throws(() => validateLoyaltyPolicy({ enabled: true }), /Definí/);
});
test("Métricas y Finanzas cuentan una venta con factura una sola vez; cancelación y vacío coherentes", () => {
  const one = sale("a", { fiscalInvoiceId: "invoice", invoiceStatus: "authorized" });
  const sales = [one, one, sale("cancel", { status: "cancelled" }), sale("deleted", { deleted: true })];
  assert.equal(calculateMetrics(sales, month).total, 1000); assert.equal(financeSummary(sales, [], config, month).saleIncome, 1000);
  assert.equal(financeSummary([], [], {}, month).result, 0); assert.equal(calculateMetrics([], month).ticket, 0);
});
test("Pagos combinados y ecommerce conservan importes y métodos reales", () => {
  const sales = [sale("split", { paymentMethod: "multiple", payments: [{ method: "cash", amount: 400 }, { method: "alias", amount: 600 }] }), sale("web", { paymentMethod: "payway", paymentMethodLabel: "Payway", sourceChannel: "ecommerce" })];
  const result = calculateMetrics(sales, month); assert.equal(result.byPayment.reduce((sum, part) => sum + part.total, 0), 2000); assert.equal(result.byPayment.find(part => (part.id || part.key) === "payway").total, 1000); assert.equal(financeSummary(sales, [], config, month).cashMovement, 400);
});
test("Bloques horarios inclusivos: 10:53 a 19:05 son diez horas; extiende ventas tras cierre", () => {
  const sales = [sale("a", { createdAt: new Date("2026-10-02T13:53:00Z") }), sale("b", { createdAt: new Date("2026-10-02T22:05:00Z") })];
  assert.equal(operatingAverage(sales, day, { id: "local" }).denominator, 10);
  assert.equal(operatingAverage(sales, day, { id: "local", operatingCalendar: { openingTime: "09:00", closingTime: "18:00" } }).denominator, 11);
  assert.equal(operatingAverage([], day, { id: "local" }).average, null);
});
test("Calendario mensual excluye feriados sin ventas, incluye feriado vendido y divide anual por doce", () => {
  const location = { id: "local", operatingCalendar: { dates: ["2026-10-01", "2026-10-02", "2026-10-03"] } };
  assert.equal(operatingAverage([], month, location).average, null);
  const result = operatingAverage([sale()], month, location, { 2026: ["2026-10-02", "2026-10-03"] });
  assert.equal(result.denominator, 2); assert.equal(result.average, 500);
  assert.equal(operatingAverage([sale()], buildMetricsDateRange("year", "2026"), location).denominator, 12);
  assert.throws(() => validateHolidays("2026", ["2026-02-30"]), /fechas reales/);
});
test("Categorías no duplican ventas al repetir un producto; explicitan subtotales", () => {
  const result = metricsByCategory([sale("a", { items: [{ productId: "oil", qty: 1, subtotal: 500 }, { productId: "oil", qty: 1, subtotal: 500 }] })], [{ id: "oil", categoryId: "food" }], [{ id: "food", name: "Alimentos" }]);
  assert.equal(result[0].sales, 1); assert.equal(result[0].items, 2); assert.equal(result[0].total, 1000);
});
test("Finanzas usa costos explícitos y versiones vigentes; gastos y presupuestos no son nuevos ingresos", () => {
  const entries = [{ id: "expense", type: "expense", category: "Servicios", amount: 100, accruedOn: "2026-10-02", paidOn: "2026-10-03", cashAccount: "cash" }, { id: "budget", type: "budget", category: "Servicios", month: "2026-10", amount: 200, threshold: 50, scope: "general" }];
  const result = financeSummary([sale()], entries, config, month);
  assert.equal(result.contribution, 600); assert.equal(result.result, 500); assert.equal(result.cashMovement, 900); assert.equal(result.budgets[0].percentage, 50);
  const unknown = financeSummary([sale("a", { items: [{ productId: "oil", qty: 2 }] })], [], {}, month); assert.equal(unknown.contribution, null); assert.equal(unknown.missingCost, 2); assert.equal(unknown.commissions, null);
  assert.equal(financeSummary([sale()], [], { versions: [{ ...config.versions[0], effectiveFrom: "2026-11-01" }] }, month).taxes, null);
});
test("Acreditación: sin alerta dentro del plazo, vencida o distinta sí; evidencia posterior resuelve", () => {
  const sales = [sale("bank", { paymentMethod: "alias" })];
  assert.equal(expectedSettlements(sales, config, [], date("03"))[0].discrepancy, false);
  assert.equal(expectedSettlements(sales, config, [], date("05"))[0].discrepancy, true);
  const id = expectedSettlements(sales, config)[0].id;
  assert.equal(expectedSettlements(sales, config, [{ id, type: "settlement", amount: 900 }], date("05"))[0].state, "Conciliado");
  assert.equal(expectedSettlements(sales, config, [{ id, type: "settlement", amount: 890 }], date("05"))[0].discrepancy, true);
  assert.equal(expectedSettlements(sales, {}, [], date("05"))[0].discrepancy, false);
});
test("Caja bancaria usa fecha efectiva y mantiene evidencia de ventas de otro período", () => {
  const result = financeSummary([], [{ id: "settlement_old_alias", type: "settlement", amount: 900, paidOn: "2026-10-02" }, { id: "due", type: "expense", amount: 200, accruedOn: "2026-10-01", dueOn: "2026-10-20" }], config, month, [], date("05"));
  assert.equal(result.bankMovement, 900); assert.equal(result.saleIncome, 0); assert.equal(result.projected[0].amount, -200);
});
test("Gastos externos validan datos y evitan ingresos manuales asociados a una venta/factura", () => {
  const input = { type: "expense", name: "Servicio", amount: "19.99", category: "Servicios", nature: "fixed", scope: "general", accruedOn: "2026-10-02" };
  assert.equal(validateFinancialEntry(input).amount, 19.99); assert.throws(() => validateFinancialEntry({ ...input, type: "external_income", saleId: "a" }), /duplicar/); assert.throws(() => validateFinancialEntry({ ...input, paidOn: "2026-10-03" }), /efectivo o bancario/); assert.throws(() => validateFinancePolicy({ effectiveFrom: "2026-10-01", fees: { alias: { percent: 120 } } }), /Comisión/);
});

test("Presupuesto general no cambia su gasto global al filtrar una ubicación", () => {
  const entries = [{ id: "a", type: "expense", category: "Servicios", amount: 100, accruedOn: "2026-10-02", scope: "location", locationId: "a" }, { id: "b", type: "expense", category: "Servicios", amount: 200, accruedOn: "2026-10-02", scope: "location", locationId: "b" }, { id: "budget", type: "budget", category: "Servicios", month: "2026-10", amount: 500, threshold: 80, scope: "general" }];
  const result = financeSummary([], entries, {}, month, ["a"]);
  assert.equal(result.expenseTotal, 100); assert.equal(result.budgets[0].spent, 300);
  assert.equal(financeSummary([sale("cancelled", { status: "cancelled", paymentMethod: "alias" })], [], {}, month).inactiveSettlementIds[0], "settlement_cancelled_alias");
});

test("Categoría sin productos no devuelve todas las ventas y categoría histórica conserva su filtro", () => {
  assert.equal(applyMetricsFilters([sale()], { categoryIds: ["missing"], categoryProductIds: [] }, month).length, 0);
  assert.equal(applyMetricsFilters([sale("snapshot", { items: [{ categoryId: "historical", qty: 1 }] })], { categoryIds: ["historical"] }, month).length, 1);
});

test("Compras de inventario conservan egreso y caja sin descontar mercadería dos veces del resultado", () => {
  const result = financeSummary([sale()], [{ id: "inventory", type: "expense", category: "Mercadería", amount: 300, accruedOn: "2026-10-02", paidOn: "2026-10-02", cashAccount: "cash" }], config, month);
  assert.equal(result.contribution, 600); assert.equal(result.expenseTotal, 300); assert.equal(result.cashMovement, 700);
  assert.equal(result.inventoryTreatmentPending, true); assert.equal(result.result, null);
  assert.equal(financeSummary([sale("missing-qty", { items: [{ unitCost: 200 }] })], [], config, month).contribution, null);
});
