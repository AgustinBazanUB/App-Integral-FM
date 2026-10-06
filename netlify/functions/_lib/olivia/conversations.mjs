import { randomUUID, createHash } from "node:crypto";
import { canAccessAdministration, normalizedRole } from "../../../../src/gestion/permissions.js";
import { safeId, oliviaError } from "../../../../src/shared/oliviaContracts.mjs";
import { assertOliviaAccess, userContext, capabilities } from "./guards.mjs";
import { quotaFor, publicUsage } from "./usage.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
export const message = (role, content, now, inputMode = "text") => ({
  id: randomUUID(),
  role,
  content,
  createdAt: now.toISOString(),
  inputMode,
});
export const retainedMessage = (id, m) => ({
  type: "create",
  path: `oliviaConversations/${id}/messages/${m.id}`,
  data: { ...m, createdAt: new Date(m.createdAt) },
});
export const sessionBinding = (session) => String(session.authTime || "");
export const permissionScope = (session, allowed = capabilities(session)) => hash(JSON.stringify({ context: userContext(session), capabilities: allowed.sort() }));
// Adding the batch tool changes capabilities without changing an existing
// user's authority. Accept only the exact previous scope for this release.
export const compatiblePermissionScope = (session, scope) => scope === permissionScope(session) || scope === permissionScope(session, capabilities(session).filter(name => name !== "prepare_batch_sales"));
export const dateMs = (value) => new Date(value).getTime();
export async function verifyLegacyConversationScope(session, conversation, store) {
  if (!conversation || conversation.roleBinding || canAccessAdministration(session.profile) || !(conversation.messageCount || conversation.messages?.length)) return;
  // PR31 did not bind a role to chats. Its server-owned usage ledger supplies
  // the latest authority at the archived chat's timestamp; unknown scope fails closed.
  const cutoff = new Date(dateMs(conversation.updatedAt) + 1000);
  const events = await store.query("oliviaUsage", [["userId", "EQUAL", session.uid], ["createdAt", "LESS_THAN_OR_EQUAL", cutoff]], 1, [["createdAt", "DESCENDING"]]);
  if (!events[0]?.role || normalizedRole({ role: events[0].role }) !== normalizedRole(session.profile)) throw oliviaError("permission-scope-changed", "El alcance de este chat anterior necesita revisión administrativa. Iniciá uno nuevo con tus permisos actuales.", 409);
}
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
  if (conversation.roleBinding && conversation.roleBinding !== normalizedRole(session.profile)) throw oliviaError("permission-scope-changed", "Tu rol cambió. Iniciá un nuevo chat con tus permisos actuales.", 409);
  if (conversation.permissionScope && !compatiblePermissionScope(session, conversation.permissionScope)) throw oliviaError("permission-scope-changed", "Tus permisos cambiaron. Iniciá un chat con el alcance actual.", 409);
  if (dateMs(conversation.expiresAt) <= now.getTime())
    throw oliviaError(
      "conversation-expired",
      "Esta conversación venció. Iniciá una nueva.",
      410,
    );
}
export function trimMessages(messages) {
  const result = [];
  let characters = 0;
  for (const m of [...messages].reverse()) {
    if (result.length >= 40 || characters + m.content.length > 18000) break;
    result.unshift(m);
    characters += m.content.length;
  }
  return result;
}

