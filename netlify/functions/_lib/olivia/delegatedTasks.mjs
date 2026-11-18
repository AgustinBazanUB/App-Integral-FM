import { createHash } from 'node:crypto';
import { assertConversationOwner, message, retainedMessage, trimMessages } from './conversations.mjs';
import { startChatJob, chatJobStatus, cancelChatJob } from './chatJobs.mjs';
import { safeId, oliviaError } from '../../../../src/shared/oliviaContracts.mjs';
import { safeUserMessage } from './provider.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pathFor = (parent, id) => `oliviaConversations/${parent}/delegatedTasks/${id}`;
const active = task => ['queued','dispatching','running'].includes(task.status);
const dateMs = value => new Date(value).getTime();
const publicTask = task => ({ id:task.id, requestId:task.requestId, jobId:task.jobId || null, status:task.status, phase:task.phase || '', summary:task.summary || '', pendingAction:task.pendingAction || null, priority:task.priority, dependsOn:task.dependsOn || [], createdAt:task.createdAt, updatedAt:task.updatedAt, failure:task.failure || null, telemetry:task.telemetry || null });
async function ownedRoot(store, session, id, now) {
  const root = await store.get(`oliviaConversations/${safeId(id)}`);
  assertConversationOwner(session, root, now);
  if(root.internalTask)throw oliviaError('invalid-input','La tarea necesita su conversación principal.');
  return root;
}
async function ownedTask(store, session, parent, id, now) {
  const root=await ownedRoot(store,session,parent,now);
  if(!(root.delegatedTaskIds || []).includes(safeId(id)))throw oliviaError('task-not-found','La tarea no pertenece a esta conversación.',404);
  const task=await store.get(pathFor(parent,id));
  if(!task)throw oliviaError('task-not-found','No se encontró la tarea.',404);
  return task;
}

