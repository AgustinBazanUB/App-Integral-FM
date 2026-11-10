import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,start,textResponse} from './helpers/olivia-fixture.mjs';
import {createOliviaEngine} from '../netlify/functions/_lib/olivia/engine.mjs';
import {instantConversation,isConversationalFollowUp,quickReadPlan,classifyGeminiLiveTurn} from '../src/shared/oliviaConversationRouter.mjs';

test('a bounded conversational preface keeps a simple read fast without dropping mutations or negations',()=>{
  assert.equal(quickReadPlan('Esperá, primero decime cuánto vendimos hoy')?.kind,'today-sales');
  assert.equal(quickReadPlan('Pará un segundo, primero decime cuánto vendimos ayer')?.kind,'yesterday-sales');
  for(const text of ['Esperá, primero decime cuánto vendimos hoy y cargá diez botellas','No, primero decime cuánto vendimos hoy','Primero decime cuánto vendimos hoy y después transferí stock'])assert.equal(quickReadPlan(text),null,text);
});
import {endpointingWindow} from '../src/gestion/olivia/endpointing.mjs';
import {latencyTrace} from '../src/shared/oliviaLatencyTrace.mjs';
import {routeModel} from '../netlify/functions/_lib/olivia/modelRouter.mjs';
import {defaultOliviaConfiguration,validateConfiguration} from '../src/shared/oliviaContracts.mjs';
import {LiveTranscription} from '../src/gestion/olivia/liveTranscription.mjs';
import {latencyCases} from './fixtures/olivia-latency-cases.mjs';
import {NaturalVoiceConversation} from '../src/gestion/olivia/naturalVoice.mjs';
import {measuredVoice,measureEndpoint} from './helpers/olivia-latency-voice.mjs';

