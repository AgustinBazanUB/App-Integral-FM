import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { endpointingWindow } from "../src/gestion/olivia/endpointing.mjs";
import { quickReadPlan, classifyGeminiLiveTurn } from "../src/shared/oliviaConversationRouter.mjs";
import { fastConversationRead } from "../netlify/functions/_lib/olivia/fastConversation.mjs";
import { advanceVoiceCollection, collectionDecision, safeConversationBridge } from "../src/shared/oliviaVoiceCollection.mjs";
import { GeminiLiveSession } from "../src/gestion/olivia/geminiLive.mjs";
import { DelegatedTaskClient } from "../src/gestion/olivia/delegatedTaskClient.mjs";
import { startDelegatedTask } from "../netlify/functions/_lib/olivia/delegatedTasks.mjs";
import { createOliviaEngine } from "../netlify/functions/_lib/olivia/engine.mjs";
import { fixture, start, functionResponse, textResponse } from "./helpers/olivia-fixture.mjs";

async function backend(provider) {
  const f = fixture({ role: "admin", provider });
  f.session.email = "agsreserva@gmail.com";
  f.config.hybridVoice.enabled = true;
  f.documents.set("oliviaConfiguration/global", f.config);
  f.engine = createOliviaEngine({
    store: f.store,
    clock: f.clock,
    provider,
    env: {
      OPENAI_API_KEY: "fixture",
      OLIVIA_DEPLOY_PREVIEW_CONTEXT: "deploy-preview",
      OLIVIA_HYBRID_LIVE_ENABLED: "true",
      GEMINI_API_KEY: "synthetic",
      GEMINI_API_BILLING_TIER: "paid",
      FIREBASE_PROJECT_ID: "app-integral-fm-pruebas",
    },
  });
  f.id = (await start(f)).conversationId;
  return f;
}

test("Problema 1: GeminiLiveSession y OliviaAssistant emiten y renderizan transcripciones en vivo del usuario y de Olivia", async (t) => {
  const partials = [];
  const transcripts = [];
  const live = new GeminiLiveSession({
    backgroundTools: true,
    audioContext: { currentTime: 0 },
    WebSocket: { OPEN: 1 },
    request: async () => ({ costUsd: 0, measurement: "provider-forwarded" }),
    onPartial: (text, meta) => partials.push({ text, meta }),
    onTranscript: (text, meta) => transcripts.push({ text, meta }),
  });
  Object.assign(live, { ready: true, textInputOnly: true, socket: { readyState: 1, send() {}, close() {} } });
  t.after(() => live.close());

  live.currentTurn.pending = true;
  live.currentTurn.turnId = "turn-live-1";
  live.currentTurn.turnIndex = 1;
  live.receive({ serverContent: { interimInputTranscription: { text: "Hola Oli" } } });
  assert.equal(partials.at(-1).text, "Hola Oli");
  assert.equal(partials.at(-1).meta.final, false);

  live.receive({ serverContent: { inputTranscription: { text: "Hola Olivia, ¿cómo estás?" } } });
  assert.equal(partials.at(-1).text, "Hola Olivia, ¿cómo estás?");
  assert.equal(partials.at(-1).meta.final, true);

  live.receive({ serverContent: { outputTranscription: { text: "¡Hola! Todo muy bien." } } });
  assert.equal(transcripts.at(-1).text, "¡Hola! Todo muy bien.");
  assert.equal(transcripts.at(-1).meta.turnId, "turn-live-1");

  const assistantSource = await readFile(new URL("../src/gestion/olivia/OliviaAssistant.jsx", import.meta.url), "utf8");
  assert.match(assistantSource, /liveUserTranscript/);
  assert.match(assistantSource, /liveAssistantTranscript/);
  assert.match(assistantSource, /fm-olivia-message--user is-streaming/);
  assert.match(assistantSource, /fm-olivia-message--assistant is-streaming/);
});

