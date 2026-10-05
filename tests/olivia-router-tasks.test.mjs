import test from "node:test";
import assert from "node:assert/strict";
import { routeModel, aggregateRoutes } from "../netlify/functions/_lib/olivia/modelRouter.mjs";
import { updateTask, requiredFields } from "../netlify/functions/_lib/olivia/tasks.mjs";
import { defaultOliviaConfiguration, validateConfiguration } from "../src/shared/oliviaContracts.mjs";
import { fixture, start, textResponse, functionResponse } from "./helpers/olivia-fixture.mjs";
import { runTool } from "../netlify/functions/_lib/olivia/tools.mjs";

const config = defaultOliviaConfiguration();
const session = { profile: { role: "admin", active: true } };
for (const [message, module, route, effort] of [
  ["¿Cuánto stock hay?", "locations", "luna-normal", "high"],
  ["¿Cómo nos fue este fin de semana?", "metrics", "luna-normal", "high"],
  ["Pronóstico de Pilar sábado y domingo", "locations", "luna-complex", "xhigh"],
  ["Compará rentabilidad de los últimos tres meses", "finance", "luna-complex", "xhigh"],
  ["Diseñame un concepto para Instagram de almendras Guara", "social", "sol-creative", "high"],
  ["Creá una campaña creativa", "marketing", "sol-creative", "high"],
  ["Mostrame las métricas de Instagram", "social", "luna-normal", "high"],
  ["Revisá el inbox", "social", "luna-normal", "high"],
  ["Creá el registro de la campaña Mayo", "marketing", "luna-normal", "high"],
  ["Diseñame un flujo de autorización de stock", "marketing", "luna-normal", "high"],
  ["Diseñame un concepto", "warehouse", "luna-normal", "high"],
]) test(`ruta: ${message}`, () => {
  const result = routeModel(config, session, { message, context: { module } });
  assert.equal(result.route, route); assert.equal(result.reasoningEffort, effort);
  assert.equal(result.model, route === "sol-creative" ? "gpt-6.1-sol" : "gpt-6-luna");
});
test("volumen, herramientas y módulos elevan Luna sin cambiar de modelo", () => {
  for (const signals of [{ toolCount: 6 }, { entityCount: 5 }, { dataRows: 500 }, { moduleCount: 2 }]) {
    const result = routeModel(config, session, { message: "Revisalo", signals });
    assert.equal(result.route, "luna-complex"); assert.equal(result.model, "gpt-6-luna");
  }
  assert.equal(routeModel(config, session, { attachments: [{}, {}] }).reasoningEffort, "xhigh");
});
test("la longitud sola no escala y los vendedores no usan Sol", () => {
  assert.equal(routeModel(config, session, { message: "stock ".repeat(400) }).route, "luna-normal");
  assert.equal(routeModel(config, { profile: { role: "seller", active: true } }, { message: "Diseñame una campaña", context: { module: "marketing" } }).model, "gpt-6-luna");
});
test("una aclaración conserva XHIGH; una tarea nueva vuelve a HIGH", () => {
  const task = { status: "collecting", route: { route: "luna-complex" } };
  assert.equal(routeModel(config, session, { message: "Pilar", task }).route, "luna-complex");
  assert.equal(routeModel(config, session, { message: "Mostrame stock", task }).route, "luna-normal");
  assert.equal(routeModel(config, session, { message: "Pilar", task: { ...task, status: "completed" } }).route, "luna-normal");
});
test("migración de política antigua y rechazo de Sol administrativo", () => {
  const old = structuredClone(config); delete old.modelPolicyVersion;
  old.profiles.adminComplex.model = "gpt-6-sol";
  assert.equal(validateConfiguration(old).profiles.adminComplex.model, "gpt-6-luna");
  const invalid = structuredClone(config); invalid.profiles.adminComplex.model = "gpt-6.1-sol";
  assert.throws(() => validateConfiguration(invalid), { code: "invalid-configuration" });
});
test("slots validados: corrigen la misma tarea, conservan datos y no admiten autoridad", () => {
  const first = updateTask(null, "forecast_fair", JSON.stringify({ locationId: "pilar", startDate: null, days: 2 }));
  const next = updateTask(first, "forecast_fair", JSON.stringify({ days: 1 }));
  assert.equal(next.id, first.id); assert.equal(next.slots.locationId, "pilar"); assert.equal(next.revision, 2);
  assert.deepEqual(next.missingFields, ["startDate"]);
  assert.throws(() => updateTask(first, "forecast_fair", '{"permissions":{"admin":true}}'));
  assert.throws(() => updateTask(first, "forecast_fair", '{"days":-1}'));
  assert.notEqual(updateTask(first, "prepare_stock_load", '{"quantity":12}').id, first.id);
  assert.deepEqual(requiredFields("prepare_stock_load"), ["locationId", "productId", "quantity"]);
});
function stockFixture(extra = {}) {
  const f = fixture({ role: "admin", provider: async () => textResponse("Respuesta verificada"), ...extra });
  f.documents.set("products/oil", { name: "Original 500 ml", defaultPrice: 1500, active: true });
  f.documents.set("locations/local_a", { name: "Tribunales", active: true });
  f.documents.set("locations/local_b", { name: "Pilar", active: true });
  f.documents.set("locationStock/local_b/items/oil", { productId: "oil", productName: "Original 500 ml", currentStock: 3, active: true });
  return f;
}
async function turn(f, id, message, requestId, extra = {}) { f.advance(2000); return f.engine.chat(f.session, { conversationId: id, message, requestId, screenContext: { module: "locations" }, ...extra }); }
test("voz: Luna inicia la carga con dos datos, luego conserva producto/destino y pide solo cantidad", async () => {
  const f = stockFixture({ provider: async (path, body, options, calls) => calls === 1 ? functionResponse("update_task", { intent: "prepare_stock_load", slotsJson: JSON.stringify({ productId: null, locationId: null, quantity: null }) }) : textResponse("Para completar esta tarea necesitamos revisar todos los datos necesarios para el proceso.") });
  const { conversationId: id } = await start(f);
  f.documents.set("oliviaRealtime/voice_a", { userId: f.session.uid, sessionBinding: String(f.session.authTime), conversationId: id, status: "active", expiresAt: new Date(f.clock().getTime() + 180000) });
  const voice = { inputMode: "realtime", realtimeSessionId: "voice_a" };
  const first = await turn(f, id, "Quiero cargar un producto", "a", voice);
  assert.equal(first.messages.at(-1).content, "Ok. ¿Qué producto y en dónde querés cargarlo?");
  assert.equal(f.providerRequests[0].model, "gpt-6-luna");
  const second = await turn(f, id, "Original en Tribunales", "b", voice);
  assert.equal(second.messages.at(-1).content, "¿Cuántas unidades querés cargar?");
  const calls = f.providerCalls();
  const third = await turn(f, id, "3", "c", voice);
  assert.ok(third.pendingAction); assert.match(third.pendingAction.summary, /Stock: 4 → 7/);
  assert.equal(f.providerCalls(), calls);
  assert.equal(f.documents.get("locationStock/local_a/items/oil").currentStock, 4);
  await turn(f, id, "Cancelá", "d", voice);
});
test("carga progresiva real: producto → destino → tarjeta, con motivo opcional y sin llamadas de modelo", async () => {
  const f = stockFixture(), { conversationId: id } = await start(f);
  const first = await turn(f, id, "Cargame 12 botellas de Original", "a");
  assert.match(first.messages.at(-1).content, /ubicación/);
  const taskId = f.documents.get(`oliviaConversations/${id}`).taskState.id;
  const second = await turn(f, id, "Tribunales", "b");
  assert.match(second.pendingAction.summary, /12.*Original.*Tribunales/);
  assert.doesNotMatch(second.pendingAction.summary, /Motivo:/);
  assert.deepEqual(f.documents.get(`oliviaConversations/${id}`).taskState.missingFields, []);
  const third = await turn(f, id, "Reposición", "c");
  assert.match(third.pendingAction.summary, /12.*Original.*Tribunales/);
  assert.match(third.pendingAction.summary, /Motivo: Reposición/);
  assert.equal(f.documents.get(`oliviaConfirmations/${second.pendingAction.id}`).status, "superseded");
  assert.equal(f.providerCalls(), 0);
  assert.equal(f.documents.get(`oliviaConversations/${id}`).taskState.id, taskId);
  assert.equal(f.documents.get("locationStock/local_a/items/oil").currentStock, 4);
});
test("carga completa sin motivo llega a la tarjeta y solo la confirmación visual modifica el stock", async () => {
  const f = stockFixture(), { conversationId: id } = await start(f);
  const proposal = await turn(f, id, "Cargame 12 botellas de Original en Pilar", "a");
  assert.match(proposal.pendingAction.summary, /Stock: 3 → 15/);
  assert.doesNotMatch(proposal.pendingAction.summary, /Motivo:/);
  assert.equal(f.documents.get("locationStock/local_b/items/oil").currentStock, 3);
  const yes = await turn(f, id, "sí", "b");
  assert.equal(yes.pendingAction.id, proposal.pendingAction.id);
  assert.equal(f.documents.get("locationStock/local_b/items/oil").currentStock, 3);
  await f.engine.confirm(f.session, { conversationId: id, confirmationToken: proposal.pendingAction.confirmationToken, requestId: "confirm-without-reason" });
  assert.equal(f.documents.get("locationStock/local_b/items/oil").currentStock, 15);
  const movement = [...f.documents].find(([path]) => path.startsWith("stockMovements/"))[1];
  assert.equal(movement.reason, "Ingreso de mercadería");
  assert.equal(f.providerCalls(), 0);
});

