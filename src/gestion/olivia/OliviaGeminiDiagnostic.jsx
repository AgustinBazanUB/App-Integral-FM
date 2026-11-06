import { useEffect, useRef, useState } from "react";
import { GeminiLiveSession } from "./geminiLive.mjs";
import { oliviaClient } from "./service";

// Only mounted in the administrative developer panel of the isolated preview.
export default function OliviaGeminiDiagnostic({ conversationId, disabled, onActive, onDelegate, onDirect, onUsage }) {
  const session = useRef(null), context = useRef(null), timer = useRef(null), activeRow = useRef(null), callbacks = useRef({});
  callbacks.current = { onActive, onDelegate, onDirect, onUsage };
  const [status, setStatus] = useState("Desconectado"), [connected, setConnected] = useState(false), [working, setWorking] = useState(false);
  const [text, setText] = useState("Hola, Olivia"), [rows, setRows] = useState([]), [connectionMs, setConnectionMs] = useState(null);
  const [protocol, setProtocol] = useState([]);
  const update = (fields) => {
    const id = activeRow.current?.id;
    setRows(current => current.map(row => row.id === id ? { ...row, ...fields } : row));
  };
  const close = () => {
    clearTimeout(timer.current); session.current?.close(); session.current = null;
    void context.current?.close(); context.current = null;
    setConnected(false); setWorking(false); callbacks.current.onActive(false);
  };
  useEffect(() => () => close(), [conversationId]);
  const connect = async () => {
    if (session.current || disabled) return;
    setStatus("Conectando sin micrófono…"); setWorking(true); callbacks.current.onActive(true);
    const started = performance.now();
    try {
      context.current = new AudioContext(); await context.current.resume();
      const live = new GeminiLiveSession({
        request: payload => oliviaClient.hybridLive(payload), conversationId, audioContext: context.current,
        onProtocol: event => setProtocol(current => [...current.slice(-19), event]),
        onClassification: result => update({ route: result.route, classificationMs: result.durationMs }),
        onFirstAudio: at => update({ textToScheduledAudioMs: at - activeRow.current.started }),
        onTranscript: response => update({ response }),
        onTurnComplete: turn => {
          update({ response: turn.assistantText, delegated: turn.delegated, noAudio: turn.noAudio, providerIncomplete: turn.providerIncomplete, textToResultMs: performance.now() - activeRow.current.started });
          if (!turn.delegated) void callbacks.current.onDirect(turn).catch(error => setStatus(error.message));
        },
        onToolCall: (call, input) => callbacks.current.onDelegate(call, input),
        onUsage: usage => { update({ usage }); callbacks.current.onUsage(usage); if (session.current === live && !live.closed && !live.failed && !live.isPlaying) { clearTimeout(timer.current); setWorking(false); setStatus("Listo · entrada por texto"); } },
        onAudioComplete: () => { clearTimeout(timer.current); setWorking(false); setStatus("Listo · entrada por texto"); },
        onNotice: notice => setStatus(notice),
        onUnavailable: error => { update({ error: error.message }); close(); setStatus(error.message); },
      });
      session.current = live;
      await live.start(null, { textInputOnly: true });
      if (session.current !== live) return;
      setConnectionMs(performance.now() - started); setConnected(true); setWorking(false); setStatus("Listo · entrada por texto");
    } catch (error) { close(); setStatus(error.message); }
  };
  const send = () => {
    if (!connected || working || disabled || !text.trim() || rows.length >= 50) return;
    const row = { id: crypto.randomUUID(), input: text.trim(), started: performance.now(), inputMode: "diagnostic-text" };
    activeRow.current = row; setRows(current => [...current, row]); setWorking(true); setStatus("Procesando prueba…");
    try {
      session.current.sendText(row.input);
      timer.current = setTimeout(() => { update({ error: "Prueba detenida tras 60 segundos sin completar el turno." }); close(); setStatus("Tiempo de prueba agotado"); }, 60000);
    } catch (error) { update({ error: error.message }); setWorking(false); setStatus(error.message); }
  };
  return <section aria-label="Prueba Gemini sin micrófono" className="fm-olivia-developer">
    <h3>Prueba Gemini sin micrófono · solo preview</h3>
    <p>Entrada escrita y salida de audio real. No mide captura, reconocimiento ni latencia desde el fin del habla. Máximo 50 turnos; utiliza el presupuesto de Gemini.</p>
    <p role="status">{status}{connectionMs != null ? ` · conexión ${connectionMs.toFixed(0)} ms` : ""}</p>
    <button type="button" disabled={disabled || working || connected} onClick={connect}>Conectar prueba Gemini</button>{" "}
    <button type="button" disabled={!session.current} onClick={() => { close(); setStatus("Desconectado"); }}>Cerrar prueba Gemini</button>
    <label>Consulta de prueba Gemini<textarea aria-label="Consulta de prueba Gemini" value={text} maxLength={12000} onChange={event => setText(event.target.value)} disabled={working || disabled} /></label>
    <button type="button" disabled={!connected || working || disabled || !text.trim() || rows.length >= 50} onClick={send}>Enviar prueba Gemini</button>
    <details open><summary>Resultados de prueba Gemini ({rows.length})</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify({ evidence: "real-provider-text-input-not-microphone", connectionMs, audioContextState: context.current?.state, turns: rows.map(({ started, ...row }) => row), protocol }, null, 2)}</pre></details>
  </section>;
}
