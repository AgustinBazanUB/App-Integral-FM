import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultOliviaConfiguration,
  validateConfiguration,
} from "../src/shared/oliviaContracts.mjs";
import {
  estimateGeminiLiveAudioCost,
  geminiLiveMonthlyProjection,
  geminiLiveProviderCost,
  geminiLiveRawSetup,
  GEMINI_LIVE_MODEL,
} from "../src/shared/oliviaGeminiLive.mjs";
import { assertGeminiLivePreview } from "../netlify/functions/olivia-gemini-live.mjs";
import { addProviderSpend } from "../netlify/functions/_lib/olivia/usage.mjs";
import { GeminiLiveSession, resamplePcm16 } from "../src/gestion/olivia/geminiLive.mjs";
import { classifyGeminiLiveTurn } from "../src/shared/oliviaConversationRouter.mjs";
import { latencyTrace, latencyTracesCsv, latencyTracesJson } from "../src/shared/oliviaLatencyTrace.mjs";

test("configuration defaults keep the hybrid voice disabled outside the gated preview", () => {
  assert.equal(defaultOliviaConfiguration().hybridVoice.enabled, false);
  assert.equal(defaultOliviaConfiguration({ OLIVIA_HYBRID_LIVE_ENABLED: "true" }).hybridVoice.enabled, true);
  assert.equal(validateConfiguration(defaultOliviaConfiguration()).hybridVoice.hardLimitUsd, 10);
  const invalid = defaultOliviaConfiguration();
  invalid.hybridVoice.warningUsd = 4;
  assert.throws(() => validateConfiguration(invalid), /objetivo, aviso y techo/);
});

test("preview guard requires Deploy Preview, staging Firebase, a secret key and paid-tier attestation", () => {
  const env = { OLIVIA_DEPLOY_PREVIEW_CONTEXT: "deploy-preview", OLIVIA_HYBRID_LIVE_ENABLED: "true", GEMINI_API_KEY: "test-only", GEMINI_API_BILLING_TIER: "paid" };
  assert.doesNotThrow(() => assertGeminiLivePreview({ env, projectId: "app-integral-fm-pruebas" }));
  assert.throws(() => assertGeminiLivePreview({ env: { ...env, OLIVIA_DEPLOY_PREVIEW_CONTEXT: "" }, projectId: "app-integral-fm" }), (error) => error.code === "gemini-live-disabled");
  assert.throws(() => assertGeminiLivePreview({ env: { ...env, CONTEXT: "production" }, projectId: "app-integral-fm-pruebas" }), (error) => error.code === "gemini-live-disabled");
  assert.throws(() => assertGeminiLivePreview({ env: { ...env, GEMINI_API_BILLING_TIER: "free" }, projectId: "app-integral-fm-pruebas" }), (error) => error.code === "gemini-live-billing-unverified");
  assert.throws(() => assertGeminiLivePreview({ env: { ...env, GEMINI_API_KEY: "" }, projectId: "app-integral-fm-pruebas" }), (error) => error.code === "gemini-live-unconfigured");
});

test("provider usage costs include accumulated audio and text tokens by modality", () => {
  const result = geminiLiveProviderCost({
    promptTokensDetails: [{ modality: "AUDIO", tokenCount: 1500 }, { modality: "TEXT", tokenCount: 1000 }],
    responseTokensDetails: [{ modality: "AUDIO", tokenCount: 1000 }, { modality: "TEXT", tokenCount: 200 }],
  });
  assert.equal(result.measurement, "provider-forwarded");
  assert.equal(result.inputTokens, 2500);
  assert.equal(result.outputTokens, 1200);
  assert.deepEqual(result.inputTokensByModality, { AUDIO: 1500, TEXT: 1000 });
  assert.deepEqual(result.outputTokensByModality, { AUDIO: 1000, TEXT: 200 });
  assert.equal(result.costUsd, 0.01815);
  const withToolPrompt = geminiLiveProviderCost({
    promptTokensDetails: [{ modality: "AUDIO", tokenCount: 1500 }, { modality: "TEXT", tokenCount: 1000 }],
    toolUsePromptTokensDetails: [{ modality: "TEXT", tokenCount: 500 }],
    responseTokensDetails: [{ modality: "AUDIO", tokenCount: 1000 }, { modality: "TEXT", tokenCount: 200 }],
  });
  assert.equal(withToolPrompt.costUsd, 0.018525);
  assert.equal(geminiLiveProviderCost({ totalTokenCount: 200 }).costUsd, null);
});

test("audio-only estimates state that accumulated context is excluded", () => {
  const result = estimateGeminiLiveAudioCost({ inputAudioSeconds: 60, outputAudioSeconds: 30 });
  assert.ok(Math.abs(result.estimatedCostUsd - 0.014) < 1e-12);
  assert.equal(result.excludesAccumulatedContext, true);
  assert.equal(geminiLiveMonthlyProjection({ spendUsd: 5, queryCount: 660 }).projectionAt660Usd, 5);
});