// Each task uses an isolated scope of the EXISTING engine and chatJobs queue.
// This keeps its slots/confirmation/lease independent without duplicating tools,
// model integrations, transactional mutations or authority checks.
export async function startDelegatedTask({store,engine,session,body,dispatch,now=new Date()}) {
  const parent=safeId(body.conversationId), requestId=safeId(body.requestId);
  const text=safeUserMessage(body.message);
  const id=body.taskId ? safeId(body.taskId) : hash([session.uid,parent,requestId]);
  const path=pathFor(parent,id), fingerprint=hash([text,body.taskId || null,body.dependsOn || [],body.priority || 'normal']);
  const attemptKey=hash(requestId);
  await ownedRoot(store,session,parent,now);
  await store.transaction(async tx=>{
    const root=(await tx.getDocument(`oliviaConversations/${parent}`))?.data;
    assertConversationOwner(session,root,now);
    const previous=(await tx.getDocument(path))?.data;
    const attempt=previous?.requests?.[attemptKey];
    if(attempt){if(attempt!==fingerprint)throw oliviaError('request-already-used','El intento ya corresponde a otra solicitud.',409);return;}
    if(previous?.requestId===requestId){if(previous.fingerprint!==fingerprint)throw oliviaError('request-already-used','El intento ya corresponde a otra solicitud.',409);return;}
    if(body.taskId && (!(root.delegatedTaskIds || []).includes(id) || !previous))throw oliviaError('task-not-found','La tarea no pertenece a esta conversación.',404);
    if(previous && active(previous))throw oliviaError('task-busy','Esta tarea sigue trabajando. Podés comenzar otra independiente.',409);
    if(previous && !['needs-input','awaiting-confirmation','failed'].includes(previous.status))throw oliviaError('task-terminal','La tarea ya terminó. Iniciá una nueva solicitud explícita.',409);
    if((previous?.attempt || 0)>=20)throw oliviaError('task-limit','La tarea alcanzó su límite de intentos.',409);
    if(!previous && (root.delegatedTaskIds || []).length>=20)throw oliviaError('task-limit','Esta conversación alcanzó veinte tareas. Iniciá una nueva.',409);
    const dependencies=Array.isArray(body.dependsOn)?[...new Set(body.dependsOn.map(safeId))].slice(0,5):[];
    for(const dependency of dependencies)if(dependency===id || !(root.delegatedTaskIds || []).includes(dependency))throw oliviaError('invalid-task-dependency','La dependencia debe ser una tarea anterior de esta conversación.');
    const scopeId=previous?.scopeId || `task_${id}`;
    const writes=[];
    if(!previous)writes.push({type:'create',path:`oliviaConversations/${scopeId}`,data:{id:scopeId,userId:root.userId,sessionBinding:root.sessionBinding,roleBinding:root.roleBinding,permissionScope:root.permissionScope,historyStorageVersion:root.historyStorageVersion || 1,internalTask:true,parentConversationId:parent,delegatedTaskIds:[],messages:(root.messages || []).slice(-8),messageCount:0,state:'INFORMACION',taskState:null,memory:null,draft:null,pendingActionId:null,activeChatJobId:null,queuedChatRequestId:null,busyRequestId:null,busyUntil:null,title:text.slice(0,80),createdAt:now,updatedAt:now,expiresAt:root.expiresAt}});
    const requests={...(previous?.requests || {}),[attemptKey]:fingerprint};
    writes.push({type:previous?'update':'create',path,data:{id,parentConversationId:parent,scopeId,requestId,fingerprint,requests,message:text,screenContext:body.screenContext || {},status:'queued',phase:'En cola',priority:['low','high'].includes(body.priority)?body.priority:'normal',dependsOn:dependencies,jobId:null,pendingAction:null,summary:previous?.summary || '',attempt:(previous?.attempt || 0)+1,createdAt:previous?.createdAt || now,updatedAt:now,expiresAt:root.expiresAt}});
    if(!previous)writes.push({type:'update',path:`oliviaConversations/${parent}`,data:{delegatedTaskIds:[...(root.delegatedTaskIds || []),id]}});
    await tx.commitDocuments(writes);
  });
  await pumpDelegatedTasks({store,engine,session,parent,dispatch,now});
  return publicTask(await ownedTask(store,session,parent,id,now));
}

export async function listDelegatedTasks({store,engine,session,parent,dispatch,now=new Date()}) {
  const root=await ownedRoot(store,session,parent,now);
  for(const id of root.delegatedTaskIds || []) {
    const task=await store.get(pathFor(parent,id));
    if(!task?.jobId || !active(task))continue;
    const status=await chatJobStatus({store,session,body:{jobId:task.jobId},now});
    const result=status.result;
    const summary=result?.pendingAction?.summary || result?.messages?.filter(m=>m.role==='assistant').at(-1)?.voiceTranscript || result?.messages?.filter(m=>m.role==='assistant').at(-1)?.content || status.failure?.message || '';
    const nextStatus=status.status==='completed' ? result?.pendingAction?'awaiting-confirmation':result?.state==='DATOS_INCOMPLETOS'?'needs-input':result?.failure?'failed':'completed' : status.status==='queued'?'running':status.status;
    await store.transaction(async tx=>{
      const current=(await tx.getDocument(pathFor(parent,id)))?.data;
      if(current?.jobId!==task.jobId || !active(current))return;
      const rootDoc=(await tx.getDocument(`oliviaConversations/${parent}`))?.data;
      const writes=[{type:'update',path:pathFor(parent,id),data:{status:nextStatus,phase:status.phase,summary,pendingAction:result?.pendingAction || null,failure:status.failure || result?.failure || null,telemetry:result?.telemetry || null,updatedAt:now}}];
      if(!['queued','running'].includes(status.status) && current.recordedJobId!==task.jobId){
        const userEntry=message('user',current.message,now,'natural-voice');
        const assistantEntry=message('assistant',summary || 'La tarea terminó sin respuesta disponible.',now,'natural-voice');
        writes.push(retainedMessage(parent,userEntry),retainedMessage(parent,assistantEntry),{type:'update',path:`oliviaConversations/${parent}`,data:{messages:trimMessages([...(rootDoc.messages || []),userEntry,assistantEntry]),messageCount:(rootDoc.messageCount || 0)+2,updatedAt:now}},{type:'update',path:pathFor(parent,id),data:{recordedJobId:task.jobId}});
      }
      await tx.commitDocuments(writes);
    });
  }
  await pumpDelegatedTasks({store,engine,session,parent,dispatch,now});
  const fresh=await ownedRoot(store,session,parent,now);
  return Promise.all((fresh.delegatedTaskIds || []).map(async id=>publicTask(await store.get(pathFor(parent,id)))));
}

