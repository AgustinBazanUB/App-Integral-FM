const running = task => ['queued','dispatching','running'].includes(task.status);
const aborted = () => new DOMException('La vista se cerró; las tareas persistidas se conservan.','AbortError');
export class DelegatedTaskClient {
  constructor({request,conversationId,onChange=()=>{},onTrace=()=>{},delay=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>performance.now()}) {
    Object.assign(this,{request,conversationId,onChange,onTrace,delay,now});this.tasks=[];this.closed=false;this.controlIds=new Map();
  }
  publish(tasks){this.tasks=tasks; if(!this.closed)this.onChange(tasks);}
  async refresh(){
    if(this.closed)throw aborted();
    if(this.refreshing)return this.refreshing;
    this.refreshing=this.request({operation:'delegatedTaskStatus',conversationId:this.conversationId}).then(r=>{this.publish(r.tasks || []);return this.tasks;}).finally(()=>{this.refreshing=null;});
    return this.refreshing;
  }
  async run(call,text,context={}) {
    this.runningRequests=(this.runningRequests || 0)+1;
    try{return await this.runTask(call,text,context);}finally{this.runningRequests--;}
  }
  async runTask(call,text,context={}) {
    const args=call.args || {};
    if(args.action==='status')return {tasks:await this.refresh()};
    let taskId=args.action==='new'?null:args.taskId || null;
    if(['continue','cancel'].includes(args.action) && !taskId){
      const candidates=(await this.refresh()).filter(t=>!['completed','cancelled','failed'].includes(t.status));
      if(candidates.length!==1)return {needsClarification:true,summary:'Preguntá a cuál tarea se refiere; no se ejecutó ni canceló ninguna.',tasks:candidates};
      taskId=candidates[0].id;
    }
    if(args.action==='cancel'){
      if(!/\b(?:cancel\w*|deja|dejalo|olvida\w*|detene\w*|no sigas|no continues)\b/.test(normalizeSpeech(text)))return {needsClarification:true,summary:'Pedí que aclare si desea cancelar; no se detuvo ninguna tarea.',tasks:this.tasks};
      const candidates=(await this.refresh()).filter(t=>!['completed','cancelled','failed'].includes(t.status));
      if(candidates.length>1 && /^(?:no )?(?:deja|dejalo|cancela|cancelalo|olvidalo)(?: por favor)?$/.test(normalizeSpeech(text)))return {needsClarification:true,summary:'Hay varias tareas. Preguntá cuál debe cancelarse.',tasks:candidates};
      return this.control({action:'cancel',taskId});
    }
    const identity=context.requestId || globalThis.crypto.randomUUID(),at=this.now();
    const payload={operation:'delegatedTask',conversationId:this.conversationId,requestId:identity,message:text,...(taskId?{taskId}:{}),priority:args.priority || 'normal',dependsOn:args.dependsOn || [],screenContext:context.screenContext || {}};
    let task;
    for(let attempt=0;attempt<3;attempt++){
      try{task=await this.request(payload);break;}catch(error){
        if(attempt===2 || !(['olivia-network-error','olivia-timeout'].includes(error.code)||error.status>=500))throw error;
        await this.delay(500*(attempt+1));
      }
    }
    this.publish([...this.tasks.filter(t=>t.id!==task.id),task]);
    this.onTrace('task.accepted',{turnId:context.turnId,sessionId:context.sessionId,taskId:task.id,jobId:task.jobId,requestId:identity,durationMs:this.now()-at,status:task.status});
    context.onAccepted?.(task);
    while(running(task)){
      if(this.closed)throw aborted();
      await this.delay(1500);
      const tasks=await this.refresh();task=tasks.find(t=>t.id===task.id);
      if(!task)throw new Error('La tarea ya no está disponible.');
    }
    this.onTrace('task.result',{turnId:context.turnId,sessionId:context.sessionId,taskId:task.id,jobId:task.jobId,requestId:identity,durationMs:this.now()-at,status:task.status});
    return task;
  }
  async control(fields){
    const key=[fields.taskId,fields.action,fields.actionId || ''].join(':');
    if(!this.controlIds.has(key))this.controlIds.set(key,globalThis.crypto.randomUUID());
    const result=await this.request({operation:'delegatedTaskControl',conversationId:this.conversationId,requestId:this.controlIds.get(key),...fields});
    this.publish(result.tasks || []);return {tasks:this.tasks,task:this.tasks.find(t=>t.id===fields.taskId)};
  }
  close(){this.closed=true;}
}
import { normalizeSpeech } from '../../shared/oliviaSpeechText.mjs';
