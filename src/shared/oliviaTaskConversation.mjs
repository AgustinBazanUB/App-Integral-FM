// Facts shared by the existing task engine and voice client. No model call and
// no confirmation credentials belong in these conversational representations.
const finished=new Set(['completed','cancelled','failed']);
export const taskIsActive=task=>!finished.has(task.status) && task.status!=='paused';
export function compactVoiceTask(task={}) {
  return {id:task.id,requestId:task.requestId,status:task.status,phase:task.phase || '',summary:typeof task.summary==='string'?task.summary.slice(0,1200):'',
    ...(task.progress?{progress:{revision:task.progress.revision,kind:task.progress.kind,label:task.progress.label}}:{}),
    ...(task.outcome?{outcome:{kind:task.outcome.kind,retryable:task.outcome.retryable,nextStep:task.outcome.nextStep}}:{}),
    ...(task.pendingAction?{requiresVisualConfirmation:true}:{}),
    ...(task.failure?{error:task.failure.message}: {})};
}
export function compactVoiceContext(conversation={},tasks=[]) {
  return {version:1,messages:(conversation.messages || []).filter(m=>['user','assistant'].includes(m.role)).slice(-8).map(m=>({role:m.role,text:String(m.voiceTranscript || m.content || '').slice(0,700)})),
    tasks:tasks.slice(-20).map(compactVoiceTask),pendingConfirmation:Boolean(conversation.pendingActionId)};
}
export function taskOutcome({status,failure,pendingAction,summary}={}) {
  if(pendingAction || status==='awaiting-confirmation')return {kind:'confirmation-required',retryable:false,nextStep:'Revisar y confirmar la tarjeta en pantalla.'};
  if(status==='needs-input')return {kind:'missing-information',retryable:false,nextStep:String(summary || 'Pedir el dato faltante.').slice(0,500)};
  if(status!=='failed')return null;
  const code=failure?.code || '';
  if(/permission|forbidden|unauthorized/.test(code))return {kind:'permission-denied',retryable:false,nextStep:'Explicar el permiso faltante; no ofrecer ejecutar la operación por otra vía.'};
  if(/unsupported|not-implemented|not-available/.test(code))return {kind:'capability-unavailable',retryable:false,nextStep:'Explicar el límite y pedir si desea consultar información con las herramientas ya disponibles.'};
  if(/not-found|no-data/.test(code))return {kind:'data-not-found',retryable:false,nextStep:'Pedir otra referencia; no inventar datos.'};
  const retryable=/timeout|network|provider|unavailable|rate-limit/.test(code);
  return {kind:retryable?'recoverable-error':'task-error',retryable,nextStep:retryable?'Ofrecer reintentar esta tarea o seguir conversando; no repetir una modificación automáticamente.':'Explicar el problema y pedir cómo desea continuar. La conversación sigue disponible.'};
}
export function selectStatusTasks(tasks,taskId) {
  if(taskId){const task=tasks.find(t=>t.id===taskId);return task?{tasks:[task]}:{needsClarification:true,summary:'No encontré esa tarea en esta conversación.',tasks:[]};}
  const active=tasks.filter(taskIsActive);
  if(active.length>1)return {needsClarification:true,summary:'Hay varias solicitudes pendientes. Preguntá cuál quiere revisar.',tasks:active.map(t=>({...compactVoiceTask(t),summary:t.summary?.slice(0,160) || t.phase}))};
  return {tasks:active.length?active:tasks.slice().sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)).slice(0,1)};
}
