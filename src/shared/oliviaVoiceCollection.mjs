import { normalizeSpeech } from './oliviaSpeechText.mjs';

const qty='(?:\\d+(?:[.,]\\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte)';
const quantity=new RegExp('\\b'+qty+'\\b','i');
const liveRead=/[?¿]|\b(?:cuanto\w*|cual\w*|consulta\w*|busca\w*|mostra\w*|vendimos|disponible|existe|tenemos)\b/;
const social=/^(?:(?:hola|gracias|muchas gracias|perfecto|muy bien|que bueno|como estas|me escuchas|te puedo pedir algo)\b)/;

// A bounded draft of what the user SAID, never entity IDs, catalog facts,
// permission or confirmation. The existing task engine owns every validation.
export function advanceVoiceCollection(text,previous=null,context={}) {
  const raw=String(text || '').trim().slice(0,1500),n=normalizeSpeech(raw);
  if(!n || liveRead.test(n) || /[?¿]/.test(raw))return null;
  const active=previous && ['collecting','ready','paused'].includes(previous.status);
  if(active && previous.lastInput===n)return previous;
  if(active && /^(?:no deja|dejalo|cancela(?:lo)?|olvidalo)(?:\b|$)/.test(n)){
    if(context.pendingAction || context.pendingActionId || context.collectingTask || context.activeTask)return null;
    return {...previous,status:'cancelled',revision:previous.revision+1,lastInput:n,missingFields:[],nextStep:'leave-unsubmitted',turns:[...previous.turns,raw].slice(-10)};
  }
  if(social.test(n)&&!/\b(?:carg\w*|sumar|agreg\w*|crear|crea|nuevo|stock|producto)\b/.test(n))return null;
  if(!active && (context.collectingTask || context.pendingAction || context.pendingActionId))return null;
  const loading=/\b(?:carg\w*|sumar|agreg\w*|ingres\w*|reponer)\b/.test(n);
  const specifiedUnits=/\b(?:\d+|una?|uno|dos|tres|cuatro|cinco|diez)\s+(?:unidad(?:es)?|botellas?|paquetes?|cajas?|kilos?|litros?|bolsas?)\b/.test(n);
  if(loading && /\b(?:stock|mercaderia|inventario|producto)\b/.test(n)&&/\b(?:borra\w*|elimina\w*|transfi\w*|(?:crea\w*|registra\w*)\s+(?:un |el |la )?(?:clientes?|ventas?|envios?))\b/.test(n))return null;
  let intent=(/\b(?:stock|mercaderia|inventario)\b/.test(n)||specifiedUnits)&&loading?'stock-load':/\bproducto\b/.test(n)&&/\b(?:crear|crea\w*|nuevo)\b/.test(n)?'product-create':/\bproducto\b/.test(n)&&loading?'choose-operation':null;
  if(active && previous.intent==='choose-operation' && /crear|nuevo/.test(n))intent='product-create';
  // A different administrative request needs its own engine scope; never
  // combine its parameters with this unsubmitted draft.
  if(active && intent && intent!==previous.intent && previous.intent!=='choose-operation')return null;
  if(!active && !intent)return null;
  if(active && !intent && !/^(?:en|local|ubicacion|deposito)\b/.test(n) && /\b(?:ventas?|clientes?|envios?|transfer\w*|metricas?|precios?)\b/.test(n))return null;
  const draft=active?structuredClone(previous):{version:1,revision:0,intent,operation:intent,requestedLocation:null,itemsMentioned:[],requestedProductName:null,validation:'unverified',status:'collecting',turns:[],corrections:[]};
  if(intent){draft.intent=intent;draft.operation=intent;}
  draft.revision++;draft.lastInput=n;draft.turns=[...draft.turns,raw].slice(-10);
  const correction=/\b(?:en realidad|queria decir|mejor|corrijo|corregi)\b/.test(n);
  if(correction)draft.corrections=[...draft.corrections,raw].slice(-4);
  if(draft.intent==='stock-load'){
    const loc=/(?:^|\b)en\s+(?:(?:el|la)\s+)?(?:(?:local|ubicacion|deposito)\s+)?(.+)/i.exec(raw);
    if(loc){const value=loc[1].split(new RegExp('(?:[,;]|\\s+(?:y\\s+)?'+qty+'\\s+)','i'))[0].trim();if(value&&!/^realidad\b/i.test(value))draft.requestedLocation=value.slice(0,160);}
    if(quantity.test(n)&&(!/^(?:en|local|ubicacion|deposito)\b/.test(n)||/\b(?:unidades|botellas|paquetes|sumar|cargar)\b/.test(n))){
      const parts=raw.split(new RegExp('(?:[,;]\\s*|\\s+y\\s+)(?='+qty+'\\b)','i'));
      const items=parts.map(part=>{const m=new RegExp('\\b('+qty+')\\s+(.+)','i').exec(part);return m?{quantityMentioned:m[1],description:m[2].replace(/\s+en\s+(?:el\s+)?local\b.*/i,'').trim().slice(0,350)}:null;}).filter(x=>x&&x.description).slice(0,20);
      if(items.length)draft.itemsMentioned=items;
      else if(correction&&draft.itemsMentioned.length===1)draft.itemsMentioned[0].quantityMentioned=n.match(quantity)[0];
      else if(correction)draft.itemsMentioned=[];
    }
    draft.missingFields=[...(!draft.requestedLocation?['location']:[]),...(!draft.itemsMentioned.length?['items-and-quantities']:[])];
  }else if(draft.intent==='product-create'){
    const name=/\b(?:se llama|nombre es|producto nuevo llamado)\s+(.+)/i.exec(raw);
    if(name)draft.requestedProductName=name[1].trim().slice(0,160);
    else if(active&&previous.intent==='product-create'&&!intent)draft.requestedProductName=raw.slice(0,160);
    draft.missingFields=draft.requestedProductName?[]:['product-name'];
  }else draft.missingFields=['operation'];
  draft.status=draft.missingFields.length?'collecting':'ready';
  draft.pendingQuestion=draft.missingFields[0] || null;
  draft.nextStep=draft.status==='ready'?'verify-and-prepare':`ask-${draft.pendingQuestion}`;
  return draft;
}

