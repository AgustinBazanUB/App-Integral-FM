import { executeToolBatch } from "./toolExecution.mjs";
import { chooseLocalGreeting } from '../../../../src/shared/oliviaFastSpeech.mjs';
import { instantConversation, quickReadPlan, latencyEnabled } from '../../../../src/shared/oliviaConversationRouter.mjs';
import { latencyTrace, tracedStore } from '../../../../src/shared/oliviaLatencyTrace.mjs';
import { fastConversationRead, formatQuickRead } from './fastConversation.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { metricsForModel } from "./analytics.mjs";
import { progressiveStock, taskFromTool, taskControl, missingQuestion, updateTask, taskUpdateTool, taskSlotSchema, requiredFields, isCorrection, operationalIntent, shortVoiceQuestion } from "./tasks.mjs";
import { aggregateRoutes } from "./modelRouter.mjs";
import { transitionConversationTask, manageConversationTask, taskManagementTool, isTaskInterruption } from "./conversationTasks.mjs";
import { isSuggestionRequest, processSuggestion } from "./suggestions.mjs";
import { canUseOliviaVoice, hasGoogleCloudTtsCredentials } from "../../../../src/shared/oliviaVoiceAvailability.mjs";
import { OLIVIA_CAPABILITIES } from "../../../../src/shared/oliviaCapabilities.mjs";
import { captureOliviaFailure, publicOliviaFailure } from "./errorReports.mjs";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import {
  canAccessAdministration,
  normalizedRole,
} from "../../../../src/gestion/permissions.js";
import {
  OLIVIA_POLICY_VERSION,
  defaultOliviaConfiguration,
  validateConfiguration,
  retentionDate,
  safeId,
  screenContext,
  oliviaError,
  validateSchema,
  costForUsage,
} from "../../../../src/shared/oliviaContracts.mjs";
import { retrieveOliviaKnowledge } from "../../../../src/shared/oliviaKnowledge.mjs";
import { resolveAttachments, attachmentInput, publicAttachment } from "./attachments.mjs";
import { retrieveKnowledge } from "./knowledge.mjs";
import { routeSkills } from "./skills.mjs";
import { reduceConversationMemory } from "../../../../src/shared/oliviaMemory.mjs";
import { argentinaDateKey } from "../../../../src/modules/locations/domain/time.js";
import { discoverSkills } from "./skills.mjs";
import {
  assertOliviaAccess,
  assertCapability,
  userContext,
  capabilities,
} from "./guards.mjs";
import {
  OLIVIA_INSTRUCTIONS,
  responseInstructions,
  OLIVIA_VOICE_INSTRUCTIONS,
  modelProfile,
  openaiRequest,
  providerUsage,
  responseText,
  safeUserMessage,
} from "./provider.mjs";
import { toolDefinitions, runTool } from "./tools.mjs";
import { executeOperation } from "./operations.mjs";
import {
  quotaFor,
  publicUsage,
  releaseMeasuredReservation,
  reserveUsage,
  increaseReservation,
  settleUsage,
} from "./usage.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
export function spokenFallback(value, maxCharacters = 1600) {
  const clean = String(value || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\n\r]+/g, " ")
    .replace(/[#*_`>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= maxCharacters) return clean;
  const head = clean.slice(0, maxCharacters), boundary = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "));
  if (boundary >= maxCharacters * 0.65) return head.slice(0, boundary + 1).trim();
  return `${head.replace(/\s+\S*$/, "").trimEnd()}…`;
}
export function dualVoiceResponse(raw, maxCharacters) {
  try {
    const value = JSON.parse(raw);
    const complete = typeof value.complete === "string" ? value.complete.trim() : "";
    const spoken = typeof value.spoken === "string" ? value.spoken.trim() : "";
    if (complete) return { complete, spoken: spokenFallback(spoken || complete, maxCharacters) };
  } catch { /* Fall back to the canonical verified text if structured output is unavailable. */ }
  return { complete: String(raw || ""), spoken: spokenFallback(raw, maxCharacters) };
}
import { message, retainedMessage, sessionBinding, permissionScope, dateMs, trimMessages, assertConversationOwner, verifyLegacyConversationScope, createConversationStorage } from "./conversations.mjs";
export { assertConversationOwner } from "./conversations.mjs";
export function createOliviaEngine({
  store: sourceStore,
  env = process.env,
  provider = openaiRequest,
  clock = () => new Date(),
  pricingResolver = async (config) => config,
} = {}) {
  const traceContext = new AsyncLocalStorage();
  const store = tracedStore(sourceStore, () => traceContext.getStore());
  const { history, resumeConversation } = createConversationStorage({ store, clock, configuration, state });
  async function configuration({ resolveCosts = true, allowPricingNetwork = false } = {}) {
    const raw = await store.get("oliviaConfiguration/global");
    const config = raw
      ? validateConfiguration(
          Object.fromEntries(
            Object.keys(defaultOliviaConfiguration())
              .filter((k) => raw[k] !== undefined)
              .map((k) => [k, raw[k]]),
          ),
        )
      : validateConfiguration(defaultOliviaConfiguration(env));
    return resolveCosts ? pricingResolver(config, clock(),{allowNetwork:allowPricingNetwork || !latencyEnabled(config)}) : config;
  }
  async function usage(session, config, event = null) {
    const quota = quotaFor(config, session.uid, clock(), session.profile),
      budget = await store.get(`oliviaBudgets/${session.uid}_${quota.key}`);
    if (!event) {
      const events = await store.query("oliviaUsage", [["userId", "EQUAL", session.uid]], 1, [["createdAt", "DESCENDING"]]);
      event = events[0] || null;
    }
    return publicUsage(session, budget, quota, event, config);
  }
  async function state(session, id, context = {}) {
    assertOliviaAccess(session);
    const config = await configuration();
    let conversation = id
      ? await store.get(`oliviaConversations/${safeId(id)}`)
      : null;
    if (id) assertConversationOwner(session, conversation, clock());
    if (id) await verifyLegacyConversationScope(session, conversation, store);
    if (!conversation) {
      const now = clock(),
        conversationId = randomUUID();
      conversation = {
        id: conversationId,
        userId: session.uid,
        sessionBinding: sessionBinding(session),
        roleBinding: normalizedRole(session.profile),
        permissionScope: permissionScope(session),
        messages: [],
        messageCount: 0,
        historyStorageVersion: 1,
        state: "INFORMACION",
        pendingActionId: null,
        draft: null,
        createdAt: now,
        updatedAt: now,
        expiresAt: retentionDate(config.retentionMonths, now),
      };
      await store.commit([
        {
          type: "create",
          path: `oliviaConversations/${conversationId}`,
          data: conversation,
        },
      ]);
    }
    let pendingAction = null;
    if (conversation.pendingActionId) {
      const action = await store.get(
        `oliviaConfirmations/${conversation.pendingActionId}`,
      );
      if (
        action &&
        action.status === "pending" &&
        action.userId === session.uid &&
        dateMs(action.expiresAt) > clock().getTime()
      )
        pendingAction = {
          id: action.id,
          confirmationToken: action.confirmationToken,
          summary: action.prepared.summary,
          toolName: action.prepared.toolName,
          expiresAt: action.expiresAt,
        };
    }
    const estimate = estimateFor(session, config, conversation, context);
    return {
      conversationId: conversation.id,
      messages: conversation.messages,
      state: pendingAction
        ? "ESPERANDO_CONFIRMACION"
        : conversation.state === "ESPERANDO_CONFIRMACION"
          ? "RECHAZADA"
          : conversation.state,
      pendingAction,
      failure: conversation.lastFailure || null,
      usage: await usage(session, config),
      capabilities: capabilities(session),
      providerConfigured: Boolean(env.OPENAI_API_KEY),
      googleTtsConfigured: hasGoogleCloudTtsCredentials(env),
      enabled: config.enabled,
      audioLimits: config.audioLimits,
      voiceProtocol: "chirp",
      voiceConversationAvailable: Boolean(config.naturalVoice.enabled && canUseOliviaVoice(session) && env.OPENAI_API_KEY && hasGoogleCloudTtsCredentials(env)),
      voiceTrialAvailable: false,
      ...(config.naturalVoice.enabled && canUseOliviaVoice(session) ? { voiceSettings: { turnEndSilenceMs: config.naturalVoice.turnEndSilenceMs, latencyMode:latencyEnabled(config),transcriptionDelay:config.conversationLatency.transcriptionDelay,transcriptionModel:'gpt-live-transcribe', voice:config.naturalVoice.voice, speakingRate:config.naturalVoice.speakingRate } } : {}),
      ...(canAccessAdministration(session.profile) && canUseOliviaVoice(session) ? { voiceConfiguration: { model: "Google Chirp 3 HD", backendModel: latencyEnabled(config)?"GPT-6 Luna · rutas instantánea / lectura / controlada":"GPT-6 Luna · modo anterior", reasoningEffort: latencyEnabled(config)?"NONE / MEDIUM según complejidad":"HIGH/XHIGH", voice: config.naturalVoice.voice } } : {}),
      policyVersion: OLIVIA_POLICY_VERSION,
      ...(estimate ? { estimate } : {}),
    };
  }
  function estimateFor(session, config, conversation, context, draft = "") {
    const profile = modelProfile(config, session, screenContext(context), { message: draft, task: conversation.taskState });
    const input = { instructions: OLIVIA_INSTRUCTIONS, tools: toolDefinitions(session, { query: draft, context }), context: userContext(session), screen: screenContext(context), documentation: retrieveOliviaKnowledge(draft, { role: normalizedRole(session.profile), module: context.module, limit: 4 }), memory: conversation.memory, messages: conversation.messages.slice(-16), draft };
    const inputTokens = Math.ceil(Buffer.byteLength(JSON.stringify(input), "utf8") / 4), outputTokens = Math.max(config.responseLimits.maxOutputTokens, 6000);
    const costs = costForUsage({ model: profile.model, inputTokens, outputTokens }, config);
    const common = { estimatedCostArs: costs.actualCostArs };
    return canAccessAdministration(session.profile) ? { ...common, excludesUnmeasuredAttachmentsAndRetrieval: true, model: profile.model, reasoningEffort: profile.reasoningEffort, route: profile.route, routingReason: profile.routingReason, estimatedTokens: inputTokens + outputTokens, estimatedCostUsd: costs.actualCostUsd, reference: config.pricingReference || null } : common;
  }
  async function estimate(session, body) {
    assertOliviaAccess(session);
    const c = await store.get(`oliviaConversations/${safeId(body.conversationId)}`);
    assertConversationOwner(session, c, clock());
    await verifyLegacyConversationScope(session, c, store);
    const draft = typeof body.message === "string" ? body.message.slice(0, 12000) : "";
    return { estimate: estimateFor(session, await configuration({allowPricingNetwork:true}), c, body.screenContext || {}, draft) };
  }

  async function claimConversation(
    session,
    id,
    requestId,
    userMessage,
    inputMode,
    attachments = [],
    context = null,
    leaseMs = 120000,
    cancelGuard = false,
  ) {
    const now = clock();
    return store.transaction(async (tx) => {
      const snapshot = await tx.getDocument(`oliviaConversations/${id}`);
      const conversation = snapshot ? { ...snapshot.data, id } : null;
      assertConversationOwner(session, conversation, now);
      if(cancelGuard && (await tx.getDocument(`oliviaRequests/${session.uid}_${requestId}`))?.data?.interruptRequested) throw oliviaError('request-expired','Esta consulta fue reemplazada.',409);
      await verifyLegacyConversationScope(session, conversation, store);
      if (conversation.queuedChatRequestId && conversation.queuedChatRequestId !== requestId)
        throw oliviaError("conversation-busy", "Olivia sigue trabajando en la consulta anterior.", 409);
      if (
        conversation.busyUntil &&
        dateMs(conversation.busyUntil) > now.getTime()
      )
        throw oliviaError(
          "conversation-busy",
          "Olivia ya está procesando una consulta en esta conversación.",
          409,
        );
      const previous = conversation.pendingActionId
        ? await tx.getDocument(
            `oliviaConfirmations/${conversation.pendingActionId}`,
          )
        : null;
      const writes = [];
      const repeatedInput = taskControl(userMessage) === "acknowledge" || (!attachments.length && inputMode==='natural-voice' && (instantConversation(userMessage) || chooseLocalGreeting(userMessage)));
      if (previous?.data.status === "pending" && !repeatedInput)
        writes.push({
          type: "update",
          path: `oliviaConfirmations/${conversation.pendingActionId}`,
          data: { status: "superseded", updatedAt: now },
        });
      const userEntry = message("user", userMessage, now, inputMode),
        messages = trimMessages([...(conversation.messages || []), userEntry]);
      if (attachments.length) { userEntry.attachmentIds = attachments.map((file) => file.id); userEntry.attachments = attachments.map(publicAttachment); }
      await tx.commitDocuments([
        ...writes,
        ...(messages.includes(userEntry) ? [retainedMessage(id, userEntry)] : []),
        {
          type: "update",
          path: `oliviaConversations/${id}`,
          data: {
            messages,
            title: conversation.title || userMessage.replace(/\s+/g, " ").slice(0, 80),
            messageCount: (conversation.messageCount || 0) + (messages.includes(userEntry) ? 1 : 0),
            state: "PREPARANDO_ACCION",
            pendingActionId: repeatedInput ? conversation.pendingActionId : null,
            busyRequestId: requestId,
            queuedChatRequestId: null,
            roleBinding: normalizedRole(session.profile),
            permissionScope: permissionScope(session),
            busyUntil: new Date(now.getTime() + leaseMs),
            updatedAt: now,
            ...(context ? { lastScreenContext: context } : {}),
          },
        },
      ]);
      return { ...conversation, messages };
    });
  }
  async function saveTurn(
    session,
    id,
    requestId,
    { content, prepared, draft, taskState, suspendedTasks, activeSkills, metricsPeriod, state: nextState, navigation, failure = null, hiddenFromChat = false, preservePending = false, voiceTranscript = null },
    config,
    onSaved,
  ) {
    const now = clock(),
      actionId = prepared ? randomUUID() : null,
      token = prepared ? `${actionId}.${randomUUID()}` : null;
    await store.transaction(async (tx) => {
      const snapshot = await tx.getDocument(`oliviaConversations/${id}`),
        conversation = snapshot?.data;
      assertConversationOwner(session, conversation, now);
      if (conversation.busyRequestId !== requestId)
        throw oliviaError(
          "request-expired",
          "La consulta fue reemplazada por otro intento.",
          409,
        );
      const writes = [];
      if (prepared && conversation.pendingActionId) {
        const previous = await tx.getDocument(`oliviaConfirmations/${conversation.pendingActionId}`);
        if (previous?.data.status === "pending") writes.push({ type: "update", path: `oliviaConfirmations/${conversation.pendingActionId}`, data: { status: "superseded", updatedAt: now } });
      }
      if (prepared)
        writes.push({
          type: "create",
          path: `oliviaConfirmations/${actionId}`,
          data: {
            id: actionId,
            userId: session.uid,
            sessionBinding: sessionBinding(session),
            conversationId: id,
            requestId,
            prepared,
            tokenHash: hash(token),
            confirmationToken: token,
            status: "pending",
            expiresAt: new Date(now.getTime() + 5 * 60000),
            createdAt: now,
          },
        });
      const assistantEntry = message(
          "assistant",
          content || prepared?.summary || "Necesito más datos para continuar.",
          now,
        ),
        messages = trimMessages([
          ...(conversation.messages || []),
          assistantEntry,
        ]);
      if (voiceTranscript) assistantEntry.voiceTranscript = voiceTranscript;
      if (hiddenFromChat) assistantEntry.hiddenFromChat = true;
      writes.push(retainedMessage(id, assistantEntry), {
        type: "update",
        path: `oliviaConversations/${id}`,
        data: {
          messages,
          memory: reduceConversationMemory(conversation.memory, [...(conversation.messages || []), assistantEntry]),
          messageCount: (conversation.messageCount || 0) + 1,
          state: prepared
            ? "ESPERANDO_CONFIRMACION"
            : preservePending && conversation.pendingActionId ? "ESPERANDO_CONFIRMACION" : nextState || "INFORMACION",
          pendingActionId: actionId || (preservePending ? conversation.pendingActionId : null),
          lastFailure: failure,
          draft: prepared?.canonicalArgs || (draft !== undefined ? draft : conversation.draft || null),
          ...(taskState !== undefined ? { taskState } : {}),
          ...(suspendedTasks !== undefined ? { suspendedTasks } : {}),
          ...(metricsPeriod !== undefined ? { metricsPeriod } : {}),
          ...(activeSkills ? { activeSkills: activeSkills.slice(0, 2).map(({ name, version }) => ({ name, version })) } : {}),
          busyRequestId: null,
          busyUntil: null,
          updatedAt: now,
        },
      });
      await tx.commitDocuments(writes);
    });
    onSaved?.();
    const result = await state(session, id);
    if (navigation) result.navigation = navigation;
    return result;
  }
  async function chat(session, body, options = {}) {
    const trace = latencyTrace({ id: body.requestId, origin: 'server', now: () => Date.now() });
    return traceContext.run(trace, () => chatTurn(session, body, options));
  }
  async function chatTurn(session, body, { onEvent, signal, longRunning = false } = {}) {
    const trace = traceContext.getStore();
    trace.mark('request.start');
    const startedAt = Date.now(), timings = { modelCalls: 0, providerMs: 0, toolsMs: 0 }, naturalVoice = body.inputMode === "natural-voice";
    assertOliviaAccess(session);
    const userMessage = safeUserMessage(body.message),
      config = await configuration();
    signal?.throwIfAborted();
    // This option is set only by the authenticated background worker, never by
    // request fields. Quota reservations still include the actual output bound.
    if (longRunning) config.responseLimits = { ...config.responseLimits, timeoutMs: 300000, providerTimeoutMs: 90000, maxOutputTokens: Math.max(config.responseLimits.maxOutputTokens, 6000) };
    if (!config.enabled)
      throw oliviaError(
        "assistant-disabled",
        "Olivia está deshabilitada. La aplicación sigue disponible manualmente.",
        503,
      );
    if (naturalVoice && (!config.naturalVoice.enabled || !canUseOliviaVoice(session) || !env.OPENAI_API_KEY || !hasGoogleCloudTtsCredentials(env)))
      throw oliviaError("voice-not-enabled", "La conversación natural por voz no está disponible para esta cuenta.", 403);
    if (["realtime", "live"].includes(body.inputMode) || body.voiceSessionId || body.realtimeSessionId)
      throw oliviaError("voice-mode-retired", "GPT-Live fue retirado. Usá la conversación natural por voz de Olivia.", 410);
    const requestId = safeId(body.requestId, "intento"),
      context = screenContext(body.screenContext || {}),
      id = body.conversationId
        ? safeId(body.conversationId)
        : (await state(session)).conversationId;
    const reservation = await reserveUsage({
      store,
      session,
      configuration: config,
      requestId,
      operation: body.inputMode || "chat",
      reservedTokens: 0,
      now: clock(),
    });
    let event = { model: "", inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      claimed = false,
      settled = false,
      currentTask = undefined,
      currentSuspendedTasks = undefined;
    const persistTurn = async (turn) => {
      const voiceTranscript = naturalVoice
        ? spokenFallback(turn.voiceTranscript || turn.prepared?.summary || turn.content, config.naturalVoice.maxCharactersPerTurn)
        : null;
      const saved = await saveTurn(session, id, requestId, { ...turn, ...(currentSuspendedTasks !== undefined ? { suspendedTasks: currentSuspendedTasks } : {}), ...(naturalVoice ? { voiceTranscript } : {}) }, config, () => {
        if (naturalVoice && voiceTranscript) { timings.voiceReadyMs = Date.now() - startedAt; trace.mark('response.voice_ready');onEvent?.({ type: "voice.ready", text: voiceTranscript, requestId }); }
      });
      if (naturalVoice && voiceTranscript) {
        saved.spokenText = voiceTranscript;
      }
      return saved;
    };
    try {
      const attachments = await resolveAttachments({ ids: body.attachmentIds || [], session, conversationId: id, store, now: clock() });
      if (isCorrection(userMessage)) {
        const previous = await store.get(`oliviaConversations/${id}`);
        assertConversationOwner(session, previous, clock());
        if (previous.busyRequestId && dateMs(previous.busyUntil) > clock().getTime()) await invalidateTask(session, id);
      }
      const conversation = await claimConversation(
        session,
        id,
        requestId,
        userMessage,
        body.inputMode || "text",
        attachments,
        context,
        longRunning ? 360000 : 120000,
        body.foreground===true,
      );
      claimed = true;
      const suggestionFlow = isSuggestionRequest(userMessage) || conversation.draft?.kind === "app-suggestion";
      const transition = suggestionFlow ? { ...manageConversationTask({ task: conversation.taskState, suspendedTasks: conversation.suspendedTasks || [] }, "pause", null, clock()), handled: false, directive: null } : transitionConversationTask(conversation, userMessage, clock());
      if(latencyEnabled(config) && ['start','switch'].includes(transition.directive) && transition.task?.intent==='prepare_stock_load' && context.locationId && !transition.task.slots.locationId){transition.task.slots.locationId=context.locationId;transition.task.missingFields=requiredFields(transition.task.intent).filter(key=>transition.task.slots[key]==null);}
      conversation.taskState = transition.task;
      currentSuspendedTasks = transition.suspendedTasks;
      if (transition.directive) { conversation.draft = transition.task?.slots || null; conversation.activeSkills = []; }
      currentTask = conversation.taskState || null;
      const checkpointTask = async (task) => store.transaction(async tx => {
        const saved = (await tx.getDocument(`oliviaConversations/${id}`))?.data;
        if (saved?.busyRequestId !== requestId) throw oliviaError("request-expired", "La consulta fue reemplazada.", 409);
        await tx.commitDocuments([{ type: "update", path: `oliviaConversations/${id}`, data: { taskState: task, suspendedTasks: currentSuspendedTasks, draft: task?.slots || null } }]);
      });
      onEvent?.({ type: "accepted", conversationId: id, message: conversation.messages.at(-1) });
      const greeting=naturalVoice && !attachments.length ? (latencyEnabled(config) ? instantConversation(userMessage) : null) || chooseLocalGreeting(userMessage) : null;
      if(greeting) {
        signal?.throwIfAborted();
        const result=await persistTurn({content:greeting.text,taskState:conversation.taskState || null,draft:conversation.draft,state:'INFORMACION',preservePending:true});
        event={...event,route:'deterministic',routingReason:'greeting-only',measurement:'provider',modelCalls:[],tools:[],durationMs:Date.now()-startedAt};
        await settleUsage({store,session,reservation,event,configuration:config,result:{conversationId:id},now:clock()});settled=true;
        result.usage=await usage(session,config,event);
        trace.mark('response.complete',{route:'instant'});
        if(canAccessAdministration(session.profile)) result.telemetry={requestId,route:'instant',modelCalls:0,toolCalls:0,totalMs:Date.now()-startedAt,trace:trace.snapshot()};
        return result;
      }
      const deterministicTools = [];
      const deterministicTaskId = conversation.taskState?.intent === "prepare_stock_load" && !["completed", "cancelled"].includes(conversation.taskState.status) ? conversation.taskState.id : randomUUID();
      const run = async (name, args) => {
        signal?.throwIfAborted();
        onEvent?.({type:'phase',label:'Consultando datos…',tools:[name]});
        const result = await trace.span('tool',{tool:name},()=>runTool({ session, name, args, store, context, now: clock(), provider, env }));
        deterministicTools.push(name);
        await store.commit([{ type: "create", path: `oliviaToolEvents/${randomUUID()}`, data: { userId: session.uid, conversationId: id, taskId: deterministicTaskId, requestId, tool: name, module: context.module, mode: body.inputMode || "text", result: "completed", origin: "Asistente IA / Olivia", createdAt: clock(), expiresAt: new Date(clock().getTime() + 30 * 86400000) } }]);
        return result;
      };
      trace.mark('router.start');
      const readPlan = latencyEnabled(config) && !attachments.length && !conversation.pendingActionId && !transition.handled ? quickReadPlan(userMessage) : null;
      trace.mark('router.end',{route:readPlan?'quick-read':greeting?'instant':'controlled'});
      const quick = readPlan ? await fastConversationRead({plan:readPlan,context,previous:conversation.taskState,run,check:name=>assertCapability(session,name),signal,now:clock()}) : null;
      if(quick?.content) {
        signal?.throwIfAborted();
        const result=await persistTurn({...quick,taskState:quick.taskState || conversation.taskState || null,preservePending:true});
        event={...event,route:'deterministic',routingReason:'quick-read',measurement:'provider',modelCalls:[],tools:deterministicTools,durationMs:Date.now()-startedAt};
        await settleUsage({store,session,reservation,event,configuration:config,result:{conversationId:id},now:clock()});settled=true;
        result.usage=await usage(session,config,event);trace.mark('response.complete',{route:'quick-read'});
        if(canAccessAdministration(session.profile)) result.telemetry={requestId,route:'quick-read',modelCalls:0,toolCalls:deterministicTools.length,totalMs:Date.now()-startedAt,trace:trace.snapshot()};
        return result;
      }
      const control = !attachments.length && !transition.handled ? taskControl(userMessage) : null;
      if (!control && (isSuggestionRequest(userMessage) || conversation.draft?.kind === "app-suggestion")) {
        const suggestion = await processSuggestion({ session, store, provider, env, conversation, conversationId: id, requestId, message: userMessage, context, now: clock(), signal,
          beforeProvider: request => increaseReservation({ store, reservation, amount: Math.ceil(Buffer.byteLength(JSON.stringify(request), "utf8") / 4) + request.max_output_tokens }),
          onUsage: measured => { Object.assign(event, measured, { conversationId: id, route: "luna-suggestion", reasoningEffort: "low", routingReason: "user-requested-message-to-agustin", module: context.module }); },
        });
        signal?.throwIfAborted();
        const result = await persistTurn({ ...suggestion, taskState: null });
        await settleUsage({ store, session, reservation, event, configuration: config, result: { conversationId: id, ...(suggestion.alertId ? { alertId: suggestion.alertId } : {}) }, now: clock() });
        settled = true;
        result.usage = await usage(session, config, event);
        if (canAccessAdministration(session.profile)) result.telemetry = { requestId, model: event.model, reasoningEffort: "low", route: event.route, modelCalls: 1, toolCalls: 0, totalMs: Date.now() - startedAt };
        return result;
      }
      const deniedTask = transition.task?.status !== "cancelled" && transition.task?.intent?.startsWith("prepare_") && !capabilities(session).includes(transition.task.intent);
      let progressive = !deniedTask && !transition.handled && !control && !attachments.length ? await progressiveStock({ previous: conversation.taskState, initialId: deterministicTaskId, message: userMessage, context, run, check: () => assertCapability(session, "prepare_stock_load"), now: clock() }) : null;
      if (transition.directive === "resume" && transition.task?.status === "collecting" && !transition.task.missingFields.length && transition.task.intent.startsWith("prepare_")) {
        const result = await run(transition.task.intent, transition.task.slots);
        progressive = { task: taskFromTool(transition.task, transition.task.intent, transition.task.slots, result, clock()), result, content: result.prepared?.summary || missingQuestion(result.data?.missing || []) };
      }
      if (deniedTask || transition.handled || control || progressive) {
        const task = deniedTask ? null : progressive?.task || (conversation.taskState ? { ...conversation.taskState, revision: conversation.taskState.revision + 1, status: control === "cancel" ? "cancelled" : conversation.taskState.status, updatedAt: clock() } : null);
        const prepared = progressive?.result.prepared;
        signal?.throwIfAborted();
        const result = await persistTurn({ content: deniedTask ? "Esta operación no está habilitada para tu cuenta. Podés pedirle ayuda a un administrador autorizado." : (naturalVoice && (progressive || transition.handled) ? shortVoiceQuestion(task, progressive?.content || transition.content) : progressive?.content) || transition.content || (control === "cancel" ? "La tarea quedó cancelada." : conversation.pendingActionId ? "Revisá y confirmá con Sí en la tarjeta. La respuesta por voz o texto no ejecuta la acción." : "Dale, seguimos cuando me indiques."), prepared, taskState: task, draft: deniedTask || control === "cancel" || transition.directive === "cancel" || transition.directive === "pause" ? null : task?.slots || conversation.draft, state: deniedTask ? "RECHAZADA" : control === "cancel" || transition.directive === "cancel" ? "CANCELADA" : progressive?.result.state || "INFORMACION", preservePending: control === "acknowledge" });
        event = { ...event, conversationId: id, taskId: task?.id || null, route: "deterministic", routingReason: deniedTask ? "permission-denied" : transition.directive || control || "progressive-stock", measurement: "provider", modelCalls: [], tools: deterministicTools, durationMs: Date.now() - startedAt, module: context.module };
        await settleUsage({ store, session, reservation, event, configuration: config, result: { conversationId: id }, now: clock() });
        settled = true;
        result.usage = await usage(session, config, event);
        if (canAccessAdministration(session.profile)) result.telemetry = { requestId, taskId: task?.id || null, route: event.route, routingReason: event.routingReason, modelCalls: 0, toolCalls: deterministicTools.length, totalMs: event.durationMs };
        return result;
      }
      if (!env.OPENAI_API_KEY) throw oliviaError("openai-key-missing", "Olivia necesita la configuración del servicio de IA. Podés continuar manualmente.", 503);
      let profile = modelProfile(
        config,
        {
          ...session,
          profile: {
            ...session.profile,
            role: normalizedRole(session.profile),
          },
        },
        context,
        { message: userMessage, task: conversation.taskState, attachments },
      );
      event.model = profile.model;
      const retrievalStarted = Date.now();
      const slotContinuation = conversation.taskState?.status === "collecting" && !isTaskInterruption(userMessage) && userMessage.split(/\s+/).length <= 18 && !attachments.length;
      const routineDataIntent=['stock.read','customer.read','stock.load','customer.create'].includes(profile.intent) && !/como|explica|guia|procedimiento|reglas|politica/i.test(userMessage);
      const [knowledgeResult, routedSkills] = await Promise.all([retrieveKnowledge({ session, query: userMessage, context, store, provider, env, semantic: !slotContinuation && !(latencyEnabled(config) && routineDataIntent) }), routeSkills(session, userMessage, conversation.activeSkills)]);
      timings.retrievalMs = Date.now() - retrievalStarted;
      const knowledge = knowledgeResult.documents;
      const activeSkills = routedSkills;
      profile = modelProfile(config, session, context, { message: userMessage, task: conversation.taskState, skills: activeSkills, attachments });
      event.model = profile.model;
      const intent = operationalIntent(profile.intent);
      let taskState = conversation.taskState?.status === "collecting" && conversation.taskState.intent === intent ? { ...structuredClone(conversation.taskState), route: profile, updatedAt: clock() } : { id: randomUUID(), intent, revision: 1, status: "working", slots: {}, missingFields: [], ambiguities: {}, route: profile, createdAt: clock(), updatedAt: clock() };
      currentTask = taskState;
      await store.transaction(async (tx) => {
        const snapshot = await tx.getDocument(`oliviaConversations/${id}`);
        assertConversationOwner(session, snapshot?.data, clock());
        if (snapshot.data.busyRequestId !== requestId) throw oliviaError("request-expired", "La consulta fue reemplazada.", 409);
        await tx.commitDocuments([{ type: "update", path: `oliviaConversations/${id}`, data: { taskState, suspendedTasks: currentSuspendedTasks } }]);
      });
      Object.assign(event, { conversationId: id, taskId: taskState.id, route: profile.route, routingReason: profile.routingReason, reasoningEffort: profile.reasoningEffort, module: context.module });
      event.modelCalls = [];
      const input = [
        {
          role: "user",
          content: JSON.stringify({
            type: "UNTRUSTED_CONTEXT_DATA",
            userContext: userContext(session),
            businessTime: { now: clock().toISOString(), today: argentinaDateKey(clock()), timeZone: "America/Argentina/Buenos_Aires" },
            screenContext: context,
            conversationDraft: conversation.draft,
            taskState: conversation.taskState || null,
            suspendedTasks: currentSuspendedTasks,
            selectedMetricsPeriod: conversation.metricsPeriod || null,
            taskRequirements: Object.fromEntries(capabilities(session).filter((name) => latencyEnabled(config) ? name===taskState.intent : name.startsWith("prepare_") || name === "forecast_fair").map((name) => [name, requiredFields(name)])),
            memory: conversation.memory || null,
            documentation: knowledge,
          }),
        },
        ...conversation.messages
          .slice(-16)
          .map((m) => ({ role: m.role, content: m.content.slice(0, 12000) })),
      ];
      const seen = new Map(), loadedTools = new Set();
      const researchSources = new Map();
      let metricsPeriod = conversation.metricsPeriod || null;
      const researchProvider = async (path, request, options) => {
        const remaining = config.responseLimits.timeoutMs - (Date.now() - startedAt);
        if (remaining < 1000) throw oliviaError("assistant-timeout", "La investigación necesita una consulta más acotada.", 503);
        await increaseReservation({ store, reservation, amount: Buffer.byteLength(JSON.stringify(request), "utf8") + request.max_output_tokens });
        const started = Date.now();
        timings.modelCalls++;
        let payload;
        try { payload = await provider(path, request, { ...options, timeoutMs: Math.min(options.timeoutMs, remaining), signal }); }
        catch (error) {
          event.modelCalls.push({ model: request.model, route: "luna-complex", measurement: "unconfirmed", totalTokens: 0, actualCostUsd: null, actualCostArs: null, operation: "web-research", tools: ["web_search"], errorCode: error.code || "provider-error" });
          event.measurement = "reserved-estimate";
          throw error;
        }
        const measured = providerUsage(payload, request.model);
        event.modelCalls.push({ ...measured, ...costForUsage(measured, config), route: "luna-complex", reasoningEffort: request.reasoning.effort, operation: "web-research", tools: ["web_search"], durationMs: Date.now() - started });
        for (const key of ["inputTokens", "outputTokens", "totalTokens"]) event[key] += measured[key];
        if (measured.measurement !== "provider") event.measurement = "reserved-estimate";
        return payload;
      };
      // Keep earlier attachments in the recent context, while rechecking ownership,
      // session and expiration. An expired file never travels to the provider again.
      let fileCount = 0;
      const unavailableAttachments = [];
      for (let index = conversation.messages.length - 1; index >= Math.max(0, conversation.messages.length - 16); index--) {
        const entry = conversation.messages[index];
        if (!entry.attachments?.length || fileCount >= 4) continue;
        const selected = [];
        for (const reference of entry.attachments.slice(0, 4 - fileCount)) {
          try { selected.push(...await resolveAttachments({ ids: [reference.id], session, conversationId: id, store, now: clock() })); }
          catch { unavailableAttachments.push({ name: reference.name, status: "unavailable", instruction: "El contenido ya no está disponible. Si la consulta lo requiere, pedí adjuntarlo nuevamente; no infieras su contenido." }); }
        }
        fileCount += selected.length;
        const inputIndex = 1 + index - Math.max(0, conversation.messages.length - 16);
        if (selected.length) input[inputIndex].content = [{ type: "input_text", text: entry.content.slice(0, 12000) }, ...selected.map(attachmentInput)];
      }
      if (unavailableAttachments.length) input.push({ role: "user", content: JSON.stringify({ type: "UNTRUSTED_CONTEXT_DATA", unavailableAttachments }) });
      let prepared = null,
        draft = null,
        navigation = null,
        nextState = "INFORMACION",
        content = "",
        spokenContent = "",
        failure = null,
        toolCallCount = 0;
      let taskRepairPending = false;
      const entityIds = new Set(), touchedModules = new Set();
      let dataRows = 0;
      // Bounded rounds support discovery, live reads, analysis and preparation.
      // Reserve a final response without tools to present the last tool result.
      for (let turn = 0; turn < config.responseLimits.maxRounds; turn++) {
        signal?.throwIfAborted();
        if (profile.route === "luna-normal") {
          const escalated = modelProfile(config, session, context, { message: userMessage, attachments, skills: activeSkills, signals: { toolCount: toolCallCount, moduleCount: touchedModules.size, entityCount: entityIds.size, dataRows } });
          if (escalated.route === "luna-complex") profile = escalated;
        }
        const finalResponse = turn === config.responseLimits.maxRounds - 1 || toolCallCount >= config.responseLimits.maxToolCalls;
        const bodyRequest = {
          model: profile.model,
          reasoning: { effort: profile.reasoningEffort },
          store: false,
          instructions: responseInstructions({ query: userMessage, task: taskState, loadedTools: [...loadedTools], skills: activeSkills }),
          input,
          tools: finalResponse ? [] : [...toolDefinitions(session, { query: userMessage, context, required: [...activeSkills.flatMap((skill) => skill.requiredTools), taskState.intent], loaded: [...loadedTools] }), taskUpdateTool(capabilities(session)), taskManagementTool()],
          ...(finalResponse ? { tool_choice: "none" } : {}),
          parallel_tool_calls: true,
          max_output_tokens: naturalVoice && latencyEnabled(config) && profile.route==='luna-normal' ? Math.min(1200,config.responseLimits.maxOutputTokens) : config.responseLimits.maxOutputTokens,
          ...(onEvent ? { stream: true } : {}),
        };
        if (naturalVoice) {
          bodyRequest.instructions += "\n" + OLIVIA_VOICE_INSTRUCTIONS + "\nLa respuesta se escuchará en voz alta. Cuando no haya más herramientas, devolvé una versión completa y otra hablada breve, natural, en español argentino. Conservá hechos e incertidumbres respaldados por los mismos resultados de herramientas. No leas URLs ni Markdown. Una confirmación hablada nunca ejecuta una acción; solo la tarjeta visual autoriza operaciones.";
          bodyRequest.text = { format: { type: "json_schema", name: "olivia_natural_voice_reply", strict: true, schema: { type: "object", properties: { complete: { type: "string" }, spoken: { type: "string" } }, required: ["complete", "spoken"], additionalProperties: false } } };
        }
        // UTF-8 bytes conservatively bound tokenizer input; output is capped by API.
        await increaseReservation({
          store,
          reservation,
          amount: Buffer.byteLength(JSON.stringify(bodyRequest), "utf8") + bodyRequest.max_output_tokens,
        });
        const remaining = config.responseLimits.timeoutMs - (Date.now() - startedAt);
        if (remaining < 1000)
          throw oliviaError(
            "assistant-timeout",
            "La consulta necesita dividirse en pasos más pequeños.",
            503,
          );
        let payload;
        const providerStarted = Date.now();
        timings.modelCalls++;
        try {
          trace.mark('llm.start',{model:profile.model,reasoning:profile.reasoningEffort,requestBytes:Buffer.byteLength(JSON.stringify(bodyRequest))});
          payload = await provider("responses", bodyRequest, {
            env,
            timeoutMs: Math.min(config.responseLimits.providerTimeoutMs, remaining),
            signal,
            onEvent: onEvent ? (frame) => { if (frame.type === "delta" && timings.firstDeltaMs == null) {timings.firstDeltaMs = Date.now() - startedAt;trace.mark('llm.first_token');} if (!naturalVoice || frame.type !== "delta") onEvent(frame); } : undefined,
          });
          trace.mark('llm.end',{model:profile.model});
          timings.providerMs += Date.now() - providerStarted;
        } catch (error) {
          event.modelCalls.push({ ...profile, conversationId: id, taskId: taskState.id, module: context.module, measurement: "unconfirmed", totalTokens: 0, actualCostUsd: null, actualCostArs: null, durationMs: Date.now() - providerStarted, errorCode: error.code || "provider-error", tools: [] });
          event.totalTokens = Math.max(
            event.totalTokens,
            reservation.reservedTokens,
          );
          event.measurement = "reserved-estimate";
          throw error;
        }
        const measured = providerUsage(payload, profile.model);
        event.modelCalls.push({ ...measured, ...profile, ...costForUsage(measured, config), durationMs: Date.now() - providerStarted, module: context.module, conversationId: id, skills: activeSkills.map(({ name, version }) => ({ name, version })) });
        for (const key of ["inputTokens", "outputTokens", "totalTokens"])
          event[key] += measured[key];
        event.responseId = measured.responseId;
        if (measured.measurement !== "provider") {
          event.measurement = "reserved-estimate";
          event.totalTokens = Math.max(
            event.totalTokens,
            reservation.reservedTokens,
          );
        }
        if (
          measured.measurement === "provider" &&
          event.measurement !== "reserved-estimate"
        )
          await releaseMeasuredReservation({
            store,
            reservation,
            measuredTokens: event.totalTokens,
          });
        if (payload.status === "incomplete")
          throw oliviaError(
            "openai-incomplete",
            "Olivia no pudo terminar la respuesta. Reformulá la consulta o continuá manualmente.",
            502,
          );
        const calls = (payload.output || []).filter(
          (item) => item.type === "function_call",
        );
        event.modelCalls.at(-1).tools = calls.map((call) => call.name);
        content = responseText(payload) || content;
        if (naturalVoice && !calls.length && content) {
          const dual = dualVoiceResponse(content, config.naturalVoice.maxCharactersPerTurn);
          content = dual.complete;
          spokenContent = dual.spoken;
        }
        if (!calls.length) break;
        onEvent?.({ type: "phase", label: calls.some((call) => call.name.startsWith("prepare_")) ? "Preparando acción…" : "Revisando datos…", tools: calls.map((call) => call.name) });
        toolCallCount += calls.length;
        if (finalResponse || toolCallCount > config.responseLimits.maxToolCalls)
          throw oliviaError(
            "tool-limit",
            "La consulta necesita dividirse en pasos más pequeños.",
            422,
          );
        input.push(...payload.output);
        const toolsStarted = Date.now();
        let directReadAnswer=null;
        const outcomes = await executeToolBatch(calls, async (call) => {
          const args = JSON.parse(call.arguments), key = JSON.stringify([call.name, args]);
          if (call.name === "manage_task") {
            validateSchema(args, taskManagementTool().parameters);
            const managed = manageConversationTask({ task: ["collecting", "prepared"].includes(taskState.status) ? taskState : conversation.taskState, suspendedTasks: currentSuspendedTasks }, args.action, args.taskId, clock());
            if (managed.task?.status === "collecting") assertCapability(session, managed.task.intent);
            if (managed.notFound) return { data: { found: false, message: "No se encontró la tarea pausada; pedí cuál quiere retomar." } };
            currentSuspendedTasks = managed.suspendedTasks;
            taskState = managed.task || { id: randomUUID(), intent: "conversation.query", revision: 1, status: "working", slots: {}, missingFields: [], createdAt: clock(), updatedAt: clock() };
            currentTask = taskState;
            prepared = null; draft = managed.task?.slots || null;
            await checkpointTask(taskState);
            return { data: { taskState: managed.task, suspendedTasks: currentSuspendedTasks, instruction: "Las propuestas anteriores ya no se pueden confirmar. Retomar exige una preparación nueva con datos vivos." } };
          }
          if (call.name === "update_task") {
            validateSchema(args, taskUpdateTool(capabilities(session)).parameters);
            if (args.intent === "creative_brief") {
              if (profile.route !== "sol-creative") throw oliviaError("permission-denied", "El trabajo creativo requiere Marketing o Redes autorizado.", 403);
            } else assertCapability(session, args.intent);
            const priorTask = ["collecting", "prepared"].includes(taskState.status) ? taskState : conversation.taskState;
            if (priorTask && priorTask.intent !== args.intent) currentSuspendedTasks = manageConversationTask({ task: priorTask, suspendedTasks: currentSuspendedTasks }, "pause", null, clock()).suspendedTasks;
            taskState = updateTask(priorTask, args.intent, args.slotsJson, clock());
            taskRepairPending = false;
            taskState.route = profile;
            currentTask = taskState;
            await checkpointTask(taskState);
            return { data: { taskId: taskState.id, slots: taskState.slots, missing: taskState.missingFields } };
          }
          if (!seen.has(key)) seen.set(key, trace.span('tool',{tool:call.name},()=>runTool({ session, name: call.name, args, store, context, now: clock(), provider: call.name === "research_web_metric" ? researchProvider : provider, env, researchOptions: { ...config.profiles.adminComplex, reasoningEffort: "high", signal } })));
          return seen.get(key);
        });
        timings.toolsMs += Date.now() - toolsStarted;
        for (const outcome of outcomes) {
          const call = outcome.call;
          let result;
          try {
            if (outcome.error) throw outcome.error;
            const args = JSON.parse(call.arguments);
            result = outcome.value;
            if (OLIVIA_CAPABILITIES[call.name]?.module === "metrics" && result.data?.period && !result.state) metricsPeriod = { ...result.data.period, chosenAt: clock() };
            for (const source of result.sources || []) researchSources.set(source.url, source);
            const toolModule = OLIVIA_CAPABILITIES[call.name]?.module || (call.name === "update_task" ? "core" : "locations");
            if (toolModule !== "core") touchedModules.add(toolModule);
            for (const [key, value] of Object.entries(args)) if (/Id$/.test(key) && typeof value === "string") entityIds.add(value);
            for (const value of Object.values(result.data || {})) if (Array.isArray(value)) dataRows += value.length;
            if (call.name.startsWith("prepare_")) {
              const priorTask = ["collecting", "prepared"].includes(taskState.status) ? taskState : conversation.taskState;
              if (priorTask && priorTask.intent !== call.name) currentSuspendedTasks = manageConversationTask({ task: priorTask, suspendedTasks: currentSuspendedTasks }, "pause", null, clock()).suspendedTasks;
              taskState = taskFromTool(taskState.intent === call.name ? taskState : conversation.taskState, call.name, args, result, clock());
              taskState.route = profile;
              currentTask = taskState;
            } else if (call.name === taskState.intent && result.data && !result.state) {
              taskState = { ...taskState, slots: { ...taskState.slots, ...args }, status: "completed", missingFields: [], updatedAt: clock() };
              currentTask = taskState;
            }
            if (result.skill && !activeSkills.some((skill) => skill.name === result.skill.name)) activeSkills.push(result.skill);
            for (const tool of result.loadTools || []) loadedTools.add(tool);
            if (result.prepared) {
              prepared = result.prepared;
              const usedSkill = activeSkills.find((skill) => skill.requiredTools.includes(prepared.toolName));
              prepared.skill = usedSkill ? { name: usedSkill.name, version: usedSkill.version } : null;
              prepared.userInput = userMessage.slice(0, 1000);
              draft = prepared.canonicalArgs;
              nextState = "ESPERANDO_CONFIRMACION";
            } else if (result.state) {
              nextState = ["DATOS_INCOMPLETOS", "RECHAZADA", "ERROR"].includes(
                result.state,
              )
                ? result.state
                : "RECHAZADA";
              draft = args;
              content =
                (["prepare_catalog_stock_load", "prepare_batch_sales"].includes(call.name) ? result.data?.summary : null) || (result.state === "DATOS_INCOMPLETOS" && OLIVIA_CAPABILITIES[call.name]?.module === "metrics" ? result.data?.message : null) || (result.state === "DATOS_INCOMPLETOS" ? missingQuestion(taskState.missingFields) : null) || result.data?.summary ||
                result.data?.message ||
                "La operación necesita revisión.";
            }
            if (result.navigation) navigation = result.navigation;
          } catch (e) {
            result = {
              data: {
                code: e.code || "invalid-tool",
                message:
                  e.status && e.status < 500
                    ? e.message
                    : "No se pudo consultar el backend.",
              },
            };
            if (call.name === "update_task" && (e.code === "invalid-input" || e instanceof SyntaxError)) {
              // A malformed model argument is repairable within the existing round/token budget.
              // Preserve the task and give only its permitted field schema back to the model.
              let intent;
              try { intent = JSON.parse(call.arguments).intent; } catch {}
              const allowed = capabilities(session).includes(intent) || (intent === "creative_brief" && profile.route === "sol-creative");
              result.data = { code: "invalid-input", message: "Corregí slotsJson con las claves y tipos del esquema. No se guardó esta actualización.", retryable: true, slotsSchema: allowed ? taskSlotSchema(intent)?.properties || null : null };
              taskRepairPending = true;
            } else {
              nextState = e.status === 403 ? "RECHAZADA" : "ERROR";
              e.oliviaToolName = call.name;
              failure = publicOliviaFailure(e);
              try { failure = await captureOliviaFailure({ store, session, error: e, operation: "chat", conversationId: id, requestId, now: clock() }); } catch { /* Do not hide the original error. */ }
              content = failure.message;
            }
          }
          const directPlan=latencyEnabled(config) && calls.length===1 ? quickReadPlan(userMessage) : null;
          if(directPlan && nextState==='INFORMACION' && !prepared)directReadAnswer=formatQuickRead(call.name,result,{priceOnly:directPlan.kind==='price'});
          const modelData = result.data?.source?.startsWith("Panel de Métricas") ? metricsForModel(result.data) : result.data || {};
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(modelData).length <= 12000 ? JSON.stringify(modelData) : JSON.stringify({ truncated: true, summary: JSON.stringify(modelData).slice(0, 10000) }),
          });
          await store.commit([{ type: "create", path: `oliviaToolEvents/${hash(`${session.uid}:${requestId}:${toolCallCount}:${outcomes.indexOf(outcome)}:${call.call_id}`)}`, data: { userId: session.uid, userName: session.profile.name || "Usuario", role: normalizedRole(session.profile), conversationId: id, requestId, tool: call.name, skills: activeSkills.map(({ name, version }) => ({ name, version })), module: context.module, mode: body.inputMode || "text", result: outcome.error ? "failed" : "completed", origin: "Asistente IA / Olivia", createdAt: clock(), expiresAt: new Date(clock().getTime() + 30 * 86400000) } }]);
        }
        // A normalized proposal is the canonical final message; no further call can execute it.
        if(directReadAnswer){content=directReadAnswer;spokenContent=directReadAnswer;timings.answerRoundAvoided=true;break;}
        if (!taskRepairPending && nextState === "INFORMACION" && calls.every((call) => call.name === "update_task") && taskState.status === "collecting" && taskState.missingFields.length) {
          content = missingQuestion(taskState.missingFields);
          nextState = "DATOS_INCOMPLETOS";
          timings.questionRoundAvoided = true;
        }
        if (prepared) {
          content = prepared.summary;
          break;
        }
        if (["DATOS_INCOMPLETOS", "RECHAZADA", "ERROR"].includes(nextState))
          break;
      }
      if (taskRepairPending && !prepared && nextState === "INFORMACION") {
        nextState = "ERROR";
        content = "No pude completar los datos de esta consulta. Podés reformularla; la tarea anterior conserva sus datos.";
      }
      if (taskState.status === "working") taskState = { ...taskState, status: ["ERROR", "RECHAZADA"].includes(nextState) ? "failed" : "completed", updatedAt: clock() };
      if (!prepared && taskState.status === "collecting" && taskState.missingFields.length && nextState === "INFORMACION") nextState = "DATOS_INCOMPLETOS";
      if (naturalVoice && !prepared && nextState === "DATOS_INCOMPLETOS") content = shortVoiceQuestion(taskState, content);
      const missingSources = [...researchSources.values()].filter((source) => !content.includes(`](${source.url})`));
      if (!prepared && missingSources.length) content += "\n\nFuentes consultadas:\n" + missingSources.map((source) => `- [${source.title.replace(/[\[\]\n]/g, " ")}](${source.url})`).join("\n");
      Object.assign(event, { conversationId: id, taskId: taskState.id, route: profile.route, reasoningEffort: profile.reasoningEffort, routingReason: profile.routingReason, module: context.module, skills: activeSkills.map(({ name, version }) => ({ name, version })), tools: [...seen.keys()].map((key) => JSON.parse(key)[0]), durationMs: Date.now() - startedAt });
      event.modelCalls.forEach((call) => { call.taskId = taskState.id; });
      signal?.throwIfAborted();
      const result = await persistTurn({ content, prepared, draft, taskState, activeSkills, metricsPeriod, state: nextState, navigation, failure, voiceTranscript: spokenContent });
      const budget = await settleUsage({
        store,
        session,
        reservation,
        event,
        configuration: config,
        result: { conversationId: id },
        now: clock(),
      });
      settled = true;
      result.usage = publicUsage(
        session,
        budget,
        reservation.quota,
        event,
        config,
      );
      if (canAccessAdministration(session.profile)) result.telemetry = { requestId, taskId: taskState.id, model: profile.model, reasoningEffort: profile.reasoningEffort, route: profile.route, routingReason: profile.routingReason, calls: event.modelCalls, totalMs: Date.now() - startedAt, ...timings, toolCalls: toolCallCount, responseId: event.responseId, skills: activeSkills.map((skill) => ({ name: skill.name, version: skill.version })), retrieval: knowledgeResult.retrieval, documents: knowledge.map((doc) => ({ id: doc.id, title: doc.title })), retrievalWarning: knowledgeResult.warning || null, knowledgeStorageCostUsd: null };
      if(canAccessAdministration(session.profile)) {trace.mark('response.complete');result.telemetry={...result.telemetry,trace:trace.snapshot()};}
      return result;
    } catch (e) {
      let failure = publicOliviaFailure(e);
      if (e.name !== "AbortError") try { failure = await captureOliviaFailure({ store, session, error: e, operation: "chat", conversationId: id, requestId, now: clock() }); } catch { /* Preserve the original failure. */ }
      if (currentTask?.id) {
        event.taskId = currentTask.id;
        event.modelCalls?.forEach((call) => { call.taskId = currentTask.id; });
      }
      if (claimed)
        try {
          await persistTurn({
              content: failure.message,
              failure,
              state: "ERROR",
              taskState: currentTask,
              ...(currentTask ? { draft: currentTask.slots } : {}),
            });
        } catch {
          /* Original error takes precedence. Lease expires, preventing permanent lock. */
        }
      if (!settled)
        try {
          await settleUsage({
            store,
            session,
            reservation,
            event,
            configuration: config,
            errorCode: e.code || "assistant-error",
            now: clock(),
          });
        } catch {
          /* Durable reserved budget remains conservative until reconciliation. */
        }
      throw e;
    }
  }
  async function confirm(session, body) {
    assertOliviaAccess(session);
    const config = await configuration();
    if (!config.enabled)
      throw oliviaError(
        "assistant-disabled",
        "Olivia está deshabilitada.",
        503,
      );
    const id = safeId(body.conversationId),
      token = String(body.confirmationToken || ""),
      actionId = safeId(token.split(".")[0], "confirmación"),
      now = clock();
    const confirmed = await store.transaction(async (tx) => {
      const snapshot = await tx.getDocument(`oliviaConfirmations/${actionId}`),
        action = snapshot?.data;
      if (
        !action ||
        action.userId !== session.uid ||
        action.conversationId !== id ||
        action.sessionBinding !== sessionBinding(session) ||
        !action.tokenHash ||
        !timingSafeEqual(
          Buffer.from(action.tokenHash),
          Buffer.from(hash(token)),
        )
      )
        throw oliviaError(
          "confirmation-invalid",
          "La confirmación no corresponde a esta operación.",
          403,
        );
      if (action.status === "completed") return action.result;
      if (action.status !== "pending")
        throw oliviaError(
          "confirmation-invalid",
          "Esta propuesta fue cancelada o reemplazada.",
          409,
        );
      if (dateMs(action.expiresAt) <= now.getTime())
        throw oliviaError(
          "confirmation-expired",
          "La confirmación venció. Pedí una propuesta nueva.",
          409,
        );
      const conversationSnapshot = await tx.getDocument(
          `oliviaConversations/${id}`,
        ),
        conversation = conversationSnapshot?.data;
      assertConversationOwner(session, conversation, now);
      if (
        conversation.pendingActionId !== actionId ||
        conversation.busyRequestId || conversation.queuedChatRequestId
      )
        throw oliviaError(
          "confirmation-invalid",
          "La conversación cambió. Revisá la propuesta actual.",
          409,
        );
      const quota = quotaFor(config, session.uid, now, session.profile),
        budget = await tx.getDocument(
          `oliviaBudgets/${session.uid}_${quota.key}`,
        );
      if (
        !quota.unlimited && (budget?.data.usedTokens || 0) + (budget?.data.reservedTokens || 0) >=
        quota.tokens
      )
        throw oliviaError(
          "quota-exhausted",
          "El cupo de Olivia está agotado. Podés continuar manualmente.",
          429,
        );
      assertCapability(session, action.prepared.toolName);
      const { result, writes } = await executeOperation({
        session,
        prepared: action.prepared,
        transaction: tx,
        now,
        correlation: {
          conversationId: id,
          confirmationId: actionId,
          requestId: action.requestId || actionId,
          role: normalizedRole(session.profile),
          tool: action.prepared.toolName,
          skill: action.prepared.skill || null,
          userInput: action.prepared.userInput || null,
        },
      });
      const completedEntry = message("assistant", result.message, now);
      await tx.commitDocuments([
        ...writes,
        retainedMessage(id, completedEntry),
        {
          type: "update",
          path: `oliviaConfirmations/${actionId}`,
          data: {
            status: "completed",
            result,
            completedAt: now,
            confirmationToken: null,
          },
        },
        {
          type: "update",
          path: `oliviaConversations/${id}`,
          data: {
            pendingActionId: null,
            state: result.state || "COMPLETADA",
            draft: null,
            taskState: conversation.taskState ? { ...conversation.taskState, status: "completed", updatedAt: now } : null,
            messages: trimMessages([
              ...(conversation.messages || []),
              completedEntry,
            ]),
            messageCount: (conversation.messageCount || 0) + 1,
            updatedAt: now,
          },
        },
      ]);
      return result;
    });
    const snapshot = await state(session, id);
    if (confirmed?.navigation) snapshot.navigation = confirmed.navigation;
    return snapshot;
  }
  async function cancel(session, body) {
    assertOliviaAccess(session);
    const id = safeId(body.conversationId),
      now = clock();
    await store.transaction(async (tx) => {
      const snapshot = await tx.getDocument(`oliviaConversations/${id}`),
        conversation = snapshot?.data;
      assertConversationOwner(session, conversation, now);
      if (
        conversation.busyRequestId &&
        dateMs(conversation.busyUntil) > now.getTime()
      )
        throw oliviaError(
          "conversation-busy",
          "Esperá a que termine la consulta antes de cancelar.",
          409,
        );
      const action = conversation.pendingActionId
        ? await tx.getDocument(
            `oliviaConfirmations/${conversation.pendingActionId}`,
          )
        : null;
      const writes = [];
      if (action?.data.status === "pending")
        writes.push({
          type: "update",
          path: `oliviaConfirmations/${conversation.pendingActionId}`,
          data: { status: "cancelled", updatedAt: now },
        });
      const cancelledEntry = message(
        "assistant",
        "La propuesta quedó cancelada.",
        now,
      );
      writes.push(retainedMessage(id, cancelledEntry), {
        type: "update",
        path: `oliviaConversations/${id}`,
        data: {
          pendingActionId: null,
          state: "CANCELADA",
          draft: null,
          taskState: conversation.taskState ? { ...conversation.taskState, status: "cancelled", revision: conversation.taskState.revision + 1, updatedAt: now } : null,
          messages: trimMessages([
            ...(conversation.messages || []),
            cancelledEntry,
          ]),
          messageCount: (conversation.messageCount || 0) + 1,
          updatedAt: now,
        },
      });
      await tx.commitDocuments(writes);
    });
    return state(session, id);
  }
  async function invalidateTask(session, id, expectedRequestId = null) {
    safeId(id);
    if(expectedRequestId)safeId(expectedRequestId);
    await store.transaction(async (tx) => {
      const snapshot = await tx.getDocument(`oliviaConversations/${id}`), conversation = snapshot?.data;
      assertConversationOwner(session, conversation, clock());
      const requestPath=expectedRequestId?`oliviaRequests/${session.uid}_${expectedRequestId}`:null;
      const request=requestPath?(await tx.getDocument(requestPath))?.data:null;
      const marker=requestPath && (!request || request.status==='running')?[{type:request?'update':'create',path:requestPath,data:{userId:session.uid,requestId:expectedRequestId,interruptRequested:true,...(!request?{status:'cancelled',reservedTokens:0,createdAt:clock(),expiresAt:new Date(clock().getTime()+120000)}:{})}}]:[];
      if(expectedRequestId && conversation.busyRequestId!==expectedRequestId){if(marker.length)await tx.commitDocuments(marker);return;}
      const pending = conversation.pendingActionId ? await tx.getDocument(`oliviaConfirmations/${conversation.pendingActionId}`) : null;
      const writes = pending?.data.status === "pending" ? [{ type: "update", path: `oliviaConfirmations/${conversation.pendingActionId}`, data: { status: "superseded", updatedAt: clock() } }] : [];
      writes.push({ type: "update", path: `oliviaConversations/${id}`, data: { pendingActionId: null, busyRequestId: null, busyUntil: null, state: "DATOS_INCOMPLETOS", taskState: conversation.taskState ? { ...conversation.taskState, revision: conversation.taskState.revision + 1, status: "collecting", updatedAt: clock() } : null } });
      await tx.commitDocuments([...marker,...writes]);
    });
  }
  async function requestQuotaExtension(session, body) {
    assertOliviaAccess(session);
    safeId(body.requestId);
    const config = await configuration(),
      now = clock(),
      quota = quotaFor(config, session.uid, now, session.profile),
      id = `${session.uid}_${quota.key}`;
    const reason =
      typeof body.reason === "string"
        ? body.reason.slice(0, 400)
        : "Solicitud de ampliación de cupo";
    await store.transaction(async (tx) => {
      const existing = await tx.getDocument(`oliviaQuotaRequests/${id}`);
      if (existing) return;
      await tx.commitDocuments([
        {
          type: "create",
          path: `oliviaQuotaRequests/${id}`,
          data: {
            userId: session.uid,
            userName: session.profile.name || "Usuario",
            period: quota.key,
            status: "pending",
            reason,
            createdAt: now,
            retentionExpiresAt: retentionDate(config.retentionMonths, now),
          },
        },
      ]);
    });
    return {
      requested: true,
      message: "Tu solicitud quedó disponible para el Administrador.",
    };
  }
  async function getConfiguration(session) {
    if (!canAccessAdministration(session.profile))
      throw oliviaError(
        "permission-denied",
        "La configuración es exclusiva del Administrador.",
        403,
      );
    const config = await configuration({ resolveCosts: false }),
      now = clock(),
      requests = await store.query(
        "oliviaQuotaRequests",
        [["status", "EQUAL", "pending"]],
        100,
      );
    return {
      configuration: config,
      routeUsage: aggregateRoutes(await store.query("oliviaUsage", [], 500, [["createdAt", "DESCENDING"]])),
      users: (await store.query("users", [], 100))
        .filter((p) => p.active === true)
        .map((p) => ({
          id: p.id,
          name: p.name || p.email || p.id,
          role: normalizedRole(p),
        })),
      quotaRequests: requests
        .filter(
          (r) =>
            r.period === quotaFor(config, r.userId, now).key &&
            dateMs(r.retentionExpiresAt) > now.getTime() &&
            !(
              config.userQuotas[r.userId]?.temporaryPeriod === r.period &&
              config.userQuotas[r.userId]?.temporaryExtraTokens > 0
            ),
        )
        .map((r) => ({
          id: r.id,
          userId: r.userId,
          userName: r.userName,
          period: r.period,
          createdAt: r.createdAt,
        })),
      providerConfigured: Boolean(env.OPENAI_API_KEY),
      googleTtsConfigured: hasGoogleCloudTtsCredentials(env),
      policyVersion: OLIVIA_POLICY_VERSION,
    };
  }
  async function saveConfiguration(session, body) {
    if (!canAccessAdministration(session.profile))
      throw oliviaError(
        "permission-denied",
        "La configuración es exclusiva del Administrador.",
        403,
      );
    const now = clock();
    if (!session.authTime || now.getTime() / 1000 - session.authTime > 300)
      throw oliviaError(
        "reauthentication-required",
        "Reautenticate manualmente para cambiar la configuración de IA.",
        403,
      );
    if (body.confirmed !== true)
      throw oliviaError(
        "confirmation-required",
        "Confirmá el cambio de configuración en pantalla.",
        422,
      );
    const next = validateConfiguration(body.configuration),
      requestId = safeId(body.requestId);
    await store.transaction(async (tx) => {
      const profile = await tx.getDocument(`users/${session.uid}`);
      if (
        !profile ||
        !canAccessAdministration({ ...profile.data, id: session.uid }) ||
        profile.data.active !== true
      )
        throw oliviaError("permission-denied", "Tus permisos cambiaron.", 403);
      const current = await tx.getDocument("oliviaConfiguration/global"),
        audit = await tx.getDocument(
          `auditLogs/olivia_configuration_${requestId}`,
        );
      if (audit) {
        if (
          audit.data.userId !== session.uid ||
          audit.data.configurationHash !== hash(JSON.stringify(next))
        )
          throw oliviaError(
            "request-conflict",
            "Este intento corresponde a otra configuración.",
            409,
          );
        return;
      }
      await tx.commitDocuments([
        {
          type: current ? "update" : "create",
          path: "oliviaConfiguration/global",
          data: { ...next, updatedAt: now, updatedBy: session.uid },
        },
        {
          type: "create",
          path: `auditLogs/olivia_configuration_${requestId}`,
          data: {
            userId: session.uid,
            userName: session.profile.name || "Administrador",
            role: normalizedRole(session.profile),
            action: "ai.configuration.updated",
            moduleId: "settings",
            entityType: "aiConfiguration",
            entityId: "global",
            title: "Configuración de Olivia actualizada",
            origin: "Configuración manual de IA",
            requestId,
            configurationHash: hash(JSON.stringify(next)),
            before: current?.data || null,
            after: next,
            status: "completed",
            createdAt: now,
          },
        },
      ]);
    });
    return getConfiguration(session);
  }
  return {
    state,
    chat,
    confirm,
    cancel,
    configuration,
    getConfiguration,
    invalidateTask,
    saveConfiguration,
    history,
    resumeConversation,
    estimate,
    usage,
    requestQuotaExtension,
  };
}