test("Problema 2: endpointingWindow cierra rápido preguntas cortas (550-700 ms) y mantiene 2000 ms para listas dictadas", () => {
  const shortRead = endpointingWindow({ partial: "¿Cuánto vendimos hoy?", stableMs: 200 });
  assert.ok(shortRead >= 550 && shortRead <= 700, `Expected 550-700ms, got ${shortRead}`);

  const shortQuestion = endpointingWindow({ partial: "¿Tenemos stock de Arbequina?", stableMs: 200 });
  assert.ok(shortQuestion >= 550 && shortQuestion <= 700, `Expected 550-700ms, got ${shortQuestion}`);

  const openList = endpointingWindow({ partial: "Cargame diez de Arbequina y", stableMs: 250 });
  assert.equal(openList, 2000);

  const enumeration = endpointingWindow({ partial: "Cargá 10 de Arbequina, 25 de Coratina y 5 de Clásico", stableMs: 250 });
  assert.equal(enumeration, 2000);
});

test("Problema 3: quickReadPlan y fastConversationRead resuelven ventas de hoy, inventario, alertas, envíos, promociones y navegación sin llamar a Luna", async () => {
  assert.equal(quickReadPlan("¿Cuánto vendimos hoy?")?.kind, "today-sales");
  assert.equal(quickReadPlan("Ventas de hoy")?.kind, "today-sales");
  assert.equal(quickReadPlan("Resumen de stock")?.kind, "inventory");
  assert.equal(quickReadPlan("Resumen rápido de inventario")?.kind, "inventory");
  assert.equal(quickReadPlan("¿Qué alertas tenemos?")?.kind, "alerts");
  assert.equal(quickReadPlan("¿Qué envíos están pendientes?")?.kind, "shipments");
  assert.equal(quickReadPlan("¿Qué promociones o descuentos hay?")?.kind, "promotions");
  assert.deepEqual(quickReadPlan("Llevame a envíos"), { kind: "navigate", module: "shipping", label: "envios" });
  assert.deepEqual(quickReadPlan("¿Tenemos Arbequina?"), { kind: "stock", query: "arbequina", locationQuery: null });
  assert.deepEqual(quickReadPlan("¿A cuánto está Arbequina?"), { kind: "price", query: "arbequina", locationQuery: null });
  assert.deepEqual(quickReadPlan("¿Cuánto stock hay de Arbequina acá?"), { kind: "stock", query: "arbequina", locationQuery: null });

  const checked = [];
  const run = async (name) => {
    if (name === "get_today_sales") return { data: { count: 3, total: 45000, observedAt: "2026-11-09T12:00:00.000Z" } };
    if (name === "get_inventory_summary") {
      return {
        data: {
          owner: { id: "local_a", name: "Local Centro", type: "location" },
          items: [
            { productId: "p1", productName: "Arbequina 500ml", currentStock: 12 },
            { productId: "p2", productName: "Coratina 500ml", currentStock: 2 },
          ],
        },
      };
    }
    if (name === "get_alerts") return { data: { records: [{ id: "a1", title: "Stock crítico en Coratina", active: true }] } };
    if (name === "get_shipments") return { data: { records: [{ id: "s1", name: "Envío Pedido #104", status: "pendiente" }] } };
    if (name === "get_promotions") return { data: { discounts: [{ discountId: "d1", name: "Promo 2x1 Efectivo", type: "percent", value: 15 }] } };
    if (name === "navigate_to_module") return { navigation: { path: "/gestion/shipping" }, data: { navigation: { path: "/gestion/shipping" } } };
    return { data: {} };
  };

  const salesAns = await fastConversationRead({ plan: quickReadPlan("¿Cuánto vendimos hoy?"), context: { locationId: "local_a" }, run, check: (n) => checked.push(n) });
  assert.match(salesAns.content, /3 ventas/);
  assert.ok(checked.includes("get_today_sales"));

  const invAns = await fastConversationRead({ plan: quickReadPlan("Resumen de inventario"), context: { locationId: "local_a" }, run, check: (n) => checked.push(n) });
  assert.match(invAns.content, /Local Centro: 2 productos activos \(14 unidades en total\)/);
  assert.match(invAns.content, /Coratina 500ml \(2\)/);

  const alertsAns = await fastConversationRead({ plan: quickReadPlan("¿Qué alertas tenemos?"), context: {}, run, check: (n) => checked.push(n) });
  assert.match(alertsAns.content, /1 alerta vigente: Stock crítico en Coratina/);

  const shipAns = await fastConversationRead({ plan: quickReadPlan("¿Qué envíos están pendientes?"), context: {}, run, check: (n) => checked.push(n) });
  assert.match(shipAns.content, /1 envío pendiente: Envío Pedido #104/);

  const promoAns = await fastConversationRead({ plan: quickReadPlan("¿Qué promociones o descuentos hay?"), context: { locationId: "local_a" }, run, check: (n) => checked.push(n) });
  assert.match(promoAns.content, /Promo 2x1 Efectivo \(15%\)/);

  const navAns = await fastConversationRead({ plan: quickReadPlan("Llevame a envíos"), context: {}, run, check: (n) => checked.push(n) });
  assert.equal(navAns.navigation?.path, "/gestion/shipping");
});

test("Problema 3.2: DelegatedTaskClient y startDelegatedTask resuelven lecturas rápidas en foreground sin cola ni polling de 1.5s", async () => {
  const f = await backend(async () => assert.fail("Fast read in voice should not call Luna"));
  let dispatched = 0;
  const client = new DelegatedTaskClient({
    conversationId: f.id,
    delay: async () => assert.fail("Foreground fast read should not poll"),
    request: async (payload) => {
      if (payload.operation === "delegatedTask") {
        assert.equal(payload.foreground, true);
        return startDelegatedTask({
          store: f.store,
          engine: f.engine,
          session: f.session,
          body: payload,
          dispatch: async () => { dispatched++; },
          now: f.clock(),
        });
      }
      throw new Error(`Unexpected operation ${payload.operation}`);
    },
  });

  const task = await client.run({ name: "delegate_to_olivia", args: { action: "new" } }, "¿Cuánto vendimos hoy?", {
    turnId: "t-fast-1",
    screenContext: { locationId: "local_a" },
  });
  assert.equal(task.status, "completed");
  assert.equal(dispatched, 0);
  assert.match(task.summary, /Hoy se registraron 1 venta/);
  client.close();
});

test("Problema 4: advanceVoiceCollection acepta ubicación sin 'en', cantidades mayores, producto antes de cantidad y válvula de escape hacia Luna", () => {
  let d = advanceVoiceCollection("Quiero cargar stock");
  assert.equal(d.pendingQuestion, "location");

  d = advanceVoiceCollection("Tribunales", d);
  assert.equal(d.requestedLocation, "Tribunales");
  assert.equal(d.pendingQuestion, "items-and-quantities");

  const ready = collectionDecision("diez de Original y veinticinco de Clásico", { voiceCollection: d });
  assert.equal(ready.route, "delegate");
  assert.equal(ready.collection.itemsMentioned.length, 2);
  assert.equal(ready.collection.itemsMentioned[1].quantityMentioned, "veinticinco");

  let d2 = advanceVoiceCollection("Quiero cargar stock en Local Centro");
  assert.equal(d2.requestedLocation, "Centro");
  const productFirst = collectionDecision("Original, 15 botellas", { voiceCollection: d2 });
  assert.equal(productFirst.route, "delegate");
  assert.equal(productFirst.collection.itemsMentioned[0].quantityMentioned, "15");
  assert.equal(productFirst.collection.itemsMentioned[0].description, "Original");

  let d3 = advanceVoiceCollection("Quiero cargar stock");
  d3 = advanceVoiceCollection("Tribunales", d3);
  const escaped = collectionDecision("Sumame lo mismo que mandamos la semana pasada del lote especial", { voiceCollection: d3 });
  assert.equal(escaped.route, "delegate");
  assert.equal(escaped.collection.fallbackToEngine, true);
  assert.match(escaped.request, /Tribunales/);
});

test("Problema 5: safeConversationBridge permite expresiones naturales argentinas y drainToolResults no bloquea resultados terminales", async (t) => {
  const loc = advanceVoiceCollection("Quiero cargar stock");
  assert.equal(safeConversationBridge("¿En qué sucursal o depósito?", { collection: loc }), true);
  const items = advanceVoiceCollection("Tribunales", loc);
  assert.equal(safeConversationBridge("¿Cuántas unidades y de qué producto?", { collection: items }), true);
  assert.equal(safeConversationBridge("Dale, ya me fijo."), true);
  assert.equal(safeConversationBridge("Bárbaro, ahí lo consulto."), true);
  assert.equal(safeConversationBridge("Ya cargué 10 botellas."), false);

  const sent = [];
  const live = new GeminiLiveSession({
    backgroundTools: true,
    audioContext: { currentTime: 0 },
    WebSocket: { OPEN: 1 },
    request: async () => ({ costUsd: 0, measurement: "provider-forwarded" }),
  });
  Object.assign(live, {
    ready: true,
    textInputOnly: true,
    holdNotificationsUntilInput: true,
    socket: { readyState: 1, send: (raw) => sent.push(JSON.parse(raw)), close() {} },
  });
  t.after(() => live.close());

  live.pendingTaskCalls.set("task-1", { taskId: "task-1", call: null, sourceTurnId: "turn-1" });
  live.notifyTaskUpdate({
    id: "task-1",
    status: "completed",
    summary: "Arbequina: 12 unidades.",
    notification: { key: "k1", eligible: true, delivered: false },
  });
  assert.equal(live.holdNotificationsUntilInput, false);
  assert.equal(sent.length, 1);
});

test("Problema 6: startDelegatedTask rota tareas terminales al superar 20 sin lanzar task-limit y OliviaAssistant permite voz con pendingAction", async () => {
  const f = await backend(async () => assert.fail("Should not call Luna for fast read"));
  for (let i = 1; i <= 25; i++) {
    f.advance(2000);
    const task = await startDelegatedTask({
      store: f.store,
      engine: f.engine,
      session: f.session,
      body: {
        conversationId: f.id,
        requestId: `req_rot_${i}`,
        message: "¿Cuánto vendimos hoy?",
        screenContext: { locationId: "local_a" },
        foreground: true,
      },
      dispatch: async () => {},
      now: f.clock(),
    });
    assert.equal(task.status, "completed");
  }
  const root = f.documents.get(`oliviaConversations/${f.id}`);
  assert.ok(root.delegatedTaskIds.length <= 20, `Expected <= 20 retained task IDs, got ${root.delegatedTaskIds.length}`);

  const assistantSource = await readFile(new URL("../src/gestion/olivia/OliviaAssistant.jsx", import.meta.url), "utf8");
  const startVoiceBlock = assistantSource.match(/const startVoice = \(\) => \{[\s\S]*?\n  \};/)[0];
  assert.equal(/snapshot\.pendingAction/.test(startVoiceBlock), false);
});

test("Problema 7: engine.chat encadena lectura previa (get_stock) y preparación (prepare_stock_load) en el mismo turno devolviendo pendingAction", async () => {
  let round = 0;
  const f = await backend(async (_path, body) => {
    round++;
    if (round === 1) {
      return functionResponse("get_stock", { locationId: "local_a", productId: "oil" });
    }
    if (round === 2) {
      const toolNames = (body.tools || []).map((t) => t.name);
      assert.ok(toolNames.includes("prepare_stock_load"), "prepare_stock_load must remain available in round 2");
      return functionResponse("prepare_stock_load", { locationId: null, productId: null, quantity: 10, reason: null });
    }
    return textResponse("Listo.");
  });

  const result = await f.engine.chat(f.session, {
    conversationId: f.id,
    requestId: "chain-read-prepare-1",
    message: "Revisá cuánto stock queda de Aceite en Local Centro y preparame una carga de 10 unidades",
    screenContext: { route: "/gestion/locations/local_a", module: "locations", locationId: "local_a" },
    foreground: true,
  });

  assert.equal(result.state, "ESPERANDO_CONFIRMACION");
  assert.ok(result.pendingAction, "Expected pendingAction card to be returned");
  assert.equal(result.pendingAction.toolName, "prepare_stock_load");
});