export async function pumpDelegatedTasks({store,engine,session,parent,dispatch,now=new Date()}) {
  // Root transaction is the concurrency arbiter across multiple Functions.
  const claimed=[];
  await store.transaction(async tx=>{
    claimed.length=0;
    const root=(await tx.getDocument(`oliviaConversations/${parent}`))?.data;
    assertConversationOwner(session,root,now);
    const tasks=[];
    for(const id of root.delegatedTaskIds || []){const t=(await tx.getDocument(pathFor(parent,id)))?.data;if(t)tasks.push(t);}
    const stale=tasks.filter(t=>t.status==='dispatching' && dateMs(t.dispatchLeaseUntil)<=now.getTime());
    for(const task of stale)task.status='queued';
    const liveCount=tasks.filter(t=>['dispatching','running'].includes(t.status)).length;
    const rank={high:0,normal:1,low:2};
    const queued=tasks.filter(t=>t.status==='queued').sort((a,b)=>(rank[a.priority]-rank[b.priority]) || (new Date(a.createdAt)-new Date(b.createdAt)));
    const writes=[];
    for(const task of queued){
      const deps=task.dependsOn.map(id=>tasks.find(t=>t.id===id));
      if(deps.some(d=>['failed','cancelled'].includes(d?.status))){writes.push({type:'update',path:pathFor(parent,task.id),data:{status:'failed',failure:{code:'dependency-failed',message:'Una tarea previa falló o fue cancelada.'},updatedAt:now}});continue;}
      if(deps.some(d=>d?.status!=='completed') || liveCount+claimed.length>=3)continue;
      claimed.push(task);writes.push({type:'update',path:pathFor(parent,task.id),data:{status:'dispatching',dispatchLeaseUntil:new Date(now.getTime()+30000),updatedAt:now}});
    }
    const delegatedContext={activeTask:tasks.some(t=>active(t)||['confirming','cancelling'].includes(t.status)),collectingTask:tasks.some(t=>t.status==='needs-input'),pendingAction:tasks.some(t=>t.status==='awaiting-confirmation')};
    if(JSON.stringify(root.delegatedContext)!==JSON.stringify(delegatedContext))writes.push({type:'update',path:`oliviaConversations/${parent}`,data:{delegatedContext}});
    if(writes.length)await tx.commitDocuments(writes);
  });
  for(const task of claimed){
    try{
      const job=await startChatJob({store,engine,session,body:{conversationId:task.scopeId,requestId:task.requestId,message:task.message,screenContext:task.screenContext,inputMode:'natural-voice'},dispatch,now,dispatchQueued:true});
      let cancelled=false;
      await store.transaction(async tx=>{
        const current=(await tx.getDocument(pathFor(parent,task.id)))?.data;
        if(current.status!=='dispatching' || current.requestId!==task.requestId){cancelled=true;return;}
        await tx.commitDocuments([{type:'update',path:pathFor(parent,task.id),data:{jobId:job.jobId,status:'running',phase:'Ejecutando tarea delegada',updatedAt:now}}]);
      });
      if(cancelled)await cancelChatJob({store,session,body:{jobId:job.jobId},now});
    }catch(error){await store.transaction(async tx=>{
      const current=(await tx.getDocument(pathFor(parent,task.id)))?.data;
      if(current.status==='dispatching' && current.requestId===task.requestId)await tx.commitDocuments([{type:'update',path:pathFor(parent,task.id),data:{status:'failed',failure:{code:error.code || 'task-dispatch-failed',message:error.message},updatedAt:now}}]);
    });}
  }
}

