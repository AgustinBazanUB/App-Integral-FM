import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { reserveSession, reportTurn, releaseSession } from "../netlify/functions/olivia-gemini-live.mjs";
import { geminiLiveProviderCost } from "../src/shared/oliviaGeminiLive.mjs";
import { GeminiLiveSession } from "../src/gestion/olivia/geminiLive.mjs";
import { NaturalVoiceConversation } from "../src/gestion/olivia/naturalVoice.mjs";
import { classifyGeminiLiveTurn, quickReadPlan } from "../src/shared/oliviaConversationRouter.mjs";
import { fastConversationRead } from "../netlify/functions/_lib/olivia/fastConversation.mjs";
import { startDelegatedTask, pumpDelegatedTasks } from "../netlify/functions/_lib/olivia/delegatedTasks.mjs";
import { createOliviaEngine } from "../netlify/functions/_lib/olivia/engine.mjs";
import { fixture, start } from "./helpers/olivia-fixture.mjs";

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

test("V8 H-01: reserveSession reemplaza sesión propia activa y reportTurn permite múltiples turnos y turnos sin usageMetadata sin cortar la voz", async () => {
  const f = await backend(async () => assert.fail("Should not call Luna"));
  const now = f.clock();
  const config = f.config.hybridVoice;
  const session = { ...f.session, conversationId: f.id };

  const first = await reserveSession({ store: f.store, session, config, now });
  assert.ok(first.id);

  // Same user + same conversation replaces stale active session without 409
  const replaced = await reserveSession({ store: f.store, session, config, now });
  assert.notEqual(replaced.id, first.id);
  assert.equal(f.documents.get(`oliviaGeminiLiveSessions/${first.id}`).status, "replaced");

  // Different user is still blocked with 409 gemini-live-session-active
  await assert.rejects(
    reserveSession({ store: f.store, session: { ...session, uid: "other_admin" }, config, now }),
    { code: "gemini-live-session-active" },
  );

  // Tool-call turn with input tokens only computes confirmed input cost
  const partialCost = geminiLiveProviderCost({
    promptTokensDetails: [{ modality: "AUDIO", tokenCount: 1000 }],
  });
  assert.equal(partialCost.measurement, "provider-forwarded");
  assert.equal(partialCost.costUsd, 0.003);

  // Empty/abandoned turn (costUsd == null) does NOT trigger shouldStop
  const emptyReport = await reportTurn({
    store: f.store,
    session,
    config,
    now,
    body: { sessionId: replaced.id, turnId: "turn_empty", usageMetadata: null, inputAudioSeconds: 0, outputAudioSeconds: 0 },
  });
  assert.equal(emptyReport.shouldStop, false);
  assert.equal(emptyReport.unconfirmedQueryCount, 1);

  // 6 consecutive turns exceeding $0.015 initial reservation do NOT cut off the session
  for (let i = 1; i <= 6; i++) {
    const rep = await reportTurn({
      store: f.store,
      session,
      config,
      now,
      body: {
        sessionId: replaced.id,
        turnId: `turn_${i}`,
        usageMetadata: {
          promptTokensDetails: [{ modality: "AUDIO", tokenCount: 1000 }],
          responseTokensDetails: [{ modality: "AUDIO", tokenCount: 500 }],
        },
      },
    });
    assert.equal(rep.shouldStop, false, `Turn ${i} should not stop session at sessionSpendUsd=${rep.sessionSpendUsd}`);
  }

  await releaseSession({ store: f.store, id: replaced.id, now });
  const period = now.toISOString().slice(0, 7);
  assert.equal(f.documents.get(`oliviaGeminiLiveBudgets/${period}`).reservedUsd, 0);
});

