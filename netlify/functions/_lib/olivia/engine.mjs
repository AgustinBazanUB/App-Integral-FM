import { executeToolBatch } from "./toolExecution.mjs";
import { progressiveStock, taskFromTool, taskControl, missingQuestion, updateTask, taskUpdateTool, taskSlotSchema, requiredFields, isCorrection, operationalIntent } from "./tasks.mjs";
import { aggregateRoutes } from "./modelRouter.mjs";
import { OLIVIA_CAPABILITIES } from "../../../../src/shared/oliviaCapabilities.mjs";
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
import { message, retainedMessage, sessionBinding, permissionScope, dateMs, trimMessages, assertConversationOwner, verifyLegacyConversationScope, createConversationStorage } from "./conversations.mjs";
export { assertConversationOwner } from "./conversations.mjs";
export function createOliviaEngine({
  store,
  env = process.env,
  provider = openaiRequest,
  clock = () => new Date(),
  pricingResolver = async (config) => config,
} = {}) {
  const { history, resumeConversation } = createConversationStorage({ store, clock, configuration, state });
  async function configuration({ resolveCosts = true } = {}) {
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
    return resolveCosts ? pricingResolver(config, clock()) : config;
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
      usage: await usage(session, config),
      capabilities: capabilities(session),
      providerConfigured: Boolean(env.OPENAI_API_KEY),
      enabled: config.enabled,
      audioLimits: config.audioLimits,
      voiceProtocol: config.voiceProtocol,
      policyVersion: OLIVIA_POLICY_VERSION,
      ...(estimate ? { estimate } : {}),
    };
  }
  function estimateFor(session, config, conversation, context, draft = "") {
    const profile = modelProfile(config, session, screenContext(context), { message: draft, task: conversation.taskState });
    const input = { instructions: OLIVIA_INSTRUCTIONS, tools: toolDefinitions(session, { query: draft, context }), context: userContext(session), screen: screenContext(context), documentation: retrieveOliviaKnowledge(draft, { role: normalizedRole(session.profile), module: context.module, limit: 4 }), memory: conversation.memory, messages: conversation.messages.slice(-16), draft };
    const inputTokens = Math.ceil(Buffer.byteLength(JSON.stringify(input), "utf8") / 4), outputTokens = config.responseLimits.maxOutputTokens;
    const costs = costForUsage({ model: profile.model, inputTokens, outputTokens }, config);
    const common = { estimatedCostArs: costs.actualCostArs };
    return canAccessAdministration(session.profile) ? { ...common, excludesUnmeasuredAttachmentsAndRetrieval: true, model: profile.model, reasoningEffort: profile.reasoningEffort, route: profile.route, routingReason: profile.routingReason, estimatedTokens: inputTokens + outputTokens, estimatedCostUsd: costs.actualCostUsd, reference: config.pricingReference || null } : common;
  }
  async function estimate(session, body) {
    assertOliviaAccess(session);
    const c = await store.get(`oliviaConversations/${safeId(body.conversationId)}`);
    assertConversationOwner(session, c, clock());
    await verifyLegacyConversationScope(session, c, store);
    const draft = typeof body.message === "string" ? body.message.slice(0, 8000) : "";
    return { estimate: estimateFor(session, await configuration(), c, body.screenContext || {}, draft) };
  }

  async function claimConversation(
    session,
    id,
    requestId,
    userMessage,
    inputMode,
    attachments = [],
    inputId = null,
    preserveInputPending = true,
    context = null,
  ) {
    const now = clock();
    return store.transaction(async (tx) => {
      const snapshot = await tx.getDocument(`oliviaConversations/${id}`);
      const conversation = snapshot ? { ...snapshot.data, id } : null;
      assertConversationOwner(session, conversation, now);
      await verifyLegacyConversationScope(session, conversation, store);
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
      const repeatedInput = taskControl(userMessage) === "acknowledge" || (preserveInputPending && inputId && conversation.messages?.some((entry) => entry.inputId === inputId && entry.role === "user"));
      if (previous?.data.status === "pending" && !repeatedInput)
        writes.push({
          type: "update",
          path: `oliviaConfirmations/${conversation.pendingActionId}`,
          data: { status: "superseded", updatedAt: now },
        });
      const userEntry = message("user", userMessage, now, inputMode),
        messages = trimMessages([...(conversation.messages || []), userEntry]);
      if (inputId) {
        const previousInput = conversation.messages?.find((entry) => entry.inputId === inputId && entry.role === "user");
        if (previousInput && previousInput.content !== userMessage) throw oliviaError("realtime-input-changed", "La intervención de voz cambió.", 409);
        if (previousInput) { messages.pop(); }
        else userEntry.inputId = inputId;
      }
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
            roleBinding: normalizedRole(session.profile),
            permissionScope: permissionScope(session),
            busyUntil: new Date(now.getTime() + 120000),
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
    { content, prepared, draft, taskState, activeSkills, state: nextState, navigation, hiddenFromChat = false, preservePending = false },
    config,
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
          draft: prepared?.canonicalArgs || (draft !== undefined ? draft : conversation.draft || null),
          ...(taskState !== undefined ? { taskState } : {}),
          ...(activeSkills ? { activeSkills: activeSkills.slice(0, 2).map(({ name, version }) => ({ name, version })) } : {}),
          busyRequestId: null,
          busyUntil: null,
          updatedAt: now,
        },
      });
      await tx.commitDocuments(writes);
    });
    const result = await state(session, id);
    if (navigation) result.navigation = navigation;
    return result;
  }
  async function chat(session, body, { onEvent, signal, voiceInputId = null } = {}) {
    const startedAt = Date.now(), timings = { modelCalls: 0, providerMs: 0, toolsMs: 0 };
    assertOliviaAccess(session);
    const userMessage = safeUserMessage(body.message),
      config = await configuration();
    if (!config.enabled)
      throw oliviaError(
        "assistant-disabled",
        "Olivia está deshabilitada. La aplicación sigue disponible manualmente.",
        503,
      );
    const requestId = safeId(body.requestId, "intento"),
      context = screenContext(body.screenContext || {}),
      id = body.conversationId
        ? safeId(body.conversationId)
        : (await state(session)).conversationId;
    if (body.inputMode === "realtime") {
      const live = await store.get(
        `oliviaRealtime/${safeId(body.realtimeSessionId, "sesión de voz")}`,
      );
      if (
        !live ||
        live.userId !== session.uid ||
        live.conversationId !== id ||
        live.sessionBinding !== sessionBinding(session) ||
        live.status !== "active" ||
        dateMs(live.expiresAt) < clock().getTime()
      )
        throw oliviaError(
          "realtime-expired",
          "La conversación de voz terminó. Podés continuar escribiendo.",
          409,
        );
    }
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
      currentTask = undefined;
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
        voiceInputId,
        false,
        context,
      );
      claimed = true;
      currentTask = conversation.taskState || null;
      onEvent?.({ type: "accepted", conversationId: id, message: conversation.messages.at(-1) });
      const deterministicTools = [];
      const deterministicTaskId = conversation.taskState?.intent === "prepare_stock_load" && !["completed", "cancelled"].includes(conversation.taskState.status) ? conversation.taskState.id : randomUUID();
      const run = async (name, args) => {
        const result = await runTool({ session, name, args, store, context, now: clock(), provider, env });
        deterministicTools.push(name);
        await store.commit([{ type: "create", path: `oliviaToolEvents/${randomUUID()}`, data: { userId: session.uid, conversationId: id, taskId: deterministicTaskId, requestId, tool: name, module: context.module, mode: body.inputMode || "text", result: "completed", origin: "Asistente IA / Olivia", createdAt: clock(), expiresAt: new Date(clock().getTime() + 30 * 86400000) } }]);
        return result;
      };
      const control = !attachments.length ? taskControl(userMessage) : null;
      const progressive = !control && !attachments.length ? await progressiveStock({ previous: conversation.taskState, initialId: deterministicTaskId, message: userMessage, context, run, check: () => assertCapability(session, "prepare_stock_load"), now: clock() }) : null;
      if (control || progressive) {
        const task = progressive?.task || (conversation.taskState ? { ...conversation.taskState, revision: conversation.taskState.revision + 1, status: control === "cancel" ? "cancelled" : conversation.taskState.status, updatedAt: clock() } : null);
        const prepared = progressive?.result.prepared;
        const result = await saveTurn(session, id, requestId, { content: progressive?.content || (control === "cancel" ? "La tarea quedó cancelada." : conversation.pendingActionId ? "Revisá y confirmá con Sí en la tarjeta. La respuesta por voz o texto no ejecuta la acción." : "Dale, seguimos cuando me indiques."), prepared, taskState: task, draft: control === "cancel" ? null : task?.slots || conversation.draft, state: control === "cancel" ? "CANCELADA" : progressive?.result.state || "INFORMACION", preservePending: control === "acknowledge" }, config);
        event = { ...event, conversationId: id, taskId: task?.id || null, route: "deterministic", routingReason: control || "progressive-stock", measurement: "provider", modelCalls: [], tools: deterministicTools, durationMs: Date.now() - startedAt, module: context.module };
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
      const [knowledgeResult, routedSkills] = await Promise.all([retrieveKnowledge({ session, query: userMessage, context, store, provider, env }), routeSkills(session, userMessage, conversation.activeSkills)]);
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
        await tx.commitDocuments([{ type: "update", path: `oliviaConversations/${id}`, data: { taskState } }]);
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
            taskRequirements: Object.fromEntries(capabilities(session).filter((name) => name.startsWith("prepare_") || name === "forecast_fair").map((name) => [name, requiredFields(name)])),
            memory: conversation.memory || null,
            documentation: knowledge,
          }),
        },
        ...conversation.messages
          .slice(-16)
          .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) })),
      ];
      const seen = new Map(), loadedTools = new Set();
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
        if (selected.length) input[inputIndex].content = [{ type: "input_text", text: entry.content.slice(0, 2000) }, ...selected.map(attachmentInput)];
      }
      if (unavailableAttachments.length) input.push({ role: "user", content: JSON.stringify({ type: "UNTRUSTED_CONTEXT_DATA", unavailableAttachments }) });
      let prepared = null,
        draft = null,
        navigation = null,
        nextState = "INFORMACION",
        content = "",
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
          instructions: OLIVIA_INSTRUCTIONS + "\nAntes de pedir aclaraciones, usá update_task para conservar parámetros parciales. Consultá historia, pantalla y herramientas para resolver entidades por nombre; nunca pidas IDs al usuario. Reutilizá taskState.slots y aplicá correcciones sobre la misma tarea. Al cambiar de intención empezá una nueva tarea. Para análisis simple inferí un período razonable con businessTime y declaralo. Para transferencias consultá depósitos y stock; si solo un origen autorizado alcanza, proponelo; si varios alcanzan, preguntá cuál. Nunca inventes cantidades recibidas físicamente. Una tarea creativa solo existe en marketing/social autorizados." + (activeSkills.length ? "\nProcesos versionados permitidos (no conceden permisos):\n" + activeSkills.map((skill) => skill.content).join("\n\n") : ""),
          input,
          tools: finalResponse ? [] : [...toolDefinitions(session, { query: userMessage, context, required: activeSkills.flatMap((skill) => skill.requiredTools), loaded: [...loadedTools] }), taskUpdateTool(capabilities(session))],
          ...(finalResponse ? { tool_choice: "none" } : {}),
          parallel_tool_calls: true,
          max_output_tokens: config.responseLimits.maxOutputTokens,
          ...(onEvent ? { stream: true } : {}),
        };
        // UTF-8 bytes conservatively bound tokenizer input; output is capped by API.
        await increaseReservation({
          store,
          reservation,
          amount: Buffer.byteLength(JSON.stringify(bodyRequest), "utf8") + config.responseLimits.maxOutputTokens,
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
          payload = await provider("responses", bodyRequest, {
            env,
            timeoutMs: Math.min(config.responseLimits.providerTimeoutMs, remaining),
            signal,
            onEvent: onEvent ? (frame) => { if (frame.type === "delta" && timings.firstDeltaMs == null) timings.firstDeltaMs = Date.now() - startedAt; onEvent(frame); } : undefined,
          });
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
        const outcomes = await executeToolBatch(calls, async (call) => {
          const args = JSON.parse(call.arguments), key = JSON.stringify([call.name, args]);
          if (call.name === "update_task") {
            validateSchema(args, taskUpdateTool(capabilities(session)).parameters);
            if (args.intent === "creative_brief") {
              if (profile.route !== "sol-creative") throw oliviaError("permission-denied", "El trabajo creativo requiere Marketing o Redes autorizado.", 403);
            } else assertCapability(session, args.intent);
            taskState = updateTask(taskState.intent === args.intent ? taskState : conversation.taskState, args.intent, args.slotsJson, clock());
            taskRepairPending = false;
            taskState.route = profile;
            currentTask = taskState;
            return { data: { taskId: taskState.id, slots: taskState.slots, missing: taskState.missingFields } };
          }
          if (!seen.has(key)) seen.set(key, runTool({ session, name: call.name, args, store, context, now: clock(), provider, env }));
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
            const toolModule = OLIVIA_CAPABILITIES[call.name]?.module || (call.name === "update_task" ? "core" : "locations");
            if (toolModule !== "core") touchedModules.add(toolModule);
            for (const [key, value] of Object.entries(args)) if (/Id$/.test(key) && typeof value === "string") entityIds.add(value);
            for (const value of Object.values(result.data || {})) if (Array.isArray(value)) dataRows += value.length;
            if (call.name.startsWith("prepare_")) {
              taskState = taskFromTool(taskState.intent === call.name ? taskState : conversation.taskState, call.name, args, result, clock());
              taskState.route = profile;
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
                (result.state === "DATOS_INCOMPLETOS" ? missingQuestion(taskState.missingFields) : null) || result.data?.summary ||
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
              content = result.data.message;
            }
          }
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(result.data || {}).length <= 12000 ? JSON.stringify(result.data || {}) : JSON.stringify({ truncated: true, summary: JSON.stringify(result.data || {}).slice(0, 10000) }),
          });
          await store.commit([{ type: "create", path: `oliviaToolEvents/${hash(`${session.uid}:${requestId}:${toolCallCount}:${outcomes.indexOf(outcome)}:${call.call_id}`)}`, data: { userId: session.uid, userName: session.profile.name || "Usuario", role: normalizedRole(session.profile), conversationId: id, requestId, tool: call.name, skills: activeSkills.map(({ name, version }) => ({ name, version })), module: context.module, mode: body.inputMode || "text", result: outcome.error ? "failed" : "completed", origin: "Asistente IA / Olivia", createdAt: clock(), expiresAt: new Date(clock().getTime() + 30 * 86400000) } }]);
        }
        // A normalized proposal is the canonical final message; no further call can execute it.
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
      if (taskState.status === "working") taskState = { ...taskState, status: "completed", updatedAt: clock() };
      if (!prepared && taskState.status === "collecting" && taskState.missingFields.length && nextState === "INFORMACION") nextState = "DATOS_INCOMPLETOS";
      Object.assign(event, { conversationId: id, taskId: taskState.id, route: profile.route, reasoningEffort: profile.reasoningEffort, routingReason: profile.routingReason, module: context.module, skills: activeSkills.map(({ name, version }) => ({ name, version })), tools: [...seen.keys()].map((key) => JSON.parse(key)[0]), durationMs: Date.now() - startedAt });
      event.modelCalls.forEach((call) => { call.taskId = taskState.id; });
      const result = await saveTurn(
        session,
        id,
        requestId,
        { content, prepared, draft, taskState, activeSkills, state: nextState, navigation },
        config,
      );
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
      return result;
    } catch (e) {
      if (currentTask?.id) {
        event.taskId = currentTask.id;
        event.modelCalls?.forEach((call) => { call.taskId = currentTask.id; });
      }
      if (claimed)
        try {
          await saveTurn(
            session,
            id,
            requestId,
            {
              content:
                e.status && e.status < 500
                  ? e.message
                  : "Olivia no pudo completar la consulta. Podés continuar desde el panel manual.",
              state: "ERROR",
              taskState: currentTask,
              ...(currentTask ? { draft: currentTask.slots } : {}),
            },
            config,
          );
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
  async function requireLiveVoice(session, body, { transcript = false } = {}) {
    assertOliviaAccess(session);
    const config = await configuration(), id = safeId(body.conversationId);
    if (!config.enabled) throw oliviaError("assistant-disabled", "Olivia está deshabilitada.", 503);
    const live = await store.get(`oliviaRealtime/${safeId(body.realtimeSessionId)}`);
    const transcriptGrace = transcript && live?.status === "closed" && dateMs(live.closedAt) + 60000 > clock().getTime();
    if (!live || !live.nativeTools || (!transcriptGrace && (live.status !== "active" || dateMs(live.expiresAt) <= clock().getTime())) || live.userId !== session.uid || live.conversationId !== id || live.sessionBinding !== sessionBinding(session)) throw oliviaError("realtime-expired", "La sesión de voz terminó. Podés continuar escribiendo.", 409);
    return { config, live, id };
  }
  async function realtimeTool(session, body) {
    const { config, id, live } = await requireLiveVoice(session, body);
    const freshProfile = await store.get(`users/${session.uid}`);
    session = { ...session, profile: { ...freshProfile, id: session.uid } };
    assertCapability(session, body.tool);
    const requestId = safeId(body.requestId), callId = safeId(body.callId), inputId = safeId(body.inputId);
    const callKey = hash(`${session.uid}:${body.realtimeSessionId}:${callId}`), path = `oliviaRealtimeToolCalls/${callKey}`;
    const inputFingerprint = hash(JSON.stringify({ tool: body.tool, args: body.args, inputId, message: safeUserMessage(body.message) }));
    const existing = await store.get(path);
    if (existing && existing.inputFingerprint !== inputFingerprint) throw oliviaError("request-already-used", "La llamada ya corresponde a otros datos.", 409);
    if (existing?.status === "completed") return { ...await state(session, id), data: existing.data, toolDefinitions: existing.toolDefinitions || [], nativeTools: true };
    await store.transaction(async (tx) => {
      const [claimed, live] = await Promise.all([tx.getDocument(path), tx.getDocument(`oliviaRealtime/${body.realtimeSessionId}`)]);
      if (claimed) throw oliviaError("request-already-used", "Esta herramienta ya fue solicitada. Recuperá el chat.", 409);
      if (live?.data.status !== "active" || Number(live.data.toolCalls || 0) >= 20) throw oliviaError("tool-limit", "La sesión alcanzó su límite de consultas; podés continuar por texto.", 429);
      await tx.commitDocuments([{ type: "create", path, data: { status: "running", inputFingerprint, userId: session.uid, conversationId: id, expiresAt: new Date(clock().getTime() + 86400000), createdAt: clock() } }, { type: "update", path: `oliviaRealtime/${body.realtimeSessionId}`, data: { toolCalls: Number(live.data.toolCalls || 0) + 1 } }]);
    });
    let claimed = false;
    try {
      const userMessage = safeUserMessage(body.message);
      await claimConversation(session, id, requestId, userMessage, "realtime", [], `${body.realtimeSessionId}_${inputId}`);
      claimed = true;
      const outcome = await runTool({ session, name: body.tool, args: body.args, store, context: screenContext(body.screenContext || {}), now: clock(), provider, env });
      const available = discoverSkills(session);
      const loadedSkills = (live.loadedSkills || []).filter((skill) => available.some((item) => item.name === skill.name && item.version === skill.version));
      if (outcome.skill) {
        const skill = { name: outcome.skill.name, version: outcome.skill.version };
        await store.commit([{ type: "update", path: `oliviaRealtime/${body.realtimeSessionId}`, data: { loadedSkills: [...loadedSkills.filter((item) => item.name !== skill.name), skill] } }]);
      }
      if (outcome.prepared) {
        outcome.prepared.userInput = userMessage.slice(0, 1000);
        outcome.prepared.skill = loadedSkills.find((skill) => available.find((item) => item.name === skill.name)?.requiredTools.includes(outcome.prepared.toolName)) || null;
      }
      const result = await saveTurn(session, id, requestId, { content: outcome.prepared?.summary || outcome.data?.message || JSON.stringify(outcome.data).slice(0, 7000), prepared: outcome.prepared, state: outcome.state || "INFORMACION", navigation: outcome.navigation, hiddenFromChat: !outcome.prepared, preservePending: true }, config);
      const definitions = outcome.loadTools?.length ? toolDefinitions(session, { query: "", loaded: outcome.loadTools }).map(({ strict, ...definition }) => definition) : [];
      await store.commit([{ type: "update", path, data: { status: "completed", data: outcome.data || {}, toolDefinitions: definitions, completedAt: clock() } }, { type: "create", path: `oliviaToolEvents/${callKey}`, data: { userId: session.uid, userName: session.profile.name || "Usuario", role: normalizedRole(session.profile), conversationId: id, requestId, tool: body.tool, mode: "realtime", skill: outcome.skill?.name || outcome.prepared?.skill?.name || null, result: "completed", createdAt: clock(), expiresAt: new Date(clock().getTime() + 86400000) } }]);
      return { ...result, data: outcome.data || {}, toolDefinitions: definitions, nativeTools: true };
    } catch (error) {
      if (claimed) await saveTurn(session, id, requestId, { content: error.status && error.status < 500 ? error.message : "No se pudo consultar el sistema.", state: "ERROR", preservePending: true }, config).catch(() => {});
      await store.commit([{ type: "update", path, data: { status: "failed", code: error.code || "tool-error" } }]).catch(() => {});
      throw error;
    }
  }
  async function realtimeTranscript(session, body) {
    const { id } = await requireLiveVoice(session, body, { transcript: true }), now = clock();
    const text = safeUserMessage(body.text), inputId = safeId(body.inputId), responseId = safeId(body.responseId);
    const turnKey = hash(`${session.uid}:${body.realtimeSessionId}:${responseId}`), inputKey = `${body.realtimeSessionId}_${inputId}`;
    await store.transaction(async (tx) => {
      const [conversation, existing] = await Promise.all([tx.getDocument(`oliviaConversations/${id}`), tx.getDocument(`oliviaRealtimeTurns/${turnKey}`)]);
      assertConversationOwner(session, conversation?.data, now);
      if (existing) return;
      if (conversation.data.busyRequestId && dateMs(conversation.data.busyUntil) > now.getTime()) throw oliviaError("conversation-busy", "El chat está procesando otra consulta. La transcripción sigue visible en la sesión.", 409);
      const messages = [...(conversation.data.messages || [])], entries = [];
      if (!messages.some((entry) => entry.role === "user" && entry.inputId === inputKey)) {
        const userEntry = message("user", safeUserMessage(body.message), now, "realtime"); userEntry.inputId = inputKey; messages.push(userEntry); entries.push(userEntry);
      }
      const assistantEntry = message("assistant", text, now, "realtime"); messages.push(assistantEntry); entries.push(assistantEntry);
      await tx.commitDocuments([...entries.map((entry) => retainedMessage(id, entry)), { type: "create", path: `oliviaRealtimeTurns/${turnKey}`, data: { userId: session.uid, conversationId: id, createdAt: now, expiresAt: new Date(now.getTime() + 86400000) } }, { type: "update", path: `oliviaConversations/${id}`, data: { messages: trimMessages(messages), messageCount: (conversation.data.messageCount || 0) + entries.length, memory: reduceConversationMemory(conversation.data.memory, messages), updatedAt: now } }]);
    });
    return state(session, id);
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
        conversation.busyRequestId
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
  async function invalidateTask(session, id) {
    safeId(id);
    await store.transaction(async (tx) => {
      const snapshot = await tx.getDocument(`oliviaConversations/${id}`), conversation = snapshot?.data;
      assertConversationOwner(session, conversation, clock());
      const pending = conversation.pendingActionId ? await tx.getDocument(`oliviaConfirmations/${conversation.pendingActionId}`) : null;
      const writes = pending?.data.status === "pending" ? [{ type: "update", path: `oliviaConfirmations/${conversation.pendingActionId}`, data: { status: "superseded", updatedAt: clock() } }] : [];
      writes.push({ type: "update", path: `oliviaConversations/${id}`, data: { pendingActionId: null, busyRequestId: null, busyUntil: null, state: "DATOS_INCOMPLETOS", taskState: conversation.taskState ? { ...conversation.taskState, revision: conversation.taskState.revision + 1, status: "collecting", updatedAt: clock() } : null } });
      await tx.commitDocuments(writes);
    });
  }
  async function recordSpeech(session, id, inputId, content, role) {
    safeId(id); safeId(inputId); assertOliviaAccess(session);
    content = safeUserMessage(content);
    if (!["user", "assistant"].includes(role)) throw oliviaError("invalid-input", "Intervención inválida.");
    await store.transaction(async (tx) => {
      const snapshot = await tx.getDocument(`oliviaConversations/${id}`), conversation = snapshot?.data;
      assertConversationOwner(session, conversation, clock());
      const existing = conversation.messages?.find((entry) => entry.inputId === inputId);
      if (existing) {
        if (role === "user" && existing.content !== content) {
          await tx.commitDocuments([{ type: "update", path: `oliviaConversations/${id}/messages/${existing.id}`, data: { content } }, { type: "update", path: `oliviaConversations/${id}`, data: { messages: conversation.messages.map((entry) => entry.id === existing.id ? { ...entry, content } : entry), updatedAt: clock() } }]);
        }
        return;
      }
      const entry = message(role, content, clock(), "realtime"); entry.inputId = inputId;
      const last = conversation.messages?.at(-1);
      // Preserve the canonical backend reply and retain its spoken version
      // without displaying two assistant answers for one delegated turn.
      if (role === "assistant" && last?.role === "assistant") {
        const messages = conversation.messages.map((item) => item.id === last.id ? { ...item, voiceTranscript: content } : item);
        await tx.commitDocuments([{ type: "update", path: `oliviaConversations/${id}/messages/${last.id}`, data: { voiceTranscript: content } }, { type: "update", path: `oliviaConversations/${id}`, data: { messages, updatedAt: clock() } }]);
      } else await tx.commitDocuments([retainedMessage(id, entry), { type: "update", path: `oliviaConversations/${id}`, data: { messages: trimMessages([...(conversation.messages || []), entry]), messageCount: (conversation.messageCount || 0) + 1, updatedAt: clock() } }]);
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
    realtimeTool,
    realtimeTranscript,
    cancel,
    configuration,
    getConfiguration,
    invalidateTask,
    recordSpeech,
    saveConfiguration,
    history,
    resumeConversation,
    estimate,
    usage,
    requestQuotaExtension,
  };
}
