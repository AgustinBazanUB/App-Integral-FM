import { createHash } from "node:crypto";
import { safeId, oliviaError, screenContext } from "../../../../src/shared/oliviaContracts.mjs";
import { safeUserMessage } from "./provider.mjs";
import { taskControl } from "./tasks.mjs";
import { assertConversationOwner, sessionBinding, permissionScope } from "./conversations.mjs";
import { captureOliviaFailure, publicOliviaFailure } from "./errorReports.mjs";
export const CHAT_JOB_DURATION_MS = 360000;
const live = job => ["queued", "running"].includes(job?.status);
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function ownJob(session, job) {
  if (!job || job.userId !== session.uid || job.sessionBinding !== sessionBinding(session) || job.permissionScope !== permissionScope(session)) throw oliviaError("chat-job-not-found", "Esta consulta no está disponible para tu sesión.", 404);
}
export async function startChatJob({ store, engine, session, body, dispatch, now = new Date() }) {
  const requestId = safeId(body.requestId), conversationId = body.conversationId ? safeId(body.conversationId) : (await engine.state(session)).conversationId;
  const payload = { operation: "chat", requestId, conversationId, message: safeUserMessage(body.message), screenContext: screenContext(body.screenContext || {}), attachmentIds: Array.isArray(body.attachmentIds) ? body.attachmentIds.map(id => safeId(id)).slice(0, 4) : [], inputMode: body.inputMode === "dictation" ? "dictation" : "text" };
  const jobId = digest([session.uid, sessionBinding(session), requestId]), path = `oliviaChatJobs/${jobId}`, fingerprint = digest(payload);
  let created = false;
  await store.transaction(async tx => {
    const existing = (await tx.getDocument(path))?.data;
    if (existing) { ownJob(session, existing); if (existing.fingerprint !== fingerprint) throw oliviaError("request-already-used", "Este intento corresponde a otra consulta. Actualizá el chat.", 409); return; }
    const conversation = (await tx.getDocument(`oliviaConversations/${conversationId}`))?.data;
    assertConversationOwner(session, conversation, now);
    const previous = conversation.activeChatJobId ? (await tx.getDocument(`oliviaChatJobs/${conversation.activeChatJobId}`))?.data : null;
    if (live(previous) && new Date(previous.deadlineAt) > now) throw oliviaError("conversation-busy", "Olivia sigue trabajando en la consulta anterior.", 409);
    if (conversation.busyRequestId && new Date(conversation.busyUntil) > now) throw oliviaError("conversation-busy", "Olivia sigue trabajando en la consulta anterior.", 409);
    const confirmation = conversation.pendingActionId ? (await tx.getDocument(`oliviaConfirmations/${conversation.pendingActionId}`))?.data : null;
    const preservePending = !payload.attachmentIds.length && taskControl(payload.message) === "acknowledge";
    await tx.commitDocuments([...(!preservePending && confirmation?.status === "pending" ? [{ type: "update", path: `oliviaConfirmations/${conversation.pendingActionId}`, data: { status: "superseded", updatedAt: now } }] : []), { type: "create", path, data: { userId: session.uid, sessionBinding: sessionBinding(session), permissionScope: permissionScope(session), fingerprint, payload, status: "queued", phase: "Pensando…", text: "", createdAt: now, updatedAt: now, deadlineAt: new Date(now.getTime() + CHAT_JOB_DURATION_MS), expiresAt: new Date(now.getTime() + 30 * 86400000) } }, { type: "update", path: `oliviaConversations/${conversationId}`, data: { activeChatJobId: jobId, queuedChatRequestId: requestId, pendingActionId: preservePending ? conversation.pendingActionId : null, state: "PREPARANDO_ACCION", lastFailure: null } }]);
    created = true;
  });
  if (created) {
    try { await dispatch(jobId); }
    catch (error) {
      error.code = "chat-dispatch-failed";
      let failure = publicOliviaFailure(error);
      try { failure = await captureOliviaFailure({ store, session, error, operation: "startChat", conversationId, requestId, now }); } catch { /* Preserve the actionable error if diagnostics storage is unavailable. */ }
      await store.transaction(async tx => {
        const job = (await tx.getDocument(path))?.data;
        if (job?.status !== "queued") return;
        const conversationPath = `oliviaConversations/${conversationId}`, conversation = (await tx.getDocument(conversationPath))?.data;
        await tx.commitDocuments([{ type: "update", path, data: { status: "failed", failure, updatedAt: now } }, ...(conversation?.queuedChatRequestId === requestId ? [{ type: "update", path: conversationPath, data: { queuedChatRequestId: null, state: "ERROR", lastFailure: failure } }] : [])]);
      });
    }
  }
  return { jobId, conversationId };
}
export async function chatJobStatus({ store, session, body, now = new Date() }) {
  const jobId = safeId(body.jobId), path = `oliviaChatJobs/${jobId}`;
  let job = await store.get(path); ownJob(session, job);
  if (live(job) && new Date(job.deadlineAt) <= now) {
    const error = oliviaError("chat-job-expired", "La consulta no pudo terminar a tiempo.", 503);
    let failure = publicOliviaFailure(error);
    try { failure = await captureOliviaFailure({ store, session, error, operation: "chatStatus", conversationId: job.payload.conversationId, requestId: job.payload.requestId, now }); } catch { /* Status recovery must remain available. */ }
    await store.transaction(async tx => {
      const latest = (await tx.getDocument(path))?.data;
      if (!live(latest)) return;
      const conversationPath = `oliviaConversations/${latest.payload.conversationId}`;
      const conversation = (await tx.getDocument(conversationPath))?.data;
      await tx.commitDocuments([{ type: "update", path, data: { status: "failed", failure, updatedAt: now } }, ...(conversation?.busyRequestId === latest.payload.requestId || conversation?.queuedChatRequestId === latest.payload.requestId ? [{ type: "update", path: conversationPath, data: { busyRequestId: null, busyUntil: null, queuedChatRequestId: null, state: "ERROR", lastFailure: failure } }] : [])]);
    });
    job = await store.get(path);
  }
  return { jobId, conversationId: job.payload.conversationId, status: job.status, phase: job.phase, text: job.text || "", accepted: job.accepted || null, ...(job.status === "completed" ? { result: job.result } : {}), ...(job.status === "failed" ? { failure: job.failure } : {}) };
}
export async function activeChatJob({ store, session, conversationId }) {
  const conversation = await store.get(`oliviaConversations/${conversationId}`);
  if (!conversation?.activeChatJobId) return null;
  const job = await store.get(`oliviaChatJobs/${conversation.activeChatJobId}`);
  if (!job || !live(job)) return null;
  ownJob(session, job);
  return { jobId: conversation.activeChatJobId, phase: job.phase };
}
export async function cancelChatJob({ store, session, body, now = new Date() }) {
  const path = `oliviaChatJobs/${safeId(body.jobId)}`;
  await store.transaction(async tx => {
    const job = (await tx.getDocument(path))?.data; ownJob(session, job);
    if (!live(job)) return;
    const conversationPath = `oliviaConversations/${job.payload.conversationId}`, conversation = (await tx.getDocument(conversationPath))?.data;
    await tx.commitDocuments([{ type: "update", path, data: { status: "cancelled", updatedAt: now } }, ...(conversation?.busyRequestId === job.payload.requestId || conversation?.queuedChatRequestId === job.payload.requestId ? [{ type: "update", path: conversationPath, data: { busyRequestId: null, busyUntil: null, queuedChatRequestId: null, state: "CANCELADA", taskState: conversation.taskState ? { ...conversation.taskState, status: "cancelled", updatedAt: now } : null } }] : [])]);
  });
  return { cancelled: true };
}
export async function runChatJob({ store, engine, session, jobId, clock = () => new Date() }) {
  const path = `oliviaChatJobs/${safeId(jobId)}`;
  let payload;
  await store.transaction(async tx => {
    const job = (await tx.getDocument(path))?.data; ownJob(session, job);
    if (job.status !== "queued" || new Date(job.deadlineAt) <= clock()) return;
    payload = job.payload;
    await tx.commitDocuments([{ type: "update", path, data: { status: "running", phase: "Pensando…", updatedAt: clock() } }]);
  });
  if (!payload) return;
  const controller = new AbortController();
  let progress = { phase: "Pensando…", text: "" }, changed = false, flushing = Promise.resolve();
  const flush = () => flushing = flushing.catch(() => {}).then(async () => {
    await store.transaction(async tx => {
      const job = (await tx.getDocument(path))?.data;
      if (!live(job) || new Date(job.deadlineAt) <= clock()) { controller.abort(); return; }
      if (changed) { changed = false; await tx.commitDocuments([{ type: "update", path, data: { ...progress, updatedAt: clock() } }]); }
    });
  });
  const interval = setInterval(() => { flush().catch(() => {}); }, 2000);
  const timer = setTimeout(() => controller.abort(oliviaError("assistant-timeout", "La consulta alcanzó su límite de procesamiento.", 503)), 300000);
  try {
    const result = await engine.chat(session, payload, { longRunning: true, signal: controller.signal, onEvent: event => {
      if (event.type === "accepted") progress.accepted = event.message;
      if (event.type === "phase") { progress.phase = event.label; if (event.tools) progress.text = ""; }
      if (event.type === "delta") progress.text = (progress.text + event.delta).slice(-64000);
      changed = true;
    } });
    await flush();
    await store.transaction(async tx => {
      const job = (await tx.getDocument(path))?.data;
      if (job?.status === "running") await tx.commitDocuments([{ type: "update", path, data: { status: "completed", result, updatedAt: clock() } }]);
    });
  } catch (error) {
    const latest = await store.get(path);
    if (latest?.status === "running") {
      let failure = publicOliviaFailure(error);
      try { failure = await captureOliviaFailure({ store, session, error, operation: "background-chat", conversationId: payload.conversationId, requestId: payload.requestId, now: clock() }); } catch { /* Keep the original error. */ }
      await store.transaction(async tx => {
        const job = (await tx.getDocument(path))?.data;
        if (job?.status !== "running") return;
        const conversationPath = `oliviaConversations/${payload.conversationId}`, conversation = (await tx.getDocument(conversationPath))?.data;
        await tx.commitDocuments([{ type: "update", path, data: { status: "failed", failure, updatedAt: clock() } }, ...(conversation?.activeChatJobId === jobId ? [{ type: "update", path: conversationPath, data: { queuedChatRequestId: null, busyRequestId: null, busyUntil: null, state: "ERROR", lastFailure: failure } }] : [])]);
      });
    }
  } finally { clearInterval(interval); clearTimeout(timer); await flushing.catch(() => {}); }
}
