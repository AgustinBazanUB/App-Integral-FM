import { normalizeSpeech } from '../../../../src/shared/oliviaFastSpeech.mjs';

const normalize = value => normalizeSpeech(value).replace(/\b(?:el|la|los|las|de|del)\b/g,' ').replace(/\s+/g,' ').trim();
export function formatQuickRead(tool, result, { priceOnly = false } = {}) {
  const data=result?.data;
  if (!data || result.state || data.code) return null;
  if (tool==='get_stock') {
    if(!data.name || !data.locationName || !Number.isFinite(data.currentStock) || (priceOnly && !Number.isFinite(data.price))) return null;
    return priceOnly ? `${data.name}: ${new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(data.price)} en ${data.locationName}.` : `${data.name}: ${data.currentStock} unidades en ${data.locationName}.`;
  }
  if (tool==='get_customer' && data.customers?.length===1) {
    const customer=data.customers[0];
    return `${customer.name || 'Cliente'}${customer.phone ? ', teléfono '+customer.phone : ', sin teléfono registrado'}${customer.zoneName ? ', zona '+customer.zoneName : ''}.`;
  }
  return null;
}
export async function fastConversationRead({ plan, context, previous, run, check, signal, now = new Date() }) {
  if(!plan) return null;
  const checkCurrent=()=>signal?.throwIfAborted();
  if(plan.kind==='customer') {
    check('search_customers');
    if(!plan.query) return {content:'¿Qué cliente buscás? Pasame el nombre o el teléfono y lo busco.',state:'DATOS_INCOMPLETOS'};
    const found=await run('search_customers',{query:plan.query});checkCurrent();
    const customers=found.data?.customers || [];
    if(customers.length===1) return {content:formatQuickRead('get_customer',{data:{customers}}),state:'INFORMACION'};
    return {content:customers.length ? `Encontré ${customers.slice(0,5).map(c=>c.name || 'un cliente sin nombre').join(', ')}. ¿Cuál buscás?` : found.data?.partial ? 'No apareció en los 150 clientes consultados. Pasame otro dato o buscalo en Clientes.' : 'No encontré ese cliente. ¿Tenés otro nombre o teléfono?',state:'DATOS_INCOMPLETOS'};
  }
  check('get_stock');check('search_products');
  let locationId=context.locationId || null;
  if(plan.locationQuery || !locationId) {
    const locations=(await run('list_locations',{})).data?.locations || [];checkCurrent();
    const query=normalize(plan.locationQuery || '');
    const exact=locations.filter(l=>normalize(l.name)===query);
    const matches=query ? exact.length ? exact : locations.filter(l=>query.split(' ').every(word=>normalize(l.name).split(' ').includes(word))) : locations;
    if(matches.length!==1) return {content:matches.length ? `¿En qué ubicación: ${matches.slice(0,5).map(l=>l.name).join(' o ')}?` : 'No encontré una ubicación permitida con ese nombre. ¿Cuál querés consultar?',state:'DATOS_INCOMPLETOS'};
    locationId=matches[0].id || matches[0].locationId;
  }
  let found=(await run('search_products',{query:plan.query,locationId})).data?.products || [];checkCurrent();
  if(!found.length && plan.query.includes(' ')) {found=(await run('search_products',{query:plan.query.split(' ')[0],locationId})).data?.products || [];checkCurrent();}
  const words=normalize(plan.query).split(' ').filter(Boolean), exact=found.filter(p=>normalize(p.name)===normalize(plan.query));
  const matches=exact.length ? exact : found.filter(p=>words.length && words.every(word=>normalize(p.name).split(' ').includes(word)));
  if(matches.length!==1) return {content:matches.length ? `Encontré ${matches.slice(0,5).map(p=>p.name).join(' o ')}. ¿Qué presentación querés consultar?` : 'No pude identificar ese producto en la búsqueda acotada. Decime el nombre o la presentación.',state:'DATOS_INCOMPLETOS'};
  const product=matches[0];
  // Search already read fresh product + location stock through the authorized tools.
  const content=formatQuickRead('get_stock',{data:product},{priceOnly:plan.kind==='price'});
  if(!content) return null;
  return {content,state:'INFORMACION',taskState:{id:previous?.id || crypto.randomUUID(),intent:'get_stock',status:'completed',revision:(previous?.revision || 0)+1,slots:{locationId,productId:product.productId},missingFields:[],ambiguities:{},updatedAt:now,createdAt:now},observedAt:product.observedAt};
}
