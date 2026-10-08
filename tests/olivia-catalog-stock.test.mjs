import test from "node:test";
import assert from "node:assert/strict";
import { fixture, start, functionResponse } from "./helpers/olivia-fixture.mjs";
import { runTool, toolDefinitions } from "../netlify/functions/_lib/olivia/tools.mjs";
import { extendedOperationPlan } from "../netlify/functions/_lib/olivia/extendedOperations.mjs";
import { updateTask, taskFromTool } from "../netlify/functions/_lib/olivia/tasks.mjs";

const tool = "prepare_catalog_stock_load";
const item = (name, quantity, extra = {}) => ({ productId: null, name, quantity, categoryName: "Mermeladas", abbreviation: null, defaultPrice: 2500, ...extra });
const received = [item("Dulce alcayota", 12), item("Confitura Malbec", 12), item("Ají picante", 24, { categoryName: "Conservas" }), item("Mermelada pimiento", 24), item("Pasta aceitunas verdes", 24, { categoryName: "Pastas de aceitunas" }), item("Pasta aceitunas negras", 24, { categoryName: "Pastas de aceitunas" }), item("Aceitunas descarozadas", 36, { categoryName: "Aceitunas" }), item("Aceitunas portuguesas", 24, { categoryName: "Aceitunas" }), item("Aceitunas griegas", 48, { categoryName: "Aceitunas" }), item("Arbequina 500 cc", 540, { defaultPrice: null, categoryName: null })];
const argsFor = items => ({ locationId: "local_a", reason: null, items: structuredClone(items) });
function catalogFixture(items = received, options = {}) {
  const args = argsFor(items);
  const f = fixture({ role: "admin", provider: () => functionResponse(tool, args), ...options });
  f.documents.set("productCategories/jam", { name: "Mermeladas", active: true, deleted: false });
  f.documents.set("products/oil", { ...f.documents.get("products/oil"), name: "Arbequina 500cc", abbreviation: "ARB500", categoryId: "oil-category", categoryName: "Aceites" });
  f.documents.set("locationStock/local_a/items/oil", { ...f.documents.get("locationStock/local_a/items/oil"), priceMode: "custom", priceOverride: 1900, yellowAlertQty: 3, redAlertQty: 1 });
  return { ...f, args };
}
const prepareTool = f => runTool({ ...f, name: tool, args: f.args, context: { module: "locations" }, now: f.clock() });
async function proposal(f) {
  const state = await start(f);
  const result = await f.engine.chat(f.session, { conversationId: state.conversationId, requestId: "batch_prepare", message: "Cargá esta lista recibida en Local A y creá los productos/categorías faltantes", screenContext: { route: "/gestion/locations", module: "locations" } });
  return { ...result, confirm: { conversationId: state.conversationId, requestId: "batch_confirm", confirmationToken: result.pendingAction?.confirmationToken } };
}
const rows = (f, prefix) => [...f.documents].filter(([path]) => path.startsWith(prefix));
const businessCount = f => [...f.documents].filter(([path]) => !path.startsWith("olivia") && !path.startsWith("users/")).length;

test("los nombres abreviados o plurales reutilizan catálogo y conservan opciones verificadas", async () => {
  const f = catalogFixture([item("Arbequina500cc", 540, { defaultPrice: null }), item("pasta aceitunas negras", 24, { defaultPrice: null })]);
  f.documents.set("products/oil", { ...f.documents.get("products/oil"), name: "Aceite de Oliva Arbequina 500cc" });
  f.documents.set("products/pasta", { name: "Pasta de Aceitunas Negra", abbreviation: "PSTNEGRA", categoryId: "jam", categoryName: "Mermeladas", defaultPrice: 12000, active: true, deleted: false });
  const before = businessCount(f);
  const first = await prepareTool(f);
  assert.equal(first.state, "DATOS_INCOMPLETOS");
  assert.match(first.data.summary, /Aceite de Oliva Arbequina 500cc/);
  assert.doesNotMatch(first.data.summary, /precio de venta/);
  assert.deepEqual(first.data.choices.map(choice => choice.name), ["Arbequina500cc"]);
  const task = taskFromTool(null, tool, f.args, first);
  assert.equal(task.ambiguities.catalogProducts[0].products[0].productId, "oil");
  const patched = updateTask(task, tool, JSON.stringify({ reason: "Mercadería recibida" }));
  assert.deepEqual(patched.ambiguities, task.ambiguities);
  f.args.items[0].productId = task.ambiguities.catalogProducts[0].products[0].productId;
  const ready = await prepareTool(f);
  assert.match(ready.prepared.summary, /0 productos y 0 categorías/);
  assert.match(ready.prepared.summary, /Reutilizar Pasta de Aceitunas Negra/);
  assert.equal(businessCount(f), before);
  assert.equal(f.commits.length, 0);
});

