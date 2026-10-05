import test from "node:test";
import assert from "node:assert/strict";
import { fixture, start, functionResponse } from "./helpers/olivia-fixture.mjs";
import { runTool } from "../netlify/functions/_lib/olivia/tools.mjs";
import { extendedOperationPlan } from "../netlify/functions/_lib/olivia/extendedOperations.mjs";
import { purgeOliviaResources } from "../netlify/functions/olivia-resource-retention.mjs";
import { listKnowledgePage } from "../netlify/functions/_lib/olivia/knowledge.mjs";
import { financeSummary } from "../src/gestion/finance/financeDomain.js";
import { analyticsPeriod } from "../netlify/functions/_lib/olivia/analytics.mjs";
const period = { startDate: "2026-10-01", endDate: "2026-10-04", locationId: null, productId: null, sellerId: null };
const fact = (id, date, locationId, qty = 10) => ({ id, createdAt: new Date(date + "T15:00:00Z"), locationId, status: "active", total: qty * 100, items: [{ productId: "oil", name: "Aceite", qty, unitPrice: 100 }], paymentMethod: "cash" });

test("live forecast uses explicit comparable events and real stock; resulting transfer uses shared atomic plan", async () => {
  const f = fixture({ role: "admin" });
  f.documents.delete("sales/old");
  f.documents.set("locations/future", { name: "Pilar QA", type: "fair", active: true, scheduleStartAt: "2026-10-10T03:00:00Z" });
  f.documents.set("locations/past", { name: "Feria anterior", type: "fair", active: false });
  f.documents.set("sales/fair_a", fact("fair_a", "2026-09-26", "past"));
  f.documents.set("sales/fair_b", fact("fair_b", "2026-09-27", "past"));
  f.documents.set("locationStock/future/items/oil", { currentStock: 2, productId: "oil" });
  const events = await runTool({ ...f, name: "list_fair_events", args: { query: "Pilar" }, context: {}, now: f.clock() });
  assert.ok(JSON.stringify(events.data).includes("future"));
  const result = await runTool({ ...f, name: "forecast_fair", args: { locationId: "future", startDate: "2026-10-10", days: 2, comparableLocationIds: ["past"] }, context: {}, now: f.clock() });
  assert.equal(result.data.products[0].expectedUnits, 20);
  assert.equal(result.data.products[0].recommendedStock, 24);
  assert.equal(result.data.products[0].suggestedTransferQuantity, 22);
  f.documents.set("warehouses/main", { name: "Depósito QA", active: true });
  f.documents.set("warehouseStock/main/items/oil", { currentStock: 30, active: true });
  const plan = await extendedOperationPlan({ ...f, toolName: "prepare_stock_transfer", args: { originType: "warehouse", originId: "main", destinationType: "location", destinationId: "future", reason: "Pronóstico revisado", carrierName: "QA", lines: [{ productId: "oil", quantity: 22, preparedQuantity: 22, receivedQuantity: 22 }] }, now: f.clock(), entityId: "forecast_transfer" });
  assert.equal(plan.writes.find((write) => write.path === "warehouseStock/main/items/oil").data.currentStock, 8);
  assert.equal(plan.writes.find((write) => write.path === "locationStock/future/items/oil").data.currentStock, 24);
  assert.equal(f.documents.get("warehouseStock/main/items/oil").currentStock, 30);
});
test("metrics include a product and location that fell to zero in the current period", async () => {
  const f = fixture({ role: "admin" });
  for (const path of [...f.documents.keys()]) if (path.startsWith("sales/")) f.documents.delete(path);
  f.documents.set("sales/previous", fact("previous", "2026-09-30", "fell"));
  const result = await runTool({ ...f, name: "get_sales_metrics", args: period, context: {}, now: f.clock() });
  assert.equal(result.data.products[0].unitsChangePercent, -100);
  assert.equal(result.data.locations[0].changePercent, -100);
});

test("text follow-ups reload the server-recorded Skill without exposing it to an unauthorized role", async () => {
  const f = fixture({ role: "admin" }), state = await start(f);
  await f.engine.chat(f.session, { conversationId: state.conversationId, requestId: "forecast", message: "¿Qué llevo a la feria?" });
  assert.ok(f.documents.get(`oliviaConversations/${state.conversationId}`).activeSkills.some((skill) => skill.name === "pronosticar-feria"));
  f.advance(2000);
  await f.engine.chat(f.session, { conversationId: state.conversationId, requestId: "followup", message: "Prepará eso" });
  assert.ok(f.providerRequests.at(-1).instructions.includes("name: pronosticar-feria"));
  f.advance(2000);
  await f.engine.chat(f.session, { conversationId: state.conversationId, requestId: "new_subject", message: "Hola" });
  assert.equal(f.documents.get(`oliviaConversations/${state.conversationId}`).activeSkills.length, 0);
});

