import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiLiveSession, geminiTaskResult } from '../src/gestion/olivia/geminiLive.mjs';
import { classifyGeminiLiveTurn } from '../src/shared/oliviaConversationRouter.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
test('Gemini receives task facts without confirmation tokens, internal scopes or telemetry',()=>{
  const result=JSON.stringify(geminiTaskResult({id:'a',status:'awaiting-confirmation',summary:'Propuesta revisada',pendingAction:{confirmationToken:'secret-token'},scopeId:'internal',telemetry:{private:'diagnostics'}}));
  assert.match(result,/requiresVisualConfirmation/);assert.doesNotMatch(result,/secret-token|internal|diagnostics|confirmationToken/);
});
function session(t,options={}){
  const sent=[],turns=[],states=[],audio=[];
  const live=new GeminiLiveSession({backgroundTools:true,audioContext:{currentTime:0,createBufferSource(){const source={connect(){},disconnect(){},start(){},stop(){}};audio.push(source);return source;}},WebSocket:{OPEN:1},onTurnComplete:turn=>turns.push(turn),onState:s=>states.push(s),...options});
  Object.assign(live,{ready:true,textInputOnly:true,socket:{readyState:1,send:data=>sent.push(JSON.parse(data)),close(){}}});
  t.after(()=>live.close());return {live,sent,turns,states,audio};
}
test('an explicitly unfinished ASR transcript cannot take focus or dispatch a tool before its final marker',async t=>{
  const calls=[];const {live}=session(t,{onToolCall:async(call,text)=>{calls.push({call,text});return {tasks:[]};}});
  live.beginTurn('asr-awaits-final');const turn=live.currentTurn;
  live.receive({serverContent:{inputTranscription:{text:'Stock de aceite',finished:false}}});
  live.receive({toolCall:{functionCalls:[{id:'wait-final',name:'delegate_to_olivia',args:{action:'new'}}]}});
  live.receive({serverContent:{inputTranscription:{text:'Stock de aceite'}}});
  await tick();
  assert.equal(turn.transcriptComplete,false);
  assert.equal(live.conversationFocus.intentEpoch,0,'a partial transcript must not take durable conversational focus');
  assert.equal(calls.length,0,'partial speech must not dispatch backend work');
  live.receive({serverContent:{inputTranscription:{finished:true}}});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(turn.transcriptComplete,true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].text,'Stock de aceite');
});
test('provider completion cannot promote unfinished ASR to an authoritative user turn',async t=>{
  const {live,turns}=session(t,{onToolCall:()=>assert.fail('unfinished speech must never dispatch')});
  live.beginTurn('unfinished-provider-completion');const turn=live.currentTurn;
  live.receive({serverContent:{inputTranscription:{text:'Cargá diez unidades de Aceite en el local QA',finished:false}}});
  live.setListening(false);
  await live.finishTurn(turn);
  assert.equal(turn.cancelled,true);
  assert.equal(live.conversationFocus.intentEpoch,0);
  assert.equal(turns.length,0,'unfinished speech must not be saved as a completed conversation');
});
test('social grammar stays native while contextual controls and free-form task slots use the authenticated engine',()=>{
  for(const text of ['Hola, Olivia. ¿Cómo estás?','Muy bien, ¿y vos?','Perfecto, muchas gracias.','Qué bueno.','¿Me escuchás bien?','¿Te puedo pedir algo?','No, dejá.','Sí, dale.','Contame algo lindo','¿Por qué el cielo es azul?'])assert.equal(classifyGeminiLiveTurn(text).route,'direct',text);
  for(const text of ['Sí, dale.','No, dejá.'])assert.equal(classifyGeminiLiveTurn(text,{pendingAction:true}).route,'delegate',text);
  for(const text of ['Agustín Bazán','Pistachos de doscientos gramos','Dos unidades','En el local'])assert.equal(classifyGeminiLiveTurn(text,{collectingTask:true}).route,'delegate',text);
  assert.equal(classifyGeminiLiveTurn('¿Me escuchás bien?',{activeTask:true,collectingTask:true}).route,'direct');
  assert.equal(classifyGeminiLiveTurn('Gracias, también creá un cliente').route,'delegate');
});
test('a slow tool releases its voice turn, lets social conversation continue and notifies one verified result',async t=>{
  let complete;const {live,sent,turns}=session(t,{onToolCall:async(_call,text,context)=>{
    assert.equal(text,'Stock de aceite');context.onAccepted({id:'task_a',status:'running',jobId:'job_a'});
    return new Promise(resolve=>{complete=resolve;});
  }});
  live.sendText('Stock de aceite');const original=live.currentTurn.turnId;
  live.receive({toolCall:{functionCalls:[{id:'call_a',name:'delegate_to_olivia',args:{action:'new'}}]},serverContent:{turnComplete:true}});
  await tick();assert.equal(live.currentTurn.pending,false);assert.equal(turns[0].pendingTask,true);
  assert.equal(sent.find(e=>e.toolResponse)?.toolResponse.functionResponses[0].willContinue,true);
  live.sendText('Perfecto, muchas gracias');
  live.notifyTaskUpdate({id:'task_a',requestId:'request_a',status:'completed',summary:'Stock verificado: 4 unidades'});
  complete({id:'task_a',requestId:'request_a',status:'completed',summary:'Stock verificado: 4 unidades'});
  await tick();assert.equal(sent.filter(e=>e.toolResponse?.functionResponses[0].scheduling==='WHEN_IDLE').length,0,'result waits while the user turn is active');
  live.receive({serverContent:{outputTranscription:{text:'¡De nada!'},turnComplete:true}});
  await tick();await new Promise(r=>setTimeout(r,5));
  const notifications=sent.filter(e=>e.toolResponse?.functionResponses[0].scheduling==='WHEN_IDLE');
  assert.equal(notifications.length,1);assert.equal(live.currentTurn.sourceTurnId,original);
  assert.equal(live.currentTurn.taskId,'task_a');
});
test('a model tool call cannot turn a clear social utterance into a backend operation',async t=>{
  const {live,sent}=session(t,{onToolCall:()=>assert.fail('social delegation')});
  live.sendText('¿Me escuchás bien?');
  live.receive({toolCall:{functionCalls:[{id:'wrong',name:'delegate_to_olivia'}]}});await tick();
  assert.match(sent.at(-1).toolResponse.functionResponses[0].response.result,/conversacional/);
  live.receive({serverContent:{outputTranscription:{text:'Sí, perfecto.'},turnComplete:true}});await tick();
});

