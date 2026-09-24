import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const locationsPage = read("src/gestion/pages/LocationsPage.jsx");
const detailPage = read("src/gestion/pages/LocationDetailPage.jsx");
const productForm = read("src/gestion/components/ProductForm.jsx");
const service = read("src/gestion/services/locationEnhancementsService.js");
const images = read("src/data/productImages.js");
const styles = read("src/styles/location-enhancements.css");

test("las ubicaciones fijadas son personales y tienen límite de cuatro", () => {
  assert.match(locationsPage, /MAX_PINNED_LOCATIONS = 4/);
  assert.match(locationsPage, /savePinnedLocationIds/);
  assert.match(service, /users.*profile\.id/s);
  assert.match(service, /slice\(0, 4\)/);
});

test("cargar stock abre directamente la sección correcta y bloquea ingresos en ubicaciones inactivas", () => {
  assert.match(locationsPage, /\/stock`/);
  assert.match(detailPage, /disabled=\{!state\.active\}/);
  assert.match(detailPage, /no ingresar mercadería hasta reactivarla/);
});

test("la ubicación selecciona productos ya existentes del catálogo maestro", () => {
  assert.match(detailPage, /title="Agregar producto"/);
  assert.match(detailPage, /producto que ya existe en el catálogo de Flor Mía/);
  assert.match(detailPage, /listMasterProductsForInventory/);
  assert.match(detailPage, /addProductToLocation/);
  assert.doesNotMatch(detailPage, /Agregar nuevo producto/);
});

test("el stock de una ubicación permite búsqueda y filtro por categoría", () => {
  assert.match(detailPage, /Buscar en esta ubicación/);
  assert.match(detailPage, /Filtrar stock por categoría/);
  assert.match(detailPage, /fm-inventory-card-grid/);
  assert.match(detailPage, /visibleInventory/);
});

test("el catálogo maestro usa imágenes locales del proyecto", () => {
  assert.match(images, /\/images\/flor-mia\/logo-flor-mia\.svg/);
  assert.match(images, /product\.image/);
  assert.match(productForm, /Imagen del producto/);
  assert.match(productForm, /productImages/);
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