test("V8 H-02: toolCall sin serverContent.turnComplete libera el turno y drena el resultado verificado sin bloquearse en processing", async (t) => {
  const sent = [];
  const states = [];
  let resolveTool;
  const live = new GeminiLiveSession({
    backgroundTools: true,
    audioContext: { currentTime: 0 },
    WebSocket: { OPEN: 1 },
    request: async () => ({ costUsd: 0.001, measurement: "provider-forwarded", shouldStop: false }),
    onState: (s) => states.push(s),
    onToolCall: async (_call, text, context) => {
      context.onAccepted({ id: "task_fast_1", status: "running", jobId: "fg_1" });
      return new Promise((r) => { resolveTool = r; });
    },
  });
  Object.assign(live, {
    ready: true,
    textInputOnly: true,
    socket: { readyState: 1, send: (raw) => sent.push(JSON.parse(raw)), close() {} },
  });
  t.after(() => live.close());

  live.sendText("¿Cuánto vendimos hoy?");
  // Standalone toolCall event WITHOUT serverContent.turnComplete
  live.receive({
    toolCall: { functionCalls: [{ id: "call_no_tc", name: "delegate_to_olivia", args: { action: "new", request: "¿Cuánto vendimos hoy?" } }] },
  });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(live.currentTurn.pending, false, "Input turn must finish even when Gemini omits turnComplete on toolCall");

  resolveTool({ id: "task_fast_1", requestId: "req_1", status: "completed", summary: "Hoy se registraron 2 ventas por $ 25.000,00." });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 10));

  const finalResponses = sent.filter((m) => m.toolResponse?.functionResponses?.[0]?.scheduling === "WHEN_IDLE");
  assert.equal(finalResponses.length, 1, "Verified tool result must drain immediately without deadlocking");
});

test("V8 H-03 & H-04: protección de pausa en listas dictadas (pausePreRoll), estado tras interrupted, noiseFloor adaptativo y AudioWorklet", async (t) => {
  const sent = [];
  const states = [];
  let workletAdded = false;
  const context = {
    sampleRate: 16000,
    currentTime: 0,
    destination: {},
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    createScriptProcessor: () => ({ connect() {}, disconnect() {}, onaudioprocess: null }),
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    audioWorklet: {
      addModule: async () => { workletAdded = true; },
    },
    AudioWorkletNode: class {
      constructor() { this.port = { onmessage: null }; }
      connect() {}
      disconnect() {}
    },
  };
  const live = new GeminiLiveSession({
    audioContext: context,
    WebSocket: { OPEN: 1 },
    request: async () => ({ shouldStop: false }),
    onState: (s) => states.push(s),
  });
  Object.assign(live, {
    ready: true,
    socket: { readyState: 1, send: (raw) => sent.push(JSON.parse(raw)), close() {} },
  });
  t.after(() => live.close());

  live.attachCapture({});
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(workletAdded, true, "AudioWorklet module is loaded when supported by AudioContext");

  live.beginTurn("list_turn");
  // Speech frame
  live.processCaptureChunk(new Float32Array(1600).fill(0.1), 16000);
  const sentAfterSpeech = sent.filter((m) => m.realtimeInput?.audio).length;
  assert.equal(sentAfterSpeech, 1);

  // 10 silent frames of 1600 samples each (1000 ms total silence while listening=true)
  for (let i = 0; i < 10; i++) {
    live.processCaptureChunk(new Float32Array(1600).fill(0.001), 16000);
  }
  const sentDuringPause = sent.filter((m) => m.realtimeInput?.audio).length;
  assert.equal(sentDuringPause, 7, "Silence frames beyond 600 ms (6 chunks) are held in pausePreRoll so server VAD does not cut the list");
  assert.ok(live.pausePreRollFrames > 0 && live.pausePreRollFrames <= 3200);

  // Resume speech -> pausePreRoll flushes before the new speech chunk
  live.processCaptureChunk(new Float32Array(1600).fill(0.12), 16000);
  assert.equal(live.pausePreRollFrames, 0);
  assert.ok(sent.filter((m) => m.realtimeInput?.audio).length > sentDuringPause + 1);

  // Interrupted when not listening transitions to listening, not stuck in recording
  live.setListening(false);
  live.currentTurn.pending = true;
  live.receive({ serverContent: { interrupted: true } });
  assert.equal(states.at(-1), "listening");

  // Adaptive noiseFloor in NaturalVoiceConversation
  const voice = new NaturalVoiceConversation({ onState() {}, onTrace() {} });
  for (let i = 0; i < 15; i++) voice.evaluateVoice(0.015, i * 20);
  assert.ok(voice.noiseFloor > 0.008, "Rolling noiseFloor adapts to ambient background level");
});

