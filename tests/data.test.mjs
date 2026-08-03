import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { categories } from "../src/data/categories.js";
import {
  catalogCollections,
  virtualCatalogCategories,
} from "../src/data/catalogViews.js";
import { productById, products } from "../src/data/products.js";
import { oliveProfiles } from "../src/data/oliveProfiles.js";
import {
  announcementMessages,
  mobileNavigation,
  navigation,
  trustItems,
} from "../src/data/brand.js";
import { assetsManifest } from "../src/data/assetsManifest.js";
import { promotions } from "../src/data/promotions.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDirectory, "..");

test("los identificadores y slugs del catálogo son únicos", () => {
  assert.equal(new Set(categories.map((item) => item.id)).size, categories.length);
  assert.equal(new Set(products.map((item) => item.id)).size, products.length);
  assert.equal(new Set(products.map((item) => item.slug)).size, products.length);
});

test("cada producto pertenece a una categoría existente", () => {
  const categoryIds = new Set(categories.map((category) => category.id));
  for (const product of products) {
    assert.equal(categoryIds.has(product.categoryId), true, product.id);
  }
});

test("los datos comerciales desconocidos permanecen explícitamente pendientes", () => {
  for (const product of products) {
    assert.equal(product.price, null, `${product.id} no debe inventar precio`);
    assert.equal(product.stock, "unknown", `${product.id} no debe inventar stock`);
    assert.equal(product.dataStatus, "pending");
  }
});