test("monthly provider rollup tracks Luna only and rejects the retired speech provider", () => {
  const now = new Date("2026-11-06T12:00:00.000Z");
  let ledger = addProviderSpend(null, { provider: "lunaSol", period: "2026-11", costUsd: 0.0015, inputTokens: 100, outputTokens: 25 }, now);
  ledger = addProviderSpend(ledger, { provider: "lunaSol", period: "2026-11", costUsd: null, inputTokens: 10, outputTokens: 4 }, now);
  assert.equal(ledger.lunaSol.estimatedUsd, 0.0015);
  assert.equal(ledger.lunaSol.unconfirmedCalls, 1);
  assert.equal(ledger.lunaSol.calls, 2);
  assert.equal(ledger.lunaSol.inputTokens, 110);
  assert.throws(() => addProviderSpend(ledger, { provider: "chirp", period: "2026-11", costUsd: 0.00003 }, now), { code: "invalid-provider" });
  assert.equal(Object.hasOwn(ledger, "userId"), false);
});

test("raw Live setup fixes model, voice, tool policy, compression and modalities", () => {
  const setup = geminiLiveRawSetup();
  assert.equal(setup.model, `models/${GEMINI_LIVE_MODEL}`);
  assert.deepEqual(setup.generationConfig.responseModalities, ["AUDIO"]);
  assert.equal(setup.generationConfig.maxOutputTokens, 2048);
  assert.equal(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Aoede");
  assert.equal(setup.contextWindowCompression.slidingWindow.targetTokens, 1200);
  assert.equal(setup.tools[0].functionDeclarations[0].name, "delegate_to_olivia");
  assert.equal(setup.realtimeInputConfig.automaticActivityDetection.disabled, false);
  assert.equal(setup.realtimeInputConfig.automaticActivityDetection.silenceDurationMs, 1000);
  assert.equal(setup.realtimeInputConfig.activityHandling, "START_OF_ACTIVITY_INTERRUPTS");
  assert.equal(setup.thinkingLevel, undefined);
});

test("Gemini Live keeps consecutive everyday conversation direct and business intent delegated", () => {
  assert.equal(classifyGeminiLiveTurn("Hola, ¿cómo estás?").route, "direct");
  assert.equal(classifyGeminiLiveTurn("Muy bien, ¿y vos?").route, "direct");
  assert.equal(classifyGeminiLiveTurn("Todo bien, gracias").route, "direct");
  assert.equal(classifyGeminiLiveTurn("¿Qué andás haciendo?").route, "direct");
  assert.equal(classifyGeminiLiveTurn("Qué bueno").route, "direct");
  assert.equal(classifyGeminiLiveTurn("Contame algo lindo").route, "direct");
  assert.equal(classifyGeminiLiveTurn("Dale, me gustó").route, "direct");
  assert.equal(classifyGeminiLiveTurn("Bueno, hablamos luego").route, "direct");
  assert.equal(classifyGeminiLiveTurn("Muchísimas gracias").route, "direct");
  assert.equal(classifyGeminiLiveTurn("¿Te acordás de lo que te pregunté recién?").route, "direct");
  assert.equal(classifyGeminiLiveTurn("¿De qué veníamos hablando recién?").route, "direct");
  assert.equal(classifyGeminiLiveTurn("Perfecto, gracias").route, "direct");
  assert.equal(classifyGeminiLiveTurn("Bien, por suerte. ¿Qué andás haciendo?").route, "direct");
  assert.equal(classifyGeminiLiveTurn("¿Qué onda hoy?").route, "direct");
  assert.equal(classifyGeminiLiveTurn("Dale, gracias").route, "direct");
  assert.equal(classifyGeminiLiveTurn("Dale, gracias",{pendingAction:true}).route, "delegate", "a contextual confirmation is handled by Olivia's task engine");
  assert.equal(classifyGeminiLiveTurn("Dale, cargá una venta").route, "delegate");
  assert.equal(classifyGeminiLiveTurn("Sí").route, "direct");
  assert.equal(classifyGeminiLiveTurn("Sí",{collectingTask:true}).route, "delegate");
  assert.equal(classifyGeminiLiveTurn("Perfecto, gracias; registrá una venta").route, "delegate");
  assert.equal(classifyGeminiLiveTurn("Dale, cargá 20 unidades de aceite").kind, "collection-question", "missing location is collected without claiming a validated operation");
  assert.equal(classifyGeminiLiveTurn("Dale, cargá 20 unidades de aceite en Local Lavalle").route, "delegate", "complete requested parameters still need backend validation");
  assert.equal(classifyGeminiLiveTurn("Hola, ¿cuánto stock queda?").route, "delegate");
  assert.equal(classifyGeminiLiveTurn("¿Qué precio me dijiste recién para el aceite?").route, "delegate");
  assert.equal(classifyGeminiLiveTurn("Gracias, registrá una venta").route, "delegate");
});

test("latency trace exports are sanitized and reject unsafe event stages", () => {
  let now = 100;
  const trace = latencyTrace({ id: "turn_1", now: () => now++ });
  trace.mark("gemini.turn.start", { route: "delegate", userText: "No exportar texto privado" });
  trace.mark("assistant.text\nmalicious", { status: "ok" });
  const unsafe = { id: "turn_2", requestId: "request_2", origin: "client", clock: "performance", events: [
    { stage: "gemini.turn.complete", ms: 4, turnIndex: 2, route: "direct" },
    { stage: "x\nuserText=secret", ms: 5, status: "ok" },
    { stage: "gemini.delegate", ms: 6, userText: "Venta de 3 unidades", args: { secret: "never" } },
  ] };
  const json = latencyTracesJson([trace.snapshot(), unsafe]);
  const csv = latencyTracesCsv([trace.snapshot(), unsafe]);
  assert.doesNotMatch(json, /No exportar texto privado|Venta de 3 unidades|userText|secret|args/);
  assert.doesNotMatch(csv, /No exportar texto privado|Venta de 3 unidades|userText|secret|args/);
  assert.match(json, /gemini\.turn\.complete/);
  assert.match(csv, /turnIndex/);
});

test("48 kHz capture resamples to 16 kHz signed PCM", () => {
  const input = new Float32Array(480).fill(0.5), output = resamplePcm16(input, 48000);
  assert.equal(output.length, 160);
  assert.ok(output.every((sample) => sample > 0));
});

test('Live preserves the onset preceding local VAD without transmitting idle microphone audio',()=>{
  const sent=[],levels=[],node=()=>({connect(){},disconnect(){}});
  const context={sampleRate:16000,destination:{},createMediaStreamSource:node,createScriptProcessor:node,createGain:()=>({...node(),gain:{value:1}})};
  const live=new GeminiLiveSession({audioContext:context,WebSocket:{OPEN:1},onInputFrame:frame=>levels.push(frame),request:async()=>({})});
  live.socket={readyState:1,send:data=>sent.push(JSON.parse(data)),close(){}};live.ready=true;live.attachCapture({});
  const frame=value=>live.processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(1024).fill(value)}});
  for(const value of [.001,.002,.003,.004,.005,.006])frame(value);
  assert.equal(sent.length,0,'idle capture is never sent to Gemini');
  assert.ok(live.capturePreRollFrames<=3200,'retained onset is bounded to 200 ms');
  live.beginTurn('onset');frame(.1);
  const audio=sent.filter(e=>e.realtimeInput?.audio).map(e=>Buffer.from(e.realtimeInput.audio.data,'base64').readInt16LE(0));
  assert.deepEqual(audio,[.004,.005,.006,.1].map(v=>Math.round(v*32767)),'pre-threshold speech precedes the first live frame, once and in order');
  assert.equal(levels.length,7,'VAD receives audio cadence even while not streaming');
  assert.equal(live.currentTurn.inputAudioSeconds,4096/16000);
  live.stopCapture();assert.equal(live.capturePreRollFrames,0);assert.deepEqual(live.capturePreRoll,[]);live.close();
});

