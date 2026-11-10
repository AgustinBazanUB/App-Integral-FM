import { GoogleGenAI } from "@google/genai";
import { randomUUID } from "node:crypto";
import { createOliviaStore } from "./_lib/olivia/store.mjs";
import { oliviaSession, json, errorResponse } from "./_lib/olivia/http.mjs";
import { configuredFirebaseProjectId, STAGING_FIREBASE_PROJECT_ID } from "./_lib/firebaseProject.mjs";
import { assertConversationOwner } from "./_lib/olivia/conversations.mjs";
import { canUseOliviaVoice, isOliviaDeployPreview } from "../../src/shared/oliviaVoiceAvailability.mjs";
import { classifyGeminiLiveTurn } from "../../src/shared/oliviaConversationRouter.mjs";
import { compactVoiceContext } from '../../src/shared/oliviaTaskConversation.mjs';
import { estimateGeminiLiveAudioCost, geminiLiveProviderCost, geminiLiveMonthlyProjection, GEMINI_LIVE_MODEL, GEMINI_LIVE_MONTHLY_QUERY_CAP, geminiLiveSetupConfig } from "../../src/shared/oliviaGeminiLive.mjs";
import { defaultOliviaConfiguration, oliviaError, safeId, validateConfiguration } from "../../src/shared/oliviaContracts.mjs";
import { initialConversationFocus, normalizeConversationFocus, transitionConversationFocus } from "../../src/shared/oliviaConversationFocus.mjs";
import { normalizeSpeech } from "../../src/shared/oliviaSpeechText.mjs";

const TOKEN_EXPIRES_MS = 30 * 60 * 1000;

function cleanStockCollection(value){
  if(!value||value.intent!=='stock-load'||!Number.isInteger(value.revision)||value.revision<1||!['collecting','ready','paused','cancelled'].includes(value.status)||!Array.isArray(value.itemsMentioned)||value.itemsMentioned.length>20)return null;
  const itemsMentioned=value.itemsMentioned.map(item=>({description:String(item?.description || '').trim().slice(0,350),quantityMentioned:String(item?.quantityMentioned || '').trim().slice(0,40)})).filter(item=>item.description&&item.quantityMentioned);
  if(itemsMentioned.length!==value.itemsMentioned.length)return null;
  const targetOrdinal=value.targetOrdinal==null?null:Number(value.targetOrdinal);
  if(targetOrdinal!=null&&(!Number.isInteger(targetOrdinal)||targetOrdinal<1||targetOrdinal>20))return null;
  return {version:1,revision:value.revision,intent:'stock-load',operation:'stock-load',targetType:['location','warehouse'].includes(value.targetType)?value.targetType:null,targetId:null,targetOrdinal,requestedLocation:String(value.requestedLocation || '').trim().slice(0,160)||null,requestedWarehouse:String(value.requestedWarehouse || '').trim().slice(0,160)||null,itemsMentioned,validation:'unverified',status:value.status,lastInput:normalizeSpeech(value.lastInput || '').slice(0,1500),missingFields:Array.isArray(value.missingFields)?value.missingFields.filter(field=>typeof field==='string').slice(0,8):[],pendingQuestion:typeof value.pendingQuestion==='string'?value.pendingQuestion.slice(0,80):null};
}

export function assertGeminiLivePreview({ env = process.env, projectId = configuredFirebaseProjectId(env) } = {}) {
  if (!isOliviaDeployPreview(env) || env.OLIVIA_HYBRID_LIVE_ENABLED !== "true" || projectId !== STAGING_FIREBASE_PROJECT_ID)
    throw oliviaError("gemini-live-disabled", "Gemini Live solo está habilitado en Deploy Preview con Firebase de pruebas.", 403);
  if (!env.GEMINI_API_KEY) throw oliviaError("gemini-live-unconfigured", "Falta configurar GEMINI_API_KEY en el entorno seguro del Deploy Preview.", 503);
  if (env.GEMINI_API_BILLING_TIER !== "paid") throw oliviaError("gemini-live-billing-unverified", "La prueba requiere un proyecto Gemini con facturación paga verificada para proteger los datos de negocio.", 503);
}

