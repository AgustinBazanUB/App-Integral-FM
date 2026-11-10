import { normalizeSpeech } from './oliviaSpeechText.mjs';
import { isIndependentBusinessRead } from './oliviaBusinessRead.mjs';

const qty='(?:\\d+(?:[.,]\\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte|veintiun[oa]?|veintidos|veintitres|veinticuatro|veinticinco|veintiseis|veintisiete|veintiocho|veintinueve|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento\\s+\\w+)';
const quantity=new RegExp('\\b'+qty+'\\b','i');
const liveRead=/[?¿]|\b(?:cuanto\w*|cual\w*|consulta\w*|busca\w*|mostra\w*|vendimos|disponible|existe|tenemos)\b/;
const social=/^(?:(?:hola|gracias|muchas gracias|perfecto|muy bien|que bueno|como estas|me escuchas|te puedo pedir algo)\b)/;

// A bounded draft of what the user SAID, never entity IDs, catalog facts,
// permission or confirmation. The existing task engine owns every validation.
export function advanceVoiceCollection(text,previous=null,context={}) {
  const raw=String(text || '').trim().slice(0,1500),n=normalizeSpeech(raw);
  if(!n || isIndependentBusinessRead(raw) || liveRead.test(n) || /[?¿]/.test(raw))return null;
  if(['collecting','ready'].includes(previous?.status)&&/^(?:volvamos|volvamos a|retomemos|retoma|sigamos con|volvamos con)\b/.test(n))return previous;
  if(['suspended','paused'].includes(previous?.status)&&/^(?:volvamos|volvamos a|retomemos|retoma|sigamos con|volvamos con)\b/.test(n)){
    const draft=structuredClone(previous);draft.status='collecting';draft.revision=(draft.revision || 0)+1;draft.lastInput=n;draft.nextStep=`ask-${draft.pendingQuestion || draft.missingFields?.[0] || 'items-and-quantities'}`;return draft;
  }
  if(previous&&['collecting','ready','paused'].includes(previous.status)&&/^(?:espera|pausa(?:lo)?|dejalo para despues|despues seguimos|pone(?:lo)? en pausa)$/.test(n))
    return {...previous,status:'paused',revision:(previous.revision || 0)+1,lastInput:n,nextStep:'resume-or-discard'};
  const active=previous && ['collecting','ready'].includes(previous.status);
  if(active && previous.lastInput===n)return previous;
  if(previous&&['collecting','ready','paused'].includes(previous.status) && /^(?:(?:no\s*,?\s*)?(?:me confundi\s*,?\s*)?)?(?:deja(?:lo)?(?: eso)?|dejemos eso|cancela(?:lo)?|olvida(?:lo)?|descarta(?:lo)?)(?:\s*,?\s*(?:me confundi|nada))?$/.test(n)){
    if(context.pendingAction || context.pendingActionId || context.collectingTask || context.activeTask)return null;
    return {...previous,status:'cancelled',revision:(previous.revision || 0)+1,lastInput:n,missingFields:[],nextStep:'leave-unsubmitted',turns:[...(previous.turns || []),raw].slice(-10)};
  }
  if(social.test(n)&&!/\b(?:carg\w*|sumar|agreg\w*|crear|crea|nuevo|stock|producto)\b/.test(n))return null;
  if(!active && (context.collectingTask || context.pendingAction || context.pendingActionId))return null;
  const loading=/\b(?:carg\w*|sumar|agreg\w*|ingres\w*|reponer)\b/.test(n);
  const specifiedUnits=new RegExp('\\b'+qty+'\\s+(?:unidad(?:es)?|botellas?|paquetes?|cajas?|kilos?|litros?|bolsas?|frascos?|bidones?)\\b','i').test(n);
  if(loading && /\b(?:stock|mercaderia|inventario|producto)\b/.test(n)&&/\b(?:borra\w*|elimina\w*|transfi\w*|(?:crea\w*|registra\w*)\s+(?:un |el |la )?(?:clientes?|ventas?|envios?))\b/.test(n))return null;
  let intent=(/\b(?:stock|mercaderia|inventario)\b/.test(n)||specifiedUnits)&&loading?'stock-load':/\bproducto\b/.test(n)&&/\b(?:crear|crea\w*|nuevo)\b/.test(n)?'product-create':/\bproducto\b/.test(n)&&loading?'choose-operation':null;
  if(active && previous.intent==='choose-operation'){
    if(/crear|nuevo/.test(n))intent='product-create';
    else if(/sumar|stock|existent|agreg\w*|carg\w*/.test(n))intent='stock-load';
  }
  // A different administrative request needs its own engine scope; never
  // combine its parameters with this unsubmitted draft.
  if(active && intent && intent!==previous.intent && previous.intent!=='choose-operation')return null;
  if(!active && !intent)return null;
  if(active && !intent && !/^(?:en|local|ubicacion|sucursal|deposito)\b/.test(n) && /\b(?:ventas?|clientes?|envios?|transfer\w*|metricas?|precios?)\b/.test(n))return null;
  const draft=active?structuredClone(previous):{version:1,revision:previous?.revision || 0,intent,operation:intent,targetType:null,targetId:null,requestedLocation:null,requestedWarehouse:null,itemsMentioned:[],requestedProductName:null,validation:'unverified',status:'collecting',turns:[],corrections:[],collectionAttempts:0};
  draft.turns=Array.isArray(draft.turns)?draft.turns:[];
  draft.corrections=Array.isArray(draft.corrections)?draft.corrections:[];
  draft.itemsMentioned=Array.isArray(draft.itemsMentioned)?draft.itemsMentioned:[];
  if(intent){draft.intent=intent;draft.operation=intent;}
  draft.revision++;draft.lastInput=n;draft.turns=[...draft.turns,raw].slice(-10);
  if(!draft.targetType&&draft.intent==='stock-load'){
    const ordinals={'primer':1,'primero':1,'primera':1,'segundo':2,'segunda':2,'tercer':3,'tercero':3,'tercera':3,'cuarto':4,'cuarta':4,'quinto':5,'quinta':5};
    const ordinalWord=Object.keys(ordinals).find(word=>new RegExp(`\\b${word}\\b`).test(n));
    const recent=(context.messages || []).slice(-4).filter(message=>message?.role==='assistant').map(message=>normalizeSpeech(message.content || message.voiceTranscript || ''));
    const readType=recent.some(content=>/depositos activos son/.test(content))?'warehouse':recent.some(content=>/ubicaciones activas que podes consultar son/.test(content))?'location':null;
    if(ordinalWord&&readType){draft.targetType=readType;draft.targetOrdinal=ordinals[ordinalWord];}
  }
  const correction=/\b(?:en realidad|queria decir|mejor|corrijo|corregi|eran|que sean)\b/.test(n)||/^no(?:\b|,)/.test(n);
  if(correction)draft.corrections=[...draft.corrections,raw].slice(-4);
  if(draft.intent==='stock-load'){
    draft.targetType=draft.targetType || null;draft.targetId=draft.targetId || null;draft.requestedWarehouse=draft.requestedWarehouse || null;
    if(active&&previous.correctionNeedsProduct&&previous.pendingCorrectionQuantity&&!quantity.test(n)&&!intent){
      const query=normalizeSpeech(raw).replace(/^(?:el|la|los|las|producto)\s+/,'').trim();
      const matches=draft.itemsMentioned.filter(item=>{const name=normalizeSpeech(item.description);return name===query||name.includes(query)||query.includes(name);});
      if(matches.length===1){matches[0].quantityMentioned=previous.pendingCorrectionQuantity;draft.correctionNeedsProduct=false;draft.pendingCorrectionQuantity=null;}
    }
    const saysWarehouse=/\bdepositos?\b/.test(n),saysLocation=/\b(?:local(?:es)?|ubicaciones?|sucursales?|ferias?)\b/.test(n);
    const targetCorrection=active&&(/\b(?:no|mejor|cambia|cambiemos|en vez de|pasemos|vayamos)\b/.test(n))&&(saysWarehouse||saysLocation);
    if(targetCorrection || (!draft.targetType && (saysWarehouse || saysLocation))){
      draft.targetType=saysWarehouse&&(!saysLocation||n.lastIndexOf('deposito')>n.lastIndexOf('local'))?'warehouse':'location';
      if(targetCorrection){draft.targetId=null;draft.targetOrdinal=null;draft.requestedLocation=null;draft.requestedWarehouse=null;}
      else if(draft.targetType!==previous?.targetType){draft.targetId=null;draft.targetOrdinal=null;}
    }
    const loc=/(?:^|\b)en\s+(?:(?:el|la|un|una)\s+)?(?:(?:local|ubicaci[oó]n|sucursal|dep[oó]sito|feria)\s+)?(.+)/i.exec(raw);
    if(loc){const value=loc[1].split(new RegExp('(?:[,;]|\\s+(?:y\\s+)?'+qty+'\\s+)','i'))[0].trim();if(value&&!/^(?:realidad|que|cual|donde|local|ubicacion|sucursal|deposito|feria|que local|cual local|un local|una ubicacion|un deposito|local o deposito)\b/.test(normalizeSpeech(value))&&!/\btodavia no se\b/.test(n)){
      if(draft.targetType==='warehouse')draft.requestedWarehouse=value.slice(0,160);else draft.requestedLocation=value.slice(0,160);
    }}
    else if(active && ['location','warehouse'].includes(previous.pendingQuestion) && !correction && !intent && !quantity.test(n)){
      const directLoc=raw.replace(/^(?:el|la)\s+/i,'').replace(/^(?:local|ubicaci[oó]n|sucursal|dep[oó]sito)\s+/i,'').trim();
      if(directLoc && !/^(?:realidad|que|cual|donde|si|no|dale|bueno|espera)\b/.test(normalizeSpeech(directLoc))){
        if(draft.targetType==='warehouse')draft.requestedWarehouse=directLoc.slice(0,160);else draft.requestedLocation=directLoc.slice(0,160);
      }
    }
    if(quantity.test(n)&&(!/^(?:en|local|ubicacion|sucursal|deposito)\b/.test(n)||/\b(?:unidades|botellas|paquetes|sumar|cargar|frascos|bidones)\b/.test(n))){
      const normalizedRaw=raw.replace(new RegExp('(^|[,;]\\s*|\\s+y\\s+)([A-Za-zÁÉÍÓÚÑáéíóúñ][^,;0-9]*?),\\s*('+qty+'(?:\\s+(?:unidades?|botellas?|paquetes?|cajas?|frascos?|bidones?))?)(?=$|[,;]|\\s+y\\s+)','gi'),'$1$2 $3');
      const parts=normalizedRaw.split(new RegExp('(?:[,;]\\s*|\\s+y\\s+)(?=(?:'+qty+'\\b|[A-Za-zÁÉÍÓÚÑáéíóúñ][^,;0-9]*?\\s+'+qty+'\\b))','i'));
      const items=parts.map(part=>{
        const cleaned=part.trim().replace(/^(?:cargame|carga|cargar|sumame|suma|agregame|agrega|agregar|ingresa|ingresame|quiero|necesito)\\s+/i,'');
        const mProductFirst=new RegExp('^([A-Za-zÁÉÍÓÚÑáéíóúñ][^,;0-9]*?)\\s+('+qty+')(?:\\s+(?:unidades?|botellas?|paquetes?|cajas?|frascos?|bidones?))?$','i').exec(cleaned);
        if(mProductFirst && !/^(?:un|una|uno)$/i.test(mProductFirst[2]) && !/\b(?:carga|cargar|cargame|suma|sumame|sumar|agrega|agregar|agregame|ingresa|ingresame|ingresar|quiero|necesito)\b/.test(normalizeSpeech(mProductFirst[1]))){
          return {quantityMentioned:mProductFirst[2],description:mProductFirst[1].replace(/^(?:(?:unidades?|botellas?|paquetes?|cajas?|frascos?|bidones?)\\s+)?(?:de\\s+)?/i,'').trim().slice(0,350)};
        }
        const m=new RegExp('\\b('+qty+')\\s+(?:(?:unidades?|botellas?|paquetes?|cajas?|frascos?|bidones?)\\s+)?(?:de\\s+)?(.+)','i').exec(cleaned);
        if(m && !(/^(?:un|una|uno)$/i.test(m[1]) && /^(?:local|ubicaci[oó]n|sucursal|dep[oó]sito|feria)$/i.test(m[2].trim())) && !/^(?:unidades?|botellas?|paquetes?|cajas?|frascos?|bidones?)$/i.test(m[2].trim())){
          return {quantityMentioned:m[1],description:m[2].replace(/^de\s+/i,'').replace(/\s+en\s+(?:(?:el|la|un|una)\s+)?(?:local|ubicaci[oó]n|sucursal|dep[oó]sito|feria)\b.*/i,'').trim().slice(0,350)};
        }
        return null;
      }).filter(x=>x&&x.description).slice(0,20);
      const quantityOnly=new RegExp('^(?:no\\s*,?\\s*)?(?:(?:mejor|eran|que sean|corrijo a|corrige a|cambia a|corregi a)\\s+)?('+qty+')(?:\\s+(?:unidades?|botellas?|paquetes?|cajas?|frascos?|bidones?))?$','i').test(n);
      if(correction&&quantityOnly&&draft.itemsMentioned.length===1){draft.itemsMentioned[0].quantityMentioned=n.match(quantity)[0];draft.correctionNeedsProduct=false;}
      else if(correction&&quantityOnly&&draft.itemsMentioned.length>1){draft.correctionNeedsProduct=true;draft.pendingCorrectionQuantity=n.match(quantity)[0];}
      else if(items.length){
        const normalizedName=value=>normalizeSpeech(value).replace(/^(?:el|la|los|las|de|del|producto)\s+/,'').trim();
        const current=draft.itemsMentioned;
        for(const item of items){
          const target=normalizedName(item.description);
          const index=current.findIndex(existing=>normalizedName(existing.description)===target);
          if(correction&&index>=0){current[index]={...current[index],quantityMentioned:item.quantityMentioned};draft.correctionNeedsProduct=false;}
          else current.push(item);
        }
        draft.itemsMentioned=current.slice(-20);
      }else if(correction&&draft.itemsMentioned.length===1&&n.match(quantity))draft.itemsMentioned[0].quantityMentioned=n.match(quantity)[0];
      else if(correction&&n.match(quantity)){draft.correctionNeedsProduct=true;draft.missingFields=['correction-product'];}
    }
    draft.missingFields=[...(!draft.targetType?['targetType']:draft.targetType==='warehouse'?!draft.requestedWarehouse&&!draft.targetOrdinal?['warehouse']:[]:!draft.requestedLocation&&!draft.targetOrdinal?['location']:[]),...(!draft.itemsMentioned.length?['items-and-quantities']:[])];
    if(draft.correctionNeedsProduct)draft.missingFields.unshift('correction-product');
  }else if(draft.intent==='product-create'){
    const name=/\b(?:se llama|nombre es|producto nuevo llamado)\s+(.+)/i.exec(raw);
    if(name)draft.requestedProductName=name[1].trim().slice(0,160);
    else if(active&&previous.intent==='product-create'&&!intent)draft.requestedProductName=raw.slice(0,160);
    draft.missingFields=draft.requestedProductName?[]:['product-name'];
  }else draft.missingFields=['operation'];
  if(active && !correction && draft.missingFields.length){
    const priorItems=previous.itemsMentioned || [];
    const answeredItems=draft.itemsMentioned.some((item,index)=>item.description!==priorItems[index]?.description||item.quantityMentioned!==priorItems[index]?.quantityMentioned)||draft.itemsMentioned.length>priorItems.length;
    const answeredSomething=draft.targetType!==previous.targetType||draft.requestedLocation!==previous.requestedLocation||draft.requestedWarehouse!==previous.requestedWarehouse||draft.targetOrdinal!==previous.targetOrdinal||answeredItems;
    if(active)draft.collectionAttempts=answeredSomething?0:(previous.collectionAttempts || 0)+1;
    const unansweredSlot=!answeredSomething&&previous.pendingQuestion && draft.missingFields.includes(previous.pendingQuestion) && n.split(/\s+/).length>=2;
    if((draft.collectionAttempts || 0)>=3 || unansweredSlot){
      draft.missingFields=[];
      draft.fallbackToEngine=true;
    }
  }
  draft.status=draft.missingFields.length?'collecting':'ready';
  draft.pendingQuestion=draft.missingFields[0] || null;
  draft.nextStep=draft.status==='ready'?'verify-and-prepare':`ask-${draft.pendingQuestion}`;
  return draft;
}

