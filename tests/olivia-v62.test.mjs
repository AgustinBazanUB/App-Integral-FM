import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceVoiceCollection,collectionDecision,safeConversationBridge,collectionQuestion} from '../src/shared/oliviaVoiceCollection.mjs';
import {classifyGeminiLiveTurn} from '../src/shared/oliviaConversationRouter.mjs';
import {InteractionCosts,monthlyProviderSummary} from '../src/gestion/olivia/interactionCosts.mjs';
import {compactVoiceTask,taskOutcome} from '../src/shared/oliviaTaskConversation.mjs';
import {GeminiLiveSession} from '../src/gestion/olivia/geminiLive.mjs';
import {createOliviaEngine,dualVoiceResponse} from '../netlify/functions/_lib/olivia/engine.mjs';
import {fixture,start,textResponse} from './helpers/olivia-fixture.mjs';

test('stock collection preserves unverified parameters and social context before one handoff',()=>{
 let d=advanceVoiceCollection('Quiero cargar stock');assert.deepEqual(d.missingFields,['location','items-and-quantities']);assert.equal(collectionDecision('Quiero cargar stock').route,'direct');
 assert.equal(advanceVoiceCollection('Muchas gracias',d),null);assert.equal(classifyGeminiLiveTurn('¿Cuánto stock tenemos?',{voiceCollection:d}).route,'delegate');
 d=advanceVoiceCollection('En Local Lavalle',d);assert.equal(d.requestedLocation,'Lavalle');assert.deepEqual(d.missingFields,['items-and-quantities']);
 const ready=collectionDecision('Diez botellas de Arbequina y cinco de Coratina',{voiceCollection:d});assert.equal(ready.route,'delegate');assert.equal(ready.collection.itemsMentioned.length,2);assert.equal(ready.collection.validation,'unverified');assert.match(ready.request,/Lavalle/);assert.match(ready.request,/Diez botellas/);
 assert.deepEqual(advanceVoiceCollection('Diez botellas de Arbequina y cinco de Coratina',ready.collection),ready.collection,'same final transcript does not add another revision');
});

test('location dates do not become merchandise quantities and corrections replace a single item',()=>{
 let d=advanceVoiceCollection('Quiero cargar una unidad del producto de prueba');assert.equal(d.itemsMentioned.length,1);
 d=advanceVoiceCollection('Mejor cinco',d);assert.equal(d.itemsMentioned[0].quantityMentioned,'cinco');
 d=advanceVoiceCollection('En QA Envíos Preview veinte de octubre de dos mil veintiséis',d);assert.equal(d.itemsMentioned[0].quantityMentioned,'cinco');
 let empty=advanceVoiceCollection('Quiero cargar stock');empty=advanceVoiceCollection('En QA Envíos Preview 20 de octubre de 2026',empty);assert.deepEqual(empty.missingFields,['items-and-quantities']);
});

test('ambiguous product intake asks operation, cancellation stays unsubmitted and capabilities remain authoritative',()=>{
 let d=advanceVoiceCollection('Quiero cargar un producto');assert.equal(d.pendingQuestion,'operation');
 d=advanceVoiceCollection('Crear uno nuevo',d);assert.equal(d.pendingQuestion,'product-name');
 d=advanceVoiceCollection('Aceite de oliva',d);assert.equal(d.status,'ready');assert.equal(d.requestedProductName,'Aceite de oliva');
 const pending=advanceVoiceCollection('Quiero cargar stock');assert.equal(advanceVoiceCollection('No, dejá',pending).status,'cancelled');
 assert.equal(collectionDecision('Quiero cargar stock',{capabilities:['search_products']}),null);
 assert.equal(classifyGeminiLiveTurn('Quiero cargar stock y decime cuánto hay disponible').route,'delegate');
});

