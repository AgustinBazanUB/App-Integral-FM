import test from "node:test";
import assert from "node:assert/strict";
import { fixture, start, functionResponse } from "./helpers/olivia-fixture.mjs";
import { runTool } from "../netlify/functions/_lib/olivia/tools.mjs";
import { publishKnowledge, retrieveKnowledge, removeKnowledge, listKnowledge } from "../netlify/functions/_lib/olivia/knowledge.mjs";
import { prepareExtendedOperation } from "../netlify/functions/_lib/olivia/extendedOperations.mjs";

const transfer = { originType: "warehouse", originId: "main", destinationType: "location", destinationId: "local_a", reason: "Feria de prueba local", carrierName: "Ana", lines: [{ productId: "oil", quantity: 3, preparedQuantity: 3, receivedQuantity: 2 }] };
function inventoryFixture(options = {}) {
  const f = fixture({ role: "admin", provider: () => functionResponse("prepare_stock_transfer", transfer), ...options });
  f.documents.set("warehouses/main", { name: "Depósito", active: true, deleted: false });
  f.documents.set("warehouseStock/main/items/oil", { productId: "oil", currentStock: 10, active: true, deleted: false });
  f.documents.set("locationStock/local_a/items/oil", { productId: "oil", currentStock: 4, active: true, priceMode: "custom", priceOverride: 1700, yellowAlertQty: 2 });
  return f;
}
async function prepare(f, tool, args) {
  const state = await start(f);
  const result = await f.engine.chat(f.session, { conversationId: state.conversationId, requestId: "prepare_a", message: "Prepará la operación indicada", screenContext: { route: "/gestion", module: "warehouse" } });
  return { ...result, confirm: { conversationId: state.conversationId, requestId: "confirm_a", confirmationToken: result.pendingAction?.confirmationToken } };
}
test("transfer preparation has no writes; concurrent double-click commits stock, physical losses and one audit atomically", async () => {
  const f = inventoryFixture(), result = await prepare(f);
  assert.match(result.pendingAction.summary, /Depósito.*Local A/);
  assert.equal(f.documents.get("warehouseStock/main/items/oil").currentStock, 10);
  await Promise.all([f.engine.confirm(f.session, result.confirm), f.engine.confirm(f.session, result.confirm)]);
  assert.equal(f.documents.get("warehouseStock/main/items/oil").currentStock, 7);
  const destination = f.documents.get("locationStock/local_a/items/oil");
  assert.equal(destination.currentStock, 6); assert.equal(destination.priceOverride, 1700); assert.equal(destination.yellowAlertQty, 2);
  const transfers = [...f.documents].filter(([path]) => path.startsWith("stockTransfers/")); assert.equal(transfers.length, 1);
  assert.equal(transfers[0][1].receivedQuantity, 2); assert.equal(transfers[0][1].lostQuantity, 1);
  const audits = [...f.documents].filter(([path, row]) => path.startsWith("auditLogs/") && row.action === "stock.transfer");
  assert.equal(audits.length, 1); assert.equal(audits[0][1].origin, "Asistente IA / Olivia"); assert.equal(audits[0][1].userId, f.session.uid); assert.ok(audits[0][1].conversationId && audits[0][1].confirmationId);
  assert.equal(audits[0][1].requestId, "prepare_a");
  assert.deepEqual(audits[0][1].before[0], { productId: "oil", originStock: 10, destinationStock: 4 });
  assert.deepEqual(audits[0][1].after[0], { productId: "oil", originStock: 7, destinationStock: 6 });
  const transaction = f.commits.find((writes) => writes.some((write) => write.path.startsWith("stockTransfers/")));
  assert.ok(transaction.some((write) => write.path.startsWith("oliviaConfirmations/") && write.data.status === "completed"));
});
test("cancel then stale-stock confirmation never publishes a partial transfer", async () => {
  const canceled = inventoryFixture(), proposal = await prepare(canceled);
  await canceled.engine.cancel(canceled.session, { conversationId: proposal.conversationId, requestId: "cancel_a" });
  await assert.rejects(canceled.engine.confirm(canceled.session, proposal.confirm), { code: "confirmation-invalid" });
  assert.equal(canceled.documents.get("warehouseStock/main/items/oil").currentStock, 10);
  const f = inventoryFixture(), pending = await prepare(f);
  f.documents.set("warehouseStock/main/items/oil", { ...f.documents.get("warehouseStock/main/items/oil"), currentStock: 8 });
  await assert.rejects(f.engine.confirm(f.session, pending.confirm), { code: "context-changed" });
  assert.equal(f.documents.get("locationStock/local_a/items/oil").currentStock, 4);
  assert.equal([...f.documents].some(([path]) => path.startsWith("stockTransfers/")), false);
});
test("permission revocation and impossible physical receipt block execution", async () => {
  const f = inventoryFixture(), pending = await prepare(f);
  f.documents.set("users/user_a", { ...f.session.profile, active: false });
  await assert.rejects(f.engine.confirm(f.session, pending.confirm), { code: "permission-denied" });
  const valid = inventoryFixture();
  await assert.rejects(prepareExtendedOperation({ ...valid, toolName: "prepare_stock_transfer", args: { ...transfer, lines: [{ ...transfer.lines[0], receivedQuantity: 4 }] }, now: valid.clock() }), /recibida|recibid/i);
  valid.documents.set("users/user_a", fixture().session.profile);
  await assert.rejects(runTool({ ...valid, session: fixture().session, name: "prepare_stock_transfer", args: transfer, context: {}, now: valid.clock() }), { code: "permission-denied" });
});
const location = { locationId: null, name: "Feria QA", type: "fair", codePrefix: "QA", startDate: "2026-10-10", endDate: "2026-10-11", dniMode: "recommended" };
const expense = { name: "Alquiler QA", amountCents: 12345, category: "Alquiler local", nature: "fixed", locationId: null, accruedOn: "2026-10-04", dueOn: "2026-10-10", paidOn: null, cashAccount: "", notes: "Solo fixture" };
for (const [tool, args, collection] of [
  ["prepare_create_location", location, "locations"], ["prepare_expense_create", expense, "financialEntries"],
  ["prepare_alert_create", { entityId: null, name: "Alerta QA", notes: "Fixture" }, "alerts"],
  ["prepare_supplier_create", { entityId: null, name: "Proveedor QA", notes: "Fixture" }, "suppliers"],
  ["prepare_social_lead_create", { entityId: null, name: "Consulta QA", notes: "Fixture" }, "socialLeads"],
  ["prepare_marketing_campaign", { entityId: null, name: "Campaña QA", notes: "Fixture" }, "campaigns"],
  ["prepare_warehouse_create", { entityId: null, name: "Depósito QA", notes: "Fixture" }, "warehouses"],
]) test(`${tool} reuses its real domain and commits exactly once after visual confirmation`, async () => {
  const f = fixture({ role: "admin", provider: () => functionResponse(tool, args) }), result = await prepare(f);
  assert.ok(result.pendingAction);
  await f.engine.confirm(f.session, result.confirm); await f.engine.confirm(f.session, result.confirm);
  const records = [...f.documents].filter(([path, row]) => path.startsWith(`${collection}/`) && row.createdBy === f.session.uid);
  assert.equal(records.length, 1);
  if (tool === "prepare_expense_create") assert.equal(records[0][1].amount, 123.45);
  if (tool === "prepare_marketing_campaign") assert.equal(records[0][1].status, "draft");
});

