import { Button } from '../../design-system';
import OliviaMessageContent from './OliviaMessageContent';
const labels={queued:'En cola',dispatching:'Iniciando',running:'Ejecutando tarea delegada',confirming:'Verificando operación',cancelling:'Cancelando tarea','needs-input':'Esperando datos','awaiting-confirmation':'Esperando confirmación',completed:'Resultado verificado',failed:'Error',cancelled:'Cancelada'};
export default function OliviaDelegatedTasks({tasks,onControl,busyId}){
  if(!tasks.length)return null;
  return <section className="fm-olivia-delegated-tasks" aria-label="Tareas de Olivia" aria-live="polite">
    <h3>Tareas de Olivia</h3>
    {tasks.map(task=><article key={task.id} data-olivia-task={task.id}>
      <strong>{labels[task.status] || task.status}</strong>
      <OliviaMessageContent content={typeof task.summary==='string'?(task.summary || task.phase || 'Solicitud recibida'):JSON.stringify(task.summary,null,2)} />
      {task.pendingAction && task.status==='awaiting-confirmation'?<><p>Revisá esta operación. Solo se ejecuta al tocar Sí.</p><Button disabled={busyId===task.id} onClick={()=>onControl(task,'confirm')}>Sí, confirmar operación</Button></>:null}
      {!['completed','failed','cancelled','confirming','cancelling'].includes(task.status)?<Button variant="secondary" disabled={busyId===task.id} onClick={()=>onControl(task,'cancel')}>Cancelar tarea</Button>:null}
      {task.failure?<p role="alert">{task.failure.message}</p>:null}
    </article>)}
  </section>;
}
