import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fixture, start, textResponse } from './helpers/olivia-fixture.mjs';
import { speechClips, speechTemplates, isGreetingOnly, chooseLocalGreeting, eligibleSpeechClips, voiceVersion } from '../src/shared/oliviaFastSpeech.mjs';
import { speechBuildPlan, buildSpeechLibrary } from '../scripts/build-olivia-speech-library.mjs';
import { fastSpeechRoute, validateFastSpeech, authenticatedFirstName } from '../netlify/functions/_lib/olivia/fastSpeech.mjs';
import { personalizedSpeech } from '../netlify/functions/_lib/olivia/speechAudio.mjs';
import { liveTranscriptionSession } from '../netlify/functions/_lib/olivia/liveTranscription.mjs';
import { startChatJob } from '../netlify/functions/_lib/olivia/chatJobs.mjs';
import { LiveTranscription } from '../src/gestion/olivia/liveTranscription.mjs';
import { SpeechClipCache } from '../src/gestion/olivia/speechClips.mjs';
import { FastSpeechPlayer } from '../src/gestion/olivia/fastSpeechPlayer.mjs';
import { createOliviaEngine } from '../netlify/functions/_lib/olivia/engine.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const voice={voice:'es-US-Chirp3-HD-Aoede',speakingRate:1};
const next=()=>new Promise(resolve=>setImmediate(resolve));
async function setup() {const f=fixture({role:'admin'});f.session.email='agsreserva@gmail.com';const {conversationId}=await start(f);return {...f,conversationId};}

test('100 supplied phrases are unique; a combined greeting never shortcuts a business request',()=>{
  assert.equal(speechClips.length,90);assert.equal(speechTemplates.length,10);
  assert.equal(new Set([...speechClips,...speechTemplates].map(x=>x.id)).size,100);
  for(const text of ['Hola','¡Hola, Olivia!','Buenas tardes','Hola, ¿cómo va?'])assert.ok(isGreetingOnly(text));
  for(const text of ['Hola, revisame las ventas','Hola Olivia no cargues stock','Hola y cargame un cliente','cargame stock'])assert.equal(chooseLocalGreeting(text),null);
  assert.equal(eligibleSpeechClips({finalized:false,intent:'greeting'}).length,0);
  assert.equal(eligibleSpeechClips({finalized:true,intent:'stock',answerReady:true,processingActive:true}).length,0);
  const before=eligibleSpeechClips({finalized:true,intent:'stock'});assert.equal(before.length,0);
  const active=eligibleSpeechClips({finalized:true,intent:'stock',processingActive:true});assert.ok(active.every(x=>x.category==='espera_real'));
  assert.ok(eligibleSpeechClips({finalized:true,intent:'stock',processingActive:true,toolQuery:'stock'}).some(x=>x.category==='stock_en_curso'));
  assert.equal(eligibleSpeechClips({finalized:true,missingSlot:'location',availableSlots:['location']}).length,0);
  assert.equal(eligibleSpeechClips({finalized:true,missingSlot:'location'}).length,2);
  assert.ok(!eligibleSpeechClips({finalized:true,intent:'greeting',recent:['saludo_01']}).some(x=>x.id==='saludo_01'));
});

test('a simple spoken greeting persists history without a model call or dropping the saved task',async()=>{
  const f=await setup(),saved=f.documents.get(`oliviaConversations/${f.conversationId}`);saved.taskState={id:'task',intent:'prepare_stock_load',status:'collecting',slots:{productId:'oil'},missingFields:['locationId','quantity'],revision:1};
  let calls=0;
  const engine=createOliviaEngine({store:f.store,clock:f.clock,env:{OPENAI_API_KEY:'fixture',GOOGLE_APPLICATION_CREDENTIALS:'/fixture-only'},provider:async()=>{calls++;return textResponse('Ventas de prueba');}});
  const greeting=await engine.chat(f.session,{conversationId:f.conversationId,requestId:'hi',message:'Hola',inputMode:'natural-voice'});
  assert.equal(calls,0);assert.match(greeting.messages.at(-1).content,/Hola/);assert.equal(f.documents.get(`oliviaConversations/${f.conversationId}`).taskState.slots.productId,'oil');
  f.documents.get(`oliviaConversations/${f.conversationId}`).taskState=null;
  f.advance(2000);
  await engine.chat(f.session,{conversationId:f.conversationId,requestId:'combined',message:'Hola, revisame las ventas',inputMode:'natural-voice'});assert.ok(calls>0);
});

