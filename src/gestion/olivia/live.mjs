import { OliviaRealtime } from "./realtime.mjs";

/** GPT-Live media client. Delegation and results belong to the trusted sideband,
 * never the data channel. Backend state remains the canonical chat. */
export class OliviaLive extends OliviaRealtime {
  constructor(options) { super(options); this.onRefresh = options.onRefresh || (() => {}); this.interruptSession = options.interruptSession || (() => {}); }
  async connect() {
    this.onState("connecting");
    try {
      if (!this.mediaDevices?.getUserMedia || !this.PeerConnection) throw new Error("Este navegador no admite conversación por voz.");
      const stream = await this.mediaDevices.getUserMedia({ audio: true });
      if (this.closed) { stream.getTracks().forEach((track) => track.stop()); return; }
      this.stream = stream;
      this.pc = new this.PeerConnection();
      this.audio = this.createAudio(); this.audio.autoplay = true;
      this.pc.ontrack = (event) => {
        this.audio.srcObject = event.streams?.[0] || this.createStream([event.track]);
        this.audio.play?.()?.catch?.(() => this.fail(new Error("El navegador bloqueó la reproducción. Volvé a iniciar la voz.")));
      };
      this.pc.onconnectionstatechange = () => {
        if (this.closed || this.closing) return;
        if (this.pc.connectionState === "connected") this.onState("listening");
        if (["failed", "disconnected", "closed"].includes(this.pc.connectionState)) this.fail(new Error("Se interrumpió la voz. Reconectá para continuar el mismo chat."));
      };
      stream.getTracks().forEach((track) => this.pc.addTrack(track, stream));
      this.channel = this.pc.createDataChannel("oai-events");
      this.channel.onmessage = (event) => { try { this.handleEvent(JSON.parse(event.data)); } catch { this.fail(new Error("No se pudo interpretar la respuesta de voz.")); } };
      this.channel.onerror = () => this.fail(new Error("Se interrumpió el canal de voz."));
      this.channel.onclose = () => { if (!this.closed) { this.finalization = "incomplete"; this.cleanup(); } };
      await this.pc.setLocalDescription(await this.pc.createOffer());
      await this.waitForIce();
      if (this.closed) return;
      this.session = await this.createSession(this.pc.localDescription.sdp, this.abort.signal);
      if (this.closed) { this.stopProvider(); return; }
      await this.pc.setRemoteDescription({ type: "answer", sdp: this.session.sdp });
      this.timer = this.setTimer(() => this.close(), Math.min(180, this.session.maxDurationSeconds || 180) * 1000);
      this.connectionTimer = this.setTimer(() => { if (!this.ready) this.fail(new Error("La conexión de voz tardó demasiado.")); }, 20000);
    } catch (error) { if (!this.closed) this.fail(error); }
  }
  waitForIce() {
    if (this.pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = this.setTimer(() => { this.pc?.removeEventListener("icegatheringstatechange", update); reject(new Error("No se pudo preparar la conexión de voz.")); }, 10000);
      const update = () => { if (this.pc?.iceGatheringState === "complete") { this.clearTimer(timeout); this.pc.removeEventListener("icegatheringstatechange", update); resolve(); } };
      this.pc.addEventListener("icegatheringstatechange", update);
      this.abort.signal.addEventListener("abort", () => { this.clearTimer(timeout); this.pc?.removeEventListener("icegatheringstatechange", update); resolve(); }, { once: true });
    });
  }
  send(event) {
    if (!this.closed && this.ready && this.channel?.readyState === "open") this.channel.send(JSON.stringify(event));
  }
  handleEvent(event) {
    if (this.closed) return;
    if (event.type === "session.started") { this.ready = true; this.onState("listening"); }
    if (["session.input_transcript.delta", "session.output_transcript.delta"].includes(event.type)) {
      const input = event.type === "session.input_transcript.delta";
      this.onCaption(String(event.delta || ""), this.captionKind === event.type);
      this.captionKind = event.type;
      if (!input && this.audio) this.audio.muted = false;
      this.onState(input ? "listening" : "speaking");
      this.clearTimer(this.refreshTimer);
      this.refreshTimer = this.setTimer(() => { if (!this.closed && !this.closing) Promise.resolve(this.onRefresh()).catch(() => {}); }, 1600);
    }
    if (event.type === "session.delegation.created") { this.onState("processing"); this.onCaption("Estoy revisando los datos…"); }
    if (event.type === "session.commentary.appended" || event.type === "session.thinking.appended") Promise.resolve(this.onRefresh()).catch((error) => this.onError(error));
    if (event.type === "session.closed") { this.finalization = "confirmed"; this.cleanup(); Promise.resolve(this.onRefresh()).catch(() => {}); }
    if (event.type === "error") this.onError(new Error("La voz no pudo completar la respuesta. Podés continuar en el chat."));
  }
  setMuted(muted) { super.setMuted(muted); this.send({ type: muted ? "session.input_audio.mute" : "session.input_audio.unmute", event_id: crypto.randomUUID() }); }
  interrupt() {
    if (this.audio) this.audio.muted = true;
    this.onCaption(""); this.onState("listening");
    if (this.session) Promise.resolve(this.interruptSession(this.session.realtimeSessionId)).catch((error) => this.onError(error));
  }
  // The monitor mirrors typed turns and confirmed actions from server records.
  shareTextTurn() {}
  speakResult() {}
  close() {
    if (this.closed || this.closing) return;
    this.closing = true;
    this.stream?.getTracks().forEach((track) => { track.enabled = false; });
    if (!this.ready) { this.finalization = "incomplete"; this.cleanup(); return; }
    this.send({ type: "session.close", event_id: crypto.randomUUID() });
    this.closeTimer = this.setTimer(() => { this.finalization = "incomplete"; this.cleanup(); }, 15000);
  }
  cleanup() { this.clearTimer(this.closeTimer); this.clearTimer(this.refreshTimer); super.close(); }
}