test("la lista de diez productos se prepara completa, reutiliza categorías/nombres y no modifica datos", async () => {
  const f = catalogFixture(), before = businessCount(f);
  const result = await prepareTool(f);
  assert.match(result.prepared.summary, /10 productos, 768 unidades/);
  assert.match(result.prepared.summary, /9 productos y 3 categorías/);
  assert.match(result.prepared.summary, /Reutilizar Arbequina 500cc.*\+540.*4 → 544/);
  assert.equal(result.prepared.canonicalArgs.items.length, 10);
  assert.equal(businessCount(f), before);
  assert.equal(f.commits.length, 0);
});

test("una confirmación doble crea catálogo, suma stock y audita toda la lista una sola vez", async () => {
  const f = catalogFixture(), pending = await proposal(f);
  assert.ok(pending.pendingAction);
  assert.ok(f.providerRequests[0].tools.some(definition => definition.name === tool));
  assert.match(f.providerRequests[0].instructions, /TODA la lista/);
  assert.equal(rows(f, "products/").length, 1);
  const [first, second] = await Promise.all([f.engine.confirm(f.session, pending.confirm), f.engine.confirm(f.session, pending.confirm)]);
  assert.equal(first.state, "COMPLETADA"); assert.equal(second.state, "COMPLETADA");
  assert.equal(rows(f, "products/").length, 10);
  assert.equal(rows(f, "productCategories/").length, 4);
  assert.equal(rows(f, "stockMovements/").length, 10);
  assert.equal(rows(f, "stockOperations/").length, 1);
  const stock = f.documents.get("locationStock/local_a/items/oil");
  assert.equal(stock.currentStock, 544); assert.equal(stock.priceOverride, 1900); assert.equal(stock.yellowAlertQty, 3); assert.equal(stock.redAlertQty, 1);
  const operation = rows(f, "stockOperations/")[0][1];
  assert.equal(operation.totalUnits, 768); assert.equal(operation.createdProducts, 9);
  const commit = f.commits.find(writes => writes.some(write => write.path.startsWith("stockOperations/")));
  assert.ok(commit.some(write => write.path.startsWith("oliviaConfirmations/") && write.data.status === "completed"));
  assert.equal(new Set(commit.map(write => write.path)).size, commit.length);
  for (const [, row] of rows(f, "auditLogs/")) { assert.equal(row.origin, "Asistente IA / Olivia"); assert.equal(row.requestId, "batch_prepare"); assert.ok(row.confirmationId && row.conversationId); }
});

test("un precio faltante pide solamente los datos del nuevo y preserva TODAS las líneas sin crear nada", async () => {
  const f = catalogFixture([item("Mermelada nueva", 12, { defaultPrice: null }), received.at(-1)]);
  const result = await prepareTool(f);
  assert.equal(result.state, "DATOS_INCOMPLETOS");
  assert.deepEqual(result.data.missing, ["items.0.defaultPrice"]);
  assert.match(result.data.summary, /precio de venta.*Mermelada nueva/);
  assert.doesNotMatch(result.data.summary, /precio de venta.*Arbequina/);
  const task = taskFromTool(null, tool, f.args, result, f.clock());
  assert.equal(task.slots.items.length, 2); assert.equal(task.status, "collecting");
  assert.equal(rows(f, "products/").length, 1); assert.equal(f.commits.length, 0);
});

test("corregir los datos conserva la lista y permite volver a preparar; no publica ecommerce", async () => {
  const f = catalogFixture([item("Mermelada nueva", 12, { defaultPrice: null })]);
  const result = await prepareTool(f), task = taskFromTool(null, tool, f.args, result, f.clock());
  const updated = updateTask(task, tool, JSON.stringify({ items: [item("Mermelada nueva", 12)] }), f.clock());
  assert.equal(updated.id, task.id);
  const plan = await extendedOperationPlan({ ...f, toolName: tool, args: updated.slots, now: f.clock() });
  assert.ok(plan.writes.some(write => write.path.startsWith("products/")));
  assert.equal(plan.writes.some(write => /ecommerce|catalogProducts|publicProducts|orders/.test(write.path)), false);
});