test("Live connection diagnostics retain the WebSocket close code and request reconnect", async (t) => {
  class FakeSocket {
    static OPEN = 1;
    static instances = [];
    constructor() { this.readyState = 0; FakeSocket.instances.push(this); }
    send() {}
    close() { this.readyState = 3; }
  }
  const failures = [], notices = [];
  const live = new GeminiLiveSession({
    request: async (payload) => payload.operation === "token"
      ? { token: "auth_tokens/diagnostic", sessionId: "diagnostic", expiresAt: new Date(Date.now() + 60000).toISOString(), maxSessionSeconds: 600 }
      : { closed: true },
    conversationId: "diagnostic", audioContext: { createScriptProcessor() {} }, WebSocket: FakeSocket,
    onUnavailable: (error) => failures.push(error.message), onNotice: (message) => notices.push(message),
  });
  t.after(() => live.close());
  const started = live.start({});
  await new Promise((resolve) => setTimeout(resolve, 0));
  const socket = FakeSocket.instances[0];
  socket.onerror();
  socket.onclose({ code: 1008 });
  await assert.rejects(started, /código 1008/);
  assert.deepEqual(failures, ["Gemini Live cerró la conexión (código 1008); volvé a conectar para continuar por voz."]);
  assert.match(notices.at(-1), /seguir escribiendo/);assert.doesNotMatch(notices.at(-1), /Gemini|1008|WebSocket/);
  assert.equal(live.failed, true);
});