test("corrección de cantidad y destino invalida la tarjeta anterior; sí escrito no ejecuta", async () => {
  const f = stockFixture(), { conversationId: id } = await start(f);
  await turn(f, id, "Cargame 12 botellas de Original", "a");
  await turn(f, id, "Tribunales", "b");
  const first = await turn(f, id, "Reposición", "c");
  const corrected = await turn(f, id, "Mejor 20", "d");
  assert.match(corrected.pendingAction.summary, /20/);
  assert.equal(f.documents.get(`oliviaConfirmations/${first.pendingAction.id}`).status, "superseded");
  const moved = await turn(f, id, "Mejor Pilar", "e");
  assert.match(moved.pendingAction.summary, /Pilar/);
  const yes = await turn(f, id, "sí", "f");
  assert.equal(yes.pendingAction.id, moved.pendingAction.id);
  assert.equal(f.documents.get("locationStock/local_a/items/oil").currentStock, 4);
  const cancelled = await turn(f, id, "Cancelá", "g");
  assert.equal(cancelled.pendingAction, null);
  assert.equal(f.documents.get(`oliviaConversations/${id}`).taskState.status, "cancelled");
});
test("productos ambiguos requieren presentación y no repiten cantidad", async () => {
  const f = stockFixture(), { conversationId: id } = await start(f);
  f.documents.set("products/oil2", { name: "Original 2 L", defaultPrice: 1000, active: true });
  const first = await turn(f, id, "Cargame 12 botellas de Original", "a");
  assert.match(first.messages.at(-1).content, /500 ml.*2 L/);
  await turn(f, id, "500 ml", "b");
  const task = f.documents.get(`oliviaConversations/${id}`).taskState;
  assert.equal(task.slots.productId, "oil"); assert.equal(task.slots.quantity, 12);
});
test("un producto inexistente no enumera opciones ajenas y permite corregir el nombre", async () => {
  const f = stockFixture(), { conversationId: id } = await start(f);
  const first = await turn(f, id, "Cargame 12 botellas de Producto Inexistente", "a");
  assert.match(first.messages.at(-1).content, /No pude identificar el producto/);
  assert.ok(!first.messages.at(-1).content.includes("Original"));
  const initial = f.documents.get(`oliviaConversations/${id}`).taskState;
  assert.deepEqual(initial.ambiguities.productId, []);
  await turn(f, id, "Original", "b");
  const corrected = f.documents.get(`oliviaConversations/${id}`).taskState;
  assert.equal(corrected.id, initial.id);
  assert.equal(corrected.slots.productId, "oil");
  assert.equal(corrected.slots.quantity, 12);
  assert.equal(f.providerCalls(), 0);
});

