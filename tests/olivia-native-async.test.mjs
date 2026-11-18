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
  assert.match(JSON.stringify(sent.at(-1)),/backend unavailable/);
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
test('resumed tasks use an internal backend notification without a stale function response ID',async t=>{
  const {live,sent}=session(t);live.watchTasks([{id:'restored',status:'running'}]);
  live.notifyTaskUpdate({id:'restored',status:'completed',summary:'Resultado verificado'});
  assert.equal(sent.at(-1).toolResponse,undefined);assert.match(JSON.stringify(sent.at(-1)),/Evento interno/);
  assert.equal(live.currentTurn.notification,true);
});