export async function controlDelegatedTask({store,engine,session,body,dispatch,now=new Date()}) {
  const parent=safeId(body.conversationId),id=safeId(body.taskId);
  await ownedTask(store,session,parent,id,now);
  const confirming=body.action==='confirm', cancelling=body.action==='cancel';
  if(!confirming && !cancelling)throw oliviaError('invalid-operation','Control de tarea no disponible.');
  const controlId=safeId(body.requestId), controlStatus=confirming?'confirming':'cancelling';
  let task, alreadyFinished=false;
  await store.transaction(async tx=>{
    task=(await tx.getDocument(pathFor(parent,id)))?.data;
    if(task.lastControlId===controlId){alreadyFinished=true;return;}
    if(['confirming','cancelling'].includes(task.status)){
      if(task.controlId!==controlId || task.status!==controlStatus)throw oliviaError('task-busy','Hay un control de esta tarea en curso.',409);
      return;
    }
    if(['completed','cancelled'].includes(task.status))throw oliviaError('task-terminal','La tarea ya terminó. Su resultado no se revierte automáticamente.',409);
    if(confirming && (body.visualConfirmation!==true || task.status!=='awaiting-confirmation' || body.actionId!==task.pendingAction?.id))throw oliviaError('confirmation-required','Revisá y confirmá la tarjeta actual en pantalla.',409);
    await tx.commitDocuments([{type:'update',path:pathFor(parent,id),data:{status:controlStatus,controlId,controlPreviousStatus:task.status,updatedAt:now}}]);
  });
  if(alreadyFinished)return {tasks:await listDelegatedTasks({store,engine,session,parent,dispatch,now})};
  let result;
  try{
    if(cancelling){
      if(task.jobId)await cancelChatJob({store,session,body:{jobId:task.jobId},now});
      result=await engine.cancel(session,{conversationId:task.scopeId});
    }else result=await engine.confirm(session,{conversationId:task.scopeId,actionId:body.actionId,confirmationToken:body.confirmationToken,requestId:controlId});
  }catch(error){
    await store.transaction(async tx=>{
      const current=(await tx.getDocument(pathFor(parent,id)))?.data;
      if(current.controlId===controlId && current.status===controlStatus)await tx.commitDocuments([{type:'update',path:pathFor(parent,id),data:{status:current.controlPreviousStatus || task.status,updatedAt:now}}]);
    });
    throw error;
  }
  await store.transaction(async tx=>{
    const current=(await tx.getDocument(pathFor(parent,id)))?.data;
    if(current.lastControlId===controlId)return;
    if(current.controlId!==controlId)throw oliviaError('task-changed','La tarea cambió durante el control.',409);
    const root=(await tx.getDocument(`oliviaConversations/${parent}`))?.data;
    const summary=result.messages?.filter(m=>m.role==='assistant').at(-1)?.content || (cancelling?'La tarea quedó cancelada.':'Operación verificada.');
    const entry=message('assistant',summary,now,'natural-voice');
    await tx.commitDocuments([
      {type:'update',path:pathFor(parent,id),data:{status:cancelling?'cancelled':'completed',pendingAction:null,summary,lastControlId:controlId,updatedAt:now}},
      retainedMessage(parent,entry),{type:'update',path:`oliviaConversations/${parent}`,data:{messages:trimMessages([...(root.messages || []),entry]),messageCount:(root.messageCount || 0)+1,updatedAt:now}},
    ]);
  });
  return {tasks:await listDelegatedTasks({store,engine,session,parent,dispatch,now})};
}