for(const entry of latencyCases)test('endpointing y ruta: '+entry.text,()=>{
  const window=endpointingWindow({partial:entry.text,stableMs:400});
  if(entry.kind==='instant'){assert.ok(instantConversation(entry.text));assert.ok(window<=entry.maxWindow);}
  if(entry.kind==='read'){assert.ok(quickReadPlan(entry.text));assert.ok(window<=entry.maxWindow);}
  if(entry.kind==='controlled'){assert.equal(instantConversation(entry.text),null);assert.equal(quickReadPlan(entry.text),null);}
  if(entry.kind==='unfinished')assert.ok(window>=entry.minWindow);
});
test('contextual conversation follow-ups use the short but safe endpoint window',()=>{
  const text='¿Te acordás de lo que te pregunté recién?';
  assert.equal(isConversationalFollowUp(text),true);
  assert.equal(endpointingWindow({partial:text,stableMs:400}),500);
  assert.equal(isConversationalFollowUp('¿Qué precio me dijiste recién para el aceite?'),false);
});
async function voiceFixture(){
  const f=fixture({role:'admin'});f.session.email='agsreserva@gmail.com';f.config.hybridVoice.enabled=true;f.documents.set('oliviaConfiguration/global',f.config);const {conversationId}=await start(f);let calls=0;
  const engine=createOliviaEngine({store:f.store,clock:f.clock,env:{OPENAI_API_KEY:'fixture',CONTEXT:'deploy-preview',OLIVIA_DEPLOY_PREVIEW_CONTEXT:'deploy-preview',OLIVIA_HYBRID_LIVE_ENABLED:'true',GEMINI_API_KEY:'synthetic-preview-key',GEMINI_API_BILLING_TIER:'paid',FIREBASE_PROJECT_ID:'app-integral-fm-pruebas'},provider:async(_path,body)=>{calls++;assert.equal(body.reasoning.effort,'none');return textResponse('Respuesta de prueba');}});
  f.documents.set('products/almonds',{name:'Almendras',active:true,defaultPrice:1500});f.documents.set('locations/local_a',{name:'Tribunales',active:true});f.documents.set('locationStock/local_a/items/almonds',{productName:'Almendras',productId:'almonds',currentStock:31,active:true});
  const turn=(message,id,extra={})=>{f.advance(2000);return engine.chat(f.session,{message,conversationId,requestId:id,inputMode:'natural-voice',foreground:true,screenContext:{module:'locations',locationId:'local_a'},...extra});};
  return {...f,engine,conversationId,turn,calls:()=>calls};
}
test('Gemini Live directly answers wellbeing and persists it without a model call',async()=>{
  const f=await voiceFixture(),saved=f.documents.get('oliviaConversations/'+f.conversationId);saved.taskState={id:'task',intent:'prepare_stock_load',status:'collecting',slots:{productId:'almonds'},missingFields:['quantity','locationId'],revision:1};
  assert.equal(classifyGeminiLiveTurn('Olivia, ¿cómo estás?').route,'direct');
  const result=await f.engine.recordGeminiDirectTurn(f.session,{conversationId:f.conversationId,requestId:'wellbeing',userText:'Olivia, ¿cómo estás?',assistantText:'¡Bien! ¿Y vos?'});
  assert.equal(result.messages.at(-1).content,'¡Bien! ¿Y vos?');assert.equal(f.calls(),0);
  const persisted=f.documents.get('oliviaConversations/'+f.conversationId);assert.ok(persisted.taskState?.slots.productId==='almonds'||persisted.suspendedTasks?.some(t=>t.slots.productId==='almonds'));
});
test('stock and price use fresh authorized data, no LLM, and no stock mutations',async()=>{
  const f=await voiceFixture();const first=await f.turn('¿Cuántas almendras quedan?','stock');assert.match(first.spokenText,/31 unidades en Tribunales/);assert.equal(first.telemetry.modelCalls,0);
  f.documents.get('locationStock/local_a/items/almonds').currentStock=17;
  const second=await f.turn('Stock de almendras','stock2');assert.match(second.spokenText,/17 unidades/);
  const price=await f.turn('Precio de almendras','price');assert.match(price.spokenText,/1\.500/);assert.equal(f.calls(),0);assert.equal(f.documents.get('locationStock/local_a/items/almonds').currentStock,17);
});
test('cuánto stock de a named product does not search for stock as part of its name',async()=>{
  const f=await voiceFixture();
  const result=await f.turn('¿Cuánto stock de almendras hay en Tribunales?','stock-quantity');
  assert.match(result.spokenText,/31 unidades en Tribunales/);
  assert.equal(f.calls(),0);
  assert.equal(f.documents.get('locationStock/local_a/items/almonds').currentStock,31);
  assert.equal(quickReadPlan('¿Cuánto stock de almendras hay y cargá 30 más?'),null);
});
test('starting a stock task asks all missing fields together and keeps the selected location',async()=>{
  const f=await voiceFixture(),result=await f.turn('Cargame stock','start-stock');assert.match(result.spokenText,/producto.*cuántas unidades/);assert.doesNotMatch(result.spokenText,/ubicación/);assert.equal(f.documents.get('oliviaConversations/'+f.conversationId).taskState.slots.locationId,'local_a');assert.equal(f.calls(),0);
});
test('ambiguous products and missing locations ask without guessing, and reads cannot escape a seller location',async()=>{
  const f=await voiceFixture();f.documents.set('products/almonds2',{name:'Almendras tostadas',active:true,defaultPrice:2000});f.documents.set('locationStock/local_a/items/almonds2',{productName:'Almendras tostadas',currentStock:5,active:true});
  f.documents.get('products/almonds').name='Almendras Guara';f.documents.get('locationStock/local_a/items/almonds').productName='Almendras Guara';
  const ambiguous=await f.turn('Stock de almendras','ambiguous');assert.equal(ambiguous.state,'DATOS_INCOMPLETOS');assert.match(ambiguous.spokenText,/presentación/);assert.doesNotMatch(ambiguous.spokenText,/31 unidades/);
  const seller=fixture({role:'seller'}),{conversationId}=await start(seller);
  await assert.rejects(seller.engine.chat(seller.session,{message:'Stock de almendras',requestId:'forbidden',conversationId,screenContext:{module:'locations',locationId:'local_b'}}),error=>['permission-denied','location-unavailable'].includes(error.code));
});
test('contacting an existing client never starts an add-client task or demands a phone to search by name',async()=>{
  const f=await voiceFixture();f.documents.set('customers/juan',{name:'Juan de prueba',phone:'1122334455',phoneNormalized:'1122334455',zoneName:'Zona sintética',updatedAt:f.clock()});
  const question=await f.turn('Quiero hablar con un cliente','contact');assert.match(question.spokenText,/nombre o el teléfono/);assert.notEqual(f.documents.get('oliviaConversations/'+f.conversationId).taskState?.intent,'prepare_customer_create');
  const found=await f.turn('Buscame el cliente Juan','by-name');assert.match(found.spokenText,/Juan de prueba/);assert.equal(f.calls(),0);assert.equal([...f.documents.keys()].filter(p=>p.startsWith('customers/')).length,1);
});
test('a conversation response or a spoken yes cannot execute or invalidate a pending proposal',async()=>{
  const f=await voiceFixture();const prepared=await f.turn('Cargame 20 unidades de almendras','prepare');assert.ok(prepared.pendingAction);
  const wellbeing=await f.engine.recordGeminiDirectTurn(f.session,{conversationId:f.conversationId,requestId:'during-proposal',userText:'¿Cómo estás?',assistantText:'¡Bien! ¿Y vos?'});assert.equal(wellbeing.pendingAction.id,prepared.pendingAction.id);
  const yes=await f.turn('Sí','spoken-yes');assert.equal(yes.pendingAction.id,prepared.pendingAction.id);assert.equal(f.documents.get('locationStock/local_a/items/almonds').currentStock,31);
});
test('an obsolete foreground request cannot cancel a newer one, and cancelling before claim prevents a late response',async()=>{
  const f=await voiceFixture(),path='oliviaConversations/'+f.conversationId;
  f.documents.get(path).busyRequestId='newer';f.documents.get(path).busyUntil=new Date(f.clock().getTime()+10000);
  await f.engine.invalidateTask(f.session,f.conversationId,'older');assert.equal(f.documents.get(path).busyRequestId,'newer');
  f.documents.get(path).busyRequestId=null;f.documents.get(path).busyUntil=null;
  await assert.rejects(f.turn('¿Cómo estás?','older'),{code:'request-already-used'});
  assert.ok(!f.documents.get(path).messages.some(m=>m.role==='assistant'&&m.content==='¡Bien! ¿Y vos?'));
});
test('feature flag restores legacy endpointing and effort; delay is restricted to supported values',()=>{
  const config=defaultOliviaConfiguration();config.conversationLatency.enabled=false;
  assert.equal(routeModel(config,{profile:{role:'admin'}},{message:'Stock de almendras'}).reasoningEffort,'high');assert.equal(endpointingWindow({partial:'Hola',enabled:false}),1900);
  assert.equal(endpointingWindow({partial:'carga aceite de',enabled:false}),4000);
  assert.throws(()=>validateConfiguration({...config,conversationLatency:{enabled:true,transcriptionDelay:'server_vad'}}));
});
test('trace drops arbitrary fields and sensitive strings while keeping independent request clocks',()=>{
  let now=100;const trace=latencyTrace({id:'turn',now:()=>now});trace.bindRequest('request');trace.mark('router.start',{route:'instant',phone:'1122334455',text:'texto privado',model:'malformed model value'});now=140;const result=trace.snapshot();assert.equal(result.elapsedMs,40);assert.equal(result.requestId,'request');assert.deepEqual(result.events,[{stage:'router.start',ms:0,route:'instant'}]);
});
test('final arriving before committed is correlated by item id and is never lost or confused with the next turn',async()=>{
  const live=new LiveTranscription({connect:async()=>{},stop:async()=>{}});live.channel={readyState:'open',send(){},close(){}};live.track={enabled:true,stop(){}};
  const pending=live.commit();live.receive({type:'conversation.item.input_audio_transcription.completed',item_id:'one',transcript:'hola'});live.receive({type:'input_audio_buffer.committed',item_id:'one'});assert.equal((await pending).text,'hola');
  live.beginTurn();live.receive({type:'conversation.item.input_audio_transcription.delta',item_id:'one',delta:'texto viejo'});assert.equal(live.partial,'');live.close();
});
test('the actual microphone loop closes a complete greeting early but keeps a paused product list in one turn',async()=>{
  const greeting=await measureEndpoint(NaturalVoiceConversation,'Olivia, ¿cómo estás?');assert.ok(greeting.silenceMs<=550);
  const f=measuredVoice(NaturalVoiceConversation,{text:'Cargá 20 de Arbequina y 10 de Arbosana'});await f.voice.start();f.tick(100,.1);f.tick(300,.1,'Cargá 20 de Arbequina y');f.tick(1800,0);assert.equal(f.voice.recordingTurn,true);f.tick(1850,.1,'Cargá 20 de Arbequina y 10 de Arbosana');f.tick(3300,0);assert.equal(f.voice.recordingTurn,true);f.voice.finishTurn();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.turns.length,1);f.voice.close();
});
test('renewing an expiring live window waits for its quota lease to close and reuses the authorized microphone',async()=>{
  const order=[],stream={id:'same-authorized-stream',getAudioTracks:()=>[],getTracks:()=>[]},next={close(){order.push('next-close');}};
  const voice=new NaturalVoiceConversation({cancelFrame(){},createTranscriber:async source=>{assert.equal(source,stream);order.push('connect');return next;}});
  voice.stream=stream;voice.transcriber={renewalDue:true,close(){order.push('close');this.stopping=Promise.resolve().then(()=>order.push('lease-released'));}};
  await voice.renewTranscription();assert.deepEqual(order,['close','lease-released','connect']);assert.equal(voice.transcriber,next);voice.close();
});
