import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const locationsPage = read("src/gestion/pages/LocationsPage.jsx");
const detailPage = read("src/gestion/pages/LocationDetailPage.jsx");
const service = read("src/gestion/services/locationEnhancementsService.js");
const inventoryService = read("src/gestion/services/inventoryService.js");
const styles = read("src/styles/location-enhancements.css");

test("las ubicaciones fijadas son personales y tienen límite de cuatro", () => {
  assert.match(locationsPage, /MAX_PINNED_LOCATIONS = 4/);
  assert.match(locationsPage, /savePinnedLocationIds/);
  assert.match(service, /users.*profile\.id/s);
  assert.match(service, /slice\(0, 4\)/);
});

test("cargar stock abre directamente la sección correcta y valida actividad", () => {
  assert.match(locationsPage, /\/stock`/);
  assert.match(detailPage, /loadActiveLocationStock/);
  assert.match(service, /locationActivity\(location\)\.active/);
  assert.match(detailPage, /Esta ubicación debe estar activa para cargar stock/);
});

test("agregar producto a una ubicación reutiliza el catálogo global", () => {
  assert.match(detailPage, /AddLocationProductModal/);
  assert.match(detailPage, /listMasterProductsForInventory/);
  assert.match(detailPage, /addProductToLocation/);
  assert.match(detailPage, /producto que ya existe en el catálogo de Flor Mía/);
  assert.match(detailPage, /Stock inicial/);
  assert.match(detailPage, /Usar precio predeterminado/);
  assert.match(inventoryService, /addProductToLocation/);
  assert.doesNotMatch(detailPage, /scope: "current"/);
});

test("la vista de productos está agrupada por categoría", () => {
  assert.match(detailPage, /fm-product-category-groups/);
  assert.match(detailPage, /<details className="fm-product-category"/);
  assert.match(detailPage, /group\.items\.length/);
});

test("vendedores asignados y disponibles se muestran por separado", () => {
  assert.match(detailPage, /assignedSellers/);
  assert.match(detailPage, /availableSellers/);
  assert.match(detailPage, /Asignar vendedor/);
  assert.match(detailPage, /fm-seller-avatar/);
});

test("los descuentos globales se validan antes de habilitarse", () => {
  assert.match(detailPage, /saveValidatedLocationDiscounts/);
  assert.match(service, /No se puede habilitar un descuento fuera de vigencia/);
  assert.match(detailPage, /role="switch"/);
});

test("los valores de stock usan texto oscuro y controles táctiles", () => {
  assert.match(styles, /#2f2924/i);
  assert.match(styles, /#76510f/i);
  assert.match(styles, /min-height: 44px/);
  assert.match(styles, /@media \(max-width: 768px\)/);
});
