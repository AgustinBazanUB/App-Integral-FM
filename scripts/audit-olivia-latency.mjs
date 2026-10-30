// Repeatable local measurements. Does not contact Google/OpenAI/Firebase.
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {NaturalVoiceConversation,latencyPercentile} from '../src/gestion/olivia/naturalVoice.mjs';
import {measureEndpoint} from '../tests/helpers/olivia-latency-voice.mjs';
import {latencyCases} from '../tests/fixtures/olivia-latency-cases.mjs';
import {fixture,start,textResponse,functionResponse} from '../tests/helpers/olivia-fixture.mjs';
import {createOliviaEngine} from '../netlify/functions/_lib/olivia/engine.mjs';
const baselineCommit='d2d36b8407cd5acf49e09754dd6d1a1a443d7839';
const source=execFileSync('git',['show',baselineCommit+':src/gestion/olivia/naturalVoice.mjs'],{encoding:'utf8'});
const {NaturalVoiceConversation:Previous}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const quantiles=values=>({count:values.length,p50:latencyPercentile(values,.5),p90:latencyPercentile(values,.9),p95:latencyPercentile(values,.95)});
const samples=[];
for(const entry of latencyCases){const before=await measureEndpoint(Previous,entry.text),after=await measureEndpoint(NaturalVoiceConversation,entry.text);samples.push({...entry,beforeSilenceMs:before.silenceMs,afterSilenceMs:after.silenceMs});}
const byFlow=Object.fromEntries(['instant','read','controlled','unfinished'].map(kind=>[kind,{before:quantiles(samples.filter(c=>c.kind===kind).map(c=>c.beforeSilenceMs)),after:quantiles(samples.filter(c=>c.kind===kind).map(c=>c.afterSilenceMs))}]));
const server=[];
for(const enabled of [false,true])for(let sample=0;sample<12;sample++){
  const f=fixture({role:'admin'});f.config.conversationLatency.enabled=enabled;f.session.email='agsreserva@gmail.com';
  f.documents.set('products/almonds',{name:'Almendras',active:true,defaultPrice:1500});f.documents.set('locations/local_a',{name:'Local sintético',active:true});f.documents.set('locationStock/local_a/items/almonds',{productName:'Almendras',productId:'almonds',currentStock:31,active:true});
  let calls=0;const engine=createOliviaEngine({store:f.store,clock:f.clock,env:{OPENAI_API_KEY:'synthetic-only',GOOGLE_APPLICATION_CREDENTIALS:'/fixture-only'},provider:async()=>++calls===1?functionResponse('get_stock',{productId:'almonds',locationId:'local_a'}):textResponse(JSON.stringify({complete:'Almendras: 31 unidades en Local sintético.',spoken:'Almendras: 31 unidades en Local sintético.'}))});
  const {conversationId}=await start(f),began=performance.now();const result=await engine.chat(f.session,{message:'Stock de almendras',requestId:'sample-'+sample,conversationId,inputMode:'natural-voice',screenContext:{module:'locations',locationId:'local_a'}});
  server.push({enabled,elapsedMs:performance.now()-began,modelCalls:calls,toolCalls:result.telemetry?.toolCalls});
}
const report={createdAt:new Date().toISOString(),baselineCommit,scope:'Local microphone/VAD simulation with actual before/after code; in-memory database and synthetic model responses. Not a real STT, network, hardware, or provider end-to-end latency measurement.',cases:latencyCases.length,samples,endpointing:byFlow,serverAdapter:{scope:'Wall-clock time in this computer, in-memory Firestore and model stubs',before:quantiles(server.filter(s=>!s.enabled).map(s=>s.elapsedMs)),after:quantiles(server.filter(s=>s.enabled).map(s=>s.elapsedMs)),beforeModelCalls:[...new Set(server.filter(s=>!s.enabled).map(s=>s.modelCalls))],afterModelCalls:[...new Set(server.filter(s=>s.enabled).map(s=>s.modelCalls))]},realEndToEnd:{p50:null,p90:null,p95:null,reason:'Requires real user audio, provider access and device trials; reported 3/7/10 seconds are user observations, not instrumented baseline samples.'},providerCost:{instantCachedTtsUsd:0,instantLlmUsd:0,typedReadLlmUsd:0,dynamicTtsUsdPerMillionCharacters:30,liveTranscriptionUsdPerMinute:.017,measuredLiveInvoiceUsd:null}};
const root='docs/olivia/2026-10-29/latencia-v3';await mkdir(root,{recursive:true});await writeFile(root+'/MEDICIONES.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({cases:report.cases,endpointing:report.endpointing,serverAdapter:report.serverAdapter},null,2));
