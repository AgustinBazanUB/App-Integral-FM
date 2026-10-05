import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("carrito persistido conserva sólo productId y quantity", async () => {
  const source = await read("../src/context/CartContext.jsx");
  assert.match(source, /items\.map\(\(\{ productId, quantity \}\) => \(\{ productId, quantity \}\)\)/);
  assert.doesNotMatch(source, /JSON\.stringify\([^\n]*unitPrice/);
  assert.match(source, /resolveProduct\(candidate\)/);
});

test("catálogo y producto consumen CommerceCatalogContext", async () => {
  const [catalog, product] = await Promise.all([
    read("../src/pages/CatalogPage.jsx"),
    read("../src/pages/ProductPage.jsx"),
  ]);
  assert.match(catalog, /useCommerceCatalog/);
  assert.doesNotMatch(catalog, /from "\.\.\/data\/products"/);
  assert.match(product, /useCommerceCatalog/);
  assert.doesNotMatch(product, /from "\.\.\/data\/products"/);
});

test("checkout manda IDs/cantidades y no usa precios cliente como autoridad", async () => {
  const source = await read("../src/pages/CheckoutPage.jsx");
  assert.match(source, /productId: item\.productId/);
  assert.match(source, /quantity: item\.quantity/);
  assert.match(source, /clientTotal: knownSubtotal/);
  assert.match(source, /backend NO usa este total como autoridad/);
  assert.doesNotMatch(source, /paymentMode:\s*"approved"/);
  assert.match(source, /paymentMode:\s*"pending"/);
});

test("checkout no contiene integración ARCA ni CAE", async () => {
  const files = await Promise.all([
    read("../src/pages/CheckoutPage.jsx"),
    read("../src/services/ecommerceService.js"),
    read("../netlify/functions/ecommerce-checkout.mjs"),
  ]);
  const source = files.join("\n");
  assert.doesNotMatch(source, /arca-authorize|FECAESolicitar|requestCae|requestPendingArcaInvoice|authorizeInvoice/);
});

test("fuente editorial declara explícitamente que no es comercial", async () => {
  const source = await read("../src/data/products.js");
  assert.match(source, /Catálogo editorial/);
  assert.match(source, /NO es fuente autoritativa de precio, stock, IVA ni ID comercial/);
});

test("configuración Ecommerce no inventa ubicación ni activa pagos simulados", async () => {
  const env = await read("../.env.example");
  assert.match(env, /^ECOMMERCE_LOCATION_ID=$/m);
  assert.match(env, /^ECOMMERCE_PICKUP_ENABLED=false$/m);
  assert.match(env, /^ECOMMERCE_SIMULATED_PAYMENT_ENABLED=false$/m);
  assert.doesNotMatch(env, /^VITE_.*SIMULATED_PAYMENT/m);
  assert.match(env, /^ARCA_AUTO_AUTHORIZE_PRODUCTION_SOURCES=admin_quick_sale,seller_sale$/m);
  assert.doesNotMatch(env, /^ARCA_AUTO_AUTHORIZE_PRODUCTION_SOURCES=.*ecommerce/m);
});


test("simulación Etapa 6 exige capability backend, admin y advertencia fiscal explícita", async () => {
  const [checkout, service, endpoint] = await Promise.all([
    read("../src/pages/CheckoutPage.jsx"),
    read("../src/services/ecommerceService.js"),
    read("../netlify/functions/ecommerce-simulated-payment.mjs"),
  ]);
  assert.match(checkout, /Este checkout no procesa un pago real/);
  assert.match(checkout, /La acción simulará un pago aprobado/);
  assert.match(checkout, /Se preparará un plan fiscal de prueba sin solicitar CAE/);
  assert.match(service, /ecommerce-simulated-payment/);
  assert.match(endpoint, /requireFirebaseAdmin/);
  assert.match(endpoint, /provider: "simulation"/);
  assert.doesNotMatch(checkout + service, /VITE_.*SIMULATED_PAYMENT/);
});
