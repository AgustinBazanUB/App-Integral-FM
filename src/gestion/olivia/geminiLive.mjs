import { GEMINI_LIVE_MODEL, geminiLiveRawSetup } from "../../shared/oliviaGeminiLive.mjs";
import { classifyGeminiLiveTurn } from "../../shared/oliviaConversationRouter.mjs";

const SOCKET_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

export function resamplePcm16(input, sourceRate, targetRate = 16000) {
  if (!(input instanceof Float32Array) || !input.length || !Number.isFinite(sourceRate) || sourceRate < targetRate) return new Int16Array();
  const ratio = sourceRate / targetRate, length = Math.floor(input.length / ratio), output = new Int16Array(length);
  for (let index = 0; index < length; index++) {
    const source = index * ratio, left = Math.floor(source), fraction = source - left;
    const sample = (input[left] || 0) * (1 - fraction) + (input[Math.min(left + 1, input.length - 1)] || 0) * fraction;
    output[index] = Math.max(-32768, Math.min(32767, Math.round(Math.max(-1, Math.min(1, sample)) * 32767)));
  }
  return output;
}

function toBase64(samples) {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 4096) binary += String.fromCharCode(...bytes.subarray(offset, offset + 4096));
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value), bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function mergeTranscript(current, incoming) {
  const next = String(incoming || "").trim();
  if (!next) return current;
  if (!current || next.startsWith(current)) return next;
  if (current.startsWith(next) || current.endsWith(next)) return current;
  return `${current}${/\s$/.test(current) ? "" : " "}${next}`;
}

function errorMessage(event) {
  const message = String(event?.error?.message || event?.message || "");
  return message.slice(0, 240) || "Gemini Live interrumpió la sesión.";
}

export class GeminiLiveSession {
  constructor({ request, conversationId, audioContext, onState = () => {}, onPartial = () => {}, onTranscript = () => {}, onClassification = () => {}, onFirstAudio = () => {}, onAudioComplete = () => {}, onTurnComplete = () => {}, onToolCall = async () => "No pude completar la solicitud.", onUsage = () => {}, onNotice = () => {}, onUnavailable = () => {}, onProtocol = () => {}, onTrace = () => {}, onSessionClosed = () => {}, WebSocket = globalThis.WebSocket, now = () => performance.now(), clock = () => Date.now(), connectTimeoutMs = 12000, turnTimeoutMs = 45000, completionGraceMs = 5000, transcriptWaitMs = 3000 }) {
    Object.assign(this, { request, conversationId, audioContext, onState, onPartial, onTranscript, onClassification, onFirstAudio, onAudioComplete, onTurnComplete, onToolCall, onUsage, onNotice, onUnavailable, onProtocol, onTrace, onSessionClosed, WebSocket, now, clock, connectTimeoutMs, turnTimeoutMs, completionGraceMs, transcriptWaitMs });
    this.closed = false; this.failed = false; this.handlesTurns = false; this.listening = false; this.isPlaying = false; this.turnIndex = 0; this.sources = new Set(); this.finalizingTurns = new Set(); this.currentTurn = this.createTurn();
  }

  trace(stage, metadata = {}) { this.onTrace({ stage, at: this.now(), ...metadata }); }

  createTurn() {
    return { pending: false, finalizing: false, completed: false, completeReceived: false, transcriptComplete: false, transcriptWaiters: new Set(), cancelled: false, inputText: "", interimText: "", outputText: "", publishedOutputText: "", usageMetadata: null, inputAudioSeconds: 0, outputAudioSeconds: 0, generatedAudio: false, heardAudio: false, pendingAudio: [], toolTurn: false, toolPending: false, awaitingToolResponse: false, outputAuthorized: false, classificationPromise: null, noTranscriptTimer: null };
  }

