import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, start } from './helpers/olivia-fixture.mjs';
import { startDelegatedTask, listDelegatedTasks, controlDelegatedTask, pumpDelegatedTasks, acknowledgeTaskNotification } from '../netlify/functions/_lib/olivia/delegatedTasks.mjs';
import { runChatJob } from '../netlify/functions/_lib/olivia/chatJobs.mjs';
import { DelegatedTaskClient } from '../src/gestion/olivia/delegatedTaskClient.mjs';
import { createOliviaEngine } from '../netlify/functions/_lib/olivia/engine.mjs';

async function setup() {
  const f=fixture({role:'admin'}); f.session.email='agsreserva@gmail.com';
  f.config.hybridVoice.enabled=true;f.documents.set('oliviaConfiguration/global',f.config);
  f.engine=createOliviaEngine({store:f.store,clock:f.clock,env:{OPENAI_API_KEY:'fixture',OLIVIA_DEPLOY_PREVIEW_CONTEXT:'deploy-preview',OLIVIA_HYBRID_LIVE_ENABLED:'true',GEMINI_API_KEY:'synthetic',GEMINI_API_BILLING_TIER:'paid',FIREBASE_PROJECT_ID:'app-integral-fm-pruebas'}});
  const parent=(await start(f)).conversationId, dispatched=[];
  const args=()=>({store:f.store,engine:f.engine,session:f.session,dispatch:async id=>dispatched.push(id),now:f.clock()});
  const create=(requestId,message='Necesito cargar mercadería',extra={})=>startDelegatedTask({...args(),body:{conversationId:parent,requestId,message,screenContext:{module:'locations',locationId:'local_a'},...extra}});
  const list=()=>listDelegatedTasks({...args(),parent});
  const control=(task,action,extra={})=>controlDelegatedTask({...args(),body:{conversationId:parent,taskId:task.id,requestId:`control_${task.id}_${action}`,action,...extra}});
  const run=task=>runChatJob({store:f.store,engine:f.engine,session:f.session,jobId:task.jobId,clock:f.clock,wait:async ms=>f.advance(ms)});
  return {...f,parent,args,create,list,control,run,dispatched};
}

test('persistent task scopes isolate pending data and cap concurrency across simultaneous requests',async()=>{
  const f=await setup();
  const root=f.documents.get(`oliviaConversations/${f.parent}`);
  root.taskState={status:'collecting',slots:{customerName:'unrelated'}};
  root.pendingActionId='unrelated';root.suspendedTasks=[{secret:'unrelated'}];
  await Promise.all(['a','b','c','d'].map(id=>f.create(id)));
  const tasks=await f.list();
  assert.equal(tasks.filter(t=>t.status==='running').length,3);
  assert.equal(tasks.filter(t=>t.status==='queued').length,1);
  assert.equal(f.dispatched.length,3);
  const scopes=[...f.documents.values()].filter(d=>d.internalTask);
  assert.equal(new Set(scopes.map(s=>s.id)).size,4);
  for(const scope of scopes){assert.equal(scope.pendingActionId,null);assert.equal(scope.taskState,null);assert.equal(scope.suspendedTasks,undefined);}
  assert.equal(root.taskState.slots.customerName,'unrelated');
});

test('task retries preserve identity, reject changed payloads and do not redispatch earlier attempts',async()=>{
  const f=await setup(),task=await f.create('first');
  assert.equal((await f.create('first')).id,task.id);assert.equal(f.dispatched.length,1);
  await assert.rejects(f.create('first','Otra solicitud'),{code:'request-already-used'});
  await f.run(task);
  assert.equal((await f.list())[0].status,'needs-input');
  await f.create('continuation','Dos unidades de aceite',{taskId:task.id});
  await f.create('first');
  assert.equal(f.dispatched.length,2);
  assert.equal(f.documents.get(`oliviaConversations/${f.parent}/delegatedTasks/${task.id}`).requestId,'continuation');
});

