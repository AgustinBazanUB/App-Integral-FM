import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { monitorLive } from "./_lib/olivia/liveMonitor.mjs";
import { oliviaSession, json, errorResponse } from "./_lib/olivia/http.mjs";
import { createOliviaStore } from "./_lib/olivia/store.mjs";
import { createOliviaEngine } from "./_lib/olivia/engine.mjs";
import { hangupCall } from "./_lib/olivia/voice.mjs";
import { settleUsage } from "./_lib/olivia/usage.mjs";
import { canAccessAdministration } from "../../src/gestion/permissions.js";
import { assertOliviaAccess } from "./_lib/olivia/guards.mjs";
import {
  defaultOliviaConfiguration,
  safeId,
  oliviaError,
} from "../../src/shared/oliviaContracts.mjs";

const MAX_DURATION_MS = 180000;
const MAX_RESERVED_TOKENS = 20000;
const CONNECT_TIMEOUT_MS = 10000;
const MAX_OUTPUT_TOKENS = 700;
const dateMs = (value) => new Date(value).getTime();
const validTokenUsage = (usage) =>
  usage &&
  [usage.input_tokens, usage.output_tokens, usage.total_tokens].every(
    (value) => Number.isSafeInteger(value) && value >= 0,
  ) &&
  usage.total_tokens === usage.input_tokens + usage.output_tokens;
const transcriptionKey = (event) =>
  typeof event.item_id === "string" &&
  event.item_id.length > 0 &&
  event.item_id.length <= 160 &&
  Number.isSafeInteger(event.content_index ?? 0) &&
  (event.content_index ?? 0) >= 0
    ? `${event.item_id}:${event.content_index ?? 0}`
    : null;

function verifyOwnedSession(session, live) {
  if (
    !live ||
    live.userId !== session.uid ||
    live.sessionBinding !== String(session.authTime || "")
  )
    throw oliviaError(
      "permission-denied",
      "No tenés acceso a esta sesión de voz.",
      403,
    );
  if (!/^rtc_[A-Za-z0-9_-]{1,128}$/.test(live.callId || ""))
    throw oliviaError("realtime-invalid", "La sesión de voz no es válida.");
  const reservation = live.reservation;
  if (
    !reservation ||
    reservation.requestPath !==
      `oliviaRequests/${session.uid}_${live.requestId}` ||
    reservation.budgetPath !==
      `oliviaBudgets/${session.uid}_${reservation.quota?.key}` ||
    !Number.isSafeInteger(reservation.reservedTokens) ||
    reservation.reservedTokens < 1 ||
    reservation.reservedTokens > MAX_RESERVED_TOKENS
  )
    throw oliviaError("realtime-invalid", "La reserva de voz no es válida.");
  safeId(live.requestId, "intento de voz");
  safeId(reservation.quota?.key, "período de voz");
  if (
    !Number.isFinite(dateMs(live.createdAt)) ||
    !Number.isFinite(dateMs(live.expiresAt))
  )
    throw oliviaError(
      "realtime-invalid",
      "La sesión de voz no tiene un vencimiento válido.",
    );
}

/** Listen exclusively to trusted provider events. Audio/transcript payloads
 * remain transient and are never returned, logged or persisted by the meter.
 * Injected sockets/timers make the same duration and quota path testable offline.
 */