export function collectionDecision(text,context={}){
  const collection=advanceVoiceCollection(text,context.voiceCollection,context);
  if(!collection)return null;
  const capability=collection.intent==='stock-load'?'prepare_stock_load':collection.intent==='product-create'?'prepare_product_create':null;
  if(capability&&Array.isArray(context.capabilities)&&!context.capabilities.includes(capability))return null;
  return {route:collection.status==='ready'?'delegate':'direct',kind:collection.status==='ready'?'collected-operation':collection.status==='cancelled'?'collection-cancel':'collection-question',collection,
    ...(collection.status==='ready'?{request:collection.turns.join('\n').slice(0,12000)}:{})};
}

export const collectionQuestion=collection=>collection.status==='cancelled'?'No voy a preparar ese pedido.':({location:'¿En qué ubicación querés cargarlo?','items-and-quantities':'¿Qué productos y cantidades querés sumar?','product-name':'¿Qué nombre tendrá el producto?',operation:'¿Querés crear un producto nuevo o sumar stock de uno existente?'}[collection.pendingQuestion] || '¿Qué dato querés aclarar?');
export function compactCollection(collection){if(!collection)return null;const {turns,lastInput,...rest}=collection;return {...rest,itemsMentioned:collection.itemsMentioned?.map(item=>({...item,description:item.description.slice(0,160)})),corrections:collection.corrections?.slice(-2).map(s=>s.slice(0,160))};}

const unsafe=/\b(?:cargue|cargamos|agregue|agregamos|registre|registramos|ejecute|ejecutado|realizado|encontre|encontramos|existe|existen|habilitad\w*|autorizad\w*|verificad\w*|validad\w*|disponible\w*|vendimos|vendiste|tenemos|stock actual|quedo confirmad\w*|ya esta|ya esta hecho|confirmado|operacion completada|se cargo|se registro)\b/;
const prefix=/^(?:(?:dale|perfecto|buenisimo|bien|bueno|entendido|tomado|listo|genial|claro|de acuerdo|con gusto|por supuesto)[\s,.:!¡]*)+/;
export function safeConversationBridge(text,{collection=null,accepted=false}={}){
  const raw=String(text || '').trim(),n=normalizeSpeech(raw);
  if(!n || raw.length>320 || unsafe.test(n))return false;
  let body=n.replace(prefix,'').trim();
  if(collection){
    if(collection.status==='cancelled')return /^(?:no (?:voy a )?(?:preparo|preparar|ejecuto|ejecutar)|dejamos? (?:este|el|ese) (?:pedido|borrador)|dejo (?:este|el|ese) pedido)/.test(body);
    if(!raw.includes('?'))return false;
    const before=raw.split('¿')[0];
    const intro=normalizeSpeech(before).replace(prefix,'').trim();
    const echo=/^tomo (.+) como (?:la )?ubicacion solicitada$/.exec(intro);
    if(raw.includes('¿')&&intro&&(!echo||normalizeSpeech(collection.requestedLocation)!==echo[1]))return false;
    if(!raw.includes('¿')&&!/^(?:que|cual|donde|cuanto|en que|queres|podes|me decis)\b/.test(body))return false;
    if(/\b(?:ya|esta disponible|que cree|que cargue)\b/.test(body))return false;
    const field=collection.pendingQuestion;
    return field==='location'?/\b(?:donde|ubicacion|local|deposito)\b/.test(body):field==='items-and-quantities'?/\b(?:productos?|cantidades?|unidades?)\b/.test(body):field==='product-name'?/\b(?:producto|nombre|llama)\b/.test(body):field==='operation'?/\b(?:crear|nuevo)\b/.test(body)&&/\b(?:stock|existente)\b/.test(body):false;
  }
  if(/\d/.test(body)||/[?¿]/.test(raw))return false;
  if(accepted && /^(?:recibi (?:tu|la) solicitud|ya estoy (?:revisando|trabajando))\b/.test(body))return true;
  return /^(?:(?:voy|vamos) a (?:consultar|revisar|verificar|preparar|analizar|comparar)|lo reviso|un segundo lo reviso)\b/.test(body)
    && !/\b(?:ya|fue|son|hay|tiene|tienen|cuesta|suma|equivale|quedan|termin|cancel|confirm|cread|cargad|hecho)\w*\b/.test(body);
}