function periodKey(now) { return now.toISOString().slice(0, 7); }
function budgetPath(period) { return `oliviaGeminiLiveBudgets/${period}`; }
function sessionPath(id) { return `oliviaGeminiLiveSessions/${id}`; }
function turnPath(sessionId, turnId) { return `oliviaGeminiLiveTurns/${sessionId}_${turnId}`; }
const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 1_000_000) / 1_000_000;
const numeric = (value) => Number.isFinite(value) && value >= 0 ? value : 0;

export async function reserveSession({ store, session, config, now, replaceSessionId = null }) {
  const period = periodKey(now), path = budgetPath(period), id = randomUUID(), reservation = Number(config.reservedUsdPerSession || 0.015), hardLimitUsd = Number(config.hardLimitUsd || 10), maxSessionSeconds = Math.min(600, Math.max(60, Number(config.maxSessionSeconds || 600))), expiresAt = new Date(now.getTime() + maxSessionSeconds * 1000 + 30_000);
  await store.transaction(async (tx) => {
    const snapshot = await tx.getDocument(path), current = snapshot?.data || { period, usedUsd: 0, reservedUsd: 0, queryCount: 0, usageMetadataEstimatedUsd: 0, estimatedUsd: 0, unconfirmedQueryCount: 0 }, stale = current.activeSessionId ? await tx.getDocument(sessionPath(current.activeSessionId)) : null;
    let reservedUsd = numeric(current.reservedUsd);
    const writes = [];
    const sameOwnerSession = stale?.data?.status === "active" && stale.data.userId === session.uid && (stale.data.conversationId === session.conversationId || (replaceSessionId && current.activeSessionId === replaceSessionId));
    if (stale?.data?.status === "active" && new Date(stale.data.expiresAt).getTime() > now.getTime() && !sameOwnerSession) throw oliviaError("gemini-live-session-active", "Ya hay una sesión híbrida abierta. Cerrala antes de abrir otra.", 409);
    if (stale?.data?.status === "active") {
      reservedUsd = Math.max(0, reservedUsd - numeric(stale.data.reservedUsd));
      writes.push({ type: "update", path: sessionPath(current.activeSessionId), data: { status: sameOwnerSession ? "replaced" : "expired", closedAt: now, reservedUsd: 0 } });
    }
    if (numeric(current.queryCount) >= GEMINI_LIVE_MONTHLY_QUERY_CAP) throw oliviaError("gemini-live-query-cap", "Se alcanzó el límite preventivo mensual de 660 turnos Gemini Live.", 429);
    if (numeric(current.usedUsd) + reservedUsd + reservation > hardLimitUsd)
      throw oliviaError("gemini-live-budget-exhausted", "Se alcanzó el techo preventivo mensual de Gemini Live.", 429);
    writes.push({ type: snapshot ? "update" : "create", path, data: { ...current, period, reservedUsd: roundMoney(reservedUsd + reservation), activeSessionId: id, hardLimitUsd, maxQueries: GEMINI_LIVE_MONTHLY_QUERY_CAP, targetUsd: Number(config.targetUsd || 5), warningUsd: Number(config.warningUsd || 6), unconfirmedQueryCount: numeric(current.unconfirmedQueryCount), usageMetadataEstimatedUsd: numeric(current.usageMetadataEstimatedUsd), estimatedUsd: numeric(current.estimatedUsd), updatedAt: now } });
    writes.push({ type: "create", path: sessionPath(id), data: { id, userId: session.uid, sessionBinding: String(session.authTime || ""), conversationId: session.conversationId, period, status: "active", model: GEMINI_LIVE_MODEL, reservedUsd: reservation, usedUsd: 0, usageMetadataEstimatedUsd: 0, estimatedUsd: 0, unconfirmedQueryCount: 0, queryCount: 0, openedAt: now, expiresAt } });
    await tx.commitDocuments(writes);
  });
  return { id, period, reservation, expiresAt, maxSessionSeconds };
}