test("ubicaciones: alias único se resuelve, coincidencias se aclaran y nombres ajenos no se inventan", async () => {
  const f = stockFixture(), { conversationId: id } = await start(f);
  f.documents.set("locations/local_c", { name: "Local Lavalle", active: true });
  await turn(f, id, "Cargame 12 botellas de Original", "a");
  const unknown = await turn(f, id, "Inexistente", "b");
  assert.match(unknown.messages.at(-1).content, /No encontré una ubicación disponible/);
  assert.equal(f.documents.get(`oliviaConversations/${id}`).taskState.slots.locationId, null);
  await turn(f, id, "Lavalle", "c");
  assert.equal(f.documents.get(`oliviaConversations/${id}`).taskState.slots.locationId, "local_c");
  f.documents.set("locations/local_d", { name: "Local Lavalle Norte", active: true });
  const ambiguous = await turn(f, id, "Mejor Lavalle", "d");
  assert.match(ambiguous.messages.at(-1).content, /Local Lavalle o Local Lavalle Norte/);
  assert.equal(f.documents.get(`oliviaConversations/${id}`).taskState.slots.locationId, null);
  await turn(f, id, "Local Lavalle", "e");
  assert.equal(f.documents.get(`oliviaConversations/${id}`).taskState.slots.locationId, "local_c");
  assert.equal(f.providerCalls(), 0);
});