export async function monitorRealtime({
  session,
  realtimeSessionId,
  store,
  env = process.env,
  WebSocketImpl = WebSocket,
  hangup = hangupCall,
  settle = settleUsage,
  configuration,
  clock = () => new Date(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  assertOliviaAccess(session);
  const id = safeId(realtimeSessionId, "sesión de voz"),
    path = `oliviaRealtime/${id}`,
    leaseId = randomUUID(),
    claimedAt = clock();
  if (!env.OPENAI_API_KEY)
    throw oliviaError(
      "openai-key-missing",
      "El servicio de voz no está configurado.",
      503,
    );
  const claim = await store.transaction(async (tx) => {
    const document = await tx.getDocument(path),
      live = document?.data;
    verifyOwnedSession(session, live);
    if (live.meteringStatus === "settled")
      return { acquired: false, status: "settled" };
    if (
      live.meteringStatus === "running" &&
      dateMs(live.meteringLeaseUntil) > claimedAt.getTime()
    )
      return { acquired: false, status: "running" };
    const deadline = Math.min(
      dateMs(live.expiresAt),
      dateMs(live.createdAt) + MAX_DURATION_MS,
      claimedAt.getTime() + MAX_DURATION_MS,
    );
    await tx.commitDocuments([
      {
        type: "update",
        path,
        data: {
          meteringStatus: "running",
          meteringLeaseId: leaseId,
          meteringLeaseUntil: new Date(
            Math.max(deadline, claimedAt.getTime()) + 30000,
          ),
          meteringStartedAt: claimedAt,
        },
      },
    ]);
    return { acquired: true, live, deadline };
  });
  if (!claim.acquired) return { status: claim.status, alreadyMonitored: true };
  const { live, deadline } = claim;
  let config, result;
  try {
    config =
      configuration ||
      (await createOliviaEngine({ store, env, clock }).configuration());
    if (!config.enabled)
      throw oliviaError(
        "assistant-disabled",
        "Olivia está deshabilitada.",
        503,
      );
    result = await new Promise((resolve) => {
      let socket = null,
        finishing = false,
        connected = false,
        uncertain = false,
        connectionTimer,
        deadlineTimer;
      const seenResponses = new Set(),
        inFlightResponses = new Set(),
        seenTranscriptions = new Set(),
        inFlightTranscriptions = new Set();
      const transcriptionModel =
        live.transcriptionModel || config.profiles.liveTranscription?.model;
      const measured = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        responses: 0,
        transcriptionInputTokens: 0,
        transcriptionOutputTokens: 0,
        transcriptionTokens: 0,
        transcriptionSeconds: 0,
        transcriptions: 0,
      };
      let durationUsage = false;
      async function finish(reason, failed = false) {
        if (finishing) return;
        finishing = true;
        clearTimer(connectionTimer);
        clearTimer(deadlineTimer);
        let remotelyClosed = false;
        try {
          await hangup(live.callId, { env });
          remotelyClosed = true;
        } catch {
          failed = true;
          reason = "realtime-close-error";
        }
        try {
          socket?.terminate();
        } catch {
          /* Remote hangup remains authoritative. */
        }
        // Transcription is billed separately and may report duration rather
        // than tokens. In that case token quota uses its allocated estimate;
        // observed seconds remain available without inventing a conversion.
        const exact =
          connected &&
          !failed &&
          !uncertain &&
          !durationUsage &&
          !inFlightResponses.size &&
          !inFlightTranscriptions.size &&
          measured.responses > 0 &&
          (!transcriptionModel || measured.transcriptions > 0);
        resolve({
          ...measured,
          reason,
          failed,
          remotelyClosed,
          measurement: exact ? "provider" : "reserved-estimate",
          totalTokens: exact
            ? measured.totalTokens
            : Math.max(measured.totalTokens, live.reservation.reservedTokens),
        });
      }
      const remaining = Math.max(0, deadline - clock().getTime());
      if (!remaining || live.status !== "active") {
        void finish(
          live.status === "active" ? "duration-limit" : "already-closed",
        );
        return;
      }
      deadlineTimer = setTimer(() => {
        void finish("duration-limit");
      }, remaining);
      connectionTimer = setTimer(
        () => {
          void finish("realtime-monitor-timeout", true);
        },
        Math.min(CONNECT_TIMEOUT_MS, remaining),
      );
      try {
        // Official Realtime sideband control: standard server credential never
        // leaves this connection. It is independent from the browser data channel.
        socket = new WebSocketImpl(
          `wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(live.callId)}`,
          {
            headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
            maxPayload: 512 * 1024,
            handshakeTimeout: Math.min(CONNECT_TIMEOUT_MS, remaining),
          },
        );
        socket.on("open", async () => {
          connected = true;
          clearTimer(connectionTimer);
          try {
            await store.transaction(async (tx) => {
              const current = await tx.getDocument(path);
              if (!current || current.data.meteringLeaseId !== leaseId)
                throw oliviaError(
                  "realtime-monitor-replaced",
                  "El control de voz fue reemplazado.",
                  409,
                );
              await tx.commitDocuments([
                {
                  type: "update",
                  path,
                  data: { meteringConnectedAt: clock() },
                },
              ]);
            });
            if (!finishing)
              socket.send(
                JSON.stringify({
                  type: "session.update",
                  session: {
                    type: "realtime",
                    max_output_tokens: MAX_OUTPUT_TOKENS,
                  },
                }),
              );
          } catch {
            void finish("realtime-monitor-error", true);
          }
        });
        socket.on("message", (data) => {
          if (finishing) return;
          let event;
          try {
            event = JSON.parse(data.toString());
          } catch {
            void finish("realtime-event-invalid", true);
            return;
          }
          if (event.type === "error") {
            void finish("realtime-provider-error", true);
            return;
          }
          if (
            [
              "input_audio_buffer.committed",
              "input_audio_buffer.speech_started",
              "conversation.item.input_audio_transcription.delta",
            ].includes(event.type)
          ) {
            const key = transcriptionKey(event);
            if (transcriptionModel && key && !seenTranscriptions.has(key))
              inFlightTranscriptions.add(key);
            return;
          }
          if (
            event.type === "conversation.item.input_audio_transcription.failed"
          ) {
            void finish("realtime-transcription-error", true);
            return;
          }
          if (
            event.type ===
            "conversation.item.input_audio_transcription.completed"
          ) {
            const key = transcriptionKey(event),
              usage = event.usage;
            if (!key) {
              uncertain = true;
              return;
            }
            inFlightTranscriptions.delete(key);
            if (seenTranscriptions.has(key)) return;
            seenTranscriptions.add(key);
            measured.transcriptions += 1;
            if (
              usage?.type === "duration" &&
              Number.isFinite(usage.seconds) &&
              usage.seconds >= 0
            ) {
              durationUsage = true;
              measured.transcriptionSeconds += usage.seconds;
              if (!Number.isFinite(measured.transcriptionSeconds))
                void finish("realtime-usage-invalid", true);
              return;
            }
            if (usage?.type !== "tokens" || !validTokenUsage(usage)) {
              uncertain = true;
              return;
            }
            measured.transcriptionInputTokens += usage.input_tokens;
            measured.transcriptionOutputTokens += usage.output_tokens;
            measured.transcriptionTokens += usage.total_tokens;
            measured.inputTokens += usage.input_tokens;
            measured.outputTokens += usage.output_tokens;
            measured.totalTokens += usage.total_tokens;
            if (!Number.isSafeInteger(measured.totalTokens)) {
              void finish("realtime-usage-invalid", true);
              return;
            }
            if (!canAccessAdministration(session.profile) && measured.totalTokens >= live.reservation.reservedTokens)
              void finish("quota-limit");
            return;
          }
          if (["session.created", "session.updated"].includes(event.type)) {
            const cap = event.session?.max_output_tokens;
            if (
              cap != null &&
              (!Number.isSafeInteger(cap) || cap < 1 || cap > MAX_OUTPUT_TOKENS)
            )
              void finish("realtime-output-limit", true);
            return;
          }
          if (event.type === "response.created") {
            if (typeof event.response?.id === "string")
              inFlightResponses.add(event.response.id);
            const cap = event.response?.max_output_tokens;
            if (
              cap != null &&
              (!Number.isSafeInteger(cap) || cap < 1 || cap > MAX_OUTPUT_TOKENS)
            )
              void finish("realtime-output-limit", true);
            return;
          }
          if (event.type !== "response.done") return;
          const response = event.response || {},
            responseId = response.id || event.event_id,
            usage = response.usage;
          if (typeof response.id === "string")
            inFlightResponses.delete(response.id);
          if (
            typeof responseId !== "string" ||
            !responseId ||
            responseId.length > 160
          ) {
            uncertain = true;
            return;
          }
          if (seenResponses.has(responseId)) return;
          seenResponses.add(responseId);
          if (!validTokenUsage(usage)) {
            uncertain = true;
            return;
          }
          measured.inputTokens += usage.input_tokens;
          measured.outputTokens += usage.output_tokens;
          measured.totalTokens += usage.total_tokens;
          measured.responses += 1;
          if (!Number.isSafeInteger(measured.totalTokens)) {
            void finish("realtime-usage-invalid", true);
            return;
          }
          if (response.status === "failed") {
            void finish("realtime-provider-error", true);
            return;
          }
          if (!canAccessAdministration(session.profile) && measured.totalTokens >= live.reservation.reservedTokens)
            void finish("quota-limit");
        });
        socket.on("close", (code) => {
          void finish(
            "provider-closed",
            !connected || (code !== 1000 && code !== 1001),
          );
        });
        socket.on("error", () => {
          void finish("realtime-monitor-error", true);
        });
        socket.on("unexpected-response", () => {
          void finish("realtime-monitor-rejected", true);
        });
      } catch {
        void finish("realtime-monitor-error", true);
      }
    });
  } catch {
    let remotelyClosed = false;
    try {
      await hangup(live.callId, { env });
      remotelyClosed = true;
    } catch {
      /* Cleanup retries active expired sessions. */
    }
    result = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: live.reservation.reservedTokens,
      responses: 0,
      transcriptionInputTokens: 0,
      transcriptionOutputTokens: 0,
      transcriptionTokens: 0,
      transcriptionSeconds: 0,
      transcriptions: 0,
      reason: "realtime-monitor-error",
      failed: true,
      remotelyClosed,
      measurement: "reserved-estimate",
    };
    config ||= defaultOliviaConfiguration(env);
  }
  const finishedAt = clock();
  const event = {
    model: live.model || config.profiles.realtime.model,
    transcriptionModel:
      live.transcriptionModel ||
      config.profiles.liveTranscription?.model ||
      null,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    totalTokens: result.totalTokens,
    measurement: result.measurement,
    observedResponses: result.responses,
    observedTranscriptions: result.transcriptions,
    transcriptionInputTokens: result.transcriptionInputTokens,
    transcriptionOutputTokens: result.transcriptionOutputTokens,
    transcriptionTokens: result.transcriptionTokens,
    transcriptionSeconds: result.transcriptionSeconds,
    closeReason: result.reason,
  };
  // An unknown provider bill has an honest null cost. Reserve-estimates still
  // charge the full allocated token quota, never a fabricated actual price.
  // Realtime audio/text/cache tariffs and the separate ASR rate card cannot
  // be represented by the current single input/output pricing configuration.
  // Provider counters are exact when complete; actual session price is unknown.
  const settlementConfig = { ...config, pricing: {} };
  await settle({
    store,
    session,
    reservation: live.reservation,
    event,
    configuration: settlementConfig,
    result: { realtimeSessionId: id },
    errorCode: result.failed ? result.reason : null,
    now: finishedAt,
  });
  await store.transaction(async (tx) => {
    const current = await tx.getDocument(path);
    if (!current || current.data.meteringLeaseId !== leaseId) return;
    await tx.commitDocuments([
      {
        type: "update",
        path,
        data: {
          status: result.remotelyClosed ? "closed" : "active",
          meteringStatus: "settled",
          meteringCompletedAt: finishedAt,
          meteringLeaseUntil: null,
          measurement: result.measurement,
          observedResponses: result.responses,
          observedTranscriptions: result.transcriptions,
          transcriptionInputTokens: result.transcriptionInputTokens,
          transcriptionOutputTokens: result.transcriptionOutputTokens,
          transcriptionTokens: result.transcriptionTokens,
          transcriptionSeconds: result.transcriptionSeconds,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          totalTokens: result.totalTokens,
          closeReason: result.reason,
          ...(result.remotelyClosed
            ? { closedAt: finishedAt }
            : { expiresAt: finishedAt, closeRequestedAt: finishedAt }),
        },
      },
    ]);
  });
  return {
    status: result.remotelyClosed ? "closed" : "close_pending",
    measurement: result.measurement,
    totalTokens: result.totalTokens,
  };
}

/** Netlify runs *-background functions for up to 15 minutes and acknowledges
 * dispatch with HTTP 202. The server meter itself completes in at most 180s.
 */
export default async function handler(request) {
  if (request.method !== "POST")
    return json(
      { code: "method-not-allowed", message: "Método no permitido." },
      405,
    );
  try {
    const session = await oliviaSession(request),
      raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 2000)
      throw oliviaError(
        "request-too-large",
        "La solicitud supera el límite.",
        413,
      );
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw oliviaError("invalid-json", "Solicitud inválida.");
    }
    if (!body || Object.keys(body).some((key) => key !== "realtimeSessionId"))
      throw oliviaError("invalid-input", "Solicitud de voz inválida.");
    const store = createOliviaStore();
    const live = await store.get(`oliviaRealtime/${safeId(body.realtimeSessionId)}`);
    await (live?.protocol === "live" ? monitorLive : monitorRealtime)({
      session,
      realtimeSessionId: body.realtimeSessionId,
      store,
    });
    return json({ accepted: true }, 202);
  } catch (error) {
    console.error("olivia.voice_meter_failed", {
      code: error.code || "voice-meter-error",
    });
    return errorResponse(error);
  }
}
