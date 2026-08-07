import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  argentinaPeriodLabel,
  argentinaPeriodRange,
  canAdvanceArgentinaPeriod,
  shiftArgentinaPeriodReference,
} from "../src/modules/locations/domain/time.js";
import { buildPeriodSalesSeries, summarizeSales } from "../src/modules/locations/domain/dashboard.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const dashboardPage = read("src/gestion/pages/DashboardPage.jsx");
const dashboardFilters = read("src/gestion/components/DashboardFilters.jsx");
const dashboardService = read("src/gestion/services/dashboardService.js");
const hooks = read("src/gestion/hooks.js");
const styles = read("src/styles/dashboard-filters.css");
const iso = (value) => value.toISOString();

test("los rangos usan límites inclusivos y finales exclusivos de Buenos Aires", () => {
  const year = argentinaPeriodRange("year", "2026-08-06");
  assert.equal(iso(year.start), "2026-01-01T03:00:00.000Z");
  assert.equal(iso(year.end), "2027-01-01T03:00:00.000Z");
  const month = argentinaPeriodRange("month", "2026-08-06");
  assert.equal(iso(month.start), "2026-08-01T03:00:00.000Z");
  assert.equal(iso(month.end), "2026-09-01T03:00:00.000Z");
  const day = argentinaPeriodRange("day", "2026-08-06");
  assert.equal(iso(day.start), "2026-08-06T03:00:00.000Z");
  assert.equal(iso(day.end), "2026-08-07T03:00:00.000Z");
});

test("la semana comienza el lunes y cruza meses o años sin corrimiento", () => {
  const august = argentinaPeriodRange("week", "2026-08-06");
  assert.equal(iso(august.start), "2026-08-03T03:00:00.000Z");
  assert.equal(iso(august.end), "2026-08-10T03:00:00.000Z");
  assert.equal(argentinaPeriodLabel("week", "2026-08-06"), "3 al 9 de agosto de 2026");
  const boundary = argentinaPeriodRange("week", "2026-12-31");
  assert.equal(iso(boundary.start), "2026-12-28T03:00:00.000Z");
  assert.equal(iso(boundary.end), "2027-01-04T03:00:00.000Z");
  assert.match(argentinaPeriodLabel("week", "2026-12-31"), /28 de diciembre de 2026 al 3 de enero de 2027/);
});

test("las flechas avanzan exactamente una unidad y bloquean períodos futuros", () => {
  assert.equal(shiftArgentinaPeriodReference("year", "2026-08-06", -1), "2025-08-06");
  assert.equal(shiftArgentinaPeriodReference("month", "2026-08-06", -1), "2026-07-06");
  assert.equal(shiftArgentinaPeriodReference("week", "2026-08-06", -1), "2026-07-30");
  assert.equal(shiftArgentinaPeriodReference("day", "2026-08-06", -1), "2026-08-05");
  const now = new Date("2026-08-06T15:00:00.000Z");
  assert.equal(canAdvanceArgentinaPeriod("month", "2026-08-06", now), false);
  assert.equal(canAdvanceArgentinaPeriod("week", "2026-08-06", now), false);
  assert.equal(canAdvanceArgentinaPeriod("day", "2026-08-05", now), true);
  assert.equal(canAdvanceArgentinaPeriod("day", "2026-08-06", now), false);
});

test("el ritmo de ventas se adapta al año, mes, semana y día", () => {
  const sales = [
    { id: "a", status: "active", total: 100, createdAt: new Date("2026-08-06T13:30:00.000Z") },
    { id: "a", status: "active", total: 100, createdAt: new Date("2026-08-06T13:30:00.000Z") },
    { id: "b", status: "cancelled", total: 900, createdAt: new Date("2026-08-06T14:30:00.000Z") },
  ];
  assert.equal(summarizeSales(sales).total, 100);
  assert.equal(buildPeriodSalesSeries(sales, argentinaPeriodRange("year", "2026-08-06"), "year").length, 12);
  assert.equal(buildPeriodSalesSeries(sales, argentinaPeriodRange("month", "2026-08-06"), "month").length, 31);
  assert.equal(buildPeriodSalesSeries(sales, argentinaPeriodRange("week", "2026-08-06"), "week").length, 7);
  const day = buildPeriodSalesSeries(sales, argentinaPeriodRange("day", "2026-08-06"), "day");
  assert.equal(day.length, 24);
  assert.equal(day.reduce((sum, point) => sum + point.value, 0), 100);
});

test("el Panel General conserva un único selector principal y elimina la evaluación", () => {
  assert.match(dashboardPage, /<DashboardFilters/);
  assert.doesNotMatch(dashboardPage, /function MonthSelector/);
  assert.doesNotMatch(dashboardPage, /aria-label="Mes"/);
  assert.doesNotMatch(dashboardPage, /aria-label="Año"/);
  assert.doesNotMatch(dashboardPage, /Evaluación de las ventas/i);
  assert.match(dashboardPage, /buildPeriodSalesSeries/);
});

test("el selector ofrece formatos exactos y calendarios adaptativos", () => {
  for (const option of ["Año", "Mes", "Semana", "Día"]) assert.match(dashboardFilters, new RegExp(`label: "${option}"`));
  assert.match(dashboardFilters, /YearPicker/);
  assert.match(dashboardFilters, /MonthPicker/);
  assert.match(dashboardFilters, /DayWeekPicker/);
  assert.match(dashboardFilters, /aria-haspopup="dialog"/);
  assert.match(dashboardFilters, /aria-label="Formato temporal"/);
  assert.match(dashboardFilters, /No se puede avanzar a un período futuro/);
});

test("el filtro separa ubicaciones activas e inactivas y permite aplicar múltiples", () => {
  assert.match(dashboardFilters, /locationActivity\(location\)\.active/);
  assert.match(dashboardFilters, /title="Activas"/);
  assert.match(dashboardFilters, /title="Inactivas"/);
  assert.match(dashboardFilters, /Seleccionar todas/);
  assert.match(dashboardFilters, /Limpiar selección/);
  assert.match(dashboardFilters, /Aplicar/);
  assert.match(dashboardFilters, /type="checkbox"/);
});

test("las consultas permanecen acotadas, autorizadas, agrupadas y sin duplicados", () => {
  assert.match(dashboardService, /allowedIds\(profile, locationIds\)/);
  assert.match(dashboardService, /chunk\(scopedIds\)/);
  assert.match(dashboardService, /where\("locationId", "in", ids\)/);
  assert.match(dashboardService, /where\("status", "==", "active"\)/);
  assert.match(dashboardService, /where\("createdAt", ">=", Timestamp\.fromDate\(start\)\)/);
  assert.match(dashboardService, /where\("createdAt", "<", Timestamp\.fromDate\(end\)\)/);
  assert.match(dashboardService, /const unique = new Map/);
});

test("las respuestas antiguas se ignoran y el diseño es responsive y accesible", () => {
  assert.match(hooks, /requestSequence/);
  assert.match(hooks, /requestSequence\.current !== requestId/);
  assert.match(styles, /min-height: 44px/);
  assert.match(styles, /@media \(max-width: 768px\)/);
  assert.match(styles, /@media \(max-width: 480px\)/);
  assert.match(styles, /@media \(max-width: 360px\)/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.doesNotMatch(styles, /overflow-x:\s*auto/);
});
