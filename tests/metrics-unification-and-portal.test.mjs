import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Dashboard, sidebar y router comparten una única ruta canónica de métricas", async () => {
  const modules = await source("src/gestion/modules.js");
  const dashboard = await source("src/gestion/pages/DashboardPage.jsx");
  const shell = await source("src/gestion/ManagementShell.jsx");
  const router = await source("src/gestion/ManagementApp.jsx");

  assert.match(modules, /export const SALES_METRICS_PATH = "\/gestion\/metrics\/sales"/);
  assert.match(modules, /if \(moduleId === "metrics"\) return SALES_METRICS_PATH/);
  assert.match(dashboard, /import \{ getManagementPath, SALES_METRICS_PATH \} from "\.\.\/modules"/);
  assert.match(dashboard, /to=\{SALES_METRICS_PATH\}/);
  assert.doesNotMatch(dashboard, /to="\/gestion\/metrics\/sales"/);
  assert.match(shell, /to=\{getManagementPath\(route\.id\)\}/);
  assert.match(router, /location\.pathname !== SALES_METRICS_PATH/);
  assert.match(router, /page = <SalesMetricsPage \/>/);
});

test("los filtros de métricas salen del stacking context mediante un único portal abierto", async () => {
  const filters = await source("src/gestion/components/MetricsFiltersPanel.jsx");

  assert.match(filters, /import \{ createPortal \} from "react-dom"/);
  assert.match(filters, /createPortal\([\s\S]*document\.body/);
  assert.match(filters, /const \[openFilter, setOpenFilter\] = useState\(null\)/);
  assert.match(filters, /open=\{openFilter === "locations"\}/);
  assert.match(filters, /open=\{openFilter === "sellers"\}/);
  assert.match(filters, /open=\{openFilter === "products"\}/);
  assert.match(filters, /open=\{openFilter === "discounts"\}/);
  assert.match(filters, /open=\{openFilter === "payments"\}/);
  assert.match(filters, /aria-haspopup="dialog"/);
  assert.match(filters, /aria-expanded=\{open\}/);
});

test("el portal se posiciona contra el trigger y permanece dentro del viewport", async () => {
  const filters = await source("src/gestion/components/MetricsFiltersPanel.jsx");

  assert.match(filters, /getBoundingClientRect\(\)/);
  assert.match(filters, /window\.innerWidth/);
  assert.match(filters, /window\.innerHeight/);
  assert.match(filters, /spaceBelow/);
  assert.match(filters, /spaceAbove/);
  assert.match(filters, /placeAbove/);
  assert.match(filters, /window\.addEventListener\("resize", updateLayerPosition\)/);
  assert.match(filters, /window\.addEventListener\("scroll", updateLayerPosition, true\)/);
  assert.match(filters, /window\.removeEventListener\("scroll", updateLayerPosition, true\)/);
});

test("multiselect conserva borrador hasta Aplicar y Cancelar restaura el estado previo", async () => {
  const filters = await source("src/gestion/components/MetricsFiltersPanel.jsx");

  assert.match(filters, /const \[draft, setDraft\] = useState\(state\)/);
  assert.match(filters, /keys\.forEach\(\(key\) => \{ next\[key\] = \[\.\.\.draft\[key\]\]; \}\)/);
  assert.match(filters, /const cancelFilter = \(\) => \{[\s\S]*setDraft\(state\);[\s\S]*closeFilter\(true\)/);
  assert.match(filters, />Aplicar<\/button>/);
  assert.match(filters, />Cancelar<\/button>/);
});

test("Escape, click exterior y Tab se limpian al cerrar y el foco vuelve al disparador", async () => {
  const filters = await source("src/gestion/components/MetricsFiltersPanel.jsx");

  assert.match(filters, /restoreTriggerFocus/);
  assert.match(filters, /triggerRefs\.current\[filterId\]\?\.focus/);
  assert.match(filters, /document\.addEventListener\("pointerdown", onPointerDown\)/);
  assert.match(filters, /document\.removeEventListener\("pointerdown", onPointerDown\)/);
  assert.match(filters, /document\.addEventListener\("keydown", onKeyDown\)/);
  assert.match(filters, /document\.removeEventListener\("keydown", onKeyDown\)/);
  assert.match(filters, /event\.key === "Escape"/);
  assert.match(filters, /event\.key !== "Tab"/);
});

test("el layer usa z-index central y bottom sheet responsive sin depender del overflow de las cards", async () => {
  const styles = await source("src/styles/metrics-fixes.css");
  const tokens = await source("src/styles/tokens.css");

  assert.match(tokens, /--fm-z-popover:\s*80/);
  assert.match(styles, /\.fm-metrics-filter-layer\s*\{[\s\S]*position:\s*fixed/);
  assert.match(styles, /z-index:\s*var\(--fm-z-popover, 80\)/);
  assert.match(styles, /max-height:\s*min\(60vh, 430px\)/);
  assert.match(styles, /@media \(max-width: 768px\)[\s\S]*\.fm-metrics-filter-layer[\s\S]*safe-area-inset-bottom/);
  assert.match(styles, /@media \(max-width: 480px\)/);
  assert.match(styles, /@media \(max-width: 390px\)/);
  assert.match(styles, /@media \(max-width: 320px\)/);
});

test("formas de pago del filtro reutilizan los identificadores centrales", async () => {
  const filters = await source("src/gestion/components/MetricsFiltersPanel.jsx");
  assert.match(filters, /import \{ SINGLE_PAYMENT_METHODS \} from "\.\.\/\.\.\/modules\/locations\/domain\/payments"/);
  assert.match(filters, /SINGLE_PAYMENT_METHODS\.map/);
});
