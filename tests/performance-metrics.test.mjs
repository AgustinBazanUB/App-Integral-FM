import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyMetricsFilters,
  buildMetricsCustomRange,
  buildMetricsDateRange,
  calculateMetrics,
} from "../src/modules/locations/domain/metrics.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const baseSale = {
  status: "active",
  locationId: "loc-1",
  locationName: "Tribunales",
  sellerId: "seller-1",
  sellerName: "Juan",
  items: [{ productId: "oil-1", name: "Arbequina", qty: 2, unitPrice: 10000, subtotal: 20000 }],
  discounts: [{ discountId: "cash-10", name: "Efectivo", source: "saved", type: "percent", value: 10, amountApplied: 2000 }],
  discountTotal: 2000,
  total: 18000,
  paymentMethod: "cash",
  createdAt: new Date("2026-08-07T15:00:00.000Z"),
};

test("métricas soporta día, mes, año y rango con límites exclusivos", () => {
  const day = buildMetricsDateRange("day", "2026-08-07");
  assert.equal(day.period, "day");
  assert.ok(day.end > day.start);
  const month = buildMetricsDateRange("month", "2026-08");
  assert.equal(month.period, "month");
  const year = buildMetricsDateRange("year", "2026");
  assert.equal(year.period, "year");
  const custom = buildMetricsCustomRange("2026-08-01", "2026-08-07");
  assert.equal(custom.period, "custom");
  assert.ok(custom.end > custom.start);
});

test("los filtros de métricas se combinan sobre un único dataset", () => {
  const range = buildMetricsCustomRange("2026-08-01", "2026-08-10");
  const sales = [baseSale, { ...baseSale, locationId: "loc-2", sellerId: "seller-2", paymentMethod: "debit", discounts: [], discountTotal: 0 }];
  const result = applyMetricsFilters(sales, {
    locationIds: ["loc-1"],
    sellerIds: ["seller-1"],
    productIds: ["oil-1"],
    discountIds: ["cash-10"],
    paymentMethods: ["cash"],
  }, range);
  assert.equal(result.length, 1);
  assert.equal(result[0].locationId, "loc-1");
});

test("Sin descuento combina correctamente con descuentos configurados", () => {
  const range = buildMetricsCustomRange("2026-08-01", "2026-08-10");
  const noDiscount = { ...baseSale, discounts: [], discountTotal: 0, sellerId: "seller-2" };
  assert.equal(applyMetricsFilters([baseSale, noDiscount], { discountIds: ["__none"] }, range).length, 1);
  assert.equal(applyMetricsFilters([baseSale, noDiscount], { discountIds: ["__none", "cash-10"] }, range).length, 2);
});

test("+2 pagos se distribuye por monto y no duplica el total", () => {
  const range = buildMetricsCustomRange("2026-08-01", "2026-08-10");
  const sale = {
    ...baseSale,
    total: 100000,
    paymentMethod: "multiple",
    payments: [
      { method: "cash", amount: 40000 },
      { method: "debit", amount: 60000 },
    ],
  };
  const metrics = calculateMetrics([sale], range);
  assert.equal(metrics.byPayment.find((row) => row.key === "cash").total, 40000);
  assert.equal(metrics.byPayment.find((row) => row.key === "debit").total, 60000);
  assert.equal(metrics.byPayment.reduce((sum, row) => sum + row.total, 0), 100000);
});

test("la granularidad del gráfico se adapta al período", () => {
  assert.equal(calculateMetrics([baseSale], buildMetricsDateRange("day", "2026-08-07")).timelineMode, "hour");
  assert.equal(calculateMetrics([baseSale], buildMetricsDateRange("month", "2026-08")).timelineMode, "day");
  assert.equal(calculateMetrics([baseSale], buildMetricsDateRange("year", "2026")).timelineMode, "month");
  assert.equal(calculateMetrics([baseSale], buildMetricsCustomRange("2026-01-01", "2026-06-30")).timelineMode, "month");
});

test("la aplicación separa bundles, mantiene vendedor disponible y conserva offline pendiente", () => {
  const app = read("src/App.jsx");
  const management = read("src/gestion/ManagementApp.jsx");
  const sellerHooks = read("src/gestion/seller/hooks.js");
  const seller = read("src/gestion/seller/SellerPanel.jsx");
  assert.match(app, /lazy\(\(\) => import\("\.\/Storefront"\)\)/);
  assert.match(management, /import SellerPanel from "\.\/seller\/SellerPanel"/);
  assert.doesNotMatch(management, /const SellerPanel = lazy/);
  assert.doesNotMatch(management, /loadSellerPanel\(\)/);
  assert.match(management, /Promise\.all\(\[/);
  assert.match(management, /listLocationsShared\(profile\)/);
  assert.match(management, /loadSellerResourcesShared\(profile\)/);
  assert.match(management, /class ManagementErrorBoundary extends Component/);
  assert.doesNotMatch(management, /requestIdleCallback/);
  assert.match(sellerHooks, /getSellerResourcesSharedCached/);
  assert.match(sellerHooks, /const current = handlers\.current;/);
  assert.match(sellerHooks, /!current\.enabled/);
  assert.match(sellerHooks, /window\.addEventListener\("keydown", onKeyDown, true\)/);
  assert.match(sellerHooks, /keyboardLookupKeys/);
  assert.match(sellerHooks, /new Map\(\)/);
  assert.match(seller, /if \(!selectedLocation\) return \[\];/);
  assert.match(seller, /saveSellerPendingSale/);
  assert.match(seller, /syncPending/);
});

test("Dashboard ofrece Cargar Stock y acceso directo a métricas sin nueva selección", () => {
  const dashboard = read("src/gestion/pages/DashboardPage.jsx");
  assert.match(dashboard, /Cargar Stock/);
  assert.match(dashboard, /¿En qué ubicación querés cargar el stock\?/);
  assert.match(dashboard, /\/gestion\/locations\/\$\{encodeURIComponent\(locationId\)\}\/stock/);
  assert.match(dashboard, /Ver todas las métricas/);
  assert.match(dashboard, /listLocationsShared/);
});

test("el estado de conexión es compartido y Reconectar consulta un documento", () => {
  const connection = read("src/gestion/connection.js");
  const shell = read("src/gestion/ManagementShell.jsx");
  assert.match(connection, /getDocFromServer/);
  assert.match(connection, /reconnecting/);
  assert.match(shell, /ConnectionIndicator/);
});

test("las escrituras del vendedor toleran temporalmente reglas Firestore anteriores", () => {
  const sellerService = read("src/gestion/services/sellerService.js");
  assert.match(sellerService, /runStockMutationWithRuleCompatibility/);
  assert.match(sellerService, /permission-denied/);
  assert.match(sellerService, /legacy \? \{\} : \{ lastMovementId \}/);
  assert.match(sellerService, /createSellerSale[\s\S]*runStockMutationWithRuleCompatibility/);
  assert.match(sellerService, /updateSellerSale[\s\S]*runStockMutationWithRuleCompatibility/);
  assert.match(sellerService, /cancelSellerSale[\s\S]*runStockMutationWithRuleCompatibility/);
});