test('paid batch generation requires the exact reviewed plan and resumes only verified audio',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'olivia-clips-'));let calls=0;
  try {
    const plan=speechBuildPlan(voice);assert.equal(plan.characters,2699);assert.equal(plan.estimatedCostUsd,.08097);
    const dry=await buildSpeechLibrary({config:voice,outputRoot:directory});assert.equal(dry.ready,0);assert.equal(dry.generated,0);
    const synthesize=async()=>{calls++;return Buffer.alloc(4800);};
    await assert.rejects(buildSpeechLibrary({config:voice,outputRoot:directory,execute:true,approvalHash:'wrong',synthesize}),/autorización/);assert.equal(calls,0);
    const built=await buildSpeechLibrary({config:voice,outputRoot:directory,execute:true,approvalHash:plan.approvalHash,synthesize});assert.equal(built.ready,90);assert.equal(calls,90);
    const manifest=JSON.parse(await readFile(built.manifestPath));assert.equal(manifest.entries[0].durationMs,100);assert.match(manifest.entries[0].checksum,/^[a-f0-9]{64}$/);
    await buildSpeechLibrary({config:voice,outputRoot:directory,execute:true,approvalHash:plan.approvalHash,synthesize});assert.equal(calls,90);
    await writeFile(path.join(directory,plan.voiceVersion,'saludo_01.pcm'),Buffer.from([1,2]));
    await buildSpeechLibrary({config:voice,outputRoot:directory,execute:true,approvalHash:plan.approvalHash,synthesize});assert.equal(calls,91);
  } finally {assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('olivia-clips-'));await rm(directory,{recursive:true,force:true});}
});

test('selector rejects invented clips/text, uses server identity, NONE and no tools',async()=>{
  const f=await setup(),{jobId}=await startChatJob({store:f.store,engine:f.engine,session:f.session,body:{conversationId:f.conversationId,requestId:'main',message:'Hola, revisame el stock'},dispatch:async()=>{},now:f.clock()});
  const provider=async(_path,request)=>{assert.equal(request.model,'gpt-6-luna');assert.equal(request.reasoning.effort,'none');assert.equal(request.tools,undefined);assert.equal(request.text.format.strict,true);return textResponse(JSON.stringify({mode:'clip',clip_id:'stock_en_curso_01',text:'Ya cargué 100 unidades',intent:'stock',requires_reply:false}));};
  const result=await fastSpeechRoute({session:f.session,store:f.store,engine:f.engine,body:{conversationId:f.conversationId,jobId,requestId:'selector'},provider,now:f.clock()});assert.equal(result.mode,'silence');
  assert.equal(authenticatedFirstName({...f.session,profile:{name:'Ana Test'}}),'Ana');assert.equal(authenticatedFirstName({...f.session,profile:{name:'<script>hack'}}),'');
  const candidate=speechClips.find(x=>x.id==='espera_real_01');
  const safe=validateFastSpeech({mode:'clip',clip_id:candidate.id,text:'Ya está cobrado',intent:'stock',requires_reply:true},{candidates:[candidate],intent:'stock'});
  assert.equal(safe.text,candidate.text);assert.equal(safe.requires_reply,false);
  assert.equal(validateFastSpeech({mode:'brief',clip_id:null,text:'Vendimos 500',intent:'stock',requires_reply:false},{candidates:[],intent:'stock'}).mode,'silence');
});

test('completed or superseded main work defeats a slow selector and no cross-user job is read',async()=>{
  const f=await setup(),{jobId}=await startChatJob({store:f.store,engine:f.engine,session:f.session,body:{conversationId:f.conversationId,requestId:'main',message:'Revisame ventas'},dispatch:async()=>{},now:f.clock()});
  const provider=async()=>{f.documents.get(`oliviaChatJobs/${jobId}`).status='completed';return textResponse(JSON.stringify({mode:'clip',clip_id:'espera_real_01',text:'',intent:'sales',requires_reply:false}));};
  const result=await fastSpeechRoute({session:f.session,store:f.store,engine:f.engine,body:{conversationId:f.conversationId,jobId,requestId:'selector'},provider,now:f.clock()});assert.equal(result.mode,'silence');
  f.documents.get(`oliviaChatJobs/${jobId}`).userId='another-user';
  await assert.rejects(fastSpeechRoute({session:f.session,store:f.store,engine:f.engine,body:{conversationId:f.conversationId,jobId,requestId:'other'},provider,now:f.clock()}),error=>error.code==='chat-job-not-found');
});

