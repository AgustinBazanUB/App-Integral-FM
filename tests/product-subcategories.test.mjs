import test from "node:test";
import assert from "node:assert/strict";
import { categorySubcategories, suggestSubcategory, groupProductSubcategories, productSubcategory, validateSubcategories } from "../src/shared/productSubcategories.mjs";
import { joinMasterProducts } from "../src/modules/locations/domain/dashboard.js";
import { memoryServices } from "./helpers/memoryFirestore.mjs";

test("la organización distingue tipos y presentaciones sin adivinar tamaños ausentes", () => {
  for (const [category, name, expected] of [
    ["Aceite de Oliva", "Aceite de Oliva Coratina 500cc", "500ml"], ["Aceite de Oliva", "BOTELLON CORATINA 2L", "2l"], ["Aceite de Oliva", "Bidón 5L", "5l"], ["Aceite de Oliva", "Arauco", ""],
    ["Almendras", "Almendras naturales 200g", "naturales"], ["Almendras", "Almendras tostadas y saladas 500g", "saladas"], ["Almendras", "Turrón crocante", ""],
    ["Pistachos", "Pistachos naturales sin cascara 150gr", "pelados"], ["Pistachos", "Pistachos Tostados y salados 150g", "cascara-salados"],
    ["Pasas de Uva", "Pasas 200 gr", "morochas"], ["Pasas de Uva", "Pasas rubias 200g", "rubias"],
    ["Aceitunas", "Aceitunas Verdes Sin Carozo 400g", "verdes"], ["Aceitunas", "Aceitunas portuguesas", "negras"], ["Aceitunas", "Aceitunas Griegas 500g", "negras"],
    ["Nueces", "Nuez Mariposa 300g", "mariposas"], ["Nueces", "PECAN", "pecanas"],
    ["Vinos", "Vinos Santa Brasa 750cc", "santa-brasa"], ["Vinos", "Gritos 750cc", "gritos"], ["Vinos", "Vino Suipacha Reserva", "reserva"], ["Vinos", "Vino BAZAN", "reserva"], ["Vinos", "Vino Extramuros Gran Reserva", "gran-reserva"],
    ["Mermeladas", "Dulces Tia Clara 220g", "220g"], ["Mermeladas", "Confitura Malbec", ""],
    ["Cremas Corporales", "Crema Corporal de Oliva 150g", "oliva"], ["Cremas Corporales", "Crema Corporal Malbec 200g", "malbec"],
  ]) assert.equal(suggestSubcategory({ name }, { name: category }), expected, `${category}: ${name}`);
  assert.equal(suggestSubcategory({ name: "Dulces Tia Clara", abbreviation: "MERM400" }, { name: "Mermeladas" }), "400g");
});

test("cada producto aparece una sola vez, incluso los no asignados, y los grupos vacíos permanecen visibles", () => {
  const items = [{ id: "a", name: "Aceite 500ml" }, { id: "b", name: "Botellón 2L" }, { id: "c", name: "Picual" }];
  const groups = groupProductSubcategories(items, { name: "Aceite de Oliva" });
  assert.deepEqual(groups.map(row => row.id), ["500ml", "2l", "5l", "__unassigned"]);
  assert.equal(groups[2].items.length, 0);
  assert.deepEqual(groups.flatMap(row => row.items).map(row => row.id).sort(), ["a", "b", "c"]);
  assert.equal(groupProductSubcategories(items, { name: "Sales" })[0].name, "");
});

test("las asignaciones manuales y un Sin subcategoría explícito tienen prioridad sobre la sugerencia", () => {
  const category = { name: "Nueces", subcategories: [{ id: "especial", name: "Especiales" }] };
  assert.equal(productSubcategory({ name: "Nuez Mariposa", subcategoryId: "especial" }, category).name, "Especiales");
  assert.equal(productSubcategory({ name: "Nuez Mariposa", subcategoryId: "" }, { name: "Nueces" }), null);
  assert.equal(productSubcategory({ name: "Nuez Mariposa", subcategoryId: "ajena" }, category), null);
});

test("el catálogo maestro prevalece sobre copias antiguas de categoría y subcategoría del stock", () => {
  const [item] = joinMasterProducts([{ id: "p", name: "Oliva", categoryId: "aceite", categoryName: "Aceite de Oliva", subcategoryId: "500ml" }], [{ productId: "p", categoryId: "old", subcategoryId: "5l", currentStock: 7, price: 20 }]);
  assert.equal(item.categoryId, "aceite"); assert.equal(item.subcategoryId, "500ml"); assert.equal(item.currentStock, 7); assert.equal(item.price, 20);
});

test("las subcategorías evitan nombres/IDs duplicados y límites inválidos", () => {
  assert.throws(() => validateSubcategories([{ id: "a", name: "Olíva" }, { id: "b", name: "oliva" }]), /ya existe/);
  assert.throws(() => validateSubcategories([{ id: "../a", name: "Oliva" }]), /nombre/);
  assert.throws(() => validateSubcategories(Array.from({ length: 51 }, (_, i) => ({ id: `s${i}`, name: `S${i}` }))), /50/);
  assert.equal(categorySubcategories({ name: "Nueces", subcategories: [] }).length, 0);
});

test("crear y organizar guarda categoría/subcategoría sin tocar precio, stock ni asignaciones manuales", async () => {
  const f = await memoryServices(`export { createProductSubcategory, organizeExistingCatalog } from './src/gestion/services/catalogOrganizationService.js'; export { saveMasterProduct } from './src/gestion/services/inventoryService.js';`);
  const profile = { id: "a", role: "admin", active: true, name: "Admin" };
  f.state.data.set("productCategories/oil", { name: "Aceite de Oliva", active: true });
  f.state.data.set("products/p", { name: "Aceite 500ml", abbreviation: "OIL", categoryId: "oil", defaultPrice: 22000 });
  f.state.data.set("products/manual", { name: "Aceite 500ml especial", abbreviation: "ESP", categoryId: "oil", subcategoryId: "", defaultPrice: 33000 });
  f.state.data.set("locationStock/local/items/p", { currentStock: 580, price: 21000 });
  assert.equal(await f.service.organizeExistingCatalog(profile), 1);
  assert.equal(f.state.data.get("products/p").subcategoryId, "500ml");
  assert.equal(f.state.data.get("products/manual").subcategoryId, "");
  assert.deepEqual(f.state.data.get("locationStock/local/items/p"), { currentStock: 580, price: 21000 });
  await f.service.createProductSubcategory({ profile, categoryId: "oil", id: "especial", name: "Especiales" });
  await assert.rejects(f.service.createProductSubcategory({ profile, categoryId: "oil", id: "otro", name: "especiales" }), /ya existe/);
  await f.service.saveMasterProduct({ profile, productId: "p", values: { name: "Aceite 500ml", abbreviation: "OIL", categoryId: "oil", subcategoryId: "especial", defaultPrice: 22000 } });
  assert.equal(f.state.data.get("products/p").subcategoryName, "Especiales");
  await assert.rejects(f.service.saveMasterProduct({ profile, productId: "p", values: { name: "Aceite", abbreviation: "OIL", categoryId: "oil", subcategoryId: "inexistente" } }), /no pertenece/);
  await assert.rejects(f.service.createProductSubcategory({ profile: { id: "s", role: "seller", active: true }, categoryId: "oil", id: "x", name: "X" }), /no puede/);
});
