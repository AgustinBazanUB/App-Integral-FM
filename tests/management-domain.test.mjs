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
  can,
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
