import { useCallback, useEffect, useRef, useState } from "react";
import { Button, IconButton, Modal } from "../../design-system";
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
import { DictationCapture } from "./dictation.mjs";
import OliviaComposer from "./OliviaComposer";
import OliviaDeveloperPanel from "./OliviaDeveloperPanel";
import { OliviaLive } from "./live.mjs";
import OliviaVoiceControls from "./OliviaVoiceControls";
import OliviaUsage from "./OliviaUsage";
import OliviaMessageContent from "./OliviaMessageContent";
import { formatOliviaCost } from "../../shared/oliviaVoicePricing.mjs";
import { OLIVIA_VOICE_CONVERSATION_ENABLED, OLIVIA_VOICE_UNAVAILABLE_MESSAGE } from "../../shared/oliviaVoiceAvailability.mjs";
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
  const { setAssistantOpen, setReview } = useOliviaVisibility();
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
  const [errorReportId, setErrorReportId] = useState(null);
  const [reportState, setReportState] = useState("idle");
  const jobRef = useRef(null);
  const [recording, setRecording] = useState(false);
  const [audioFrame, setAudioFrame] = useState({ seconds: 0, bars: Array(24).fill(0) });
  const [muted, setMuted] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [phase, setPhase] = useState("");
  const [optimistic, setOptimistic] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const attachmentControllers = useRef(new Map());
  const attachmentFiles = useRef(new Map());
  const streamStart = useRef(null);
  const [latency, setLatency] = useState(null);
  const [voiceMetrics, setVoiceMetrics] = useState({});
  const [viewport, setViewport] = useState(null);
  const [voiceState, setVoiceState] = useState("idle");
  const [voiceNotice, setVoiceNotice] = useState("");
  const voiceNoticeTimer = useRef(null);
  useEffect(() => () => clearTimeout(voiceNoticeTimer.current), []);
  const [voiceMode, setVoiceMode] = useState("default");
  const [voiceCosts, setVoiceCosts] = useState(null);
  const [voiceCostSession, setVoiceCostSession] = useState(null);
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
  const stickToBottom = useRef(true);
  const estimateContextRef = useRef("");
  const estimateContextKey = `${context.route}:${context.module}`;
  const exhausted = snapshot.usage?.remainingPercent === 0;
  const unavailable = snapshot.enabled === false || snapshot.providerConfigured === false || !online;
  const voiceActive = !["idle", "error", "ended"].includes(voiceState);
  const expired = pendingExpired(snapshot.pendingAction, now);

  useEffect(() => {
    const view = window.visualViewport;
    if (!view) return;
    const measure = () => setViewport({ height: view.height, top: view.offsetTop });
    measure(); view.addEventListener("resize", measure); view.addEventListener("scroll", measure);
    return () => { view.removeEventListener("resize", measure); view.removeEventListener("scroll", measure); };
  }, []);
  useEffect(() => {
    if (!optimistic || !streamStart.current || streamStart.current.visibleMs != null) return;
    const frame = requestAnimationFrame(() => { if (streamStart.current) streamStart.current.visibleMs = performance.now() - streamStart.current.sentAt; });
    return () => cancelAnimationFrame(frame);
  }, [optimistic]);

  useEffect(() => {
    setAssistantOpen(open);
    return () => setAssistantOpen(false);
  }, [open, setAssistantOpen]);

  const apply = useCallback((result) => {
    if (!mounted.current) return;
    if (result.failure) { setError(result.failure.message); setErrorCode(result.failure.code); setErrorReportId(result.failure.reportId || null); }
    if (Array.isArray(result.messages)) { setOptimistic(null); setStreamText(""); }
    if (result.conversationId) {
      conversationRef.current = result.conversationId;
      rememberConversation(user.uid, result.conversationId);
    }
    setSnapshot((current) => ({ ...current, ...result, messages: Array.isArray(result.messages) ? result.messages : current.messages,
      pendingAction: Object.hasOwn(result, "pendingAction") ? result.pendingAction : current.pendingAction,
      activeChatJob: result.activeChatJob || null }));
    const destination = safeNavigation(result.navigation?.path, window.location.origin);
    if (destination && result.navigation?.review) setReview?.({ ...result.navigation.review, path: destination });
    if (destination) navigate(destination);
    if (["completed", "COMPLETADA"].includes(typeof result.state === "string" ? result.state : result.state?.status)) {
      clearRuntimeCache();
      window.dispatchEvent(new CustomEvent("flor-mia:olivia-completed"));
    }
  }, [navigate, user.uid, setReview]);

  const perform = useCallback(async (operation, fields = {}, identity = requestId()) => {
    if (requestRef.current) throw new Error("Esperá a que termine la solicitud actual.");
    const controller = new AbortController();
    requestRef.current = controller;
    const payload = { operation, conversationId: conversationRef.current, requestId: identity, screenContext: contextRef.current, ...fields };
    if (operation === "chat") {
      const activeSession = !voiceRef.current?.closed && voiceRef.current?.session?.realtimeSessionId;
      if (activeSession) payload.voiceSessionId = activeSession;
      else if (fields.inputMode !== "realtime") { setVoiceCostSession(null); setVoiceCosts(null); }
    }
    retryRef.current = { operation, fields, identity };
    setBusy(true); setError(""); setErrorCode(""); setErrorReportId(null); setReportState("idle");
    try {
      if (operation === "chat") {
        stickToBottom.current = true;
        setStreamText(""); setPhase("Olivia está pensando la respuesta…");
        setOptimistic({ id: `optimistic-${identity}`, role: "user", content: fields.message, attachments: fields.attachmentPreviews || [] });
        streamStart.current = { sentAt: performance.now(), firstDeltaMs: null, visibleMs: null };
      }
      if (operation === "chat") streamStart.current.requestMs = performance.now() - streamStart.current.sentAt;
      const result = await oliviaClient.request({ ...payload, ...(operation === "chat" ? { background: true } : {}) }, { signal: controller.signal,
        onEvent: ["chat", "waitChat"].includes(operation) ? (event) => {
          if (!mounted.current) return;
          if (event.type === "job") jobRef.current = event.jobId;
          if (event.type === "accepted") { setOptimistic(event.message); conversationRef.current = event.conversationId; }
          if (event.type === "delta") {
            if (streamStart.current && streamStart.current.firstDeltaMs == null) streamStart.current.firstDeltaMs = performance.now() - streamStart.current.sentAt;
            setStreamText((current) => current + event.delta);
          }
          if (event.type === "phase") { setPhase(event.label); if (event.tools) setStreamText(""); }
        } : undefined });
      apply(result);
      if (operation === "chat") { setOptimistic(null); setStreamText(""); setLatency({ ...streamStart.current, totalMs: performance.now() - streamStart.current.sentAt }); }
      retryRef.current = null;
      return result;
    } catch (failure) {
      if (["chat", "waitChat"].includes(operation)) setSnapshot(current => ({ ...current, activeChatJob: null }));
      if (mounted.current && failure.name !== "AbortError") { setError(failure.message); setErrorCode(failure.code || ""); setErrorReportId(failure.reportId || null); }
      if (["request-already-used", "stream-incomplete"].includes(failure.code) || failure.name === "AbortError") retryRef.current = { operation: "state", fields: {}, identity: requestId() };
      if (failure.name === "AbortError" && mounted.current && ["chat", "waitChat"].includes(operation)) { setPhase("Respuesta detenida. El chat se conserva."); setError("Respuesta detenida. El chat se conserva."); setErrorCode("stream-incomplete"); }
      throw failure;
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (mounted.current) setBusy(false);
    }
  }, [apply]);

  useEffect(() => {
    if (!open || busy || !snapshot.activeChatJob?.jobId) return;
    setPhase(snapshot.activeChatJob.phase || "Sigo trabajando en tu solicitud…");
    perform("waitChat", { jobId: snapshot.activeChatJob.jobId }).catch(() => {});
  }, [open, busy, snapshot.activeChatJob, perform]);

  const cancelRequest = async () => {
    const controller = requestRef.current;
    try {
      if (jobRef.current) await oliviaClient.request({ operation: "cancelChat", jobId: jobRef.current });
      controller?.abort();
    } catch (failure) { setError("No pude detener la consulta todavía. Olivia sigue trabajando."); setErrorCode(failure.code || ""); }
  };
  const reportError = async () => {
    if (!errorReportId || reportState === "sending" || reportState === "sent") return;
    setReportState("sending");
    try { await oliviaClient.request({ operation: "reportError", reportId: errorReportId }); setReportState("sent"); clearRuntimeCache(); window.dispatchEvent(new CustomEvent("flor-mia:olivia-completed")); }
    catch (failure) { setReportState("idle"); setError(failure.message); }
  };

  const stopRecording = useCallback((discard = false, send = false) => {
    const current = audioRef.current;
    if (!current) return;
    current.stop(discard ? "cancel" : send ? "send" : "stop");
    if (discard) { audioRef.current = null; if (mounted.current) setRecording(false); }
  }, []);

  const stopVoice = useCallback(() => {
    voiceRef.current?.close();
    voiceRef.current = null;
    if (mounted.current) { setVoiceState("idle"); setCaption(""); }
  }, []);

  useEffect(() => {
    if (!open || !voiceCostSession) return undefined;
    const controller = new AbortController();
    let timer, endedAt = null;
    const poll = async () => {
      try {
        const result = await oliviaClient.request({ operation: "voiceCosts", ...voiceCostSession }, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setVoiceCosts(result.voiceCosts);
        if (result.voiceCosts.settled && !result.voiceCosts.backendPending) return;
      } catch { if (controller.signal.aborted) return; }
      if (!voiceRef.current || voiceRef.current.closed) endedAt ??= Date.now();
      if (!endedAt || Date.now() - endedAt < 90000) timer = setTimeout(poll, 5000);
    };
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [open, voiceCostSession]);

  useEffect(() => {
    if (voiceCostSession && snapshot.conversationId && voiceCostSession.conversationId !== snapshot.conversationId) { setVoiceCostSession(null); setVoiceCosts(null); }
  }, [snapshot.conversationId, voiceCostSession]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestRef.current?.abort();
      historyRef.current?.abort();
      estimateRef.current?.abort();
      attachmentControllers.current.forEach((controller) => controller.abort());
      attachmentFiles.current.forEach((file) => { if (file.preview) URL.revokeObjectURL(file.preview); });
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
      attachmentFiles.current.forEach((_, localId) => removeFile(localId));
    } catch { /* Keep the selected chat visible on failure. */ }
  };

  useEffect(() => {
    const onConfiguration = () => { if (open && !requestRef.current) perform("state").catch(() => {}); };
    window.addEventListener("flor-mia:olivia-configuration-updated", onConfiguration);
    return () => window.removeEventListener("flor-mia:olivia-configuration-updated", onConfiguration);
  }, [open, perform]);

  useEffect(() => {
    if (stickToBottom.current) messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "auto" });
  }, [snapshot.messages, busy, open, streamText, optimistic]);

  useEffect(() => {
    voiceRef.current?.setMuted(muted || ((voiceMode === "realtime-mini" || snapshot.voiceProtocol !== "live") && Boolean(snapshot.pendingAction)));
    if (!snapshot.pendingAction) return undefined;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [snapshot.pendingAction, snapshot.voiceProtocol, voiceMode, muted]);

  useEffect(() => {
    setQuotaRequested(false); setQuotaNotice(""); quotaRequestIdRef.current = null;
  }, [snapshot.usage?.period]);

  useEffect(() => {
    const disconnect = () => { stopRecording(true); stopVoice(); };
    window.addEventListener("offline", disconnect);
    window.addEventListener("pagehide", disconnect);
    return () => { window.removeEventListener("offline", disconnect); window.removeEventListener("pagehide", disconnect); };
  }, [stopRecording, stopVoice]);

  const sendMessage = async (dictated) => {
    const ready = attachments.filter((file) => file.id);
    const message = (typeof dictated === "string" ? dictated : draft).trim() || (ready.length ? "Analizá los archivos adjuntos." : "");
    if (!message || busy || recording || voiceState === "connecting" || exhausted || unavailable || attachments.some((file) => file.status === "uploading")) return;
    setDraft("");
    try {
      const result = await perform("chat", { message, inputMode: typeof dictated === "string" ? "dictation" : "text", attachmentIds: ready.map((file) => file.id), attachmentPreviews: ready.map(({ name, type }) => ({ name, type })) });
      if (voiceActive) voiceRef.current?.shareTextTurn(message, result);
      ready.forEach((file) => removeFile(file.localId));
    } catch { /* Error and retry use the original request ID. */ }
  };

  const newConversation = async () => {
    if (busy || recording || voiceActive) return;
    if (snapshot.pendingAction && !["conversation-not-found", "session-changed", "permission-scope-changed", "conversation-expired"].includes(errorCode)) {
      try { await perform("cancel", { confirmationToken: snapshot.pendingAction.confirmationToken, actionId: snapshot.pendingAction.id }); }
      catch { return; }
    }
    conversationRef.current = null;
    forgetConversation(user.uid);
    confirmationIds.current.clear();
    setSnapshot({ messages: [], state: "INFORMACION", pendingAction: null, usage: null });
    setDraft(""); setArchived([]); setMessagesCursor(undefined); setDraftEstimate(null); setChatsOpen(false);
    attachmentFiles.current.forEach((_, localId) => removeFile(localId));
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
    setRecording(true); setError(""); setAudioFrame({ seconds: 0, bars: Array(24).fill(0) });
    const capture = new DictationCapture({
      limits: snapshot.audioLimits,
      onFrame: (frame) => { if (mounted.current) setAudioFrame(frame); },
      onError: (failure) => { audioRef.current = null; if (mounted.current) { setRecording(false); setError(failure.name === "NotAllowedError" ? "Permití el micrófono en tu navegador para dictar." : failure.message); } },
      onComplete: async (audio, action) => {
        if (audioRef.current === capture) audioRef.current = null;
        if (!mounted.current) return;
        setRecording(false); setBusy(true); setPhase("Transcribiendo…");
        const controller = new AbortController(); requestRef.current = controller;
        let text = "";
        try {
          const result = await oliviaClient.transcribe(audio, { conversationId: conversationRef.current, requestId: requestId() }, { signal: controller.signal });
          if (!mounted.current || controller.signal.aborted) return;
          text = result.text || ""; setDraft(text);
          if (result.usage) setSnapshot((current) => ({ ...current, usage: result.usage }));
          if (!text.trim()) setError("No se reconoció texto. Podés volver a dictar.");
          textareaRef.current?.focus();
        } catch (failure) { if (mounted.current && failure.name !== "AbortError") setError(failure.message); }
        finally { if (requestRef.current === controller) requestRef.current = null; if (mounted.current) setBusy(false); }
        // perform uses the ref lock, so send only after transcription released it.
        if (action === "send" && text.trim() && mounted.current && !controller.signal.aborted) {
          setDraft("");
          const ready = [...attachmentFiles.current.values()].filter((file) => file.id && file.status === "ready");
          perform("chat", { message: text, inputMode: "dictation", attachmentIds: ready.map((file) => file.id), attachmentPreviews: ready.map(({ name, type }) => ({ name, type })) }).then(() => ready.forEach((file) => removeFile(file.localId))).catch(() => {});
        }
      },
    });
    audioRef.current = capture;
    await capture.start();
  };

  const removeFile = (localId) => {
    attachmentControllers.current.get(localId)?.abort(); attachmentControllers.current.delete(localId);
    const file = attachmentFiles.current.get(localId);
    if (file?.preview) URL.revokeObjectURL(file.preview);
    attachmentFiles.current.delete(localId);
    setAttachments((current) => current.filter((item) => item.localId !== localId));
  };
  const addFiles = async (files) => {
    for (const file of Array.from(files || []).slice(0, 4 - attachmentFiles.current.size)) {
      const localId = requestId(), controller = new AbortController();
      const item = { localId, name: file.name, type: file.type || file.name.split(".").at(-1), status: "uploading", preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null };
      attachmentFiles.current.set(localId, item); attachmentControllers.current.set(localId, controller);
      setAttachments((current) => [...current, item]);
      try {
        const result = await oliviaClient.upload(file, { conversationId: conversationRef.current, requestId: localId }, { signal: controller.signal });
        if (mounted.current && !controller.signal.aborted) {
          attachmentFiles.current.set(localId, { ...item, ...result.attachment, status: "ready" });
          setAttachments((current) => current.map((entry) => entry.localId === localId ? { ...entry, ...result.attachment, status: "ready" } : entry));
        }
      } catch (failure) {
        if (mounted.current && !controller.signal.aborted) setAttachments((current) => current.map((entry) => entry.localId === localId ? { ...entry, status: "error", error: failure.message } : entry));
      } finally { attachmentControllers.current.delete(localId); }
    }
  };

  const startVoice = (mode = "default") => {
    if (!OLIVIA_VOICE_CONVERSATION_ENABLED) {
      clearTimeout(voiceNoticeTimer.current);
      setVoiceNotice(OLIVIA_VOICE_UNAVAILABLE_MESSAGE);
      voiceNoticeTimer.current = setTimeout(() => setVoiceNotice(""), 3000);
      return;
    }
    setVoiceNotice("");
    if (busy || recording || voiceRef.current || exhausted || unavailable || snapshot.pendingAction || !conversationRef.current) return;
    if (mode === "realtime-mini" && !snapshot.voiceTrialAvailable) return;
    setError(""); setCaption(""); setMuted(false); setVoiceMode(mode);
    setVoiceCosts(null); setVoiceCostSession(null);
    const miniTrial = mode === "realtime-mini";
    const expectedProtocol = miniTrial ? "realtime" : snapshot.voiceProtocol;
    const voiceConversationId = conversationRef.current;
    const voiceRequest = async (operation, fields) => {
      const started = Date.now();
      while (requestRef.current && Date.now() - started < 45000) await new Promise((resolve) => setTimeout(resolve, 100));
      if (connection.closed && !["realtimeTranscript", "state"].includes(operation)) return null;
      if (operation === "realtimeTranscript") {
        const result = await oliviaClient.request({ operation, ...fields, conversationId: voiceConversationId, requestId: requestId() }, { keepalive: true });
        if (mounted.current && conversationRef.current === voiceConversationId) apply(result);
        return result;
      }
      return perform(operation, fields);
    };
    const VoiceClient = expectedProtocol === "live" ? OliviaLive : OliviaRealtime;
    const connection = new VoiceClient({
      createSession: (sdp, signal) => oliviaClient.request({ operation: "realtime", sdp, nativeTools: !miniTrial, ...(miniTrial ? { voiceMode: "realtime-mini" } : {}), conversationId: voiceConversationId, requestId: requestId(), screenContext: contextRef.current }, { signal }).then(async (result) => {
        apply({ ...result, voiceProtocol: snapshot.voiceProtocol });
        if (result.voiceProtocol !== expectedProtocol) {
          await oliviaClient.request({ operation: "stopRealtime", realtimeSessionId: result.realtimeSessionId, conversationId: voiceConversationId, requestId: requestId() }, { keepalive: true });
          throw new Error("La configuración de voz cambió. Volvé a conectar para usarla.");
        }
        setVoiceCostSession({ realtimeSessionId: result.realtimeSessionId, conversationId: voiceConversationId });
        return result;
      }),
      stopSession: (realtimeSessionId) => oliviaClient.request({ operation: "stopRealtime", realtimeSessionId, conversationId: voiceConversationId, requestId: requestId() }, { keepalive: true }),
      onRequest: (message, realtimeSessionId) => perform("chat", { message, inputMode: "realtime", realtimeSessionId }),
      onInterrupt: () => { if (retryRef.current?.operation === "chat") requestRef.current?.abort(); },
      onTool: (fields) => voiceRequest("realtimeTool", fields),
      onTranscript: (fields) => voiceRequest("realtimeTranscript", fields),
      onRefresh: () => voiceRequest("state", {}),
      interruptSession: (realtimeSessionId) => oliviaClient.request({ operation: "interruptVoice", realtimeSessionId, conversationId: voiceConversationId, requestId: requestId() }),
      onMetrics: (metrics) => { if (mounted.current) setVoiceMetrics((current) => ({ ...current, ...metrics })); },
      onInput: ({ message, itemId }) => { if (mounted.current) { stickToBottom.current = true; setOptimistic({ id: `voice-${itemId}`, role: "user", content: message }); } },
      onState: (state) => {
        if (connection.closed && voiceRef.current === connection) voiceRef.current = null;
        if (mounted.current) setVoiceState(state);
      },
      onError: (failure) => { if (connection.closed && voiceRef.current === connection) voiceRef.current = null; if (mounted.current) setError(failure.name === "NotAllowedError" ? "Permití el micrófono para conversar por voz." : failure.message); },
      onCaption: (text, append) => { if (mounted.current) setCaption((current) => append ? current + text : text); },
    });
    voiceRef.current = connection;
    connection.connect().then(() => { if (connection.closed && voiceRef.current === connection) voiceRef.current = null; });
  };

  const close = () => { stopRecording(true); stopVoice(); setOpen(false); launcherRef.current?.focus(); };
  const pending = snapshot.pendingAction;
  const failed = Boolean(error) || ["ERROR", "error", "RECHAZADA"].includes(snapshot.state);
  const label = recording ? "Dictando" : busy ? "Pensando…" : failed ? "Error" : pending ? "Por confirmar" : "Listo";
  const quota = snapshot.usage;
  const estimate = draftEstimate || snapshot.estimate;
  const money = formatOliviaCost;
  const visibleMessages = prependHistoryMessages(archived, optimistic ? [...snapshot.messages.filter((entry) => entry.id !== optimistic.id), optimistic] : snapshot.messages);
  const toggleDeveloper = () => { const next = !developer; setDeveloper(next); try { localStorage.setItem(`flor-mia-olivia-dev:${user.uid}`, String(next)); } catch { /* Optional preference. */ } };

  return <>
    <button ref={launcherRef} type="button" className="fm-olivia-launcher" aria-label={open ? "Cerrar Olivia" : "Abrir Olivia, asistente de Flor Mía"} aria-expanded={open} aria-controls="fm-olivia-drawer" onClick={() => open ? close() : setOpen(true)}>
      <OliviaFace active={busy || recording || voiceActive} /><span>Olivia</span>
    </button>
    {open ? <aside id="fm-olivia-drawer" className={`fm-olivia-drawer${viewport?.height < 500 ? " is-compact" : ""}`} style={viewport ? { "--olivia-viewport-height": `${viewport.height}px`, "--olivia-viewport-top": `${viewport.top}px` } : undefined} role="dialog" aria-modal="false" aria-labelledby="fm-olivia-title">
      <header className="fm-olivia-header">
        <OliviaFace active={busy || recording || voiceActive}/><div className="fm-olivia-identity"><h2 id="fm-olivia-title">Olivia</h2><span>Asistente de Flor Mía</span><small>{context.module === "seller" ? "Panel Vendedor" : "Panel Administrador"}</small></div>
        <span className={`fm-olivia-status-dot ${failed ? "is-error" : busy || pending ? "is-pending" : "is-ready"}`} role="status" title={label}><i aria-hidden="true" />{label}</span>
        {admin ? <IconButton label="Modo desarrollador" icon="Settings2" aria-pressed={developer} onClick={toggleDeveloper} /> : null}
        <IconButton label="Mis chats" icon="ScrollText" disabled={busy || recording || voiceActive || historyBusy} onClick={() => { setChatsOpen(!chatsOpen); if (!chatsOpen) loadHistory("chats"); }}/>
        <IconButton label="Nueva conversación" icon="Plus" disabled={busy || recording || voiceActive} onClick={newConversation}/>
        <IconButton label="Cerrar Olivia" icon="X" onClick={close}/>
      </header>
      {chatsOpen ? <section className="fm-olivia-chats" aria-label="Mis chats"><h3>Mis chats</h3><p>Retomá una conversación o creá una nueva. El historial se guarda en tu cuenta durante el período de retención.</p>{chats.map((chat) => <button type="button" key={chat.id} disabled={busy || historyBusy} aria-current={chat.id === snapshot.conversationId ? "true" : undefined} onClick={() => reopen(chat.id)}><strong>{chat.title}</strong><small>{formatDateTime(chat.updatedAt)}</small></button>)}{!chats.length && !historyBusy ? <p>Todavía no hay chats guardados.</p> : null}{chatsCursor ? <Button variant="secondary" disabled={historyBusy} onClick={() => loadHistory("chats", true)}>Ver más chats</Button> : null}{historyBusy ? <p role="status">Cargando chats…</p> : null}</section> : null}
      {historyError ? <p className="fm-olivia-error" role="alert">{historyError}</p> : null}
      <div ref={messagesRef} onScroll={(event) => { const area = event.currentTarget; stickToBottom.current = area.scrollHeight - area.clientHeight - area.scrollTop < 70; }} className="fm-olivia-messages" role="log" aria-live="polite" aria-label="Conversación con Olivia">
        {snapshot.messages.length && messagesCursor !== null ? <Button variant="secondary" disabled={historyBusy || busy || recording || voiceActive} onClick={() => loadHistory("messages")}>Ver mensajes anteriores</Button> : null}
        {!snapshot.messages.length && !busy ? <div className="fm-olivia-welcome"><h3>Hola, soy Olivia.</h3><p>Te ayudo a consultar Flor Mía y preparar operaciones de tu panel. Los cambios siempre se confirman con Sí o No.</p><p>Podés escribir o dictar un mensaje.</p></div> : null}
        {visibleMessages.filter((message) => !message.hiddenFromChat && ["user", "assistant"].includes(message.role)).map((message, index) => <article key={message.id || `${index}:${message.role}`} className={`fm-olivia-message fm-olivia-message--${message.role}`}><strong>{message.role === "user" ? "Vos" : "Olivia"}</strong>{message.role === "assistant" ? <OliviaMessageContent content={message.content} /> : <p>{String(message.content || "")}</p>}{message.attachments?.length ? <ul className="fm-olivia-attachments" aria-label="Archivos de este mensaje">{message.attachments.map((file, fileIndex) => <li key={file.id || fileIndex}>{file.name} · {file.type}</li>)}</ul> : null}</article>)}
        {streamText ? <article className="fm-olivia-message fm-olivia-message--assistant"><strong>Olivia</strong><OliviaMessageContent content={streamText} />{!busy ? <small>Respuesta incompleta</small> : null}</article> : null}
        {busy ? <p className="fm-olivia-working" role="status">{phase || "Olivia está pensando la respuesta…"}</p> : null}
      </div>
      {pending ? <section className="fm-olivia-confirmation" aria-labelledby="fm-olivia-confirm-title"><h3 id="fm-olivia-confirm-title">¿Confirmar esta acción?</h3><OliviaMessageContent content={typeof pending.summary === "string" ? pending.summary : JSON.stringify(pending.summary, null, 2)} />{expired ? <p role="alert">La confirmación venció. Pedile a Olivia que prepare la acción nuevamente.</p> : null}<div className="fm-olivia-confirmation-actions"><Button onClick={() => answer(true)} disabled={busy || expired || exhausted || unavailable}>Sí</Button><Button variant="secondary" onClick={() => answer(false)} disabled={busy || !online}>No</Button></div><small>La acción se ejecuta únicamente al tocar Sí. Podés corregir los datos escribiendo.</small></section> : null}
      {unavailable ? <div className="fm-olivia-error" role="status"><p>{!online ? "Olivia necesita conexión a Internet." : snapshot.enabled === false ? "Olivia está deshabilitada por el Administrador." : "Olivia todavía necesita configurar su conexión con OpenAI."}</p><small>Podés continuar operando desde tu panel.</small>{admin && online ? <Button variant="secondary" onClick={() => navigate("/gestion/settings")}>Abrir configuración</Button> : null}</div> : null}
      {error ? <div className="fm-olivia-error" role="alert"><p>{error}</p>{errorReportId ? <Button className="fm-olivia-report-error" variant="secondary" loading={reportState === "sending"} disabled={reportState === "sent"} onClick={reportError}>{reportState === "sent" ? "Enviado a Agustín" : "Enviar error a Agustín"}</Button> : ["conversation-not-found", "session-changed", "permission-scope-changed", "conversation-expired"].includes(errorCode) ? <Button variant="secondary" disabled={busy} onClick={newConversation}>Iniciar nueva conversación</Button> : retryRef.current && !busy ? <Button variant="secondary" onClick={() => { const retry = retryRef.current; perform(retry.operation, retry.fields, retry.identity).then(() => { if (retry.operation === "chat") setDraft(""); }).catch(() => {}); }}>{errorCode === "request-already-used" ? "Actualizar conversación" : "Reintentar solicitud"}</Button> : null}</div> : null}
      <OliviaVoiceControls active={voiceActive} state={voiceState} caption={caption} modeLabel={voiceMode === "realtime-mini" ? "Voz económica · prueba" : ""} pending={pending} muted={muted} />
      {voiceNotice ? <p className="fm-olivia-voice-notice" role="status">{voiceNotice}</p> : null}
      <OliviaComposer textareaRef={textareaRef} draft={draft} setDraft={setDraft} sendMessage={sendMessage} recording={recording} frame={audioFrame} stopRecording={stopRecording} startRecording={startRecording} startVoice={() => startVoice(voiceMode)} stopVoice={stopVoice} voiceTrialAvailable={admin && snapshot.voiceTrialAvailable} voiceMode={voiceMode} setVoiceMode={setVoiceMode} voiceActive={voiceActive} muted={muted} toggleMute={() => { const next = !muted; setMuted(next); voiceRef.current?.setMuted(next || ((voiceMode === "realtime-mini" || snapshot.voiceProtocol !== "live") && Boolean(pending))); }} disabled={exhausted || unavailable || !conversationRef.current} busy={busy} sendingDisabled={voiceState === "connecting"} cancelRequest={cancelRequest} attachments={attachments} addFiles={addFiles} removeFile={removeFile} />
      <OliviaUsage quota={quota} estimate={estimate} money={money} voiceCosts={voiceCosts} voiceMode={voiceMode} compact={viewport?.height < 500} exhausted={exhausted} />
      {admin && developer ? <OliviaDeveloperPanel estimate={estimate} quota={quota} latency={latency} voiceMetrics={voiceMetrics} voiceCosts={voiceCosts} telemetry={snapshot.telemetry} money={money} /> : null}
      {!admin && exhausted ? <div className="fm-olivia-quota-request"><Button variant="secondary" disabled={busy || !online || quotaRequested} onClick={() => setQuotaRequestOpen(true)}>{quotaRequested ? "Ampliación solicitada" : "Solicitar ampliación"}</Button>{quotaNotice ? <p role="status">{quotaNotice}</p> : null}</div> : null}
    </aside> : null}
    <Modal open={quotaRequestOpen} title="Solicitar ampliación de Olivia" description="Enviaremos al Administrador una solicitud de ampliación para tu cupo del período actual." onClose={() => { if (!busy) setQuotaRequestOpen(false); }} footer={<div className="fm-dialog-actions"><Button variant="secondary" disabled={busy} onClick={() => setQuotaRequestOpen(false)}>No</Button><Button loading={busy} onClick={requestQuotaExtension}>Sí, solicitar</Button></div>}><p>La solicitud no cambia tu cupo. El Administrador puede conceder una ampliación temporal desde Configuración de IA.</p>{error ? <p className="fm-form-error" role="alert">{error}</p> : null}</Modal>
  </>;
}
