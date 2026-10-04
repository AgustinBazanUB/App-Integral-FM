import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, IconButton, Modal } from "../../design-system";
import { useNavigate } from "../../router";
import { useAuth } from "../AuthContext";
import { canAccessAdministration } from "../permissions";
import { useOnlineStatus } from "../hooks";
import { formatDateTime } from "../formatters";
import { clearRuntimeCache } from "../services/runtimeCache";
import { conversationForUser, forgetConversation, operationLabel, pendingExpired, prependHistoryMessages, rememberConversation, requestId, safeNavigation } from "./client.mjs";
import { useOliviaContext, useOliviaVisibility } from "./ScreenContext";
import { oliviaClient } from "./service";
import { OliviaRealtime } from "./realtime.mjs";
import "./olivia.css";

function OliviaFace({ active }) {
  return <svg className={`fm-olivia-face ${active ? "is-active" : ""}`} viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r="30" fill="#eee7d3" />
    <path d="M13 34c-5-23 11-30 21-26 17-2 26 12 18 31l-10 5-25-4Z" fill="#3e4430" />
    <path d="M18 25c0-8 26-10 28 1v13c-4 18-25 15-28-1Z" fill="#e7b996" />
    <path d="M16 26c13-3 17-8 18-12 0 9 7 13 15 15l-1-13-28-5Z" fill="#3e4430" />
    <g className="fm-olivia-eyes" fill="#30251f"><circle cx="25" cy="32" r="1.7"/><circle cx="39" cy="32" r="1.7"/></g>
    <path d="M27 40q5 5 10 0" stroke="#8a4f45" strokeWidth="2" fill="none" strokeLinecap="round" />
    <path d="M15 58c1-9 9-12 17-12s16 3 17 12" fill="#708048" />
    <path d="M45 15q10-10 9 3-7 1-9-3Z" fill="#b58c3a"/>
  </svg>;
}

