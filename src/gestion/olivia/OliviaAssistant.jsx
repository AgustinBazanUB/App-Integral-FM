import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton, Modal, useOverlay } from "../../design-system";
import { useNavigate } from "../../router";
import { useAuth } from "../AuthContext";
import { canAccessAdministration } from "../permissions";
import { useOnlineStatus } from "../hooks";
import { formatDateTime } from "../formatters";
import { clearRuntimeCache } from "../services/runtimeCache";
import { conversationForUser, forgetConversation, operationLabel, pendingExpired, prependHistoryMessages, rememberConversation, requestId, safeNavigation } from "./client.mjs";
import { useOliviaContext, useOliviaVisibility } from "./ScreenContext";
import { oliviaClient } from "./service";
import { DictationCapture } from "./dictation.mjs";
import OliviaComposer from "./OliviaComposer";
import OliviaDeveloperPanel from "./OliviaDeveloperPanel";
import { NaturalVoiceConversation, latencyPercentile } from "./naturalVoice.mjs";
import { FastSpeechPlayer } from "./fastSpeechPlayer.mjs";
import { SpeechClipCache } from "./speechClips.mjs";
import { LiveTranscription } from "./liveTranscription.mjs";
import { isGreetingOnly } from "../../shared/oliviaFastSpeech.mjs";
import { instantConversation, quickReadPlan } from '../../shared/oliviaConversationRouter.mjs';
import { latencyTrace } from '../../shared/oliviaLatencyTrace.mjs';
import OliviaVoiceControls from "./OliviaVoiceControls";
import { EqualizerOrb } from "./voiceorbs/EqualizerOrb";
import { OrbPill } from "./voiceorbs/OrbPill";
import OliviaPreferences, { useFloatingOlivia } from "./OliviaPreferences";
import { appendDictation, interactionState, requestFailure } from "./interactionState.mjs";
import OliviaUsage from "./OliviaUsage";
import OliviaMessageContent from "./OliviaMessageContent";
import { formatOliviaCost } from "../../shared/oliviaCostFormat.mjs";
import { OLIVIA_VOICE_UNAVAILABLE_MESSAGE } from "../../shared/oliviaVoiceAvailability.mjs";
import "./olivia.css";
import { OliviaLauncherPortal } from "./LauncherHost";
import { getUiGuide, UI_GUIDE_VERSION } from '../../shared/oliviaUiGuides.mjs';