export async function releaseSession({ store, id, now, status = "closed" }) {
  await store.transaction(async (tx) => {
    const snapshot = await tx.getDocument(sessionPath(id)), session = snapshot?.data;
    if (!session || session.status !== "active") return;
    const budget = await tx.getDocument(budgetPath(session.period)), data = budget?.data;
    if (!data) return;
    await tx.commitDocuments([
      { type: "update", path: budgetPath(session.period), data: { reservedUsd: roundMoney(Math.max(0, numeric(data.reservedUsd) - numeric(session.reservedUsd))), activeSessionId: data.activeSessionId === id ? null : data.activeSessionId, updatedAt: now } },
      { type: "update", path: sessionPath(id), data: { status, closedAt: now, reservedUsd: 0 } },
    ]);
  });
}

async function issueToken({ store, session, config, env, now, replaceSessionId = null }) {
  const reservationStartedAt = performance.now();
  const sessionInfo = await reserveSession({ store, session: { ...session, conversationId: session.conversationId }, config, now, replaceSessionId });
  const reservationMs = Math.round(performance.now() - reservationStartedAt);
  try {
    const providerStartedAt = performance.now();
    const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    const token = await client.authTokens.create({ config: {
      uses: 1,
      expireTime: new Date(now.getTime() + TOKEN_EXPIRES_MS).toISOString(),
      newSessionExpireTime: new Date(now.getTime() + 60_000).toISOString(),
      liveConnectConstraints: { model: GEMINI_LIVE_MODEL, config: geminiLiveSetupConfig() },
    } });
    if (!token?.name) throw oliviaError("gemini-live-token-error", "Google no emitió un token efímero válido.", 503);
    return { token: token.name, sessionId: sessionInfo.id, uses:1, model: GEMINI_LIVE_MODEL, voice: "Aoede", maxSessionSeconds: sessionInfo.maxSessionSeconds, expiresAt: new Date(now.getTime() + TOKEN_EXPIRES_MS).toISOString(), newSessionExpiresAt:new Date(now.getTime()+60_000).toISOString(), reservedUsd: sessionInfo.reservation, timings: { reservationMs, providerTokenMs: Math.round(performance.now() - providerStartedAt) } };
  } catch (error) {
    await releaseSession({ store, id: sessionInfo.id, now, status: "token-error" }).catch(() => {});
    if (error.code) throw error;
    throw oliviaError("gemini-live-token-error", "No se pudo preparar la sesión de voz híbrida.", 503);
  }
}

