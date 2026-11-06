import { GEMINI_LIVE_MODEL, geminiLiveRawSetup } from "../../shared/oliviaGeminiLive.mjs";

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
  constructor({ request, conversationId, audioContext, onState = () => {}, onPartial = () => {}, onTranscript = () => {}, onClassification = () => {}, onFirstAudio = () => {}, onAudioComplete = () => {}, onTurnComplete = () => {}, onToolCall = async () => "No pude completar la solicitud.", onUsage = () => {}, onNotice = () => {}, onUnavailable = () => {}, WebSocket = globalThis.WebSocket, now = () => performance.now(), clock = () => Date.now(), connectTimeoutMs = 12000 }) {
    Object.assign(this, { request, conversationId, audioContext, onState, onPartial, onTranscript, onClassification, onFirstAudio, onAudioComplete, onTurnComplete, onToolCall, onUsage, onNotice, onUnavailable, WebSocket, now, clock, connectTimeoutMs });
    this.closed = false; this.failed = false; this.handlesTurns = false; this.listening = false; this.isPlaying = false; this.turnIndex = 0; this.sources = new Set(); this.finalizingTurns = new Set(); this.currentTurn = this.createTurn();
  }

  createTurn() {
    return { pending: false, finalizing: false, completed: false, completeReceived: false, transcriptComplete: false, cancelled: false, inputText: "", interimText: "", outputText: "", publishedOutputText: "", usageMetadata: null, inputAudioSeconds: 0, outputAudioSeconds: 0, generatedAudio: false, heardAudio: false, pendingAudio: [], toolTurn: false, toolPending: false, awaitingToolResponse: false, outputAuthorized: false, classificationPromise: null, noTranscriptTimer: null };
  }

  async start(stream) {
    if (!this.WebSocket || !this.audioContext?.createScriptProcessor) throw new Error("Este navegador no admite el audio de Gemini Live.");
    this.stream = stream;
    this.tokenResult = await this.request({ operation: "token", conversationId: this.conversationId });
    if (!this.tokenResult?.token || !this.tokenResult?.sessionId) throw new Error("No se recibió un token efímero de Gemini Live.");
    this.sessionId = this.tokenResult.sessionId;
    this.tokenExpiresAt = Date.parse(this.tokenResult.expiresAt);
    this.connectTimer = setTimeout(() => {
      const socketState = ({ 0: "CONNECTING", 1: "OPEN", 2: "CLOSING", 3: "CLOSED" })[this.socket?.readyState] || "UNKNOWN";
      this.fail(new Error(`Gemini Live no respondió al handshake dentro del plazo (WebSocket ${socketState}); continúo con el circuito anterior.`));
    }, this.connectTimeoutMs);
    try { await this.openSocket(null); }
    catch (error) { this.fail(error); throw error; }
    if (this.closed || this.failed) throw new DOMException("Sesión cerrada", "AbortError");
    this.attachCapture(stream);
    this.handlesTurns = true;
    this.ready = true;
    this.sessionTimer = setTimeout(() => this.fail(new Error("La sesión híbrida llegó a su límite preventivo; continúo con el circuito anterior.")), this.tokenResult.maxSessionSeconds * 1000);
    this.onState("listening");
    return this;
  }

  openSocket(handle) {
    if (this.closed || this.failed) return Promise.reject(new DOMException("Sesión cerrada", "AbortError"));
    return new Promise((resolve, reject) => {
      const url = `${SOCKET_URL}?access_token=${encodeURIComponent(this.tokenResult.token)}`;
      let socket;
      try { socket = new this.WebSocket(url); } catch (error) { reject(error); return; }
      this.socket = socket;
      let settled = false;
      const failReady = (error) => { if (settled) return; settled = true; this.pendingReject = null; reject(error); };
      this.pendingReject = failReady;
      socket.onopen = () => {
        try { socket.send(JSON.stringify({ setup: geminiLiveRawSetup(GEMINI_LIVE_MODEL, handle) })); }
        catch (error) { failReady(error); }
      };
      socket.onmessage = ({ data }) => {
        let event; try { event = JSON.parse(data); } catch { return; }
        if (event.setupComplete) {
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
  }

  setListening(value) {
    if (this.closed || this.failed) return;
    const next = Boolean(value), wasListening = this.listening;
    if (next === this.listening) return;
    this.listening = next;
    if (!next && this.socket?.readyState === this.WebSocket.OPEN && this.ready) {
      try { this.socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); } catch { this.fail(new Error("No se pudo cerrar el tramo de audio de Gemini.")); }
    }
    if (next) {
      if (this.finalizingTurns.size) {
        for (const turn of this.finalizingTurns) { turn.cancelled = true; turn.pendingAudio = []; }
        this.ignoreOutputUntilInput = true;
      }
      const previous = this.currentTurn;
      if (previous.pending && !wasListening) {
        previous.cancelled = true; previous.pending = false; previous.pendingAudio = [];
        void this.reportUsage(previous, { includeProviderUsage: false });
        this.ignoreOutputUntilInput = true;
      }
      if (previous.pending || previous.finalizing || previous.completed) {
        if (previous.finalizing) { previous.cancelled = true; previous.pendingAudio = []; }
        this.currentTurn = this.createTurn();
      }
      const turn = this.currentTurn;
      turn.turnId = globalThis.crypto.randomUUID(); turn.turnIndex = ++this.turnIndex; turn.pending = true; turn.inputText = ""; turn.interimText = ""; turn.outputText = ""; turn.publishedOutputText = ""; turn.usageMetadata = null; turn.inputAudioSeconds = 0; turn.outputAudioSeconds = 0; turn.generatedAudio = false; turn.heardAudio = false; turn.pendingAudio = []; turn.toolTurn = false; turn.toolPending = false; turn.awaitingToolResponse = false; turn.outputAuthorized = false; turn.classificationPromise = null; turn.completeReceived = false; turn.transcriptComplete = false; turn.noTranscriptTimer = null;
    }
  }

  beginTurn() { this.setListening(true); }
  discardTurn() { this.setListening(false); this.interrupt(); }
  commit() { this.setListening(false); return Promise.resolve(null); }

  receive(event) {
    if (this.closed || this.failed) return;
    if (event.sessionResumptionUpdate?.resumable && event.sessionResumptionUpdate.newHandle) this.resumeHandle = event.sessionResumptionUpdate.newHandle;
    const turn = this.currentTurn, content = event.serverContent, interrupted = Boolean(content?.interrupted);
    if (interrupted) { this.stopPlayback(); this.onState("recording"); }
    const interimText = content?.interimInputTranscription?.text;
    if (interimText) { turn.interimText = String(interimText); this.onPartial(turn.interimText); }
    const inputText = content?.inputTranscription?.text;
    if (inputText) {
      turn.inputText = mergeTranscript(turn.inputText, inputText); turn.transcriptComplete = true; this.ignoreOutputUntilInput = false; this.onPartial(turn.inputText);
      void this.authorizeTurn(turn);
      clearTimeout(turn.noTranscriptTimer); turn.noTranscriptTimer = null;
    }
    const ignoreOutput = Boolean(this.ignoreOutputUntilInput);
    const outputText = content?.outputTranscription?.text;
    if (outputText && !ignoreOutput) { turn.outputText = mergeTranscript(turn.outputText, outputText); if (turn.outputAuthorized && turn.outputText !== turn.publishedOutputText) { this.onTranscript(turn.outputText); turn.publishedOutputText = turn.outputText; } }
    const parts = content?.modelTurn?.parts || [];
    if (!ignoreOutput) {
      if (turn.awaitingToolResponse && (parts.length || outputText)) turn.awaitingToolResponse = false;
      for (const part of parts) {
        if (part.text) { turn.outputText = mergeTranscript(turn.outputText, part.text); if (turn.outputAuthorized && turn.outputText !== turn.publishedOutputText) { this.onTranscript(turn.outputText); turn.publishedOutputText = turn.outputText; } }
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
    if (event.goAway && this.resumeHandle && !this.reconnecting) this.reconnect();
    if (content?.turnComplete && !interrupted && !ignoreOutput && !turn.toolPending && !turn.awaitingToolResponse) {
      turn.completeReceived = true;
      if (turn.toolTurn || turn.transcriptComplete) void this.finishTurn(turn);
      else turn.noTranscriptTimer = setTimeout(() => { if (turn.completeReceived && !turn.transcriptComplete && !turn.toolTurn) void this.finishTurn(turn); }, 1200);
    }
  }

  authorizeTurn(turn) {
    if (!turn.inputText || turn.classificationPromise) return turn.classificationPromise;
    const classifyStartedAt = this.now();
    turn.classificationPromise = this.request({ operation: "classify", sessionId: this.sessionId, userText: turn.inputText })
      .then((authorization) => {
        turn.directAuthorized = authorization?.direct === true && authorization?.route === "direct" && !turn.toolTurn;
        this.onClassification({ durationMs: this.now() - classifyStartedAt, direct: turn.directAuthorized, route: turn.directAuthorized ? "direct" : turn.toolTurn ? "model-tool" : "backend-delegate", turnIndex: turn.turnIndex });
        if (turn.cancelled || this.closed || this.failed) return false;
        if (turn.directAuthorized) {
          turn.outputAuthorized = true;
          if (turn.outputText && turn.outputText !== turn.publishedOutputText) { this.onTranscript(turn.outputText); turn.publishedOutputText = turn.outputText; }
          this.flushPendingAudio(turn);
        } else turn.pendingAudio = [];
        return turn.directAuthorized;
      })
      .catch(() => {
        turn.directAuthorized = false;
        this.onClassification({ durationMs: this.now() - classifyStartedAt, direct: false, route: "backend-delegate", turnIndex: turn.turnIndex });
        turn.pendingAudio = [];
        return false;
      });
    return turn.classificationPromise;
  }

  async handleTools(calls, turn) {
    if (this.closed || this.failed || turn.cancelled) return;
    turn.toolTurn = true; this.listening = false; turn.outputAuthorized = false; turn.outputText = ""; turn.publishedOutputText = ""; turn.pendingAudio = []; this.stopPlayback(); this.onState("processing");
    const functionResponses = [];
    for (const call of calls) {
      if (call.name !== "delegate_to_olivia") {
        functionResponses.push({ id: call.id, name: call.name, response: { error: "Herramienta no autorizada." } });
        continue;
      }
      try {
        const result = await this.onToolCall(call, turn.inputText);
        functionResponses.push({ id: call.id, name: call.name, response: { result: String(result || "Olivia no devolvió una respuesta.").slice(0, 12000) } });
      } catch (error) {
        functionResponses.push({ id: call.id, name: call.name, response: { error: String(error?.message || "La consulta delegada falló.").slice(0, 800) } });
      }
    }
    if (turn.cancelled) return;
    if (this.socket?.readyState === this.WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ toolResponse: { functionResponses } }));
      turn.toolPending = false; turn.awaitingToolResponse = true; turn.outputAuthorized = true;
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
    if (turn.outputAuthorized) this.scheduleAudio(audio, turn);
    else turn.pendingAudio.push(audio);
  }

  scheduleAudio(audio, turn) {
    if (turn.cancelled || this.closed || this.failed) return;
    const source = this.audioContext.createBufferSource(); source.buffer = audio; source.connect(this.audioContext.destination);
    const at = Math.max(this.nextAudioAt || this.audioContext.currentTime + 0.035, this.audioContext.currentTime + 0.005);
    source.start(at); this.nextAudioAt = at + audio.duration; this.sources.add(source); turn.heardAudio = true; this.isPlaying = true;
    if (!this.firstAudioAt) { this.firstAudioAt = this.now() + Math.max(0, at - this.audioContext.currentTime) * 1000; this.onFirstAudio(this.firstAudioAt, { turnIndex: turn.turnIndex }); }
    source.onended = () => { this.sources.delete(source); source.disconnect?.(); if (!this.sources.size) this.isPlaying = false; };
    this.onState("speaking");
  }

  flushPendingAudio(turn) {
    turn.outputAuthorized = true;
    const pending = turn.pendingAudio.splice(0);
    for (const audio of pending) this.scheduleAudio(audio, turn);
  }

  interrupt() {
    for (const turn of this.finalizingTurns) { turn.cancelled = true; turn.pendingAudio = []; }
    if (this.currentTurn) {
      this.currentTurn.pendingAudio = [];
      if (!this.listening && this.currentTurn.pending) { this.currentTurn.cancelled = true; this.currentTurn.pending = false; }
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
    try {
      const usage = await this.request(report); this.onUsage(usage);
      if (usage.shouldStop) this.fail(new Error("Se alcanzó el límite preventivo de esta sesión Gemini; continúo con el circuito anterior."));
    } catch { this.onUsage({ measurement: "unconfirmed", message: "No se pudo registrar el consumo de Gemini en el presupuesto mensual." }); }
  }

  async finishTurn(turn = this.currentTurn) {
    if (this.closed || this.failed || !turn.pending || turn.finalizing) return;
    clearTimeout(turn.noTranscriptTimer); turn.noTranscriptTimer = null;
    turn.pending = false; turn.completed = true; turn.finalizing = true; turn.turnId ||= globalThis.crypto.randomUUID(); turn.turnIndex ||= ++this.turnIndex;
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
            if (turn.outputText && turn.outputText !== turn.publishedOutputText) { this.onTranscript(turn.outputText); turn.publishedOutputText = turn.outputText; }
            this.flushPendingAudio(turn);
            if (turn.inputText && turn.outputText) Promise.resolve(this.onTurnComplete({ turnId: turn.turnId, turnIndex: turn.turnIndex, userText: turn.inputText, assistantText: turn.outputText, delegated: false, noAudio: !turn.heardAudio, usageMetadata: turn.usageMetadata })).catch((error) => this.onNotice(error?.message || "No se pudo guardar la conversación de voz."));
            else if (turn.generatedAudio) this.onNotice("Gemini Live devolvió una respuesta sin transcripción completa; la marqué para revisión en el panel Developer.");
          } else if (!turn.cancelled && !this.closed && !this.failed && turn.inputText) {
            turn.pendingAudio = []; turn.outputAuthorized = false; this.onState("processing");
            let assistantText;
            try { assistantText = await this.onToolCall({ name: "delegate_to_olivia", args: { request: turn.inputText } }, turn.inputText); }
            catch (error) { assistantText = error?.message || "No pude validar la respuesta. Repetí la consulta para que Olivia pueda revisarla."; }
            if (!turn.cancelled && !this.closed && !this.failed) {
              turn.outputText = String(assistantText || "").trim();
              if (turn.outputText && turn.outputText !== turn.publishedOutputText) { this.onTranscript(turn.outputText); turn.publishedOutputText = turn.outputText; }
              Promise.resolve(this.onTurnComplete({ turnId: turn.turnId, turnIndex: turn.turnIndex, userText: turn.inputText, assistantText: turn.outputText, delegated: true, noAudio: true, usageMetadata: turn.usageMetadata })).catch((error) => this.onNotice(error?.message || "No se pudo registrar el turno delegado."));
            }
          } else {
            turn.pendingAudio = [];
            if (!turn.cancelled && !turn.inputText && turn.generatedAudio) this.onNotice("No recibí una transcripción final de Gemini; no reproduje la respuesta. Volvé a decirlo para continuar.");
          }
        } else {
          if (turn.outputText && turn.outputText !== turn.publishedOutputText) { this.onTranscript(turn.outputText); turn.publishedOutputText = turn.outputText; }
          this.flushPendingAudio(turn);
          Promise.resolve(this.onTurnComplete({ turnId: turn.turnId, turnIndex: turn.turnIndex, userText: turn.inputText, assistantText: turn.outputText, delegated: true, noAudio: !turn.heardAudio, usageMetadata: turn.usageMetadata })).catch((error) => this.onNotice(error?.message || "No se pudo registrar el turno delegado."));
        }
      }

      await this.reportUsage(turn, { includeProviderUsage: turn.completed });
      const waitMs = Math.max(0, ((this.nextAudioAt || 0) - (this.audioContext?.currentTime || 0)) * 1000);
      setTimeout(() => { if (!this.closed && !this.failed && !this.isPlaying) this.onState(this.listening ? "recording" : "listening"); if (turn.heardAudio && !turn.cancelled && !this.closed) this.onAudioComplete(this.now()); }, waitMs);
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
    if (this.sessionId) void this.request({ operation: "close", sessionId: this.sessionId }).catch(() => {});
    this.onNotice(error.message || "Gemini Live no está disponible; sigo con el circuito anterior."); this.onUnavailable(error);
  }

  stopCapture() {
    this.processor?.disconnect(); this.captureSource?.disconnect(); this.zeroGain?.disconnect();
    if (this.processor) this.processor.onaudioprocess = null;
    this.processor = null; this.captureSource = null; this.zeroGain = null;
  }

  close() {
    if (this.closed) return;
    this.closed = true; this.handlesTurns = false; this.ready = false; this.listening = false; clearTimeout(this.connectTimer); clearTimeout(this.sessionTimer); clearTimeout(this.socketErrorTimer); this.interrupt();
    this.pendingReject?.(new DOMException("Sesión cerrada", "AbortError")); this.pendingReject = null;
    try { this.socket?.close(1000, "Olivia session closed"); } catch {}
    this.stopCapture();
    if (this.sessionId) void this.request({ operation: "close", sessionId: this.sessionId }).catch(() => {});
  }
}