test("V8 H-05: clasificación de 3 vías (DIRECT, FAST_READ, TASK), ventas de ayer/caja, depósitos, productos y fast-read sin carrera con pumpDelegatedTasks", async () => {
  assert.equal(classifyGeminiLiveTurn("Hola Olivia, ¿cómo estás?").routeCategory, "DIRECT");
  assert.equal(classifyGeminiLiveTurn("¿Cuánto vendimos ayer?").routeCategory, "FAST_READ");
  assert.equal(classifyGeminiLiveTurn("¿Cómo nos fue hoy?").routeCategory, "FAST_READ");
  assert.equal(classifyGeminiLiveTurn("¿Cuánta plata entró hoy?").routeCategory, "FAST_READ");
  assert.equal(classifyGeminiLiveTurn("¿Cómo viene la caja?").routeCategory, "FAST_READ");
  assert.equal(classifyGeminiLiveTurn("¿Qué depósitos están activos?").routeCategory, "FAST_READ");
  assert.equal(classifyGeminiLiveTurn("¿Qué productos tenemos?").routeCategory, "FAST_READ");
  assert.equal(classifyGeminiLiveTurn("Preparame una transferencia de stock").routeCategory, "TASK");

  const run = async (name) => {
    if (name === "list_warehouses") return { data: { records: [{ id: "w1", name: "Depósito Central", active: true }], observedAt: "2026-11-09T12:00:00.000Z" } };
    if (name === "search_products") return { data: { products: [{ productId: "oil", name: "Aceite Arbequina 500ml", currentStock: 14 }] } };
    if (name === "get_sales_metrics") return { data: { summary: { operations: 5, revenue: 82500 }, observedAt: "2026-11-09T12:00:00.000Z" } };
    return { data: {} };
  };

  const wh = await fastConversationRead({ plan: quickReadPlan("¿Qué depósitos están activos?"), context: {}, run, check() {} });
  assert.match(wh.content, /Depósito Central/);

  const pr = await fastConversationRead({ plan: quickReadPlan("¿Qué productos tenemos?"), context: { locationId: "local_a" }, run, check() {} });
  assert.match(pr.content, /Aceite Arbequina 500ml \(14 u\.\)/);

  const ys = await fastConversationRead({ plan: quickReadPlan("¿Cuánto vendimos ayer?"), context: { locationId: "local_a" }, run, check() {} });
  assert.match(ys.content, /5 ventas por un total de/);

  // Race condition test: startDelegatedTask({ foreground: true }) + concurrent pumpDelegatedTasks
  const f = await backend(async () => assert.fail("Fast read must not call Luna"));
  let backgroundDispatched = 0;
  const [task] = await Promise.all([
    startDelegatedTask({
      store: f.store,
      engine: f.engine,
      session: f.session,
      body: { conversationId: f.id, requestId: "fg_no_race_1", message: "¿Cómo viene la caja?", screenContext: { locationId: "local_a" }, foreground: true },
      dispatch: async () => { backgroundDispatched++; },
      now: f.clock(),
    }),
    pumpDelegatedTasks({
      store: f.store,
      engine: f.engine,
      session: f.session,
      parent: f.id,
      dispatch: async () => { backgroundDispatched++; },
      now: f.clock(),
    }),
  ]);
  assert.equal(task.status, "completed");
  assert.equal(backgroundDispatched, 0, "Foreground fast read must never be claimed by pumpDelegatedTasks");
  assert.match(task.fullResult, /Hoy se registraron 1 venta/);
});

