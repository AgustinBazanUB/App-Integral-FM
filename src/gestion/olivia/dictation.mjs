export const DICTATION_LIMITS = Object.freeze({ maxSeconds: 60, maxBytes: 4 * 1024 * 1024 });
export function audioBars(samples, count = 24) {
  const bars = [];
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * samples.length / count), end = Math.floor((i + 1) * samples.length / count);
    let sum = 0;
    for (let j = start; j < end; j++) sum += ((samples[j] - 128) / 128) ** 2;
    bars.push(Math.min(1, Math.sqrt(sum / Math.max(1, end - start)) * 3));
  }
  return bars;
}
export class DictationCapture {
  constructor({ onFrame = () => {}, onComplete, onError = () => {}, limits = DICTATION_LIMITS,
    mediaDevices = globalThis.navigator?.mediaDevices, Recorder = globalThis.MediaRecorder,
    AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext,
    frame = (fn) => requestAnimationFrame(fn), cancelFrame = (id) => cancelAnimationFrame(id) }) {
    Object.assign(this, { onFrame, onComplete, onError, limits, mediaDevices, Recorder, AudioContext, frame, cancelFrame });
    this.chunks = []; this.bytes = 0; this.discard = false; this.stopped = false;
  }
  async start() {
    try {
      if (!this.mediaDevices?.getUserMedia || !this.Recorder) throw new Error("Este navegador no admite dictado. Podés escribir o conversar por voz.");
      // Start AudioContext in the user gesture for Safari, before awaiting permission.
      if (this.AudioContext) { this.context = new this.AudioContext(); this.context.resume().catch(() => {}); }
      this.stream = await this.mediaDevices.getUserMedia({ audio: true });
      if (this.stopped) { this.release(); return; }
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((mime) => this.Recorder.isTypeSupported(mime));
      this.recorder = new this.Recorder(this.stream, mimeType ? { mimeType } : undefined);
      if (this.context) {
        this.source = this.context.createMediaStreamSource(this.stream);
        this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 512;
        this.source.connect(this.analyser);
      }
      this.startedAt = performance.now();
      const update = () => {
        if (this.stopped) return;
        const samples = new Uint8Array(512); samples.fill(128);
        this.analyser?.getByteTimeDomainData(samples);
        this.onFrame({ seconds: Math.floor((performance.now() - this.startedAt) / 1000), bars: audioBars(samples) });
        this.animation = this.frame(update);
      };
      this.recorder.ondataavailable = ({ data }) => {
        this.bytes += data.size;
        if (this.bytes > this.limits.maxBytes) { this.stop("cancel"); this.onError(new Error("El audio supera el tamaño permitido. Grabá un mensaje más corto.")); }
        else if (!this.discard && data.size) this.chunks.push(data);
      };
      this.recorder.onerror = () => { this.stop("cancel"); this.onError(new Error("La grabación se interrumpió. Podés reintentar.")); };
      this.recorder.onstop = () => {
        const audio = new Blob(this.chunks, { type: this.recorder.mimeType || "audio/webm" });
        this.chunks = []; this.release();
        if (!this.discard) this.onComplete(audio, this.action || "stop");
      };
      this.recorder.start(250); update();
      this.timer = setTimeout(() => this.stop("stop"), this.limits.maxSeconds * 1000);
    } catch (error) { this.stop("cancel"); this.onError(error); }
  }
  stop(action = "stop") {
    if (this.stopped) return;
    this.stopped = true; this.action = action; this.discard = action === "cancel";
    clearTimeout(this.timer);
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.release();
  }
  release() {
    this.cancelFrame(this.animation);
    this.source?.disconnect(); this.analyser?.disconnect(); this.source = null; this.analyser = null;
    this.context?.close()?.catch(() => {}); this.context = null;
    this.stream?.getTracks().forEach((track) => track.stop());
  }
}