export async function reportTurn({ store, session, body, now, config }) {
  const maxSessionSeconds = Math.min(600, Math.max(60, Number(config.maxSessionSeconds || 600))), inputAudioSeconds = Math.min(maxSessionSeconds, numeric(Number(body.inputAudioSeconds))), outputAudioSeconds = Math.min(maxSessionSeconds, numeric(Number(body.outputAudioSeconds))), sessionId = safeId(body.sessionId), turnId = safeId(body.turnId), targetPath = sessionPath(sessionId), cost = geminiLiveProviderCost(body.usageMetadata), audioEstimate = estimateGeminiLiveAudioCost({ inputAudioSeconds, outputAudioSeconds }), estimate = inputAudioSeconds + outputAudioSeconds > 0 ? audioEstimate : null;
  return store.transaction(async (tx) => {
    const live = await tx.getDocument(targetPath), record = live?.data;
    if (!record || record.userId !== session.uid || record.sessionBinding !== String(session.authTime || "") || record.status !== "active" || new Date(record.expiresAt).getTime() <= now.getTime()) throw oliviaError("gemini-live-session-expired", "La sesión de Gemini venció. Reconectá la voz.", 409);
    const path = turnPath(sessionId, turnId), previous = await tx.getDocument(path), budget = await tx.getDocument(budgetPath(record.period));
    if (previous) {
      const spendUsd = numeric(budget?.data?.usedUsd), reservedUsd = numeric(budget?.data?.reservedUsd), queryCount = numeric(budget?.data?.queryCount), hardLimitUsd = Number(config.hardLimitUsd || 10), warningUsd = Number(config.warningUsd || 6);
      return { duplicate: true, measurement: previous.data.measurement, costUsd: previous.data.costUsd, sessionSpendUsd: numeric(record.usedUsd), inputTokens: previous.data.inputTokens, outputTokens: previous.data.outputTokens, inputTokensByModality: previous.data.inputTokensByModality, outputTokensByModality: previous.data.outputTokensByModality, spendUsd, reservedUsd, targetUsd: Number(config.targetUsd || 5), warningUsd, hardLimitUsd, maxQueries: GEMINI_LIVE_MONTHLY_QUERY_CAP, usageMetadataEstimatedUsd: numeric(budget?.data?.usageMetadataEstimatedUsd), estimatedUsd: numeric(budget?.data?.estimatedUsd), unconfirmedQueryCount: numeric(budget?.data?.unconfirmedQueryCount), queryCount, warningReached: spendUsd + reservedUsd >= warningUsd, hardLimitReached: spendUsd + reservedUsd >= hardLimitUsd, queryLimitReached: queryCount >= GEMINI_LIVE_MONTHLY_QUERY_CAP, shouldStop: queryCount >= GEMINI_LIVE_MONTHLY_QUERY_CAP || spendUsd + reservedUsd >= hardLimitUsd, ...geminiLiveMonthlyProjection({ spendUsd, queryCount, daysElapsed: now.getUTCDate(), daysInMonth: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate() }) };
    }
    const costUsd = cost.costUsd ?? estimate?.estimatedCostUsd ?? null, measurement = cost.costUsd != null ? cost.measurement : estimate ? "estimated-audio-context-excluded" : "unconfirmed", data = budget?.data;
    if (!data) throw oliviaError("gemini-live-budget-missing", "No se pudo verificar el presupuesto mensual de Gemini.", 503);
    const chargedUsd = costUsd == null ? 0 : roundMoney(costUsd), usedUsd = roundMoney(numeric(data.usedUsd) + chargedUsd), estimatedUsd = roundMoney(numeric(data.estimatedUsd) + (cost.measurement === "provider-forwarded" ? 0 : chargedUsd)), usageMetadataEstimatedUsd = roundMoney(numeric(data.usageMetadataEstimatedUsd) + (cost.measurement === "provider-forwarded" ? chargedUsd : 0)), sessionUsedUsd = roundMoney(numeric(record.usedUsd) + chargedUsd), limit = Number(config.hardLimitUsd || 10), warning = Number(config.warningUsd || 6), maxSessionSpendUsd = Math.min(limit, Number(config.maxSessionSpendUsd || 2.5)), queryCount = numeric(data.queryCount) + 1, unconfirmedQueryCount = numeric(data.unconfirmedQueryCount) + (measurement === "unconfirmed" ? 1 : 0), stop = sessionUsedUsd >= maxSessionSpendUsd || usedUsd + numeric(data.reservedUsd) >= limit || queryCount >= GEMINI_LIVE_MONTHLY_QUERY_CAP;
    const turnData = { userId: session.uid, sessionId, turnId, period: record.period, model: GEMINI_LIVE_MODEL, measurement, inputTokens: cost.inputTokens, outputTokens: cost.outputTokens, inputTokensByModality: cost.inputTokensByModality || null, outputTokensByModality: cost.outputTokensByModality || null, inputAudioSeconds: estimate?.inputAudioSeconds ?? null, outputAudioSeconds: estimate?.outputAudioSeconds ?? null, costUsd: chargedUsd || null, excludesAccumulatedContext: measurement === "estimated-audio-context-excluded", createdAt: now };
    await tx.commitDocuments([
      { type: "create", path, data: turnData },
      { type: "update", path: targetPath, data: { usedUsd: sessionUsedUsd, usageMetadataEstimatedUsd: roundMoney(numeric(record.usageMetadataEstimatedUsd) + (cost.measurement === "provider-forwarded" ? chargedUsd : 0)), estimatedUsd: roundMoney(numeric(record.estimatedUsd) + (cost.measurement === "provider-forwarded" ? 0 : chargedUsd)), unconfirmedQueryCount: numeric(record.unconfirmedQueryCount) + (measurement === "unconfirmed" ? 1 : 0), queryCount: numeric(record.queryCount) + 1, lastTurnAt: now } },
      { type: "update", path: budgetPath(record.period), data: { usedUsd, estimatedUsd, usageMetadataEstimatedUsd, unconfirmedQueryCount, queryCount, updatedAt: now } },
    ]);
    return { duplicate: false, measurement, costUsd: chargedUsd || null, sessionSpendUsd: sessionUsedUsd, spendUsd: usedUsd, reservedUsd: numeric(data.reservedUsd), targetUsd: Number(config.targetUsd || 5), warningUsd: warning, hardLimitUsd: limit, maxQueries: GEMINI_LIVE_MONTHLY_QUERY_CAP, usageMetadataEstimatedUsd, estimatedUsd, unconfirmedQueryCount, queryCount, warningReached: usedUsd + numeric(data.reservedUsd) >= warning, hardLimitReached: usedUsd + numeric(data.reservedUsd) >= limit, queryLimitReached: queryCount >= GEMINI_LIVE_MONTHLY_QUERY_CAP, inputTokens: cost.inputTokens, outputTokens: cost.outputTokens, inputTokensByModality: cost.inputTokensByModality || null, outputTokensByModality: cost.outputTokensByModality || null, inputAudioSeconds: estimate?.inputAudioSeconds ?? null, outputAudioSeconds: estimate?.outputAudioSeconds ?? null, shouldStop: stop, includesAccumulatedContext: measurement === "provider-forwarded", ...geminiLiveMonthlyProjection({ spendUsd: usedUsd, queryCount, daysElapsed: now.getUTCDate(), daysInMonth: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getDate() }) };
  });
}