export function collectionDecision(text,context={}){
  const collection=advanceVoiceCollection(text,context.voiceCollection,context);
  if(!collection)return null;
  const capability=collection.intent==='stock-load'?(collection.targetType==='warehouse'?'prepare_warehouse_stock_load':'prepare_stock_load'):collection.intent==='product-create'?'prepare_product_create':null;
  if(capability&&Array.isArray(context.capabilities)&&!context.capabilities.includes(capability))return null;
  return {route:collection.status==='ready'?'delegate':'direct',kind:collection.status==='ready'?'collected-operation':collection.status==='cancelled'?'collection-cancel':'collection-question',collection,
    ...(collection.status==='ready'?{request:collection.turns.join('\n').slice(0,12000)}:{})};
}

export const collectionQuestion=collection=>collection.status==='cancelled'?'Dejamos esa solicitud.':({targetType:'¿En un local o en un depósito?',location:'¿En qué local querés cargarlo?',warehouse:'¿En cuál depósito querés cargarlo?','items-and-quantities':'¿Qué productos y cantidades querés sumar?','correction-product':'¿De cuál producto querés corregir la cantidad?','product-name':'¿Qué nombre tendrá el producto?',operation:'¿Querés crear un producto nuevo o sumar stock de uno existente?'}[collection.pendingQuestion] || '¿Qué dato querés aclarar?');
export function compactCollection(collection){if(!collection)return null;const {turns,lastInput,...rest}=collection;return {...rest,itemsMentioned:collection.itemsMentioned?.map(item=>({...item,description:item.description.slice(0,160)})),corrections:collection.corrections?.slice(-2).map(s=>s.slice(0,160))};}

