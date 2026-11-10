import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
const OliviaDeveloperPanel = lazy(() => import('./OliviaDeveloperPanel'));
const OliviaGeminiDiagnostic = lazy(() => import('./OliviaGeminiDiagnostic'));
import { NaturalVoiceConversation, latencyPercentile } from "./naturalVoice.mjs";
import { GeminiLiveSession } from "./geminiLive.mjs";
import { isGreetingOnly } from "../../shared/oliviaSpeechText.mjs";
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
import "./olivia-gold.css";
import { Icon } from '../components/icons';
import { OliviaLauncherPortal } from "./LauncherHost";
import { getUiGuide, UI_GUIDE_VERSION } from '../../shared/oliviaUiGuides.mjs';
import { DelegatedTaskClient } from './delegatedTaskClient.mjs';
import OliviaDelegatedTasks from './OliviaDelegatedTasks';
import { recoveryDiagnostic } from './liveRecovery.mjs';
import { InteractionCosts } from './interactionCosts.mjs';
import { mergeVoiceCollection } from '../../shared/oliviaVoiceCollection.mjs';

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
  const optionsRef = useRef(null);
  const [hydrating, setHydrating] = useState(false);
  const hydrationRef = useRef(null);
  const [floatingEnabled] = useFloatingOlivia(user.uid);
  const minimizeChat = useCallback(() => { setOpen(false); setMinimized(true); requestAnimationFrame(() => launcherRef.current?.focus()); }, []);
  const openChat = () => { setOpen(true); setMinimized(false); };
  const closeButtonRef = useRef(null);
  const drawerRef = useOverlay(open, minimizeChat, closeButtonRef);
  const [snapshot, setSnapshot] = useState({ messages: [], state: "information", pendingAction: null, usage: null });
  const snapshotRef=useRef(snapshot);snapshotRef.current=snapshot;
  const [delegatedTasks,setDelegatedTasks]=useState([]);
  const delegatedTasksRef=useRef([]);delegatedTasksRef.current=delegatedTasks;
  const delegatedClient=useRef(null);
  const [taskControlId,setTaskControlId]=useState(null);
  const interactionCosts = useRef(new InteractionCosts());
  const taskOrigins = useRef(new Map());
  const voiceCollectionRef = useRef(null);
  const directPersistChain = useRef(Promise.resolve());
  const [,refreshCosts] = useState(0);
  const turnTimings=useRef(new Map());
  const turnTraces=useRef(new Map());
  const [developer, setDeveloper] = useState(false);
  const [geminiDiagnosticActive, setGeminiDiagnosticActive] = useState(false);
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
  const [draft, setDraftState] = useState("");
  const draftRef = useRef("");
  const setDraft = (value) => {
    const next = typeof value === "function" ? value(draftRef.current) : value;
    draftRef.current = next; setDraftState(next);
  };
  const audioSecondsRef = useRef(-1);
  const submittingRef = useRef(false);
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
  const voiceNoticeTimer = useRef(null);
  useEffect(() => () => clearTimeout(voiceNoticeTimer.current), []);
  const voiceMetricsSamples = useRef({ turnToTranscript: [], transcriptToVoice: [], ttfa: [] });
  const voiceStartAt = useRef(null);
  const voiceTurnTiming = useRef(null);
  const voiceTrace = useRef(null);
  const connectionTrace = useRef(null);
  const visibleTranscriptTurns = useRef(new Set());
  const voiceSettingsRef = useRef(snapshot.voiceSettings);voiceSettingsRef.current=snapshot.voiceSettings;
  const [turnTrace,setTurnTrace]=useState(null);
  const [connectionTraceView,setConnectionTraceView]=useState(null);
  const [voiceTurnTraces,setVoiceTurnTraces]=useState([]);
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
      if(conversationRef.current!==result.conversationId)voiceCollectionRef.current=null;
      conversationRef.current = result.conversationId;
      rememberConversation(user.uid, result.conversationId);
    }
    if(result.conversationContext&&Object.hasOwn(result.conversationContext,'voiceCollection')){
      const incoming=result.conversationContext.voiceCollection;
      voiceCollectionRef.current=mergeVoiceCollection(voiceCollectionRef.current,incoming);
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

  // Session hydration never owns the business busy flag or the composer.
  const hydrateSession = useCallback((operation, fields = {}) => {
    if (hydrationRef.current) return hydrationRef.current.promise;
    const controller = new AbortController();
    const hydration = { controller, promise: null };
    setHydrating(true);
    hydration.promise = oliviaClient.request({ operation: operation || (conversationRef.current ? 'resume' : 'state'), conversationId: conversationRef.current, requestId: requestId(), screenContext: contextRef.current, ...fields }, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted && mounted.current) apply(result); return result; })
      .catch(failure => { if (!controller.signal.aborted && mounted.current) { setError(failure.message); setErrorCode(failure.code || ''); } throw failure; })
      .finally(() => { if (hydrationRef.current === hydration) { hydrationRef.current = null; if (mounted.current) setHydrating(false); } });
    hydrationRef.current = hydration;
    return hydration.promise;
  }, [apply]);

  const recordVoiceMetric = (key, duration, flow = voiceTurnTiming.current?.flow) => {
    if (!Number.isFinite(duration) || duration < 0) return;
    const samples = voiceMetricsSamples.current;
    samples[key] = [...(samples[key] || []), duration].slice(-100);
    if(flow && ['silence','voiceEndToUsefulAudio','voiceEndToComplete'].includes(key)){const grouped=flow+'.'+key;samples[grouped]=[...(samples[grouped] || []),duration].slice(-100);}
    const summary = (name) => ({ medianMs: latencyPercentile(samples[name] || [], 0.5), p90Ms: latencyPercentile(samples[name] || [], 0.9), p95Ms: latencyPercentile(samples[name] || [], 0.95), count: (samples[name] || []).length });
    setVoiceMetrics(current => ({...current,...Object.fromEntries(Object.keys(samples).map(name=>[name,summary(name)])),ttfaScheduled:summary('ttfa')}));
  };

  const saveTurnTrace = (trace = voiceTrace.current) => {
    const next = typeof trace?.snapshot === "function" ? trace.snapshot() : trace;
    if (!next) return;
    setTurnTrace(next);
    setVoiceTurnTraces(current => {
      const index = current.findIndex(item => item.id === next.id);
      const updated = current.slice();
      if (index >= 0) updated[index] = next; else updated.push(next);
      return updated.slice(-100);
    });
  };
  const markTurnTrace = (stage, metadata = {}, at = performance.now()) => {
    let trace=metadata.turnId?turnTraces.current.get(metadata.turnId):voiceTrace.current;
    if(!trace && metadata.turnId){trace=latencyTrace({id:metadata.turnId,origin:'client'});turnTraces.current.set(metadata.turnId,trace);if(turnTraces.current.size>100)turnTraces.current.delete(turnTraces.current.keys().next().value);}
    trace?.mark(stage, metadata, at);
    saveTurnTrace(trace);
  };
  const markConnectionTrace = (stage, metadata = {}, at = performance.now()) => {
    connectionTrace.current?.mark(stage, metadata, at);
    if (connectionTrace.current) setConnectionTraceView(connectionTrace.current.snapshot());
  };

  const updateGeminiUsage = usage => setSnapshot(current => {
    const next = {...(current.geminiLiveUsage || {}), ...usage};
    const providers = Number(next.lunaSol?.estimatedUsd || 0);
    return {...current, geminiLiveUsage:{...next, combinedEstimatedSpendUsd:Number(next.spendUsd || 0) + providers,
      combinedUnconfirmedCount:Number(next.unconfirmedQueryCount || 0) + Number(next.lunaSol?.unconfirmedCalls || 0)}};
  });

  useEffect(()=>{
    if(!snapshot.conversationId || !snapshot.voiceConversationAvailable)return;
    const client=new DelegatedTaskClient({request:(payload)=>oliviaClient.request(payload),conversationId:snapshot.conversationId,
      onChange:tasks=>{if(!mounted.current)return;const previous=delegatedTasksRef.current;setDelegatedTasks(tasks);voiceRef.current?.transcriber?.watchTasks?.(tasks);for(const task of tasks){interactionCosts.current.task(taskOrigins.current.get(task.id),task);if(task.telemetry?.trace)saveTurnTrace({...task.telemetry.trace,events:task.telemetry.trace.events.map(event=>({...event,taskId:task.id,jobId:task.jobId}))});}refreshCosts(n=>n+1);
        if(tasks.some(task=>['completed','failed','cancelled','needs-input','awaiting-confirmation'].includes(task.status)&&previous.some(old=>old.id===task.id&&old.status!==task.status))){const parent=snapshot.conversationId;void oliviaClient.request({operation:'resume',conversationId:parent}).then(result=>{if(mounted.current&&conversationRef.current===parent&&Array.isArray(result.messages))setSnapshot(current=>({...current,messages:prependHistoryMessages(current.messages,result.messages)}));}).catch(()=>{});}},
      onTrace:(stage,metadata)=>markTurnTrace(stage,metadata)});
    delegatedClient.current=client;
    setDelegatedTasks([]);
    client.refresh().catch(()=>{});
    const timer=setInterval(()=>{if(!client.runningRequests && client.tasks.some(t=>['queued','dispatching','running'].includes(t.status)))client.refresh().catch(()=>{});},3000);
    return()=>{clearInterval(timer);client.close();if(delegatedClient.current===client)delegatedClient.current=null;};
  },[snapshot.conversationId,snapshot.voiceConversationAvailable]);

  const controlTask=async(task,action)=>{
    if(!delegatedClient.current)return;
    setTaskControlId(task.id);
    try{await delegatedClient.current.control({taskId:task.id,action,visualConfirmation:action==='confirm',actionId:task.pendingAction?.id,confirmationToken:task.pendingAction?.confirmationToken});}
    catch(error){setVoiceNotice(error.message);}
    finally{setTaskControlId(null);}
  };

  const perform = useCallback(async (operation, fields = {}, identity = requestId(), hooks = {}) => {
    if (operation === 'state' || operation === 'resume') return hydrateSession(operation, fields);
    if (requestRef.current) throw new Error("Esperá a que termine la solicitud actual.");
    const controller = new AbortController();
    let backendAccepted = false;
    const notifyAccepted = event => { if (backendAccepted) return; backendAccepted = true; hooks.onAccepted?.(event); };
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
        interactionCosts.current.begin(identity);refreshCosts(n=>n+1);
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
            notifyAccepted(event);
          }
          if (event.type === "accepted") {notifyAccepted(event);trace?.mark('request.accepted'); setOptimistic(event.message); conversationRef.current = event.conversationId; }
          if (event.type === "delta") {
            if (streamStart.current && streamStart.current.firstDeltaMs == null) streamStart.current.firstDeltaMs = performance.now() - streamStart.current.sentAt;
            setStreamText((current) => current + event.delta);
          }
          if (event.type === "phase") {trace?.mark('request.phase',{count:event.tools?.length || 0}); setPhase(event.label); if (event.tools) setStreamText(""); }
        } : undefined });
      if (!mounted.current || controller.signal.aborted || requestRef.current !== controller) return result;
      trace?.mark('request.complete');setTurnTrace(trace?.snapshot());
      apply(result);
      if(operation==='chat'||operation==='waitChat'){interactionCosts.current.luna(identity,result.telemetry);refreshCosts(n=>n+1);}
      if (operation === "chat") { setOptimistic(null); setStreamText(""); setLatency({ ...streamStart.current, totalMs: performance.now() - streamStart.current.sentAt }); }
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
      if (requestRef.current === controller) { requestRef.current = null; if (mounted.current) setBusy(false); }
    }
  }, [apply, hydrateSession]);

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
      controller?.abort(preserveTask ? "superseded" : "user-stop"); voiceRef.current?.stopPlayback();
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
      hydrationRef.current?.controller.abort();
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
  }, [admin, user.uid]);

  useEffect(() => {
    if (!open || busy || hydrating || !snapshot.conversationId || recording || voiceActive || !draft.trim()) return undefined;
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
  }, [open, busy, hydrating, draft, snapshot.conversationId, estimateContextKey, recording, voiceActive]);

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
      stopRecording(true);
      const wasActive = voiceRef.current && !voiceRef.current.closed;
      voiceRef.current?.close(); voiceRef.current = null;
      if (mounted.current && wasActive) { setVoiceState("idle"); setVoiceFailure(true); setVoiceNotice("La voz se interrumpió. Volvé a iniciar la conversación cuando el navegador y la conexión estén disponibles."); setSessionNotice("La voz se interrumpió"); }
    };
    const offline = () => {
      stopRecording(true);
      const live=voiceRef.current?.transcriber;
      if(live?.reconnect && !live.closed && !live.failed){void live.reconnect();return;}
      disconnect();
    };
    window.addEventListener("offline", offline);
    window.addEventListener("pagehide", disconnect);
    return () => { window.removeEventListener("offline", offline); window.removeEventListener("pagehide", disconnect); };
  }, [stopRecording]);

  const sendMessage = async (dictated) => {
    const ready = attachments.filter((file) => file.id);
    const message = (typeof dictated === "string" ? dictated : draft).trim() || (ready.length ? "Analizá los archivos adjuntos." : "");
    if (!message || submittingRef.current || recording || exhausted || unavailable || attachments.some((file) => file.status === "uploading")) return;
    if (requestRef.current && !["chat", "waitChat"].includes(retryRef.current?.operation)) return;
    const submission = {};
    submittingRef.current = submission;
    if (requestRef.current && !await cancelRequest({ preserveTask: true })) { if (submittingRef.current === submission) submittingRef.current = false; return; }
    try {
      if (hydrationRef.current) await hydrationRef.current.promise;
      else if (!snapshotRef.current.conversationId) await hydrateSession();
      if (!mounted.current || !conversationRef.current) return;
      setDraft(current => current === message || typeof dictated === 'string' ? '' : current);
      const work = perform("chat", { message, inputMode: typeof dictated === "string" ? "dictation" : "text", attachmentIds: ready.map((file) => file.id), attachmentPreviews: ready.map(({ name, type }) => ({ name, type })) });
      if (submittingRef.current === submission) submittingRef.current = false;
      const result = await work;
      ready.forEach((file) => removeFile(file.localId));
    } catch { /* Error and retry use the original request ID. */ }
    finally { if (submittingRef.current === submission) submittingRef.current = false; }
  };

  const newConversation = async () => {
    if (busy || hydrating || recording || voiceActive) return;
    if (snapshot.pendingAction && !["conversation-not-found", "session-changed", "permission-scope-changed", "conversation-expired"].includes(errorCode)) {
      try { await perform("cancel", { confirmationToken: snapshot.pendingAction.confirmationToken, actionId: snapshot.pendingAction.id }); }
      catch { return; }
    }
    conversationRef.current = null;
    voiceCollectionRef.current = null;
    historyRef.current?.abort(); historyRef.current = null; historyAnchorRef.current = null; setHistoryBusy(false);
    forgetConversation(user.uid);
    confirmationIds.current.clear();
    setSnapshot({ messages: [], state: "INFORMACION", pendingAction: null, usage: null });
    setDraft(""); setArchived([]); setMessagesCursor(undefined); setDraftEstimate(null); setChatsOpen(false);
    attachmentFiles.current.forEach((_, localId) => removeFile(localId));
    hydrateSession('state').catch(() => {});
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
    if (busy || audioRef.current || (voiceRef.current && !voiceRef.current.closed) || exhausted || unavailable || !conversationRef.current) return;
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

  const startVoice = () => {
    if (!snapshot.voiceConversationAvailable) {
      clearTimeout(voiceNoticeTimer.current);
      setVoiceNotice(OLIVIA_VOICE_UNAVAILABLE_MESSAGE);
      voiceNoticeTimer.current = setTimeout(() => setVoiceNotice(""), 3000);
      return;
    }
    setVoiceNotice("");
    if (geminiDiagnosticActive || busy || recording || voiceRef.current || exhausted || unavailable || snapshot.pendingAction || !conversationRef.current) return;
    const hybridLive = Boolean(snapshot.voiceSettings?.hybridLiveAvailable && snapshot.voiceSettings?.hybridLiveEnabled);
    if (!hybridLive) { setVoiceNotice("Gemini Live no está disponible en este preview. Podés seguir por escrito o intentar más tarde."); return; }
    setError(""); setCaption(""); setMuted(false); setVoiceFailure(false); setPermissionDenied(false); setSessionNotice(""); voiceTurnTiming.current = null;
    voiceMetricsSamples.current={};setVoiceMetrics({geminiLiveStatus:'connecting',geminiLiveFallback:null});turnTimings.current.clear();turnTraces.current.clear();
    voiceStartAt.current = performance.now(); connectionTrace.current = latencyTrace({ id: requestId(), origin: "client" });
    connectionTrace.current.mark("voice.connect.start", {}, voiceStartAt.current); voiceTrace.current = null; visibleTranscriptTurns.current.clear();
    setVoiceTurnTraces([]); setTurnTrace(null); setConnectionTraceView(connectionTrace.current.snapshot());
    const connection = new NaturalVoiceConversation({
      adaptiveEndpointing:snapshot.voiceSettings?.latencyMode===true,
      onTrace:({stage,at,startedAt,voiceEndedAt,turnId,endpointMs,durationMs,status,...metadata})=>{
        const sessionStage = stage.startsWith('audio.context.') || stage.startsWith('microphone.') || stage.startsWith('voice.capture.') || stage === 'voice.mic.ready' || stage.startsWith('gemini.token.') || stage.startsWith('gemini.websocket.') || stage.startsWith('gemini.setup.') || stage === 'gemini.capture.ready' || stage === 'gemini.session.ready' || stage === 'transcription.session.ready';
        const safeMetadata = { ...metadata, ...(Number.isFinite(durationMs) ? {durationMs} : {}), ...(status ? {status} : {}), ...(Number.isFinite(startedAt) && Number.isFinite(at) ? {durationMs:at-startedAt} : {}) };
        if(sessionStage) markConnectionTrace(stage,safeMetadata,at);
        else markTurnTrace(stage,{...safeMetadata,...(turnId?{turnId}:{}),...(Number.isFinite(endpointMs)?{endpointMs}:{}),...(Number.isFinite(voiceEndedAt)?{durationMs:at-voiceEndedAt}:{})},at);
        if(stage==='voice.mic.ready' && Number.isFinite(voiceStartAt.current))recordVoiceMetric('micReady',at-voiceStartAt.current);
        if(stage==='gemini.session.ready' && Number.isFinite(startedAt)){recordVoiceMetric('geminiConnect',at-startedAt);recordVoiceMetric('clickToGeminiReady',at-(voiceStartAt.current || at));setVoiceMetrics(current=>({...current,geminiLiveStatus:'connected'}));}
        if(stage==='voice.turn.end'){interactionCosts.current.begin(turnId);refreshCosts(n=>n+1);voiceTurnTiming.current={turnId,endedAt:at,voiceEndedAt:Number.isFinite(voiceEndedAt)?voiceEndedAt:at,endpointMs,flow:hybridLive?'gemini':'controlled'};turnTimings.current.set(turnId,voiceTurnTiming.current);if(turnTimings.current.size>100)turnTimings.current.delete(turnTimings.current.keys().next().value);}
      },
      createTranscriber: async(stream,onPartial,signal)=>{
        const live=new GeminiLiveSession({
            request:(payload,options)=>oliviaClient.hybridLive(payload,options),
            conversationId:conversationRef.current,
            audioContext:connection.context,
            onInputFrame:frame=>connection.processInputFrame(frame),
            backgroundTools:true,
            getConversationContext:()=>({...snapshotRef.current.conversationContext,voiceCollection:voiceCollectionRef.current,capabilities:snapshotRef.current.capabilities,pendingAction:Boolean(snapshotRef.current.pendingAction)||delegatedTasksRef.current.some(t=>t.status==='awaiting-confirmation'),collectingTask:Boolean(snapshotRef.current.conversationContext?.collectingTask)||delegatedTasksRef.current.some(t=>t.status==='needs-input'),activeTask:Boolean(snapshotRef.current.conversationContext?.activeTask)||delegatedTasksRef.current.some(t=>['queued','running','dispatching','confirming','cancelling'].includes(t.status))}),
            onTrace:event=>{
              const {stage,at,...metadata}=event;
              const sessionStage=stage.startsWith('gemini.token.') || stage.startsWith('gemini.websocket.') || stage.startsWith('gemini.setup.') || stage==='gemini.capture.ready';
              if(sessionStage)markConnectionTrace(stage,metadata,at);
              else markTurnTrace(stage,metadata,at);
            },
            onState:state=>{if(mounted.current && voiceRef.current===connection)setVoiceState(state);},
            onPartial:text=>{onPartial(text);if(mounted.current && text)setCaption(text);},
            onTranscript:(text,{turnId,turnIndex}={})=>{if(mounted.current){if(turnId && !visibleTranscriptTurns.current.has(turnId)){visibleTranscriptTurns.current.add(turnId);markTurnTrace('assistant.text.visible.first',{turnId,turnIndex,source:'gemini'},performance.now());}setCaption(text);}},
            onClassification:({durationMs,direct,route,kind,source,turnIndex,turnId,collection,newTask,independentRead})=>{
              if(collection)voiceCollectionRef.current=mergeVoiceCollection(voiceCollectionRef.current,collection);
              else if(newTask && !independentRead && ['collecting','ready','paused'].includes(voiceCollectionRef.current?.status))voiceCollectionRef.current={...voiceCollectionRef.current,status:'superseded',revision:voiceCollectionRef.current.revision+1,nextStep:'new-request-scope'};
              recordVoiceMetric(source==='local-policy'?'geminiLocalClassification':'geminiClassification',durationMs);
              const label=route==='local-direct'?'Gemini directo · política local':route==='model-tool'?'Delegado con herramienta Gemini':route==='local-policy-delegate'?'Delegado por política local':'Delegado por política backend';
              setVoiceMetrics(current=>({...current,geminiLastRoute:label,geminiLastTurnIndex:turnIndex}));
              markTurnTrace('gemini.classification',{turnId,route:route || (direct?'direct':'delegate'),kind,source,durationMs,turnIndex},performance.now());
            },
            onFirstAudio:(at,{turnId,sourceTurnId,taskId,turnIndex,acknowledgement})=>{if(mounted.current && voiceRef.current===connection){setVoiceState('speaking');const timing=turnTimings.current.get(sourceTurnId || turnId);if(timing){const duration=at-timing.voiceEndedAt;if(acknowledgement)recordVoiceMetric('voiceEndToAcknowledgement',duration,'delegate');else if(taskId)recordVoiceMetric('delegatedVoiceEndToResult',duration,'delegate');else{recordVoiceMetric('voiceEndToUsefulAudio',duration,'gemini');recordVoiceMetric('geminiVoiceEndToUsefulAudio',duration);recordVoiceMetric(turnIndex===1?'geminiFirstTurnVoiceEndToUsefulAudio':'geminiLaterTurnVoiceEndToUsefulAudio',duration);}}}},
            onAudioComplete:(at,{turnId,sourceTurnId,taskId}={})=>{const timing=turnTimings.current.get(sourceTurnId || turnId);if(timing)recordVoiceMetric(taskId?'delegatedVoiceEndToComplete':'voiceEndToComplete',at-timing.voiceEndedAt,taskId?'delegate':'gemini');if(mounted.current && voiceRef.current===connection && !connection.recordingTurn && !connection.transcriber?.currentTurn?.pending)setVoiceState(mutedRef.current?'muted':'listening');},
            onTurnComplete:turn=>{
              markTurnTrace('assistant.result.complete',{turnId:turn.turnId,turnIndex:turn.turnIndex,route:turn.delegated?'delegate':'direct',status:turn.providerIncomplete?'provider-incomplete':'complete'},performance.now());
              if(turn.delegated){if(!turn.pendingTask && turn.noAudio && turn.assistantText){setCaption(turn.assistantText);setVoiceNotice('La respuesta quedó en pantalla, pero no pude reproducirla. Podés pedirme que la repita.');}return;}
              if(!turn.userText || !turn.assistantText)return;
              setCaption(turn.assistantText);
              if(turn.noAudio)setVoiceNotice('La respuesta quedó en pantalla, pero no pude reproducirla. Podés pedirme que la repita.');
              const persistStartedAt=performance.now();markTurnTrace('history.persist.start',{turnId:turn.turnId,turnIndex:turn.turnIndex,operation:'geminiDirectTurn'},persistStartedAt);
              const parent=conversationRef.current;
              directPersistChain.current=directPersistChain.current.catch(()=>{}).then(()=>oliviaClient.request({operation:'geminiDirectTurn',conversationId:parent,requestId:turn.turnId,userText:turn.userText,assistantText:turn.assistantText})).then(result=>{markTurnTrace('history.persist.end',{turnId:turn.turnId,turnIndex:turn.turnIndex,durationMs:performance.now()-persistStartedAt,status:'ok'},performance.now());if(mounted.current && voiceRef.current===connection && conversationRef.current===parent)apply(result);}).catch(failure=>{markTurnTrace('history.persist.end',{turnId:turn.turnId,turnIndex:turn.turnIndex,durationMs:performance.now()-persistStartedAt,status:'error'},performance.now());if(mounted.current)setVoiceNotice('No pude guardar la transcripción en este chat.');});
            },
            onToolCall:async(call,inputText,context={})=>{
              if(context.transcriptComplete!==true || !String(inputText || '').trim())throw new Error('No se recibió la transcripción final; repetí la solicitud.');
              if(!delegatedClient.current)throw new Error('La cola de tareas todavía no está lista.');
              if(context.conversationDraft)await directPersistChain.current;
              return delegatedClient.current.run(call,String(inputText).trim(),{...context,requestId:context.requestId || requestId(),screenContext:contextRef.current,
                collectionRevision:context.conversationDraft?.revision,
                supersedesCollectionRevision:context.newTask && voiceCollectionRef.current?.status==='superseded'?voiceCollectionRef.current.revision-1:undefined,
                onAccepted:task=>{if(context.conversationDraft)voiceCollectionRef.current={...context.conversationDraft,status:'delegated',taskId:task.id};if(['new','continue'].includes(call.args?.action))taskOrigins.current.set(task.id,context.turnId);interactionCosts.current.task(taskOrigins.current.get(task.id),task);refreshCosts(n=>n+1);markTurnTrace('olivia.delegate.accepted',{turnId:context.turnId,taskId:task.id,jobId:task.jobId,status:task.status});context.onAccepted?.(task);}});
            },
            onUsage:(usage,correlation={})=>{interactionCosts.current.voice(correlation.sourceTurnId || taskOrigins.current.get(correlation.taskId) || correlation.turnId,usage,`${correlation.sessionId}:${correlation.turnId}`);refreshCosts(n=>n+1);updateGeminiUsage(usage);setVoiceMetrics(current=>({...current,geminiLiveLastUsage:usage}));markTurnTrace('provider.usage',{...correlation,provider:'gemini',model:'gemini-3.8-live',costUsd:usage.costUsd,inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,status:usage.measurement || 'unconfirmed'});},
            onSessionClosed:updateGeminiUsage,
            onRecovery:recovery=>{if(mounted.current && voiceRef.current===connection){if(recovery.status==='recovering'){connection.resetInputTurn();setVoiceState('reconnecting');}setVoiceMetrics(current=>({...current,geminiLiveStatus:recovery.status,geminiRecovery:recovery}));if(recovery.status==='connected')setVoiceState(mutedRef.current?'muted':'listening');}},
            onNotificationDelivered:payload=>delegatedClient.current.acknowledge(payload),
            onNotice:notice=>{if(mounted.current && voiceRef.current===connection)setVoiceNotice(notice);},
            onUnavailable:failure=>{if(mounted.current && voiceRef.current===connection){setVoiceMetrics(current=>({...current,geminiLiveStatus:'unavailable',geminiLiveFallback:recoveryDiagnostic(failure)}));setVoiceNotice('No pude recuperar la voz. Podés seguir escribiendo o volver a intentarlo.');setVoiceState('idle');connection.close();voiceRef.current=null;}},
        });
        signal.addEventListener('abort',()=>live.close(),{once:true});
        if(signal.aborted){live.close();throw new DOMException('Finalizada','AbortError');}
        try {
          const ready=await live.start(stream);
          live.watchTasks(delegatedTasksRef.current);
          if(mounted.current && voiceRef.current===connection)setVoiceMetrics(current=>({...current,transcriptionMode:'Gemini Live · audio nativo',geminiLiveStatus:'connected'}));
          return ready;
        } catch(error) { live.close(); throw error; }
      },
      onPartial:text=>{if(mounted.current && text)setCaption(text);},
      onNotice:notice=>{if(mounted.current && voiceRef.current===connection)setVoiceNotice(notice);},
      silenceMs: Math.max(1900, snapshot.voiceSettings?.turnEndSilenceMs || 1900),
      maxSeconds: snapshot.audioLimits?.maxSeconds || 60,
      maxBytes: snapshot.audioLimits?.maxBytes || 4 * 1024 * 1024,
      onState: (state) => { if (state === "ended" && voiceRef.current === connection) voiceRef.current = null; if (mounted.current) setVoiceState(state); },
      onSpeechStart: ({ at,bargeIn,turnId }) => {
        if(!voiceTrace.current || voiceTrace.current.snapshot().id!==turnId)voiceTrace.current=latencyTrace({id:turnId,origin:'client'});
        turnTraces.current.set(turnId,voiceTrace.current);
        markTurnTrace('voice.start',{turnId,kind:'microphone'},Number.isFinite(at)?at:performance.now());
        if(bargeIn)markTurnTrace('voice.barge_in',{turnId,source:'microphone'},Number.isFinite(at)?at:performance.now());
        if (mounted.current) { setVoiceNotice(""); setVoiceFailure(false); }
      },
      onError: (failure) => { if (mounted.current && voiceRef.current===connection && !connection.closed) { setPermissionDenied(failure.name === "NotAllowedError"); setVoiceFailure(failure.name !== "NotAllowedError"); setVoiceNotice(failure.name === "NotAllowedError" ? "Permití el micrófono para conversar por voz." : "No pude iniciar la voz. Podés seguir escribiendo o volver a intentarlo."); setVoiceState("idle"); } },
    });
    voiceRef.current = connection;
    setVoiceState("connecting");
    connection.starting = connection.start().catch((failure) => { if (mounted.current && voiceRef.current===connection && !connection.closed) setVoiceNotice(failure.name==="NotAllowedError"?"Permití el micrófono para conversar por voz.":"No pude iniciar la voz. Podés seguir escribiendo o volver a intentarlo."); });
  };

  const pending = snapshot.pendingAction;
  const visual = interactionState({ disabled: unavailable, voiceDisabled: snapshot.voiceConversationAvailable === false, permissionDenied, error, voiceError: voiceFailure, connecting: ['connecting','reconnecting'].includes(voiceState), recording: recording || voiceState === "recording", speaking: voiceState === "speaking", busy, activeJob: snapshot.activeChatJob, processing: ["processing", "synthesizing"].includes(voiceState), listening: voiceActive, muted, pending, phase, notice: sessionNotice });
  const floatingVisible = floatingEnabled && minimized && !open;
  const toggleMute = () => { const next = !muted; setMuted(next); voiceRef.current?.setMuted(next); };
  const floatingLabel = muted && voiceActive ? "Micrófono silenciado" : visual.pill || (pending ? "Revisar acción" : ({ listening: "Escuchando", thinking: "Pensando", speaking: "Hablando", connecting: "Conectando", disabled: "Voz desactivada" }[visual.state] || "Olivia"));
  const sessionControls = (voiceActive || recording) ? <div className="fm-olivia-session-controls"><small>{muted ? "Micrófono silenciado" : "Micrófono activado"}</small>{voiceActive ? <IconButton label={muted ? "Reactivar micrófono de Olivia" : "Silenciar micrófono de Olivia"} icon={muted ? "MicOff" : "Mic"} aria-pressed={muted} onClick={toggleMute} /> : null}<IconButton label="Finalizar sesión de voz de Olivia" icon="Square" onClick={() => { stopRecording(true); endVoiceSession(); }} /></div> : null;
  const quota = snapshot.usage;
  const estimate = draftEstimate || snapshot.estimate;
  const money = formatOliviaCost;
  const visibleMessages = prependHistoryMessages(archived, optimistic ? [...snapshot.messages.filter((entry) => entry.id !== optimistic.id), optimistic] : snapshot.messages);
  const selectOption = action => { if (optionsRef.current) { optionsRef.current.open = false; optionsRef.current.querySelector('summary')?.focus(); } action(); };
  const dictateDuringConnection = async () => {
    const connection = voiceRef.current;
    endVoiceSession();
    await connection?.starting;
    if (mounted.current && !voiceRef.current) void startRecording();
  };

  return <>
    {!floatingVisible && !open ? <OliviaLauncherPortal><div className="fm-olivia-launcher-group"><button ref={launcherRef} type="button" className="fm-olivia-launcher" aria-label="Abrir Olivia, asistente de Flor Mía" aria-expanded={false} aria-controls="fm-olivia-drawer" onClick={openChat}>
      <EqualizerOrb state={visual.state} size={27.2} label="Olivia" /><span className="fm-olivia-launcher__label"><strong>Olivia</strong><small>Asistente de IA</small></span>
    </button></div></OliviaLauncherPortal> : null}
    {createPortal(<div className="fm-management-body fm-olivia-modal-host">
    {!open && (floatingVisible || sessionControls) ? <div className={`fm-olivia-floating${floatingVisible ? '' : ' fm-olivia-floating--controls'}`} aria-label="Olivia minimizada">{floatingVisible ? <button ref={launcherRef} type="button" className="fm-olivia-floating__open" aria-label="Abrir conversación con Olivia" aria-controls="fm-olivia-drawer" onClick={openChat}><OrbPill as="span" orb={EqualizerOrb} state={visual.state} text={floatingLabel} orbScale={.8} /></button> : null}{sessionControls}</div> : null}
    {open ? <div className="fm-olivia-overlay" role="presentation"><aside ref={drawerRef} id="fm-olivia-drawer" className={`fm-olivia-drawer${viewport?.height < 500 ? " is-compact" : ""}`} style={viewport ? { "--olivia-viewport-height": `${viewport.height}px`, "--olivia-viewport-top": `${viewport.top}px` } : undefined} role="dialog" aria-modal="true" aria-labelledby="fm-olivia-title">
      <header className="fm-olivia-header">
        <div className="fm-olivia-identity"><div className="fm-olivia-title-line"><h2 id="fm-olivia-title">Olivia<span className="fm-olivia-brand-dot" aria-hidden="true" /></h2></div><small>Flor Mía · Tu asistente</small></div>
        <details ref={optionsRef} className="fm-olivia-options" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); event.stopPropagation(); } }}><summary aria-label="Opciones de Olivia"><Icon name="MoreHorizontal" /></summary><div role="group" aria-label="Opciones de Olivia">
          <button type="button" aria-label="Mis conversaciones" disabled={busy || hydrating || recording || voiceActive || historyBusy} onClick={() => selectOption(() => { setDeveloper(false); setChatsOpen(!chatsOpen); if (!chatsOpen) loadHistory('chats'); })}>Mis conversaciones</button>
          <button type="button" aria-label="Nueva conversación" disabled={busy || hydrating || recording || voiceActive} onClick={() => selectOption(() => { setDeveloper(false); void newConversation(); })}>Nueva conversación</button>
          <button type="button" aria-label="Preferencias" onClick={() => selectOption(() => { setDeveloper(false); setPreferencesOpen(value => !value); })}>Preferencias</button>
          <button type="button" aria-label="Configuración de voz" onClick={() => selectOption(() => { setDeveloper(false); setPreferencesOpen(true); })}>Configuración de voz</button>
          {admin ? <button type="button" aria-label="Panel Developer" onClick={() => selectOption(() => { setDeveloper(true); setPreferencesOpen(false); })}>Panel Developer</button> : null}
        </div></details>
        <IconButton ref={closeButtonRef} label="Minimizar Olivia" icon="Minus" onClick={minimizeChat}/>
      </header>
      <div className="fm-olivia-chat-surface" hidden={admin && developer}>
      {preferencesOpen ? <section aria-label="Preferencias y voz"><OliviaPreferences uid={user.uid} /><p className="fm-olivia-preference-note">El dictado prepara un mensaje para revisar. Conversar por voz inicia Gemini; el micrófono se activa solo cuando lo pedís.</p></section> : null}
      {chatsOpen ? <section className="fm-olivia-chats" aria-label="Mis chats"><h3>Mis chats</h3><p>Retomá una conversación o creá una nueva. El historial se guarda en tu cuenta durante el período de retención.</p>{chats.map((chat) => <button type="button" key={chat.id} disabled={busy || historyBusy} aria-current={chat.id === snapshot.conversationId ? "true" : undefined} onClick={() => reopen(chat.id)}><strong>{chat.title}</strong><small>{formatDateTime(chat.updatedAt)}</small></button>)}{!chats.length && !historyBusy ? <p>Todavía no hay chats guardados.</p> : null}{chatsCursor ? <Button variant="secondary" disabled={historyBusy} onClick={() => loadHistory("chats", true)}>Ver más chats</Button> : null}{historyBusy ? <p role="status">Cargando chats…</p> : null}</section> : null}
      {historyError ? <p className="fm-olivia-error" role="alert">{historyError}</p> : null}
      <OliviaVoiceControls visual={visual} active={voiceActive || recording} muted={muted} compact={viewport?.height < 500} />
      <div ref={messagesRef} onScroll={(event) => { const area = event.currentTarget; stickToBottom.current = area.scrollHeight - area.clientHeight - area.scrollTop < 70; if (area.scrollTop < 60 && snapshot.messages.length && messagesCursor !== null && !historyBusy) void loadHistory("messages"); }} className="fm-olivia-messages" role="log" aria-live="polite" aria-label="Conversación con Olivia">
        <div ref={historySentinelRef} className="fm-olivia-history-sentinel" aria-hidden="true" />
        {(hydrating || historyBusy) && !chatsOpen ? <small className="fm-olivia-history-loading" role="status">Cargando historial… Podés escribir mientras tanto.</small> : null}
        {!snapshot.messages.length && !busy ? <div className="fm-olivia-welcome"><h3>Hola, soy Olivia.</h3><p>Te ayudo a consultar Flor Mía y preparar operaciones de tu panel. Los cambios siempre se confirman con Sí o No.</p><p>Podés escribir o dictar un mensaje.</p></div> : null}
        {visibleMessages.filter((message) => !message.hiddenFromChat && ["user", "assistant"].includes(message.role)).map((message, index) => <article key={message.id || `${index}:${message.role}`} className={`fm-olivia-message fm-olivia-message--${message.role}`}><strong>{message.role === "user" ? "Vos" : "Olivia"}</strong>{message.role === "assistant" ? <OliviaMessageContent content={message.content} /> : <p>{String(message.content || "")}</p>}{message.attachments?.length ? <ul className="fm-olivia-attachments" aria-label="Archivos de este mensaje">{message.attachments.map((file, fileIndex) => <li key={file.id || fileIndex}>{file.name} · {file.type}</li>)}</ul> : null}</article>)}
        {streamText ? <article className="fm-olivia-message fm-olivia-message--assistant"><strong>Olivia</strong><OliviaMessageContent content={streamText} />{!busy ? <small>Respuesta incompleta</small> : null}</article> : null}
        {busy || snapshot.activeChatJob ? <div className="fm-olivia-working" role="status"><span className="fm-olivia-working__spinner" aria-hidden="true" /><span>Estoy trabajando en ello</span><span className="fm-olivia-working__bar" aria-hidden="true" /></div> : null}
        <OliviaDelegatedTasks tasks={delegatedTasks} onControl={controlTask} busyId={taskControlId} />
      </div>
      {snapshot.guide?.version === UI_GUIDE_VERSION && getUiGuide(profile, snapshot.guide.guideId, context) ? <div className="fm-olivia-guide-offer"><Button variant="secondary" disabled={busy} onClick={() => { setGuideRequest?.({ ...snapshot.guide, requestId: requestId() }); minimizeChat(); }}>Mostrarme los pasos en pantalla</Button></div> : null}
      {pending ? <section className="fm-olivia-confirmation" aria-labelledby="fm-olivia-confirm-title"><h3 id="fm-olivia-confirm-title">¿Confirmar esta acción?</h3><OliviaMessageContent content={typeof pending.summary === "string" ? pending.summary : "Necesito un resumen legible antes de confirmar. Pedile a Olivia que prepare la operación nuevamente."} />{expired ? <p role="alert">La confirmación venció. Pedile a Olivia que prepare la acción nuevamente.</p> : null}<div className="fm-olivia-confirmation-actions"><Button onClick={() => answer(true)} disabled={busy || expired || exhausted || unavailable || typeof pending.summary!=="string"}>Sí</Button><Button variant="secondary" onClick={() => answer(false)} disabled={busy || !online}>No</Button></div><small>La acción se ejecuta únicamente al tocar Sí. Podés corregir los datos escribiendo.</small></section> : null}
      {unavailable ? <div className="fm-olivia-error" role="status"><p>{!online ? "Olivia necesita conexión a Internet." : snapshot.enabled === false ? "Olivia está deshabilitada por el Administrador." : "Olivia todavía necesita configurar su conexión con OpenAI."}</p><small>Podés continuar operando desde tu panel.</small>{admin && online ? <Button variant="secondary" onClick={() => navigate("/gestion/settings")}>Abrir configuración</Button> : null}</div> : null}
      {error ? <div className="fm-olivia-error" role="alert"><p>{error}</p>{reportNotice ? <p>{reportNotice}</p> : null}{errorReportId ? <Button className="fm-olivia-report-error" variant="secondary" loading={reportState === "sending"} disabled={reportState === "sent"} onClick={reportError}>{reportState === "sent" ? "Enviado a Agustín" : "Enviar error a Agustín"}</Button> : ["conversation-not-found", "session-changed", "permission-scope-changed", "conversation-expired"].includes(errorCode) ? <Button variant="secondary" disabled={busy} onClick={newConversation}>Iniciar nueva conversación</Button> : retryRef.current && !busy ? <Button variant="secondary" onClick={() => { const retry = retryRef.current; perform(retry.operation, retry.fields, retry.identity).then(() => { if (retry.operation === "chat") setDraft(""); }).catch(() => {}); }}>{retryRef.current.operation === "resume" ? "Recuperar conversación" : errorCode === "request-already-used" ? "Actualizar conversación" : "Reintentar solicitud"}</Button> : null}</div> : null}
      {voiceNotice ? <div className="fm-olivia-recovery" role="status"><p>{voiceNotice}</p></div> : null}
      <OliviaComposer textareaRef={textareaRef} draft={draft} setDraft={setDraft} sendMessage={sendMessage} recording={recording} frame={audioFrame} stopRecording={stopRecording} startRecording={startRecording} startVoice={startVoice} stopVoice={endVoiceSession} finishVoiceTurn={() => voiceRef.current?.finishTurn()} voiceRecording={voiceState === "recording"} voiceAvailable={snapshot.voiceConversationAvailable === true} voiceActive={voiceActive} voiceConnecting={['connecting','reconnecting'].includes(voiceState)} dictateDuringConnection={dictateDuringConnection} dictationDisabled={hydrating || !snapshot.conversationId} muted={muted} toggleMute={toggleMute} disabled={exhausted || unavailable || geminiDiagnosticActive} busy={busy} cancelRequest={cancelRequest} attachments={attachments} addFiles={addFiles} removeFile={removeFile} />
      <OliviaUsage quota={quota} estimate={draft.trim() ? estimate : null} money={money} exhausted={exhausted} geminiUsage={snapshot.geminiLiveUsage} interactionCost={interactionCosts.current.summary()} voiceActive={voiceActive} />
      </div>
      {admin && developer ? <section className="fm-olivia-developer-view" aria-label="Panel Developer de Olivia"><header><h3>Developer</h3><Button variant="secondary" onClick={() => setDeveloper(false)}>Volver al chat</Button></header><Suspense fallback={<p role="status">Cargando diagnósticos…</p>}>
      <OliviaDelegatedTasks developer tasks={delegatedTasks} onControl={controlTask} busyId={taskControlId} />
      {admin && developer ? <details className="fm-olivia-usage-details"><summary>Uso y costos</summary><OliviaUsage quota={quota} estimate={estimate} money={money} compact={viewport?.height < 500} exhausted={exhausted} /></details> : null}
      {admin && developer && snapshot.voiceSettings?.hybridLiveAvailable && snapshot.voiceSettings?.hybridLiveEnabled ? <OliviaGeminiDiagnostic
        conversationId={snapshot.conversationId} disabled={busy || recording || voiceActive || !snapshot.conversationId || unavailable || exhausted}
        onActive={setGeminiDiagnosticActive}
        onUsage={updateGeminiUsage}
        onDirect={async turn => { const id=conversationRef.current; const result=await oliviaClient.request({operation:'geminiDirectTurn',conversationId:id,requestId:turn.turnId,userText:turn.userText,assistantText:turn.assistantText}); if(conversationRef.current===id)apply(result); }}
        onDelegate={async (call,input) => {
          const result=await perform('chat',{message:input || call.args?.request || '',inputMode:'natural-voice',deferVoice:true},requestId());
          if(result.pendingAction)return `Preparé la operación «${result.pendingAction.summary}». Revisá la tarjeta en pantalla; todavía no se ejecutó.`;
          const last=result.messages?.filter(entry=>entry.role==='assistant').at(-1);
          return last?.voiceTranscript || last?.content || 'Olivia no devolvió una respuesta final.';
        }} /> : null}
      {admin && developer ? <OliviaDeveloperPanel tasks={delegatedTasks} estimate={estimate} quota={quota} latency={latency} voiceMetrics={voiceMetrics} voiceConfiguration={snapshot.voiceConfiguration} geminiLiveUsage={snapshot.geminiLiveUsage} telemetry={snapshot.telemetry} turnTrace={turnTrace} connectionTrace={connectionTraceView} turnTraces={voiceTurnTraces} money={money} /> : null}
      </Suspense></section> : null}
      {!admin && exhausted ? <div className="fm-olivia-quota-request"><Button variant="secondary" disabled={busy || !online || quotaRequested} onClick={() => setQuotaRequestOpen(true)}>{quotaRequested ? "Ampliación solicitada" : "Solicitar ampliación"}</Button>{quotaNotice ? <p role="status">{quotaNotice}</p> : null}</div> : null}
    </aside></div> : null}
    <Modal open={quotaRequestOpen} title="Solicitar ampliación de Olivia" description="Enviaremos al Administrador una solicitud de ampliación para tu cupo del período actual." onClose={() => { if (!busy) setQuotaRequestOpen(false); }} footer={<div className="fm-dialog-actions"><Button variant="secondary" disabled={busy} onClick={() => setQuotaRequestOpen(false)}>No</Button><Button loading={busy} onClick={requestQuotaExtension}>Sí, solicitar</Button></div>}><p>La solicitud no cambia tu cupo. El Administrador puede conceder una ampliación temporal desde Configuración de IA.</p>{error ? <p className="fm-form-error" role="alert">{error}</p> : null}</Modal>
    </div>, document.body)}
  </>;
}