test("fiscal status reads actual nested ARCA authorization fields without leaking credentials", async () => {
  const f = fixture({ role: "admin" });
  f.documents.set("sales/fiscal", { fiscalInvoiceId: "invoice", fiscalInvoiceStatus: "authorized", fiscalInvoice: { sourceType: "seller_sale", status: "authorized" } });
  f.documents.set("invoices/invoice", { sourceId: "fiscal", status: "authorized", authorization: { voucherNumber: 123, cae: "12345678901234", caeExpiration: "20261020", token: "private" }, credentials: "private" });
  const result = await runTool({ ...f, name: "get_invoice_status", args: { entityId: "fiscal" }, context: {}, now: f.clock() });
  assert.equal(result.data.sale.fiscalInvoiceId, "invoice");
  assert.equal(result.data.invoices[0].authorization.voucherNumber, 123);
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("customer history includes migrated identities and legacy phone snapshots without double-counting", async () => {
  const f = fixture({ role: "admin" });
  f.documents.set("customers/current", { phoneNormalized: "1123456789", migratedFromCustomerId: "old" });
  f.documents.set("customers/old", { migratedFromCustomerId: "older" });
  f.documents.set("sales/customer_a", { ...fact("customer_a", "2026-10-03", "local_a", 2), customerId: "older" });
  f.documents.set("sales/customer_b", { ...fact("customer_b", "2026-10-04", "local_a", 3), customerId: "current", customerPhoneSnapshot: "+5491123456789" });
  f.documents.set("sales/customer_c", { ...fact("customer_c", "2026-10-04", "local_a", 1), customerPhoneSnapshot: "1123456789" });
  const result = await runTool({ ...f, name: "get_customer_history", args: { customerId: "current" }, context: {}, now: f.clock() });
  assert.equal(result.data.sales.length, 3);
  assert.equal(result.data.summary.total, 600);
  assert.equal(result.data.partial, false);
});
test("finance includes a payment outside its accrual period and matches the manual finance domain", async () => {
  const f = fixture({ role: "admin" }), entry = { id: "paid_old", type: "expense", name: "Gasto anterior pagado", amount: 125, nature: "fixed", category: "Servicios", scope: "general", accruedOn: "2026-09-10", paidOn: "2026-10-02", cashAccount: "cash", status: "active", occurredAt: new Date("2026-09-10T03:00:00Z"), paidAt: new Date("2026-10-02T03:00:00Z") };
  f.documents.set("financialEntries/paid_old", entry);
  const result = await runTool({ ...f, name: "get_financial_summary", args: period, context: {}, now: f.clock() });
  const sales = [...f.documents].filter(([path]) => path.startsWith("sales/")).map(([path, value]) => ({ ...value, id: path.split("/").at(-1) }));
  const expected = financeSummary(sales, [entry], {}, analyticsPeriod(period, f.clock()), [], f.clock());
  assert.equal(result.data.summary.cashMovement, expected.cashMovement);
  assert.equal(result.data.summary.expenseTotal, expected.expenseTotal);
  assert.ok(result.data.expenses.some((row) => row.id === "paid_old"));
});
test("permissions changed since the chat was created block resume, model context and seller history", async () => {
  const f = fixture({ role: "admin" }), state = await start(f);
  const seller = { ...f.session, profile: { ...fixture().session.profile } };
  await assert.rejects(f.engine.resumeConversation(seller, { conversationId: state.conversationId }), { code: "permission-scope-changed" });
  await assert.rejects(f.engine.chat(seller, { conversationId: state.conversationId, requestId: "changed", message: "Leé el historial" }), { code: "permission-scope-changed" });
  await assert.rejects(f.engine.history(seller, { conversationId: state.conversationId }), { code: "permission-scope-changed" });
  assert.equal(f.providerCalls(), 0);
});
test("legacy admin context cannot reach a seller; known seller history remains compatible", async () => {
  const f = fixture(), state = await start(f), path = `oliviaConversations/${state.conversationId}`;
  const legacy = { ...f.documents.get(path), roleBinding: null, permissionScope: null, messageCount: 1, messages: [{ id: "legacy", role: "assistant", content: "Información administrativa", createdAt: f.clock().toISOString() }] };
  f.documents.set(path, legacy);
  f.documents.set("oliviaUsage/previous", { userId: f.session.uid, role: "admin", createdAt: f.clock() });
  await assert.rejects(f.engine.chat(f.session, { conversationId: state.conversationId, requestId: "legacy_chat", message: "Leé lo anterior" }), { code: "permission-scope-changed" });
  assert.equal(f.providerCalls(), 0);
  f.documents.set("oliviaUsage/previous", { userId: f.session.uid, role: "seller", createdAt: f.clock() });
  assert.equal((await f.engine.state(f.session, state.conversationId)).messages.length, 1);
});
test("closed native voice may persist its queued transcript for 60 seconds but cannot execute tools", async () => {
  const f = fixture({ role: "admin" }), state = await start(f);
  f.documents.set("oliviaRealtime/closed_voice", { nativeTools: true, status: "closed", closedAt: f.clock(), expiresAt: f.clock(), userId: f.session.uid, sessionBinding: String(f.session.authTime), conversationId: state.conversationId });
  const fields = { conversationId: state.conversationId, realtimeSessionId: "closed_voice", inputId: "input", responseId: "response", message: "Hola", text: "Hola, estoy disponible" };
  await f.engine.realtimeTranscript(f.session, fields);
  await assert.rejects(f.engine.realtimeTool(f.session, { ...fields, requestId: "tool", callId: "call", tool: "list_warehouses", args: {} }), { code: "realtime-expired" });
  f.advance(60001);
  await assert.rejects(f.engine.realtimeTranscript(f.session, { ...fields, responseId: "late" }), { code: "realtime-expired" });
});
test("product preparation validates the manual catalog rules and category before opening the form", async () => {
  const f = fixture({ role: "admin" }), args = { name: "Producto QA", abbreviation: "QA", defaultPrice: 100, categoryId: "cat", description: "Fixture" };
  await assert.rejects(extendedOperationPlan({ ...f, toolName: "prepare_product_create", args, now: f.clock() }), { code: "category-unavailable" });
  f.documents.set("productCategories/cat", { name: "Categoría QA", active: true });
  const plan = await extendedOperationPlan({ ...f, toolName: "prepare_product_create", args, now: f.clock() });
  assert.equal(plan.navigation.path, "/gestion/products");
  assert.equal(plan.writes.some((write) => write.path.startsWith("products/")), false);
  await assert.rejects(extendedOperationPlan({ ...f, toolName: "prepare_product_create", args: { ...args, abbreviation: "" }, now: f.clock() }), /abreviación/);
});
test("resource cleanup retains provider failures for retry and stops at its budget", async () => {
  const f = fixture({ role: "admin" });
  f.documents.set("oliviaAttachments/file_a", { expiresAt: new Date(0), providerFileId: "file-qa" });
  const failed = await purgeOliviaResources({ ...f, now: f.clock(), provider: async () => { throw new Error("Unavailable"); } });
  assert.equal(failed.pending, 1); assert.equal(failed.backlog, true);
  assert.ok(f.documents.has("oliviaAttachments/file_a"));
  const timed = await purgeOliviaResources({ ...f, now: f.clock(), timeBudgetMs: 0, provider: async () => ({ deleted: true }) });
  assert.ok(timed.pending > 0);
  const complete = await purgeOliviaResources({ ...f, now: f.clock(), provider: async () => ({ deleted: true }) });
  assert.equal(complete.removed, 1); assert.equal(f.documents.has("oliviaAttachments/file_a"), false);
});
test("knowledge library pagination exposes all documents without an unbounded provider fanout", async () => {
  const f = fixture({ role: "admin" });
  for (let index = 0; index < 105; index++) f.documents.set(`oliviaKnowledgeDocuments/doc_${String(index).padStart(3, "0")}`, { name: `Doc ${index}`, createdAt: new Date(1000 + index), active: true, status: "in_progress", providerFileId: `file-${index}`, vectorStoreId: "vs_qa" });
  let calls = 0;
  const provider = async () => { calls++; return { status: "completed" }; };
  const first = await listKnowledgePage({ ...f, provider });
  assert.equal(first.documents.length, 100); assert.ok(first.nextCursor); assert.equal(calls, 5);
  const second = await listKnowledgePage({ ...f, provider, cursor: first.nextCursor });
  assert.equal(second.documents.length, 5);
  assert.equal(new Set([...first.documents, ...second.documents].map((doc) => doc.id)).size, 105);
});
