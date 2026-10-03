import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { buildPlan, decodeFields, encodeFields, documentPath, SOURCE_PROJECT, DESTINATION_PROJECT, COLLECTIONS, reconcileStock, validateOperation, legacyImagePath } from "../scripts/legacy-migration/domain.mjs";
import { buildCleanupPlan } from "../scripts/legacy-migration/cleanup.mjs";
import { toFirestoreWrite } from "../scripts/migrate-legacy-data.mjs";
import { legacyProductImages } from "../src/data/legacyProductImages.js";

const now = "2026-10-03T22:00:00Z";
const makeDocument = (project, path, data) => ({ name: `projects/${project}/databases/(default)/documents/${path}`, fields: encodeFields(data), updateTime: "2026-10-02T22:00:00Z" });
const snapshot = project => ({ project, collections: Object.fromEntries([...COLLECTIONS, "locationStock", "warehouseStock", "warehouses", "auditLogs"].map(name => [name, []])) });
function put(target, path, data) { target.collections[path.split("/")[0]].push(makeDocument(target.project, path, data)); }
function simulate(target, plan) {
  const result = structuredClone(target);
  for (const group of plan.groups) for (const operation of group.operations) {
    const list = result.collections[operation.path.split("/")[0]];
    const index = list.findIndex(doc => documentPath(doc) === operation.path);
    const previous = index >= 0 ? list[index] : {};
    const doc = { name: `projects/${target.project}/databases/(default)/documents/${operation.path}`, fields: operation.updateMask ? { ...previous.fields, ...operation.fields } : operation.fields, updateTime: now };
    if (index >= 0) list[index] = doc; else list.push(doc);
  }
  return result;
}
function cleanupFixture() {
  const target = snapshot(DESTINATION_PROJECT), ids = Array.from({ length: 13 }, (_, index) => `sale-${index}`);
  put(target, "locationStock/local/items/p", { productId: "p", currentStock: 93 });
  put(target, "stockMovements/seed", { type: "legacy_migration_snapshot", productId: "p", locationId: "local", newStock: 100, createdAt: new Date("2026-09-23T15:00:00Z") });
  ids.forEach((id, index) => {
    const date = new Date(index < 6 ? "2026-08-01T15:00:00Z" : "2026-10-02T15:00:00Z");
    put(target, `sales/${id}`, { status: index === 4 || index === 5 ? "cancelled" : "active", total: 100, locationId: "local", locationName: "Local", createdAt: date, items: [{ productId: "p", name: "Producto", qty: 1, unitPrice: 100 }], ...(index === 6 ? { fiscalInvoiceId: "authorized-invoice", invoiceStatus: "authorized" } : {}) });
    put(target, `stockMovements/sold-${id}`, { type: "sale", saleId: id, locationId: "local", productId: "p", qty: -1, createdAt: date });
  });
  return { target, ids };
}

test("baja exacta de 13 ventas: devuelve sólo impactos vigentes y conserva el vínculo fiscal", () => {
  const { target, ids } = cleanupFixture();
  const plan = buildCleanupPlan(target, ids, { operationId: "cleanup", now });
  assert.equal(plan.stats.archived, 13); assert.equal(plan.stats.returnedUnits, 7); assert.equal(plan.stats.resetByEarlierSnapshot, 4); assert.equal(plan.stats.fiscalLinksPreserved, 1);
  assert.equal(plan.groups.length, 1, "baja y devoluciones en un solo commit atómico");
  for (const operation of plan.groups[0].operations) assert.doesNotThrow(() => toFirestoreWrite(operation));
  const result = simulate(target, plan), archived = result.collections.sales.find(doc => documentPath(doc) === "sales/sale-6");
  assert.deepEqual(decodeFields(archived.fields), { ...decodeFields(target.collections.sales[6].fields), deleted: true, deletedAt: new Date(now).toISOString(), deletedBy: "legacy-data-migration", deletedByName: "Solicitud del Administrador", deletionReason: "Baja de las 13 ventas propias solicitada por el Administrador antes de importar el histórico", cleanupOperationId: "cleanup" });
  assert.equal(decodeFields(result.collections.locationStock[0].fields).currentStock, 100);
  assert.equal(buildCleanupPlan(result, ids, { operationId: "cleanup", now }).groups.length, 0, "repetir no devuelve stock dos veces");
});

