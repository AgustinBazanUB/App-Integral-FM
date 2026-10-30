import { createHash } from 'node:crypto';
import { safeId, oliviaError, quotaPeriod, retentionDate } from '../../../../src/shared/oliviaContracts.mjs';
import { canUseOliviaVoice } from '../../../../src/shared/oliviaVoiceAvailability.mjs';
import { assertConversationOwner, sessionBinding } from './conversations.mjs';
import { hangupCall } from './voice.mjs';
export const LIVE_TRANSCRIPTION_LIMIT_SECONDS=180;
export const liveTranscriptionConfig=(delay='low')=>({type:'transcription',audio:{input:{transcription:{model:'gpt-live-transcribe',languages:['es'],delay,keywords:['Flor Mía','Arbequina','Arbosana','almendras','dietética'],prompt:'Conversación en español argentino de Flor Mía sobre productos, stock, ventas y envíos.'},turn_detection:null}}});
export async function liveTranscriptionSession({session,store,engine,body,env=process.env,fetchImpl=fetch,now=new Date()}) {
  if(!canUseOliviaVoice(session))throw oliviaError('voice-not-enabled','La voz sigue limitada a la prueba administrativa.',403);
  const config=await engine.configuration();
  if(body.operation==='start' && (!config.enabled || !config.naturalVoice.enabled || !env.OPENAI_API_KEY))throw oliviaError('voice-not-enabled','La transcripción en vivo no está disponible.',503);
  const conversationId=safeId(body.conversationId),identity=safeId(body.requestId),path=`oliviaRealtime/${session.uid}_${identity}`;
  assertConversationOwner(session,await store.get(`oliviaConversations/${conversationId}`),now);
  if(body.operation==='turn') {
    const saved=await store.get(path);
    if(!saved || saved.userId!==session.uid || saved.sessionBinding!==sessionBinding(session) || saved.conversationId!==conversationId)throw oliviaError('voice-session-not-found','Esta sesión no está disponible.',404);
    const itemId=safeId(body.itemId),seconds=Number(body.durationSeconds);
    if(!Number.isFinite(seconds) || seconds<0 || seconds>config.audioLimits.maxSeconds)throw oliviaError('invalid-input','Duración inválida.');
    const turnId=createHash('sha256').update(`${identity}:${itemId}`).digest('hex'),turnPath=`oliviaUsage/${session.uid}_live_turn_${turnId}`;
    await store.transaction(async tx=>{if(await tx.getDocument(turnPath))return;await tx.commitDocuments([{type:'create',path:turnPath,data:{userId:session.uid,role:session.profile.role,operation:'live-transcription-turn',model:'gpt-live-transcribe',billingUnit:'telemetry-only',measurement:'client-estimate',durationSeconds:seconds,allocatedEstimatedCostUsd:seconds*.017/60,costIncludedInSession:true,actualCostUsd:null,createdAt:now,retentionExpiresAt:retentionDate(config.retentionMonths,now)}}]);});
    return {recorded:true,allocatedEstimatedCostUsd:seconds*.017/60};
  }
  if(body.operation==='stop') {
    const saved=await store.get(path);
    if(!saved || saved.userId!==session.uid || saved.sessionBinding!==sessionBinding(session) || saved.conversationId!==conversationId)throw oliviaError('voice-session-not-found','Esta sesión no está disponible.',404);
    if(saved.status==='closed')return {closed:true};
    if(saved.callId)await hangupCall(saved.callId,{env,fetchImpl});
    const estimatedSeconds=Math.max(0,Math.min(240,(now-new Date(saved.createdAt))/1000));
    await store.commit([{type:'update',path,data:{status:'closed',closedAt:now,measurement:'unconfirmed',estimatedSeconds,estimatedCostUsd:estimatedSeconds*.017/60}},{type:'update',path:`oliviaUsage/${session.uid}_${identity}`,data:{success:true,measurement:'unconfirmed',estimatedCostUsd:estimatedSeconds*.017/60,estimatedSeconds}}]);
    const budgetPath=`oliviaVoiceBudgets/${session.uid}_${quotaPeriod('monthly',new Date(saved.createdAt)).key}`;
    await store.transaction(async tx=>{const budget=(await tx.getDocument(budgetPath))?.data;if(budget?.liveActiveRequest===identity)await tx.commitDocuments([{type:'update',path:budgetPath,data:{liveActiveUntil:now}}]);});
    return {closed:true,estimatedSeconds,estimatedCostUsd:estimatedSeconds*.017/60};
  }
  if(body.operation!=='start' || typeof body.sdp!=='string' || !body.sdp.startsWith('v=0') || body.sdp.length>50000)throw oliviaError('invalid-input','La conexión de audio no es válida.');
  const fingerprint=createHash('sha256').update(body.sdp).digest('hex'),period=quotaPeriod('monthly',now),budgetPath=`oliviaVoiceBudgets/${session.uid}_${period.key}`;
  let previous;
  await store.transaction(async tx=>{
    previous=(await tx.getDocument(path))?.data;
    if(previous) {
      if(previous.fingerprint!==fingerprint || previous.sessionBinding!==sessionBinding(session) || previous.status!=='active' || !previous.answer || new Date(previous.expiresAt)<=now)throw oliviaError('request-already-used','Reiniciá la voz para conectar una nueva sesión.',409);
      return;
    }
    const budget=(await tx.getDocument(budgetPath))?.data;
    if(budget?.liveActiveUntil && new Date(budget.liveActiveUntil)>now)throw oliviaError('voice-session-active','Ya hay una sesión en vivo activa. Finalizala antes de abrir otra.',409);
    if(Number(budget?.liveReservedSeconds || 0)+240>18000)throw oliviaError('voice-quota-exhausted','Se alcanzó el cupo mensual de transcripción en vivo. Podés dictar o escribir.',429);
    const expiresAt=new Date(now.getTime()+LIVE_TRANSCRIPTION_LIMIT_SECONDS*1000),retentionExpiresAt=retentionDate(config.retentionMonths,now);
    await tx.commitDocuments([{type:budget?'update':'create',path:budgetPath,data:{...(budget || {}),userId:session.uid,period:period.key,liveReservedSeconds:Number(budget?.liveReservedSeconds || 0)+240,liveActiveUntil:expiresAt,liveActiveRequest:identity,retentionExpiresAt}},{type:'create',path,data:{userId:session.uid,sessionBinding:sessionBinding(session),conversationId,kind:'live-transcription',model:'gpt-live-transcribe',fingerprint,status:'connecting',createdAt:now,expiresAt,retentionExpiresAt}},{type:'create',path:`oliviaUsage/${session.uid}_${identity}`,data:{userId:session.uid,role:session.profile.role,operation:'live-transcription',model:'gpt-live-transcribe',billingUnit:'live-audio-seconds',measurement:'reserved-estimate',reservedSeconds:240,estimatedCostUsd:240*.017/60,actualCostUsd:null,createdAt:now,retentionExpiresAt}}]);
  });
  if(previous)return {sdp:previous.answer,requestId:identity,maxSessionSeconds:LIVE_TRANSCRIPTION_LIMIT_SECONDS,model:'gpt-live-transcribe'};
  try {
    const form=new FormData();form.set('sdp',body.sdp);form.set('session',JSON.stringify(liveTranscriptionConfig(config.conversationLatency.enabled ? config.conversationLatency.transcriptionDelay : 'low')));
    const response=await fetchImpl('https://api.openai.com/v1/realtime/calls',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`},body:form,signal:AbortSignal.timeout(12000)});
    const answer=await response.text(),location=response.headers.get('location') || '',callId=location.split('/').at(-1);
    if(!response.ok || !answer.startsWith('v=0') || !/^rtc_[A-Za-z0-9_-]+$/.test(callId))throw oliviaError('live-transcription-unavailable','No pude conectar la transcripción en vivo. Podés continuar con dictado por turnos.',503);
    await store.commit([{type:'update',path,data:{status:'active',callId,answer} }]);
    return {sdp:answer,requestId:identity,maxSessionSeconds:LIVE_TRANSCRIPTION_LIMIT_SECONDS,model:'gpt-live-transcribe'};
  } catch(error) {
    await store.commit([{type:'update',path,data:{status:'closed',finalization:'provider-error',errorCode:'live-transcription-unavailable'}},{type:'update',path:budgetPath,data:{liveActiveUntil:now}},{type:'update',path:`oliviaUsage/${session.uid}_${identity}`,data:{success:false,measurement:'unconfirmed'}}]).catch(()=>{});
    throw error;
  }
}
