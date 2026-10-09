import test from "node:test";
import assert from "node:assert/strict";
import { filterSellerProductGroups } from "../src/gestion/seller/catalogSearch.mjs";

const groups = [{ id: "salt", name: "Sales", items: [{ id: "malbec", productName: "Sal de Malbec", abbreviation: "SALM" }] }, { id: "oil", name: "Aceite de Oliva", items: [{ id: "arauco", productName: "Aceite Arauco", subcategoryName: "Clásicos" }] }];
test("buscador encuentra nombre, abreviatura, categoría y subcategoría sin acentos", () => {
  assert.equal(filterSellerProductGroups(groups, "salm")[0].items[0].id, "malbec");
  assert.equal(filterSellerProductGroups(groups, "sales malbec")[0].items[0].id, "malbec");
  assert.equal(filterSellerProductGroups(groups, "clasicos")[0].items[0].id, "arauco");
  assert.deepEqual(filterSellerProductGroups(groups, "inexistente"), []);
  assert.equal(groups[0].items.length, 1);
  assert.equal(filterSellerProductGroups(groups, " "), groups);
});
