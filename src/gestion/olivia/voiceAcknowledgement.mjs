export const VOICE_ACKNOWLEDGEMENT = "Dale, dame un momento para revisarlo.";

// Session-only PCM cache. One authenticated, metered synthesis; no LLM call.
export class VoiceAcknowledgement {
  constructor({ load, play, setTimer = (fn, ms) => globalThis.setTimeout(fn, ms), clearTimer = id => globalThis.clearTimeout(id), delayMs = 1100 }) {
    Object.assign(this, { load, play, setTimer, clearTimer, delayMs });
    this.generation = 0; this.preload = new AbortController();
  }
  warm() {
    if (!this.audio) this.audio = Promise.resolve().then(() => this.load(VOICE_ACKNOWLEDGEMENT, this.preload.signal)).then(async (response) => {
      const bytes = await response.arrayBuffer();
      return bytes.byteLength && bytes.byteLength <= 480000 ? bytes : null;
    }).catch(() => null);
    return this.audio;
  }
  start(isCurrent = () => true) {
    this.cancel();
    const generation = this.generation;
    this.timer = this.setTimer(async () => {
      const bytes = await this.warm();
      if (!bytes || generation !== this.generation || !isCurrent()) return;
      const controller = new AbortController(); this.playback = controller;
      try { await this.play(new Response(bytes.slice(0)), { signal: controller.signal, text: VOICE_ACKNOWLEDGEMENT }); }
      catch { /* A failed acknowledgement never fails or delays the answer. */ }
      finally { if (this.playback === controller) this.playback = null; }
    }, this.delayMs);
  }
  cancel() { this.generation++; this.clearTimer(this.timer); this.playback?.abort("acknowledgement-ended"); this.playback = null; }
  dispose() { this.cancel(); this.preload.abort(); this.audio = null; }
}
