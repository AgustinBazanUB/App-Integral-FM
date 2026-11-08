import { Button } from '../../design-system';
import OliviaMessageContent from './OliviaMessageContent';
const labels={queued:'Solicitud recibida',dispatching:'Preparando',running:'Trabajando en tu solicitud',confirming:'Verificando operación',cancelling:'Cancelando solicitud',paused:'Pausada','needs-input':'Necesito un dato','awaiting-confirmation':'Esperando confirmación',completed:'Resultado verificado',failed:'No pude completar la solicitud',cancelled:'Cancelada'};
export default function OliviaDelegatedTasks({tasks,onControl,busyId,developer=false}){
  if(!tasks.length)return null;
  const active=tasks.filter(t=>['queued','dispatching','running','confirming','cancelling'].includes(t.status));
  const visible=developer?tasks:tasks.filter(t=>['awaiting-confirmation','needs-input','paused'].includes(t.status));
  return <section className="fm-olivia-delegated-tasks" aria-label="Tareas de Olivia" aria-live="polite">
    {developer?<h3>Tareas de Olivia</h3>:active.length?<p>Estoy trabajando en {active.length===1?'tu solicitud':`${active.length} solicitudes`}. Podemos seguir conversando.</p>:null}
    {visible.map(task=><article key={task.id} data-olivia-task={task.id}>
      <strong>{labels[task.status] || task.status}</strong>
      <OliviaMessageContent content={typeof task.summary==='string'?(task.summary || task.phase || 'Solicitud recibida'):'Pedile a Olivia que prepare un resumen legible antes de confirmar.'} />
      {task.pendingAction && task.status==='awaiting-confirmation'?<><p>Revisá esta operación. Solo se ejecuta al tocar Sí.</p><Button disabled={busyId===task.id || typeof task.summary!=='string' || !task.summary.trim()} onClick={()=>onControl(task,'confirm')}>Sí, confirmar operación</Button></>:null}
      {task.status==='paused'?<Button disabled={busyId===task.id} onClick={()=>onControl(task,'resume')}>Retomar</Button>:null}
      {developer?<small>{task.id} · {task.status} · {task.progress?.label || 'Sin fase informada'} · aviso {task.notification?.delivered?'entregado':'pendiente'}</small>:null}
      {!['completed','failed','cancelled','confirming','cancelling'].includes(task.status)?<Button variant="secondary" disabled={busyId===task.id} onClick={()=>onControl(task,'cancel')}>Cancelar tarea</Button>:null}
      {task.failure && developer?<p role="alert">{task.failure.message}</p>:null}
    </article>)}
  </section>;
}
