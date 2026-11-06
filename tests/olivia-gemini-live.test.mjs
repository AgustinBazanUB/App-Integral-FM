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

test("monthly provider rollup distinguishes tariff-based estimates and unconfirmed costs", () => {
  const now = new Date("2026-11-06T12:00:00.000Z");
  let ledger = addProviderSpend(null, { provider: "lunaSol", period: "2026-11", costUsd: 0.0015, inputTokens: 100, outputTokens: 25 }, now);
  ledger = addProviderSpend(ledger, { provider: "lunaSol", period: "2026-11", costUsd: null, inputTokens: 10, outputTokens: 4 }, now);
  ledger = addProviderSpend(ledger, { provider: "chirp", period: "2026-11", costUsd: 0.00003, characters: 1000 }, now);
  assert.equal(ledger.lunaSol.estimatedUsd, 0.0015);
  assert.equal(ledger.lunaSol.unconfirmedCalls, 1);
  assert.equal(ledger.lunaSol.calls, 2);
  assert.equal(ledger.lunaSol.inputTokens, 110);
  assert.equal(ledger.chirp.estimatedUsd, 0.00003);
  assert.equal(ledger.chirp.characters, 1000);
  assert.equal(Object.hasOwn(ledger, "userId"), false);
});

test("raw Live setup fixes model, voice, tool policy, compression and modalities", () => {
  const setup = geminiLiveRawSetup();
  assert.equal(setup.model, `models/${GEMINI_LIVE_MODEL}`);
  assert.deepEqual(setup.generationConfig.responseModalities, ["AUDIO"]);
  assert.equal(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Aoede");
  assert.equal(setup.contextWindowCompression.slidingWindow.targetTokens, 1200);
  assert.equal(setup.tools[0].functionDeclarations[0].name, "delegate_to_olivia");
  assert.equal(setup.thinkingLevel, undefined);
});

test("backend direct route is limited to exact conversational phrases", () => {
  assert.equal(classifyGeminiLiveTurn("Hola, ¿cómo estás?").route, "direct");
  assert.equal(classifyGeminiLiveTurn("Muchísimas gracias").route, "direct");
  assert.equal(classifyGeminiLiveTurn("Perfecto, gracias").route, "direct");
  assert.equal(classifyGeminiLiveTurn("Perfecto, gracias; registrá una venta").route, "delegate");
  assert.equal(classifyGeminiLiveTurn("Hola, ¿cuánto stock queda?").route, "delegate");
  assert.equal(classifyGeminiLiveTurn("Gracias, registrá una venta").route, "delegate");
});

test("48 kHz capture resamples to 16 kHz signed PCM", () => {
  const input = new Float32Array(480).fill(0.5), output = resamplePcm16(input, 48000);
  assert.equal(output.length, 160);
  assert.ok(output.every((sample) => sample > 0));
});

test("Live connection diagnostics retain the WebSocket close code and end in fallback", async (t) => {
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
  assert.deepEqual(failures, ["Gemini Live cerró la conexión (código 1008); continúo con el circuito anterior."]);
  assert.equal(notices.at(-1), failures[0]);
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
  assert.deepEqual(failures, ["Gemini Live no respondió al handshake dentro del plazo (WebSocket OPEN); continúo con el circuito anterior."]);
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
  const turns = [], reports = [];
  const live = new GeminiLiveSession({
    conversationId:'diagnostic-text', audioContext:{currentTime:0}, WebSocket:BinarySocket, completionGraceMs:5,
    request:async body => {
      if(body.operation==='token')return {token:'auth_tokens/test',sessionId:'text-only',expiresAt:new Date(Date.now()+60000).toISOString(),maxSessionSeconds:60};
      if(body.operation==='classify')return {route:'direct',direct:true};
      if(body.operation==='usage'){reports.push(body);return {measurement:'provider-forwarded',shouldStop:false};}
      return {closed:true};
    },
    onTurnComplete:turn=>turns.push(turn),
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
  assert.equal(reports.length,2,'unfinished paid turns must be reported before releasing the reservation');
  assert.equal(reports[1].usageMetadata,null,'unfinished usage stays unconfirmed instead of becoming a zero-cost success');
});

test("silent generation without turnComplete finalizes once for fallback and retires the socket", async (t) => {
  let socket;
  class Socket {
    static OPEN=1;
    constructor(){socket=this;this.readyState=0;}
    send(){}
    close(){this.readyState=3;}
    receive(event){this.onmessage({data:JSON.stringify(event)});}
  }
  const turns=[],failures=[],operations=[];
  const live=new GeminiLiveSession({conversationId:'silent-provider',audioContext:{currentTime:0},WebSocket:Socket,completionGraceMs:5,
    request:async body=>{operations.push(body.operation);if(body.operation==='token')return {token:'auth_tokens/silent',sessionId:'silent',expiresAt:new Date(Date.now()+60000).toISOString(),maxSessionSeconds:60};if(body.operation==='classify')return {direct:true,route:'direct'};return {shouldStop:false};},
    onTurnComplete:turn=>turns.push(turn),onUnavailable:error=>failures.push(error.message),
  });
  t.after(()=>live.close());
  const started=live.start(null,{textInputOnly:true});await new Promise(resolve=>setImmediate(resolve));
  socket.readyState=1;socket.onopen();socket.receive({setupComplete:{}});await started;
  live.sendText('Hola');
  socket.receive({serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:'AAA='}}]},outputTranscription:{text:'Hola, ¿cómo estás?'}}});
  socket.receive({serverContent:{generationComplete:true}});
  await new Promise(resolve=>setTimeout(resolve,30));
  await live.stopping;
  assert.equal(turns.length,1);
  assert.equal(turns[0].noAudio,true);
  assert.equal(turns[0].providerIncomplete,true);
  assert.equal(turns[0].assistantText,'Hola, ¿cómo estás?');
  assert.equal(live.failed,true);
  assert.match(failures[0],/sin cerrar el turno/);
  assert.equal(operations.filter(op=>op==='usage').length,1);
  assert.equal(operations.at(-1),'close');
  socket.receive({serverContent:{turnComplete:true}});
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
      if (payload.operation === "classify") return { route: "direct", direct: true };
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
  assert.equal(played, 0, "generated audio stays buffered until the backend classifies the request");
  assert.deepEqual(transcripts, [], "assistant text stays hidden until the backend classifies the request");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(played, 1, "authorized audio streams before the model turn completes");
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
  assert.ok(operations.includes("classify"));
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
      if (payload.operation === "classify") return { route: "delegate", direct: false };
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
  assert.ok(operations.includes("classify"));
  live.close();
});
