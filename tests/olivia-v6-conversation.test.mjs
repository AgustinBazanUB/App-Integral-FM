import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryDiagnostic } from '../src/gestion/olivia/liveRecovery.mjs';
import { ConversationNotifications } from '../src/gestion/olivia/conversationNotifications.mjs';
import { compactVoiceContext, selectStatusTasks, taskOutcome } from '../src/shared/oliviaTaskConversation.mjs';
import { classifyGeminiLiveTurn } from '../src/shared/oliviaConversationRouter.mjs';
import { GeminiLiveSession } from '../src/gestion/olivia/geminiLive.mjs';
import { DelegatedTaskClient } from '../src/gestion/olivia/delegatedTaskClient.mjs';
import { appendTaskProgress } from '../netlify/functions/_lib/olivia/taskProgress.mjs';

test('task status questions use state without treating social follow-ups as tasks',()=>{
  assert.equal(classifyGeminiLiveTurn('Sí, dale. Pero recordá que esto no autoriza ninguna modificación: solo seguimos conversando.',{pendingAction:true}).route,'direct');
  for(const text of ['¿Cómo venís?','¿Qué te falta?','¿Ya terminaste?','¿Qué tareas estás haciendo?'])assert.equal(classifyGeminiLiveTurn(text).kind,'task-status',text);
  for(const text of ['Muy bien, ¿y vos?','¿Cómo estás?','Gracias'])assert.equal(classifyGeminiLiveTurn(text,{activeTask:true}).route,'direct');
  assert.equal(selectStatusTasks([{id:'a',status:'running'},{id:'b',status:'needs-input'}]).needsClarification,true);
  assert.equal(selectStatusTasks([{id:'a',status:'completed'}],'foreign').needsClarification,true);
});

test('supplied facts stay conversational outside collection without weakening data requests or actions',()=>{
  const statement='El cliente se llama QA Olivia. Es un registro ficticio; no le envíes mensajes.';
  assert.equal(classifyGeminiLiveTurn(statement).kind,'provided-context');
  assert.equal(classifyGeminiLiveTurn(statement,{activeTask:true}).route,'direct');
  assert.equal(classifyGeminiLiveTurn(statement,{collectingTask:true}).route,'delegate');
  assert.equal(classifyGeminiLiveTurn(statement,{pendingAction:true}).route,'delegate');
  assert.equal(classifyGeminiLiveTurn('El cliente se llama QA Olivia, ¿cuánto debe?').route,'delegate');
  assert.equal(classifyGeminiLiveTurn('El cliente se llama QA Olivia; crealo.').route,'delegate');
});

test('fresh-session context contains bounded history and task facts without confirmation secrets',()=>{
  const context=compactVoiceContext({messages:Array.from({length:15},(_,i)=>({role:'user',content:`m${i}`})),pendingActionId:'private'},[{id:'a',status:'awaiting-confirmation',summary:'Revisar',pendingAction:{confirmationToken:'secret'},telemetry:{secret:'private'}}]);
  assert.equal(context.messages.length,8);assert.equal(context.messages[0].text,'m7');
  assert.equal(context.pendingConfirmation,true);assert.equal(context.tasks[0].requiresVisualConfirmation,true);
  assert.doesNotMatch(JSON.stringify(context),/secret|private|confirmationToken/);
});

test('progress is tied to real allowed events, bounded and has no fabricated percentage',()=>{
  let progress=null;
  for(let i=0;i<20;i++)progress=appendTaskProgress(progress,{kind:i%2?'tool-started':'tool-finished',tool:'get_stock'},new Date());
  assert.equal(progress.revision,20);assert.equal(progress.events.length,12);assert.equal(progress.percent,undefined);
  assert.deepEqual(appendTaskProgress(progress,{kind:'invented'},new Date()),progress);
});

test('notification scheduling coalesces progress, waits for meaningful intervals and drops stale updates',()=>{
  let now=0;const n=new ConversationNotifications({now:()=>now});
  const item=(id,revision,status='running')=>({taskId:id,result:{id,requestId:id,status,progress:{revision},notification:{key:`${id}:${status}:${revision}`,eligible:true}}});
  assert.equal(n.enqueue(item('a',1)),true);now=10000;n.enqueue(item('a',2));assert.equal(n.queue.length,1);assert.equal(n.take(),null);
  now=20000;const a=n.take();assert.equal(a.result.progress.revision,2);n.complete(a);
  n.enqueue(item('b',1));now=30000;assert.equal(n.take(),null);now=40000;assert.ok(n.take());
  n.enqueue(item('a',2,'completed'));assert.equal(n.enqueue(item('a',1)),false);const terminal=n.take();assert.equal(terminal.result.status,'completed');
  n.interrupted(terminal);assert.equal(n.enqueue(item('a',2,'completed')),true);assert.ok(n.take());n.interrupted(terminal);assert.equal(n.enqueue(item('a',2,'completed')),false,'bounded delivery attempts');
});

test('status client uses cheap recent cache and never submits a job',async()=>{
  const calls=[];const client=new DelegatedTaskClient({conversationId:'c',now:()=>100,request:async body=>{calls.push(body.operation);return {tasks:[{id:'a',status:'running'}]};}});
  await client.run({args:{action:'status'}},'¿Cómo venís?');await client.run({args:{action:'status'}},'¿Qué te falta?');
  assert.deepEqual(calls,['delegatedTaskStatus']);client.close();
});

