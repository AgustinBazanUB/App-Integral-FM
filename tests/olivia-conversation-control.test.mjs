import test from "node:test";
import assert from "node:assert/strict";
import { fixture, start, textResponse, functionResponse } from "./helpers/olivia-fixture.mjs";
import { transitionConversationTask, manageConversationTask } from "../netlify/functions/_lib/olivia/conversationTasks.mjs";
import { updateTask } from "../netlify/functions/_lib/olivia/tasks.mjs";
import { startChatJob, cancelChatJob } from "../netlify/functions/_lib/olivia/chatJobs.mjs";
import { responseInstructions } from "../netlify/functions/_lib/olivia/provider.mjs";

const turn = (f, id, message, requestId) => { f.advance(2000); return f.engine.chat(f.session, { conversationId: id, message, requestId, screenContext: { module: "locations" } }); };
function stockFixture(provider = async () => textResponse("Te explico cómo hacerlo desde el panel.")) {
  const f = fixture({ role: "admin", provider });
  f.documents.set("products/oil", { name: "Original 500 ml", defaultPrice: 1500, active: true });
  f.documents.set("locations/local_a", { name: "Tribunales", active: true });
  return f;
}
test("the latest stock-to-customer correction invalidates the old proposal without writing stock", async () => {
  const f = stockFixture(), { conversationId: id } = await start(f);
  const stock = await turn(f, id, "Cargame 12 botellas de Original en Tribunales", "stock");
  assert.ok(stock.pendingAction);
  const next = await turn(f, id, "No, por favor no me cargues stock. Quería decir que me cargues un cliente", "client");
  const saved = f.documents.get(`oliviaConversations/${id}`);
  assert.equal(saved.taskState.intent, "prepare_customer_create");
  assert.match(next.messages.at(-1).content, /teléfono/);
  assert.equal(next.pendingAction, null);
  assert.equal(saved.suspendedTasks.length, 0);
  assert.equal(f.documents.get(`oliviaConfirmations/${stock.pendingAction.id}`).status, "superseded");
  assert.equal(f.documents.get("locationStock/local_a/items/oil").currentStock, 4);
  assert.equal(f.providerCalls(), 0);
});
test("side explanations preserve partial slots and explicit resume restores the same task", async () => {
  let context;
  const f = stockFixture(async (_path, body) => { context = JSON.parse(body.input[0].content); return textResponse("Podés cargar stock desde Ubicaciones."); });
  const { conversationId: id } = await start(f);
  await turn(f, id, "Cargame 12 botellas de Original", "stock");
  const original = structuredClone(f.documents.get(`oliviaConversations/${id}`).taskState);
  await turn(f, id, "Antes explicame cómo se carga el stock manualmente", "help");
  const explained = f.documents.get(`oliviaConversations/${id}`);
  assert.equal(explained.taskState, null);
  assert.equal(explained.suspendedTasks[0].slots.quantity, 12);
  assert.equal(explained.suspendedTasks[0].slots.productId, "oil");
  assert.equal(f.providerCalls(), 0);
  const resumed = await turn(f, id, "Retomemos la carga de stock", "resume");
  const saved = f.documents.get(`oliviaConversations/${id}`);
  assert.equal(saved.taskState.id, original.id);
  assert.equal(saved.taskState.slots.quantity, 12);
  assert.equal(saved.suspendedTasks.length, 0);
  assert.match(resumed.messages.at(-1).content, /ubicación/);
  assert.equal(f.providerCalls(), 0);
});
test("resume of a formerly prepared task creates a fresh proposal and rechecks live stock", async () => {
  const f = stockFixture(), { conversationId: id } = await start(f);
  const first = await turn(f, id, "Cargame 12 botellas de Original en Tribunales", "stock");
  await turn(f, id, "Cargame un cliente", "switch");
  const second = await turn(f, id, "Volvamos al stock", "resume");
  assert.ok(second.pendingAction);
  assert.notEqual(second.pendingAction.id, first.pendingAction.id);
  assert.equal(f.documents.get(`oliviaConfirmations/${first.pendingAction.id}`).status, "superseded");
  assert.match(second.pendingAction.summary, /4 → 16/);
});
test("polite cancellation, empty starts and cancellation do not need a model round", async () => {
  const f = stockFixture(), { conversationId: id } = await start(f);
  assert.match((await turn(f, id, "Olivia, ¿podés cargarme stock?", "a")).messages.at(-1).content, /producto/);
  const stopped = await turn(f, id, "Por favor no me cargues stock", "b");
  assert.equal(stopped.state, "CANCELADA");
  assert.equal(f.documents.get(`oliviaConversations/${id}`).taskState.status, "cancelled");
  assert.equal(f.providerCalls(), 0);
});
test("natural half-litre wording resolves the real product without guessing a variety", async () => {
  const f = stockFixture(), { conversationId: id } = await start(f);
  f.documents.set("products/oil", { name: "Aceite de Oliva Arbosana500cc", defaultPrice: 1500, active: true });
  await turn(f, id, "Cargame stock", "start");
  await turn(f, id, "La botella del aceite de oliva de medio litro de arbosana", "product");
  const task = f.documents.get(`oliviaConversations/${id}`).taskState;
  assert.equal(task.slots.productId, "oil");
  assert.equal(f.providerCalls(), 0);
  const stopped = await turn(f, id, "Ya no quiero cargar stock", "stop");
  assert.equal(stopped.state, "CANCELADA");
});
test("paused memory is bounded, contains validated slots and never saves confirmation tokens", () => {
  let current = { task: null, suspendedTasks: [] };
  for (let index = 0; index < 8; index++) {
    current.task = { ...updateTask(null, "prepare_stock_load", JSON.stringify({ quantity: index + 1 })), confirmationToken: "not-memory" };
    current = manageConversationTask(current, "pause");
  }
  assert.equal(current.suspendedTasks.length, 5);
  assert.ok(!JSON.stringify(current.suspendedTasks).includes("not-memory"));
  assert.equal(manageConversationTask(current, "resume").task.slots.quantity, 8);
  const cancelled = transitionConversationTask({ taskState: updateTask(null, "prepare_stock_load", "{}") }, "No me cargues stock");
  assert.equal(cancelled.task.status, "cancelled");
});
test("one validated task update asks the next question without another provider round", async () => {
  const f = stockFixture(async () => functionResponse("update_task", { intent: "prepare_customer_create", slotsJson: '{"name":"Cliente ficticio"}' }));
  const { conversationId: id } = await start(f);
  const response = await turn(f, id, "Registrá al cliente ficticio Juan", "a");
  assert.match(response.messages.at(-1).content, /teléfono/);
  assert.equal(f.providerCalls(), 1);
  assert.equal(response.telemetry.questionRoundAvoided, true);
  assert.equal(response.telemetry.retrieval, "curated-task-continuation");
});
test("a checkpoint survives interruption and a late provider cannot overwrite the newer task", async () => {
  let calls = 0, release, signalReady;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { signalReady = resolve; });
  const f = stockFixture(async () => {
    if (++calls === 1) return functionResponse("update_task", { intent: "prepare_customer_create", slotsJson: '{"name":"Cliente ficticio","phone":"1155550000"}' });
    signalReady(); await gate; return textResponse("Respuesta anterior que llegó tarde");
  });
  const { conversationId: id } = await start(f);
  const old = turn(f, id, "Registrá al cliente ficticio con nombre y teléfono", "old");
  const outcome = old.then(value => ({ value }), error => ({ error }));
  await ready;
  assert.equal(f.documents.get(`oliviaConversations/${id}`).taskState.slots.phone, "1155550000");
  await turn(f, id, "No, quería decir cargame stock", "new");
  release();
  assert.equal((await outcome).error.code, "request-expired");
  const saved = f.documents.get(`oliviaConversations/${id}`);
  assert.equal(saved.taskState.intent, "prepare_stock_load");
  assert.ok(!saved.messages.some(entry => entry.content.includes("llegó tarde")));
});
test("interrupting a running response preserves slots but revokes a pending confirmation", async () => {
  const f = stockFixture(), { conversationId: id } = await start(f);
  const job = await startChatJob({ store: f.store, engine: f.engine, session: f.session, body: { conversationId: id, requestId: "running", message: "Consulta lenta" }, dispatch: async () => {}, now: f.clock() });
  const state = f.documents.get(`oliviaConversations/${id}`);
  state.taskState = updateTask(null, "prepare_stock_load", '{"quantity":12}');
  state.pendingActionId = "old-confirmation";
  f.documents.set("oliviaConfirmations/old-confirmation", { status: "pending" });
  await cancelChatJob({ store: f.store, session: f.session, body: { jobId: job.jobId, preserveTask: true }, now: f.clock() });
  const saved = f.documents.get(`oliviaConversations/${id}`);
  assert.equal(saved.taskState.slots.quantity, 12);
  assert.equal(saved.taskState.status, "collecting");
  assert.equal(saved.pendingActionId, null);
  assert.equal(f.documents.get("oliviaConfirmations/old-confirmation").status, "superseded");
});
test("routine customer replies omit unrelated batch/catalog/analytics instructions", () => {
  const routine = responseInstructions({ query: "Cliente Juan", task: { intent: "prepare_customer_create" } });
  const analytical = responseInstructions({ query: "Estimá demanda de Arbosana y proponé una estrategia" });
  assert.doesNotMatch(routine, /TODA la lista|Sensibilidad de planificación|Actuá como analista comercial/);
  assert.match(analytical, /forecast_product_demand/);
});
