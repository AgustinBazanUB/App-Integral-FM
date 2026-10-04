import { randomUUID, createHash } from "node:crypto";
import { assertOliviaAccess } from "./guards.mjs";
import {
  safeId,
  oliviaError,
} from "../../../../src/shared/oliviaContracts.mjs";
import { reserveUsage, settleUsage, publicUsage } from "./usage.mjs";
import { openaiRequest, providerUsage } from "./provider.mjs";
import { assertConversationOwner } from "./engine.mjs";
export async function transcribeAudio({
  session,
  form,
  store,
  engine,
  env = process.env,
  provider = openaiRequest,
  now = new Date(),
}) {
  assertOliviaAccess(session);
  const configuration = await engine.configuration();
  if (!configuration.enabled)
    throw oliviaError("assistant-disabled", "Olivia está deshabilitada.", 503);
  const conversationId = safeId(String(form.get("conversationId") || ""));
  assertConversationOwner(
    session,
    await store.get(`oliviaConversations/${conversationId}`),
    now,
  );
  const file = form.get("file") || form.get("audio"),
    requestId = safeId(String(form.get("requestId") || ""));
  if (
    !file ||
    typeof file.arrayBuffer !== "function" ||
    file.size < 128 ||
    file.size > 4 * 1024 * 1024 ||
    !/^audio\/(webm|mp4|mpeg|wav|x-wav|ogg)(;.*)?$/.test(file.type)
  )
    throw oliviaError("invalid-audio", "Grabá un audio legible de hasta 4 MB.");
  const reservation = await reserveUsage({
    store,
    session,
    configuration,
    requestId,
    operation: "transcription",
    reservedTokens: 6000,
    now,
  });
  let event = {
    model: configuration.profiles.transcription.model,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  try {
    const upload = new FormData();
    upload.append("file", file, file.name || "audio.webm");
    upload.append("model", event.model);
    upload.append("response_format", "json");
    event = { ...event, totalTokens: 6000, measurement: "reserved-estimate" };
    const payload = await provider("audio/transcriptions", upload, {
      env,
      multipart: true,
    });
    const text = String(payload.text || "").trim();
    event = providerUsage(payload, event.model);
    if (event.measurement !== "provider") event.totalTokens = 6000;
    if (Number.isFinite(payload.usage?.seconds) && payload.usage.seconds >= 0)
      event.durationSeconds = payload.usage.seconds;
    if (!text || text.length > 4000)
      throw oliviaError(
        "audio-unintelligible",
        "No se pudo transcribir con claridad. Probá otra grabación o escribí el mensaje.",
        422,
      );
    const budget = await settleUsage({
      store,
      session,
      reservation,
      event,
      configuration,
      result: { conversationId },
      now: new Date(),
    });
    return {
      conversationId,
      text,
      usage: publicUsage(
        session,
        budget,
        reservation.quota,
        event,
        configuration,
      ),
    };
  } catch (error) {
    await settleUsage({
      store,
      session,
      reservation,
      event,
      configuration,
      errorCode: error.code || "transcription-error",
      now: new Date(),
    });
    throw error;
  }
}
export async function hangupCall(
  callId,
  { env = process.env, fetchImpl = fetch } = {},
) {
  if (!/^rtc_[A-Za-z0-9_-]+$/.test(callId))
    throw oliviaError("realtime-invalid", "La sesión de voz no es válida.");
  const response = await fetchImpl(
    `https://api.openai.com/v1/realtime/calls/${encodeURIComponent(callId)}/hangup`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok && response.status !== 404)
    throw oliviaError(
      "realtime-close-error",
      "No se pudo confirmar el cierre remoto de voz.",
      502,
    );
}
export async function createRealtime({
  session,
  body,
  store,
  engine,
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  applicationOrigin,
  waitImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  assertOliviaAccess(session);
  if (!env.OPENAI_API_KEY)
    throw oliviaError(
      "openai-key-missing",
      "El servicio de voz no está configurado.",
      503,
    );
  const configuration = await engine.configuration();
  if (!configuration.enabled)
    throw oliviaError("assistant-disabled", "Olivia está deshabilitada.", 503);
  const state = await engine.state(session, body.conversationId);
  const id = state.conversationId,
    requestId = safeId(body.requestId);
  if (
    typeof body.sdp !== "string" ||
    !body.sdp.startsWith("v=0") ||
    body.sdp.length > 30000
  )
    throw oliviaError("invalid-sdp", "No se pudo preparar el micrófono.");
  const reservation = await reserveUsage({
      store,
      session,
      configuration,
      requestId,
      operation: "realtime",
      reservedTokens: 20000,
      now,
    }),
    realtimeSessionId = randomUUID();
  const sessionConfig = {
    type: "realtime",
    model: configuration.profiles.realtime.model,
    instructions:
      "Sos la voz de Olivia de Flor Mía. El backend responde y autoriza todas las consultas y acciones. Leé únicamente el resultado verificado recibido, en español argentino breve. Nunca afirmes una ejecución sin resultado del backend. Una acción mutable solo se confirma tocando Sí en la tarjeta; una confirmación oral no ejecuta. Nunca pidas contraseñas ni respondas información ajena a Flor Mía.",
    audio: {
      input: {
        transcription: {
          model: configuration.profiles.liveTranscription.model,
        },
        turn_detection: {
          type: "server_vad",
          create_response: false,
          interrupt_response: true,
        },
      },
      output: { voice: configuration.profiles.realtime.voice },
    },
    tools: [
      {
        type: "function",
        name: "olivia_request",
        description:
          "Solicitar al núcleo de Olivia una respuesta autorizada. Nunca ejecuta acciones.",
        parameters: {
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"],
          additionalProperties: false,
        },
      },
    ],
    max_output_tokens: 700,
  };
  const fd = new FormData();
  fd.set("sdp", body.sdp);
  fd.set("session", JSON.stringify(sessionConfig));
  let callId = null;
  const event = {
    model: configuration.profiles.realtime.model,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    measurement: "reserved-estimate",
  };
  try {
    event.totalTokens = 20000;
    const response = await fetchImpl(
      "https://api.openai.com/v1/realtime/calls",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "OpenAI-Safety-Identifier": createHash("sha256")
            .update(session.uid)
            .digest("hex"),
        },
        body: fd,
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok)
      throw oliviaError(
        "realtime-unavailable",
        "No se pudo iniciar la voz. Podés continuar escribiendo.",
        502,
      );
    const sdp = await response.text();
    callId = (response.headers.get("location") || "").split("/").at(-1);
    if (!callId || !/^rtc_[A-Za-z0-9_-]+$/.test(callId))
      throw oliviaError(
        "realtime-invalid",
        "El proveedor no devolvió una sesión de voz controlable.",
        502,
      );
    if (!sdp.startsWith("v=0") || sdp.length > 30000)
      throw oliviaError(
        "realtime-invalid",
        "El proveedor no devolvió una conexión de voz válida.",
        502,
      );
    await store.commit([
      {
        type: "create",
        path: `oliviaRealtime/${realtimeSessionId}`,
        data: {
          userId: session.uid,
          sessionBinding: String(session.authTime || ""),
          conversationId: id,
          callId,
          status: "active",
          createdAt: now,
          expiresAt: new Date(now.getTime() + 180000),
          requestId,
          model: sessionConfig.model,
          transcriptionModel: sessionConfig.audio.input.transcription.model,
          reservation,
        },
      },
    ]);
    // A background sideband monitor owns duration, provider usage and final settlement.
    await store.commit([
      {
        type: "update",
        path: reservation.requestPath,
        data: { expiresAt: new Date(now.getTime() + 300000) },
      },
    ]);
    if (!applicationOrigin)
      throw oliviaError(
        "realtime-monitor-unavailable",
        "No se pudo iniciar el control de la sesión de voz.",
        503,
      );
    const monitor = await fetchImpl(
      `${applicationOrigin}/.netlify/functions/olivia-voice-meter-background`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ realtimeSessionId }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (monitor.status !== 202)
      throw oliviaError(
        "realtime-monitor-unavailable",
        "No se pudo iniciar el control de la sesión de voz. Podés continuar escribiendo.",
        503,
      );
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const live = await store.get(`oliviaRealtime/${realtimeSessionId}`);
      if (live?.status !== "active" || live?.meteringStatus === "settled")
        break;
      if (live.meteringConnectedAt) {
        ready = true;
        break;
      }
      await waitImpl(250);
    }
    if (!ready)
      throw oliviaError(
        "realtime-monitor-unavailable",
        "El control de voz no respondió. Podés continuar escribiendo.",
        503,
      );
    return {
      ...state,
      sdp,
      realtimeSessionId,
      maxDurationSeconds: 180,
      usage: publicUsage(
        session,
        await store.get(reservation.budgetPath),
        reservation.quota,
      ),
    };
  } catch (error) {
    if (callId) {
      let closed = false;
      try {
        await hangupCall(callId, { env, fetchImpl });
        closed = true;
      } catch {}
      await store
        .commit([
          {
            type: "update",
            path: `oliviaRealtime/${realtimeSessionId}`,
            data: closed
              ? { status: "closed", closedAt: new Date() }
              : {
                  status: "active",
                  expiresAt: new Date(),
                  closeRequestedAt: new Date(),
                },
          },
        ])
        .catch(() => {});
    }
    await settleUsage({
      store,
      session,
      reservation,
      event,
      configuration,
      errorCode: error.code || "realtime-error",
      now: new Date(),
    });
    throw error;
  }
}
export async function stopRealtime({
  session,
  body,
  store,
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
}) {
  const id = safeId(body.realtimeSessionId),
    live = await store.get(`oliviaRealtime/${id}`);
  if (
    !live ||
    live.userId !== session.uid ||
    live.sessionBinding !== String(session.authTime || "") ||
    live.conversationId !== body.conversationId
  )
    throw oliviaError(
      "permission-denied",
      "No tenés acceso a esta sesión de voz.",
      403,
    );
  if (live.status === "active") {
    await hangupCall(live.callId, { env, fetchImpl });
    await store.commit([
      {
        type: "update",
        path: `oliviaRealtime/${id}`,
        data: { status: "closed", closedAt: now },
      },
    ]);
  }
  return { state: "INFORMACION", conversationId: live.conversationId };
}
