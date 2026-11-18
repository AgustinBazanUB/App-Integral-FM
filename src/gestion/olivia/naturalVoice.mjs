import { endpointingWindow } from './endpointing.mjs';
const mimeChoice = (Recorder) => ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => Recorder.isTypeSupported(type));

export class NaturalVoiceConversation {
  constructor({ createTranscriber, adaptiveEndpointing = true, onTrace = () => {}, onPartial = () => {}, onNotice = () => {}, onTurn, onState = () => {}, onSpeechStart = () => {}, onFrame = () => {}, onError = () => {}, mediaDevices = globalThis.navigator?.mediaDevices, Recorder = globalThis.MediaRecorder, AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext, frame = (fn) => requestAnimationFrame(fn), cancelFrame = (id) => cancelAnimationFrame(id), now = () => performance.now(), silenceMs = 1900, maxSeconds = 60, maxBytes = 4 * 1024 * 1024 } = {}) {
    Object.assign(this, { onTurn, onState, onSpeechStart, onFrame, onError, mediaDevices, Recorder, AudioContext, frame, cancelFrame, now, silenceMs, maxSeconds, maxBytes });
    this.closed = false; this.muted = false; this.sources = new Set(); this.playGeneration = 0;
    Object.assign(this,{createTranscriber,onPartial,onNotice,adaptiveEndpointing,onTrace});
    this.captureController=new AbortController();
    this.deliveryQueue=Promise.resolve();
  }

  async start() {
    try {
      if (!this.mediaDevices?.getUserMedia || !this.Recorder || !this.AudioContext) throw new Error("Este navegador no admite conversación por voz. Podés dictar o escribir.");
      const startedAt = this.now();
      this.onTrace({ stage: "voice.capture.start", at: startedAt });
      const contextCreatedAt = this.now();
      this.onTrace({ stage: "audio.context.create.start", at: contextCreatedAt });
      this.context = new this.AudioContext();
      this.onTrace({ stage: "audio.context.create.end", at: this.now(), durationMs: this.now() - contextCreatedAt, status: "ok" });
      const resumeStartedAt = this.now();
      this.onTrace({ stage: "audio.context.resume.start", at: resumeStartedAt });
      const resumeContext = Promise.resolve(this.context.resume()).then(() => this.onTrace({ stage: "audio.context.resume.end", at: this.now(), durationMs: this.now() - resumeStartedAt, status: "ok" }));
      const microphoneStartedAt = this.now();
      this.onTrace({ stage: "microphone.request.start", at: microphoneStartedAt });
      const requestMicrophone = this.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        .then((stream) => { this.onTrace({ stage: "microphone.request.end", at: this.now(), durationMs: this.now() - microphoneStartedAt, status: "ok" }); if (this.closed) stream.getTracks().forEach((track) => track.stop()); return stream; })
        .catch((error) => { this.onTrace({ stage: "microphone.request.end", at: this.now(), durationMs: this.now() - microphoneStartedAt, status: "error" }); throw error; });
      const [, stream] = await Promise.all([resumeContext, requestMicrophone]);
      this.stream = stream;
      if (this.closed) return this.release();
      this.onTrace({ stage: "voice.mic.ready", at: this.now() });
      this.onMediaInterrupted = () => {
        if (this.closed) return;
        this.onError(new Error("El navegador interrumpió el micrófono o el audio. Volvé a conectar la voz para continuar."));
        this.close();
      };
      this.stream.getAudioTracks().forEach(track => track.addEventListener?.('ended', this.onMediaInterrupted));
      this.onContextState = () => { if (['suspended', 'interrupted', 'closed'].includes(this.context?.state)) this.onMediaInterrupted(); };
      this.context.addEventListener?.('statechange', this.onContextState);
      this.source = this.context.createMediaStreamSource(this.stream);
      this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 1024; this.source.connect(this.analyser);
      this.samples = new Float32Array(this.analyser.fftSize);
      if (this.createTranscriber) {
        const readyAt = this.now();
        this.transcriberReady = Promise.resolve().then(() => this.createTranscriber(this.stream, text => { if (text !== this.partial) this.partialChangedAt = this.now(); this.partial = text; this.onPartial(text); }, this.captureController.signal))
          .then(transcriber => {
            if (this.closed) { transcriber?.close(); return; }
            this.transcriber = transcriber;
            this.onTrace({ stage: transcriber?.handlesTurns ? "gemini.session.ready" : "transcription.session.ready", at: this.now(), startedAt: readyAt });
          });
        await this.transcriberReady;
      }
      if (this.closed) return;
      if (!this.transcriber?.handlesTurns) this.startRecorder();
      this.onTrace({ stage: "voice.capture.ready", at: this.now() });
      this.startedAt = this.now(); this.onState("listening"); this.loop();
    } catch (error) { this.onError(error); this.close(); }
  }

