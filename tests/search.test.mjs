import test from "node:test";
import assert from "node:assert/strict";
import { categoryById } from "../src/data/categories.js";
import { products } from "../src/data/products.js";
import {
  filterProducts,
  matchesSearch,
  normalizeText,
} from "../src/utils/search.js";

test("normaliza acentos y mayúsculas", () => {
  assert.equal(normalizeText("  FLOR MÍA · Mendoza "), "flor mia mendoza");
});

test("encuentra productos por categoría, uso y ocasión", () => {
  const picada = filterProducts(products, categoryById, "para una picada");
  assert.ok(picada.some((product) => product.id === "olives-selection"));

  const mermelada = filterProducts(products, categoryById, "mermeladas");
  assert.ok(mermelada.some((product) => product.id === "jam-pending"));

  const desayuno = filterProducts(products, categoryById, "desayuno");
  assert.ok(desayuno.some((product) => product.id === "jam-pending"));

  const regalo = filterProducts(products, categoryById, "para regalar");
  assert.ok(regalo.length > 0);
});

test("tolera errores de escritura razonables", () => {
  const pistachios = products.find(
    (product) => product.id === "nuts-pistachios",
  );
  assert.equal(
    matchesSearch(pistachios, categoryById[pistachios.categoryId], "pistacos"),
    true,
  );
});

test("no devuelve coincidencias irrelevantes", () => {
  const blend = products.find((product) => product.id === "oil-blend");
  assert.equal(
    matchesSearch(blend, categoryById[blend.categoryId], "chocolate"),
    false,
  );
});