test('a rejected conversational tool call retains its turn across the tool-only completion',async t=>{
  const {live,turns}=session(t,{onToolCall:()=>assert.fail('conversation was delegated')});
  live.sendText('Me corrijo, eran cuatro frascos, no tres.');
  const original=live.currentTurn;
  live.receive({toolCall:{functionCalls:[{id:'wrong',name:'delegate_to_olivia',args:{action:'continue'}}]},serverContent:{turnComplete:true}});
  await tick();
  assert.equal(live.currentTurn,original);
  assert.equal(original.pending,true);
  assert.equal(turns.length,0,'a tool-only completion is not a conversational answer');
  live.receive({serverContent:{outputTranscription:{text:'Corregido: cuatro frascos.'},turnComplete:true}});
  await tick();
  assert.equal(turns.length,1);
  assert.equal(turns[0].assistantText,'Corregido: cuatro frascos.');
  assert.equal(turns[0].delegated,false);
});

test('background social requests and dictation holds stay direct without weakening business controls',()=>{
  for(const text of ['Mientras revisás esa tarea, ¿me escuchás bien?','Esperá, quiero corregir lo que estaba diciendo.','Avisame cuando termines cada tarea verificada.'])assert.equal(classifyGeminiLiveTurn(text,{collectingTask:true,activeTask:true}).route,'direct',text);
  assert.equal(classifyGeminiLiveTurn('Tomá nota en esta conversación: una caja de prueba, dos bolsas y tres frascos.').route,'direct');
  for(const text of ['Mientras trabajás en eso, creá un cliente','Esperá, cancelá la tarea','Tomá nota en esta conversación: registrá una venta','Tomá nota en esta conversación: ¿cuánto stock tenemos?'])assert.equal(classifyGeminiLiveTurn(text).route,'delegate',text);
  assert.equal(classifyGeminiLiveTurn('Tomá nota en esta conversación: dos productos',{collectingTask:true}).route,'delegate');
  assert.equal(classifyGeminiLiveTurn('Sí',{pendingAction:true}).route,'delegate');
});
test('a synchronous task error produces a bounded result rather than an unhandled promise or stuck state',async t=>{
  const {live,sent}=session(t,{onToolCall:()=>{throw new Error('backend unavailable');}});
  live.sendText('Stock de aceite');
  live.receive({toolCall:{functionCalls:[{id:'error',name:'delegate_to_olivia'}]},serverContent:{turnComplete:true}});
  await tick();await new Promise(r=>setTimeout(r,5));
  assert.match(JSON.stringify(sent.at(-1)),/Podemos seguir conversando/);assert.equal(live.failed,false);
});
test('an ambiguous fragment outside an operational context asks for clarification without a Luna request',async t=>{
  const {live,sent}=session(t,{onToolCall:()=>assert.fail('ambiguous fragment was delegated')});
  live.sendText('Lo de antes por esa línea');
  live.receive({toolCall:{functionCalls:[{id:'ambiguous',name:'delegate_to_olivia'}]}});await tick();
  assert.match(sent.at(-1).toolResponse.functionResponses[0].response.result,/pedí una aclaración/);
  live.receive({serverContent:{outputTranscription:{text:'¿Me aclarás qué necesitás?'},turnComplete:true}});await tick();
});
test('acknowledgement and final answer have independent audio marks with the source turn preserved',t=>{
  const first=[];const {live}=session(t,{onFirstAudio:(at,context)=>first.push(context)});
  const turn=live.createTurn();Object.assign(turn,{turnId:'turn_a',sourceTurnId:'source_a',taskId:'task_a',acknowledgementAuthorized:true});
  live.scheduleAudio({duration:0.01},turn);turn.acknowledgementAuthorized=false;
  live.scheduleAudio({duration:0.01},turn);
  assert.deepEqual(first.map(c=>c.acknowledgement),[true,false]);
  assert.ok(first.every(c=>c.sourceTurnId==='source_a'));
});
test('a completed voice turn becomes available before slow usage bookkeeping finishes',async t=>{
  let release;const {live,states}=session(t);
  live.sessionId='test';live.request=async()=>new Promise(r=>{release=r;});
  live.sendText('Hola');live.receive({serverContent:{outputTranscription:{text:'¡Hola!'},turnComplete:true}});
  await tick();await new Promise(r=>setTimeout(r,5));
  assert.equal(states.at(-1),'listening');assert.equal(live.currentTurn.pending,false);
  release({measurement:'provider-forwarded'});await tick();live.sessionId=null;
});