test('clarification uses authoritative task slots and never asks again for a location in context',async()=>{
  for(const context of [{},{locationId:'local_a'}]) {
    const f=await setup(),{jobId}=await startChatJob({store:f.store,engine:f.engine,session:f.session,body:{conversationId:f.conversationId,requestId:'main',message:'Cargame stock',screenContext:context},dispatch:async()=>{},now:f.clock()});
    f.documents.get(`oliviaConversations/${f.conversationId}`).taskState={intent:'prepare_stock_load',status:'collecting',slots:{productId:'oil'},missingFields:['locationId','quantity']};
    const provider=async()=>textResponse(JSON.stringify({mode:'clarify',clip_id:'aclaracion_condicional_02',text:'',intent:'stock',requires_reply:true}));
    const result=await fastSpeechRoute({session:f.session,store:f.store,engine:f.engine,body:{conversationId:f.conversationId,jobId,requestId:'selector'},provider,now:f.clock()});
    assert.equal(result.mode,context.locationId?'silence':'clarify');
    if(!context.locationId)assert.match(result.text,/ubicación/);
  }
});

test('personalized cache takes the authenticated name, reuses PCM, and never returns another user audio',async()=>{
  const f=await setup();let calls=0,spoken='';
  const synthesize=async({request})=>{calls++;spoken=(await request.json()).text;return new Response(Buffer.alloc(4800));};
  const request=new Request('https://preview.test/audio'),body={operation:'prepare',clipId:'personalizada_01',conversationId:f.conversationId,requestId:'private',firstName:'Wrong'};
  const args={session:f.session,store:f.store,engine:f.engine,body,request,synthesize,now:f.clock()};
  assert.equal((await personalizedSpeech(args)).status,204);assert.equal(calls,1);assert.match(spoken,/Ana/);assert.doesNotMatch(spoken,/Wrong/);
  const cached=await personalizedSpeech({...args,body:{...body,operation:'get'}});assert.equal((await cached.arrayBuffer()).byteLength,4800);assert.equal(cached.headers.get('cache-control'),'no-store');
  await personalizedSpeech(args);assert.equal(calls,1);
  await assert.rejects(personalizedSpeech({...args,session:{...f.session,uid:'another-user'}}),error=>error.code==='conversation-not-found');
  f.session.profile.name='Beatriz';await personalizedSpeech({...args,body:{...body,requestId:'private-2'}});assert.equal(calls,2);assert.match(spoken,/Beatriz/);
});

test('live transcription is transcription-only, idempotent, bounded and closed on the server',async()=>{
  const f=await setup();let starts=0,stops=0;
  const fetchImpl=async(url,request)=>{
    if(url.endsWith('/hangup')){stops++;return new Response(null,{status:200});}
    starts++;const config=JSON.parse(request.body.get('session'));assert.equal(config.type,'transcription');assert.equal(config.audio.input.transcription.model,'gpt-live-transcribe');assert.equal(config.audio.input.turn_detection,null);assert.deepEqual(config.audio.input.transcription.languages,['es']);assert.equal(config.tools,undefined);
    return new Response('v=0\nanswer',{headers:{location:'https://api.openai.com/v1/realtime/calls/rtc_fixture'}});
  };
  const body={operation:'start',conversationId:f.conversationId,requestId:'live-1',sdp:'v=0\noffer'},args={session:f.session,store:f.store,engine:f.engine,env:{OPENAI_API_KEY:'fixture'},body,fetchImpl,now:f.clock()};
  const result=await liveTranscriptionSession(args);assert.equal(result.maxSessionSeconds,180);assert.equal(result.sdp,'v=0\nanswer');
  await liveTranscriptionSession(args);assert.equal(starts,1);
  await assert.rejects(liveTranscriptionSession({...args,body:{...body,requestId:'live-2'}}),error=>error.code==='voice-session-active');
  const closed=await liveTranscriptionSession({...args,body:{...body,operation:'stop'},now:new Date(f.clock().getTime()+30000)});assert.equal(stops,1);assert.equal(closed.estimatedSeconds,30);
  await liveTranscriptionSession({...args,body:{...body,requestId:'live-2'},now:new Date(f.clock().getTime()+31000)});assert.equal(starts,2);
  await assert.rejects(liveTranscriptionSession({...args,session:{...f.session,email:'other@example.test'}}),error=>error.code==='voice-not-enabled');
});

