const amount=value=>Number.isFinite(value)&&value>=0?value:null;

// Provider reports replace their own part; late task notices never select a
// different user interaction. Uncorrelated costs remain only in monthly totals.
export class InteractionCosts {
  constructor(){this.rows=new Map();this.latest=null;}
  begin(id){if(!id)return;this.latest=id;if(!this.rows.has(id))this.rows.set(id,new Map([['pending',{usd:null}]]));while(this.rows.size>50)this.rows.delete(this.rows.keys().next().value);}
  voice(id,usage,key){const row=this.rows.get(id);if(!row)return;row.delete('pending');row.set('gemini:'+key,{usd:amount(usage?.costUsd ?? usage?.estimatedCostUsd),estimated:usage?.measurement!=='provider-forwarded'});}
  task(id,task){const row=this.rows.get(id);if(!row)return;const key='task:'+task.id;row.delete(key+':pending');if(['queued','running','dispatching','confirming','cancelling'].includes(task.status))row.set(key+':pending',{usd:null});this.luna(id,task.telemetry,key,false);}
  luna(id,telemetry,key='text',clearPending=true){const row=this.rows.get(id);if(!row)return;if(clearPending)row.delete('pending');const calls=telemetry?.calls;if(Array.isArray(calls)){row.delete(key+':unconfirmed');for(const [i,call] of calls.entries())row.set(key+':'+(call.responseId || i),{usd:amount(call.actualCostUsd),estimated:true});if(!calls.length&&telemetry.modelCalls===0)row.set(key+':no-provider',{usd:0});}else row.set(key+':unconfirmed',{usd:null});}
  summary(){const row=this.rows.get(this.latest);if(!row)return null;const parts=[...row.values()],known=parts.filter(p=>p.usd!==null);return {usd:known.length?known.reduce((sum,p)=>sum+p.usd,0):null,pending:parts.some(p=>p.usd===null),estimated:known.some(p=>p.estimated)};}
}

export function monthlyProviderSummary(usage){
  const gemini=amount(usage?.spendUsd),luna=amount(usage?.lunaSol?.estimatedUsd);
  return {usd:gemini!==null&&luna!==null?gemini+luna:null,period:usage?.period || null,pending:Number(usage?.unconfirmedQueryCount || 0)+Number(usage?.lunaSol?.unconfirmedCalls || 0)};
}
