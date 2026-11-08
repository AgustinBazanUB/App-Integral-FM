const labels={accepted:'Solicitud recibida',processing:'Revisando la solicitud','tool-started':'Consultando la información necesaria','tool-finished':'Terminó una comprobación'};
export function appendTaskProgress(previous,event,now) {
  if(!labels[event.kind])return previous || null;
  const tool=/^[a-z_]{1,80}$/.test(event.tool || '')?event.tool:null;
  if(previous?.kind===event.kind && previous?.tool===tool)return previous;
  const entry={revision:(previous?.revision || 0)+1,kind:event.kind,label:labels[event.kind],tool,at:now};
  return {...entry,events:[...(previous?.events || []),entry].slice(-12)};
}
