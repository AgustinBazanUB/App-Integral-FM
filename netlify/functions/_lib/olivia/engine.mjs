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
  costForUsage,
} from "../../../../src/shared/oliviaContracts.mjs";
import { retrieveOliviaKnowledge } from "../../../../src/shared/oliviaKnowledge.mjs";
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
  reserveUsage,
  increaseReservation,
  settleUsage,
} from "./usage.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const message = (role, content, now, inputMode = "text") => ({
  id: randomUUID(),
  role,
  content,
  createdAt: now.toISOString(),
  inputMode,
});
const retainedMessage = (id, m) => ({
  type: "create",
  path: `oliviaConversations/${id}/messages/${m.id}`,
  data: { ...m, createdAt: new Date(m.createdAt) },
});
const sessionBinding = (session) => String(session.authTime || "");
const dateMs = (value) => new Date(value).getTime();
export function assertConversationOwner(
  session,
  conversation,
  now = new Date(),
) {
  if (!conversation || conversation.userId !== session.uid)
    throw oliviaError(
      "conversation-not-found",
      "No se encontró esta conversación.",
      404,
    );
  if (conversation.sessionBinding !== sessionBinding(session))
    throw oliviaError(
      "session-changed",
      "Tu sesión cambió. Iniciá una nueva conversación.",
      409,
    );
  if (dateMs(conversation.expiresAt) <= now.getTime())
    throw oliviaError(
      "conversation-expired",
      "Esta conversación venció. Iniciá una nueva.",
      410,
    );
}
function trimMessages(messages) {
  const result = [];
  let characters = 0;
  for (const m of [...messages].reverse()) {
    if (result.length >= 40 || characters + m.content.length > 18000) break;
    result.unshift(m);
    characters += m.content.length;
  }
  return result;
}
export function createOliviaEngine({
  store,
  env = process.env,
  provider = openaiRequest,
  clock = () => new Date(),
} = {}) {
  async function configuration() {
    const raw = await store.get("oliviaConfiguration/global");
    return raw
      ? validateConfiguration(
          Object.fromEntries(
            Object.keys(defaultOliviaConfiguration())
              .filter((k) => raw[k] !== undefined)
              .map((k) => [k, raw[k]]),
          ),
        )
      : defaultOliviaConfiguration(env);
  }
  async function usage(session, config, event = null) {
    const quota = quotaFor(config, session.uid, clock()),
      budget = await store.get(`oliviaBudgets/${session.uid}_${quota.key}`);
    return publicUsage(session, budget, quota, event, config);
  }
  async function state(session, id, context = {}) {
    assertOliviaAccess(session);
    const config = await configuration();
    let conversation = id
      ? await store.get(`oliviaConversations/${safeId(id)}`)
      : null;
    if (id) assertConversationOwner(session, conversation, clock());
    if (!conversation) {
      const now = clock(),
        conversationId = randomUUID();
      conversation = {
        id: conversationId,
        userId: session.uid,
        sessionBinding: sessionBinding(session),
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
    let estimate;
    if (canAccessAdministration(session.profile)) {
      const profile = modelProfile(
          config,
          {
            ...session,
            profile: {
              ...session.profile,
              role: normalizedRole(session.profile),
            },
          },
          screenContext(context),
        ),
        estimatedInput =
          Buffer.byteLength(
            JSON.stringify((conversation.messages || []).slice(-16)),
            "utf8",
          ) + 6000,
        estimatedOutput = 1200,
        cost = costForUsage(
          {
            model: profile.model,
            inputTokens: estimatedInput,
            outputTokens: estimatedOutput,
          },
          config,
        );
      estimate = {
        model: profile.model,
        reasoningEffort: profile.reasoningEffort,
        estimatedTokens: estimatedInput + estimatedOutput,
        estimatedCostUsd: cost.actualCostUsd,
        estimatedCostArs: cost.actualCostArs,
      };
    }
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
      policyVersion: OLIVIA_POLICY_VERSION,
      ...(estimate ? { estimate } : {}),
    };
  }
  async function claimConversation(
    session,
    id,
    requestId,
    userMessage,
    inputMode,
  ) {
    const now = clock();
    return store.transaction(async (tx) => {
      const snapshot = await tx.getDocument(`oliviaConversations/${id}`);
      const conversation = snapshot ? { ...snapshot.data, id } : null;
      assertConversationOwner(session, conversation, now);
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
      if (previous?.data.status === "pending")
        writes.push({
          type: "update",
          path: `oliviaConfirmations/${conversation.pendingActionId}`,
          data: { status: "superseded", updatedAt: now },
        });
      const userEntry = message("user", userMessage, now, inputMode),
        messages = trimMessages([...(conversation.messages || []), userEntry]);
      await tx.commitDocuments([
        ...writes,
        retainedMessage(id, userEntry),
        {
          type: "update",
          path: `oliviaConversations/${id}`,
          data: {
            messages,
            messageCount: (conversation.messageCount || 0) + 1,
            state: "PREPARANDO_ACCION",
            pendingActionId: null,
            busyRequestId: requestId,
            busyUntil: new Date(now.getTime() + 120000),
            updatedAt: now,
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
    { content, prepared, draft, state: nextState, navigation },
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
      if (prepared)
        writes.push({
          type: "create",
          path: `oliviaConfirmations/${actionId}`,
          data: {
            id: actionId,
            userId: session.uid,
            sessionBinding: sessionBinding(session),
            conversationId: id,
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
      writes.push(retainedMessage(id, assistantEntry), {
        type: "update",
        path: `oliviaConversations/${id}`,
        data: {
          messages,
          messageCount: (conversation.messageCount || 0) + 1,
          state: prepared
            ? "ESPERANDO_CONFIRMACION"
            : nextState || "INFORMACION",
          pendingActionId: actionId,
          draft: prepared?.canonicalArgs || draft || conversation.draft || null,
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
  async function chat(session, body) {
    const startedAt = Date.now();
    assertOliviaAccess(session);
    const userMessage = safeUserMessage(body.message),
      config = await configuration();
    if (!config.enabled)
      throw oliviaError(
        "assistant-disabled",
        "Olivia está deshabilitada. La aplicación sigue disponible manualmente.",
        503,
      );
    if (!env.OPENAI_API_KEY)
      throw oliviaError(
        "openai-key-missing",
        "Olivia necesita la configuración del servicio de IA. Podés continuar manualmente.",
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
      settled = false;
    try {
      const conversation = await claimConversation(
        session,
        id,
        requestId,
        userMessage,
        body.inputMode || "text",
      );
      claimed = true;
      const profile = modelProfile(
        config,
        {
          ...session,
          profile: {
            ...session.profile,
            role: normalizedRole(session.profile),
          },
        },
        context,
      );
      event.model = profile.model;
      const knowledge = retrieveOliviaKnowledge(userMessage, {
        role: normalizedRole(session.profile),
        module: context.module,
        limit: 4,
      });
      const input = [
        {
          role: "user",
          content: JSON.stringify({
            type: "UNTRUSTED_CONTEXT_DATA",
            userContext: userContext(session),
            screenContext: context,
            conversationDraft: conversation.draft,
            documentation: knowledge,
          }),
        },
        ...conversation.messages
          .slice(-16)
          .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) })),
      ];
      const seen = new Map();
      let prepared = null,
        draft = null,
        navigation = null,
        nextState = "INFORMACION",
        content = "",
        toolCallCount = 0;
      // Three tool rounds may resolve location, product and stock in sequence.
      // Reserve a final response without tools to present the last tool result.
      for (let turn = 0; turn < 4; turn++) {
        const finalResponse = turn === 3;
        const bodyRequest = {
          model: profile.model,
          reasoning: { effort: profile.reasoningEffort },
          store: false,
          instructions: OLIVIA_INSTRUCTIONS,
          input,
          tools: finalResponse ? [] : toolDefinitions(session),
          ...(finalResponse ? { tool_choice: "none" } : {}),
          parallel_tool_calls: false,
          max_output_tokens: 2400,
        };
        // UTF-8 bytes conservatively bound tokenizer input; output is capped by API.
        await increaseReservation({
          store,
          reservation,
          amount: Buffer.byteLength(JSON.stringify(bodyRequest), "utf8") + 2400,
        });
        const remaining = 45000 - (Date.now() - startedAt);
        if (remaining < 1000)
          throw oliviaError(
            "assistant-timeout",
            "La consulta necesita dividirse en pasos más pequeños.",
            503,
          );
        let payload;
        try {
          payload = await provider("responses", bodyRequest, {
            env,
            timeoutMs: Math.min(20000, remaining),
          });
        } catch (error) {
          event.totalTokens = Math.max(
            event.totalTokens,
            reservation.reservedTokens,
          );
          event.measurement = "reserved-estimate";
          throw error;
        }
        const measured = providerUsage(payload, profile.model);
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
        if (payload.status === "incomplete")
          throw oliviaError(
            "openai-incomplete",
            "Olivia no pudo terminar la respuesta. Reformulá la consulta o continuá manualmente.",
            502,
          );
        const calls = (payload.output || []).filter(
          (item) => item.type === "function_call",
        );
        content = responseText(payload) || content;
        if (!calls.length) break;
        toolCallCount += calls.length;
        if (finalResponse || toolCallCount > 5)
          throw oliviaError(
            "tool-limit",
            "La consulta necesita dividirse en pasos más pequeños.",
            422,
          );
        input.push(...payload.output);
        for (const call of calls) {
          let result;
          try {
            const args = JSON.parse(call.arguments),
              key = JSON.stringify([call.name, args]);
            if (seen.has(key)) result = seen.get(key);
            else {
              result = await runTool({
                session,
                name: call.name,
                args,
                store,
                context,
                now: clock(),
              });
              seen.set(key, result);
            }
            if (result.prepared) {
              prepared = result.prepared;
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
                result.data?.summary ||
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
            nextState = e.status === 403 ? "RECHAZADA" : "ERROR";
            content = result.data.message;
          }
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(result.data || {}).slice(0, 8000),
          });
        }
        // A normalized proposal is the canonical final message; no further call can execute it.
        if (prepared) {
          content = prepared.summary;
          break;
        }
        if (["DATOS_INCOMPLETOS", "RECHAZADA", "ERROR"].includes(nextState))
          break;
      }
      const result = await saveTurn(
        session,
        id,
        requestId,
        { content, prepared, draft, state: nextState, navigation },
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
      return result;
    } catch (e) {
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
    await store.transaction(async (tx) => {
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
      const quota = quotaFor(config, session.uid, now),
        budget = await tx.getDocument(
          `oliviaBudgets/${session.uid}_${quota.key}`,
        );
      if (
        (budget?.data.usedTokens || 0) + (budget?.data.reservedTokens || 0) >=
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
          requestId: actionId,
          role: normalizedRole(session.profile),
          tool: action.prepared.toolName,
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
            state: "COMPLETADA",
            draft: null,
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
    return state(session, id);
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
  async function requestQuotaExtension(session, body) {
    assertOliviaAccess(session);
    safeId(body.requestId);
    const config = await configuration(),
      now = clock(),
      quota = quotaFor(config, session.uid, now),
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
    const config = await configuration(),
      now = clock(),
      requests = await store.query(
        "oliviaQuotaRequests",
        [["status", "EQUAL", "pending"]],
        100,
      );
    return {
      configuration: config,
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
  async function history(session, body) {
    if (!canAccessAdministration(session.profile))
      throw oliviaError(
        "permission-denied",
        "La supervisión es exclusiva del Administrador.",
        403,
      );
    const userId = safeId(body.userId),
      config = await configuration(),
      now = clock();
    const conversations = await store.query(
      "oliviaConversations",
      [["userId", "EQUAL", userId]],
      20,
      [["updatedAt", "DESCENDING"]],
    );
    const usageEvents = await store.query(
      "oliviaUsage",
      [["userId", "EQUAL", userId]],
      30,
      [["createdAt", "DESCENDING"]],
    );
    let selectedConversation = null;
    if (body.conversationId) {
      const c = await store.get(
        `oliviaConversations/${safeId(body.conversationId)}`,
      );
      if (!c || c.userId !== userId || dateMs(c.expiresAt) <= now.getTime())
        throw oliviaError(
          "conversation-not-found",
          "La conversación no existe o venció.",
          404,
        );
      let after = null;
      if (body.messagesCursor) {
        after = {
          id: safeId(body.messagesCursor.id),
          createdAt: body.messagesCursor.createdAt,
        };
        if (
          typeof after.createdAt !== "string" ||
          !Number.isFinite(dateMs(after.createdAt))
        )
          throw oliviaError("invalid-input", "Página de historial inválida.");
      }
      const rows = await store.query(
        `oliviaConversations/${c.id}/messages`,
        [],
        61,
        [
          ["createdAt", "DESCENDING"],
          ["__name__", "DESCENDING"],
        ],
        { after },
      );
      const page = rows.slice(0, 60),
        last = page.at(-1),
        nextCursor =
          rows.length > 60
            ? { createdAt: new Date(last.createdAt).toISOString(), id: last.id }
            : null;
      const messages =
        c.historyStorageVersion === 1
          ? page.reverse().map(({ __updateTime, ...m }) => m)
          : c.messages || [];
      selectedConversation = {
        id: c.id,
        userId,
        state: c.state,
        messages,
        nextCursor,
        updatedAt: c.updatedAt,
        expiresAt: c.expiresAt,
      };
    }
    const quota = quotaFor(config, userId, now),
      budget = await store.get(`oliviaBudgets/${userId}_${quota.key}`);
    return {
      conversations: conversations
        .filter((c) => dateMs(c.expiresAt) > now.getTime())
        .map((c) => ({
          id: c.id,
          userId,
          state: c.state,
          updatedAt: c.updatedAt,
          expiresAt: c.expiresAt,
          messageCount: c.messageCount ?? c.messages?.length ?? 0,
        })),
      usageEvents: usageEvents
        .filter(
          (u) =>
            !u.retentionExpiresAt ||
            dateMs(u.retentionExpiresAt) > now.getTime(),
        )
        .map(
          ({
            id,
            userId: uid,
            requestId,
            retentionExpiresAt,
            __updateTime,
            ...event
          }) => event,
        ),
      usage: publicUsage(session, budget, quota),
      selectedConversation,
      limit: { conversations: 20, usageEvents: 30, messages: 60 },
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
    saveConfiguration,
    history,
    usage,
    requestQuotaExtension,
  };
}