test("Live handshake timeout reports whether the WebSocket opened", async (t) => {
  class FakeSocket {
    static OPEN = 1;
    static instances = [];
    constructor() { this.readyState = 0; FakeSocket.instances.push(this); }
    send() {}
    close() { this.readyState = 3; }
  }
  const failures = [];
  const live = new GeminiLiveSession({
    request: async (payload) => payload.operation === "token"
      ? { token: "auth_tokens/diagnostic", sessionId: "diagnostic", expiresAt: new Date(Date.now() + 60000).toISOString(), maxSessionSeconds: 600 }
      : { closed: true },
    conversationId: "diagnostic", audioContext: { createScriptProcessor() {} }, WebSocket: FakeSocket,
    connectTimeoutMs: 10, onUnavailable: (error) => failures.push(error.message),
  });
  t.after(() => live.close());
  const started = live.start({});
  await new Promise((resolve) => setTimeout(resolve, 0));
  const socket = FakeSocket.instances[0];
  socket.readyState = FakeSocket.OPEN; socket.onopen();
  await assert.rejects(started, /WebSocket OPEN/);
  assert.deepEqual(failures, ["Gemini Live no respondió al handshake dentro del plazo (WebSocket OPEN); volvé a conectar para continuar por voz."]);
});

test("closing during token issuance releases the late reservation without opening a socket", async () => {
  let resolveToken;
  const operations=[];
  const live=new GeminiLiveSession({conversationId:'late-token',audioContext:{},WebSocket:class { constructor(){throw new Error('A cancelled session must not open a socket');} },request:body=>{
    operations.push(body);
    return body.operation==='token' ? new Promise(resolve=>{resolveToken=resolve;}) : Promise.resolve({closed:true});
  }});
  const started=live.start(null,{textInputOnly:true});
  live.close();
  resolveToken({token:'auth_tokens/late',sessionId:'late-session'});
  await assert.rejects(started,{name:'AbortError'});
  assert.deepEqual(operations.map(item=>item.operation),['token','close']);
  assert.equal(operations[1].sessionId,'late-session');
  assert.equal(live.socket,undefined);
});

