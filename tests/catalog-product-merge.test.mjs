import test from "node:test";
import assert from "node:assert/strict";
import { mergeCatalogProduct } from "../netlify/functions/_lib/catalogMerge.mjs";
import { fixture } from "./helpers/olivia-fixture.mjs";

function setup(role = "admin") {
  const f = fixture({ role });
  f.documents.set("products/source", { name: "Aceitunas descarozadas", abbreviation: "ACEITUNA", categoryId: "olives", active: true, defaultPrice: 16000 });
  f.documents.set("products/target", { name: "Aceitunas Verdes Sin Carozo 400g", abbreviation: "ACEIT400", categoryId: "olives", active: true, defaultPrice: 16000 });
  f.documents.set("locationStock/local_a/items/source", { productId: "source", currentStock: 7, initialStock: 9, active: true, priceOverride: 15000 });
  f.documents.set("locationStock/local_a/items/target", { productId: "target", currentStock: 12, initialStock: 12, active: true, priceMode: "custom", priceOverride: 18000 });
  f.documents.set("warehouses/w", { name: "Depósito", active: true });
  f.documents.set("warehouseStock/w/items/source", { productId: "source", currentStock: 4, active: true });
  const request = extra => mergeCatalogProduct({ store: f.store, uid: "user_a", sourceId: "source", targetId: "target", action: "preview", ...extra });
  return { ...f, request };
}

test("unificación conserva unidades en cada local/depósito, precios de destino e historial; no hace borrados físicos", async () => {
  const f = setup(), plan = await f.request();
  assert.equal(plan.totalUnits, 11); assert.equal(f.commits.length, 0);
  await f.request({ action: "merge", expectedFingerprint: plan.fingerprint });
  assert.equal(f.documents.get("locationStock/local_a/items/source").currentStock, 0);
  assert.equal(f.documents.get("locationStock/local_a/items/target").currentStock, 19);
  assert.equal(f.documents.get("locationStock/local_a/items/target").priceOverride, 18000);
  assert.equal(f.documents.get("warehouseStock/w/items/target").currentStock, 4);
  assert.equal(f.documents.get("warehouseStock/w/items/target").priceMode, undefined);
  assert.equal(f.documents.get("products/source").active, false);
  assert.equal(f.documents.get("products/source").mergedIntoProductId, "target");
  assert.equal(f.documents.get("products/source").name, "Aceitunas descarozadas");
  assert.ok(!f.commits.flat().some(write => write.type === "delete"));
  assert.equal(f.commits.flat().filter(write => write.path.startsWith("stockMovements/")).length, 4);
});

test("confirmaciones simultáneas y reintentos no duplican el stock trasladado", async () => {
  const f = setup(), plan = await f.request();
  const results = await Promise.all([f.request({ action: "merge", expectedFingerprint: plan.fingerprint }), f.request({ action: "merge", expectedFingerprint: plan.fingerprint })]);
  assert.ok(results.some(result => result.alreadyMerged));
  assert.equal(f.documents.get("locationStock/local_a/items/target").currentStock, 19);
  assert.equal(f.commits.length, 1);
});

test("si cambia el stock después de revisar, se rechaza toda la operación", async () => {
  const f = setup(), plan = await f.request();
  f.documents.get("locationStock/local_a/items/source").currentStock++;
  await assert.rejects(f.request({ action: "merge", expectedFingerprint: plan.fingerprint }), error => error.code === "STOCK-CAMBIO");
  assert.equal(f.commits.length, 0); assert.equal(f.documents.get("products/source").active, true);
});

test("permisos revocados, destino inválido y stock negativo no publican cambios parciales", async () => {
  const seller = setup("seller"); await assert.rejects(seller.request(), error => error.status === 403);
  const f = setup(), plan = await f.request(); f.documents.get("users/user_a").active = false;
  await assert.rejects(f.request({ action: "merge", expectedFingerprint: plan.fingerprint }), error => error.status === 403);
  const g = setup(); g.documents.get("products/target").categoryId = "nuts";
  await assert.rejects(g.request(), error => error.code === "CATEGORIA-DISTINTA");
  const h = setup(); h.documents.get("warehouseStock/w/items/source").currentStock = -1;
  await assert.rejects(h.request(), error => error.code === "STOCK-NO-VALIDO");
  for (const data of [seller, f, g, h]) assert.equal(data.commits.length, 0);
});

test("ventas anulables, traslados y pedidos pendientes impiden dejar referencias activas en el duplicado", async () => {
  for (const [collection, status, code] of [["sales", "active", "PRODUCTO-CON-VENTAS"], ["stockTransfers", "pending", "PRODUCTO-EN-TRASLADO"], ["orders", "pending", "PRODUCTO-CON-PEDIDO"]]) {
    const f = setup(); f.documents.set(`${collection}/pending`, { status, items: [{ productId: "source", qty: 1 }] });
    await assert.rejects(f.request(), error => error.code === code); assert.equal(f.commits.length, 0);
  }
  const f = setup(); f.documents.set("sales/old", { status: "cancelled", items: [{ productId: "source", qty: 1, name: "Aceitunas descarozadas", unitPrice: 16000 }] });
  const before = structuredClone(f.documents.get("sales/old")), plan = await f.request();
  await f.request({ action: "merge", expectedFingerprint: plan.fingerprint });
  assert.deepEqual(f.documents.get("sales/old"), before);
});