test('dependencies wait for verified completion, and failed dependencies never dispatch their successors',async()=>{
  const f=await setup(),a=await f.create('a','Stock de aceite');
  const b=await f.create('b','Stock de aceite',{dependsOn:[a.id]});
  assert.equal(b.status,'queued');assert.equal(f.dispatched.length,1);
  await f.run(a);await f.list();
  assert.equal(f.dispatched.length,2);
  const current=(await f.list()).find(t=>t.id===b.id);await f.control(current,'cancel');
  const c=await f.create('c','Stock de aceite',{dependsOn:[b.id]});
  assert.equal(c.status,'failed');assert.equal(f.dispatched.length,2);
  await assert.rejects(f.create('foreign','Stock de aceite',{dependsOn:['not_owned']}),{code:'invalid-task-dependency'});
});

test('two stock proposals require visual confirmation, reject stale stock and never duplicate a mutation',async()=>{
  const f=await setup();
  const a=await f.create('load_a','Cargame 2 unidades de aceite');
  const b=await f.create('load_b','Cargame 3 unidades de aceite');
  await Promise.all([f.run(a),f.run(b)]);
  const tasks=await f.list();
  assert.ok(tasks.every(t=>t.status==='awaiting-confirmation'));
  assert.equal(f.documents.get('locationStock/local_a/items/oil').currentStock,4);
  await assert.rejects(f.control(tasks[0],'confirm'),{code:'confirmation-required'});
  const confirm=t=>f.control(t,'confirm',{visualConfirmation:true,actionId:t.pendingAction.id,confirmationToken:t.pendingAction.confirmationToken});
  await Promise.all([confirm(tasks[0]),confirm(tasks[0])]);
  await assert.rejects(confirm(tasks[1]),{code:'context-changed'});
  assert.equal(f.documents.get('locationStock/local_a/items/oil').currentStock,6);
  const revised=await f.create('revised_load','Cargame 3 unidades de aceite',{taskId:b.id});
  await f.run(revised);
  const fresh=(await f.list()).find(t=>t.id===b.id);
  await confirm(fresh);
  assert.equal(f.documents.get('locationStock/local_a/items/oil').currentStock,9);
  assert.ok((await f.list()).every(t=>t.status==='completed'));
  await assert.rejects(f.control(tasks[0],'cancel'),{code:'task-terminal'});
});

test('cancellation racing dispatch cannot be overwritten by its late acceptance',async()=>{
  const f=await setup();let release,accepted;
  const waiting=new Promise(r=>{accepted=r;});
  const creating=startDelegatedTask({...f.args(),dispatch:async()=>{accepted();await new Promise(r=>{release=r;});},body:{conversationId:f.parent,requestId:'race',message:'Cargame 2 unidades de aceite'}});
  await waiting;
  const task=[...f.documents].find(([path])=>path.includes('/delegatedTasks/')&&!path.includes('/requests/'))[1];
  await f.control(task,'cancel');release();await creating;
  assert.equal((await f.list())[0].status,'cancelled');
  const job=[...f.documents.values()].find(d=>d.payload?.requestId==='race');
  assert.equal(job.status,'cancelled');assert.equal(f.providerCalls(),0);
  assert.equal(f.documents.get('locationStock/local_a/items/oil').currentStock,4);
});

test('an interrupted dispatch lease resumes the same job rather than creating another operation',async()=>{
  const f=await setup(),task=await f.create('lease');
  const path=`oliviaConversations/${f.parent}/delegatedTasks/${task.id}`;
  Object.assign(f.documents.get(path),{status:'dispatching',jobId:null,dispatchLeaseUntil:f.clock()});
  await pumpDelegatedTasks({...f.args(),parent:f.parent});
  assert.equal((await f.list())[0].jobId,task.jobId);
  assert.equal(f.dispatched.length,2);
  assert.equal([...f.documents.keys()].filter(p=>p.startsWith('oliviaChatJobs/')).length,1);
});
test('cancellation before the engine claim prevents even a late deterministic proposal from being created',async()=>{
  const f=await setup(),task=await f.create('late_claim','Cargame 2 unidades de aceite');
  const workerEngine={chat:async(...args)=>{await f.control(task,'cancel');return f.engine.chat(...args);}};
  await runChatJob({store:f.store,engine:workerEngine,session:f.session,jobId:task.jobId,clock:f.clock});
  assert.equal((await f.list())[0].status,'cancelled');
  assert.equal([...f.documents.keys()].filter(p=>p.startsWith('oliviaConfirmations/')).length,0);
  assert.equal(f.documents.get('locationStock/local_a/items/oil').currentStock,4);
});

