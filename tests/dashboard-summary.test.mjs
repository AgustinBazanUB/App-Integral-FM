import test from "node:test";
import assert from "node:assert/strict";
import { dashboardGreeting, summarizeDashboardPayments } from "../src/gestion/dashboardPresentation.js";
import { SINGLE_PAYMENT_METHODS, PAYMENT_LABELS } from "../src/modules/locations/domain/payments.js";
import { summarizeSales, buildPeriodSalesSeries } from "../src/modules/locations/domain/dashboard.js";
import { argentinaPeriodRange } from "../src/modules/locations/domain/time.js";
import { applyMetricsFilters, calculateMetrics } from "../src/modules/locations/domain/metrics.js";
import { alertContextPath, alertPresentation, groupActiveAlerts, prioritizeAlerts } from "../src/modules/alerts/domain/alerts.js";

const sale = (id, total, date, extra = {}) => ({ id, total, createdAt: new Date(date), status: "active", paymentMethod: "cash", locationId: "local", ...extra });

test("saludo contextual con hora de Argentina, nombre y fallback", () => {
  assert.equal(dashboardGreeting("  Ana Pérez", new Date("2026-10-02T11:00:00Z")), "Buen día, Ana.");
  assert.equal(dashboardGreeting("Ana", new Date("2026-10-02T18:00:00Z")), "Buenas tardes, Ana.");
  assert.equal(dashboardGreeting(undefined, new Date("2026-10-03T01:00:00Z")), "Buenas noches, equipo.");
});

test("pagos múltiples, descuentos, anulaciones y ventas facturadas no duplican ingresos", () => {
  const invoiced = sale("fiscal", 900, "2026-10-02T13:00:00Z", { invoiceStatus: "authorized", invoiceId: "factura", invoiceTotal: 900, discountTotal: 100 });
  const multiple = sale("mixta", 100, "2026-10-02T13:00:00Z", { paymentMethod: "multiple", payments: [{ method: "cash", amount: 40 }, { method: "debit", amount: 60 }] });
  const sales = [invoiced, invoiced, multiple, sale("anulada", 8000, "2026-10-02T13:00:00Z", { status: "cancelled" }), sale("baja", 5000, "2026-10-02T13:00:00Z", { deleted: true })];
  const breakdown = summarizeDashboardPayments(sales);
  assert.equal(breakdown.count, 2);
  assert.equal(breakdown.total, 1000);
  assert.equal(summarizeSales(sales).average, 500);
  assert.equal(breakdown.rows.find((row) => row.key === "cash").total, 940);
  assert.equal(breakdown.rows.find((row) => row.key === "debit").percentage, 6);
  assert.equal(breakdown.rows.reduce((sum, row) => sum + row.total, 0), 1000);
  const metrics = calculateMetrics([invoiced, multiple], argentinaPeriodRange("day", "2026-10-02"));
  for (const row of metrics.byPayment) assert.equal(breakdown.rows.find((item) => item.key === row.key).total, row.total);
});

test("sin ventas se conservan las categorías centrales con ceros finitos", () => {
  const breakdown = summarizeDashboardPayments([]);
  assert.equal(breakdown.total, 0);
  assert.equal(breakdown.count, 0);
  assert.deepEqual(breakdown.rows.map((row) => row.key), SINGLE_PAYMENT_METHODS);
  for (const row of breakdown.rows) {
    assert.equal(row.name, PAYMENT_LABELS[row.key]);
    assert.equal(row.total, 0);
    assert.equal(row.percentage, 0);
  }
});

test("pagos desconocidos e inconsistentes son visibles sin inventar una distribución", () => {
  const unknown = summarizeDashboardPayments([sale("legacy", 100, "2026-10-02T13:00:00Z", { paymentMethod: "legacy" })]);
  assert.equal(unknown.rows.find((row) => row.key === "unclassified").total, 100);
  const inconsistent = summarizeDashboardPayments([sale("bad", 100, "2026-10-02T13:00:00Z", { paymentMethod: "multiple", payments: [{ method: "cash", amount: 120 }] })]);
  assert.equal(inconsistent.inconsistentSales, 1);
  assert.equal(inconsistent.total, 100);
});