async function classifyTurn({ store, session, body, now }) {
  const id = safeId(body.sessionId), live = await store.get(sessionPath(id));
  if (!live || live.userId !== session.uid || live.sessionBinding !== String(session.authTime || "") || live.status !== "active" || new Date(live.expiresAt).getTime() <= now.getTime())
    throw oliviaError("gemini-live-session-expired", "La sesión de Gemini venció. Reconectá la voz.", 409);
  const conversation = await store.get(`oliviaConversations/${safeId(live.conversationId)}`);
  assertConversationOwner(session, conversation, now);
  const userText = String(body.userText || "").trim().slice(0, 12000);
  if (!userText) throw oliviaError("invalid-input", "No llegó una transcripción para validar el turno.");
  const unlocked = !conversation.pendingActionId && !(conversation.busyRequestId && new Date(conversation.busyUntil).getTime() > now.getTime());
  const direct = unlocked && classifyGeminiLiveTurn(userText).route === "direct";
  return { route: direct ? "direct" : "delegate", direct, policy: "exact-small-talk-v1" };
}

async function persistConversationFocus({store,session,body,now}) {
  const sessionId=safeId(body.sessionId),turnId=safeId(body.turnId),conversationId=safeId(body.conversationId),turnIndex=Number(body.turnIndex);
  const userText=String(body.userText || '').trim().slice(0,12000);
  if(!userText||!Number.isInteger(turnIndex)||turnIndex<1)throw oliviaError('invalid-input','Faltan el turno final o su correlación.');
  const live=await store.get(sessionPath(sessionId));
  if(!live||live.userId!==session.uid||live.sessionBinding!==String(session.authTime || '')||live.conversationId!==conversationId||live.status!=='active'||new Date(live.expiresAt).getTime()<=now.getTime())
    throw oliviaError('gemini-live-session-expired','La sesión de Gemini venció. Reconectá la voz.',409);
  const conversation=await store.get('oliviaConversations/'+conversationId);
  assertConversationOwner(session,conversation,now);
  const taskIds=(conversation.delegatedTaskIds || []).slice(-20);
  const tasks=(await Promise.all(taskIds.map(id=>store.get('oliviaConversations/'+conversationId+'/delegatedTasks/'+safeId(id))))).filter(Boolean);
  return store.transaction(async tx=>{
    const path='oliviaConversations/'+conversationId,snapshot=await tx.getDocument(path),root=snapshot?.data;
    assertConversationOwner(session,root,now);
    const previous=normalizeConversationFocus(root.conversationFocus || initialConversationFocus());
    const result=transitionConversationFocus(previous,{text:userText,turnId,sourceTurnId:turnId,sessionId,turnIndex,context:{voiceCollection:root.voiceCollection || null,messages:(root.messages || []).slice(-8).map(message=>({role:message.role,content:message.content || message.voiceTranscript || ''})),tasks,pendingAction:Boolean(root.pendingActionId),pendingActionId:root.pendingActionId,collectingTask:root.taskState?.status==='collecting',activeTask:Boolean(root.busyRequestId || root.queuedChatRequestId)},now});
    if(result.stale)return {stale:true,conversationFocus:previous,voiceCollection:root.voiceCollection || null,decision:result.decision};
    if(Number.isInteger(body.intentEpoch)&&body.intentEpoch!==result.focus.intentEpoch)return {stale:true,conversationFocus:previous,voiceCollection:root.voiceCollection || null,decision:{kind:'AMBIGUOUS',reason:'intent-epoch-mismatch'}};
    let voiceCollection=root.voiceCollection || null;
    const submittedCollection=body.collection?cleanStockCollection(body.collection):null;
    if(body.collection&&!submittedCollection)throw oliviaError('invalid-input','La lista de mercadería no tiene un formato válido.',422);
    if(submittedCollection){
      const previousRevision=Number.isInteger(voiceCollection?.revision)?voiceCollection.revision:0;
      if(submittedCollection.revision<previousRevision||submittedCollection.revision>previousRevision+1)return {stale:true,conversationFocus:previous,voiceCollection,decision:{kind:'AMBIGUOUS',reason:'collection-revision-mismatch'}};
      voiceCollection=submittedCollection;
    }
    const liveDraft=voiceCollection&&['collecting','ready','paused','suspended'].includes(voiceCollection.status);
    if(liveDraft&&['INDEPENDENT_READ','SOCIAL/GENERAL','NEW_INTENT','TASK_STATUS','CANCEL_ACCEPTED_TASK'].includes(result.decision.kind)){
      if(!submittedCollection)voiceCollection={...voiceCollection,status:'suspended',revision:(voiceCollection.revision || 0)+1,nextStep:'resume-explicitly'};
      result.focus={...result.focus,activeDraftId:result.focus.activeDraftId || previous.activeDraftId,draftStatus:'suspended'};
    }else if(liveDraft&&result.decision.kind==='PAUSE_DRAFT'){
      if(!submittedCollection)voiceCollection={...voiceCollection,status:'paused',revision:(voiceCollection.revision || 0)+1,nextStep:'resume-or-discard'};
      result.focus={...result.focus,draftStatus:'paused'};
    }else if(liveDraft&&result.decision.kind==='RESUME_DRAFT'){
      if(!submittedCollection)voiceCollection={...voiceCollection,status:'collecting',revision:(voiceCollection.revision || 0)+1,nextStep:'ask-'+(voiceCollection.pendingQuestion || voiceCollection.missingFields?.[0] || 'items-and-quantities')};
      result.focus={...result.focus,draftStatus:'collecting'};
    }else if(liveDraft&&result.decision.kind==='DISCARD_DRAFT'){
      if(!submittedCollection)voiceCollection={...voiceCollection,status:'cancelled',revision:(voiceCollection.revision || 0)+1,missingFields:[],nextStep:'leave-unsubmitted'};
      result.focus={...result.focus,activeIntentId:'conversation:discarded',activeDraftId:null,draftStatus:'discarded',targetType:null,targetId:null,awaitingField:null,taskId:null};
    }
    result.focus=normalizeConversationFocus(result.focus);
    await tx.commitDocuments([{type:'update',path,data:{conversationFocus:result.focus,...(voiceCollection!==root.voiceCollection?{voiceCollection}:{}),updatedAt:now}}]);
    return {stale:false,conversationFocus:result.focus,voiceCollection,decision:result.decision};
  });
}