test("binary Live frames complete the handshake and a text diagnostic turn without opening a microphone", async (t) => {
  let socket;
  class BinarySocket {
    static OPEN = 1;
    constructor() { socket = this; this.readyState = 0; this.sent = []; }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; }
    receive(event) { this.onmessage({data:new TextEncoder().encode(JSON.stringify(event)).buffer}); }
  }
  const turns = [], reports = [], closedBudgets = [];
  const live = new GeminiLiveSession({
    conversationId:'diagnostic-text', audioContext:{currentTime:0}, WebSocket:BinarySocket, completionGraceMs:5,
    request:async body => {
      if(body.operation==='token')return {token:'auth_tokens/test',sessionId:'text-only',expiresAt:new Date(Date.now()+60000).toISOString(),maxSessionSeconds:60};
      if(body.operation==='classify')return {route:'direct',direct:true};
      if(body.operation==='usage'){reports.push(body);return {measurement:'provider-forwarded',shouldStop:false};}
      return {closed:true,reservedUsd:0};
    },
    onTurnComplete:turn=>turns.push(turn),
    onSessionClosed:budget=>closedBudgets.push(budget),
  });
  t.after(()=>live.close());
  const started=live.start(null,{textInputOnly:true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(socket.binaryType,'arraybuffer');
  socket.readyState=1;socket.onopen();socket.receive({setupComplete:{}});
  await started;
  assert.equal(live.captureSource,undefined);
  live.sendText('Hola, Olivia');
  assert.throws(()=>live.sendText('Otra consulta'),/turno actual/);
  assert.deepEqual(socket.sent.at(-1),{clientContent:{turns:[{role:'user',parts:[{text:'Hola, Olivia'}]}],turnComplete:true}});
  socket.receive({serverContent:{outputTranscription:{text:'Hola, ¿cómo estás?'},turnComplete:true},usageMetadata:{promptTokensDetails:[{modality:'TEXT',tokenCount:10}],responseTokensDetails:[{modality:'TEXT',tokenCount:8}]}});
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(turns.length,1);
  assert.equal(turns[0].userText,'Hola, Olivia');
  assert.equal(turns[0].assistantText,'Hola, ¿cómo estás?');
  assert.equal(turns[0].delegated,false);
  assert.equal(reports[0].inputAudioSeconds,0);
  assert.equal(reports[0].usageMetadata.promptTokensDetails[0].modality,'TEXT');
  socket.receive({serverContent:{outputTranscription:{text:'Late old output'},modelTurn:{parts:[{inlineData:{data:'AQACAA=='}}]}},usageMetadata:{totalTokenCount:99}});
  assert.equal(live.currentTurn.outputText,'');
  assert.equal(live.currentTurn.usageMetadata,null);
  assert.equal(live.currentTurn.outputAudioSeconds,0,'late frames cannot create a phantom paid turn');
  socket.receive({serverContent:{generationComplete:true}});
  live.sendText('Gracias');
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(live.failed,false,'a trailing event from the previous turn must not arm a deadline on the next turn');
  live.close();
  await live.stopping;
  assert.equal(closedBudgets.at(-1).reservedUsd,0,'the visible budget gets the confirmed release without replacing per-turn usage');
  assert.equal(reports.length,2,'unfinished paid turns must be reported before releasing the reservation');
  assert.equal(reports[1].usageMetadata,null,'unfinished usage stays unconfirmed instead of becoming a zero-cost success');
});

test("one persistent Gemini session keeps ten consecutive social turns direct", async (t) => {
  class FakeSocket {
    static OPEN = 1;
    static instances = [];
    constructor() { this.readyState = 0; this.sent = []; FakeSocket.instances.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; }
    receive(event) { this.onmessage({ data: JSON.stringify(event) }); }
  }
  const operations = [], turns = [], classifications = [];
  const inputs = [
    "Hola, Olivia",
    "¿Cómo estás?",
    "Muy bien, ¿y vos?",
    "Todo bien, gracias",
    "¿Qué andás haciendo?",
    "¿Te acordás de lo que te pregunté recién?",
    "Contame algo lindo",
    "Dale, me gustó",
    "Muchas gracias",
    "Bueno, hablamos luego",
  ];
  const live = new GeminiLiveSession({
    conversationId: "ten-turn-social-session",
    audioContext: { currentTime: 0 },
    WebSocket: FakeSocket,
    request: async ({ operation }) => {
      operations.push(operation);
      if (operation === "token") return { token: "auth_tokens/social", sessionId: "social-session", expiresAt: new Date(Date.now() + 60000).toISOString(), maxSessionSeconds: 600 };
      if (operation === "usage") return { measurement: "provider-forwarded", shouldStop: false };
      return { closed: true };
    },
    onTurnComplete: turn => turns.push(turn),
    onClassification: decision => classifications.push(decision),
  });
  t.after(() => live.close());

  const started = live.start(null, { textInputOnly: true });
  await new Promise(resolve => setImmediate(resolve));
  const socket = FakeSocket.instances?.[0];
  assert.ok(socket, "one persistent WebSocket is opened for the whole sequence");
  socket.readyState = FakeSocket.OPEN; socket.onopen(); socket.receive({ setupComplete: {} }); await started;

  for (const [index, input] of inputs.entries()) {
    const complete = new Promise(resolve => {
      const prior = live.onTurnComplete;
      live.onTurnComplete = turn => { prior(turn); if (turn.turnIndex === index + 1) resolve(turn); };
    });
    live.sendText(input);
    assert.equal(live.currentTurn.directAuthorized, true, `turn ${index + 1} is locally authorized as everyday conversation`);
    socket.receive({ serverContent: { outputTranscription: { text: "Dale, te sigo." }, turnComplete: true } });
    const turn = await complete;
    assert.equal(turn.delegated, false, `turn ${index + 1} stays on Gemini Live`);
    await new Promise(resolve => setImmediate(resolve));
  }

  assert.equal(turns.length, 10);
  assert.equal(turns[5].userText, "¿Te acordás de lo que te pregunté recién?");
  assert.ok(classifications.every(item => item.route === "local-direct"));
  assert.equal(operations.filter(operation => operation === "classify").length, 0, "no HTTP classification is requested during the persistent conversation");
  assert.equal(operations.filter(operation => operation === "token").length, 1, "the session is not reconnected between turns");
  assert.equal(operations.filter(operation => operation === "usage").length, 10, "usage is accounted once per turn");
  assert.equal(live.failed, false);
  live.close();
  await live.stopping;
  assert.equal(operations.filter(operation => operation === "close").length, 1);
});

test("silent generation without turnComplete finalizes once without switching voice providers", async (t) => {
  let socket,count=0;
  class Socket {
    static OPEN=1;
    constructor(){socket=this;this.readyState=0;if(++count>1)queueMicrotask(()=>{this.readyState=1;this.onopen();this.receive({setupComplete:{}});});}
    send(){}
    close(){this.readyState=3;}
    receive(event){this.onmessage({data:JSON.stringify(event)});}
  }
  const turns=[],failures=[],operations=[],recoveries=[];
  const live=new GeminiLiveSession({conversationId:'silent-provider',audioContext:{currentTime:0},WebSocket:Socket,completionGraceMs:5,waitRecovery:async()=>{},onRecovery:r=>recoveries.push(r),
    request:async body=>{operations.push(body.operation);if(body.operation==='token')return {token:'auth_tokens/silent',sessionId:'silent',expiresAt:new Date(Date.now()+60000).toISOString(),maxSessionSeconds:60};if(body.operation==='classify')return {direct:true,route:'direct'};return {closed:true,shouldStop:false};},
    onTurnComplete:turn=>turns.push(turn),onUnavailable:error=>failures.push(error.message),
  });
  t.after(()=>live.close());
  const started=live.start(null,{textInputOnly:true});await new Promise(resolve=>setImmediate(resolve));
  socket.readyState=1;socket.onopen();socket.receive({setupComplete:{}});await started;
  const initialSocket=socket;live.sendText('Hola');
  socket.receive({serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:'AAA='}}]},outputTranscription:{text:'Hola, ¿cómo estás?'}}});
  socket.receive({serverContent:{generationComplete:true}});
  await new Promise(resolve=>setTimeout(resolve,30));
  await live.stopping;
  assert.equal(turns.length,1);
  assert.equal(turns[0].noAudio,true);
  assert.equal(turns[0].providerIncomplete,true);
  assert.equal(turns[0].assistantText,'Hola, ¿cómo estás?');
  assert.equal(live.failed,false);assert.deepEqual(failures,[]);
  assert.equal(recoveries.at(-1).status,"connected");assert.equal(recoveries.at(-1).resumed,false);
  assert.equal(operations.filter(op=>op==='usage').length,1);
  assert.equal(operations.at(-1),'token');assert.ok(operations.includes('close'));
  initialSocket.receive({serverContent:{turnComplete:true}});
  assert.equal(turns.length,1,'a late completion cannot deliver or charge a second answer');
});