  async start(stream, { textInputOnly = false } = {}) {
    if (!this.WebSocket || !this.audioContext || (!textInputOnly && !this.audioContext.createScriptProcessor)) throw new Error("Este navegador no admite el audio de Gemini Live.");
    this.textInputOnly = textInputOnly;
    this.stream = stream;
    const tokenStartedAt = this.now(); this.trace("gemini.token.request.start");
    try { this.tokenResult = await this.request({ operation: "token", conversationId: this.conversationId }); }
    catch (error) { this.trace("gemini.token.request.end", { durationMs: this.now() - tokenStartedAt, status: "error" }); throw error; }
    this.trace("gemini.token.request.end", { durationMs: this.now() - tokenStartedAt, status: "ok" });
    const serverTiming = this.tokenResult?.timings;
    if (serverTiming && typeof serverTiming === "object") this.trace("gemini.token.server", {
      configurationMs: serverTiming.configurationReadMs,
      conversationMs: serverTiming.conversationReadMs,
      reservationMs: serverTiming.reservationMs,
      providerMs: serverTiming.providerTokenMs,
    });
    if (!this.tokenResult?.token || !this.tokenResult?.sessionId) throw new Error("No se recibió un token efímero de Gemini Live.");
    this.sessionId = this.tokenResult.sessionId;
    if (this.closed) {
      const summary = await this.request({ operation: "close", sessionId: this.sessionId }).catch(() => null);
      if (summary) this.onSessionClosed(summary);
      throw new DOMException("Sesión cerrada", "AbortError");
    }
    this.tokenExpiresAt = Date.parse(this.tokenResult.expiresAt);
    this.connectTimer = setTimeout(() => {
      const socketState = ({ 0: "CONNECTING", 1: "OPEN", 2: "CLOSING", 3: "CLOSED" })[this.socket?.readyState] || "UNKNOWN";
      this.fail(new Error(`Gemini Live no respondió al handshake dentro del plazo (WebSocket ${socketState}); continúo con el circuito anterior.`));
    }, this.connectTimeoutMs);
    try { await this.openSocket(null); }
    catch (error) { this.fail(error); throw error; }
    if (this.closed || this.failed) throw new DOMException("Sesión cerrada", "AbortError");
    if (!textInputOnly) this.attachCapture(stream);
    this.handlesTurns = true;
    this.ready = true;
    this.sessionTimer = setTimeout(() => this.fail(new Error("La sesión híbrida llegó a su límite preventivo; continúo con el circuito anterior.")), this.tokenResult.maxSessionSeconds * 1000);
    this.onState("listening");
    return this;
  }