export default function OliviaAssistant() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const context = useOliviaContext();
  const { setAssistantOpen } = useOliviaVisibility();
  const contextRef = useRef(context);
  contextRef.current = context;
  const admin = canAccessAdministration(profile);
  const online = useOnlineStatus();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState({ messages: [], state: "information", pendingAction: null, usage: null });
  const [developer, setDeveloper] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(false);
  const [chats, setChats] = useState([]);
  const [chatsCursor, setChatsCursor] = useState(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [archived, setArchived] = useState([]);
  const [messagesCursor, setMessagesCursor] = useState(undefined);
  const [draftEstimate, setDraftEstimate] = useState(null);
  const historyRef = useRef(null);
  const estimateRef = useRef(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [recording, setRecording] = useState(false);
  const [voiceState, setVoiceState] = useState("idle");
  const [caption, setCaption] = useState("");
  const [now, setNow] = useState(Date.now());
  const [quotaRequestOpen, setQuotaRequestOpen] = useState(false);
  const [quotaRequested, setQuotaRequested] = useState(false);
  const [quotaNotice, setQuotaNotice] = useState("");
  const quotaRequestIdRef = useRef(null);
  const conversationRef = useRef(conversationForUser(user.uid));
  const mounted = useRef(true);
  const requestRef = useRef(null);
  const retryRef = useRef(null);
  const confirmationIds = useRef(new Map());
  const audioRef = useRef(null);
  const voiceRef = useRef(null);
  const launcherRef = useRef(null);
  const textareaRef = useRef(null);
  const messagesRef = useRef(null);
  const estimateContextRef = useRef("");
  const estimateContextKey = `${context.route}:${context.module}`;
  const exhausted = snapshot.usage?.remainingPercent === 0;
  const unavailable = snapshot.enabled === false || snapshot.providerConfigured === false || !online;
  const voiceActive = !["idle", "error", "ended"].includes(voiceState);
  const expired = pendingExpired(snapshot.pendingAction, now);

  useEffect(() => {
    setAssistantOpen(open);
    return () => setAssistantOpen(false);
  }, [open, setAssistantOpen]);

  const apply = useCallback((result) => {
    if (!mounted.current) return;
    if (result.conversationId) {
      conversationRef.current = result.conversationId;
      rememberConversation(user.uid, result.conversationId);
    }
    setSnapshot((current) => ({ ...current, ...result, messages: Array.isArray(result.messages) ? result.messages : current.messages,
      pendingAction: Object.hasOwn(result, "pendingAction") ? result.pendingAction : current.pendingAction }));
    const destination = safeNavigation(result.navigation?.path, window.location.origin);
    if (destination) navigate(destination);
    if (["completed", "COMPLETADA"].includes(typeof result.state === "string" ? result.state : result.state?.status)) {
      clearRuntimeCache();
      window.dispatchEvent(new CustomEvent("flor-mia:olivia-completed"));
    }
  }, [navigate, user.uid]);

  const perform = useCallback(async (operation, fields = {}, identity = requestId()) => {
    if (requestRef.current) throw new Error("Esperá a que termine la solicitud actual.");
    const controller = new AbortController();
    requestRef.current = controller;
    const payload = { operation, conversationId: conversationRef.current, requestId: identity, screenContext: contextRef.current, ...fields };
    retryRef.current = { operation, fields, identity };
    setBusy(true); setError(""); setErrorCode("");
    try {
      const result = await oliviaClient.request(payload, { signal: controller.signal });
      apply(result);
      retryRef.current = null;
      return result;
    } catch (failure) {
      if (mounted.current && failure.name !== "AbortError") { setError(failure.message); setErrorCode(failure.code || ""); }
      if (failure.code === "request-already-used") retryRef.current = { operation: "state", fields: {}, identity: requestId() };
      throw failure;
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (mounted.current) setBusy(false);
    }
  }, [apply]);

  const stopRecording = useCallback((discard = false) => {
    const current = audioRef.current;
    if (!current) return;
    current.discard = discard;
    clearTimeout(current.timer);
    if (!current.recorder) {
      current.discard = true;
      audioRef.current = null;
      if (mounted.current) setRecording(false);
      return;
    }
    if (current.recorder?.state === "recording") current.recorder.stop();
    current.stream?.getTracks().forEach((track) => track.stop());
    if (discard) { audioRef.current = null; if (mounted.current) setRecording(false); }
  }, []);

  const stopVoice = useCallback(() => {
    voiceRef.current?.close();
    voiceRef.current = null;
    if (mounted.current) { setVoiceState("idle"); setCaption(""); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestRef.current?.abort();
      historyRef.current?.abort();
      estimateRef.current?.abort();
      stopRecording(true);
      stopVoice();
    };
  }, [stopRecording, stopVoice]);

  useEffect(() => {
    if (!open) return undefined;
    textareaRef.current?.focus();
    if (!requestRef.current) { estimateContextRef.current = estimateContextKey; perform(conversationRef.current ? "resume" : "state").catch(() => {}); }
    const onKey = (event) => {
      if (event.key === "Escape") { stopRecording(true); stopVoice(); setOpen(false); launcherRef.current?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, perform, stopRecording, stopVoice]);

  useEffect(() => {
    setDeveloper(false);
    if (admin) { try { setDeveloper(localStorage.getItem(`flor-mia-olivia-dev:${user.uid}`) === "true"); } catch { /* Optional preference. */ } }
  }, [admin, user.uid]);

  useEffect(() => {
    if (!open || busy || !snapshot.conversationId || recording || voiceActive) return undefined;
    const controller = new AbortController();
    estimateRef.current = controller;
    setDraftEstimate(null);
    const timer = setTimeout(async () => {
      try {
        const result = await oliviaClient.request({ operation: "estimate", conversationId: snapshot.conversationId, screenContext: contextRef.current, message: draft }, { signal: controller.signal });
        if (!controller.signal.aborted && mounted.current) setDraftEstimate(result.estimate);
      } catch { /* The server snapshot remains a fallback; estimation never blocks a chat. */ }
    }, 600);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, busy, draft, snapshot.conversationId, snapshot.messages, estimateContextKey, recording, voiceActive]);

  const loadHistory = async (kind, more = false) => {
    if (historyRef.current || busy || recording || voiceActive) return;
    const controller = new AbortController(); historyRef.current = controller;
    setHistoryBusy(true); setHistoryError("");
    try {
      const result = await oliviaClient.request({ operation: "history", ...(kind === "messages" ? { conversationId: conversationRef.current, messagesCursor: messagesCursor || null } : { conversationsCursor: more ? chatsCursor : null }) }, { signal: controller.signal });
      if (!mounted.current || controller.signal.aborted) return;
      if (kind === "messages") {
        setArchived((current) => prependHistoryMessages(result.selectedConversation.messages, current));
        setMessagesCursor(result.selectedConversation.nextCursor);
      } else { setChats((current) => more ? [...current, ...result.conversations] : result.conversations); setChatsCursor(result.conversationsCursor); }
    } catch (failure) { if (mounted.current && failure.name !== "AbortError") setHistoryError(failure.message); }
    finally { if (historyRef.current === controller) historyRef.current = null; if (mounted.current) setHistoryBusy(false); }
  };

  const reopen = async (id) => {
    if (busy || recording || voiceActive || historyBusy) return;
    if (snapshot.pendingAction && id !== conversationRef.current) {
      try { await perform("cancel", { confirmationToken: snapshot.pendingAction.confirmationToken, actionId: snapshot.pendingAction.id }); } catch { return; }
    }
    try {
      await perform("resume", { conversationId: id });
      setArchived([]); setMessagesCursor(undefined); setDraft(""); setDraftEstimate(null); setChatsOpen(false);
    } catch { /* Keep the selected chat visible on failure. */ }
  };

  useEffect(() => {
    const onConfiguration = () => { if (open && !requestRef.current) perform("state").catch(() => {}); };
    window.addEventListener("flor-mia:olivia-configuration-updated", onConfiguration);
    return () => window.removeEventListener("flor-mia:olivia-configuration-updated", onConfiguration);
  }, [open, perform]);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [snapshot.messages, busy, open]);

  useEffect(() => {
    voiceRef.current?.setMuted(Boolean(snapshot.pendingAction));
    if (!snapshot.pendingAction) return undefined;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [snapshot.pendingAction]);

  useEffect(() => {
    setQuotaRequested(false); setQuotaNotice(""); quotaRequestIdRef.current = null;
  }, [snapshot.usage?.period]);

  useEffect(() => {
    const disconnect = () => { stopRecording(true); stopVoice(); };
    window.addEventListener("offline", disconnect);
    window.addEventListener("pagehide", disconnect);
    return () => { window.removeEventListener("offline", disconnect); window.removeEventListener("pagehide", disconnect); };
  }, [stopRecording, stopVoice]);

  const sendMessage = async () => {
    const message = draft.trim();
    if (!message || busy || recording || voiceActive || exhausted || unavailable) return;
    try { await perform("chat", { message, inputMode: "text" }); setDraft(""); } catch { /* Error and retry use the original request ID. */ }
  };

  const newConversation = async () => {
    if (busy || recording || voiceActive) return;
    if (snapshot.pendingAction && !["conversation-not-found", "session-changed", "conversation-expired"].includes(errorCode)) {
      try { await perform("cancel", { confirmationToken: snapshot.pendingAction.confirmationToken, actionId: snapshot.pendingAction.id }); }
      catch { return; }
    }
    conversationRef.current = null;
    forgetConversation(user.uid);
    confirmationIds.current.clear();
    setSnapshot({ messages: [], state: "INFORMACION", pendingAction: null, usage: null });
    setDraft(""); setArchived([]); setMessagesCursor(undefined); setDraftEstimate(null); setChatsOpen(false);
    perform("state").catch(() => {});
  };

  const requestQuotaExtension = async () => {
    if (busy || !online || quotaRequested) return;
    quotaRequestIdRef.current ||= requestId();
    try {
      const result = await perform("requestQuotaExtension", { reason: "Cupo agotado" }, quotaRequestIdRef.current);
      if (result.requested) { setQuotaRequested(true); setQuotaNotice(result.message || "Tu solicitud quedó disponible para el Administrador."); setQuotaRequestOpen(false); }
    } catch { /* A request can be retried with the same identity. */ }
  };

  const answer = async (yes) => {
    const action = snapshot.pendingAction;
    if (!action || busy || (yes && (expired || exhausted || unavailable))) return;
    const operation = yes ? "confirm" : "cancel";
    const key = `${operation}:${action.id}:${action.confirmationToken}`;
    if (!confirmationIds.current.has(key)) confirmationIds.current.set(key, requestId());
    try {
      const result = await perform(operation, { actionId: action.id, confirmationToken: action.confirmationToken }, confirmationIds.current.get(key));
      voiceRef.current?.speakResult(result);
    } catch { /* Retries retain the same idempotency key. */ }
  };

  const startRecording = async () => {
    if (busy || audioRef.current || voiceActive || exhausted || unavailable || !conversationRef.current) return;
    const capture = { chunks: [], bytes: 0, discard: false };
    audioRef.current = capture;
    setRecording(true);
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("Este navegador no admite grabación. Podés escribir o usar otro navegador.");
      capture.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (audioRef.current !== capture || !mounted.current) { capture.stream.getTracks().forEach((track) => track.stop()); return; }
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((mime) => MediaRecorder.isTypeSupported(mime));
      capture.recorder = new MediaRecorder(capture.stream, type ? { mimeType: type } : undefined);
      capture.recorder.ondataavailable = (event) => {
        capture.bytes += event.data.size;
        if (capture.bytes > 4 * 1024 * 1024) { setError("El audio excedió 4 MB. Grabá un mensaje más corto."); stopRecording(true); return; }
        if (!capture.discard && event.data.size) capture.chunks.push(event.data);
      };
      capture.recorder.onerror = () => { stopRecording(true); if (mounted.current) setError("La grabación se interrumpió. Podés reintentar o escribir."); };
      capture.recorder.onstop = async () => {
        clearTimeout(capture.timer);
        capture.stream.getTracks().forEach((track) => track.stop());
        if (audioRef.current === capture) audioRef.current = null;
        if (!mounted.current || capture.discard) return;
        setRecording(false);
        const controller = new AbortController();
        requestRef.current = controller;
        setBusy(true);
        try {
          const blob = new Blob(capture.chunks, { type: capture.recorder.mimeType || "audio/webm" });
          const result = await oliviaClient.transcribe(blob, { conversationId: conversationRef.current, requestId: requestId() }, { signal: controller.signal });
          if (!mounted.current) return;
          if (result.conversationId) { conversationRef.current = result.conversationId; rememberConversation(user.uid, result.conversationId); }
          setDraft(result.text || "");
          if (result.usage) setSnapshot((current) => ({ ...current, usage: result.usage }));
          if (!result.text?.trim()) setError("No se reconoció texto. Podés volver a grabar.");
          textareaRef.current?.focus();
        } catch (failure) { if (mounted.current && failure.name !== "AbortError") setError(failure.message); }
        finally { if (requestRef.current === controller) requestRef.current = null; if (mounted.current) setBusy(false); capture.chunks = []; }
      };
      capture.recorder.start(500);
      setRecording(true);
      capture.timer = setTimeout(() => stopRecording(), 60000);
    } catch (failure) {
      capture.stream?.getTracks().forEach((track) => track.stop());
      if (audioRef.current === capture) audioRef.current = null;
      if (mounted.current) { setRecording(false); setError(failure.name === "NotAllowedError" ? "Permití el micrófono en tu navegador para grabar. Podés continuar escribiendo." : failure.message); }
    }
  };

  const startVoice = () => {
    if (busy || recording || voiceRef.current || exhausted || unavailable || snapshot.pendingAction || !conversationRef.current) return;
    setError(""); setCaption("");
    const voiceConversationId = conversationRef.current;
    const connection = new OliviaRealtime({
      createSession: (sdp, signal) => oliviaClient.request({ operation: "realtime", sdp, conversationId: voiceConversationId, requestId: requestId(), screenContext: contextRef.current }, { signal }).then((result) => { apply(result); return result; }),
      stopSession: (realtimeSessionId) => oliviaClient.request({ operation: "stopRealtime", realtimeSessionId, conversationId: voiceConversationId, requestId: requestId() }, { keepalive: true }),
      onRequest: (message, realtimeSessionId) => perform("chat", { message, inputMode: "realtime", realtimeSessionId }),
      onState: (state) => { if (mounted.current) setVoiceState(state); },
      onError: (failure) => { if (voiceRef.current === connection) voiceRef.current = null; if (mounted.current) setError(failure.name === "NotAllowedError" ? "Permití el micrófono para conversar por voz." : failure.message); },
      onCaption: (text, append) => { if (mounted.current) setCaption((current) => append ? current + text : text); },
    });
    voiceRef.current = connection;
    connection.connect().then(() => { if (connection.closed && voiceRef.current === connection) voiceRef.current = null; });
  };

  const close = () => { stopRecording(true); stopVoice(); setOpen(false); launcherRef.current?.focus(); };
  const pending = snapshot.pendingAction;
  const label = recording ? "Escuchando dictado" : busy ? pending ? "Procesando solicitud" : "Procesando" : operationLabel(snapshot.state, pending);
  const quota = snapshot.usage;
  const estimate = draftEstimate || snapshot.estimate;
  const money = (value) => Number.isFinite(value) ? new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value) : "No disponible";
  const visibleMessages = prependHistoryMessages(archived, snapshot.messages);
  const toggleDeveloper = () => { const next = !developer; setDeveloper(next); try { localStorage.setItem(`flor-mia-olivia-dev:${user.uid}`, String(next)); } catch { /* Optional preference. */ } };

  return <>
    <button ref={launcherRef} type="button" className="fm-olivia-launcher" aria-label={open ? "Cerrar Olivia" : "Abrir Olivia, asistente de Flor Mía"} aria-expanded={open} aria-controls="fm-olivia-drawer" onClick={() => open ? close() : setOpen(true)}>
      <OliviaFace active={busy || recording || voiceActive} /><span>Olivia</span>
    </button>
    {open ? <aside id="fm-olivia-drawer" className="fm-olivia-drawer" role="dialog" aria-modal="false" aria-labelledby="fm-olivia-title">
      <header className="fm-olivia-header">
        <OliviaFace active={busy || recording || voiceActive}/><div><h2 id="fm-olivia-title">Olivia</h2><span>Asistente de Flor Mía</span></div>
        <IconButton label="Mis chats" icon="ScrollText" disabled={busy || recording || voiceActive || historyBusy} onClick={() => { setChatsOpen(!chatsOpen); if (!chatsOpen) loadHistory("chats"); }}/>
        <IconButton label="Nueva conversación" icon="Plus" disabled={busy || recording || voiceActive} onClick={newConversation}/>
        <IconButton label="Cerrar Olivia" icon="X" onClick={close}/>
      </header>
      <div className="fm-olivia-status" role="status"><Badge tone={pending ? "warning" : snapshot.state === "completed" ? "success" : "neutral"}>{label}</Badge><span>{context.module === "seller" ? "Panel Vendedor" : "Panel Administrador"}</span></div>
      {admin ? <div className="fm-olivia-mode"><label><input type="checkbox" checked={developer} onChange={toggleDeveloper}/> Modo desarrollador</label></div> : null}
      {chatsOpen ? <section className="fm-olivia-chats" aria-label="Mis chats"><h3>Mis chats</h3><p>Retomá una conversación o creá una nueva. El historial se guarda en tu cuenta durante el período de retención.</p>{chats.map((chat) => <button type="button" key={chat.id} disabled={busy || historyBusy} aria-current={chat.id === snapshot.conversationId ? "true" : undefined} onClick={() => reopen(chat.id)}><strong>{chat.title}</strong><small>{formatDateTime(chat.updatedAt)}</small></button>)}{!chats.length && !historyBusy ? <p>Todavía no hay chats guardados.</p> : null}{chatsCursor ? <Button variant="secondary" disabled={historyBusy} onClick={() => loadHistory("chats", true)}>Ver más chats</Button> : null}{historyBusy ? <p role="status">Cargando chats…</p> : null}</section> : null}
      {historyError ? <p className="fm-olivia-error" role="alert">{historyError}</p> : null}
      <div ref={messagesRef} className="fm-olivia-messages" role="log" aria-live="polite" aria-label="Conversación con Olivia">
        {snapshot.messages.length && messagesCursor !== null ? <Button variant="secondary" disabled={historyBusy || busy || recording || voiceActive} onClick={() => loadHistory("messages")}>Ver mensajes anteriores</Button> : null}
        {!snapshot.messages.length && !busy ? <div className="fm-olivia-welcome"><h3>Hola, soy Olivia.</h3><p>Te ayudo a consultar Flor Mía y preparar operaciones de tu panel. Los cambios siempre se confirman con Sí o No.</p><p>Podés escribir, dictar un mensaje o conversar por voz.</p></div> : null}
        {visibleMessages.filter((message) => ["user", "assistant"].includes(message.role)).map((message, index) => <article key={message.id || `${index}:${message.role}`} className={`fm-olivia-message fm-olivia-message--${message.role}`}><strong>{message.role === "user" ? "Vos" : "Olivia"}</strong><p>{String(message.content || "")}</p></article>)}
        {busy ? <p className="fm-olivia-working" role="status">Olivia está procesando tu solicitud…</p> : null}
      </div>
      {pending ? <section className="fm-olivia-confirmation" aria-labelledby="fm-olivia-confirm-title"><h3 id="fm-olivia-confirm-title">¿Confirmar esta acción?</h3><p>{typeof pending.summary === "string" ? pending.summary : JSON.stringify(pending.summary, null, 2)}</p>{expired ? <p role="alert">La confirmación venció. Pedile a Olivia que prepare la acción nuevamente.</p> : null}<div><Button onClick={() => answer(true)} disabled={busy || expired || exhausted || unavailable}>Sí</Button><Button variant="secondary" onClick={() => answer(false)} disabled={busy || !online}>No</Button></div><small>La acción se ejecuta únicamente al tocar Sí. Podés corregir los datos escribiendo.</small></section> : null}
      {unavailable ? <div className="fm-olivia-error" role="status"><p>{!online ? "Olivia necesita conexión a Internet." : snapshot.enabled === false ? "Olivia está deshabilitada por el Administrador." : "Olivia todavía necesita configurar su conexión con OpenAI."}</p><small>Podés continuar operando desde tu panel.</small>{admin && online ? <Button variant="secondary" onClick={() => navigate("/gestion/settings")}>Abrir configuración</Button> : null}</div> : null}
      {error ? <div className="fm-olivia-error" role="alert"><p>{error}</p>{["conversation-not-found", "session-changed", "conversation-expired"].includes(errorCode) ? <Button variant="secondary" disabled={busy} onClick={newConversation}>Iniciar nueva conversación</Button> : retryRef.current && !busy ? <Button variant="secondary" onClick={() => { const retry = retryRef.current; perform(retry.operation, retry.fields, retry.identity).then(() => { if (retry.operation === "chat") setDraft(""); }).catch(() => {}); }}>{errorCode === "request-already-used" ? "Actualizar conversación" : "Reintentar solicitud"}</Button> : null}<small>Tu panel sigue disponible para operar manualmente.</small></div> : null}
      {voiceActive || voiceState === "ended" ? <section className="fm-olivia-voice" aria-live="polite"><strong>{voiceState === "connecting" ? "Conectando voz…" : voiceState === "processing" ? "Consultando el sistema…" : voiceState === "speaking" ? "Olivia está hablando" : voiceState === "ended" ? "La sesión de voz terminó" : pending ? "Confirmá en la tarjeta para continuar" : "Micrófono activo"}</strong>{caption ? <p>{caption}</p> : null}<div>{voiceActive ? <><Button variant="secondary" onClick={() => voiceRef.current?.interrupt()}>Interrumpir</Button><Button variant="secondary" onClick={stopVoice}>Finalizar voz</Button></> : <Button variant="secondary" onClick={() => { stopVoice(); startVoice(); }}>Reconectar voz</Button>}</div></section> : null}
      <form className="fm-olivia-composer" onSubmit={(event) => { event.preventDefault(); sendMessage(); }}>
        <label className="sr-only" htmlFor="fm-olivia-message">Mensaje para Olivia</label>
        <textarea ref={textareaRef} id="fm-olivia-message" rows="2" maxLength={4000} value={draft} placeholder={recording ? "Grabando…" : "Escribile a Olivia…"} disabled={busy || recording || voiceActive || exhausted || unavailable} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }}/>
        <div className="fm-olivia-composer-actions">
          {recording ? <><Button variant="secondary" icon="Square" onClick={() => stopRecording()}>Transcribir</Button><Button variant="secondary" onClick={() => stopRecording(true)}>Descartar</Button></> : <><IconButton label="Grabar audio para transcribir" icon="Mic" disabled={busy || voiceActive || exhausted || unavailable || !conversationRef.current} onClick={startRecording}/><Button variant="secondary" icon="AudioLines" disabled={busy || voiceActive || exhausted || unavailable || Boolean(pending) || !conversationRef.current} onClick={startVoice}>{voiceState === "error" ? "Reconectar voz" : "Conversar"}</Button><Button type="submit" icon="Send" disabled={!draft.trim() || busy || voiceActive || exhausted || unavailable}>Enviar</Button></>}
        </div>
        <small>{recording ? "Hasta 60 segundos. Al transcribir podés revisar el texto antes de enviarlo." : "El dictado se transcribe y podés revisarlo antes de enviarlo."}</small>
      </form>
      <footer className="fm-olivia-usage">
        {quota?.unlimited ? <span>Administrador · <strong>Uso sin límite de tokens</strong></span> : quota ? <><span>Asistente IA disponible: <strong>{quota.remainingPercent}%</strong></span>{quota.renewsAt ? <small>Próxima renovación: {formatDateTime(quota.renewsAt)}</small> : null}{quota.remainingPercent <= 25 ? <small>{exhausted ? "Tu cupo está agotado. Podés solicitar una ampliación al Administrador." : "Tu cupo disponible es bajo."}</small> : null}</> : null}
        <div className="fm-olivia-costs"><div><small>Próxima consulta escrita · estimado</small><strong>{money(estimate?.estimatedCostArs)}</strong></div><div><small>Última llamada{quota?.lastCost?.estimated ? " · sin medición completa" : ""}</small><strong>{quota?.lastCost ? money(quota.lastCost.ars) : "Sin llamadas previas"}</strong></div></div>
        <small>Costo de IA aproximado en pesos argentinos. Incluye 5% sobre la conversión; el consumo final puede variar. La voz requiere medición de audio.</small>
      </footer>
      {admin && developer ? <section className="fm-olivia-developer" aria-label="Métricas de desarrollo"><h3>Métricas de desarrollo</h3><dl><dt>Modelo próximo</dt><dd>{estimate?.model || "—"}</dd><dt>Razonamiento</dt><dd>{estimate?.reasoningEffort || "—"}</dd><dt>Tokens próximos estimados</dt><dd>{estimate?.estimatedTokens?.toLocaleString("es-AR") || "—"}</dd><dt>Última llamada: entrada / salida</dt><dd>{quota?.inputTokens ?? "—"} / {quota?.outputTokens ?? "—"}</dd><dt>Última llamada: total</dt><dd>{quota?.totalTokens ?? "—"}{quota?.measurement === "reserved-estimate" ? " (reserva estimada)" : ""}</dd><dt>Consumo / reservas del período</dt><dd>{quota?.usedTokens ?? 0} / {quota?.reservedTokens ?? 0}</dd><dt>Último costo USD</dt><dd>{quota?.actualCostUsd != null ? Number(quota.actualCostUsd).toFixed(6) : "Sin medición disponible"}</dd><dt>Contexto enviado</dt><dd>Hasta 16 mensajes recientes; archivo consultable por separado</dd><dt>Cotización de referencia</dt><dd>{estimate?.reference ? `${money(estimate.reference.rate)} por USD · ${estimate.reference.date || "Manual"}` : "Sin cotización disponible"}</dd></dl>{estimate?.reference?.source?.startsWith("https://") ? <a href={estimate.reference.source} target="_blank" rel="noreferrer">Fuente de cotización</a> : null}</section> : null}
      {!admin && exhausted ? <div className="fm-olivia-quota-request"><Button variant="secondary" disabled={busy || !online || quotaRequested} onClick={() => setQuotaRequestOpen(true)}>{quotaRequested ? "Ampliación solicitada" : "Solicitar ampliación"}</Button>{quotaNotice ? <p role="status">{quotaNotice}</p> : null}</div> : null}
    </aside> : null}
    <Modal open={quotaRequestOpen} title="Solicitar ampliación de Olivia" description="Enviaremos al Administrador una solicitud de ampliación para tu cupo del período actual." onClose={() => { if (!busy) setQuotaRequestOpen(false); }} footer={<div className="fm-dialog-actions"><Button variant="secondary" disabled={busy} onClick={() => setQuotaRequestOpen(false)}>No</Button><Button loading={busy} onClick={requestQuotaExtension}>Sí, solicitar</Button></div>}><p>La solicitud no cambia tu cupo. El Administrador puede conceder una ampliación temporal desde Configuración de IA.</p>{error ? <p className="fm-form-error" role="alert">{error}</p> : null}</Modal>
  </>;
}
