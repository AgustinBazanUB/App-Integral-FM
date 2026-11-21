import { createOliviaTransport } from '../../../src/gestion/olivia/client.mjs';
import { isGreetingOnly } from '../../../src/shared/oliviaSpeechText.mjs';
import {instantConversation} from '../../../src/shared/oliviaConversationRouter.mjs';
import {streamFrame} from '../../../src/shared/oliviaStream.mjs';
const params=new URLSearchParams(location.search);
export const qaTraffic={live:0,transcribe:0,foreground:0};
export const countTraffic=kind=>{qaTraffic[kind]++;window.dispatchEvent(new Event('olivia:qa-traffic'));};
const conversationId = 'a1234567-1234-4234-8234-123456789012';
let messages = params.has('layoutSample') ? [{id:'sample-user',role:'user',content:'Hola, Olivia, quiero cargar stock.'},{id:'sample-assistant',role:'assistant',content:'Dale, perfecto. ¿En qué ubicación querés cargarlo?'}] : [], pendingAction = null;
const jobs = new Map();
const state = () => ({ conversationId, messages, pendingAction, enabled: true, providerConfigured: true, voiceConversationAvailable:params.has('v62'),voiceSettings:{hybridLiveAvailable:params.has('v62'),hybridLiveEnabled:params.has('v62'),latencyMode:true},geminiLiveUsage:params.has('v62')?{period:'fixture',spendUsd:.02,reservedUsd:.5,unconfirmedQueryCount:1,lunaSol:{estimatedUsd:.01,unconfirmedCalls:0}}:undefined,audioLimits: { maxSeconds: 60, maxBytes: 4194304 }, state: pendingAction ? 'ESPERANDO_CONFIRMACION' : 'INFORMACION', usage: { unlimited: true }, estimate: null });
export const oliviaClient = createOliviaTransport({ getToken: async () => 'synthetic-only', pollIntervalMs: 200, fetchImpl: async (url, init) => {
  if(params.has('v62')&&url.includes('olivia-gemini-live')){
    const body=JSON.parse(init.body);countTraffic('live');
    if(body.operation==='token'){await new Promise(r=>setTimeout(r,Number(params.get('tokenDelay') || 1500)));if(params.has('tokenFailure'))return Response.json({message:'Fallo de conexión simulado',code:'fixture-unavailable'},{status:503});return Response.json({token:'auth_tokens/synthetic-only',uses:1,sessionId:'fixture-session',expiresAt:new Date(Date.now()+60000).toISOString(),newSessionExpiresAt:new Date(Date.now()+60000).toISOString(),maxSessionSeconds:60,context:{messages:[]}});}
    return Response.json({closed:true,recorded:true,costUsd:0,measurement:'fixture-only'});
  }
  if(params.has('contextGuide')) return fetch('/__qa/olivia-context', init);
  if(url.includes('live-transcribe')) {
    countTraffic('live');
    const body=JSON.parse(init.body);
    if(params.has('liveError'))return Response.json({message:'Fallo sintético de Live'},{status:503});
    return Response.json(body.operation==='start'?{sdp:'v=0\nsynthetic',requestId:body.requestId,maxSessionSeconds:180}:{closed:true,recorded:true});
  }
  if (url.includes('transcribe')) {countTraffic('transcribe');return Response.json({ text: new URLSearchParams(location.search).has('slowVoice') ? 'Consulta lenta de prueba de voz' : 'Hola Olivia, probemos la conversación.' });}
  const b = JSON.parse(init.body);
  if(b.operation==='delegatedTaskStatus')return Response.json({tasks:params.has('taskSample')?['needs-input','paused','failed'].map(status=>({id:'sample-'+status,status,summary:'Pregunta de tarea sintética'})):[]});
  if (['state', 'resume'].includes(b.operation)) {if(params.has('hydrateDelay'))await new Promise(r=>setTimeout(r,Number(params.get('hydrateDelay'))));return Response.json(state());}
  if (b.operation === 'estimate') return Response.json({ estimate: null });
  if (b.operation==='cancelTurn')return Response.json({cancelled:true});
  if(b.operation==='chat' && b.stream===true){
    countTraffic('foreground');const input={id:'user-'+b.requestId,role:'user',content:b.message};
    const content=instantConversation(b.message)?.text||(isGreetingOnly(b.message)?'¡Hola! ¿En qué te ayudo?':'Almendras: 31 unidades en el local de prueba.');
    messages=[...messages,input,{id:'assistant-'+b.requestId,role:'assistant',content}];
    return new Response(new ReadableStream({start(controller){for(const event of [{type:'accepted',conversationId,message:input},{type:'completed',result:{...state(),telemetry:{route:instantConversation(b.message)?'instant':'quick-read',modelCalls:0,toolCalls:instantConversation(b.message)?0:1}}}])controller.enqueue(streamFrame(event));controller.close();}}),{headers:{'content-type':'text/event-stream'}});
  }
  if (b.operation === 'history') {
    if (params.has('layoutSample') && b.conversationId) return Response.json({ selectedConversation: { messages: [], nextCursor: null } });
    if (b.conversationId) return Response.json({ selectedConversation: { messages: Array.from({ length: 20 }, (_, i) => ({ id: 'archived-'+i, role: i % 2 ? 'assistant' : 'user', content: 'Mensaje anterior sintético ' + (i + 1) + '. Historial de prueba para verificar scroll sin botones.' })), nextCursor: null } });
    return Response.json({ conversations: [{ id: conversationId, title: 'Conversación de prueba', updatedAt: new Date().toISOString() }], conversationsCursor: null });
  }
  if (b.operation === 'startChat') {
    if (!jobs.has(b.requestId)) jobs.set(b.requestId, { ...b, started: Date.now(), input: { id: 'user-'+b.requestId, role: 'user', content: b.message } });
    return Response.json({ jobId: b.requestId, conversationId });
  }
  if (b.operation === 'cancelChat') { jobs.get(b.jobId).cancelled = true; return Response.json({ cancelled: true }); }
  if (b.operation === 'chatStatus') {
    const j = jobs.get(b.jobId), elapsed = Date.now() - j.started, duration = /lenta/i.test(j.message) ? 25000 : 700;
    if (j.cancelled) return Response.json({ status: 'cancelled', text: '' });
    if (elapsed >= duration && /error/i.test(j.message)) return Response.json({ status: 'failed', text: '', failure: { code: 'fixture-failure', message: 'La consulta de prueba falló. Podés volver a intentarlo.' } });
    const content = isGreetingOnly(j.message) ? '¡Hola! ¿En qué te ayudo?' : 'Todo listo. Podés consultar stock, preparar operaciones y revisar cada cambio antes de confirmarlo.';
    if (elapsed >= duration && !j.saved) { messages = [...messages, j.input, { id: 'assistant-'+b.jobId, role: 'assistant', content }]; j.saved = true;
      if (/preparar/i.test(j.message)) pendingAction = { id: 'synthetic-confirmation', confirmationToken: 'synthetic-token', summary: 'Mover 2 unidades al local de prueba.', expiresAt: new Date(Date.now()+60000).toISOString() };
    }
    const spoken = j.inputMode === 'natural-voice' ? 'Todo listo. Te escucho.' : '';
    return Response.json({ status: elapsed >= duration ? 'completed' : 'running', phase: 'Pensando…', text: elapsed > duration / 2 ? content.slice(0, 25) : '', accepted: j.input, conversationId, voiceText: elapsed >= duration ? spoken : '', result: { ...state(), spokenText: spoken } });
  }
  if (['confirm', 'cancel'].includes(b.operation)) { pendingAction = null; return Response.json(state()); }
  return Response.json({});
} });