test('safe contextual categories allow varied questions and future intent but reject unverifiable claims',()=>{
 const location=advanceVoiceCollection('Quiero cargar stock');
 for(const text of ['Dale, perfecto. ¿En qué ubicación querés cargarlo?','Buenísimo, ¿dónde querés sumar la mercadería?','¿En qué local hacemos la carga?'])assert.ok(safeConversationBridge(text,{collection:location}),text);
 const items=advanceVoiceCollection('En Local Lavalle',location);assert.ok(safeConversationBridge('Perfecto, tomo Lavalle como ubicación solicitada. ¿Qué productos y cantidades querés sumar?',{collection:items}));
 for(const text of ['El local Lavalle existe. ¿Qué productos querés cargar?','Ya cargué cinco botellas. ¿Necesitás algo más?','El stock actual es 10.','Perfecto.'])assert.equal(safeConversationBridge(text,{collection:items}),false,text);
 for(const text of ['Voy a consultar las ventas y te cuento.','Perfecto, voy a preparar la comparación.','Dale, lo reviso.'])assert.ok(safeConversationBridge(text),text);
 for(const text of ['Ya estoy trabajando en eso.','Se cargó el stock.','Voy a revisar las ventas: son 5.','Registré tu cliente.'])assert.equal(safeConversationBridge(text),false,text);
 assert.ok(safeConversationBridge(collectionQuestion(location),{collection:location}));
 const ambiguous=advanceVoiceCollection('Quiero cargar un producto');assert.ok(safeConversationBridge(collectionQuestion(ambiguous),{collection:ambiguous}));
});

test('turnComplete without generationComplete cannot bypass the collection audio gate',async t=>{
 const outputs=[];const live=new GeminiLiveSession({backgroundTools:true,audioContext:{currentTime:0},WebSocket:{OPEN:1},request:async()=>({costUsd:0,measurement:'provider-forwarded'}),onTurnComplete:r=>outputs.push(r)});Object.assign(live,{ready:true,textInputOnly:true,socket:{readyState:1,send(){},close(){}}});t.after(()=>live.close());
 live.sendText('Quiero cargar stock');const turn=live.currentTurn;turn.pendingAudio=[new Uint8Array([0,0])];turn.generatedAudio=true;
 live.receive({serverContent:{outputTranscription:{text:'Ya cargué el stock.'},turnComplete:true}});await new Promise(r=>setImmediate(r));
 assert.equal(turn.pendingAudio.length,0);assert.equal(turn.heardAudio,false);assert.equal(outputs[0].assistantText,'¿En qué ubicación querés cargarlo?');
});

test('costs combine only correlated providers and retain unknown costs without duplicate reports',()=>{
 const c=new InteractionCosts();c.begin('a');c.task('a',{id:'t',status:'running'});assert.equal(c.summary().pending,true);
 c.voice('a',{costUsd:.01,measurement:'provider-forwarded'},'s:a');c.task('a',{id:'t',status:'completed',telemetry:{modelCalls:1,calls:[{responseId:'r',actualCostUsd:.02}]}});
 assert.equal(c.summary().usd,.03);assert.equal(c.summary().pending,false);
 c.task('a',{id:'t',status:'completed',telemetry:{modelCalls:1,calls:[{responseId:'r',actualCostUsd:.02}]}});assert.equal(c.summary().usd,.03);
 c.begin('b');c.voice('a',{costUsd:.005,measurement:'provider-forwarded'},'s:notice');assert.equal(c.latest,'b');assert.equal(c.summary().usd,null);
 c.voice('b',{measurement:'unconfirmed'},'s:b');assert.equal(c.summary().usd,null);assert.equal(c.summary().pending,true);
 assert.equal(monthlyProviderSummary({spendUsd:2,reservedUsd:100,lunaSol:{estimatedUsd:1},unconfirmedQueryCount:2}).usd,3);
 assert.equal(monthlyProviderSummary({spendUsd:2}).usd,null);
});

test('a paused proposal never instructs Gemini to confirm it',()=>{
 const task={status:'paused',pendingAction:{confirmationToken:'private'}};
 assert.equal(taskOutcome(task).kind,'paused');assert.equal(compactVoiceTask(task).requiresVisualConfirmation,undefined);
 assert.match(taskOutcome(task).nextStep,/no pedir confirmar/);
});

