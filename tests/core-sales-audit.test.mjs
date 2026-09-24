import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("el catálogo maestro no define umbrales de stock por ubicación", async () => {
  const productForm = await read("../src/gestion/components/ProductForm.jsx");
  const locationProductForm = await read("../src/gestion/components/LocationProductForm.jsx");
  const inventoryService = await read("../src/gestion/services/inventoryService.js");
  const locationService = await read("../src/gestion/services/locationEnhancementsService.js");

  assert.doesNotMatch(productForm, /form\.yellowAlertQty|form\.redAlertQty/);
  assert.doesNotMatch(locationProductForm, /form\.yellowAlertQty|form\.redAlertQty/);

  const masterPayload = inventoryService.slice(
    inventoryService.indexOf("function productPayload"),
    inventoryService.indexOf("export async function saveMasterProduct"),
  );
  assert.doesNotMatch(masterPayload, /yellowAlertQty|redAlertQty/);

  assert.match(inventoryService, /yellowAlertQty:\s*0/);
  assert.match(inventoryService, /redAlertQty:\s*0/);
  assert.match(locationService, /yellowAlertQty:\s*0/);
  assert.match(locationService, /redAlertQty:\s*0/);
});

test("crear un producto desde una ubicación usa el mismo ID y precio maestro", async () => {
  const form = await read("../src/gestion/components/LocationProductForm.jsx");
  const service = await read("../src/gestion/services/locationEnhancementsService.js");

  assert.match(form, /label="ID del producto"/);
  assert.match(form, /form\.productCode/);
  assert.match(service, /productCodeKey/);
  assert.match(service, /abbreviation:\s*productCode/);
  assert.match(service, /priceMode:\s*PRICE_MODES\.DEFAULT/);
  assert.match(service, /priceOverride:\s*null/);
  assert.match(service, /masterDefaultPrice:\s*defaultPrice/);
});

test("el Panel Vendedor advierte diferencias de stock pero no bloquea la venta física", async () => {
  const panel = await read("../src/gestion/seller/SellerPanel.jsx");
  const service = await read("../src/gestion/services/sellerService.js");
  const rules = await read("../firestore.rules");

  assert.match(panel, /stock digital no alcanza/i);
  assert.match(panel, /submitLockRef\.current/);
  assert.match(panel, /if \(submitLockRef\.current \|\| submitState\.busy\) return/);
  assert.match(panel, /finally \{\s*submitLockRef\.current = false/s);
  assert.doesNotMatch(panel, /disabled=\{qty >= Number\(product\.availableStock/);
  assert.doesNotMatch(panel, /\|\| hasStockConflict \|\|/);
  assert.doesNotMatch(service, /insufficientStockError/);
  assert.doesNotMatch(service, /previousStock < item\.qty/);
  assert.match(service, /const newStock = previousStock - item\.qty/);

  const sellerMutation = rules.slice(
    rules.indexOf("function validSellerStockMutation"),
    rules.indexOf("function ownsNewRecord"),
  );
  assert.doesNotMatch(sellerMutation, /currentStock\s*>=\s*0/);
  assert.match(rules, /data\.type in \["sale", "sale_edit", "sale_cancel"\]/);
});