test('generated audio queued beyond the response deadline retains its playback completion window',async t=>{
  const {live,turns}=session(t,{turnTimeoutMs:5,completionGraceMs:5});
  live.sendText('Hola');live.nextAudioAt=.1;
  live.receive({serverContent:{generationComplete:true}});
  await new Promise(r=>setTimeout(r,20));
  assert.equal(live.failed,false,'the provider response timeout cannot stop already generated audio');
  assert.equal(live.currentTurn.pending,true);
  live.receive({serverContent:{outputTranscription:{text:'Hola, acá estoy.'},turnComplete:true}});
  await tick();assert.equal(turns.length,1);assert.equal(live.failed,false);
});

test('barge-in after bookkeeping completed does not acknowledge an interrupted notification',async t=>{
  let delivered=0;const {live}=session(t,{onNotificationDelivered:async()=>{delivered++;return {acknowledged:true};}});
  const turn=live.createTurn();Object.assign(turn,{pending:true,toolTurn:true,outputAuthorized:true,notification:true,notificationKey:'n',taskId:'a',notificationStatus:'completed'});
  live.currentTurn=turn;live.scheduleAudio({duration:.04},turn);await live.finishTurn(turn);
  assert.equal(live.finalizingTurns.size,0,'usage bookkeeping has already ended');
  live.interrupt();await new Promise(r=>setTimeout(r,90));
  assert.equal(turn.cancelled,true);assert.equal(delivered,0);
});

test('provider completion waits for local speech endpoint before releasing or retiring output',async t=>{
  const {live}=session(t);live.setListening(true,'dictation');const turn=live.currentTurn;
  Object.assign(turn,{toolTurn:true,outputAuthorized:true,outputText:'Te escucho',completeReceived:true});
  live.flushPendingAudio(turn);await live.finishTurn(turn);assert.equal(turn.pending,true);
  live.setListening(false);await tick();assert.equal(turn.completed,true);
});

test('unrecognized input releases thinking without disconnecting or cancelling accepted work',async t=>{
  const {live,states}=session(t,{transcriptWaitMs:5});live.pendingTaskCalls.set('accepted',{taskId:'accepted'});
  live.beginTurn('noise');live.setListening(false);await new Promise(r=>setTimeout(r,12));
  assert.equal(live.currentTurn.pending,false);assert.equal(live.failed,false);assert.equal(states.at(-1),'listening');
  assert.equal(live.pendingTaskCalls.has('accepted'),true);
  live.sendText('Hola');assert.equal(live.currentTurn.pending,true);
  live.receive({serverContent:{outputTranscription:{text:'Hola'},turnComplete:true}});await tick();
});

test('a late empty completion from the interrupted clause cannot retire a continuing voice segment',async t=>{
  let requested;const {live}=session(t,{onToolCall:async(_call,text)=>{requested=text;return {tasks:[]};}});
  live.beginTurn('second-clause');const turn=live.currentTurn;
  live.receive({serverContent:{inputTranscription:{text:'¿Qué métricas hay?'}}});
  live.receive({serverContent:{outputTranscription:{text:'Dale, lo'}}});
  live.receive({serverContent:{interrupted:true}});live.receive({serverContent:{turnComplete:true}});
  assert.equal(turn.completeReceived,false);assert.equal(turn.pending,true);
  assert.equal(turn.outputText,'','partial acknowledgement from the cancelled clause is discarded');
  live.setListening(false);assert.equal(turn.pending,true);
  live.receive({serverContent:{inputTranscription:{text:'Explicá qué está disponible.'}}});
  live.receive({toolCall:{functionCalls:[{id:'metrics',name:'delegate_to_olivia',args:{action:'new'}}]}});await tick();
  assert.match(requested,/métricas hay.*disponible/);
});