test("categorías compartidas y líneas repetidas se consolidan, con abreviaciones libres y stock agregado", async () => {
  const f = catalogFixture([item("Dulces", 2, { categoryName: "Dulces", abbreviation: "DUL" }), item("Dulces", 3, { categoryName: "Dulces", abbreviation: "DUL" }), item("Dulces especiales", 4, { categoryName: "Dulces" })]);
  const plan = await extendedOperationPlan({ ...f, toolName: tool, args: f.args, now: f.clock() });
  assert.equal(plan.writes.filter(write => write.path.startsWith("productCategories/")).length, 1);
  assert.equal(plan.writes.filter(write => write.path.startsWith("products/")).length, 2);
  assert.equal(new Set(plan.writes.map(write => write.path)).size, plan.writes.length);
  assert.match(plan.summary, /Dulces.*\+5 unidades/);
  const productWrites = plan.writes.filter(write => write.path.startsWith("products/"));
  assert.equal(new Set(productWrites.map(write => write.data.abbreviation)).size, 2);
});

test("nombres parecidos y duplicados no provocan altas duplicadas: devuelve opciones verificadas", async () => {
  const f = catalogFixture([item("ducle alcayota", 12)]);
  f.documents.set("products/jam", { name: "Dulce alcayota", abbreviation: "ALC", active: true, defaultPrice: 2000 });
  const result = await prepareTool(f);
  assert.equal(result.state, "DATOS_INCOMPLETOS"); assert.equal(result.data.choices[0].products[0].productId, "jam");
  f.args.items[0].productId = "jam";
  const matched = await prepareTool(f);
  assert.match(matched.prepared.summary, /0 productos y 0 categorías/);
  assert.match(matched.prepared.summary, /Reutilizar Dulce alcayota/);
});

test("cancelar, perder permisos o cambiar catálogo/stock invalida el lote completo sin escrituras parciales", async () => {
  for (const change of ["cancel", "stock", "catalog", "permission"]) {
    const f = catalogFixture(), pending = await proposal(f);
    if (change === "cancel") await f.engine.cancel(f.session, { conversationId: pending.conversationId, requestId: "cancel_batch" });
    if (change === "stock") f.documents.get("locationStock/local_a/items/oil").currentStock = 5;
    if (change === "catalog") f.documents.set("products/concurrent", { name: "Dulce alcayota", abbreviation: "ALC", active: true, defaultPrice: 2200 });
    if (change === "permission") f.documents.set("users/user_a", { ...f.session.profile, permissionDeny: { products: ["create"] } });
    const before = businessCount(f);
    await assert.rejects(f.engine.confirm(f.session, pending.confirm));
    assert.equal(businessCount(f), before); assert.equal(rows(f, "stockOperations/").length, 0); assert.equal(rows(f, "stockMovements/").length, 0);
  }
});

test("vendedores y permisos parciales no obtienen acceso al catálogo ni crean categorías", async () => {
  const seller = catalogFixture(received, { role: "seller" });
  assert.equal(toolDefinitions(seller.session).some(definition => definition.name === tool), false);
  await assert.rejects(prepareTool(seller), { code: "permission-denied" });
  const noCategories = catalogFixture([item("Ají picante", 2, { categoryName: "Conservas" })]);
  noCategories.session.profile.permissionDeny = { products: ["edit"] };
  noCategories.documents.set("users/user_a", structuredClone(noCategories.session.profile));
  await assert.rejects(prepareTool(noCategories), { code: "permission-denied" });
});

test("productos/categorías/asignaciones inactivas, abreviaciones ocupadas y cantidades inválidas bloquean sin crear", async () => {
  for (const change of ["product", "category", "assignment", "abbreviation", "quantity"]) {
    const f = catalogFixture([received.at(-1)]);
    if (change === "product") f.documents.get("products/oil").active = false;
    if (change === "assignment") f.documents.get("locationStock/local_a/items/oil").active = false;
    if (change === "category") { f.args.items = [item("Mermelada nueva", 2)]; f.documents.get("productCategories/jam").active = false; }
    if (change === "abbreviation") f.args.items = [item("Mermelada nueva", 2, { abbreviation: "ARB500" })];
    if (change === "quantity") f.args.items[0].quantity = -1;
    await assert.rejects(prepareTool(f)); assert.equal(f.commits.length, 0);
  }
});