export default function OliviaAssistant() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const context = useOliviaContext();
  const { setAssistantOpen, setReview, setGuideRequest, setGuideCommand } = useOliviaVisibility();
  const contextRef = useRef(context);
  contextRef.current = context;
  const admin = canAccessAdministration(profile);
  const online = useOnlineStatus();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [floatingEnabled] = useFloatingOlivia(user.uid);
  const minimizeChat = useCallback(() => { setOpen(false); setMinimized(true); requestAnimationFrame(() => launcherRef.current?.focus()); }, []);
  const openChat = () => { setOpen(true); setMinimized(false); };
  const closeButtonRef = useRef(null);
  const drawerRef = useOverlay(open, minimizeChat, closeButtonRef);
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
  const historyAnchorRef = useRef(null);
  const historySentinelRef = useRef(null);
  const estimateRef = useRef(null);
  const [draft, setDraft] = useState("");
  const draftRef = useRef(draft); draftRef.current = draft;
  const audioSecondsRef = useRef(-1);
  const voiceTurnQueue = useRef(Promise.resolve());
  const acknowledgementRef = useRef(null);
  const voiceSpeechEpoch = useRef(0);
  const greetingPlayedEpoch = useRef(-1);
  const mainVoiceEpoch = useRef(-1);
  const submittingRef = useRef(false);
  const playedVoice = useRef(new Set());
  const [sessionNotice, setSessionNotice] = useState("");
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [voiceFailure, setVoiceFailure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [errorReportId, setErrorReportId] = useState(null);
  const [reportState, setReportState] = useState("idle");
  const [reportNotice, setReportNotice] = useState("");
  useEffect(() => { setReportState("idle"); setReportNotice(""); }, [errorReportId]);
  const jobRef = useRef(null);
  const [recording, setRecording] = useState(false);
  const [audioFrame, setAudioFrame] = useState({ seconds: 0, bars: Array(24).fill(0) });
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(muted); mutedRef.current = muted;
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
  const [voiceRetryType, setVoiceRetryType] = useState("");
  const voiceNoticeTimer = useRef(null);
  useEffect(() => () => clearTimeout(voiceNoticeTimer.current), []);
  const voiceSpeechPromiseRef = useRef(null);
  const voiceSynthesisRef = useRef(null);
  const voiceMetricsSamples = useRef({ turnToTranscript: [], transcriptToVoice: [], ttfa: [] });
  const voiceTurnTiming = useRef(null);
  const voiceTrace = useRef(null);
  const voiceSettingsRef = useRef(snapshot.voiceSettings);voiceSettingsRef.current=snapshot.voiceSettings;
  const [turnTrace,setTurnTrace]=useState(null);
  const lastVoiceBlob = useRef(null);
  const lastSpokenText = useRef("");
  const voiceTranscriptionRef = useRef(null);
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
  const voiceActive = Boolean(voiceRef.current && !voiceRef.current.closed);
  const expired = pendingExpired(snapshot.pendingAction, now);

  useEffect(() => {
    const view = window.visualViewport;
    if (!view) return;
    const measure = () => setViewport({ height: view.height, top: view.offsetTop });
    measure(); view.addEventListener("resize", measure); view.addEventListener("scroll", measure);
    return () => { view.removeEventListener("resize", measure); view.removeEventListener("scroll", measure); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const root = document.getElementById("root");
    const previous = root?.inert;
    if (root) root.inert = true;
    return () => { if (root) root.inert = previous; };
  }, [open]);
  useEffect(() => {
    if (!optimistic || !streamStart.current || streamStart.current.visibleMs != null) return;
    const frame = requestAnimationFrame(() => { if (streamStart.current) streamStart.current.visibleMs = performance.now() - streamStart.current.sentAt; });
    return () => cancelAnimationFrame(frame);
  }, [optimistic]);

  useEffect(() => {
    setAssistantOpen(open);
    return () => setAssistantOpen(false);
  }, [open, setAssistantOpen]);
  useEffect(() => { const show = () => { setOpen(true); setMinimized(false); }; window.addEventListener('olivia:open-chat', show); return () => window.removeEventListener('olivia:open-chat', show); }, []);

  const apply = useCallback((result) => {
    if (!mounted.current) return;
    if (result.failure && !result.activeChatJob) { setError(result.failure.message); setErrorCode(result.failure.code); setErrorReportId(result.failure.reportId || null); }
    else { setError(""); setErrorCode(""); setErrorReportId(null); }
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
    if (result.guideControl && ['next','previous','pause','resume','cancel'].includes(result.guideControl.action)) { setGuideCommand?.({ ...result.guideControl, requestId: requestId() }); if (['next','previous','resume'].includes(result.guideControl.action)) { setOpen(false); setMinimized(true); } }
    if (["completed", "COMPLETADA"].includes(typeof result.state === "string" ? result.state : result.state?.status)) {
      clearRuntimeCache();
      window.dispatchEvent(new CustomEvent("flor-mia:olivia-completed"));
    }
  }, [navigate, user.uid, setReview, setGuideCommand]);

  const recordVoiceMetric = (key, duration) => {
    if (!Number.isFinite(duration) || duration < 0) return;
    const samples = voiceMetricsSamples.current;
    samples[key] = [...(samples[key] || []), duration].slice(-100);
    const flow=voiceTurnTiming.current?.flow;
    if(flow && ['silence','voiceEndToUsefulAudio','voiceEndToComplete'].includes(key)){const grouped=flow+'.'+key;samples[grouped]=[...(samples[grouped] || []),duration].slice(-100);}
    const summary = (name) => ({ medianMs: latencyPercentile(samples[name] || [], 0.5), p90Ms: latencyPercentile(samples[name] || [], 0.9), p95Ms: latencyPercentile(samples[name] || [], 0.95), count: (samples[name] || []).length });
    setVoiceMetrics(current => ({...current,...Object.fromEntries(Object.keys(samples).map(name=>[name,summary(name)])),ttfaScheduled:summary('ttfa')}));
  };

  const playNaturalText = async (text) => {
    if (!text || !voiceRef.current || voiceRef.current.closed) return;
    acknowledgementRef.current?.cancel();
    mainVoiceEpoch.current = voiceSpeechEpoch.current;
    lastSpokenText.current = text;
    if (voiceRef.current.recordingTurn) return;
    const controller = new AbortController(); voiceSynthesisRef.current?.abort(); voiceSynthesisRef.current = controller;
    const startedAt = performance.now(); setVoiceState("synthesizing"); setCaption(text); setVoiceNotice(""); setVoiceRetryType(""); setVoiceFailure(false);
    const trace=voiceTrace.current;trace?.mark('tts.request');
    try {
      const response = await oliviaClient.synthesize(text, { conversationId: conversationRef.current, requestId: requestId() }, { signal: controller.signal });
      setVoiceMetrics((current) => ({ ...current, lastCharacters: Number(response.headers.get("X-Olivia-Character-Count") || text.length), lastEstimatedCostUsd: Number(response.headers.get("X-Olivia-Estimated-Cost-USD") || 0) }));
      if (controller.signal.aborted || voiceRef.current?.recordingTurn) return;
      trace?.mark('tts.headers');
      const ttsHeader=response.headers.get('X-Olivia-Server-Ms');if(ttsHeader!==null)recordVoiceMetric('ttsServerHeaders',Number(ttsHeader));
      await voiceRef.current?.play(response, { signal: controller.signal,onFirstPacket:at=>trace?.mark('tts.first_packet',{},at), onFirstScheduled: (at) => { if (voiceSynthesisRef.current !== controller) return;trace?.mark('audio.final_start',{},at);setTurnTrace(trace?.snapshot()); setVoiceState("speaking"); recordVoiceMetric("ttfa", at - startedAt); if (voiceTurnTiming.current) {recordVoiceMetric("transcriptToVoice", at - voiceTurnTiming.current.transcriptAt);recordVoiceMetric('voiceEndToUsefulAudio',at-voiceTurnTiming.current.voiceEndedAt);} }, onComplete: (at) => {trace?.mark('audio.complete',{},at);setTurnTrace(trace?.snapshot());if(voiceTurnTiming.current)recordVoiceMetric('voiceEndToComplete',at-voiceTurnTiming.current.voiceEndedAt); if (!controller.signal.aborted && voiceSynthesisRef.current === controller && voiceRef.current && !voiceRef.current.closed && !voiceRef.current.recordingTurn) setVoiceState(mutedRef.current ? "muted" : "listening"); } });
    } catch (failure) {
      if (!controller.signal.aborted && failure.name !== "AbortError" && mounted.current && voiceSynthesisRef.current === controller) { setVoiceNotice("No pude reproducir la respuesta. La respuesta escrita quedó guardada; podés reintentar el audio."); setVoiceRetryType("audio"); setVoiceFailure(!(failure instanceof TypeError)); setVoiceState(mutedRef.current ? "muted" : "listening"); }
    } finally { if (voiceSynthesisRef.current === controller) voiceSynthesisRef.current = null; }
  };

  const perform = useCallback(async (operation, fields = {}, identity = requestId()) => {
    if (requestRef.current) throw new Error("Esperá a que termine la solicitud actual.");
    const controller = new AbortController();
    const speechEpoch = voiceSpeechEpoch.current;
    requestRef.current = controller;
    const foreground = operation==='chat' && fields.inputMode==='natural-voice' && voiceSettingsRef.current?.latencyMode===true && (instantConversation(fields.message) || isGreetingOnly(fields.message) || quickReadPlan(fields.message));
    if(foreground)fields={...fields,foreground:true};
    const trace=fields.inputMode==='natural-voice'?voiceTrace.current:null;
    trace?.bindRequest(identity);
    trace?.mark('request.dispatch',{mode:foreground?'foreground':'background'});
    const payload = { operation, conversationId: conversationRef.current, requestId: identity, screenContext: contextRef.current, ...fields };
    retryRef.current = { operation, fields, identity };
    setBusy(true); setError(""); setErrorCode(""); setErrorReportId(null); setReportState("idle"); setSessionNotice("");
    if (operation === "chat") jobRef.current = null;
    try {
      if (operation === "chat") {
        stickToBottom.current = true;
        setStreamText(""); setPhase("Olivia está pensando la respuesta…");
        setOptimistic({ id: `optimistic-${identity}`, role: "user", content: fields.message, attachments: fields.attachmentPreviews || [] });
        streamStart.current = { sentAt: performance.now(), firstDeltaMs: null, visibleMs: null };
      }
      if (operation === "chat") streamStart.current.requestMs = performance.now() - streamStart.current.sentAt;
      const result = await oliviaClient.request({ ...payload, ...(operation === "chat" ? { background: !foreground,...(foreground?{stream:true}:{}) } : {}) }, { signal: controller.signal, ...(fields.inputMode === "natural-voice" ? { pollIntervalMs:350 } : {}),
        onTiming:({durationMs,serverMs,transportEstimateMs})=>{if(!trace)return;trace.mark('http.headers');recordVoiceMetric('httpHeaders',durationMs);if(serverMs!=null)recordVoiceMetric('httpServer',serverMs);if(transportEstimateMs!=null)recordVoiceMetric('httpTransportEstimate',transportEstimateMs);},
        onEvent: ["chat", "waitChat"].includes(operation) ? (event) => {
          if (!mounted.current || controller.signal.aborted || requestRef.current !== controller) return;
          if (event.type === "job") {
            jobRef.current = event.jobId; setSnapshot(current => ({ ...current, activeChatJob: { jobId: event.jobId, inputMode: fields.inputMode } }));
            if(operation==='chat' && fields.inputMode==='natural-voice' && !isGreetingOnly(fields.message) && !instantConversation(fields.message)) acknowledgementRef.current?.start(()=>requestRef.current===controller && voiceSpeechEpoch.current===speechEpoch && !voiceRef.current?.recordingTurn,{jobId:event.jobId,text:fields.message,conversationId:conversationRef.current});
          }
          if (event.type === "accepted") {trace?.mark('request.accepted');if(foreground && !isGreetingOnly(fields.message) && !instantConversation(fields.message))acknowledgementRef.current?.start(()=>requestRef.current===controller && voiceSpeechEpoch.current===speechEpoch && !voiceRef.current?.recordingTurn,{text:fields.message});acknowledgementRef.current?.updateFacts({accepted:true}); setOptimistic(event.message); conversationRef.current = event.conversationId; }
          if (event.type === "delta") {
            if (streamStart.current && streamStart.current.firstDeltaMs == null) streamStart.current.firstDeltaMs = performance.now() - streamStart.current.sentAt;
            setStreamText((current) => current + event.delta);
          }
          if (event.type === "phase") {trace?.mark('request.phase',{count:event.tools?.length || 0});acknowledgementRef.current?.updateFacts({tools:event.tools}); setPhase(event.label); if (event.tools) setStreamText(""); }
          if (event.type === "voice.ready" && fields.inputMode === "natural-voice" && voiceSpeechEpoch.current === speechEpoch && greetingPlayedEpoch.current !== speechEpoch) {
            const key = `${jobRef.current || identity}:${event.text}`;
            if (!playedVoice.current.has(key)) { playedVoice.current.add(key); voiceSpeechPromiseRef.current = playNaturalText(event.text); }
          }
        } : undefined });
      if (!mounted.current || controller.signal.aborted || requestRef.current !== controller) return result;
      if (["chat", "waitChat"].includes(operation) && fields.inputMode === "natural-voice" && voiceSpeechEpoch.current === speechEpoch && greetingPlayedEpoch.current !== speechEpoch) {
        const spoken = result.spokenText || result.messages?.filter((message) => message.role === "assistant").at(-1)?.voiceTranscript;
        const key = `${jobRef.current || identity}:${spoken}`;
        if (spoken && !playedVoice.current.has(key)) { playedVoice.current.add(key); voiceSpeechPromiseRef.current = playNaturalText(spoken); }
      }
      trace?.mark('request.complete');setTurnTrace(trace?.snapshot());
      apply(result);
      if(fields.inputMode==='natural-voice' && greetingPlayedEpoch.current===speechEpoch && voiceRef.current && !voiceRef.current.recordingTurn && !voiceRef.current.sources.size)setVoiceState(mutedRef.current?'muted':'listening');
      if (operation === "chat") { setOptimistic(null); setStreamText(""); setLatency({ ...streamStart.current, totalMs: performance.now() - streamStart.current.sentAt }); }
      if (["chat", "waitChat"].includes(operation) && fields.inputMode === "natural-voice") { await voiceSpeechPromiseRef.current; voiceSpeechPromiseRef.current = null; }
      jobRef.current = null;
      retryRef.current = null;
      return result;
    } catch (failure) {
      if (!mounted.current || requestRef.current !== controller) throw failure;
      const outcome = requestFailure(failure, { reason: controller.signal.reason, jobId: jobRef.current });
      if (outcome.kind === "recover" && outcome.jobId) {
        setPhase(outcome.label); setSnapshot(current => ({ ...current, activeChatJob: { jobId: outcome.jobId, inputMode: fields.inputMode } }));
        retryRef.current = { operation: "waitChat", fields: { jobId: outcome.jobId, inputMode: fields.inputMode }, identity };
      } else if (outcome.kind === "neutral" || outcome.kind === "recover") {
        setError(""); setErrorCode(""); setSessionNotice(outcome.label); setPhase(""); retryRef.current = null; jobRef.current = null;
        setSnapshot(current => ({ ...current, activeChatJob: null }));
      } else {
        if (["chat", "waitChat"].includes(operation)) setSnapshot(current => ({ ...current, activeChatJob: null }));
        setError(failure.message); setErrorCode(failure.code || ""); setErrorReportId(failure.reportId || null);
        if (["chat", "waitChat"].includes(operation)) retryRef.current = { operation: "resume", fields: { conversationId: conversationRef.current }, identity: requestId() };
        else if (["request-already-used", "stream-incomplete"].includes(failure.code)) retryRef.current = { operation: "state", fields: {}, identity: requestId() };
        else if (!["olivia-network-error", "olivia-timeout"].includes(failure.code)) retryRef.current = null;
      }
      throw failure;
    } finally {
      if (requestRef.current === controller && !isGreetingOnly(fields.message) && !instantConversation(fields.message)) acknowledgementRef.current?.cancel();
      if (requestRef.current === controller) { requestRef.current = null; if (mounted.current) setBusy(false); }
    }
  }, [apply]);

  useEffect(() => {
    if (busy || !snapshot.activeChatJob?.jobId) return;
    setPhase(snapshot.activeChatJob.phase || "Sigo trabajando en tu solicitud…");
    perform("waitChat", { jobId: snapshot.activeChatJob.jobId, inputMode: snapshot.activeChatJob.inputMode }).catch(() => {});
  }, [open, busy, snapshot.activeChatJob, perform]);

  const cancelRequest = async ({ preserveTask = false } = {}) => {
    const controller = requestRef.current;
    try {
      let jobId = jobRef.current;
      const saved = retryRef.current;
      if (!jobId && saved?.operation === "chat" && !saved.fields.foreground) {
        const started = await oliviaClient.request({ operation: "startChat", ...saved.fields, requestId: saved.identity, conversationId: conversationRef.current, screenContext: contextRef.current });
        jobId = started.jobId;
      }
      if (jobId) await oliviaClient.request({ operation: "cancelChat", jobId, preserveTask });
      else if(saved?.fields.foreground) await oliviaClient.request({operation:'cancelTurn',conversationId:conversationRef.current,requestId:saved.identity});
      controller?.abort(preserveTask ? "superseded" : "user-stop"); acknowledgementRef.current?.cancel(); voiceSynthesisRef.current?.abort("user-stop"); voiceRef.current?.stopPlayback();
      if (!preserveTask) voiceTranscriptionRef.current?.abort("user-stop");
      if (requestRef.current === controller) requestRef.current = null;
      jobRef.current = null; retryRef.current = null;
      setSnapshot(current => ({ ...current, activeChatJob: null, pendingAction: null }));
      if (mounted.current) setBusy(false);
      if (voiceRef.current) setVoiceState(mutedRef.current ? "muted" : "listening");
      return true;
    } catch { setPhase("Sigo trabajando en tu consulta. No pude confirmar la detención todavía…"); return false; }
  };
  const reportError = async () => {
    if (!errorReportId || reportState === "sending" || reportState === "sent") return;
    setReportState("sending");
    setReportNotice("");
    try { await oliviaClient.request({ operation: "reportError", reportId: errorReportId }); setReportState("sent"); clearRuntimeCache(); window.dispatchEvent(new CustomEvent("flor-mia:olivia-completed")); }
    catch (failure) { setReportState("idle"); setReportNotice(failure.message); }
  };

  const stopRecording = useCallback((discard = false, send = false) => {
    const current = audioRef.current;
    if (!current) return;
    current.stop(discard ? "cancel" : send ? "send" : "stop");
    if (discard) { audioRef.current = null; if (mounted.current) setRecording(false); }
  }, []);

  const endVoiceSession = useCallback(() => {
    acknowledgementRef.current?.dispose(); acknowledgementRef.current = null;
    voiceSynthesisRef.current?.abort(); voiceSynthesisRef.current = null;
    voiceTranscriptionRef.current?.abort(); voiceTranscriptionRef.current = null;
    voiceRef.current?.close(); voiceRef.current = null;
    if (requestRef.current && retryRef.current?.fields?.inputMode === "natural-voice") {
      requestRef.current.abort("voice-ended");
      if (jobRef.current) oliviaClient.request({ operation: "cancelChat", jobId: jobRef.current, preserveTask: true }).catch(() => {});
    }
    if (mounted.current) { setVoiceState("idle"); setCaption(""); setVoiceNotice(""); setVoiceFailure(false); setSessionNotice("La conversación por voz terminó"); }
  }, []);


  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestRef.current?.abort("unmount");
      historyRef.current?.abort();
      estimateRef.current?.abort();
      attachmentControllers.current.forEach((controller) => controller.abort());
      attachmentFiles.current.forEach((file) => { if (file.preview) URL.revokeObjectURL(file.preview); });
      stopRecording(true);
      endVoiceSession();
    };
  }, [stopRecording, endVoiceSession]);

  useEffect(() => {
    if (!open) return undefined;
    if (!requestRef.current && !snapshot.conversationId) { estimateContextRef.current = estimateContextKey; perform(conversationRef.current ? "resume" : "state").catch(() => {}); }
  }, [open, perform]);

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
    if (historyRef.current || (kind !== "messages" && (busy || recording || voiceActive))) return;
    const controller = new AbortController(); historyRef.current = controller;
    const selectedConversationId = conversationRef.current;
    setHistoryBusy(true); setHistoryError("");
    try {
      const result = await oliviaClient.request({ operation: "history", ...(kind === "messages" ? { conversationId: conversationRef.current, messagesCursor: messagesCursor || null } : { conversationsCursor: more ? chatsCursor : null }) }, { signal: controller.signal });
      if (!mounted.current || controller.signal.aborted) return;
      if (kind === "messages") {
        if (conversationRef.current !== selectedConversationId) return;
        const area = messagesRef.current;
        if (area) historyAnchorRef.current = { height: area.scrollHeight, top: area.scrollTop };
        setArchived((current) => prependHistoryMessages(result.selectedConversation.messages, current));
        setMessagesCursor(result.selectedConversation.nextCursor);
      } else { setChats((current) => more ? [...current, ...result.conversations] : result.conversations); setChatsCursor(result.conversationsCursor); }
    } catch (failure) { if (mounted.current && failure.name !== "AbortError") setHistoryError(failure.message); }
    finally { if (historyRef.current === controller) historyRef.current = null; if (mounted.current) setHistoryBusy(false); }
  };

  useLayoutEffect(() => {
    const area = messagesRef.current, anchor = historyAnchorRef.current;
    if (area && anchor) { area.scrollTop = anchor.top + area.scrollHeight - anchor.height; historyAnchorRef.current = null; }
  }, [archived]);

  useEffect(() => {
    if (!open || !snapshot.messages.length || messagesCursor === null || historyBusy || !globalThis.IntersectionObserver || !historySentinelRef.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void loadHistory("messages"); }, { root: messagesRef.current, rootMargin: "60px 0px 0px 0px" });
    observer.observe(historySentinelRef.current);
    return () => observer.disconnect();
  }, [open, snapshot.conversationId, snapshot.messages.length, messagesCursor, historyBusy]);

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
    voiceRef.current?.setMuted(muted);
    if (!snapshot.pendingAction) return undefined;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [snapshot.pendingAction, muted]);

  useEffect(() => {
    setQuotaRequested(false); setQuotaNotice(""); quotaRequestIdRef.current = null;
  }, [snapshot.usage?.period]);

  useEffect(() => {
    const disconnect = () => {
      stopRecording(true); voiceSynthesisRef.current?.abort("offline"); voiceTranscriptionRef.current?.abort("offline");
      const wasActive = voiceRef.current && !voiceRef.current.closed;
      acknowledgementRef.current?.dispose(); acknowledgementRef.current = null;
      voiceRef.current?.close(); voiceRef.current = null;
      if (mounted.current && wasActive) { setVoiceState("idle"); setVoiceFailure(true); setVoiceNotice("La voz se interrumpió. Volvé a iniciar la conversación cuando el navegador y la conexión estén disponibles."); setSessionNotice("La voz se interrumpió"); }
    };
    window.addEventListener("offline", disconnect);
    window.addEventListener("pagehide", disconnect);
    return () => { window.removeEventListener("offline", disconnect); window.removeEventListener("pagehide", disconnect); };
  }, [stopRecording]);

  const sendMessage = async (dictated) => {
    const ready = attachments.filter((file) => file.id);
    const message = (typeof dictated === "string" ? dictated : draft).trim() || (ready.length ? "Analizá los archivos adjuntos." : "");
    if (!message || submittingRef.current || recording || voiceState === "connecting" || exhausted || unavailable || attachments.some((file) => file.status === "uploading")) return;
    if (requestRef.current && !["chat", "waitChat"].includes(retryRef.current?.operation)) return;
    const submission = {};
    submittingRef.current = submission;
    if (requestRef.current && !await cancelRequest({ preserveTask: true })) { if (submittingRef.current === submission) submittingRef.current = false; return; }
    voiceTranscriptionRef.current?.abort("superseded");
    setDraft("");
    try {
      const work = perform("chat", { message, inputMode: typeof dictated === "string" ? "dictation" : "text", attachmentIds: ready.map((file) => file.id), attachmentPreviews: ready.map(({ name, type }) => ({ name, type })) });
      if (submittingRef.current === submission) submittingRef.current = false;
      const result = await work;
      ready.forEach((file) => removeFile(file.localId));
    } catch { /* Error and retry use the original request ID. */ }
    finally { if (submittingRef.current === submission) submittingRef.current = false; }
  };

  const newConversation = async () => {
    if (busy || recording || voiceActive) return;
    if (snapshot.pendingAction && !["conversation-not-found", "session-changed", "permission-scope-changed", "conversation-expired"].includes(errorCode)) {
      try { await perform("cancel", { confirmationToken: snapshot.pendingAction.confirmationToken, actionId: snapshot.pendingAction.id }); }
      catch { return; }
    }
    conversationRef.current = null;
    historyRef.current?.abort(); historyRef.current = null; historyAnchorRef.current = null; setHistoryBusy(false);
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
    } catch { /* Retries retain the same idempotency key. */ }
  };

  const startRecording = async () => {
    if (busy || audioRef.current || voiceActive || exhausted || unavailable || !conversationRef.current) return;
    setRecording(true); setError(""); setPermissionDenied(false); setAudioFrame({ seconds: 0, bars: Array(24).fill(0) });
    const capture = new DictationCapture({
      limits: snapshot.audioLimits,
      onFrame: (frame) => { if (mounted.current && audioSecondsRef.current !== frame.seconds) { audioSecondsRef.current = frame.seconds; setAudioFrame({ seconds: frame.seconds, bars: [] }); } },
      onError: (failure) => { audioRef.current = null; if (mounted.current) { setRecording(false); setPermissionDenied(failure.name === "NotAllowedError"); setError(failure.name === "NotAllowedError" ? "Permití el micrófono en tu navegador para dictar." : failure.message); } },
      onComplete: async (audio, action) => {
        if (audioRef.current === capture) audioRef.current = null;
        if (!mounted.current) return;
        setRecording(false); setBusy(true); setPhase("Transcribiendo…");
        const controller = new AbortController(); requestRef.current = controller;
        let text = "";
        try {
          const result = await oliviaClient.transcribe(audio, { conversationId: conversationRef.current, requestId: requestId() }, { signal: controller.signal });
          if (!mounted.current || controller.signal.aborted) return;
          const transcript = String(result.text || "").trim();
          if (!transcript) { setError("No se reconoció texto. Podés volver a dictar."); return; }
          text = appendDictation(draftRef.current, transcript); draftRef.current = text; setDraft(text);
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

  const submitVoiceTurn = async (audio, { durationSeconds, endedAt, voiceEndedAt, transcript, turnId }) => {
    if (!mounted.current || !voiceRef.current || voiceRef.current.closed) return;
    lastVoiceBlob.current = { audio, durationSeconds };
    const controller = new AbortController(); voiceTranscriptionRef.current = controller; setBusy(true); setVoiceState("processing"); setPhase("Transcribiendo tu mensaje…"); setVoiceFailure(false);
    let text = "";
    try {
      const result = transcript?.text ? transcript : await oliviaClient.transcribe(audio, { conversationId: conversationRef.current, requestId: requestId(), durationSeconds }, { signal: controller.signal });
      if (!mounted.current || controller.signal.aborted || !voiceRef.current || voiceRef.current.closed) return;
      text = String(result.text || "").trim();
      if (!text) throw new Error("No se reconoció el mensaje. Podés reintentar la transcripción o volver a hablar.");
      if (result.usage) setSnapshot((current) => ({ ...current, usage: result.usage }));
      const liveSession=voiceRef.current?.transcriber?.session;
      if(transcript?.itemId && liveSession)void oliviaClient.liveTranscription({operation:'turn',requestId:liveSession.requestId,conversationId:conversationRef.current,itemId:transcript.itemId,durationSeconds}).catch(()=>{});
      const transcriptAt = performance.now(); voiceTurnTiming.current = { endedAt, transcriptAt,voiceEndedAt,turnId,directReply:isGreetingOnly(text)||Boolean(instantConversation(text)),flow:isGreetingOnly(text)||instantConversation(text)?'instant':quickReadPlan(text)?'read':'controlled' };
      if(Number.isFinite(voiceEndedAt))voiceTrace.current?.mark('voice.last_frame',{},voiceEndedAt);voiceTrace.current?.mark('stt.final',{},transcriptAt);setTurnTrace(voiceTrace.current?.snapshot());
      recordVoiceMetric("turnToTranscript", transcriptAt - endedAt);
      if(Number.isFinite(voiceEndedAt)) {recordVoiceMetric('silence',endedAt-voiceEndedAt);recordVoiceMetric('voiceEndToTranscript',transcriptAt-voiceEndedAt);}
      setCaption(text); stickToBottom.current = true; setOptimistic({ id: `natural-voice-${requestId()}`, role: "user", content: text });
    } catch (failure) {
      if (mounted.current && voiceTranscriptionRef.current === controller && !controller.signal.aborted && failure.name !== "AbortError") {
        const transient = ["olivia-network-error", "olivia-timeout"].includes(failure.code);
        setVoiceNotice(transient ? "La conexión se interrumpió al transcribir. Conservé el audio para que puedas reintentarlo." : failure.message);
        setVoiceRetryType("transcription"); setVoiceFailure(!transient); setVoiceState("listening");
      }
    } finally { if (voiceTranscriptionRef.current === controller) voiceTranscriptionRef.current = null; if (mounted.current) setBusy(Boolean(requestRef.current)); }
    if (text && mounted.current && !controller.signal.aborted) {
      if (requestRef.current && !await cancelRequest({ preserveTask: true })) return;
      if(isGreetingOnly(text) || (voiceSettingsRef.current?.latencyMode && instantConversation(text))) {
        const epoch=voiceSpeechEpoch.current;
        const played=await acknowledgementRef.current?.greeting(text,()=>mounted.current && voiceSpeechEpoch.current===epoch && mainVoiceEpoch.current!==epoch && !voiceRef.current?.recordingTurn);if(played)greetingPlayedEpoch.current=epoch;
      }
      // Release the transcription queue once dispatched: a new spoken correction
      // can now be transcribed while the previous reasoning request is running.
      void perform("chat", { message: text, inputMode: "natural-voice" }).catch(() => { if (mounted.current) setVoiceState("listening"); });
    }
  };

  const retryVoiceTranscription = async () => {
    const saved = lastVoiceBlob.current;
    if (!saved || busy || !voiceActive) return;
    await submitVoiceTurn(saved.audio, { durationSeconds: saved.durationSeconds, endedAt: performance.now() });
  };
  const retryVoiceAudio = () => { if (!busy && voiceActive && lastSpokenText.current) void playNaturalText(lastSpokenText.current); };

  const startVoice = () => {
    if (!snapshot.voiceConversationAvailable) {
      clearTimeout(voiceNoticeTimer.current);
      setVoiceNotice(OLIVIA_VOICE_UNAVAILABLE_MESSAGE);
      voiceNoticeTimer.current = setTimeout(() => setVoiceNotice(""), 3000);
      return;
    }
    setVoiceNotice("");
    if (busy || recording || voiceRef.current || exhausted || unavailable || snapshot.pendingAction || !conversationRef.current) return;
    setError(""); setCaption(""); setMuted(false); setVoiceRetryType(""); setVoiceFailure(false); setPermissionDenied(false); setSessionNotice(""); lastVoiceBlob.current = null; voiceTurnTiming.current = null;
    const connection = new NaturalVoiceConversation({
      adaptiveEndpointing:snapshot.voiceSettings?.latencyMode===true,
      onTrace:({stage,at})=>voiceTrace.current?.mark(stage,{},at),
      createTranscriber: snapshot.voiceSettings?.transcriptionModel==='gpt-live-transcribe' ? async(stream,onPartial,signal)=>{
        const identity=requestId(), sessionConversation=conversationRef.current, transcriber=new LiveTranscription({
          completionTimeoutMs:snapshot.voiceSettings?.latencyMode?2500:5000,
          onTrace:({stage,at})=>voiceTrace.current?.mark(stage,{},at),
          connect:(sdp,signal)=>oliviaClient.liveTranscription({operation:'start',sdp,requestId:identity,conversationId:sessionConversation},{signal}),
          stop:()=>oliviaClient.liveTranscription({operation:'stop',requestId:identity,conversationId:sessionConversation}),
          onPartial,onUnavailable:()=>{if(mounted.current && voiceRef.current===connection){setVoiceNotice('La transcripción en vivo se interrumpió; continúo con dictado por turnos.');setVoiceMetrics(current=>({...current,transcriptionMode:'GPT Transcribe · respaldo por turnos'}));}},
        });
        signal.addEventListener('abort',()=>transcriber.close(),{once:true});
        if(signal.aborted){transcriber.close();throw new DOMException('Finalizada','AbortError');}
        try{const ready=await transcriber.start(stream);if(mounted.current && voiceRef.current===connection)setVoiceMetrics(current=>({...current,transcriptionMode:'GPT Live Transcribe'}));return ready;}catch(error){transcriber.close();throw error;}
      } : undefined,
      onPartial:text=>acknowledgementRef.current?.anticipate(text),
      onNotice:notice=>{if(mounted.current && voiceRef.current===connection){setVoiceNotice(notice);setVoiceMetrics(current=>({...current,transcriptionMode:'GPT Transcribe · respaldo por turnos'}));}},
      silenceMs: Math.max(1900, snapshot.voiceSettings?.turnEndSilenceMs || 1900),
      maxSeconds: snapshot.audioLimits?.maxSeconds || 60,
      maxBytes: snapshot.audioLimits?.maxBytes || 4 * 1024 * 1024,
      onTurn: (...args) => {
        const turn = voiceTurnQueue.current.catch(() => {}).then(() => { if (voiceRef.current === connection && !connection.closed) return submitVoiceTurn(...args); });
        voiceTurnQueue.current = turn; return turn;
      },
      onState: (state) => { if (state === "ended" && voiceRef.current === connection) voiceRef.current = null; if (mounted.current) setVoiceState(state); },
      onSpeechStart: ({ bargeIn,turnId }) => {
        voiceTrace.current=latencyTrace({id:turnId});voiceTrace.current.mark('voice.start');setTurnTrace(voiceTrace.current.snapshot());
        voiceSpeechEpoch.current++;
        acknowledgementRef.current?.cancel();
        if (mounted.current) { setVoiceNotice(""); setVoiceRetryType(""); setVoiceFailure(false); }
        if (bargeIn || voiceSynthesisRef.current) { voiceSynthesisRef.current?.abort("speech-interruption"); voiceSynthesisRef.current = null; voiceSpeechPromiseRef.current = null; }
      },
      onError: (failure) => { if (mounted.current) { setPermissionDenied(failure.name === "NotAllowedError"); setVoiceFailure(failure.name !== "NotAllowedError"); setVoiceNotice(failure.name === "NotAllowedError" ? "Permití el micrófono para conversar por voz." : failure.message); setVoiceRetryType(""); setVoiceState("idle"); } },
    });
    voiceRef.current = connection;
    acknowledgementRef.current?.dispose();
    const clipCache = new SpeechClipCache({conversation:snapshot.voiceSettings?.latencyMode===true,voice:{voice:snapshot.voiceSettings?.voice || snapshot.voiceConfiguration?.voice || 'es-US-Chirp3-HD-Aoede',speakingRate:snapshot.voiceSettings?.speakingRate || 1},userId:user.uid,
      privateAudio:(clipId,signal)=>oliviaClient.speechAudio({operation:'get',clipId,conversationId:conversationRef.current},{signal}),
      preparePrivate:(clipId,signal)=>oliviaClient.speechAudio({operation:'prepare',clipId,conversationId:conversationRef.current,requestId:requestId()},{signal}),
    });
    acknowledgementRef.current = new FastSpeechPlayer({
      cache:clipCache,
      latencyMode:snapshot.voiceSettings?.latencyMode===true,
      select:(fields,signal)=>oliviaClient.fastSpeech({...fields,requestId:requestId()},{signal}),
      loadFallback: (text, signal) => oliviaClient.synthesize(text, { conversationId: conversationRef.current, requestId: requestId() }, { signal }),
      onMetric:(key,value)=>recordVoiceMetric(key,value),
      play: (response, { signal, text }) => connection.play(response, { signal,
        onFirstScheduled: at => { if (!signal.aborted && voiceRef.current === connection) {voiceTrace.current?.mark('audio.clip_start',{},at);setTurnTrace(voiceTrace.current?.snapshot()); setCaption(text); setVoiceState("speaking"); if(voiceTurnTiming.current){recordVoiceMetric('turnToFirstIntervention',at-voiceTurnTiming.current.endedAt);recordVoiceMetric('voiceEndToFirstAudio',at-voiceTurnTiming.current.voiceEndedAt);if(voiceTurnTiming.current.directReply)recordVoiceMetric('voiceEndToUsefulAudio',at-voiceTurnTiming.current.voiceEndedAt);} } },
        onComplete: (at) => {if(!signal.aborted && voiceTurnTiming.current?.directReply){voiceTrace.current?.mark('audio.complete',{},at);setTurnTrace(voiceTrace.current?.snapshot());recordVoiceMetric('voiceEndToComplete',at-voiceTurnTiming.current.voiceEndedAt);} if (!signal.aborted && voiceRef.current === connection && !connection.recordingTurn) setVoiceState(requestRef.current ? "processing" : mutedRef.current ? "muted" : "listening"); },
      }),
    });
    setVoiceState("connecting");
    void acknowledgementRef.current?.warm();
    connection.start().catch((failure) => { if (mounted.current) setVoiceNotice(failure.message); });
  };

  const pending = snapshot.pendingAction;
  const visual = interactionState({ disabled: unavailable, voiceDisabled: snapshot.voiceConversationAvailable === false, permissionDenied, error, voiceError: voiceFailure, connecting: voiceState === "connecting", recording: recording || voiceState === "recording", speaking: voiceState === "speaking", busy, activeJob: snapshot.activeChatJob, processing: ["processing", "synthesizing"].includes(voiceState), listening: voiceActive, muted, pending, phase, notice: sessionNotice });
  const floatingVisible = floatingEnabled && minimized && !open;
  const toggleMute = () => { const next = !muted; setMuted(next); voiceRef.current?.setMuted(next); };
  const floatingLabel = muted && voiceActive ? "Micrófono silenciado" : visual.pill || (pending ? "Revisar acción" : ({ listening: "Escuchando", thinking: "Pensando", speaking: "Hablando", connecting: "Conectando", disabled: "Voz desactivada" }[visual.state] || "Olivia"));
  const sessionControls = (voiceActive || recording) ? <div className="fm-olivia-session-controls"><small>{muted ? "Micrófono silenciado" : "Micrófono activado"}</small>{voiceActive ? <IconButton label={muted ? "Reactivar micrófono de Olivia" : "Silenciar micrófono de Olivia"} icon={muted ? "MicOff" : "Mic"} aria-pressed={muted} onClick={toggleMute} /> : null}<IconButton label="Finalizar sesión de voz de Olivia" icon="Square" onClick={() => { stopRecording(true); endVoiceSession(); }} /></div> : null;
  const quota = snapshot.usage;
  const estimate = draftEstimate || snapshot.estimate;
  const money = formatOliviaCost;
  const visibleMessages = prependHistoryMessages(archived, optimistic ? [...snapshot.messages.filter((entry) => entry.id !== optimistic.id), optimistic] : snapshot.messages);
  const toggleDeveloper = () => { const next = !developer; setDeveloper(next); try { localStorage.setItem(`flor-mia-olivia-dev:${user.uid}`, String(next)); } catch { /* Optional preference. */ } };

  return <>
    {!floatingVisible && !open ? <OliviaLauncherPortal><div className="fm-olivia-launcher-group"><button ref={launcherRef} type="button" className="fm-olivia-launcher" aria-label="Abrir Olivia, asistente de Flor Mía" aria-expanded={false} aria-controls="fm-olivia-drawer" onClick={openChat}>
      <EqualizerOrb state={visual.state} size={27.2} label="Olivia" /><span className="fm-olivia-launcher__label"><strong>Olivia</strong><small>Asistente de IA</small></span>
    </button></div></OliviaLauncherPortal> : null}
    {createPortal(<div className="fm-management-body fm-olivia-modal-host">
    {!open && (floatingVisible || sessionControls) ? <div className={`fm-olivia-floating${floatingVisible ? '' : ' fm-olivia-floating--controls'}`} aria-label="Olivia minimizada">{floatingVisible ? <button ref={launcherRef} type="button" className="fm-olivia-floating__open" aria-label="Abrir conversación con Olivia" aria-controls="fm-olivia-drawer" onClick={openChat}><OrbPill as="span" orb={EqualizerOrb} state={visual.state} text={floatingLabel} orbScale={.8} /></button> : null}{sessionControls}</div> : null}
    {open ? <div className="fm-olivia-overlay" role="presentation"><aside ref={drawerRef} id="fm-olivia-drawer" className={`fm-olivia-drawer${viewport?.height < 500 ? " is-compact" : ""}`} style={viewport ? { "--olivia-viewport-height": `${viewport.height}px`, "--olivia-viewport-top": `${viewport.top}px` } : undefined} role="dialog" aria-modal="true" aria-labelledby="fm-olivia-title">
      <header className="fm-olivia-header">
        <div className="fm-olivia-identity"><div className="fm-olivia-title-line"><h2 id="fm-olivia-title">Olivia<span className="fm-olivia-brand-dot" aria-hidden="true" /></h2></div><small>Flor Mía · Tu asistente</small></div>
        <IconButton label="Preferencias de Olivia" icon="SlidersHorizontal" aria-expanded={preferencesOpen} onClick={() => setPreferencesOpen(value => !value)} />
        <IconButton label="Mis chats" icon="ScrollText" disabled={busy || recording || voiceActive || historyBusy} onClick={() => { setChatsOpen(!chatsOpen); if (!chatsOpen) loadHistory("chats"); }}/>
        <IconButton label="Nueva conversación" icon="Plus" disabled={busy || recording || voiceActive} onClick={newConversation}/>
        <IconButton ref={closeButtonRef} label="Minimizar Olivia" icon="Minus" onClick={minimizeChat}/>
      </header>
      {preferencesOpen ? <><OliviaPreferences uid={user.uid} />{admin ? <div className="fm-olivia-preferences-extras"><span>Modo desarrollador</span><IconButton label="Modo desarrollador" icon="Settings2" aria-pressed={developer} onClick={toggleDeveloper} /></div> : null}</> : null}
      {chatsOpen ? <section className="fm-olivia-chats" aria-label="Mis chats"><h3>Mis chats</h3><p>Retomá una conversación o creá una nueva. El historial se guarda en tu cuenta durante el período de retención.</p>{chats.map((chat) => <button type="button" key={chat.id} disabled={busy || historyBusy} aria-current={chat.id === snapshot.conversationId ? "true" : undefined} onClick={() => reopen(chat.id)}><strong>{chat.title}</strong><small>{formatDateTime(chat.updatedAt)}</small></button>)}{!chats.length && !historyBusy ? <p>Todavía no hay chats guardados.</p> : null}{chatsCursor ? <Button variant="secondary" disabled={historyBusy} onClick={() => loadHistory("chats", true)}>Ver más chats</Button> : null}{historyBusy ? <p role="status">Cargando chats…</p> : null}</section> : null}
      {historyError ? <p className="fm-olivia-error" role="alert">{historyError}</p> : null}
      <OliviaVoiceControls visual={visual} active={voiceActive || recording} muted={muted} compact={viewport?.height < 500 || (!voiceActive && !recording && (snapshot.messages.length > 0 || Boolean(optimistic)))} />
      <div ref={messagesRef} onScroll={(event) => { const area = event.currentTarget; stickToBottom.current = area.scrollHeight - area.clientHeight - area.scrollTop < 70; if (area.scrollTop < 60 && snapshot.messages.length && messagesCursor !== null && !historyBusy) void loadHistory("messages"); }} className="fm-olivia-messages" role="log" aria-live="polite" aria-label="Conversación con Olivia">
        <div ref={historySentinelRef} className="fm-olivia-history-sentinel" aria-hidden="true" />
        {historyBusy && !chatsOpen ? <small className="fm-olivia-history-loading" role="status">Cargando mensajes…</small> : null}
        {!snapshot.messages.length && !busy ? <div className="fm-olivia-welcome"><h3>Hola, soy Olivia.</h3><p>Te ayudo a consultar Flor Mía y preparar operaciones de tu panel. Los cambios siempre se confirman con Sí o No.</p><p>Podés escribir o dictar un mensaje.</p></div> : null}
        {visibleMessages.filter((message) => !message.hiddenFromChat && ["user", "assistant"].includes(message.role)).map((message, index) => <article key={message.id || `${index}:${message.role}`} className={`fm-olivia-message fm-olivia-message--${message.role}`}><strong>{message.role === "user" ? "Vos" : "Olivia"}</strong>{message.role === "assistant" ? <OliviaMessageContent content={message.content} /> : <p>{String(message.content || "")}</p>}{message.attachments?.length ? <ul className="fm-olivia-attachments" aria-label="Archivos de este mensaje">{message.attachments.map((file, fileIndex) => <li key={file.id || fileIndex}>{file.name} · {file.type}</li>)}</ul> : null}</article>)}
        {streamText ? <article className="fm-olivia-message fm-olivia-message--assistant"><strong>Olivia</strong><OliviaMessageContent content={streamText} />{!busy ? <small>Respuesta incompleta</small> : null}</article> : null}
        {busy || snapshot.activeChatJob ? <div className="fm-olivia-working" role="status"><span className="fm-olivia-working__spinner" aria-hidden="true" /><span>Estoy trabajando en ello</span><span className="fm-olivia-working__bar" aria-hidden="true" /></div> : null}
      </div>
      {snapshot.guide?.version === UI_GUIDE_VERSION && getUiGuide(profile, snapshot.guide.guideId, context) ? <div className="fm-olivia-guide-offer"><Button variant="secondary" disabled={busy} onClick={() => { setGuideRequest?.({ ...snapshot.guide, requestId: requestId() }); minimizeChat(); }}>Mostrarme los pasos en pantalla</Button></div> : null}
      {pending ? <section className="fm-olivia-confirmation" aria-labelledby="fm-olivia-confirm-title"><h3 id="fm-olivia-confirm-title">¿Confirmar esta acción?</h3><OliviaMessageContent content={typeof pending.summary === "string" ? pending.summary : JSON.stringify(pending.summary, null, 2)} />{expired ? <p role="alert">La confirmación venció. Pedile a Olivia que prepare la acción nuevamente.</p> : null}<div className="fm-olivia-confirmation-actions"><Button onClick={() => answer(true)} disabled={busy || expired || exhausted || unavailable}>Sí</Button><Button variant="secondary" onClick={() => answer(false)} disabled={busy || !online}>No</Button></div><small>La acción se ejecuta únicamente al tocar Sí. Podés corregir los datos escribiendo.</small></section> : null}
      {unavailable ? <div className="fm-olivia-error" role="status"><p>{!online ? "Olivia necesita conexión a Internet." : snapshot.enabled === false ? "Olivia está deshabilitada por el Administrador." : "Olivia todavía necesita configurar su conexión con OpenAI."}</p><small>Podés continuar operando desde tu panel.</small>{admin && online ? <Button variant="secondary" onClick={() => navigate("/gestion/settings")}>Abrir configuración</Button> : null}</div> : null}
      {error ? <div className="fm-olivia-error" role="alert"><p>{error}</p>{reportNotice ? <p>{reportNotice}</p> : null}{errorReportId ? <Button className="fm-olivia-report-error" variant="secondary" loading={reportState === "sending"} disabled={reportState === "sent"} onClick={reportError}>{reportState === "sent" ? "Enviado a Agustín" : "Enviar error a Agustín"}</Button> : ["conversation-not-found", "session-changed", "permission-scope-changed", "conversation-expired"].includes(errorCode) ? <Button variant="secondary" disabled={busy} onClick={newConversation}>Iniciar nueva conversación</Button> : retryRef.current && !busy ? <Button variant="secondary" onClick={() => { const retry = retryRef.current; perform(retry.operation, retry.fields, retry.identity).then(() => { if (retry.operation === "chat") setDraft(""); }).catch(() => {}); }}>{retryRef.current.operation === "resume" ? "Recuperar conversación" : errorCode === "request-already-used" ? "Actualizar conversación" : "Reintentar solicitud"}</Button> : null}</div> : null}
      {voiceNotice ? <div className="fm-olivia-recovery" role="status"><p>{voiceNotice}</p>{voiceRetryType === "audio" ? <Button variant="secondary" onClick={retryVoiceAudio}>Reintentar audio</Button> : null}{voiceRetryType === "transcription" ? <Button variant="secondary" onClick={retryVoiceTranscription}>Reintentar transcripción</Button> : null}{!voiceActive && snapshot.voiceConversationAvailable && !permissionDenied ? <Button variant="secondary" disabled={unavailable} onClick={startVoice}>Volver a conectar</Button> : null}</div> : null}
      <OliviaComposer textareaRef={textareaRef} draft={draft} setDraft={setDraft} sendMessage={sendMessage} recording={recording} frame={audioFrame} stopRecording={stopRecording} startRecording={startRecording} startVoice={startVoice} stopVoice={endVoiceSession} finishVoiceTurn={() => voiceRef.current?.finishTurn()} voiceRecording={voiceState === "recording"} voiceAvailable={snapshot.voiceConversationAvailable === true} voiceActive={voiceActive} muted={muted} toggleMute={toggleMute} disabled={exhausted || unavailable || !conversationRef.current} busy={busy} sendingDisabled={voiceState === "connecting"} cancelRequest={cancelRequest} attachments={attachments} addFiles={addFiles} removeFile={removeFile} />
      <details className="fm-olivia-usage-details"><summary>Uso y costos</summary><OliviaUsage quota={quota} estimate={estimate} money={money} compact={viewport?.height < 500} exhausted={exhausted} /></details>
      {admin && developer ? <OliviaDeveloperPanel estimate={estimate} quota={quota} latency={latency} voiceMetrics={voiceMetrics} voiceConfiguration={snapshot.voiceConfiguration} telemetry={snapshot.telemetry} turnTrace={turnTrace} money={money} /> : null}
      {!admin && exhausted ? <div className="fm-olivia-quota-request"><Button variant="secondary" disabled={busy || !online || quotaRequested} onClick={() => setQuotaRequestOpen(true)}>{quotaRequested ? "Ampliación solicitada" : "Solicitar ampliación"}</Button>{quotaNotice ? <p role="status">{quotaNotice}</p> : null}</div> : null}
    </aside></div> : null}
    <Modal open={quotaRequestOpen} title="Solicitar ampliación de Olivia" description="Enviaremos al Administrador una solicitud de ampliación para tu cupo del período actual." onClose={() => { if (!busy) setQuotaRequestOpen(false); }} footer={<div className="fm-dialog-actions"><Button variant="secondary" disabled={busy} onClick={() => setQuotaRequestOpen(false)}>No</Button><Button loading={busy} onClick={requestQuotaExtension}>Sí, solicitar</Button></div>}><p>La solicitud no cambia tu cupo. El Administrador puede conceder una ampliación temporal desde Configuración de IA.</p>{error ? <p className="fm-form-error" role="alert">{error}</p> : null}</Modal>
    </div>, document.body)}
  </>;
}