test('interrupted zero-audio notification waits for provider usage without attributing it to the next input',async t=>{
  const reports=[];const {live}=session(t,{transcriptWaitMs:30,request:async p=>{reports.push(p);return p.operation==='usage'?{measurement:'provider-forwarded'}:{closed:true};}});
  live.sessionId='session';Object.assign(live.currentTurn,{pending:true,notification:true,turnId:'notice'});
  live.beginTurn('next');assert.equal(reports.length,0);
  const usage={promptTokensDetails:[{modality:'TEXT',tokenCount:10}],responseTokensDetails:[{modality:'TEXT',tokenCount:2}]};
  live.receive({usageMetadata:usage,serverContent:{interrupted:true}});await tick();
  assert.equal(reports[0].turnId,'notice');assert.deepEqual(reports[0].usageMetadata.promptTokensDetails,usage.promptTokensDetails);assert.deepEqual(reports[0].usageMetadata.responseTokensDetails,usage.responseTokensDetails);
  assert.equal(live.currentTurn.usageMetadata,null);assert.equal(live.failed,false);live.sessionId=null;
});

test('unconfirmed notification usage still triggers the original preventive stop after the bounded wait',async t=>{
  const reports=[];const {live}=session(t,{transcriptWaitMs:5,request:async p=>{reports.push(p);return p.operation==='usage'?{measurement:'unconfirmed',shouldStop:true}:{closed:true};}});
  live.sessionId='session';Object.assign(live.currentTurn,{pending:true,notification:true,turnId:'notice'});
  live.beginTurn('next');await new Promise(r=>setTimeout(r,15));
  assert.equal(live.failed,true);assert.ok(reports.some(p=>p.operation==='usage' && p.turnId==='notice'));live.sessionId=null;
});

test('provider interruption of an old buffer preserves the current endpointed user request',async t=>{
  let called=false;const {live}=session(t,{onToolCall:async()=>{called=true;return {tasks:[]};}});
  const turn=live.currentTurn;Object.assign(turn,{pending:true,turnId:'current',inputAudioSeconds:.5,inputText:'Stock de aceite',transcriptComplete:true,outputAuthorized:true});
  await live.authorizeTurn(turn);await turn.focusPromise;
  live.scheduleAudio({duration:.01},turn);live.receive({serverContent:{interrupted:true}});
  assert.equal(turn.cancelled,false);assert.equal(turn.pending,true);
  live.receive({toolCall:{functionCalls:[{id:'stock',name:'delegate_to_olivia',args:{action:'new'}}]}});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(called,true);
});

test('missing native business tool uses one visible asynchronous policy fallback without provider call IDs',async t=>{
  let release,calls=0;const {live,sent,turns}=session(t,{onToolCall:async(call,text,context)=>{
    calls++;assert.equal(text,'Precio del aceite');assert.equal(call.id,undefined);assert.equal(context.requestId,context.turnId);
    context.onAccepted({id:'price',status:'running'});return new Promise(r=>{release=r;});
  }});
  live.sendText('Precio del aceite');live.receive({serverContent:{outputTranscription:{text:'Son cien pesos inventados.'},turnComplete:true}});await tick();
  assert.equal(calls,1);assert.equal(turns[0].policyFallback,true);assert.equal(turns[0].pendingTask,true);assert.equal(live.currentTurn.pending,false);
  assert.equal(sent.some(e=>e.toolResponse),false,'no provider function ID is fabricated');
  live.sendText('Gracias');live.receive({serverContent:{outputTranscription:{text:'De nada'},turnComplete:true}});await tick();assert.equal(calls,1);
  release({id:'price',status:'completed',summary:'Precio verificado: 200 pesos'});await tick();
  await new Promise(r=>setTimeout(r,5));assert.ok(sent.some(e=>e.clientContent?.turns[0].parts[0].text.includes('Precio verificado')));
});
test('resumed tasks use an internal backend notification without a stale function response ID',async t=>{
  const {live,sent}=session(t);live.watchTasks([{id:'restored',status:'running'}]);
  live.notifyTaskUpdate({id:'restored',status:'completed',summary:'Resultado verificado'});
  assert.equal(sent.at(-1).toolResponse,undefined);assert.match(JSON.stringify(sent.at(-1)),/Evento interno/);
  assert.equal(live.currentTurn.notification,true);
});