test("todos los productos y varietales usan una imagen local existente", () => {
  for (const item of [...products, ...oliveProfiles]) {
    const relative = item.image.replace(/^\//, "");
    assert.equal(
      existsSync(resolve(projectRoot, "public", relative.replace(/^images\//, "images/"))),
      true,
      relative,
    );
  }
});

test("el manifiesto usa el logo, el local y los seis destacados reales", () => {
  const requiredAssets = [
    assetsManifest.brand.logo,
    assetsManifest.local.story,
    ...assetsManifest.local.hero.variants,
    ...assetsManifest.featured,
  ];

  for (const asset of requiredAssets) {
    const relative = asset.src.replace(/^\//, "");
    assert.match(relative, /^images\/flor-mia\//);
    assert.equal(existsSync(resolve(projectRoot, "public", relative)), true, relative);
  }

  assert.equal(assetsManifest.featured.length, 6);
});

test("la barra informativa conserva los tres mensajes aprobados", () => {
  assert.deepEqual(announcementMessages, [
    "ENVÍOS A TODO EL PAÍS",
    "LOCAL EN CABA",
    "CUOTAS SIN INTERÉS",
  ]);
});

test("la navegación de escritorio conserva sus accesos actuales", () => {
  assert.deepEqual(
    navigation.map(({ label, to }) => [label, to]),
    [
      ["Inicio", "/"],
      ["Tienda", "/productos"],
      ["Aceites de oliva", "/productos?categoria=olive_oil"],
      ["Frutos secos", "/productos?categoria=nuts"],
      ["Aceitunas", "/productos?categoria=olives"],
      ["Mermeladas", "/productos?categoria=jams"],
      ["Regalos", "/productos?categoria=gifts"],
      ["Nosotros", "/nosotros"],
      ["Contacto", "/#contacto"],
    ],
  );
});

test("el menú mobile tiene el orden y destinos solicitados", () => {
  assert.deepEqual(
    mobileNavigation.map(({ label, to }) => [label, to]),
    [
      ["Inicio", "/"],
      ["Tienda", "/productos"],
      ["AOVE", "/productos?categoria=olive_oil"],
      ["Frutos secos", "/productos?categoria=nuts"],
      ["Vinos", "/productos?categoria=wines"],
      ["Productos Regionales Mdz", "/productos?coleccion=regionales"],
      ["Regalos pre-armados", "/productos?categoria=gifts"],
      ["Nosotros", "/nosotros"],
      ["Contacto", "/#contacto"],
    ],
  );
  assert.equal(
    mobileNavigation.some(({ label }) => label === "Aceitunas"),
    false,
  );
  assert.equal(
    mobileNavigation.some(({ label }) => label === "Mermeladas"),
    false,
  );
});

test("la colección regional agrupa categorías existentes sin duplicar productos", () => {
  assert.deepEqual(catalogCollections.regionales.categoryIds, [
    "olives",
    "jams",
    "seasoned_salts",
  ]);
  const regionalProductIds = products
    .filter((product) =>
      catalogCollections.regionales.categoryIds.includes(product.categoryId),
    )
    .map((product) => product.id);
  assert.deepEqual(regionalProductIds, [
    "olives-selection",
    "jam-pending",
    "salt-malbec",
  ]);
  assert.equal(new Set(regionalProductIds).size, regionalProductIds.length);
});

test("vinos conserva un estado vacío honesto", () => {
  assert.equal(virtualCatalogCategories.wines.name, "Vinos");
  assert.equal(
    products.some((product) => product.categoryId === "wines"),
    false,
  );
});

test("los CTAs y el título AOVE usan los textos aprobados", () => {
  const homePageSource = readFileSync(
    resolve(projectRoot, "src/pages/HomePage.jsx"),
    "utf8",
  );
  assert.match(homePageSource, /CONOCÉ TU AOVE/);
  assert.match(homePageSource, /CONOCER MÁS PRODUCTOS/);
  assert.match(homePageSource, /fm-button--black/);
  assert.match(
    homePageSource,
    /Elegí el oliva ideal para cada ocasión\./,
  );
  assert.doesNotMatch(homePageSource, /Elegí el aceite que mejor va con vos\./);
  assert.match(homePageSource, /scrollIntoView/);
  assert.match(homePageSource, /prefers-reduced-motion/);
});

test("la home solo publica las dos promociones aprobadas", () => {
  assert.deepEqual(
    promotions.map(({ title, subtitle }) => [title, subtitle]),
    [
      ["¡Promociones!", "Envío sin cargo AMBA"],
      ["3 cuotas sin interés", "Miércoles y sábados"],
    ],
  );
});

test("los seis varietales tienen intensidad y producto de 500 cc", () => {
  assert.equal(categories.length, 6);
  assert.deepEqual(
    oliveProfiles.map((profile) => profile.name),
    ["Arbequina", "Arbosana", "Blend IG", "Coratina", "Picual", "Arauco"],
  );

  const expectedIntensity = {
    arbequina: "Suave",
    arbosana: "Suave",
    blend: "Intermedio",
    picual: "Intermedio",
    coratina: "Intenso",
    arauco: "Intenso",
  };

  for (const profile of oliveProfiles) {
    assert.equal(profile.intensity, expectedIntensity[profile.id], profile.id);
    assert.ok(profile.productId, `${profile.id} debe tener productId`);
    const product = productById[profile.productId];
    assert.ok(product, `${profile.productId} debe existir`);
    assert.equal(product.categoryId, "olive_oil");
    assert.deepEqual(product.formats, ["500 cc"]);
    assert.equal(product.active, true);
    assert.equal(product.price, null);
    assert.equal(product.stock, "unknown");
  }

  assert.equal(productById["oil-blend"].slug, "aceite-blend");
});

test("los cuatro beneficios comerciales tienen contenido desplegable", () => {
  assert.equal(trustItems.length, 4);
  assert.equal(trustItems[0].title, "Envío sin cargo");
  assert.equal(trustItems[0].subtitle, "En el AMBA");
  assert.equal(trustItems[1].title, "Hasta 3 cuotas sin interés");
  assert.equal(trustItems[1].subtitle, "Miércoles y sábados");

  for (const item of trustItems) {
    assert.ok(item.id);
    assert.ok(item.icon);
    assert.ok(item.title);
    assert.ok(item.subtitle);
    assert.ok(item.detail);
  }
});