test("día y mes comparten límites, ubicación y dataset para resumen, ritmo y pagos", () => {
  const sales = [
    sale("previo", 800, "2026-10-02T02:59:59Z"),
    sale("inicio", 100, "2026-10-02T03:00:00Z"),
    sale("otro-dia", 200, "2026-10-03T03:00:00Z"),
    sale("otro-mes", 900, "2026-11-01T03:00:00Z"),
    sale("otra-ubicacion", 700, "2026-10-02T13:00:00Z", { locationId: "feria" }),
  ];
  for (const [format, expected] of [["day", 100], ["month", 1100]]) {
    const range = argentinaPeriodRange(format, "2026-10-02");
    const filtered = applyMetricsFilters(sales, { locationIds: ["local"] }, range);
    assert.equal(summarizeSales(filtered).total, expected);
    assert.equal(summarizeDashboardPayments(filtered).total, expected);
    assert.equal(buildPeriodSalesSeries(filtered, range, format).reduce((sum, point) => sum + point.value, 0), expected);
  }
});

test("alertas críticas antiguas preceden preventivas y avisos; se excluyen cerradas y eliminadas", () => {
  const alerts = [
    { id: "info", active: true, status: "new", updatedAt: new Date("2026-10-02") },
    { id: "yellow", active: true, severity: "warning" },
    { id: "red", active: true, priority: "critical", updatedAt: new Date("2026-09-01") },
    { id: "closed", active: true, status: "resolved", severity: "critical" },
    { id: "deleted", active: true, deleted: true },
    { id: "inactive", active: false },
  ];
  assert.deepEqual(prioritizeAlerts(alerts).map((alert) => alert.id), ["red", "yellow", "info"]);
  assert.equal(alerts[0].id, "info");
});

test("campanita agrupa pendientes en rojo, amarillo y verde sin duplicar ni contar cerradas", () => {
  const alerts = [
    { id: "notice", status: "new" },
    { id: "warning", color: "amarilla" },
    { id: "critical", severity: "critical" },
    { id: "closed", status: "resolved", severity: "critical" },
    { id: "inactive", active: false },
  ];
  const groups = groupActiveAlerts(alerts);
  assert.deepEqual(groups.map((group) => [group.key, group.alerts.map((alert) => alert.id)]), [
    ["critical", ["critical"]], ["preventive", ["warning"]], ["notice", ["notice"]],
  ]);
  assert.equal(groups.reduce((count, group) => count + group.alerts.length, 0), 3);
  assert.equal(alertPresentation(alerts[0]).tone, "success");
  assert.equal(alertPresentation(alerts[1]).tone, "warning");
  assert.equal(alertPresentation(alerts[2]).tone, "error");
  assert.equal(alerts.length, 5);
  assert.deepEqual(groupActiveAlerts().map((group) => group.alerts.length), [0, 0, 0]);
});

test("alertas navegan al stock, ubicación o módulo sin salir de rutas autorizadas", () => {
  assert.equal(alertContextPath({ locationId: "local", productId: "aceite" }, ["local"], true), "/gestion/locations/local/stock");
  assert.equal(alertContextPath({ locationId: "feria /1", type: "low_stock" }, ["feria /1"], true), "/gestion/locations/feria%20%2F1/stock");
  assert.equal(alertContextPath({ locationId: "local" }, ["local"], true), "/gestion/locations/local");
  assert.equal(alertContextPath({ locationId: "otra" }, ["local"], true), "/gestion/alerts");
  assert.equal(alertContextPath({ locationId: "local" }, ["local"], false), "/gestion/alerts");
  assert.equal(alertContextPath({ locationId: "local", productId: "aceite" }, ["local"], true, false), "/gestion/alerts");
  assert.equal(alertContextPath({ href: "https://external.invalid", entityId: "unknown" }), "/gestion/alerts");
});