test("baja rechaza selección distinta, saldo incongruente y doble devolución", () => {
  const { target, ids } = cleanupFixture();
  assert.throws(() => buildCleanupPlan(target, ids.slice(1), { operationId: "cleanup", now }), /13/);
  const duplicate = structuredClone(target); put(duplicate, "stockMovements/returned", { type: "sale_cancel", productId: "p", locationId: "local", saleId: ids[6], qty: 1, createdAt: new Date(now) });
  assert.throws(() => buildCleanupPlan(duplicate, ids, { operationId: "cleanup", now }), /devolución/);
  target.collections.locationStock[0].fields.currentStock = encodeFields({ n: 92 }).n;
  assert.throws(() => buildCleanupPlan(target, ids, { operationId: "cleanup", now }), /saldo/);
});

test("stock del origen más movimientos propios: no descuenta nuevamente ventas importadas", () => {
  const input = { sourceStock: { currentStock: 8 }, destinationStock: { currentStock: 9 }, seed: { newStock: 10, createdAt: "2026-09-23T15:00:00Z" }, ownMovements: [{ qty: -1, createdAt: "2026-10-01T15:00:00Z" }, { qty: -40, createdAt: "2026-08-01T15:00:00Z" }] };
  assert.deepEqual(reconcileStock(input), { stock: 7, delta: -1 });
  assert.throws(() => reconcileStock({ ...input, destinationStock: { currentStock: 8 } }), /saldo/);
  assert.throws(() => reconcileStock({ ...input, seed: null }), /snapshot/);
  assert.equal(reconcileStock({ sourceStock: { currentStock: -6 }, destinationStock: null, ownMovements: [] }).stock, -6);
});

test("migración conserva alias, ubicación reclasificada, precios, pagos y fecha; segunda ejecución sin escrituras", () => {
  const source = snapshot(SOURCE_PROJECT), target = snapshot(DESTINATION_PROJECT);
  put(source, "products/p", { name: "Vino BAZAN", defaultPrice: 29000, imageUrl: "/assets/products/a.jpg" });
  put(source, "locations/local", { name: "Depósito", active: false });
  put(source, "sales/s", { status: "active", locationId: "local", total: 90, paymentMethod: "multiple", payments: [{ method: "cash", amount: 40 }, { method: "alias", amount: 50 }], items: [{ productId: "p", qty: 1, unitPrice: 100, subtotal: 100 }], discountTotal: 10, createdAt: new Date("2026-10-01T15:00:00Z") });
  put(source, "stockMovements/m", { type: "sale", locationId: "local", productId: "p", saleId: "s", qty: -1, createdAt: new Date("2026-10-01T15:00:00Z") });
  put(source, "locationStock/local/items/p", { productId: "p", productName: "Vino BAZAN", currentStock: 8, price: 26000 });
  put(source, "counters/local", { lastNumber: 20 });
  put(target, "products/p", { name: "Malbec", defaultPrice: 35000 });
  put(target, "products/legacy_p", { name: "Vino BAZAN", legacySourceProductId: "p", defaultPrice: 29000, imageUrl: "/images/legacy-products/a.jpg" });
  put(target, "locations/local", { name: "Depósito", reclassifiedAsWarehouseId: "warehouse", active: false, deleted: true });
  put(target, "warehouses/warehouse", { name: "Depósito" });
  put(target, "counters/local", { lastNumber: 30 });
  const plan = buildPlan(source, target, { operationId: "sync", now });
  assert.deepEqual(plan.conflicts, []);
  const result = simulate(target, plan), sale = result.collections.sales[0];
  assert.equal(decodeFields(sale.fields).items[0].productId, "legacy_p");
  for (const key of ["total", "createdAt", "paymentMethod", "payments", "discountTotal"]) assert.deepEqual(sale.fields[key], source.collections.sales[0].fields[key]);
  assert.equal(sale.fields.sourceChannel, undefined, "no inventa un canal histórico");
  assert.equal(decodeFields(result.collections.warehouseStock[0].fields).currentStock, 8);
  assert.equal(result.collections.warehouseStock[0].fields.price, undefined);
  assert.deepEqual(result.collections.products, target.collections.products);
  assert.deepEqual(result.collections.locations, target.collections.locations);
  assert.deepEqual(result.collections.counters, target.collections.counters, "el contador no retrocede");
  assert.equal(buildPlan(source, result, { operationId: "sync-again", now }).groups.length, 0);
});

