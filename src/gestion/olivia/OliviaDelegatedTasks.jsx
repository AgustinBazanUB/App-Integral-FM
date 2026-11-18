import { Button } from '../../design-system';
import OliviaMessageContent from './OliviaMessageContent';
const labels={queued:'Solicitud recibida',dispatching:'Preparando',running:'Trabajando en tu solicitud',confirming:'Verificando operación',cancelling:'Cancelando solicitud',paused:'Pausada','needs-input':'Necesito un dato','awaiting-confirmation':'Esperando confirmación',completed:'Resultado verificado',failed:'No pude completar la solicitud',cancelled:'Cancelada'};
export default function OliviaDelegatedTasks({tasks=[],onControl,busyId,developer=false,panel=false}){
  const fullView=developer || panel;
  if(!tasks.length)return panel?<section className="fm-olivia-delegated-tasks fm-olivia-delegated-tasks--panel" aria-label="Tareas de Olivia" aria-live="polite"><h3>Tareas de Olivia</h3><p>No hay tareas delegadas en esta conversación.</p></section>:null;
  const visible=fullView?tasks:tasks.filter(t=>t.status==='awaiting-confirmation' && t.pendingAction);
  if(!visible.length)return null;
  return <section className={`fm-olivia-delegated-tasks${panel?' fm-olivia-delegated-tasks--panel':''}`} aria-label="Tareas de Olivia" aria-live="polite">
    {fullView?<h3>Tareas de Olivia ({visible.length})</h3>:null}
    {visible.map(task=><article key={task.id} data-olivia-task={task.id} data-task-status={task.status}>
      <strong>{labels[task.status] || task.status}</strong>
      <OliviaMessageContent content={typeof (task.fullResult || task.summary)==='string'?((task.fullResult || task.summary) || task.phase || 'Solicitud recibida'):'Pedile a Olivia que prepare un resumen legible antes de confirmar.'} />
      {fullView && task.voiceSummary && task.voiceSummary!==(task.fullResult || task.summary)?<details className="fm-olivia-task-voice"><summary>Resumen hablado</summary><p>{task.voiceSummary}</p></details>:null}
      {task.pendingAction && task.status==='awaiting-confirmation'?<><p>Revisá esta operación. Solo se ejecuta al tocar Sí.</p><Button disabled={busyId===task.id || typeof task.summary!=='string' || !task.summary.trim()} onClick={()=>onControl(task,'confirm')}>Sí, confirmar operación</Button></>:null}
      {fullView && ['needs-input','awaiting-confirmation'].includes(task.status)?<Button variant="secondary" disabled={busyId===task.id} onClick={()=>onControl(task,'pause')}>Pausar</Button>:null}
      {fullView && task.status==='paused'?<Button disabled={busyId===task.id} onClick={()=>onControl(task,'resume')}>Retomar</Button>:null}
      {fullView?<small>{task.id.slice(0,12)} · {task.status} · prioridad {task.priority || 'normal'} · {task.progress?.label || task.phase || 'Sin fase informada'} · aviso {task.notification?.delivered?'entregado':'pendiente'}</small>:null}
      {(fullView && !['completed','failed','cancelled','confirming','cancelling'].includes(task.status) || !fullView && task.status==='awaiting-confirmation')?<Button variant="secondary" disabled={busyId===task.id} onClick={()=>onControl(task,'cancel')}>{fullView?'Cancelar tarea':'No, rechazar operación'}</Button>:null}
      {task.failure && fullView?<p role="alert">{task.failure.message}</p>:null}
    </article>)}
  </section>;
}
