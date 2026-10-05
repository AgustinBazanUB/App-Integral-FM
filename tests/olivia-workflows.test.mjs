import test from "node:test";
import assert from "node:assert/strict";
import { fixture, start, functionResponse } from "./helpers/olivia-fixture.mjs";
import { runTool } from "../netlify/functions/_lib/olivia/tools.mjs";
import { publishKnowledge, retrieveKnowledge, removeKnowledge, listKnowledge } from "../netlify/functions/_lib/olivia/knowledge.mjs";
import { prepareExtendedOperation } from "../netlify/functions/_lib/olivia/extendedOperations.mjs";
import { OliviaRealtime } from "../src/gestion/olivia/realtime.mjs";
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
  ["prepare_shipment_create", { entityId: null, name: "Envío QA", notes: "Fixture" }, "shipments"],
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
async function nativeFixture() {
  const f = inventoryFixture(), state = await start(f), realtimeSessionId = "voice_a";
  f.documents.set(`oliviaRealtime/${realtimeSessionId}`, { status: "active", nativeTools: true, userId: f.session.uid, conversationId: state.conversationId, sessionBinding: String(f.session.authTime), expiresAt: new Date(f.clock().getTime() + 180000) });
  return { ...f, conversationId: state.conversationId, realtimeSessionId };
}
test("native knowledge uses authorized semantic retrieval and records only backend-loaded Skills", async () => {
  const f = await nativeFixture(), requests = [];
  f.documents.set("oliviaKnowledgeSettings/global", { vectorStoreId: "vs_qa" });
  f.documents.set("oliviaKnowledgeDocuments/procedure", { name: "Procedimiento QA", active: true, status: "completed", audience: "admin", module: "warehouse", providerFileId: "file-qa" });
  // Build an engine with the same durable fixture store and a real-shaped retrieval response.
  const { createOliviaEngine } = await import("../netlify/functions/_lib/olivia/engine.mjs");
  const engine = createOliviaEngine({ store: f.store, clock: f.clock, env: { OPENAI_API_KEY: "fixture" }, provider: async (path) => { requests.push(path); return { data: [{ file_id: "file-qa", attributes: { documentId: "procedure" }, content: [{ type: "text", text: "Revisar recepción física." }] }] }; } });
  const base = { conversationId: f.conversationId, realtimeSessionId: f.realtimeSessionId, inputId: "spoken_a", message: "Prepará mercadería", skills: ["pronosticar-feria"] };
  const knowledge = await engine.realtimeTool(f.session, { ...base, requestId: "knowledge", callId: "knowledge_call", tool: "search_knowledge", args: { query: "Recepción física" } });
  assert.ok(knowledge.data.documents.some((row) => row.id === "procedure"));
  assert.equal(requests.some((path) => path === "responses"), false);
  const proposal = await engine.realtimeTool(f.session, { ...base, requestId: "forged", callId: "forged_call", tool: "prepare_stock_transfer", args: transfer });
  const action = f.documents.get(`oliviaConfirmations/${proposal.pendingAction.id}`);
  assert.equal(action.prepared.skill, null);
  await engine.realtimeTool(f.session, { ...base, requestId: "load", callId: "load_call", tool: "load_skill", args: { name: "pronosticar-feria" } });
  const verified = await engine.realtimeTool(f.session, { ...base, requestId: "verified", callId: "verified_call", tool: "prepare_stock_transfer", args: transfer });
  assert.deepEqual(f.documents.get(`oliviaConfirmations/${verified.pendingAction.id}`).prepared.skill, { name: "pronosticar-feria", version: "1.1.0" });
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
test("native voice executes only an authorized backend tool without a Responses round-trip and deduplicates actual transcripts", async () => {
  const f = await nativeFixture(), fields = { conversationId: f.conversationId, realtimeSessionId: f.realtimeSessionId, requestId: "voice_tool", inputId: "spoken_a", callId: "call_a", message: "¿Cuánto stock hay?", tool: "get_inventory_summary", args: { inventoryType: "warehouse", inventoryId: "main" } };
  const result = await f.engine.realtimeTool(f.session, fields); assert.equal(result.data.items[0].currentStock, 10); assert.equal(f.providerCalls(), 0);
  await f.engine.realtimeTool(f.session, fields); assert.equal(f.providerCalls(), 0);
  await assert.rejects(f.engine.realtimeTool(f.session, { ...fields, args: { ...fields.args, inventoryId: "other" } }), { code: "request-already-used" });
  const transcript = { ...fields, responseId: "response_a", text: "Hay diez unidades en Depósito." };
  await f.engine.realtimeTranscript(f.session, transcript); await f.engine.realtimeTranscript(f.session, transcript);
  const snapshot = await f.engine.state(f.session, f.conversationId);
  assert.equal(snapshot.messages.filter((message) => message.role === "user").length, 1);
  assert.equal(snapshot.messages.filter((message) => message.content === transcript.text).length, 1);
  assert.equal(snapshot.messages.filter((message) => message.hiddenFromChat).length, 1);
});
test("native voice keeps a visual proposal across further reads and never writes on spoken yes", async () => {
  const f = await nativeFixture(), base = { conversationId: f.conversationId, realtimeSessionId: f.realtimeSessionId, inputId: "spoken_a", message: "Prepará la transferencia" };
  const result = await f.engine.realtimeTool(f.session, { ...base, requestId: "prepare", callId: "call_a", tool: "prepare_stock_transfer", args: transfer }); assert.ok(result.pendingAction);
  const afterRead = await f.engine.realtimeTool(f.session, { ...base, requestId: "read", callId: "call_b", tool: "list_warehouses", args: {} }); assert.equal(afterRead.pendingAction.id, result.pendingAction.id);
  await f.engine.realtimeTranscript(f.session, { ...base, responseId: "response_a", text: "Confirmá en la tarjeta" });
  assert.equal(f.documents.get("warehouseStock/main/items/oil").currentStock, 10);
  await assert.rejects(f.engine.realtimeTool({ ...f.session, uid: "foreign" }, { ...base, requestId: "foreign", callId: "foreign", tool: "list_warehouses", args: {} }), { code: "realtime-expired" });
});
function browserVoice(overrides = {}) {
  const events = [], errors = [], tools = [], transcripts = [], states = [], inputs = [], acknowledgements = [];
  const track = { enabled: true, stopped: 0, stop() { this.stopped++; } }, channel = { readyState: "open", send(text) { events.push(JSON.parse(text)); }, close() { this.readyState = "closed"; } };
  class Peer { constructor() { this.connectionState = "connected"; } addTrack() {} createDataChannel() { return channel; } async createOffer() { return { sdp: "offer" }; } async setLocalDescription() {} async setRemoteDescription() {} close() { this.closed = true; } }
  const voice = new OliviaRealtime({ createSession: async () => ({ sdp: "answer", nativeTools: true, realtimeSessionId: "voice_a" }), onRequest: () => { throw new Error("Native voice must not call Responses"); }, onTool: async (fields) => { tools.push(fields); return { data: { stock: 10 } }; }, onTranscript: async (fields) => transcripts.push(fields), onInput: (input) => inputs.push(input), acknowledge: () => { acknowledgements.push(true); return "Reviso eso"; }, onError: (error) => errors.push(error), onState: (state) => states.push(state), mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) }, PeerConnection: Peer, createAudio: () => ({ pause() {}, remove() {} }), setTimer: () => 1, clearTimer() {}, ...overrides });
  return { voice, events, errors, tools, transcripts, states, inputs, track, acknowledgements };
}
test("native browser voice handles function-before-ASR, mute, typed context, barge-in, teardown and reconnection", async () => {
  const f = browserVoice(); await f.voice.connect();
  f.voice.setMuted(true); assert.equal(f.track.enabled, false); assert.equal(f.voice.closed, false);
  f.voice.handleEvent({ type: "input_audio_buffer.committed", item_id: "input_a" });
  f.voice.handleEvent({ type: "response.created", response: { id: "response_a" } });
  f.voice.handleEvent({ type: "response.function_call_arguments.done", response_id: "response_a", call_id: "call_a", name: "get_stock", arguments: "{}" });
  assert.equal(f.tools.length, 0);
  f.voice.handleEvent({ type: "conversation.item.input_audio_transcription.completed", item_id: "input_a", transcript: "Revisá el stock" });
  f.voice.handleEvent({ type: "response.done", response: { id: "response_a", output: [{ type: "function_call" }] } });
  await f.voice.queue;
  assert.equal(f.tools.length, 1); assert.equal(f.acknowledgements.length, 1); assert.equal(f.inputs[0].message, "Revisá el stock");
  assert.ok(f.events.some((event) => event.type === "response.create"));
  f.voice.handleEvent({ type: "response.created", response: { id: "response_b" } });
  f.voice.handleEvent({ type: "input_audio_buffer.speech_started" });
  f.voice.handleEvent({ type: "response.output_audio_transcript.done", response_id: "response_b", transcript: "Hay diez unidades" });
  await f.voice.queue; assert.equal(f.transcripts[0].inputId, "input_a");
  f.voice.handleEvent({ type: "response.done", response: { output: [] } });
  f.voice.shareTextTurn("Compará ventas", { state: "INFORMACION", messages: [{ role: "assistant", content: "Resumen verificado" }] });
  assert.ok(f.events.some((event) => event.item?.role === "user" && event.item.content[0].text === "Compará ventas"));
  f.voice.setMuted(false); assert.equal(f.track.enabled, true); f.voice.interrupt();
  assert.ok(f.events.some((event) => event.type === "response.cancel")); f.voice.close(); assert.equal(f.track.stopped, 1);
  const next = browserVoice(); await next.voice.connect(); assert.equal(next.voice.closed, false); next.voice.close();
});

test("late completion of a cancelled voice response preserves the current response", async () => {
  const f = browserVoice(); await f.voice.connect();
  f.voice.handleEvent({ type: "response.created", response: { id: "old" } });
  f.voice.interrupt();
  f.voice.handleEvent({ type: "response.created", response: { id: "current" } });
  f.voice.handleEvent({ type: "response.done", response: { id: "old", status: "cancelled" } });
  assert.equal(f.voice.responseActive, true);
  assert.equal(f.voice.activeResponseId, "current");
  f.voice.handleEvent({ type: "response.done", response: { id: "current", output: [] } });
  assert.equal(f.voice.responseActive, false);
  f.voice.close();
});
