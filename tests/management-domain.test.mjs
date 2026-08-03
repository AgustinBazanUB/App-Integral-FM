import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateDiscountSummary,
} from "../src/modules/locations/domain/discounts.js";
import {
  locationActivity,
} from "../src/modules/locations/domain/locations.js";
import {
  normalizePayment,
} from "../src/modules/locations/domain/payments.js";
import {
  calculateStockAfterSale,
} from "../src/modules/locations/domain/sales.js";
import {
  buildSevenDaySalesSeries,
  joinMasterProducts,
  summarizeSales,
} from "../src/modules/locations/domain/dashboard.js";
import {
  argentinaDateKey,
  argentinaMonthRange,
  lastSevenArgentinaDays,
} from "../src/modules/locations/domain/time.js";
import {
  can,
  canAccessAdministration,
  visibleBusinessModules,
} from "../src/gestion/permissions.js";

test("la venta no puede dejar stock negativo", () => {
  assert.equal(calculateStockAfterSale(8, 3, "Aceite"), 5);
  assert.throws(
    () => calculateStockAfterSale(2, 3, "Aceite"),
    /No hay stock suficiente/,
  );
});

test("los descuentos múltiples se aplican de forma secuencial", () => {
  const result = calculateDiscountSummary(
    [
      { id: "porcentaje", name: "Autorizado", type: "percent", value: 10 },
      { id: "fijo", name: "Autorizado", type: "fixed", value: 100 },
    ],
    1000,
  );
  assert.equal(result.total, 800);
  assert.equal(result.discountTotal, 200);
});

test("el pago simple conserva las etiquetas compatibles con las reglas existentes", () => {
  assert.deepEqual(normalizePayment("cash", "", [], 1500), {
    paymentMethod: "cash",
    paymentMethodLabel: "Pago eft",
  });
});

test("una ubicación pausada no se considera activa", () => {
  const now = new Date("2026-08-03T12:00:00-03:00");
  const state = locationActivity(
    {
      active: true,
      manualInactiveUntil: new Date("2026-08-04T12:00:00-03:00"),
    },
    now,
  );
  assert.equal(state.active, false);
});

test("un vendedor sólo ve módulos operativos autorizados", () => {
  const seller = { id: "seller-1", active: true, role: "seller" };
  assert.equal(can(seller, "locations", "view"), true);
  assert.equal(can(seller, "finance", "view"), false);
  assert.deepEqual(
    visibleBusinessModules(seller).map((module) => module.id),
    ["locations", "quick-sales", "alerts"],
  );
});

test("las denegaciones individuales prevalecen sobre la plantilla de rol", () => {
  const profile = {
    id: "admin-1",
    active: true,
    role: "operational_admin",
    permissionDeny: { locations: ["create"] },
  };
  assert.equal(can(profile, "locations", "view"), true);
  assert.equal(can(profile, "locations", "create"), false);
});

test("los meses se delimitan a medianoche de Argentina sin corrimiento UTC", () => {
  const range = argentinaMonthRange("2026-08");
  assert.equal(range.start.toISOString(), "2026-08-01T03:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-09-01T03:00:00.000Z");
  assert.equal(argentinaDateKey(new Date("2026-08-01T02:59:59.000Z")), "2026-07-31");
});

test("el resumen mensual excluye anuladas, bajas y ventas duplicadas", () => {
  const result = summarizeSales([
    { id: "a", status: "active", total: 100 },
    { id: "a", status: "active", total: 100 },
    { id: "b", status: "cancelled", total: 500 },
    { id: "c", status: "active", total: 300, deleted: true },
  ]);
  assert.equal(result.count, 1);
  assert.equal(result.total, 100);
  assert.equal(result.average, 100);
});

test("el ritmo de ventas siempre contiene siete días y completa ceros", () => {
  const now = new Date("2026-08-03T15:00:00.000Z");
  const range = lastSevenArgentinaDays(now);
  const series = buildSevenDaySalesSeries([
    { id: "a", status: "active", total: 250, createdAt: new Date("2026-08-03T02:30:00.000Z") },
    { id: "b", status: "active", total: 400, createdAt: new Date("2026-08-03T12:00:00.000Z") },
  ], now);
  assert.equal(series.length, 7);
  assert.equal(range.end.toISOString(), "2026-08-04T03:00:00.000Z");
  assert.equal(series.at(-1).key, "2026-08-03");
  assert.equal(series.at(-1).value, 400);
  assert.equal(series.at(-2).value, 250);
});

test("el catálogo maestro aparece en una ubicación nueva sin duplicar productos", () => {
  const joined = joinMasterProducts([
    { id: "p1", name: "Aceite", active: true, defaultPrice: 1000 },
    { id: "p2", name: "Aceitunas", active: true, defaultPrice: 500 },
  ], [{ id: "p1", productId: "p1", currentStock: 4, price: 900, active: true }]);
  assert.equal(joined.length, 2);
  assert.equal(joined.find((item) => item.id === "p1").currentStock, 4);
  assert.equal(joined.find((item) => item.id === "p2").currentStock, 0);
  assert.equal(joined.find((item) => item.id === "p2").configured, false);
});

test("el vendedor puede consultar stock pero no cargarlo ni administrar descuentos", () => {
  const seller = { id: "seller-1", active: true, role: "seller" };
  assert.equal(can(seller, "locations", "viewStock"), true);
  assert.equal(can(seller, "locations", "loadStock"), false);
  assert.equal(can(seller, "locations", "assignDiscounts"), false);
});

test("el administrador general conserva acceso a la administración", () => {
  assert.equal(canAccessAdministration({ id: "general-1", active: true, role: "general_admin" }), true);
});
