export class ConversationNotifications {
  constructor({now=()=>performance.now(),progressIntervalMs=20000}={}){this.now=now;this.progressIntervalMs=progressIntervalMs;this.queue=[];this.known=new Set();this.attempts=new Map();this.firstSeen=new Map();this.lastProgressAt=now();this.latest=new Map();}
  enqueue(item){
    const task=item.result?.task || item.result;
    if(task?.notification?.delivered)return false;
    const progress=['running','queued','dispatching'].includes(task?.status);
    if(progress && (!task.progress?.revision || !task.notification?.eligible))return false;
    const key=task?.notification?.key || [item.taskId || item.call?.id,task?.requestId || '',task?.status || (task?.error?'error':'result')].join(':');
    if(this.known.has(key) || (this.attempts.get(key) || 0)>=2)return false;
    if(item.taskId){
      const latest=this.latest.get(item.taskId);
      if(latest && latest.requestId===task.requestId && ((latest.terminal && progress) || (progress && (task.progress?.revision || 0)<latest.revision)))return false;
      this.latest.set(item.taskId,{requestId:task.requestId,revision:task.progress?.revision || 0,terminal:["completed","cancelled","failed"].includes(task.status)});
      if(!this.firstSeen.has(item.taskId))this.firstSeen.set(item.taskId,this.now());
      // A newer state replaces queued progress or an older result of this task.
      this.queue=this.queue.filter(old=>{if(old.taskId!==item.taskId)return true;this.known.delete(old.notificationKey);return false;});
    }
    const eligibleAt=progress?Math.max(this.lastProgressAt+this.progressIntervalMs,this.firstSeen.get(item.taskId)+this.progressIntervalMs):this.now();
    while(this.known.size>=500)this.known.delete(this.known.values().next().value);
    while(this.attempts.size>=500)this.attempts.delete(this.attempts.keys().next().value);
    this.known.add(key);this.queue.push({...item,notificationKey:key,progressNotification:progress,eligibleAt});return true;
  }
  take(){for(const item of this.queue)if(item.progressNotification)item.eligibleAt=Math.max(item.eligibleAt,this.lastProgressAt+this.progressIntervalMs);const i=this.queue.findIndex(item=>item.eligibleAt<=this.now());if(i<0)return null;const [item]=this.queue.splice(i,1);this.attempts.set(item.notificationKey,(this.attempts.get(item.notificationKey)||0)+1);return item;}
  complete(turn){if(turn.progressNotification)this.lastProgressAt=this.now();}
  interrupted(turn){if(turn.notificationKey)this.known.delete(turn.notificationKey);}
  nextDelay(){return this.queue.length?Math.max(0,Math.min(...this.queue.map(i=>i.eligibleAt))-this.now()):null;}
  snapshot(){return {pending:this.queue.length,attempted:this.attempts.size,progressIntervalMs:this.progressIntervalMs};}
}