  openSocket(handle) {
    if (this.closed || this.failed) return Promise.reject(new DOMException("Sesión cerrada", "AbortError"));
    return new Promise((resolve, reject) => {
      const socketStartedAt = this.now();
      this.trace(handle ? "gemini.websocket.resume.start" : "gemini.websocket.start");
      const url = `${SOCKET_URL}?access_token=${encodeURIComponent(this.tokenResult.token)}`;
      let socket;
      try { socket = new this.WebSocket(url); } catch (error) { reject(error); return; }
      // Google can send JSON in binary frames. Chrome otherwise exposes a Blob,
      // which JSON.parse silently rejected, including the setupComplete event.
      socket.binaryType = "arraybuffer";
      this.socket = socket;
      let settled = false;
      const failReady = (error) => { if (settled) return; settled = true; this.pendingReject = null; reject(error); };
      this.pendingReject = failReady;
      socket.onopen = () => {
        this.trace(handle ? "gemini.websocket.resume.open" : "gemini.websocket.open", { durationMs: this.now() - socketStartedAt, status: "ok" });
        try { socket.send(JSON.stringify({ setup: geminiLiveRawSetup(GEMINI_LIVE_MODEL, handle) })); }
        catch (error) { failReady(error); }
      };
      socket.onmessage = ({ data }) => {
        let event; try { event = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data)); } catch { return; }
        this.onProtocol({ keys: Object.keys(event), contentKeys: Object.keys(event.serverContent || {}), parts: (event.serverContent?.modelTurn?.parts || []).map(part => ({ keys: Object.keys(part), mimeType: part.inlineData?.mimeType, encodedAudioLength: part.inlineData?.data?.length })), turnComplete: event.serverContent?.turnComplete, generationComplete: event.serverContent?.generationComplete });
        if (event.setupComplete) {
          this.trace(handle ? "gemini.setup.resume.complete" : "gemini.setup.complete", { durationMs: this.now() - socketStartedAt, status: "ok" });
          settled = true; this.pendingReject = null; clearTimeout(this.connectTimer); resolve(this);
          if (this.reconnecting) { this.reconnecting = false; this.listening = this.resumeListening; this.onState(this.listening ? "listening" : "processing"); }
        }
        if (event.error) {
          const error = new Error(errorMessage(event));
          this.fail(error);
          return;
        }
        this.receive(event);
      };
      socket.onerror = () => {
        clearTimeout(this.socketErrorTimer);
        this.socketErrorTimer = setTimeout(() => {
          if (!this.reconnecting) this.fail(new Error("Se interrumpió la conexión segura con Gemini Live."));
        }, 1000);
      };
      socket.onclose = (event) => {
        clearTimeout(this.socketErrorTimer);
        if (this.closed || this.failed) return;
        if (this.reconnecting) {
          const handleToResume = this.resumeHandle;
          this.resumeHandle = null;
          this.openSocket(handleToResume).catch((error) => this.fail(error));
        } else {
          const code = Number.isFinite(event?.code) ? ` (código ${event.code})` : "";
          this.fail(new Error(`Gemini Live cerró la conexión${code}; continúo con el circuito anterior.`));
        }
      };
      if (handle) this.reconnecting = true;
    });
  }

  attachCapture(stream) {
    const context = this.audioContext;
    this.captureSource = context.createMediaStreamSource(stream);
    this.processor = context.createScriptProcessor(1024, 1, 1);
    this.zeroGain = context.createGain(); this.zeroGain.gain.value = 0;
    this.processor.onaudioprocess = ({ inputBuffer }) => {
      if (!this.ready || !this.listening || this.closed || this.failed || this.socket?.readyState !== this.WebSocket.OPEN) return;
      const input = inputBuffer.getChannelData(0), samples = resamplePcm16(input, context.sampleRate, 16000);
      if (!samples.length) return;
      this.currentTurn.inputAudioSeconds += samples.length / 16000;
      this.socket.send(JSON.stringify({ realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: toBase64(samples) } } }));
    };
    this.captureSource.connect(this.processor); this.processor.connect(this.zeroGain); this.zeroGain.connect(context.destination);
    this.trace("gemini.capture.ready", { sampleRate: context.sampleRate });
  }

  setListening(value, turnId = null) {
    if (this.closed || this.failed) return;
    const next = Boolean(value), wasListening = this.listening;
    if (next === this.listening) return;
    this.listening = next;
    if (!next && this.socket?.readyState === this.WebSocket.OPEN && this.ready) {
      try { this.socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); } catch { this.fail(new Error("No se pudo cerrar el tramo de audio de Gemini.")); }
      if (this.currentTurn.pending) this.armTurnTimeout(this.currentTurn);
    }
    if (next) {
      if (this.finalizingTurns.size) {
        for (const turn of this.finalizingTurns) { turn.cancelled = true; turn.pendingAudio = []; }
        this.ignoreOutputUntilInput = true;
      }
      const previous = this.currentTurn, replacePrevious = previous.pending || previous.finalizing || previous.completed;
      if (previous.pending && !wasListening) {
        previous.cancelled = true; previous.pending = false; previous.pendingAudio = [];
        this.cancelTranscriptWaiters(previous);
        clearTimeout(previous.responseTimer); clearTimeout(previous.completionTimer); clearTimeout(previous.noTranscriptTimer);
        void this.reportUsage(previous, { includeProviderUsage: false });
        this.ignoreOutputUntilInput = true;
      }
      if (replacePrevious) {
        if (previous.finalizing) { previous.cancelled = true; previous.pendingAudio = []; }
        this.currentTurn = this.createTurn();
      }
      const turn = this.currentTurn;
      clearTimeout(turn.completionTimer); clearTimeout(turn.responseTimer);
      turn.turnId = turnId || globalThis.crypto.randomUUID(); turn.turnIndex = ++this.turnIndex; turn.pending = true; turn.inputText = ""; turn.interimText = ""; turn.outputText = ""; turn.publishedOutputText = ""; turn.usageMetadata = null; turn.inputAudioSeconds = 0; turn.outputAudioSeconds = 0; turn.generatedAudio = false; turn.heardAudio = false; turn.pendingAudio = []; turn.pendingAudioStartedAt = null; turn.firstPcmAt = null; turn.toolTurn = false; turn.toolPending = false; turn.awaitingToolResponse = false; turn.outputAuthorized = false; turn.classificationPromise = null; turn.classifiedText = ""; turn.completeReceived = false; turn.transcriptComplete = false; turn.transcriptWaiters = new Set(); turn.noTranscriptTimer = null;
      this.trace("gemini.turn.start", { turnId: turn.turnId, turnIndex: turn.turnIndex, mode: this.textInputOnly ? "diagnostic-text" : "microphone" });
    }
  }

  beginTurn(turnId) { this.setListening(true, turnId); }
  armTurnTimeout(turn) {
    clearTimeout(turn.responseTimer);
    turn.responseTimer = setTimeout(() => {
      if (this.closed || this.failed || !turn.pending || turn.cancelled) return;
      if (turn.toolPending) { this.armTurnTimeout(turn); return; }
      this.fail(new Error("Gemini no completó el turno dentro del plazo; la voz continúa con el circuito de respaldo."));
    }, this.turnTimeoutMs);
  }
  sendText(text) {
    if (!this.textInputOnly || !this.ready || this.closed || this.failed) throw new Error("La prueba de texto no está conectada.");
    if (this.currentTurn.pending || this.finalizingTurns.size || this.isPlaying) throw new Error("Esperá a que termine el turno actual.");
    const input = String(text || "").trim().slice(0, 12000);
    if (!input) throw new Error("Escribí una consulta de prueba.");
    this.beginTurn();
    this.listening = false;
    this.currentTurn.inputText = input;
    this.currentTurn.transcriptComplete = true;
    this.ignoreOutputUntilInput = false;
    void this.authorizeTurn(this.currentTurn);
    this.socket.send(JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text: input }] }], turnComplete: true } }));
    this.armTurnTimeout(this.currentTurn);
  }
  discardTurn() { this.setListening(false); this.interrupt(); }
  commit() { this.setListening(false); return Promise.resolve(null); }

  receive(event) {
    if (this.closed || this.failed) return;
    if (event.sessionResumptionUpdate?.resumable && event.sessionResumptionUpdate.newHandle) this.resumeHandle = event.sessionResumptionUpdate.newHandle;
    if (event.goAway && this.resumeHandle && !this.reconnecting) this.reconnect();
    const turn = this.currentTurn, content = event.serverContent, interrupted = Boolean(content?.interrupted);
    // Provider frames can arrive while a completed turn is being accounted for.
    // They must not create audio or a second billable turn on the idle placeholder.
    if (!turn.pending) return;
    if (interrupted) { this.stopPlayback(); this.onState("recording"); }
    const interimText = content?.interimInputTranscription?.text;
    if (interimText) { turn.interimText = String(interimText); this.onPartial(turn.interimText); }
    const inputText = content?.inputTranscription?.text;
    if (inputText) {
      const previousInput = turn.inputText;
      turn.inputText = mergeTranscript(turn.inputText, inputText); turn.transcriptComplete = true; this.ignoreOutputUntilInput = false; this.onPartial(turn.inputText);
      if (turn.inputText !== previousInput) this.trace("gemini.transcript.final", { turnId: turn.turnId, turnIndex: turn.turnIndex });
      void this.authorizeTurn(turn);
      this.resolveTranscriptWaiters(turn);
      clearTimeout(turn.noTranscriptTimer); turn.noTranscriptTimer = null;
    }
    const ignoreOutput = Boolean(this.ignoreOutputUntilInput);
    const outputText = content?.outputTranscription?.text;
    if (outputText && !ignoreOutput) { turn.outputText = mergeTranscript(turn.outputText, outputText); if (turn.outputAuthorized && turn.outputText !== turn.publishedOutputText) { this.publishTranscript(turn); } }
    const parts = content?.modelTurn?.parts || [];
    if (!ignoreOutput) {
      if (turn.awaitingToolResponse && (parts.length || outputText)) turn.awaitingToolResponse = false;
      for (const part of parts) {
        if (part.text) { turn.outputText = mergeTranscript(turn.outputText, part.text); if (turn.outputAuthorized && turn.outputText !== turn.publishedOutputText) { this.publishTranscript(turn); } }
        const audioData = part.inlineData?.data;
        if (audioData) this.playPcm(audioData, turn);
      }
    }
    if (event.usageMetadata && !ignoreOutput) turn.usageMetadata = event.usageMetadata;
    if (!ignoreOutput && event.toolCall?.functionCalls?.length && !turn.toolPending) {
      turn.toolPending = true;
      this.onClassification({ direct: false, route: "model-tool", turnIndex: turn.turnIndex });
      void this.handleTools(event.toolCall.functionCalls, turn);
    }
    if (content?.generationComplete && turn.pending && !interrupted && !ignoreOutput) {
      clearTimeout(turn.completionTimer);
      turn.completionTimer = setTimeout(() => {
        if (this.closed || this.failed || !turn.pending || turn.completeReceived || turn.toolPending || turn.awaitingToolResponse || turn.cancelled) return;
        // Generation ended but Google never closed its audio turn. Finalize the
        // validated text, request Chirp fallback and retire this broken socket.
        turn.providerIncomplete = true;
        this.stopPlayback();
        void this.finishTurn(turn).finally(() => this.fail(new Error("Gemini terminó la generación sin cerrar el turno de audio; continúo con el respaldo.")));
      }, Math.max(0, ((this.nextAudioAt || 0) - (this.audioContext?.currentTime || 0)) * 1000) + this.completionGraceMs);
    }
    if (content?.turnComplete && !interrupted && !ignoreOutput && !turn.toolPending && !turn.awaitingToolResponse) {
      turn.completeReceived = true;
      if (turn.toolTurn || turn.transcriptComplete) void this.finishTurn(turn);
      else turn.noTranscriptTimer = setTimeout(() => { if (turn.completeReceived && !turn.transcriptComplete && !turn.toolTurn) void this.finishTurn(turn); }, 1200);
    }
  }

  publishTranscript(turn) {
    if (!turn.outputText || turn.outputText === turn.publishedOutputText) return;
    if (!turn.publishedOutputText) this.trace("gemini.transcript.output.first", { turnId: turn.turnId, turnIndex: turn.turnIndex });
    this.onTranscript(turn.outputText, { turnId: turn.turnId, turnIndex: turn.turnIndex }); turn.publishedOutputText = turn.outputText;
  }

  resolveTranscriptWaiters(turn) {
    for (const waiter of turn.transcriptWaiters || []) {
      clearTimeout(waiter.timer);
      waiter.resolve(String(turn.inputText || "").trim() || null);
    }
    turn.transcriptWaiters?.clear();
  }

  cancelTranscriptWaiters(turn) {
    for (const waiter of turn.transcriptWaiters || []) {
      clearTimeout(waiter.timer);
      waiter.resolve(null);
    }
    turn.transcriptWaiters?.clear();
  }

  waitForFinalTranscript(turn) {
    if (turn.transcriptComplete) return Promise.resolve(String(turn.inputText || "").trim() || null);
    return new Promise((resolve) => {
      const waiter = { resolve, timer: null };
      waiter.timer = setTimeout(() => {
        turn.transcriptWaiters?.delete(waiter);
        this.trace("gemini.transcript.wait.timeout", { turnId: turn.turnId, turnIndex: turn.turnIndex, durationMs: this.transcriptWaitMs, status: "missing" });
        resolve(null);
      }, this.transcriptWaitMs);
      turn.transcriptWaiters.add(waiter);
    });
  }

  authorizeTurn(turn) {
    const userText = String(turn.inputText || "").trim();
    if (!userText || userText === turn.classifiedText) return turn.classificationPromise;
    const startedAt = this.now(), previousDirect = turn.directAuthorized === true;
    const decision = classifyGeminiLiveTurn(userText);
    turn.classifiedText = userText;
    turn.directAuthorized = decision.route === "direct" && !turn.toolTurn;
    turn.classificationPromise = Promise.resolve(turn.directAuthorized);
    this.onClassification({ durationMs: this.now() - startedAt, direct: turn.directAuthorized, route: turn.directAuthorized ? "local-direct" : turn.toolTurn ? "model-tool" : "local-policy-delegate", kind: decision.kind, source: "local-policy", turnIndex: turn.turnIndex });
    this.trace("gemini.classification.local", { turnId: turn.turnId, turnIndex: turn.turnIndex, route: turn.directAuthorized ? "direct" : turn.toolTurn ? "tool" : "delegate", kind: decision.kind });
    if (turn.cancelled || this.closed || this.failed) return turn.classificationPromise;
    if (turn.directAuthorized) {
      turn.outputAuthorized = true;
      if (turn.outputText && turn.outputText !== turn.publishedOutputText) this.publishTranscript(turn);
      this.flushPendingAudio(turn);
    } else {
      turn.outputAuthorized = false;
      turn.pendingAudio = [];
      if (previousDirect && turn.heardAudio) this.stopPlayback();
    }
    return turn.classificationPromise;
  }

  async handleTools(calls, turn) {
    if (this.closed || this.failed || turn.cancelled) return;
    turn.toolTurn = true; this.listening = false; turn.outputAuthorized = false; turn.outputText = ""; turn.publishedOutputText = ""; turn.pendingAudio = []; this.stopPlayback(); this.onState("processing");
    const functionResponses = [];
    const transcriptStartedAt = this.now();
    const finalTranscript = await this.waitForFinalTranscript(turn);
    this.trace("gemini.tool.transcript", { turnId: turn.turnId, turnIndex: turn.turnIndex, durationMs: this.now() - transcriptStartedAt, status: finalTranscript ? "ok" : "missing" });
    if (this.closed || this.failed || turn.cancelled) return;
    for (const call of calls) {
      if (call.name !== "delegate_to_olivia") {
        functionResponses.push({ id: call.id, name: call.name, response: { error: "Herramienta no autorizada." } });
        continue;
      }
      if (!finalTranscript) {
        functionResponses.push({ id: call.id, name: call.name, response: { error: "No se recibió la transcripción final del usuario; pedile que repita la solicitud." } });
        continue;
      }
      try {
        const result = await this.onToolCall(call, finalTranscript, { turnId: turn.turnId, turnIndex: turn.turnIndex, transcriptComplete: true });
        functionResponses.push({ id: call.id, name: call.name, response: { result: String(result || "Olivia no devolvió una respuesta.").slice(0, 12000) } });
      } catch (error) {
        functionResponses.push({ id: call.id, name: call.name, response: { error: String(error?.message || "La consulta delegada falló.").slice(0, 800) } });
      }
    }
    if (turn.cancelled) return;
    if (this.socket?.readyState === this.WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ toolResponse: { functionResponses } }));
      turn.toolPending = false; turn.awaitingToolResponse = true; turn.outputAuthorized = true;
      this.armTurnTimeout(turn);
    } else this.fail(new Error("La conexión de Gemini se cerró antes de responder a Olivia."));
  }

  playPcm(encoded, turn = this.currentTurn) {
    const bytes = fromBase64(encoded);
    if (bytes.length < 4 || bytes.length % 2) return;
    const samples = new Int16Array(bytes.length / 2), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < samples.length; index++) samples[index] = view.getInt16(index * 2, true);
    const audio = this.audioContext.createBuffer(1, samples.length, 24000), channel = audio.getChannelData(0);
    for (let index = 0; index < samples.length; index++) channel[index] = samples[index] / 32768;
    turn.outputAudioSeconds += audio.duration; turn.generatedAudio = true;
    if (!turn.firstPcmAt) { turn.firstPcmAt = this.now(); this.trace("gemini.audio.first_pcm", { turnId: turn.turnId, turnIndex: turn.turnIndex }); }
    if (turn.outputAuthorized) this.scheduleAudio(audio, turn);
    else { if (!turn.pendingAudioStartedAt) { turn.pendingAudioStartedAt = this.now(); this.trace("gemini.audio.held", { turnId: turn.turnId, turnIndex: turn.turnIndex }); } turn.pendingAudio.push(audio); }
  }

  scheduleAudio(audio, turn) {
    if (turn.cancelled || this.closed || this.failed) return;
    const source = this.audioContext.createBufferSource(); source.buffer = audio; source.connect(this.audioContext.destination);
    const at = Math.max(this.nextAudioAt || this.audioContext.currentTime + 0.035, this.audioContext.currentTime + 0.005);
    source.start(at); this.nextAudioAt = at + audio.duration; this.sources.add(source); turn.heardAudio = true; this.isPlaying = true;
    if (!this.firstAudioAt) { this.firstAudioAt = this.now() + Math.max(0, at - this.audioContext.currentTime) * 1000; this.trace("gemini.audio.first_scheduled", { turnId: turn.turnId, turnIndex: turn.turnIndex }); this.onFirstAudio(this.firstAudioAt, { turnId: turn.turnId, turnIndex: turn.turnIndex }); }
    source.onended = () => { this.sources.delete(source); source.disconnect?.(); if (!this.sources.size) this.isPlaying = false; };
    this.onState("speaking");
  }

  flushPendingAudio(turn) {
    turn.outputAuthorized = true;
    const pending = turn.pendingAudio.splice(0);
    if (pending.length) this.trace("gemini.audio.released", { turnId: turn.turnId, turnIndex: turn.turnIndex, count: pending.length, delayMs: turn.pendingAudioStartedAt == null ? 0 : this.now() - turn.pendingAudioStartedAt });
    for (const audio of pending) this.scheduleAudio(audio, turn);
  }

  interrupt() {
    for (const turn of this.finalizingTurns) { turn.cancelled = true; turn.pendingAudio = []; this.cancelTranscriptWaiters(turn); clearTimeout(turn.responseTimer); clearTimeout(turn.completionTimer); }
    if (this.currentTurn) {
      clearTimeout(this.currentTurn.responseTimer); clearTimeout(this.currentTurn.completionTimer);
      this.currentTurn.pendingAudio = [];
      if (!this.listening && this.currentTurn.pending) { this.currentTurn.cancelled = true; this.currentTurn.pending = false; this.cancelTranscriptWaiters(this.currentTurn); }
    }
    if (this.listening) this.ignoreOutputUntilInput = true;
    this.stopPlayback();
  }

  stopPlayback() {
    for (const source of this.sources) { try { source.stop(); } catch {} source.disconnect?.(); }
    this.sources.clear(); this.isPlaying = false; this.nextAudioAt = this.audioContext?.currentTime || 0; this.firstAudioAt = null;
  }

  async reportUsage(turn, { includeProviderUsage = true } = {}) {
    if (turn.usageReported || !this.sessionId) return;
    turn.usageReported = true;
    const report = { operation: "usage", sessionId: this.sessionId, turnId: turn.turnId || globalThis.crypto.randomUUID(), turnIndex: turn.turnIndex, usageMetadata: includeProviderUsage && (turn.completed || !turn.cancelled) ? turn.usageMetadata ? {
      promptTokensDetails: turn.usageMetadata.promptTokensDetails,
      toolUsePromptTokensDetails: turn.usageMetadata.toolUsePromptTokensDetails,
      responseTokensDetails: turn.usageMetadata.responseTokensDetails,
      totalTokenCount: turn.usageMetadata.totalTokenCount,
    } : null : null, inputAudioSeconds: turn.inputAudioSeconds, outputAudioSeconds: turn.outputAudioSeconds };
    const startedAt = this.now();
    try {
      const usage = await this.request(report); this.trace("gemini.usage.report", { turnId: turn.turnId, turnIndex: turn.turnIndex, durationMs: this.now() - startedAt, status: usage.measurement || "ok", costUsd: usage.costUsd }); this.onUsage(usage);
      if (usage.shouldStop) this.fail(new Error("Se alcanzó el límite preventivo de esta sesión Gemini; continúo con el circuito anterior."));
    } catch { this.onUsage({ measurement: "unconfirmed", message: "No se pudo registrar el consumo de Gemini en el presupuesto mensual." }); }
  }

  async finishTurn(turn = this.currentTurn) {
    if (this.closed || this.failed || !turn.pending || turn.finalizing) return;
    clearTimeout(turn.responseTimer); clearTimeout(turn.completionTimer);
    clearTimeout(turn.noTranscriptTimer); turn.noTranscriptTimer = null;
    turn.pending = false; turn.completed = true; turn.finalizing = true; turn.turnId ||= globalThis.crypto.randomUUID(); turn.turnIndex ||= ++this.turnIndex;
    this.trace("gemini.turn.complete", { turnId: turn.turnId, turnIndex: turn.turnIndex, route: turn.toolTurn ? "tool" : turn.directAuthorized ? "direct" : "delegate" });
    if (this.currentTurn === turn) this.currentTurn = this.createTurn();
    this.finalizingTurns.add(turn);
    try {
      if (!turn.cancelled && !this.closed && !this.failed) {
        if (!turn.toolTurn) {
          if (turn.inputText && !turn.classificationPromise) void this.authorizeTurn(turn);
          if (turn.classificationPromise) await turn.classificationPromise;
          const direct = turn.directAuthorized === true;
          if (!turn.cancelled && !this.closed && !this.failed && direct) {
            turn.outputAuthorized = true;
            if (turn.outputText && turn.outputText !== turn.publishedOutputText) this.publishTranscript(turn);
            this.flushPendingAudio(turn);
            if (turn.inputText && turn.outputText) Promise.resolve(this.onTurnComplete({ turnId: turn.turnId, turnIndex: turn.turnIndex, userText: turn.inputText, assistantText: turn.outputText, delegated: false, noAudio: !turn.heardAudio || Boolean(turn.providerIncomplete), providerIncomplete: Boolean(turn.providerIncomplete), usageMetadata: turn.usageMetadata })).catch((error) => this.onNotice(error?.message || "No se pudo guardar la conversación de voz."));
            else if (turn.generatedAudio) this.onNotice("Gemini Live devolvió una respuesta sin transcripción completa; la marqué para revisión en el panel Developer.");
          } else if (!turn.cancelled && !this.closed && !this.failed && turn.inputText) {
            turn.pendingAudio = []; turn.outputAuthorized = false; this.onState("processing");
            let assistantText;
            try { assistantText = await this.onToolCall({ name: "delegate_to_olivia", args: { request: turn.inputText } }, turn.inputText, { turnId: turn.turnId, turnIndex: turn.turnIndex, transcriptComplete: true }); }
            catch (error) { assistantText = error?.message || "No pude validar la respuesta. Repetí la consulta para que Olivia pueda revisarla."; }
            if (!turn.cancelled && !this.closed && !this.failed) {
              turn.outputText = String(assistantText || "").trim();
              if (turn.outputText && turn.outputText !== turn.publishedOutputText) this.publishTranscript(turn);
              Promise.resolve(this.onTurnComplete({ turnId: turn.turnId, turnIndex: turn.turnIndex, userText: turn.inputText, assistantText: turn.outputText, delegated: true, noAudio: true, usageMetadata: turn.usageMetadata })).catch((error) => this.onNotice(error?.message || "No se pudo registrar el turno delegado."));
            }
          } else {
            turn.pendingAudio = [];
            if (!turn.cancelled && !turn.inputText && turn.generatedAudio) this.onNotice("No recibí una transcripción final de Gemini; no reproduje la respuesta. Volvé a decirlo para continuar.");
          }
        } else {
          if (turn.outputText && turn.outputText !== turn.publishedOutputText) { this.onTranscript(turn.outputText); turn.publishedOutputText = turn.outputText; }
          this.flushPendingAudio(turn);
          Promise.resolve(this.onTurnComplete({ turnId: turn.turnId, turnIndex: turn.turnIndex, userText: turn.inputText, assistantText: turn.outputText, delegated: true, noAudio: !turn.heardAudio || Boolean(turn.providerIncomplete), providerIncomplete: Boolean(turn.providerIncomplete), usageMetadata: turn.usageMetadata })).catch((error) => this.onNotice(error?.message || "No se pudo registrar el turno delegado."));
        }
      }

      await this.reportUsage(turn, { includeProviderUsage: turn.completed });
      const waitMs = Math.max(0, ((this.nextAudioAt || 0) - (this.audioContext?.currentTime || 0)) * 1000);
      setTimeout(() => { if (!this.closed && !this.failed && !this.isPlaying) this.onState(this.listening ? "recording" : "listening"); if (turn.heardAudio && !turn.cancelled && !this.closed) this.onAudioComplete(this.now(), { turnId: turn.turnId, turnIndex: turn.turnIndex }); }, waitMs);
      this.onPartial(""); this.firstAudioAt = null;
    } finally { turn.finalizing = false; this.finalizingTurns.delete(turn); }
  }

  reconnect() {
    if (this.reconnecting || !this.resumeHandle || this.clock() >= this.tokenExpiresAt || this.closed) return;
    this.reconnecting = true; this.resumeListening = this.listening; this.listening = false;
    const current = this.socket;
    try { current?.close(1000, "resume session"); } catch { this.openSocket(this.resumeHandle).catch((error) => this.fail(error)); }
    setTimeout(() => { if (this.reconnecting && this.socket === current) this.openSocket(this.resumeHandle).catch((error) => this.fail(error)); }, 1200);
    this.onNotice("Reconectando una sesión Gemini Live…");
  }

  fail(error) {
    if (this.closed || this.failed) return;
    this.failed = true; this.handlesTurns = false; this.ready = false; this.listening = false; clearTimeout(this.connectTimer); clearTimeout(this.sessionTimer); clearTimeout(this.socketErrorTimer); this.interrupt();
    this.pendingReject?.(error); this.pendingReject = null;
    try { this.socket?.close(); } catch {}
    this.stopCapture();
    if (this.sessionId) void this.releaseBudget();
    this.onNotice(error.message || "Gemini Live no está disponible; sigo con el circuito anterior."); this.onUnavailable(error);
  }

  stopCapture() {
    this.processor?.disconnect(); this.captureSource?.disconnect(); this.zeroGain?.disconnect();
    if (this.processor) this.processor.onaudioprocess = null;
    this.processor = null; this.captureSource = null; this.zeroGain = null;
  }

  releaseBudget() {
    if (this.stopping || !this.sessionId) return this.stopping;
    const turns = [this.currentTurn, ...this.finalizingTurns];
    this.stopping = (async () => {
      for (const turn of turns) {
        if (turn.inputText || turn.inputAudioSeconds || turn.outputAudioSeconds || turn.usageMetadata) await this.reportUsage(turn, { includeProviderUsage: turn.completed });
      }
      const summary = await this.request({ operation: "close", sessionId: this.sessionId }).catch(() => null);
      if (summary) this.onSessionClosed(summary);
    })();
    return this.stopping;
  }

  close() {
    if (this.closed) return;
    this.closed = true; this.handlesTurns = false; this.ready = false; this.listening = false; clearTimeout(this.connectTimer); clearTimeout(this.sessionTimer); clearTimeout(this.socketErrorTimer); this.interrupt();
    this.pendingReject?.(new DOMException("Sesión cerrada", "AbortError")); this.pendingReject = null;
    try { this.socket?.close(1000, "Olivia session closed"); } catch {}
    this.stopCapture();
    if (this.sessionId) void this.releaseBudget();
  }
}