test("voz y texto continúan exactamente la misma tarea y permisos", async () => {
  const f = stockFixture(), { conversationId: id } = await start(f);
  await turn(f, id, "Cargame 12 botellas de Original", "a");
  f.documents.set("oliviaRealtime/live_a", { userId: f.session.uid, sessionBinding: String(f.session.authTime), conversationId: id, protocol: "live", status: "active", expiresAt: new Date(f.clock().getTime() + 60000) });
  await turn(f, id, "Tribunales", "b", { inputMode: "realtime", realtimeSessionId: "live_a" });
  const result = await turn(f, id, "Reposición", "c");
  assert.ok(result.pendingAction);
  await assert.rejects(turn(f, id, "Pilar", "d", { inputMode: "realtime", realtimeSessionId: "unknown" }), { code: "realtime-expired" });
});
test("una intención nueva descarta slots y vuelve a la ruta simple", async () => {
  for (const query of ["¿Cómo nos fue este fin de semana?", "Cómo nos fue este fin de semana", "Compará resultados del finde"]) {
    const f = stockFixture(), { conversationId: id } = await start(f);
    await turn(f, id, "Cargame 12 botellas de Original", "a");
    await turn(f, id, "Pilar", "location");
    const previous = f.documents.get(`oliviaConversations/${id}`).taskState;
    const result = await turn(f, id, query, "b");
    assert.equal(result.telemetry.route, query.startsWith("Compará") ? "luna-complex" : "luna-normal");
    const task = f.documents.get(`oliviaConversations/${id}`).taskState;
    assert.notEqual(task.id, previous.id); assert.deepEqual(task.slots, {});
    assert.equal(result.pendingAction, null);
  }
});
test("Luna conserva los slots de un pronóstico y registra cada llamada", async () => {
  let calls = 0;
  const f = stockFixture({ provider: async () => ++calls === 1 ? functionResponse("update_task", { intent: "forecast_fair", slotsJson: '{"locationId":null,"startDate":"2026-10-10","days":2}' }) : textResponse("¿En qué feria?") });
  const { conversationId: id } = await start(f);
  const result = await turn(f, id, "Pronóstico para sábado y domingo", "a");
  const task = f.documents.get(`oliviaConversations/${id}`).taskState;
  assert.equal(task.intent, "forecast_fair"); assert.deepEqual(task.missingFields, ["locationId"]);
  const usage = [...f.documents].find(([path]) => path.startsWith("oliviaUsage/"))[1];
  assert.equal(usage.modelCalls.length, 2); assert.equal(usage.taskId, task.id);
  assert.equal(result.telemetry.reasoningEffort, "xhigh");
});
for (const slotsJson of ['{"period":"este fin de semana"}', '{malformed']) test(`Luna corrige slots inválidos sin guardarlos: ${slotsJson}`, async () => {
  let calls = 0;
  const valid = { startDate: "2026-10-03", endDate: "2026-10-04" };
  const f = stockFixture({ provider: async (_path, body) => {
    calls++;
    if (calls === 1) return functionResponse("update_task", { intent: "get_sales_metrics", slotsJson });
    if (calls === 2) {
      const feedback = JSON.parse(body.input.filter((item) => item.type === "function_call_output").at(-1).output);
      assert.equal(feedback.retryable, true);
      assert.ok(feedback.slotsSchema.startDate);
      assert.ok(!Object.hasOwn(feedback.slotsSchema, "period"));
      assert.deepEqual([...f.documents].find(([key]) => key.startsWith("oliviaConversations/"))[1].taskState.slots, {});
      return functionResponse("update_task", { intent: "get_sales_metrics", slotsJson: JSON.stringify(valid) });
    }
    return textResponse("Período corregido; falta consultar las ventas.");
  } });
  const { conversationId: id } = await start(f);
  const result = await turn(f, id, "Cómo nos fue este fin de semana", "a");
  assert.equal(calls, 3);
  assert.notEqual(result.state, "ERROR");
  assert.deepEqual(f.documents.get(`oliviaConversations/${id}`).taskState.slots, valid);
});
test("slots que no se corrigen agotan el presupuesto y no simulan una tarea válida", async () => {
  const f = stockFixture({ provider: async (_path, body) => body.tools.length ? functionResponse("update_task", { intent: "get_sales_metrics", slotsJson: '{"permissions":true}' }) : textResponse("Todo correcto") });
  const { conversationId: id } = await start(f);
  const result = await turn(f, id, "Cómo nos fue este fin de semana", "a");
  assert.equal(result.state, "ERROR");
  assert.match(result.messages.at(-1).content, /No pude completar/);
  assert.deepEqual(f.documents.get(`oliviaConversations/${id}`).taskState.slots, {});
  assert.equal(f.documents.get(`oliviaConversations/${id}`).taskState.status, "failed");
  assert.ok(f.providerCalls() <= config.responseLimits.maxRounds);
});
test("rechazo de tarea creativa no se convierte en reintento de validación", async () => {
  const f = stockFixture({ provider: async () => functionResponse("update_task", { intent: "creative_brief", slotsJson: '{"objective":"campaña"}' }) });
  const { conversationId: id } = await start(f);
  const result = await turn(f, id, "Cómo nos fue este fin de semana", "a");
  assert.equal(result.state, "RECHAZADA");
  assert.equal(f.providerCalls(), 1);
  assert.deepEqual(f.documents.get(`oliviaConversations/${id}`).taskState.slots, {});
});
test("agregación calcula porcentajes de llamadas y conserva costos desconocidos", () => {
  const rows = aggregateRoutes([{ modelCalls: [{ route: "luna-normal", totalTokens: 10, actualCostUsd: 1 }, { route: "luna-complex", totalTokens: 20, actualCostUsd: null }] }]);
  assert.equal(rows[0].percentage, 50); assert.equal(rows[1].unknownCosts, 1);
});
test("orígenes vivos: uno suficiente se recomienda; dos requieren elección y se excluye destino", async () => {
  const f = stockFixture();
  f.documents.set("warehouses/a", { name: "Depósito A", active: true });
  f.documents.set("warehouses/b", { name: "Depósito B", active: true });
  f.documents.set("warehouseStock/a/items/oil", { currentStock: 30, active: true });
  f.documents.set("warehouseStock/b/items/oil", { currentStock: 10, active: true });
  const args = { productId: "oil", quantity: 20, destinationType: "location", destinationId: "local_b" };
  const run = () => runTool({ session: f.session, name: "resolve_transfer_origin", args, store: f.store, context: {}, now: f.clock() });
  assert.equal((await run()).data.recommendedOrigin.name, "Depósito A");
  f.documents.set("warehouseStock/b/items/oil", { currentStock: 25, active: true });
  const result = await run();
  assert.equal(result.data.recommendedOrigin, null); assert.equal(result.data.requiresChoice, true);
  assert.equal(result.data.candidates.length, 2);
});
test("transferencia incompleta pide solamente recepción física; conserva origen, destino y cantidad", async () => {
  const f = stockFixture({ provider: async () => functionResponse("prepare_stock_transfer", { originType: "warehouse", originId: "a", destinationType: "location", destinationId: "local_b", reason: "Reposición", carrierName: "Ana", lines: [{ productId: "oil", quantity: 20, preparedQuantity: 20, receivedQuantity: null }] }) });
  const { conversationId } = await start(f);
  const result = await turn(f, conversationId, "Mandame 20 Original a Pilar", "a");
  assert.equal(result.state, "DATOS_INCOMPLETOS");
  assert.match(result.messages.at(-1).content, /llegaron físicamente/);
  assert.ok(!result.messages.at(-1).content.includes("originId"));
  const task = f.documents.get(`oliviaConversations/${conversationId}`).taskState;
  assert.equal(task.slots.lines[0].quantity, 20); assert.equal(task.slots.originId, "a");
});
test("un fallo de proveedor nunca reintenta con Sol", async () => {
  const f = stockFixture({ provider: async () => { throw Object.assign(new Error("timeout"), { code: "provider-timeout" }); } });
  const { conversationId } = await start(f);
  await assert.rejects(turn(f, conversationId, "Compará resultados históricos", "a"), { code: "provider-timeout" });
  assert.ok(f.providerRequests.every((request) => request.model === "gpt-6-luna"));
  const event = [...f.documents].find(([path]) => path.startsWith("oliviaUsage/"))[1];
  assert.equal(event.modelCalls[0].actualCostUsd, null);
});
test("el cliente no selecciona taskId, modelo, esfuerzo, permisos ni estado", async () => {
  const f = stockFixture(), { conversationId } = await start(f);
  const result = await turn(f, conversationId, "¿Cuánto stock tengo?", "a", { taskState: { id: "forged", slots: { quantity: 900 }, status: "completed" }, model: "gpt-6.1-sol", reasoningEffort: "xhigh", permissions: { admin: true } });
  assert.equal(result.telemetry.model, "gpt-6-luna"); assert.equal(result.telemetry.reasoningEffort, "high");
  const task = f.documents.get(`oliviaConversations/${conversationId}`).taskState;
  assert.notEqual(task.id, "forged"); assert.deepEqual(task.slots, {});
});