test("Live session sends short PCM chunks, plays audio and reports one direct turn", async (t) => {
  class FakeSocket {
    static OPEN = 1;
    static instances = [];
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; FakeSocket.instances.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const context = {
    sampleRate: 48000, currentTime: 0, destination: {},
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    createScriptProcessor: () => ({ connect() {}, disconnect() {}, onaudioprocess: null }),
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    createBuffer: (_channels, length) => ({ duration: length / 24000, getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => ({ connect() {}, disconnect() {}, start() { played++; }, stop() {} }),
  };
  const operations = [], turns = [], usage = [], transcripts = [];
  let played = 0;
  const live = new GeminiLiveSession({
    request: async (payload) => {
      operations.push(payload.operation);
      if (payload.operation === "token") return { token: "auth_tokens/example", sessionId: "session-1", expiresAt: new Date(Date.now() + 60000).toISOString(), maxSessionSeconds: 600 };
      if (payload.operation === "usage") return { measurement: "provider-forwarded", spendUsd: 0.001, inputTokensByModality: { AUDIO: 10 }, outputTokensByModality: { AUDIO: 10 }, shouldStop: false };
      return { closed: true };
    },
    conversationId: "conversation-1", audioContext: context,
    WebSocket: FakeSocket,
    onTranscript: (text) => transcripts.push(text),
    onTurnComplete: (turn) => turns.push(turn),
    onUsage: (record) => usage.push(record),
  });
  t.after(() => live.close());
  const started = live.start({});
  await new Promise((resolve) => setTimeout(resolve, 0));
  const socket = FakeSocket.instances[0];
  assert.match(socket.url, /BidiGenerateContentConstrained\?access_token=auth_tokens%2Fexample/);
  socket.readyState = FakeSocket.OPEN; socket.onopen();
  socket.onmessage({ data: JSON.stringify({ setupComplete: {} }) });
  await started;
  assert.equal(live.handlesTurns, true);
  live.setListening(true);
  live.processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(1024).fill(0.25) } });
  const audioMessage = socket.sent.find((item) => item.realtimeInput?.audio);
  assert.equal(audioMessage.realtimeInput.audio.mimeType, "audio/pcm;rate=16000");
  live.setListening(false);
  assert.equal(socket.sent.at(-1).realtimeInput.audioStreamEnd, true);
  const audio = btoa(String.fromCharCode(1, 0, 2, 0));
  socket.onmessage({ data: JSON.stringify({ serverContent: { inputTranscription: { text: "Hola Olivia" }, outputTranscription: { text: "Hola, ¿cómo estás?" }, modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: audio } }] } }, usageMetadata: { promptTokensDetails: [{ modality: "AUDIO", tokenCount: 10 }], responseTokensDetails: [{ modality: "AUDIO", tokenCount: 10 }] } }) });
  assert.equal(played, 1, "safe social audio is authorized by the shared local policy without a round trip");
  assert.deepEqual(transcripts, ["Hola, ¿cómo estás?"], "safe social text is released by the local policy");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(played, 1, "one audio chunk is scheduled");
  assert.deepEqual(transcripts, ["Hola, ¿cómo estás?"]);
  socket.onmessage({ data: JSON.stringify({ serverContent: { turnComplete: true } }) });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(turns.length, 1);
  assert.equal(turns[0].userText, "Hola Olivia");
  assert.equal(turns[0].assistantText, "Hola, ¿cómo estás?");
  assert.equal(usage.length, 1);
  assert.deepEqual(usage[0].inputTokensByModality, { AUDIO: 10 });
  assert.deepEqual(usage[0].outputTokensByModality, { AUDIO: 10 });
  assert.equal(played, 1);
  assert.deepEqual(transcripts, ["Hola, ¿cómo estás?"]);
  assert.equal(operations.includes("classify"), false, "direct social turns skip the classify HTTP request");
  assert.ok(operations.includes("usage"));
  live.close();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(operations.includes("close"));
});