test("precios de cada ubicación y stock propio sobreviven; no hay ingresos ni llamadas ARCA en el plan", () => {
  const source = snapshot(SOURCE_PROJECT), target = snapshot(DESTINATION_PROJECT);
  put(source, "products/p", { name: "Producto" }); put(source, "locations/local", { active: true });
  put(source, "locationStock/local/items/p", { productId: "p", currentStock: 8, price: 26000 });
  put(target, "products/p", { name: "Producto" }); put(target, "locations/local", { active: true });
  put(target, "locationStock/local/items/p", { productId: "p", currentStock: 9, price: 28000, priceMode: "default" });
  put(target, "stockMovements/seed", { type: "legacy_migration_snapshot", locationId: "local", productId: "p", newStock: 10, createdAt: new Date("2026-09-23T15:00:00Z") });
  put(target, "stockMovements/own", { type: "sale", locationId: "local", productId: "p", qty: -1, createdAt: new Date("2026-10-02T15:00:00Z") });
  const plan = buildPlan(source, target, { operationId: "sync", now }), result = simulate(target, plan);
  const stock = decodeFields(result.collections.locationStock[0].fields);
  assert.equal(stock.currentStock, 7); assert.equal(stock.price, 26000); assert.equal(stock.priceOverride, 26000); assert.equal(stock.priceMode, "custom");
  assert.equal(buildPlan(source, result, { operationId: "sync-again", now }).groups.length, 0);
  assert.ok(plan.groups.every(group => group.operations.every(operation => !/^(invoices|financialEntries|users|settings)\//.test(operation.path))));
});

test("protecciones: ni facturas, ni otro proyecto, ni escrituras sin precondición", () => {
  const op = { path: "sales/s", fields: encodeFields({ deleted: true }), precondition: { updateTime: now }, updateMask: ["deleted"] };
  assert.deepEqual(toFirestoreWrite(op).updateMask, { fieldPaths: ["deleted"] });
  assert.ok(toFirestoreWrite(op).update.name.startsWith(`projects/${DESTINATION_PROJECT}/`));
  assert.throws(() => validateOperation({ ...op, path: "invoices/invoice" }), /alcance/);
  assert.throws(() => validateOperation({ ...op, fields: encodeFields({ fiscalInvoiceId: "invoice" }), updateMask: ["fiscalInvoiceId"] }), /fiscales/);
  assert.throws(() => validateOperation({ ...op, precondition: undefined }), /concurrencia/);
  assert.throws(() => buildPlan(snapshot(DESTINATION_PROJECT), snapshot(SOURCE_PROJECT), { operationId: "sync" }), /Origen/);
});

test("galería anterior: imágenes y miniaturas originales están incluidas y rutas inseguras rechazadas", async () => {
  assert.equal(legacyProductImages.length, 33);
  assert.equal(new Set(legacyProductImages.map(image => image.id)).size, 33);
  for (const image of legacyProductImages) for (const url of [image.imageUrl, image.thumbUrl]) {
    assert.equal(legacyImagePath(url), url);
    await access(new URL(`../public${url}`, import.meta.url));
  }
  assert.throws(() => legacyImagePath("/assets/products/../secret.jpg"), /soportada/);
  assert.throws(() => legacyImagePath("https://external/a.jpg"), /soportada/);
  const manifest = JSON.parse(await readFile(new URL("../public/images/legacy-products/checksums.json", import.meta.url), "utf8"));
  for (const [filename, digest] of Object.entries(manifest)) assert.equal(createHash("sha256").update(await readFile(new URL(`../public/images/legacy-products/${filename}`, import.meta.url))).digest("hex"), digest);
});