test("Olivia cannot create or mutate shipments outside the shipping sale workflow", async () => {
  const f = fixture({ role: "admin" });
  for (const toolName of ["prepare_shipment_create", "prepare_shipment_update"]) {
    await assert.rejects(prepareExtendedOperation({ ...f, toolName, args: { entityId: "shipping", name: "Pedido QA", notes: "Fixture" }, now: f.clock() }), { code: "shipping-sales-only" });
  }
  assert.equal([...f.documents.keys()].filter(path => path.startsWith("shipments/")).length, 0);
});
test("location edits retain assignments; customer phone identity is deterministic and enriches only blanks", async () => {
  const f = fixture({ role: "admin" });
  f.documents.set("locations/local_a", { ...f.documents.get("locations/local_a"), type: "fair", enabledDiscountIds: ["promo"], operatingCalendar: { weekdays: [6,7], dates: [], excludedDates: [] } });
  const prepared = await prepareExtendedOperation({ ...f, toolName: "prepare_update_location", args: { ...location, locationId: "local_a" }, now: f.clock() }); assert.ok(prepared.snapshotFingerprint);
  const customer = { customerId: null, phone: "+54 9 11 2345 6789", name: "Cliente QA", zoneId: null, zoneName: "" };
  const result = await runTool({ ...f, name: "prepare_customer_create", args: customer, context: {}, now: f.clock() }); assert.ok(result.prepared);
  f.documents.set("users/user_a", fixture().session.profile);
  const bad = { ...f, session: { ...f.session, profile: { ...f.session.profile, role: "seller" } } };
  await assert.rejects(runTool({ ...bad, name: "get_customer", args: { customerId: "any" }, context: {} }), { code: "permission-denied" });
});
test("knowledge publication, semantic permission filters, retirement and retries do not leak retired documents", async () => {
  const f = fixture({ role: "admin" }), requests = [];
  const form = new FormData(); form.set("file", new File(["Procedimiento QA"], "procedure.txt", { type: "text/plain" })); form.set("audience", "admin"); form.set("module", "finance"); form.set("requestId", "document_a"); form.set("confirmed", "true");
  const provider = async (path, body, options) => {
    requests.push({ path, body, options });
    if (path === "vector_stores") return { id: "vs_fixture" };
    if (path === "files") return { id: "file-fixture" };
    if (path.endsWith("/search")) return { data: [{ file_id: "file-fixture", attributes: { documentId: "document_a" }, content: [{ type: "text", text: "Regla empresarial de QA" }], score: .8 }] };
    return { status: "completed" };
  };
  await publishKnowledge({ ...f, form, provider }); await publishKnowledge({ ...f, form, provider });
  assert.equal(requests.filter((request) => request.path === "files").length, 1);
  assert.equal((await listKnowledge({ ...f, provider }))[0].status, "completed");
  const admin = await retrieveKnowledge({ ...f, query: "procedimiento financiero", context: { module: "finance" }, provider }); assert.ok(admin.documents.some((doc) => doc.id === "document_a"));
  const seller = await retrieveKnowledge({ ...f, session: fixture().session, query: "procedimiento financiero", context: { module: "seller" }, provider }); assert.equal(seller.documents.some((doc) => doc.id === "document_a"), false);
  const filter = requests.filter((row) => row.path.endsWith("/search")).at(-1).body.attribute_filter;
  assert.ok(filter.filters.some((rule) => rule.key === "audience" && rule.value === "seller"));
  await removeKnowledge({ ...f, body: { id: "document_a", confirmed: true, requestId: "retire_a" }, provider });
  await removeKnowledge({ ...f, body: { id: "document_a", confirmed: true, requestId: "retire_a" }, provider });
  const retired = await retrieveKnowledge({ ...f, query: "QA", provider }); assert.equal(retired.documents.some((doc) => doc.id === "document_a"), false);
  assert.equal([...f.documents].filter(([path]) => path.startsWith("auditLogs/olivia_knowledge_retire_")).length, 1);
  await assert.rejects(publishKnowledge({ ...f, session: fixture().session, form, provider }), { code: "permission-denied" });
});
test("knowledge provider failure falls back to curated context; missing visual approval never publishes", async () => {
  const f = fixture({ role: "admin" }); f.documents.set("oliviaKnowledgeSettings/global", { vectorStoreId: "vs_fixture" });
  const result = await retrieveKnowledge({ ...f, query: "stock", context: { module: "locations" }, provider: async () => { throw new Error("Offline"); } });
  assert.equal(result.retrieval, "curated-fallback"); assert.equal(result.storageCostUsd, null); assert.ok(result.documents.length);
  await assert.rejects(publishKnowledge({ ...f, form: new FormData() }), { code: "confirmation-required" });
});
test("CRM confirmation uses canonical identity and preserves existing nonempty data and history", async () => {
  const args = { customerId: null, phone: "+54 9 11 2345 6789", name: "Cliente QA", zoneId: null, zoneName: "" };
  const f = fixture({ role: "admin", provider: () => functionResponse("prepare_customer_create", args) });
  const proposal = await prepare(f);
  await f.engine.confirm(f.session, proposal.confirm);
  const [path, row] = [...f.documents].find(([path, row]) => path.startsWith("customers/") && row.phoneNormalized === "1123456789");
  assert.equal(row.name, "Cliente QA");
  f.documents.set(path, { ...row, name: "Nombre registrado", totalPurchases: 7, lastSaleId: "previous_sale" });
  f.advance(2000);
  const state = await f.engine.state(f.session, proposal.conversationId);
  const next = await f.engine.chat(f.session, { conversationId: state.conversationId, requestId: "crm_retry", message: "Completá el cliente" });
  await f.engine.confirm(f.session, { conversationId: state.conversationId, confirmationToken: next.pendingAction.confirmationToken });
  assert.equal(f.documents.get(path).name, "Nombre registrado");
  assert.equal(f.documents.get(path).totalPurchases, 7);
  assert.equal(f.documents.get(path).lastSaleId, "previous_sale");
});