test('live data reconciles finals by item_id out of order and never treats a partial as a final',async()=>{
  const sent=[],partials=[];let originalStops=0,cloneStops=0,stopped=0;
  class Peer {
    createDataChannel(){return this.channel={readyState:'open',send:value=>sent.push(JSON.parse(value)),close(){}};}
    addTrack(track){this.track=track;}
    async createOffer(){return {sdp:'v=0\noffer'};} async setLocalDescription(){} async setRemoteDescription(){this.channel.onmessage({data:JSON.stringify({type:'session.created'})});}close(){}
  }
  const original={enabled:true,stop(){originalStops++;},clone:()=>({enabled:true,stop(){cloneStops++;}})};
  const live=new LiveTranscription({Peer,connect:async()=>({sdp:'v=0\nanswer',maxSessionSeconds:180}),stop:async()=>stopped++,onPartial:text=>partials.push(text)});
  await live.start({getAudioTracks:()=>[original]});live.beginTurn();
  live.receive({type:'conversation.item.input_audio_transcription.delta',item_id:'a',delta:'Hola'});assert.equal(partials.at(-1),'Hola');
  const a=live.commit(),b=live.commit();
  live.receive({type:'input_audio_buffer.committed',item_id:'a'});live.receive({type:'input_audio_buffer.committed',item_id:'b'});
  live.receive({type:'conversation.item.input_audio_transcription.completed',item_id:'b',transcript:'Cliente'});
  live.receive({type:'conversation.item.input_audio_transcription.completed',item_id:'a',transcript:'Stock'});
  assert.equal((await a).text,'Stock');assert.equal((await b).text,'Cliente');
  live.beginTurn();assert.equal(live.track.enabled,true);live.discardTurn();assert.equal(live.track.enabled,false);assert.equal(original.enabled,true);
  assert.equal(sent.filter(x=>x.type==='input_audio_buffer.commit').length,2);assert.equal(original.enabled,true);
  const pending=live.commit();live.close();await assert.rejects(pending,{name:'AbortError'});await next();assert.equal(stopped,1);assert.equal(cloneStops,1);assert.equal(originalStops,0);
});

test('clip warmup loads only three common clips, verifies checksums and avoids per-play TTS',async()=>{
  const bytes=Buffer.alloc(4800),version=voiceVersion(voice),fetched=[];
  const entries=['saludo_01','espera_real_01','espera_real_02'].map(id=>({id,status:'ready',url:`/olivia-speech/${version}/${id}.pcm`,codec:'pcm_s16le',sampleRate:24000,checksum:sha(bytes)}));
  const cache=new SpeechClipCache({voice,userId:'a',privateAudio:async()=>new Response(null,{status:404}),preparePrivate:()=>assert.fail('Warmup must never synthesize private audio'),digest:async value=>sha(Buffer.from(value)),fetchImpl:async url=>{fetched.push(url);return url.endsWith('manifest.json')?Response.json({voiceVersion:version,libraryVersion:'1.0.0',entries}):new Response(bytes);}});
  await cache.warm();assert.equal(fetched.length,4);await cache.get('saludo_01');await cache.get('saludo_01');assert.equal(fetched.length,4);
  assert.equal(await cache.get('missing'),null);cache.dispose();assert.equal(await cache.get('saludo_01'),null);
  const corrupt=new SpeechClipCache({voice,userId:'b',digest:async()=> 'wrong',fetchImpl:async url=>url.endsWith('manifest.json')?Response.json({voiceVersion:version,libraryVersion:'1.0.0',entries}):new Response(bytes)});
  assert.equal(await corrupt.get('saludo_01'),null);corrupt.dispose();
});

test('fast greeting is local, partials only prefetch, and a ready main answer cancels intermediate audio',async()=>{
  const callbacks=[],played=[],prefetched=[];let resolveClip,current=true,selected=0;
  const cache={warm:async()=>{},manifest:async()=>({entries:[{status:'ready'}]}),get:async id=>prefetched.push(id),response:async()=>new Response(new Uint8Array([0,0])),dispose(){}};
  const player=new FastSpeechPlayer({cache,select:async()=>{selected++;return {mode:'clip',clip_id:'espera_real_01',intent:'stock'};},loadFallback:()=>assert.fail('No TTS on cached playback'),play:async(_r,options)=>played.push(options),setTimer:fn=>{callbacks.push(fn);return callbacks.length;},clearTimer(){}});
  player.anticipate('Hola');assert.equal(played.length,0);assert.equal(prefetched[0],'saludo_01');
  assert.equal(await player.greeting('Hola'),true);assert.equal(selected,0);assert.equal(played.length,1);
  player.start(()=>current,{text:'Stock',jobId:'job'});await callbacks[0]();assert.equal(selected,1);assert.equal(played.length,2);
  cache.response=()=>new Promise(resolve=>{resolveClip=resolve;});player.start(()=>current,{text:'Ventas',jobId:'other'});const pending=callbacks[2]();await next();current=false;resolveClip(new Response(new Uint8Array([0,0])));await pending;assert.equal(played.length,2);player.dispose();
});