test("V8 H-06: carga de stock multi-ítem con números en palabras y corrección puntual por ítem prepara prepare_catalog_stock_load con 0 llamadas a Luna", async () => {
  const f = await backend(async () => assert.fail("Deterministic multi-item stock load and correction should not call Luna"));
  f.documents.set("products/coratina", {
    name: "Aceite Coratina 500ml",
    abbreviation: "COR500",
    defaultPrice: 12000,
    categoryId: "cat_oil",
    categoryName: "Aceites",
    active: true,
    deleted: false,
  });
  f.documents.set("locationStock/local_a/items/coratina", {
    productId: "coratina",
    productName: "Aceite Coratina 500ml",
    currentStock: 3,
    price: 12000,
    active: true,
    deleted: false,
  });

  const first = await f.engine.chat(f.session, {
    conversationId: f.id,
    requestId: "multi_load_1",
    message: "Cargá diez botellas de Aceite y cinco de Aceite Coratina 500ml en Local A",
    screenContext: { module: "locations", locationId: "local_a" },
    foreground: true,
  });
  assert.equal(first.state, "ESPERANDO_CONFIRMACION");
  assert.equal(first.pendingAction?.toolName, "prepare_catalog_stock_load");
  assert.match(first.pendingAction.summary, /\+10 unidades/);
  assert.match(first.pendingAction.summary, /\+5 unidades/);

  // Independent fast read via startDelegatedTask while pendingAction is active preserves pendingAction and uses 0 model calls
  f.advance(2000);
  const sideReadTask = await startDelegatedTask({
    store: f.store,
    engine: f.engine,
    session: f.session,
    body: {
      conversationId: f.id,
      requestId: "side_read_during_pending",
      message: "¿Cuánto vendimos hoy?",
      screenContext: { module: "locations", locationId: "local_a" },
      foreground: true,
    },
    dispatch: async () => {},
    now: f.clock(),
  });
  assert.equal(sideReadTask.status, "completed");
  assert.match(sideReadTask.summary, /Hoy se registraron 1 venta/);
  const stateAfterSideRead = await f.engine.state(f.session, f.id);
  assert.equal(stateAfterSideRead.pendingAction?.id, first.pendingAction.id, "Pending confirmation card remains intact across an independent delegated fast read");

  // Item-specific correction updates the multi-item proposal
  f.advance(2000);
  const corrected = await f.engine.chat(f.session, {
    conversationId: f.id,
    requestId: "multi_load_2",
    message: "No, eran 15 Coratina",
    screenContext: { module: "locations", locationId: "local_a" },
    foreground: true,
  });
  assert.equal(corrected.state, "ESPERANDO_CONFIRMACION");
  assert.equal(corrected.pendingAction?.toolName, "prepare_catalog_stock_load");
  assert.match(corrected.pendingAction.summary, /\+10 unidades/);
  assert.match(corrected.pendingAction.summary, /\+15 unidades/);
  assert.equal(f.documents.get("locationStock/local_a/items/coratina").currentStock, 3, "No stock write occurs before visual confirmation");
});

test("V8 H-07: OliviaAssistant incluye el panel 'Tareas de Olivia' con soporte para pausar, retomar, cancelar y ver fullResult/voiceSummary", async () => {
  const assistantSource = await readFile(new URL("../src/gestion/olivia/OliviaAssistant.jsx", import.meta.url), "utf8");
  const tasksSource = await readFile(new URL("../src/gestion/olivia/OliviaDelegatedTasks.jsx", import.meta.url), "utf8");
  assert.match(assistantSource, /tasksPanelOpen/);
  assert.match(assistantSource, /Tareas de Olivia/);
  assert.match(tasksSource, /Resumen hablado/);
  assert.match(tasksSource, /Pausar/);
  assert.match(tasksSource, /Retomar/);
  assert.match(tasksSource, /Cancelar tarea/);
});
