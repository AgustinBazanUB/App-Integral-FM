import WebSocket from "ws";
import { randomUUID, createHash } from "node:crypto";
import { safeId, oliviaError } from "../../../../src/shared/oliviaContracts.mjs";
import { sessionBinding, assertConversationOwner, dateMs } from "./conversations.mjs";
import { createOliviaEngine } from "./engine.mjs";
import { settleUsage } from "./usage.mjs";
import { hangupCall } from "./voice.mjs";
import { resolveOliviaPricing } from "./pricing.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
export function liveUsage(event) {
  const seconds = event?.usage?.seconds;
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) return null;
  return seconds;
}
export function liveSummary(result) {
  const text = `Estado: ${result.state}. ${result.messages?.filter((entry) => entry.role === "assistant").at(-1)?.content || "Consultá el chat."}`;
  let brief = text.slice(0, 400);
  while (Buffer.byteLength(brief, "utf8") > 400) brief = brief.slice(0, -1);
  return brief + (brief !== text ? "… Revisá el chat." : "") + (result.pendingAction ? " Requiere Sí en la tarjeta; todavía no se ejecutó." : "");
}

/** Trusted sideband owns delegation, transcript correlation and duration billing.
 * The untrusted browser can only mute or close the media session. */
export async function monitorLive({ session, realtimeSessionId, store, env = process.env, WebSocketImpl = WebSocket, engine, clock = () => new Date(), fetchImpl = fetch, pollMs = 1000, closeTimeoutMs = 15000 }) {
  const id = safeId(realtimeSessionId), path = `oliviaRealtime/${id}`, lease = randomUUID();
  const live = await store.get(path);
  if (!live || live.protocol !== "live" || live.userId !== session.uid || live.sessionBinding !== sessionBinding(session) || !/^live_[A-Za-z0-9_-]{1,120}$/.test(live.callId || "")) throw oliviaError("permission-denied", "No tenés acceso a esta sesión de voz.", 403);
  assertConversationOwner(session, await store.get(`oliviaConversations/${live.conversationId}`), clock());
  const claimed = await store.transaction(async (tx) => {
    const snapshot = await tx.getDocument(path);
    if (snapshot?.data.meteringStatus === "settled" || (snapshot?.data.monitorUntil && dateMs(snapshot.data.monitorUntil) > clock().getTime())) return false;
    await tx.commitDocuments([{ type: "update", path, data: { monitorLease: lease, monitorUntil: new Date(clock().getTime() + 240000), meteringStatus: "connecting" } }]);
    return true;
  });
  if (!claimed) return { duplicate: true };
  engine ||= createOliviaEngine({ store, env, clock, pricingResolver: resolveOliviaPricing });
  const config = await engine.configuration();
  let socket, seconds = null, finalized = false, closing = false, timer, poll, active = null, text = "", generation = 0, lastAssistant = null, work = Promise.resolve(), failure = null, inputTimer, outputTimer, speechId, spoken = "", lastSpeech = null, lastInterrupt = 0;
  let transcriptWork = Promise.resolve();
  const flushInput = () => {
    clearTimeout(inputTimer);
    if (!text.trim()) return lastSpeech;
    const entry = { id: speechId || randomUUID(), content: text.trim() };
    lastSpeech = entry;
    transcriptWork = transcriptWork.catch(() => {}).then(() => engine.recordSpeech(session, live.conversationId, entry.id, entry.content, "user"));
    return entry;
  };
  const flushOutput = () => {
    clearTimeout(outputTimer);
    if (!spoken.trim()) return;
    flushInput();
    const entry = spoken.trim(); spoken = "";
    transcriptWork = transcriptWork.catch(() => {}).then(() => engine.recordSpeech(session, live.conversationId, randomUUID(), entry, "assistant"));
  };
  const seen = new Set();
  const send = (type, content, delegationId = null) => {
    if (!closing && socket?.readyState === 1) socket.send(JSON.stringify({ type, event_id: randomUUID(), delegation_id: delegationId, content }));
  };
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const close = () => {
    if (closing) return;
    closing = true;
    active?.abort();
    if (socket?.readyState === 1) socket.send(JSON.stringify({ type: "session.close", event_id: randomUUID() }));
    else hangupCall(live.callId, { env, fetchImpl }).catch(() => {});
    timer = setTimeout(finish, closeTimeoutMs);
  };
  try {
    socket = new WebSocketImpl(`wss://api.openai.com/v1/live/sessions/${live.callId}/attach`, { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "OpenAI-Safety-Identifier": hash(session.uid) } });
    const connectTimer = setTimeout(() => { failure = "live-attach-timeout"; close(); }, 10000);
    socket.on("open", async () => {
      clearTimeout(connectTimer);
      try {
        await store.commit([{ type: "update", path, data: { meteringConnectedAt: clock(), meteringStatus: "connected" } }]);
        const conversation = await store.get(`oliviaConversations/${live.conversationId}`);
        lastAssistant = conversation.messages?.filter((entry) => entry.role === "assistant").at(-1)?.id;
        send("session.thinking.append", liveSummary({ state: conversation.state, messages: conversation.messages, pendingAction: conversation.pendingActionId }));
      } catch { failure = "live-state-error"; close(); }
    });
    socket.on("message", (raw) => {
      let event;
      try { event = JSON.parse(String(raw)); } catch { return; }
      if (event.event_id && seen.has(event.event_id)) return;
      if (event.event_id) { if (seen.size >= 2000) { failure = "live-event-limit"; close(); return; } seen.add(event.event_id); }
      const measured = liveUsage(event);
      if (measured != null) seconds = Math.max(seconds ?? 0, measured);
      if (event.type === "session.closed") { finalized = true; finish(); return; }
      if (closing) return;
      if (event.type === "session.input_transcript.delta" && typeof event.delta === "string") {
        generation++;
        if (!text) speechId = randomUUID();
        text = (text + event.delta).slice(-4000);
        clearTimeout(inputTimer); inputTimer = setTimeout(flushInput, 1200);
        // A new utterance supersedes a backend result already in flight. Clear
        // its confirmation atomically; the old request can no longer save.
        if (active) {
          active.abort(); active = null;
          work = Promise.allSettled([work, engine.invalidateTask(session, live.conversationId)]).then((results) => { if (results[1].status === "rejected") throw results[1].reason; });
        }
      }
      if (event.type === "session.output_transcript.delta" && typeof event.delta === "string") {
        spoken = (spoken + event.delta).slice(-4000);
        clearTimeout(outputTimer); outputTimer = setTimeout(flushOutput, 1200);
      }
      if (event.type === "session.delegation.created" && event.delegation?.target === "client") {
        const delegationId = event.delegation.id;
        const entry = flushInput();
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(delegationId || "") || !entry?.content) {
          send("session.commentary.append", "No pude identificar la consulta. Podés repetirla o escribirla.", delegationId || null); return;
        }
        const utterance = entry.content; text = ""; lastSpeech = null; speechId = null;
        const revision = ++generation;
        work = work.catch(() => {}).then(async () => {
          if (closing || revision !== generation) return;
          const requestKey = hash(`${id}:${delegationId}`);
          const previous = await store.get(`oliviaLiveDelegations/${requestKey}`);
          if (previous) return;
          await store.commit([{ type: "create", path: `oliviaLiveDelegations/${requestKey}`, data: { userId: session.uid, conversationId: live.conversationId, delegationId, status: "running", createdAt: clock(), expiresAt: live.expiresAt } }]);
          active = new AbortController();
          try {
            await transcriptWork;
            const conversation = await store.get(`oliviaConversations/${live.conversationId}`);
            const result = await engine.chat(session, { conversationId: live.conversationId, requestId: `live_${requestKey}`, message: utterance, inputMode: "realtime", realtimeSessionId: id, screenContext: conversation.lastScreenContext || live.screenContext }, { signal: active.signal, voiceInputId: entry.id });
            if (closing || revision !== generation) return;
            lastAssistant = result.messages?.filter((entry) => entry.role === "assistant").at(-1)?.id;
            send("session.commentary.append", liveSummary(result), delegationId);
            await store.commit([{ type: "update", path: `oliviaLiveDelegations/${requestKey}`, data: { status: "completed", taskId: result.telemetry?.taskId || null, completedAt: clock() } }]);
          } catch (error) {
            if (revision === generation && !closing) send("session.commentary.append", "No se pudo completar la consulta. El chat conserva la tarea; podés continuar escribiendo.", delegationId);
            await store.commit([{ type: "update", path: `oliviaLiveDelegations/${requestKey}`, data: { status: revision === generation ? "failed" : "superseded", code: error.code || "live-backend-error", completedAt: clock() } }]);
          } finally { if (revision === generation) active = null; }
        });
        work.catch(() => { failure = "live-delegation-error"; close(); });
      }
    });
    socket.on("error", () => { failure = "live-socket-error"; close(); });
    socket.on("close", () => { clearTimeout(connectTimer); if (!finalized) failure ||= "live-finalization-incomplete"; finish(); });
    let polling = false;
    poll = setInterval(async () => {
      if (polling || closing) return;
      polling = true;
      try {
        const current = await store.get(path);
        const currentConfig = await engine.configuration({ resolveCosts: false });
        const profile = await store.get(`users/${session.uid}`);
        const freshSession = { ...session, profile: { ...profile, id: session.uid } };
        if (!currentConfig.enabled || current?.status !== "active" || current?.closeRequestedAt || dateMs(live.expiresAt) <= clock().getTime() || !profile?.active) { close(); return; }
        const conversation = await store.get(`oliviaConversations/${live.conversationId}`);
        assertConversationOwner(freshSession, conversation, clock());
        if (dateMs(current.interruptRequestedAt) > lastInterrupt) {
          lastInterrupt = dateMs(current.interruptRequestedAt); generation++; active?.abort(); active = null;
          await engine.invalidateTask(freshSession, live.conversationId);
          send("session.instructions.append", "Dejá de hablar y de trabajar en la solicitud anterior. Esperá la próxima indicación del usuario. La tarea anterior no se ejecutó.");
        }
        const assistant = conversation.messages?.filter((entry) => entry.role === "assistant").at(-1);
        if (!active && assistant && assistant.id !== lastAssistant) {
          lastAssistant = assistant.id;
          send("session.commentary.append", liveSummary({ state: conversation.state, messages: [assistant], pendingAction: conversation.pendingActionId }));
        }
      } catch { failure = "live-owner-changed"; close(); }
      finally { polling = false; }
    }, pollMs);
    const deadline = setTimeout(close, Math.max(1, Math.min(180000, dateMs(live.expiresAt) - clock().getTime())));
    await done;
    clearTimeout(deadline); clearTimeout(connectTimer);
  } finally {
    clearInterval(poll); clearTimeout(timer);
    flushOutput(); flushInput(); clearTimeout(inputTimer); clearTimeout(outputTimer);
    active?.abort();
    await work.catch(() => {});
    await transcriptWork.catch(() => {});
    if (!finalized) await hangupCall(live.callId, { env, fetchImpl }).catch(() => {});
    socket?.close();
    const event = { model: live.model, conversationId: live.conversationId, billingUnit: "live-seconds", durationSeconds: seconds, billedSeconds: finalized && seconds != null ? Math.max(15, seconds) : null, measurement: finalized && seconds != null ? "provider" : "unconfirmed", finalization: finalized ? "confirmed" : "incomplete", inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    await settleUsage({ store, session, reservation: live.reservation, event, configuration: { ...config, ...(live.billingConfig || {}) }, errorCode: failure, now: clock() });
    await store.commit([{ type: "update", path, data: { status: "closed", closedAt: clock(), meteringStatus: "settled", finalization: event.finalization, durationSeconds: seconds, monitorUntil: null } }]);
  }
  return { finalized, seconds };
}
