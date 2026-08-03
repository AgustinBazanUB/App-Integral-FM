import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("el panel usa Venta Rápida y enlaza el flujo existente", async () => {
  const source = await read("../src/gestion/pages/DashboardPage.jsx");
  assert.match(source, />Venta Rápida</);
  assert.match(source, /to="\/gestion\/quick-sales"/);
  assert.doesNotMatch(source, />Nueva venta</);
});

test("el panel incluye período mensual, análisis y actividad ampliable", async () => {
  const source = await read("../src/gestion/pages/DashboardPage.jsx");
  assert.match(source, /MonthSelector/);
  assert.match(source, /Ventas del mes/);
  assert.match(source, /Facturación del mes/);
  assert.match(source, /\/gestion\/metrics\/sales/);
  assert.match(source, /\/gestion\/actividad/);
});

test("las tarjetas de módulos renderizan iconos semánticos y no números", async () => {
  const source = await read("../src/gestion/pages/DashboardPage.jsx");
  assert.match(source, /fm-module-card__icon/);
  assert.doesNotMatch(source, /fm-module-card__number/);
});

test("la ubicación conserva el orden operativo de sus cuatro secciones", async () => {
  const source = await read("../src/gestion/pages/LocationDetailPage.jsx");
  const products = source.indexOf('{ id: "products"');
  const stock = source.indexOf('{ id: "stock"');
  const sellers = source.indexOf('{ id: "sellers"');
  const discounts = source.indexOf('{ id: "discounts"');
  assert.ok(products >= 0 && products < stock && stock < sellers && sellers < discounts);
});

test("las consultas de ventas usan rango y la actividad usa cursor", async () => {
  const source = await read("../src/gestion/services/dashboardService.js");
  assert.match(source, /where\("createdAt", ">=", Timestamp\.fromDate\(start\)\)/);
  assert.match(source, /where\("createdAt", "<", Timestamp\.fromDate\(end\)\)/);
  assert.match(source, /startAfter\(cursor\[key\]\)/);
  assert.match(source, /limit\(pageSize \+ 1\)/);
});

test("Ubicaciones comienza con ubicaciones y eventos, sin tarjetas de métricas", async () => {
  const source = await read("../src/gestion/pages/LocationsPage.jsx");
  assert.match(source, /title="Ubicaciones y eventos"/);
  assert.doesNotMatch(source, /fm-stat-grid/);
});
