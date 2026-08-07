import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const sellerPanel = read("src/gestion/seller/SellerPanel.jsx");
const sellerService = read("src/gestion/services/sellerService.js");
const modules = read("src/gestion/modules.js");
const managementApp = read("src/gestion/ManagementApp.jsx");
const dashboard = read("src/gestion/pages/DashboardPage.jsx");
const shell = read("src/gestion/ManagementShell.jsx");
const filters = read("src/gestion/components/MetricsFiltersPanel.jsx");
const filterCss = read("src/styles/metrics-fixes.css");

test("el modal de anulación conserva el foco y el motivo es opcional", () => {
  assert.match(sellerPanel, /const closeCancelDialog = useCallback\(\(\) => \{/);
  assert.match(sellerPanel, /onClose=\{closeCancelDialog\}/);
  assert.match(sellerPanel, /Motivo de anulación \(opcional\)/);
  assert.match(sellerPanel, /Si es posible, indicá brevemente por qué se anula la venta\./);
  assert.match(sellerPanel, /<Button variant="destructive" icon="Trash2" loading=\{submitState\.busy\} onClick=\{confirmCancelSale\}>Anular venta<\/Button>/);
  assert.doesNotMatch(sellerPanel, /disabled=\{cancelReason\.trim\(\)\.length/);
  assert.doesNotMatch(sellerPanel, /Motivo \*/);
});

test("el servicio normaliza el motivo vacío sin impedir la anulación", () => {
  assert.match(sellerService, /const safeReason = String\(reason \|\| ""\)\.trim\(\) \|\| null;/);
  assert.doesNotMatch(sellerService, /safeReason\.length < 3/);
  assert.match(sellerService, /\.\.\.\(safeReason \? \{ cancelReason: safeReason \} : \{\}\)/);
  assert.match(sellerService, /reason: safeReason \? `Anulación \$\{sale\.saleCode\}: \$\{safeReason\}` : `Anulación \$\{sale\.saleCode\}`/);
});

test("anular continúa restituyendo stock y registrando movimiento y auditoría", () => {
  assert.match(sellerService, /const newStock = previousStock \+ Number\(item\.qty \|\| 0\);/);
  assert.match(sellerService, /type: "sale_cancel"/);
  assert.match(sellerService, /status: "cancelled"/);
  assert.match(sellerService, /cancelledAt: serverTimestamp\(\)/);
  assert.match(sellerService, /cancelledBy: profile\.id/);
  assert.match(sellerService, /action: "sale\.cancelled"/);
  assert.match(sellerService, /runStockMutationWithRuleCompatibility/);
});

test("Métricas Generales usa una sola ruta y un solo componente", () => {
  assert.match(modules, /export const SALES_METRICS_PATH = "\/gestion\/metrics\/sales";/);
  assert.match(modules, /if \(moduleId === "metrics"\) return SALES_METRICS_PATH;/);
  assert.match(managementApp, /if \(location\.pathname !== SALES_METRICS_PATH\)/);
  assert.match(managementApp, /navigate\(SALES_METRICS_PATH, \{ replace: true \}\)/);
  assert.match(managementApp, /else if \(routeId === "metrics"\) \{\s*page = <SalesMetricsPage \/>;/);
  assert.match(dashboard, /to="\/gestion\/metrics\/sales"/);
  assert.match(shell, /to=\{getManagementPath\(route\.id\)\}/);
});

test("los multiselect de métricas aplican en bloque y sólo abren uno", () => {
  assert.match(filters, /const \[openFilter, setOpenFilter\] = useState\(null\);/);
  assert.match(filters, /const \[draft, setDraft\] = useState\(state\);/);
  assert.match(filters, /setOpenFilter\(filterId\);/);
  assert.match(filters, /onChange\(next\);/);
  assert.match(filters, />Cancelar<\/button>/);
  assert.match(filters, />Aplicar<\/button>/);
  assert.match(filters, /aria-haspopup="dialog"/);
  assert.match(filters, /aria-expanded=\{open\}/);
  assert.match(filters, /document\.addEventListener\("pointerdown", onPointerDown\)/);
  assert.match(filters, /event\.key !== "Escape"/);
  assert.match(filters, /restoreTriggerFocus/);
});

test("el panel de filtros deja de recortar overlays y mantiene scroll interno responsive", () => {
  assert.match(filterCss, /\.fm-metrics-page > \.fm-panel:first-of-type \{\s*overflow: visible;/);
  assert.match(filterCss, /\.fm-metrics-filter-group\.is-open/);
  assert.match(filterCss, /\.fm-metrics-filter-group__options[\s\S]*overflow-y: auto;/);
  assert.match(filterCss, /\.fm-metrics-filter-group__actions/);
  assert.match(filterCss, /@media \(max-width: 768px\)/);
  assert.match(filterCss, /position: fixed;/);
  assert.match(filterCss, /env\(safe-area-inset-bottom\)/);
  assert.match(filterCss, /max-height: min\(68vh, 560px\);/);
});