test('task control asks for clarification when the model selects a completed task or negates cancellation',async()=>{
  const calls=[];const client=new DelegatedTaskClient({conversationId:'c',request:async body=>{calls.push(body.operation);return {tasks:[{id:'done',status:'completed'},{id:'waiting',status:'needs-input'}]};}});
  assert.equal((await client.run({args:{action:'pause',taskId:'done'}},'Pausá la tarea')).needsClarification,true);
  assert.equal((await client.run({args:{action:'cancel',taskId:'waiting'}},'No canceles la tarea')).needsClarification,true);
  assert.deepEqual(calls,['delegatedTaskStatus']);client.close();
});

test('typed outcomes keep missing information, permission and retryable failures separate',()=>{
  assert.equal(taskOutcome({status:'needs-input'}).kind,'missing-information');
  assert.equal(taskOutcome({status:'failed',failure:{code:'permission-denied'}}).retryable,false);
  assert.equal(taskOutcome({status:'failed',failure:{code:'provider-timeout'}}).retryable,true);
  assert.equal(taskOutcome({status:'completed'}),null);
});

function fixture(t,options={}){
  const requests=[],sockets=[],recovery=[];let tokens=0;
  class Socket{
    static OPEN=1;
    constructor(){this.readyState=1;this.sent=[];sockets.push(this);queueMicrotask(()=>this.onopen());}
    send(raw){const data=JSON.parse(raw);this.sent.push(data);if(data.setup)queueMicrotask(()=>this.onmessage({data:JSON.stringify({setupComplete:{}})}));}
    close(){this.readyState=3;}
  }
  const live=new GeminiLiveSession({conversationId:'c',audioContext:{currentTime:0},WebSocket:Socket,waitRecovery:async()=>{},onRecovery:r=>recovery.push(r),request:async body=>{requests.push(body);return body.operation==='token'?{token:`auth_tokens/test${++tokens}`,sessionId:`s${tokens}`,expiresAt:new Date(Date.now()+60000).toISOString(),maxSessionSeconds:600,context:{messages:[{role:'assistant',text:'Contexto'}]}}:{closed:true};},...options});
  t.after(()=>live.close());return {live,requests,sockets,recovery};
}

test('short outage resumes the same session, retains accepted work and does not replay instructions',async t=>{
  const f=fixture(t);await f.live.start(null,{textInputOnly:true});
  f.live.receive({sessionResumptionUpdate:{resumable:true,newHandle:'private-handle'}});
  f.live.pendingTaskCalls.set('task',{taskId:'task',call:{id:'old-function'}});
  await f.live.recover(new Error('network'));
  assert.equal(f.requests.filter(r=>r.operation==='token').length,1);
  assert.equal(f.sockets[1].sent[0].setup.sessionResumption.handle,'private-handle');
  assert.equal(f.live.pendingTaskCalls.get('task').call,null);assert.equal(f.recovery.at(-1).resumed,true);
  assert.equal(f.sockets[1].sent.some(e=>e.clientContent),false,'no user/tool replay after resumption');
});

test('expired session closes its lease before fresh credentials and restores historical context',async t=>{
  const f=fixture(t);await f.live.start(null,{textInputOnly:true});f.live.tokenExpiresAt=0;f.live.resumeHandle='old';
  await f.live.recover(new Error('network'));
  assert.deepEqual(f.requests.filter(r=>r.operation!=='usage').map(r=>r.operation),['token','close','token']);
  assert.equal(f.recovery.at(-1).resumed,false);assert.equal(f.sockets[1].sent[1].clientContent.turns[0].role,'model');
});

test('expired connection-opening window avoids a resumption attempt with otherwise valid credentials',async t=>{
  const f=fixture(t);await f.live.start(null,{textInputOnly:true});f.live.resumeHandle='handle';
  f.live.tokenExpiresAt=Date.now()+60000;f.live.newSessionExpiresAt=Date.now()-1;
  await f.live.recover(new Error('idle-disconnect'));
  assert.equal(f.sockets.length,2);assert.deepEqual(f.sockets[1].sent[0].setup.sessionResumption,{});
  assert.equal(f.recovery.at(-1).resumed,false);assert.equal(f.recovery.at(-1).attempt,1);
});

test('budget denial is terminal and does not request more credentials',async t=>{
  const f=fixture(t);await f.live.start(null,{textInputOnly:true});
  await f.live.recover(Object.assign(new Error('quota'),{status:429}));
  assert.equal(f.live.failed,true);assert.equal(f.requests.filter(r=>r.operation==='token').length,1);
});

test('recovery retries are bounded and closing during backoff prevents token allocation',async t=>{
  const f=fixture(t);await f.live.start(null,{textInputOnly:true});let attempts=0;
  f.live.openSocket=async()=>{attempts++;throw new Error('offline');};
  await f.live.recover(new Error('network'));assert.equal(attempts,3);assert.equal(f.live.failed,true);
  const g=fixture(t);await g.live.start(null,{textInputOnly:true});
  g.live.waitRecovery=async()=>g.live.close();await g.live.recover(new Error('network'));
  assert.equal(g.requests.filter(r=>r.operation==='token').length,1);
});


test('developer connection diagnostics never expose token URLs or ephemeral credentials',()=>{
 const message=recoveryDiagnostic(new Error('WebSocket 1008 wss://example.test/live?access_token=secret123 auth_tokens/private-token key=another-secret'));
 assert.match(message,/1008/);assert.doesNotMatch(message,/secret123|private-token|another-secret/);
});