test('collection audio is withheld until the entire generated utterance passes the contextual gate',t=>{
 const make=()=>{const live=new GeminiLiveSession({backgroundTools:true,audioContext:{currentTime:0},WebSocket:{OPEN:1},request:async()=>({costUsd:0,measurement:'provider-forwarded'})});Object.assign(live,{ready:true,textInputOnly:true,socket:{readyState:1,send(){},close(){}}});t.after(()=>live.close());return live;};
 const good=make();good.sendText('Quiero cargar stock');good.receive({serverContent:{outputTranscription:{text:'¿En qué ubicación querés cargarlo?'}}});assert.equal(good.currentTurn.outputAuthorized,false);
 good.receive({serverContent:{generationComplete:true}});assert.equal(good.currentTurn.outputAuthorized,true);
 const bad=make();bad.sendText('Quiero cargar stock');bad.receive({serverContent:{outputTranscription:{text:'Ya cargué el stock.'},generationComplete:true}});assert.equal(bad.currentTurn.outputAuthorized,false);assert.equal(bad.currentTurn.outputText,'¿En qué ubicación querés cargarlo?');
});

async function backend(provider){const f=fixture({role:'admin',provider});f.session.email='agsreserva@gmail.com';f.config.hybridVoice.enabled=true;f.documents.set('oliviaConfiguration/global',f.config);f.engine=createOliviaEngine({store:f.store,clock:f.clock,provider,env:{OPENAI_API_KEY:'fixture',OLIVIA_DEPLOY_PREVIEW_CONTEXT:'deploy-preview',OLIVIA_HYBRID_LIVE_ENABLED:'true',GEMINI_API_KEY:'synthetic',GEMINI_API_BILLING_TIER:'paid',FIREBASE_PROJECT_ID:'app-integral-fm-pruebas'}});f.id=(await start(f)).conversationId;return f;}

test('native collection is persisted by the owned conversation endpoint with no model calls and no business facts',async()=>{
 const f=await backend(async()=>assert.fail('collection invoked Luna'));
 const turn=(requestId,userText,assistantText)=>f.engine.recordGeminiDirectTurn(f.session,{conversationId:f.id,requestId,userText,assistantText});
 let result=await turn('collect1','Quiero cargar stock','¿En qué ubicación querés cargarlo?');assert.equal(result.state,'DATOS_INCOMPLETOS');assert.equal(result.conversationContext.voiceCollection.validation,'unverified');
 result=await turn('collect2','En Local Lavalle','¿Qué productos y cantidades querés sumar?');assert.equal(result.conversationContext.voiceCollection.requestedLocation,'Lavalle');
 await assert.rejects(turn('forgery','En Local Lavalle','El stock actual es diez.'),e=>e.code==='gemini-direct-not-authorized');
 await assert.rejects(turn('not-direct','Diez botellas de Arbequina','Ya cargué las botellas.'),e=>e.code==='gemini-direct-not-authorized');
 assert.equal(f.documents.get('oliviaConversations/'+f.id).voiceCollection.revision,2);
});

test('structured requiresInput prevents a generic delegated question from becoming completed',async()=>{
 let calls=0;const f=await backend(async()=>{calls++;return textResponse(JSON.stringify({complete:'¿Qué período necesitás revisar?',spoken:'¿Qué período necesitás revisar?',requiresInput:true}));});
 const result=await f.engine.chat(f.session,{conversationId:f.id,requestId:'missing-generic',message:'Revisá una cuestión administrativa que requiere aclaraciones',inputMode:'natural-voice',screenContext:{module:'locations'},foreground:true});
 assert.ok(calls>0);assert.equal(result.state,'DATOS_INCOMPLETOS');assert.equal(f.documents.get('oliviaConversations/'+f.id).taskState.status,'collecting');
 assert.equal(dualVoiceResponse(JSON.stringify({complete:'Pregunta',spoken:'Pregunta',requiresInput:true}),100).requiresInput,true);
});