test("business turns suppress an unverified Gemini answer and delegate to Olivia", async (t) => {
  class FakeSocket {
    static OPEN = 1;
    static instances = [];
    constructor() { this.readyState = 0; this.sent = []; FakeSocket.instances.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  let played = 0;
  const context = {
    sampleRate: 48000, currentTime: 0, destination: {},
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    createScriptProcessor: () => ({ connect() {}, disconnect() {}, onaudioprocess: null }),
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    createBuffer: (_channels, length) => ({ duration: length / 24000, getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => ({ connect() {}, disconnect() {}, start() { played++; }, stop() {} }),
  };
  const completed = [], transcripts = [], operations = [];
  const live = new GeminiLiveSession({
    request: async (payload) => {
      operations.push(payload.operation);
      if (payload.operation === "token") return { token: "auth_tokens/business", sessionId: "session-business", expiresAt: new Date(Date.now() + 60000).toISOString(), maxSessionSeconds: 600 };
      if (payload.operation === "usage") return { measurement: "provider-forwarded", shouldStop: false };
      return { closed: true };
    },
    conversationId: "conversation-business", audioContext: context, WebSocket: FakeSocket,
    onToolCall: async (_call, request) => `Resultado verificado para: ${request}`,
    onTranscript: (text) => transcripts.push(text), onTurnComplete: (turn) => completed.push(turn),
  });
  t.after(() => live.close());
  const started = live.start({});
  await new Promise((resolve) => setTimeout(resolve, 0));
  const socket = FakeSocket.instances[0]; socket.readyState = FakeSocket.OPEN; socket.onopen();
  socket.onmessage({ data: JSON.stringify({ setupComplete: {} }) }); await started;
  live.setListening(true); live.setListening(false);
  const audio = btoa(String.fromCharCode(1, 0, 2, 0));
  socket.onmessage({ data: JSON.stringify({ serverContent: { inputTranscription: { text: "¿Cuánto stock queda?" }, outputTranscription: { text: "Hay doce unidades" }, modelTurn: { parts: [{ inlineData: { data: audio } }] } }, usageMetadata: { promptTokensDetails: [{ modality: "AUDIO", tokenCount: 10 }], responseTokensDetails: [{ modality: "AUDIO", tokenCount: 10 }] } }) });
  assert.equal(played, 0);
  assert.deepEqual(transcripts, []);
  socket.onmessage({ data: JSON.stringify({ serverContent: { turnComplete: true } }) });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(played, 0, "discarded Gemini audio must never play for a business question");
  assert.equal(completed[0].delegated, true);
  assert.equal(completed[0].noAudio, true);
  assert.equal(completed[0].assistantText, "Resultado verificado para: ¿Cuánto stock queda?");
  assert.deepEqual(transcripts, ["Resultado verificado para: ¿Cuánto stock queda?"]);
  assert.equal(operations.includes("classify"), false, "business input is delegated without a classify round trip");
  live.close();
});

test("Gemini speaks only an exact neutral acknowledgement while Olivia processes a delegated turn", async (t) => {
  class FakeSocket {
    static OPEN = 1;
    static instances = [];
    constructor() { this.readyState = 0; this.sent = []; FakeSocket.instances.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; this.onclose?.(); }
    receive(event) { this.onmessage({ data: JSON.stringify(event) }); }
  }
  let played = 0, finishTool;
  const turns = [], transcripts = [], operations = [];
  const context = {
    currentTime: 0, destination: {},
    createBuffer: (_channels, length) => ({ duration: length / 24000, getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => ({ connect() {}, disconnect() {}, start() { played++; }, stop() {} }),
  };
  const live = new GeminiLiveSession({
    request: async payload => { operations.push(payload.operation); if (payload.operation === "token") return { token: "auth_tokens/ack", sessionId: "ack", expiresAt: new Date(Date.now() + 60000).toISOString(), maxSessionSeconds: 60 }; if (payload.operation === "usage") return { shouldStop: false }; return { closed: true }; },
    conversationId: "acknowledgement", audioContext: context, WebSocket: FakeSocket,
    onToolCall: async () => new Promise(resolve => { finishTool = resolve; }),
    onTranscript: text => transcripts.push(text), onTurnComplete: turn => turns.push(turn),
  });
  t.after(() => live.close());
  const started = live.start(null, { textInputOnly: true });
  await new Promise(resolve => setImmediate(resolve));
  const socket = FakeSocket.instances[0]; socket.readyState = FakeSocket.OPEN; socket.onopen(); socket.receive({ setupComplete: {} }); await started;
  live.sendText("¿Cuánto stock queda?");
  socket.receive({
    toolCall: { functionCalls: [{ id: "call-ack", name: "delegate_to_olivia", args: { request: "modelo no confiable" } }] },
    serverContent: { outputTranscription: { text: "Dale, lo reviso." }, modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AQACAA==" } }] } },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof finishTool, "function");
  assert.equal(played, 1, "the exact acknowledgement is scheduled before the backend tool returns");
  assert.deepEqual(transcripts, ["Dale, lo reviso."]);
  assert.equal(turns.length, 0, "the acknowledgement is not mistaken for a completed business answer");
  finishTool("Almendras: 31 unidades en Tribunales.");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(socket.sent.at(-1).toolResponse.functionResponses[0].response.result, "Almendras: 31 unidades en Tribunales.");
  socket.receive({ serverContent: { outputTranscription: { text: "Almendras: 31 unidades en Tribunales." }, modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AQACAA==" } }] } } });
  socket.receive({ serverContent: { turnComplete: true } });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(played, 2, "Gemini also voices the verified result when it returns audio");
  assert.equal(turns.length, 1);
  assert.equal(turns[0].delegated, true);
  assert.equal(turns[0].noAudio, false);
  assert.equal(turns[0].acknowledgementHeard, true);
  assert.match(turns[0].assistantText, /31 unidades/);
  assert.equal(operations.includes("classify"), false);
  live.close();
  await live.stopping;
});

test("Gemini tool calls wait for final user transcription and never use model arguments as a substitute", async (t) => {
  class FakeSocket {
    static OPEN = 1;
    static instances = [];
    constructor() { this.readyState = 0; this.sent = []; FakeSocket.instances.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; this.onclose?.(); }
    receive(event) { this.onmessage({ data: JSON.stringify(event) }); }
  }
  const calls = [], operations = [];
  const live = new GeminiLiveSession({
    request: async payload => {
      operations.push(payload.operation);
      if (payload.operation === "token") return { token: "auth_tokens/tool", sessionId: "tool", expiresAt: new Date(Date.now() + 60000).toISOString(), maxSessionSeconds: 60 };
      if (payload.operation === "usage") return { shouldStop: false };
      return { closed: true };
    },
    conversationId: "tool-transcript", audioContext: { currentTime: 0 }, WebSocket: FakeSocket, transcriptWaitMs: 20,
    onToolCall: async (call, text, context) => { calls.push({ call, text, context }); return `Verified: ${text}`; },
  });
  t.after(() => live.close());
  const started = live.start(null, { textInputOnly: true });
  await new Promise(resolve => setImmediate(resolve));
  const socket = FakeSocket.instances[0]; socket.readyState = FakeSocket.OPEN; socket.onopen(); socket.receive({ setupComplete: {} }); await started;

  live.beginTurn("turn_has_final");
  const completeTranscriptTurn = live.currentTurn;
  const handler = live.handleTools([{ id: "function-1", name: "delegate_to_olivia", args: { request: "texto inventado por el modelo" } }], completeTranscriptTurn);
  socket.receive({ serverContent: { inputTranscription: { text: "¿Cuánto stock queda?" } } });
  await handler;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, "¿Cuánto stock queda?");
  assert.deepEqual(calls[0].context, { turnId: "turn_has_final", turnIndex: 1, transcriptComplete: true });
  const response = socket.sent.find(message => message.toolResponse)?.toolResponse.functionResponses[0];
  assert.equal(response.response.result, "Verified: ¿Cuánto stock queda?");

  live.beginTurn("turn_missing_final");
  const missingTranscriptTurn = live.currentTurn;
  await live.handleTools([{ id: "function-2", name: "delegate_to_olivia", args: { request: "NO ejecutar desde args" } }], missingTranscriptTurn);
  assert.equal(calls.length, 1, "no engine write path is called without authoritative transcription");
  const missingToolResponse = socket.sent.find(message => message.toolResponse?.functionResponses?.some(item => item.id === "function-2"));
  assert.ok(missingToolResponse, JSON.stringify({ failed: live.failed, closed: live.closed, cancelled: missingTranscriptTurn.cancelled, sent: socket.sent }));
  const errorResponse = missingToolResponse.toolResponse.functionResponses[0];
  assert.match(errorResponse.response.error, /transcripción final/);
  assert.equal(operations.includes("classify"), false);
});