test('task access rejects another user, changed session, expired parent and internal task roots',async()=>{
  const f=await setup(),task=await f.create('ownership');
  for(const session of [{...f.session,uid:'foreign'},{...f.session,authTime:1}])await assert.rejects(listDelegatedTasks({...f.args(),session,parent:f.parent}));
  const scope=[...f.documents.values()].find(d=>d.internalTask);
  await assert.rejects(listDelegatedTasks({...f.args(),parent:scope.id}),{code:'invalid-input'});
  f.advance(400*86400000);
  await assert.rejects(f.list(),{code:'conversation-expired'});
  assert.equal(task.status,'running');
});

test('two client tasks poll together while the caller remains free, and retries reuse one request ID',async()=>{
  let calls=0;const payloads=[],tasks=[];
  const client=new DelegatedTaskClient({conversationId:'root',delay:async()=>{},request:async payload=>{
    payloads.push(payload);
    if(payload.operation==='delegatedTask'){
      if(++calls===1)throw Object.assign(new Error('lost response'),{code:'olivia-network-error'});
      const task={id:payload.requestId,status:'running'};tasks.push(task);return task;
    }
    return {tasks:tasks.map(t=>({...t,status:'completed'}))};
  }});
  const first=client.run({args:{action:'new',taskId:'must_ignore'}},'Consulta A',{requestId:'a'});
  const second=client.run({args:{action:'new'}},'Consulta B',{requestId:'b'});
  const results=await Promise.all([first,second]);
  assert.ok(results.every(t=>t.status==='completed'));
  assert.equal(payloads.filter(p=>p.requestId==='a').length,2);
  assert.ok(payloads.filter(p=>p.operation==='delegatedTask').every(p=>!p.taskId));
});

test('an ambiguous task control asks for its target and sends no cancellation',async()=>{
  const payloads=[];
  const client=new DelegatedTaskClient({conversationId:'root',request:async payload=>{payloads.push(payload);return {tasks:[{id:'a',status:'running'},{id:'b',status:'needs-input'}]};}});
  assert.equal((await client.run({args:{action:'cancel'}},'No, dejá')).needsClarification,true);
  assert.ok(payloads.every(p=>p.operation==='delegatedTaskStatus'));
});
test('a voice cancellation rebinds its notification before publishing the terminal task',async()=>{
  const order=[];
  const client=new DelegatedTaskClient({conversationId:'root',onChange:tasks=>{if(tasks[0]?.status==='cancelled')order.push('published');},request:async payload=>({tasks:[{id:'a',status:payload.operation==='delegatedTaskControl'?'cancelled':'running'}]})});
  await client.run({args:{action:'cancel',taskId:'a'}},'Cancelá la tarea',{onAccepted:()=>order.push('bound')});
  assert.deepEqual(order,['bound','published']);
});


test('pause preserves pending slots and confirmation while active execution refuses a false pause',async()=>{
  const f=await setup();const task=await f.create('v6_pause');
  const blocked=await f.control(task,'pause');assert.equal(blocked.needsClarification,true);
  assert.equal(blocked.tasks[0].status,'running');
  await f.run(task);const waiting=(await f.list())[0];
  assert.equal(waiting.status,'needs-input');
  const paused=await f.control(waiting,'pause');assert.equal(paused.tasks[0].status,'paused');
  await f.control(waiting,'pause');assert.equal((await f.list())[0].status,'paused','same receipt is idempotent');
  const resumed=await f.control(waiting,'resume');assert.equal(resumed.tasks[0].status,'needs-input');
});

test('voice delivery receipts reject stale revisions and foreign owners without modifying business state',async()=>{
  const f=await setup();const task=await f.create('v6_delivery');await f.run(task);const current=(await f.list())[0];
  const body={conversationId:f.parent,taskId:task.id,notificationKey:current.notification.key};
  const ack=()=>acknowledgeTaskNotification({...f.args(),body});
  assert.equal((await acknowledgeTaskNotification({...f.args(),body:{...body,notificationKey:'stale'}})).acknowledged,false);
  await assert.rejects(acknowledgeTaskNotification({...f.args(),session:{...f.session,uid:'foreign'},body}));
  assert.equal((await ack()).acknowledged,true);assert.equal((await ack()).acknowledged,true);
  assert.equal((await f.list())[0].notification.delivered,true);
  assert.equal(f.documents.get('locationStock/local_a/items/oil').currentStock,4);
});
