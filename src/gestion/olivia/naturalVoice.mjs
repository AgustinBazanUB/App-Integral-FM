const mimeChoice = (Recorder) => ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => Recorder.isTypeSupported(type));

export class NaturalVoiceConversation {
  constructor({ onTurn, onState = () => {}, onSpeechStart = () => {}, onFrame = () => {}, onError = () => {}, mediaDevices = globalThis.navigator?.mediaDevices, Recorder = globalThis.MediaRecorder, AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext, frame = (fn) => requestAnimationFrame(fn), cancelFrame = (id) => cancelAnimationFrame(id), now = () => performance.now(), silenceMs = 1900, maxSeconds = 60, maxBytes = 4 * 1024 * 1024 } = {}) {
    Object.assign(this, { onTurn, onState, onSpeechStart, onFrame, onError, mediaDevices, Recorder, AudioContext, frame, cancelFrame, now, silenceMs, maxSeconds, maxBytes });
    this.closed = false; this.muted = false; this.sources = new Set(); this.playGeneration = 0;
  }

  async start() {
    try {
      if (!this.mediaDevices?.getUserMedia || !this.Recorder || !this.AudioContext) throw new Error("Este navegador no admite conversación por voz. Podés dictar o escribir.");
      this.context = new this.AudioContext();
      await this.context.resume();
      this.stream = await this.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (this.closed) return this.release();
      this.source = this.context.createMediaStreamSource(this.stream);
      this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 1024; this.source.connect(this.analyser);
      this.samples = new Float32Array(this.analyser.fftSize);
      this.outputAnalyser = this.context.createAnalyser(); this.outputAnalyser.fftSize = 1024;
      this.outputAnalyser.connect(this.context.destination);
      this.outputSamples = new Float32Array(this.outputAnalyser.fftSize);
      this.startRecorder();
      this.startedAt = this.now(); this.onState("listening"); this.loop();
    } catch (error) { this.onError(error); this.close(); }
  }

  loop = () => {
    if (this.closed) return;
    this.analyser?.getFloatTimeDomainData(this.samples);
    let sum = 0; for (const sample of this.samples) sum += sample * sample;
    const rms = Math.sqrt(sum / this.samples.length), level = Math.min(1, rms * 5), now = this.now();
    this.outputAnalyser?.getFloatTimeDomainData(this.outputSamples);
    const outputLevel = Math.min(1, Math.sqrt(this.outputSamples.reduce((sum, sample) => sum + sample * sample, 0) / this.outputSamples.length) * 5);
    this.onFrame({ seconds: Math.floor((now - this.startedAt) / 1000), level: this.muted ? 0 : level, outputLevel, recording: this.recordingTurn });
    if (!this.muted) {
      if (!this.recordingTurn && rms > 0.025) this.beginTurn(now);
      if (this.recordingTurn) {
        if (rms > 0.016) {
          if (now - this.lastSpeechAt >= 350) this.pauseResumes++;
          this.lastSpeechAt = now;
        }
        const silence = Math.max(this.silenceMs, this.pauseResumes > 1 ? 4000 : this.pauseResumes ? 3000 : 1900);
        if (now - this.recordingStartedAt >= this.maxSeconds * 1000 || (now - this.lastSpeechAt >= silence && now - this.recordingStartedAt >= 400)) this.finishTurn();
      }
    }
    this.animation = this.frame(this.loop);
  };

  startRecorder() {
    if (this.closed || this.recorder) return;
    const type = mimeChoice(this.Recorder), recorder = new this.Recorder(this.stream, type ? { mimeType: type } : undefined);
    this.recorder = recorder; this.recordingTurn = false; this.idleHeader = null; this.idleRing = []; this.chunks = []; this.bytes = 0; this.discardTurn = false;
    recorder.ondataavailable = ({ data }) => {
      if (!data.size || this.closed) return;
      if (!this.recordingTurn) {
        this.idleHeader ||= data; this.idleRing.push(data); if (this.idleRing.length > 2) this.idleRing.shift();
        return;
      }
      this.bytes += data.size;
      if (this.bytes > this.maxBytes) { this.discardTurn = true; this.finishTurn(); this.onError(new Error("El mensaje de voz supera 4 MB. Probá con un mensaje más corto.")); }
      else if (!this.discardTurn) this.chunks.push(data);
    };
    recorder.onerror = () => { this.discardTurn = true; this.finishTurn(); this.onError(new Error("La grabación se interrumpió. Podés volver a hablar.")); };
    recorder.onstop = () => {
      clearTimeout(this.turnTimer);
      const wasTurn = this.recordingTurn, chunks = this.chunks || [], durationSeconds = wasTurn ? Math.max(0.1, (this.now() - this.recordingStartedAt) / 1000) : 0, actualType = recorder.mimeType || type || "audio/webm", discard = this.discardTurn;
      this.recorder = null; this.recordingTurn = false; this.finishing = false; this.chunks = []; this.bytes = 0; this.discardTurn = false;
      if (!this.closed) this.startRecorder();
      if (!wasTurn || discard || this.closed) return;
      const blob = new Blob(chunks, { type: actualType }); blob.durationSeconds = Math.min(this.maxSeconds, durationSeconds);
      this.onState("processing"); Promise.resolve(this.onTurn?.(blob, { durationSeconds: blob.durationSeconds, endedAt: this.now() })).catch((error) => this.onError(error));
    };
    recorder.start(200);
  }