// Final ASR and history responses may arrive after task acceptance. A draft
// already handed off must never be resurrected by that older turn.
export function mergeVoiceCollection(current,incoming){
  if(!current)return incoming;
  if(!incoming || (incoming.revision || 0)<(current.revision || 0))return current;
  if(incoming.revision===current.revision && ['delegated','cancelled','superseded'].includes(current.status) && !['delegated','cancelled','superseded'].includes(incoming.status))return current;
  return incoming;
}

const unsafe=/\b(?:cargue|cargamos|agregue|agregamos|registre|registramos|ejecute|ejecutado|realizado|encontre|encontramos|existe|existen|habilitad\w*|autorizad\w*|verificad\w*|validad\w*|disponible\w*|vendimos|vendiste|tenemos|stock actual|quedo confirmad\w*|ya esta|ya esta hecho|confirmado|operacion completada|se cargo|se registro)\b/;
const prefix=/^(?:(?:dale|perfecto|buenisimo|barbaro|excelente|joya|bien|bueno|entendido|tomado|listo|genial|claro|de acuerdo|con gusto|por supuesto|como no|enseguida)[\s,.:!¡]*)+/;
export function safeConversationBridge(text,{collection=null,accepted=false}={}){
  const raw=String(text || '').trim(),n=normalizeSpeech(raw);
  if(!n || raw.length>320 || unsafe.test(n))return false;
  let body=n.replace(prefix,'').trim();
  if(collection){
    if(collection.status==='cancelled')return /^(?:no (?:voy a )?(?:preparo|preparar|ejecuto|ejecutar)|dejamos? (?:este|el|ese) (?:pedido|borrador)|dejo (?:este|el|ese) pedido)/.test(body);
    if(collection.status==='paused')return /\b(?:paus|retom|cuando quieras|despues seguimos)\b/.test(body);
    // Gemini can ask for a field as an imperative, without question marks.
    // Accept only a field request, never a statement of commercial facts.
    const fieldRequest=/^(?:decime|indicame|pasame|contame|confirmame) (?:en que (?:ubicacion|local|sucursal|deposito)(?: queres (?:cargarlo|sumarlo|hacerlo))?|si es (?:en )?(?:un )?(?:local|deposito)|(?:los |que )?productos? y (?:sus |que )?cantidades?|cuantas? unidades? y (?:de )?que productos?|(?:el |que )?producto(?: queres corregir)?|(?:el |que )?nombre(?: del producto)?)$/.test(body);
    if(!raw.includes('?')&&!fieldRequest)return false;
    const before=raw.split('¿')[0];
    const intro=normalizeSpeech(before).replace(prefix,'').trim();
    const echo=/^(?:tomo|anoto) (.+) como (?:la )?(?:ubicacion|sucursal|local|deposito)(?: solicitad[oa])?$/.exec(intro);
    if(raw.includes('¿')&&intro&&(!echo||normalizeSpeech(collection.requestedLocation)!==echo[1]))return false;
    if(!fieldRequest&&!raw.includes('¿')&&!/^(?:que|cual|donde|cuanto|cuantas|en que|queres|podes|me decis)\b/.test(body))return false;
    if(/\b(?:ya|esta disponible|que cree|que cargue)\b/.test(body))return false;
    const field=collection.pendingQuestion;
    return field==='targetType'?/\b(?:donde|ubicacion|local|deposito)\b/.test(body):['location','warehouse'].includes(field)?/\b(?:donde|ubicacion|local|sucursal|deposito)\b/.test(body):field==='correction-product'?/\bproducto\b/.test(body):field==='items-and-quantities'?/\b(?:productos?|cantidades?|unidades?|botellas?|articulos?|mercaderia|cuant[oa]s?)\b/.test(body):field==='product-name'?/\b(?:producto|nombre|llama)\b/.test(body):field==='operation'?/\b(?:crear|nuevo)\b/.test(body)&&/\b(?:stock|existente|sumar)\b/.test(body):false;
  }
  if(/\d/.test(body)||/[?¿]/.test(raw))return false;
  if(accepted && /^(?:recibi (?:tu|la) solicitud|ya estoy (?:revisando|trabajando))\b/.test(body))return true;
  return /^(?:(?:voy|vamos) a (?:consultar|revisar|verificar|preparar|analizar|comparar|buscar|fijarme|chequear)|(?:ya|ahi|ahora|enseguida) (?:me fijo|lo consulto|lo reviso|lo busco|lo verifico|lo chequeo|te digo|te cuento)|(?:lo|la|los|las) (?:reviso|consulto|busco|verifico|chequeo)|me fijo|un (?:segundo|momentito|momento|instante)[,\s]*(?:(?:ya|ahi) )?(?:(?:lo|la) )?(?:reviso|consulto|busco|me fijo)?)\b/.test(body)
    && !/\b(?:ya (?:estoy|fue|quedo|carg|registr|cre|ejecut|confirm|termin|hic)|fue|son|hay|tiene|tienen|cuesta|suma|equivale|quedan|termin|cancel|confirm|cread|cargad|hecho)\w*\b/.test(body);
}
