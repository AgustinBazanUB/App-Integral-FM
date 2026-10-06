import { useEffect, useRef } from "react";
import { IconButton } from "../../design-system";
import { OLIVIA_VOICE_CONVERSATION_ENABLED } from "../../shared/oliviaVoiceAvailability.mjs";

export default function OliviaComposer({ textareaRef, draft, setDraft, sendMessage, recording, frame, stopRecording,
  startRecording, startVoice, stopVoice, voiceTrialAvailable, voiceMode, setVoiceMode, voiceActive, muted, toggleMute, sendingDisabled = false, disabled, busy, cancelRequest, attachments = [], addFiles, removeFile }) {
  const picker = useRef(null), camera = useRef(null), menu = useRef(null);
  const selectFiles = (event) => { addFiles(Array.from(event.target.files || [])); event.target.value = ""; if (menu.current) menu.current.open = false; textareaRef.current?.focus(); };
  useEffect(() => {
    const field = textareaRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(120, field.scrollHeight)}px`;
  }, [draft, recording, textareaRef]);
  const uploading = attachments.some((file) => file.status === "uploading");
  return <form className="fm-olivia-composer" onSubmit={(event) => { event.preventDefault(); sendMessage(); }}>
    {attachments.length ? <ul className="fm-olivia-attachments" aria-label="Adjuntos de este mensaje">{attachments.map((file) =>
      <li key={file.localId}>{file.preview ? <img src={file.preview} alt="" /> : null}<span><strong>{file.name}</strong><small>{file.type} · {file.status === "uploading" ? "Cargando…" : file.error || "Listo"}</small></span><button type="button" aria-label={`Quitar ${file.name}`} onClick={() => removeFile(file.localId)}>×</button></li>)}</ul> : null}
    <input ref={picker} type="file" multiple hidden accept=".pdf,.docx,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.webp" onChange={selectFiles} />
    <input ref={camera} type="file" hidden accept="image/jpeg,image/png,image/webp" capture="environment" onChange={selectFiles} />
    {recording ? <div className="fm-olivia-dictation" role="status">
      <span aria-label="Duración del dictado">{String(Math.floor(frame.seconds / 60)).padStart(2, "0")}:{String(frame.seconds % 60).padStart(2, "0")}</span>
      <div className="fm-olivia-waveform" aria-hidden="true">{frame.bars.map((level, index) => <i key={index} style={{ height: `${4 + level * 30}px` }} />)}</div>
      <IconButton label="Cancelar dictado" icon="X" onClick={() => stopRecording(true)} />
      <IconButton label="Terminar y transcribir para revisar" icon="Square" onClick={() => stopRecording()} />
      <IconButton label="Terminar, transcribir y enviar" icon="Send" onClick={() => stopRecording(false, true)} />
    </div> : <div className="fm-olivia-composer-bar">
      <details ref={menu} className="fm-olivia-attach-menu"><summary aria-label="Adjuntar archivos" aria-disabled={disabled || busy}>+</summary><div><button type="button" disabled={disabled || busy} onClick={() => picker.current?.click()}>Fotos o documentos</button><button type="button" disabled={disabled || busy} onClick={() => camera.current?.click()}>Cámara del dispositivo</button></div></details>
      <label className="sr-only" htmlFor="fm-olivia-message">Mensaje para Olivia</label>
      <textarea ref={textareaRef} id="fm-olivia-message" rows="1" maxLength={4000} value={draft} placeholder="Escribile a Olivia…" disabled={disabled} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendMessage(); } }} />
      <IconButton label={voiceActive ? muted ? "Activar micrófono" : "Silenciar micrófono" : "Dictar un mensaje"} icon={voiceActive && muted ? "MicOff" : "Mic"} aria-pressed={voiceActive ? muted : undefined} disabled={!voiceActive && (busy || disabled)} onClick={voiceActive ? toggleMute : startRecording} />
      <IconButton label={voiceActive ? "Finalizar conversación por voz" : "Conversar con Olivia por voz"} icon="AudioLines" aria-pressed={voiceActive} disabled={OLIVIA_VOICE_CONVERSATION_ENABLED && !voiceActive && (busy || disabled)} onClick={voiceActive ? stopVoice : startVoice} />
      {busy ? <IconButton label="Detener respuesta" icon="Square" onClick={cancelRequest} /> : <IconButton label="Enviar mensaje" icon="Send" disabled={disabled || sendingDisabled || uploading || (!draft.trim() && !attachments.some((file) => file.id))} onClick={sendMessage} />}
    </div>}
    <small>{recording ? "Escuchando. Podés cancelar, revisar el dictado o enviarlo directamente." : "Los cambios del negocio requieren confirmación en la tarjeta."}</small>
    {OLIVIA_VOICE_CONVERSATION_ENABLED && voiceTrialAvailable && !recording && !voiceActive ? <select className="fm-olivia-voice-mode" aria-label="Modo de conversación por voz" value={voiceMode} disabled={disabled || busy} onChange={(event) => setVoiceMode(event.target.value)}><option value="default">Voz actual</option><option value="realtime-mini">Voz económica · prueba</option></select> : null}
  </form>;
}
