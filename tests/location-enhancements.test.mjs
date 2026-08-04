import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const locationsPage = read("src/gestion/pages/LocationsPage.jsx");
const detailPage = read("src/gestion/pages/LocationDetailPage.jsx");
const productForm = read("src/gestion/components/LocationProductForm.jsx");
const service = read("src/gestion/services/locationEnhancementsService.js");
const images = read("src/data/productImages.js");
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

test("los productos se crean desde la ubicación con alcance local predeterminado", () => {
  assert.match(detailPage, /Agregar nuevo producto/);
  assert.match(productForm, /scope: "current"/);
  assert.match(productForm, /Solo esta ubicación/);
  assert.match(productForm, /Todas las ubicaciones activas/);
  assert.match(productForm, /El stock inicial será 0/);
  assert.match(service, /currentStock: 0/);
  assert.match(service, /productsSnapshot\.docs\.find/);
});

test("la vista de productos está agrupada por categoría", () => {
  assert.match(detailPage, /fm-product-category-groups/);
  assert.match(detailPage, /<details className="fm-product-category"/);
  assert.match(detailPage, /group\.items\.length/);
});

test("el catálogo de imágenes es local y Firestore guarda rutas", () => {
  assert.match(images, /\/images\/flor-mia\/logo-flor-mia\.svg/);
  assert.match(images, /product\.image/);
  assert.doesNotMatch(service, /base64/i);
  assert.match(service, /path\.startsWith\("\/images\/"\)/);
  assert.match(productForm, /Imagen del catálogo local/);
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