export function createConversationStorage({ store, clock, configuration, state }) {
  async function history(session, body) {
    assertOliviaAccess(session);
    const userId = body.userId ? safeId(body.userId) : session.uid;
    if (userId !== session.uid && !canAccessAdministration(session.profile))
      throw oliviaError("permission-denied", "Solo podés consultar tus propios chats.", 403);
    const
      config = await configuration(),
      now = clock();
    let after = body.conversationsCursor || null;
    if (after && (!/^[A-Za-z0-9_-]{1,128}$/.test(after.id || "") || typeof after.updatedAt !== "string" || !Number.isFinite(dateMs(after.updatedAt))))
      throw oliviaError("invalid-input", "Página de chats inválida.");
    const conversationRows = await store.query(
      "oliviaConversations", [["userId", "EQUAL", userId]], 21,
      [["updatedAt", "DESCENDING"], ["__name__", "DESCENDING"]], { after },
    );
    const conversations = conversationRows.slice(0,20), lastConversation = conversations.at(-1);
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
      if (userId === session.uid && !canAccessAdministration(session.profile)) {
        await verifyLegacyConversationScope(session, c, store);
        if ((c.roleBinding && c.roleBinding !== normalizedRole(session.profile)) || (c.permissionScope && !compatiblePermissionScope(session, c.permissionScope))) throw oliviaError("permission-scope-changed", "El historial corresponde a otros permisos. Iniciá un nuevo chat.", 409);
      }
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
    const targetProfile = await store.get(`users/${userId}`);
    const quota = quotaFor(config, userId, now, targetProfile),
      budget = await store.get(`oliviaBudgets/${userId}_${quota.key}`);
    return {
      conversationsCursor: conversationRows.length > 20 ? { id: lastConversation.id, updatedAt: new Date(lastConversation.updatedAt).toISOString() } : null,
      conversations: conversations
        .filter((c) => dateMs(c.expiresAt) > now.getTime() && (canAccessAdministration(session.profile) || ((!c.roleBinding || c.roleBinding === normalizedRole(session.profile)) && (!c.permissionScope || compatiblePermissionScope(session, c.permissionScope)))))
        .map((c) => ({
          id: c.id,
          userId,
          state: c.state,
          title: c.title || c.messages?.find((m) => m.role === "user")?.content?.slice(0, 80) || "Nuevo chat",
          updatedAt: c.updatedAt,
          expiresAt: c.expiresAt,
          messageCount: c.messageCount ?? c.messages?.length ?? 0,
        })),
      usageEvents: canAccessAdministration(session.profile) ? usageEvents
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
        ) : [],
      usage: publicUsage(session, budget, quota),
      selectedConversation,
      limit: { conversations: 20, usageEvents: 30, messages: 60 },
    };
  }
  async function resumeConversation(session, body) {
    assertOliviaAccess(session);
    const id = safeId(body.conversationId), now = clock();
    await verifyLegacyConversationScope(session, await store.get(`oliviaConversations/${id}`), store);
    await store.transaction(async (tx) => {
      const record = await tx.getDocument(`oliviaConversations/${id}`), c = record?.data;
      if (!c || c.userId !== session.uid || dateMs(c.expiresAt) <= now.getTime())
        throw oliviaError("conversation-not-found", "No se encontró este chat o venció.", 404);
      if ((c.roleBinding && c.roleBinding !== normalizedRole(session.profile)) || (c.permissionScope && !compatiblePermissionScope(session, c.permissionScope))) throw oliviaError("permission-scope-changed", "El chat corresponde a otros permisos. Iniciá uno nuevo.", 409);
      if (c.busyUntil && dateMs(c.busyUntil) > now.getTime())
        throw oliviaError("conversation-busy", "Este chat todavía está procesando una solicitud.", 409);
      if (c.sessionBinding === sessionBinding(session)) return;
      const pending = c.pendingActionId ? await tx.getDocument(`oliviaConfirmations/${c.pendingActionId}`) : null;
      await tx.commitDocuments([
        ...(pending?.data.status === "pending" ? [{ type: "update", path: `oliviaConfirmations/${c.pendingActionId}`, data: { status: "superseded", updatedAt: now } }] : []),
        { type: "update", path: `oliviaConversations/${id}`, data: { sessionBinding: sessionBinding(session), pendingActionId: null, draft: null, state: "INFORMACION", busyRequestId: null, busyUntil: null, updatedAt: now } }
      ]);
    });
    return state(session, id, body.screenContext);
  }

  return { history, resumeConversation };
}