  beginTurn(now) {
    try {
      if (!this.recorder) this.startRecorder();
      const preRoll = [...new Set([this.idleHeader, ...(this.idleRing || [])].filter(Boolean))];
      this.chunks = preRoll; this.bytes = preRoll.reduce((total, chunk) => total + chunk.size, 0); this.discardTurn = false; this.recordingTurn = true; this.recordingStartedAt = now; this.lastSpeechAt = now; this.pauseResumes = 0;
      clearTimeout(this.turnTimer); this.turnTimer = setTimeout(() => this.finishTurn(), this.maxSeconds * 1000);
      const bargeIn = this.sources?.size > 0;
      if (bargeIn) this.stopPlayback();
      this.onSpeechStart({ at: now, bargeIn }); this.onState("recording");
    } catch (error) { this.onError(error); }
  }

  finishTurn() {
    if (!this.recorder || !this.recordingTurn || this.finishing || this.recorder.state === "inactive") return;
    this.finishing = true;
    try { this.recorder.stop(); } catch (error) { this.recorder = null; this.finishing = false; this.recordingTurn = false; this.onError(error); if (!this.closed) this.startRecorder(); }
  }

  async play(response, { signal, onFirstScheduled = () => {}, onComplete = () => {} } = {}) {
    this.stopPlayback();
    const generation = ++this.playGeneration, reader = response.body?.getReader();
    if (!reader) throw new Error("No se recibió audio de Olivia.");
    this.activeReader = reader;
    const sources = this.sources; let nextAt = this.context.currentTime + 0.035, first = true, oddByte = null;
    const abort = () => { Promise.resolve(reader.cancel()).catch(() => {}); this.stopPlayback(); };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      while (!this.closed && !signal?.aborted && generation === this.playGeneration) {
        const { value, done } = await reader.read(); if (done) break;
        let bytes = value;
        if (oddByte !== null) { const combined = new Uint8Array(bytes.length + 1); combined[0] = oddByte; combined.set(bytes, 1); bytes = combined; oddByte = null; }
        if (bytes.length % 2) { oddByte = bytes[bytes.length - 1]; bytes = bytes.subarray(0, bytes.length - 1); }
        if (!bytes.length) continue;
        const samples = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        const audio = this.context.createBuffer(1, samples.length, 24000), channel = audio.getChannelData(0);
        for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
        const source = this.context.createBufferSource(); source.buffer = audio; source.connect(this.outputAnalyser); source.start(Math.max(nextAt, this.context.currentTime + 0.005));
        nextAt = Math.max(nextAt, this.context.currentTime + 0.005) + audio.duration; sources.add(source); source.onended = () => { sources.delete(source); source.disconnect?.(); };
        if (first) { first = false; onFirstScheduled(this.now()); }
      }
      if (oddByte !== null) throw new Error("El audio de Olivia llegó incompleto.");
      if (signal?.aborted || generation !== this.playGeneration) return;
      if (first) throw new Error("Olivia no devolvió audio. Podés reintentar la reproducción.");
      await new Promise((resolve) => { this.playbackDoneResolve = resolve; this.playbackTimer = setTimeout(resolve, Math.max(0, (nextAt - this.context.currentTime) * 1000)); });
      if (!this.closed && generation === this.playGeneration) onComplete(this.now());
    } catch (error) { if (generation === this.playGeneration) this.stopPlayback(); throw error;
    } finally { if (generation === this.playGeneration) { clearTimeout(this.playbackTimer); this.playbackDoneResolve = null; } signal?.removeEventListener("abort", abort); if (this.activeReader === reader) this.activeReader = null; try { reader.releaseLock(); } catch {} }
  }

  stopPlayback() {
    this.playGeneration++;
    clearTimeout(this.playbackTimer); this.playbackDoneResolve?.(); this.playbackDoneResolve = null;
    try { Promise.resolve(this.activeReader?.cancel()).catch(() => {}); } catch {}
    this.activeReader = null;
    for (const source of this.sources || []) { try { source.stop(); } catch {} }
    this.sources?.clear();
  }

  bargeIn() { this.stopPlayback(); this.onSpeechStart({ at: this.now(), bargeIn: true }); }
  setMuted(muted) { this.muted = Boolean(muted); this.stream?.getAudioTracks().forEach((track) => { track.enabled = !this.muted; }); if (this.muted) { if (this.recordingTurn) { this.discardTurn = true; this.finishTurn(); } this.onState("muted"); } else if (!this.closed) this.onState("listening"); }

  close() {
    if (this.closed) return;
    this.closed = true; this.discardTurn = true; this.cancelFrame(this.animation); this.stopPlayback();
    clearTimeout(this.turnTimer);
    if (this.recorder?.state === "recording") { try { this.recorder.stop(); } catch {} }
    this.source?.disconnect(); this.analyser?.disconnect(); this.stream?.getTracks().forEach((track) => track.stop());
    this.outputAnalyser?.disconnect(); this.context?.close()?.catch(() => {}); this.context = null; this.onState("ended");
  }

  release() { this.source?.disconnect(); this.analyser?.disconnect(); this.outputAnalyser?.disconnect(); this.stream?.getTracks().forEach((track) => track.stop()); this.context?.close()?.catch(() => {}); }
}

export function latencyPercentile(samples, percentile) {
  const values = samples.filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return null;
  return values[Math.min(values.length - 1, Math.ceil(percentile * values.length) - 1)];
}