  loop = () => {
    if (this.closed) return;
    if(this.adaptiveEndpointing && this.transcriber?.renewalDue && !this.recordingTurn && !this.transcriber.pending?.length && !this.sources.size && !this.renewing)void this.renewTranscription();
    this.analyser?.getFloatTimeDomainData(this.samples);
    let sum = 0; for (const sample of this.samples) sum += sample * sample;
    const rms = Math.sqrt(sum / this.samples.length), level = Math.min(1, rms * 5), now = this.now();
    this.onFrame({ seconds: Math.floor((now - this.startedAt) / 1000), level: this.muted ? 0 : level, recording: this.recordingTurn });
    if(!this.audioClock)this.evaluateVoice(rms,now);
    this.animation = this.frame(this.loop);
  };

  processInputFrame({rms,at}) {
    if(this.closed || !this.transcriber?.handlesTurns || !this.transcriber.ready || !Number.isFinite(rms))return;
    if(!this.audioClock){this.audioClock=true;this.onTrace({stage:'voice.input.clock',at,mode:'audio-callback'});}
    this.evaluateVoice(rms,Number.isFinite(at)?at:this.now());
  }

  evaluateVoice(rms,now) {
    if (!this.muted) {
      if (!this.recordingTurn) {
        const playing=this.sources?.size>0 || Boolean(this.transcriber?.isPlaying);
        if(rms>0.025){
          if(!playing)this.beginTurn(now);
          else {
            // A measured 150 ms non-speech pulse stopped the full answer.
            // Validate a short sustained candidate before destroying playback;
            // the existing 200 ms input pre-roll retains this speech onset.
            this.bargeCandidate ||= {startedAt:now,lastAt:now};
            this.bargeCandidate.lastAt=now;
            if(now-this.bargeCandidate.startedAt>=160){this.bargeCandidate=null;this.beginTurn(now);}
          }
        } else if(this.bargeCandidate && now-this.bargeCandidate.lastAt>60){
          this.onTrace({stage:'voice.barge_in.rejected',at:now,durationMs:now-this.bargeCandidate.startedAt,kind:'short-energy-pulse'});
          this.bargeCandidate=null;
        }
        if(!playing)this.bargeCandidate=null;
      }
      if (this.recordingTurn) {
        if (rms > 0.016) {
          if (now - this.lastSpeechAt >= 350) this.pauseResumes++;
          this.lastSpeechAt = now;
        }
        const silence = endpointingWindow({partial:this.partial,stableMs:now-(this.partialChangedAt ?? now),pauseResumes:this.pauseResumes,legacySilenceMs:this.silenceMs,enabled:this.adaptiveEndpointing});
        this.endpointWindowMs=silence;
        if (now - this.recordingStartedAt >= this.maxSeconds * 1000 || (now - this.lastSpeechAt >= silence && now - this.recordingStartedAt >= 400)) this.finishTurn();
      }
    }
  }