export default async function handler(request) {
  if (request.method !== "POST") return json({ code: "method-not-allowed", message: "Método no permitido." }, 405);
  let session;
  try {
    session = await oliviaSession(request);
    if (!canUseOliviaVoice(session)) throw oliviaError("voice-not-enabled", "La conversación por voz sigue limitada a la prueba administrativa.", 403);
    const env = process.env, projectId = configuredFirebaseProjectId(env);
    assertGeminiLivePreview({ env, projectId });
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 65000) throw oliviaError("request-too-large", "La solicitud supera el límite.", 413);
    const body = (() => { try { return JSON.parse(raw); } catch { return null; } })();
    if (!body || typeof body !== "object") throw oliviaError("invalid-json", "Solicitud inválida.");
    const store = createOliviaStore({ env }), now = new Date(), configurationStartedAt = performance.now(), configDoc = await store.get("oliviaConfiguration/global"), configurationReadMs = Math.round(performance.now() - configurationStartedAt), defaults = defaultOliviaConfiguration(env), saved = Object.fromEntries(Object.keys(defaults).filter(key => configDoc?.[key] !== undefined).map(key => [key, configDoc[key]])), configuration = validateConfiguration({ ...defaults, ...saved }, env), config = configuration.hybridVoice;
    if (body.operation === "token") {
      if (!config.enabled) throw oliviaError("gemini-live-disabled", "El modo híbrido está desactivado en la configuración de Olivia.", 403);
      const conversationId = safeId(body.conversationId), conversationStartedAt = performance.now(), conversation = await store.get(`oliviaConversations/${conversationId}`), conversationReadMs = Math.round(performance.now() - conversationStartedAt);
      assertConversationOwner(session, conversation, now);
      session.conversationId = conversationId;
      const tasks=await Promise.all((conversation.delegatedTaskIds || []).slice(-20).map(id=>store.get(`oliviaConversations/${conversationId}/delegatedTasks/${safeId(id)}`)));
      const token = await issueToken({ store, session, config, env, now, replaceSessionId: body.replaceSessionId ? safeId(body.replaceSessionId) : null });
      return json({ ...token, context:compactVoiceContext(conversation,tasks.filter(Boolean)), timings: { configurationReadMs, conversationReadMs, ...token.timings } });
    }
    if (body.operation === "focus") return json(await persistConversationFocus({store,session,body,now}));
    if (body.operation === "classify") return json(await classifyTurn({ store, session, body, now }));
    if (body.operation === "usage") return json(await reportTurn({ store, session, body, now, config }));
    if (body.operation === "close") {
      const id = safeId(body.sessionId), live = await store.get(sessionPath(id));
      if (!live || live.userId !== session.uid || live.sessionBinding !== String(session.authTime || "")) throw oliviaError("gemini-live-session-not-found", "No se encontró la sesión de Gemini.", 404);
      await releaseSession({ store, id, now, status: "closed" });
      const budget = await store.get(budgetPath(live.period));
      return json({ closed: true, spendUsd: numeric(budget?.usedUsd), reservedUsd: numeric(budget?.reservedUsd), queryCount: numeric(budget?.queryCount) });
    }
    throw oliviaError("invalid-operation", "Operación Gemini Live no disponible.");
  } catch (error) {
    console.error("olivia.gemini_live_failed", { code: error.code || "gemini-live-error", status: error.status || 500, userId: session?.uid || null });
    return errorResponse(error);
  }
}
