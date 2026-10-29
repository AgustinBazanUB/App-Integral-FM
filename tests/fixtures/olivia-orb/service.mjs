import { createOliviaTransport } from '../../../src/gestion/olivia/client.mjs';
import { voiceVersion, chooseLocalGreeting } from '../../../src/shared/oliviaFastSpeech.mjs';
const params=new URLSearchParams(location.search);
export const qaTraffic={live:0,transcribe:0,tts:0,selector:0,private:0,clips:0};
export const countTraffic=kind=>{qaTraffic[kind]++;window.dispatchEvent(new Event('olivia:qa-traffic'));};
const conversationId = 'a1234567-1234-4234-8234-123456789012';
let messages = [], pendingAction = null;
const jobs = new Map();
const state = () => ({ conversationId, messages, pendingAction, enabled: true, providerConfigured: true, googleTtsConfigured: true, voiceConversationAvailable: !params.has('voiceDisabled'), audioLimits: { maxSeconds: 60, maxBytes: 4194304 }, voiceSettings: { turnEndSilenceMs: 1900,voice:'es-US-Chirp3-HD-Aoede',speakingRate:1,...(params.has('live')?{transcriptionModel:'gpt-live-transcribe'}:{}) }, state: pendingAction ? 'ESPERANDO_CONFIRMACION' : 'INFORMACION', usage: { unlimited: true }, estimate: null });
export const oliviaClient = createOliviaTransport({ getToken: async () => 'synthetic-only', pollIntervalMs: 200, fetchImpl: async (url, init) => {
  if(url.includes('live-transcribe')) {
    countTraffic('live');
    const body=JSON.parse(init.body);
    if(params.has('liveError'))return Response.json({message:'Fallo sintético de Live'},{status:503});
    return Response.json(body.operation==='start'?{sdp:'v=0\nsynthetic',requestId:body.requestId,maxSessionSeconds:180}:{closed:true,recorded:true});
  }
  if(url.includes('fast-speech')){countTraffic('selector');return Response.json({mode:'clip',clip_id:'espera_real_01',text:'Un segundo, lo reviso.',intent:'sales',requires_reply:false,voiceVersion:voiceVersion({voice:'es-US-Chirp3-HD-Aoede',speakingRate:1}),selectionMs:25,estimatedCostUsd:.0001});}
  if(url.includes('speech-audio')){countTraffic('private');return new Response(null,{status:JSON.parse(init.body).operation==='prepare'?204:404});}
  if (url.includes('synthesize')) {
    countTraffic('tts');
    const samples = new Int16Array(new URLSearchParams(location.search).has('longAudio') ? 288000 : 72000); for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 12) * 7000;
    return new Response(samples, { headers: { 'content-type': 'audio/pcm;rate=24000;channels=1' } });
  }
  if (url.includes('transcribe')) {countTraffic('transcribe');return Response.json({ text: new URLSearchParams(location.search).has('slowVoice') ? 'Consulta lenta de prueba de voz' : 'Hola Olivia, probemos la conversación.' });}
  const b = JSON.parse(init.body);
  if (['state', 'resume'].includes(b.operation)) return Response.json(state());
  if (b.operation === 'estimate') return Response.json({ estimate: null });
  if (b.operation === 'history') {
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
    const content = chooseLocalGreeting(j.message)?.text || 'Todo listo. Podés consultar stock, preparar operaciones y revisar cada cambio antes de confirmarlo.';
    if (elapsed >= duration && !j.saved) { messages = [...messages, j.input, { id: 'assistant-'+b.jobId, role: 'assistant', content }]; j.saved = true;
      if (/preparar/i.test(j.message)) pendingAction = { id: 'synthetic-confirmation', confirmationToken: 'synthetic-token', summary: 'Mover 2 unidades al local de prueba.', expiresAt: new Date(Date.now()+60000).toISOString() };
    }
    const spoken = j.inputMode === 'natural-voice' ? 'Todo listo. Te escucho.' : '';
    return Response.json({ status: elapsed >= duration ? 'completed' : 'running', phase: 'Pensando…', text: elapsed > duration / 2 ? content.slice(0, 25) : '', accepted: j.input, conversationId, voiceText: elapsed >= duration ? spoken : '', result: { ...state(), spokenText: spoken } });
  }
  if (['confirm', 'cancel'].includes(b.operation)) { pendingAction = null; return Response.json(state()); }
  return Response.json({});
} });