  async renewTranscription() {
    const previous=this.transcriber;if(this.renewing || !previous?.renewalDue || this.closed)return;
    this.renewing=true;previous.renewalDue=false;
    previous.close();
    try {
      await previous.stopping;
      if(this.closed)return;
      const next=await this.createTranscriber(this.stream,text=>{if(text!==this.partial)this.partialChangedAt=this.now();this.partial=text;this.onPartial(text);},this.captureController.signal);
      if(this.closed){next.close();return;}
      this.transcriber=next;
    } catch {if(!this.closed){this.onNotice('Gemini Live se interrumpió. Volvé a conectar para continuar por voz.');this.close();}}
    finally {this.renewing=false;}
  }

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
      const wasTurn = this.recordingTurn, chunks = this.chunks || [], durationSeconds = wasTurn ? Math.max(0.1, (this.now() - this.recordingStartedAt) / 1000) : 0, actualType = recorder.mimeType || type || "audio/webm", discard = this.discardTurn, turnTranscriber = this.turnTranscriber, handledByLive = Boolean(this.turnLive && turnTranscriber?.handlesTurns && !turnTranscriber.failed);
      this.recorder = null; this.recordingTurn = false; this.finishing = false; this.chunks = []; this.bytes = 0; this.discardTurn = false;
      if (!this.closed) this.startRecorder();
      if (!wasTurn || discard || this.closed) { if(discard && !this.transcriber?.closed)this.transcriber?.discardTurn?.(); return; }
      const blob = new Blob(chunks, { type: actualType }); blob.durationSeconds = Math.min(this.maxSeconds, durationSeconds);
      const metadata={durationSeconds:blob.durationSeconds,endedAt:this.now(),voiceEndedAt:this.lastSpeechAt,turnId:this.turnId,endpointWindowMs:this.endpointWindowMs};
      this.onTrace({stage:'audio.commit',at:metadata.endedAt,turnId:this.turnId});
      this.onTrace({stage:'voice.turn.end',at:metadata.endedAt,voiceEndedAt:metadata.voiceEndedAt,turnId:this.turnId,endpointMs:metadata.endpointWindowMs});
      this.onState("processing");
      const ready=(async()=>{
        if(turnTranscriber && !turnTranscriber.closed) {
          try { metadata.transcript=await turnTranscriber.commit(metadata); }
          catch { if(!this.closed)this.onNotice('Recupero este turno con el audio grabado.'); }
        }
      })();
      const deliver=async()=>{
        await ready;
        if(!this.closed && !handledByLive)await this.onTurn?.(blob,metadata);
      };
      this.deliveryQueue=this.deliveryQueue.catch(()=>{}).then(deliver).catch(error=>this.onError(error));
    };
    recorder.start(200);
  }

  beginTurn(now) {
    try {
      if (!this.recorder && !this.transcriber?.handlesTurns) this.startRecorder();
      const preRoll = [...new Set([this.idleHeader, ...(this.idleRing || [])].filter(Boolean))];
      this.chunks = preRoll; this.bytes = preRoll.reduce((total, chunk) => total + chunk.size, 0); this.discardTurn = false; this.recordingTurn = true; this.recordingStartedAt = now; this.lastSpeechAt = now; this.pauseResumes = 0;
      this.partial='';
      this.partialChangedAt=now;this.turnId=globalThis.crypto.randomUUID();
      if(this.transcriber && !this.transcriber.closed) {try{this.transcriber.beginTurn(this.turnId);}catch{this.transcriber.close();}}
      clearTimeout(this.turnTimer); this.turnTimer = setTimeout(() => this.finishTurn(), this.maxSeconds * 1000);
      const bargeIn = this.sources?.size > 0 || Boolean(this.transcriber?.isPlaying);
      this.turnTranscriber = this.transcriber;
      this.turnLive = Boolean(this.turnTranscriber?.handlesTurns && this.turnTranscriber?.ready);
      if (bargeIn) { this.stopPlayback(); this.transcriber?.interrupt?.(); }
      this.onSpeechStart({ at: now, bargeIn, turnId:this.turnId }); this.onState("recording");
    } catch (error) { this.onError(error); }
  }

  finishTurn() {
    if (!this.recordingTurn || this.finishing) return;
    const liveSession = this.turnTranscriber;
    if (liveSession?.handlesTurns && liveSession?.ready) {
      this.finishing = true;
      clearTimeout(this.turnTimer);
      const endedAt = this.now(), metadata = { durationSeconds: Math.min(this.maxSeconds, Math.max(0.1, (endedAt - this.recordingStartedAt) / 1000)), endedAt, voiceEndedAt: this.lastSpeechAt, turnId: this.turnId, endpointWindowMs: this.endpointWindowMs };
      const discard = this.discardTurn;
      this.recordingTurn = false; this.discardTurn = false; this.finishing = false;
      if (discard) { liveSession.discardTurn?.(); return; }
      this.onTrace({ stage: "audio.commit", at: endedAt, turnId: this.turnId });
      this.onTrace({ stage: "voice.turn.end", at: endedAt, voiceEndedAt: metadata.voiceEndedAt, turnId: this.turnId, endpointMs: metadata.endpointWindowMs });
      // Native VAD may finish before the local silence window. A late local
      // endpoint must not overwrite an already settled response with thinking.
      this.onState(liveSession.currentTurn?.pending===false ? (liveSession.isPlaying ? "speaking" : "listening") : "processing");
      Promise.resolve(liveSession.commit(metadata)).catch(error => { if (!this.closed) this.onError(error); });
      return;
    }
    if (!this.recorder || this.recorder.state === "inactive") return;
    this.finishing = true;
    try { this.recorder.stop(); } catch (error) { this.recorder = null; this.finishing = false; this.recordingTurn = false; this.onError(error); if (!this.closed) this.startRecorder(); }
  }

  async play(response, { signal, onFirstPacket = () => {}, onFirstScheduled = () => {}, onComplete = () => {} } = {}) {
    this.stopPlayback();
    const generation = ++this.playGeneration, reader = response.body?.getReader();
    if (!reader) throw new Error("No se recibió audio de Olivia.");
    this.activeReader = reader;
    const gain=this.context?.createGain?.();
    if(gain){gain.connect(this.context.destination);this.playbackGain=gain;}
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
        const source = this.context.createBufferSource(); source.buffer = audio; source.connect(gain || this.context.destination); source.start(Math.max(nextAt, this.context.currentTime + 0.005));
        nextAt = Math.max(nextAt, this.context.currentTime + 0.005) + audio.duration; sources.add(source); source.onended = () => { sources.delete(source); source.disconnect?.(); };
        if (first) { first = false; onFirstPacket(this.now()); onFirstScheduled(this.now()+Math.max(0,nextAt-audio.duration-this.context.currentTime)*1000); }
      }
      if (oddByte !== null) throw new Error("El audio de Olivia llegó incompleto.");
      if (signal?.aborted || generation !== this.playGeneration) return;
      if (first) throw new Error("Olivia no devolvió audio. Podés reintentar la reproducción.");
      await new Promise((resolve) => { this.playbackDoneResolve = resolve; this.playbackTimer = setTimeout(resolve, Math.max(0, (nextAt - this.context.currentTime) * 1000)); });
      if (!this.closed && generation === this.playGeneration) onComplete(this.now());
    } catch (error) { if (generation === this.playGeneration) this.stopPlayback(); throw error;
    } finally { if (generation === this.playGeneration) { clearTimeout(this.playbackTimer); this.playbackDoneResolve = null; } if(gain){if(signal?.aborted || generation!==this.playGeneration)setTimeout(()=>gain.disconnect(),45);else gain.disconnect();if(this.playbackGain===gain)this.playbackGain=null;} signal?.removeEventListener("abort", abort); if (this.activeReader === reader) this.activeReader = null; try { reader.releaseLock(); } catch {} }
  }

  stopPlayback() {
    this.playGeneration++;
    clearTimeout(this.playbackTimer); this.playbackDoneResolve?.(); this.playbackDoneResolve = null;
    try { Promise.resolve(this.activeReader?.cancel()).catch(() => {}); } catch {}
    this.activeReader = null;
    const gain=this.playbackGain,fade=Boolean(gain?.gain?.linearRampToValueAtTime && this.context?.state==='running');
    if(fade){gain.gain.cancelScheduledValues(this.context.currentTime);gain.gain.setValueAtTime(gain.gain.value,this.context.currentTime);gain.gain.linearRampToValueAtTime(0,this.context.currentTime+.035);}
    for (const source of this.sources || []) { try { source.stop(fade?this.context.currentTime+.04:undefined); } catch {} }
    this.sources?.clear();
  }

  bargeIn() { this.stopPlayback(); this.onSpeechStart({ at: this.now(), bargeIn: true }); }
  setMuted(muted) { this.muted = Boolean(muted); this.stream?.getAudioTracks().forEach((track) => { track.enabled = !this.muted; }); if (this.muted) { this.transcriber?.discardTurn?.(); if (this.recordingTurn) { this.discardTurn = true; this.finishTurn(); } this.onState("muted"); } else if (!this.closed) this.onState("listening"); }

  close() {
    if (this.closed) return;
    this.closed = true; this.discardTurn = true; this.cancelFrame(this.animation); this.stopPlayback();
    this.transcriber?.close();
    this.captureController.abort();
    this.stream?.getAudioTracks().forEach(track => track.removeEventListener?.('ended', this.onMediaInterrupted));
    this.context?.removeEventListener?.('statechange', this.onContextState);
    clearTimeout(this.turnTimer);
    if (this.recorder?.state === "recording") { try { this.recorder.stop(); } catch {} }
    this.source?.disconnect(); this.analyser?.disconnect(); this.stream?.getTracks().forEach((track) => track.stop());
    this.context?.close()?.catch(() => {}); this.context = null; this.onState("ended");
  }

  release() { this.source?.disconnect(); this.analyser?.disconnect(); this.stream?.getTracks().forEach((track) => track.stop()); this.context?.close()?.catch(() => {}); }
}

export function latencyPercentile(samples, percentile) {
  const values = samples.filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return null;
  return values[Math.min(values.length - 1, Math.ceil(percentile * values.length) - 1)];
}
