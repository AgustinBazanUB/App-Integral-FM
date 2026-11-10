import { normalizeSpeech } from '../../../../src/shared/oliviaSpeechText.mjs';
import { argentinaDateKey } from '../../../../src/modules/locations/domain/time.js';

const normalize = value => normalizeSpeech(value).replace(/\b(?:el|la|los|las|de|del)\b/g,' ').replace(/\s+/g,' ').trim();
const money = amount => new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(Number(amount || 0));
async function resolveNamedLocation({ locationQuery, context, run, checkCurrent }) {
  let locationId = !locationQuery && context?.locationId ? context.locationId : null;
  if (locationQuery || !locationId) {
    const locations = (await run('list_locations', {}))?.data?.locations || [];
    checkCurrent();
    const query = normalize(locationQuery || '');
    const exact = locations.filter(l => normalize(l.name) === query);
    const matches = query ? (exact.length ? exact : locations.filter(l => query.split(' ').every(word => normalize(l.name).split(' ').includes(word)))) : locations;
    if (matches.length !== 1) {
      return {
        error: matches.length
          ? `¿En qué ubicación: ${matches.slice(0, 5).map(l => l.name).join(' o ')}?`
          : 'No encontré una ubicación permitida con ese nombre. ¿Cuál querés consultar?',
      };
    }
    locationId = matches[0].id || matches[0].locationId;
  }
  return { locationId };
}
export function formatQuickRead(tool, result, { priceOnly = false } = {}) {
  const data=result?.data;
  if (!data || result.state || data.code) return null;
  if (tool==='get_stock') {
    if(!data.name || !data.locationName || !Number.isFinite(data.currentStock) || (priceOnly && !Number.isFinite(data.price))) return null;
    return priceOnly ? `${data.name}: ${money(data.price)} en ${data.locationName}.` : `${data.name}: ${data.currentStock} unidades en ${data.locationName}.`;
  }
  if (tool==='get_customer' && data.customers?.length===1) {
    const customer=data.customers[0];
    return `${customer.name || 'Cliente'}${customer.phone ? ', teléfono '+customer.phone : ', sin teléfono registrado'}${customer.zoneName ? ', zona '+customer.zoneName : ''}.`;
  }
  return null;
}
export async function fastConversationRead({ plan, context = {}, previous, run, check, signal, now = new Date() }) {
  if(!plan) return null;
  const checkCurrent=()=>signal?.throwIfAborted();
  if(plan.kind==='locations') {
    check('list_locations');
    const result=await run('list_locations',{});checkCurrent();
    if(!Array.isArray(result?.data?.locations) || result.state || result.data.code) return null;
    const names=result.data.locations.map(location=>location.name).filter(name=>typeof name==='string' && name.trim());
    return {content:names.length ? `Las ubicaciones activas que podés consultar son: ${names.join(', ')}.${result.data.locations.length>=result.data.limit ? ' La consulta alcanzó su límite; puede haber más ubicaciones permitidas.' : ''}` : 'No encontré ubicaciones activas disponibles con tus permisos.',state:'INFORMACION'};
  }
  if(plan.kind==='customer') {
    check('search_customers');
    if(!plan.query) return {content:'¿Qué cliente buscás? Pasame el nombre o el teléfono y lo busco.',state:'DATOS_INCOMPLETOS'};
    const found=await run('search_customers',{query:plan.query});checkCurrent();
    const customers=found.data?.customers || [];
    if(customers.length===1) return {content:formatQuickRead('get_customer',{data:{customers}}),state:'INFORMACION'};
    return {content:customers.length ? `Encontré ${customers.slice(0,5).map(c=>c.name || 'un cliente sin nombre').join(', ')}. ¿Cuál buscás?` : found.data?.partial ? 'No apareció en los 150 clientes consultados. Pasame otro dato o buscalo en Clientes.' : 'No encontré ese cliente. ¿Tenés otro nombre o teléfono?',state:'DATOS_INCOMPLETOS'};
  }
  if(plan.kind==='today-sales') {
    check('get_today_sales');
    let locationId = !plan.locationQuery && context.locationId ? context.locationId : null;
    if (plan.locationQuery) {
      check('list_locations');
      const resolved = await resolveNamedLocation({ locationQuery: plan.locationQuery, context, run, checkCurrent });
      if (resolved.error) return { content: resolved.error, state: 'DATOS_INCOMPLETOS' };
      locationId = resolved.locationId;
    }
    try {
      const result = await run('get_today_sales', { locationId });
      checkCurrent();
      const data = result?.data;
      if (data && !result.state && !data.code && Number.isFinite(data.count)) {
        const count = Number(data.count || 0);
        const total = money(data.total || 0);
        return {
          content: count
            ? `Hoy se registraron ${count} ${count === 1 ? 'venta' : 'ventas'} por un total de ${total}.${data.partial ? ' (Lectura parcial de las primeras 150 ventas).' : ''}`
            : 'Hoy todavía no hay ventas activas registradas en esta ubicación.',
          state: 'INFORMACION',
          observedAt: data.observedAt || now.toISOString(),
        };
      }
    } catch (error) {
      if (error?.code !== 'location-required') throw error;
      try {
        check('get_sales_metrics');
        const today = argentinaDateKey(now);
        const metrics = await run('get_sales_metrics', { startDate: today, endDate: today, locationId: null, productId: null, sellerId: null });
        checkCurrent();
        const summary = metrics?.data?.summary || metrics?.data?.current || metrics?.data;
        const count = Number(summary?.operations ?? summary?.count ?? summary?.salesCount ?? 0);
        const total = money(summary?.revenue ?? summary?.total ?? summary?.totalSales ?? 0);
        if (summary && !metrics.state) {
          return {
            content: count
              ? `Hoy se registraron ${count} ${count === 1 ? 'venta' : 'ventas'} por un total de ${total}.`
              : 'Hoy todavía no hay ventas activas registradas.',
            state: 'INFORMACION',
          };
        }
      } catch {}
      return { content: '¿De qué ubicación querés consultar las ventas de hoy?', state: 'DATOS_INCOMPLETOS' };
    }
    return null;
  }
  if(plan.kind==='inventory') {
    check('get_inventory_summary');
    let inventoryType = context.warehouseId && !context.locationId && !plan.locationQuery ? 'warehouse' : 'location';
    let inventoryId = inventoryType === 'warehouse' ? context.warehouseId : (!plan.locationQuery ? context.locationId : null);
    if (!inventoryId) {
      check('list_locations');
      const resolved = await resolveNamedLocation({ locationQuery: plan.locationQuery, context, run, checkCurrent });
      if (resolved.error) return { content: resolved.error, state: 'DATOS_INCOMPLETOS' };
      inventoryId = resolved.locationId;
    }
    const result = await run('get_inventory_summary', { inventoryType, inventoryId });
    checkCurrent();
    const data = result?.data;
    if (!data || result.state || data.code || !Array.isArray(data.items)) return null;
    const ownerName = data.owner?.name || 'la ubicación';
    const items = data.items;
    const totalUnits = items.reduce((sum, item) => sum + Math.max(0, Number(item.currentStock || 0)), 0);
    const lowOrZero = items.filter(item => Number(item.currentStock || 0) <= 5);
    const sample = lowOrZero.slice(0, 4).map(item => `${item.productName || item.productId} (${Number(item.currentStock || 0)})`).join(', ');
    return {
      content: items.length
        ? `Resumen de inventario en ${ownerName}: ${items.length} productos activos (${totalUnits} unidades en total).${lowOrZero.length ? ` Con stock bajo o en cero (${lowOrZero.length}): ${sample}.` : ' Todos los productos tienen más de 5 unidades.'}`
        : `No hay productos registrados en el inventario de ${ownerName}.`,
      state: 'INFORMACION',
      observedAt: data.observedAt || now.toISOString(),
    };
  }
  if(plan.kind==='alerts') {
    check('get_alerts');
    const result = await run('get_alerts', { entityId: null });
    checkCurrent();
    const records = (result?.data?.records || []).filter(r => r.active !== false && r.status !== 'resolved' && r.status !== 'closed');
    if (!result?.data || result.state || result.data.code) return null;
    if (!records.length) return { content: 'No hay alertas vigentes registradas en este momento.', state: 'INFORMACION', observedAt: result.data.observedAt };
    const top = records.slice(0, 5).map(r => r.title || r.name || r.code || r.id).join(', ');
    return { content: `Hay ${records.length} ${records.length === 1 ? 'alerta vigente' : 'alertas vigentes'}: ${top}.`, state: 'INFORMACION', observedAt: result.data.observedAt };
  }
  if(plan.kind==='shipments') {
    check('get_shipments');
    const result = await run('get_shipments', { entityId: null });
    checkCurrent();
    if (!result?.data || result.state || result.data.code) return null;
    const all = result.data.records || [];
    const pending = all.filter(r => !['delivered', 'entregado', 'cancelled', 'cancelado', 'completed'].includes(String(r.status || '').toLowerCase()));
    const target = plan.statusFilter === 'pending' ? pending : (pending.length ? pending : all);
    if (!target.length) return { content: 'No hay envíos pendientes registrados en este momento.', state: 'INFORMACION', observedAt: result.data.observedAt };
    const list = target.slice(0, 5).map(r => `${r.name || r.title || r.code || r.id}${r.status ? ` (${r.status})` : ''}`).join(', ');
    return { content: `Tenés ${target.length} ${target.length === 1 ? 'envío pendiente' : 'envíos pendientes'}: ${list}.`, state: 'INFORMACION', observedAt: result.data.observedAt };
  }
  if(plan.kind==='promotions') {
    check('get_promotions');
    let locationId = !plan.locationQuery && context.locationId ? context.locationId : null;
    if (plan.locationQuery) {
      check('list_locations');
      const resolved = await resolveNamedLocation({ locationQuery: plan.locationQuery, context, run, checkCurrent });
      if (resolved.error) return { content: resolved.error, state: 'DATOS_INCOMPLETOS' };
      locationId = resolved.locationId;
    }
    try {
      const result = await run('get_promotions', { locationId });
      checkCurrent();
      const discounts = result?.data?.discounts;
      if (!Array.isArray(discounts) || result.state || result.data.code) return null;
      if (!discounts.length) return { content: 'No hay promociones ni descuentos vigentes en esta ubicación.', state: 'INFORMACION', observedAt: result.data.observedAt };
      const list = discounts.slice(0, 6).map(d => `${d.name}${d.type === 'percent' && d.value ? ` (${d.value}%)` : d.value ? ` (${money(d.value)})` : ''}`).join(', ');
      return { content: `Las promociones y descuentos vigentes son: ${list}.`, state: 'INFORMACION', observedAt: result.data.observedAt };
    } catch (error) {
      if (error?.code === 'location-required') return { content: '¿En qué ubicación querés consultar las promociones vigentes?', state: 'DATOS_INCOMPLETOS' };
      throw error;
    }
  }
  if(plan.kind==='navigate') {
    check('navigate_to_module');
    try {
      const result = await run('navigate_to_module', { module: plan.module, entityId: null });
      checkCurrent();
      const navigation = result?.navigation || result?.data?.navigation;
      if (!navigation?.path) return null;
      return { content: `Te llevo a ${plan.label}.`, state: 'INFORMACION', navigation };
    } catch (error) {
      if (plan.module === 'quick-sales') {
        const fallback = await run('navigate_to_module', { module: 'sales', entityId: null });
        checkCurrent();
        const navigation = fallback?.navigation || fallback?.data?.navigation;
        if (navigation?.path) return { content: `Te llevo a ${plan.label}.`, state: 'INFORMACION', navigation };
      }
      throw error;
    }
  }
  check('get_stock');check('search_products');
  let locationId=context.locationId || null;
  if(plan.locationQuery || !locationId) {
    const resolved = await resolveNamedLocation({ locationQuery: plan.locationQuery, context, run, checkCurrent });
    if (resolved.error) return { content: resolved.error, state: 'DATOS_INCOMPLETOS' };
    locationId = resolved.locationId;
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
