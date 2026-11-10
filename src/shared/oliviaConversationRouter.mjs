import { isGreetingOnly, normalizeSpeech } from './oliviaSpeechText.mjs';
import { collectionDecision } from './oliviaVoiceCollection.mjs';

// These short canned replies remain for the written task engine. Native Live
// conversation uses the contextual policy below rather than this exact list.
export const conversationClips = [
  { id: 'bienestar_01', category: 'conversacion', text: '¡Bien! ¿Y vos?' },
  { id: 'agradecimiento_01', category: 'conversacion', text: '¡De nada! Acá estoy.' },
  { id: 'despedida_01', category: 'conversacion', text: '¡Dale, hablamos! Que estés bien.' },
];
export const latencyEnabled = configuration => configuration?.conversationLatency?.enabled !== false;
export function instantConversation(text) {
  const value = normalizeSpeech(text).replace(/^olivia /, '').replace(/^hola olivia /,'hola ').replace(/ olivia$/, '');
  if (/^(?:hola )?(?:como estas|como andas|como va|todo bien|que tal)$/.test(value)) return { ...conversationClips[0], intent: 'wellbeing' };
  if (/^(?:muchas |muchisimas )?gracias(?: por tu ayuda)?$/.test(value)) return { ...conversationClips[1], intent: 'thanks' };
  if (/^(?:chau|hasta luego|nos vemos|hasta manana|adios)$/.test(value)) return { ...conversationClips[2], intent: 'goodbye' };
  return null;
}
export function isConversationalFollowUp(text) {
  const value = normalizeSpeech(text)
    .replace(/^olivia /, '')
    .replace(/^hola olivia /, 'hola ')
    .replace(/ olivia$/, '');
  return /^(?:te acordas (?:de )?(?:lo que|que) te pregunte(?: recien| antes)?|te acordas (?:de )?(?:lo que|que) te dije(?: recien| antes)?|que te pregunte(?: recien| antes)|de que (?:estabamos|veniamos) hablando(?: recien)?)$/.test(value);
}
export function classifyGeminiLiveTurn(text, context = {}) {
  const normalized = normalizeSpeech(text);
  if (!normalized) return { route: 'delegate', kind: 'missing-transcript' };
  const collection=collectionDecision(text,context);
  if(collection)return collection;
  // A background clause describes context; classify the actual request after
  // it. Business requests in that second clause still cross the same boundary.
  const background = /^mientras\s+(?:revis[aá]s|trabaj[aá]s|proces[aá]s|termin[aá]s)\b[^,;]*[,;]\s*(.+)$/i.exec(String(text).trim());
  if (background) return classifyGeminiLiveTurn(background[1], context);
  const mutation = /\b(?:crea\w*|carga\w*|registra\w*|agrega\w*|transfi\w*|borra\w*|elimina\w*|modifica\w*|actualiza\w*|cancela\w*)\b/.test(normalized);
  if(/\b(?:no autorizo|no autoriza|sin autorizar)\b/.test(normalized) && /\b(?:solo|solamente) (?:seguimos )?(?:conversando|hablando)\b/.test(normalized) && !/\b(?:crea|creame|carga|cargame|registra|registrame|borra|elimina|transferi|cancela)\b/.test(normalized))return {route:'direct',kind:'conversation-authorization-boundary'};
  const taskActive = Boolean(context.pendingAction || context.pendingActionId || context.collectingTask || context.activeTask);
  const requestingData=/[¿?]/.test(String(text)) || /\b(?:cuanto\w*|cual\w*|como|donde|podes|podrias|quiero|necesito|busca\w*|consulta\w*|mostra\w*|envia\w*|manda\w*)\b/.test(normalized);
  // A supplied name/example is conversational context unless a task is
  // collecting it. It is not a request to verify or create a business record.
  if(!context.collectingTask && !context.pendingAction && !context.pendingActionId && !mutation && !requestingData && /^(?:el|la)\b/.test(normalized) && /\b(?:se llama|registro ficticio)\b/.test(normalized))return {route:'direct',kind:'provided-context'};
  if (!mutation && /^(?:(?:olivia )?(?:como (?:venis|vas)|que te falta|ya terminaste|en que (?:vas|quedaste)|que estas haciendo|que tareas estas haciendo))(?: con .+)?$/.test(normalized)) return { route: 'delegate', kind: 'task-status' };
  if (taskActive && /\b(?:pausa\w*|retoma\w*|reanuda\w*|para despues)\b/.test(normalized)) return {route:'delegate',kind:'task-control'};
  if (/^espera\b/.test(normalized) && !mutation && !/\b(?:stock|precio|ventas?|clientes?)\b/.test(normalized)) return { route: 'direct', kind: 'conversation-hold' };
  if (/^(?:avisame|notificame) cuando (?:termines|finalices)\b/.test(normalized) && !mutation) return { route: 'direct', kind: 'conversation-notification-preference' };
  const noteOnly = /^toma nota (?:en (?:esta|la) conversacion|para (?:esta|la) charla)\b/.test(normalized);
  if (noteOnly && !context.collectingTask && !context.pendingAction && !context.pendingActionId && !mutation && !/\b(?:cuanto\w*|cual\w*|stock|precio\w*|vendimos|ventas?)\b/.test(normalized)) return { route: 'direct', kind: 'conversation-note' };
  // This is a business-data boundary, not a phrase whitelist or a second LLM.
  // Gemini understands ordinary language/context; only the authenticated engine
  // can supply business facts, collect operational slots or prepare mutations.
  const business = /\b(?:stock|inventario|mercaderia|productos?|presentaciones?|precios?|vendimos|vendido|ventas?|factur\w*|comprobantes?|clientes?|proveedores?|depositos?|ubicaciones?|pedidos?|envios?|transfer\w*|gastos?|caja|cobros?|pagos?|saldos?|ganancias?|reportes?|metricas?|tareas?|lavalle|registr\w*|carg\w*|agreg\w*|crea(?:r|me)?|borra\w*|elimina\w*|modifica\w*|actualiza\w*)\b/.test(normalized) || /\b(?:cuanto (?:sale|cuesta)|cuantas? unidades|cuantos? quedan)\b/.test(normalized);
  if (business) {
    // A fresh explicit request cannot replace an unrelated pending proposal,
    // even when the model suggests reusing that proposal's task ID.
    const explicitOperation=/\b(?:crea\w*|registra\w*|transf\w*|carga\w*|agrega\w*)\b.+\b(?:clientes?|productos?|stock|mercaderia|ventas?|pedidos?|envios?)\b/.test(normalized);
    const query=/^(?:olivia )?(?:cuanto\w*|cual\w*|busca\w*|consulta\w*|mostra\w*)\b/.test(normalized);
    return { route: 'delegate', kind: 'data-or-operation', ...( (explicitOperation || query) && !/\b(?:corrijo|corregi|en realidad|queria decir|en vez de|ese mismo|esa misma)\b/.test(normalized)?{newTask:true}:{} ) };
  }
  const control = /^(?:(?:si|no|dale|bueno|perfecto|listo)(?:\s+(?:dale|deja|dejalo|gracias|por favor|segui|continua))*|cancel\w*(?:\s+(?:eso|la tarea|la solicitud|por favor))*|espera(?:\s+.*)?|corri\w*(?:\s+.*)?)$/.test(normalized);
  if (taskActive && control) return { route: 'delegate', kind: 'task-control' };
  // Elliptical slot answers belong to their task. Explicit social speech is
  // still conversational while an unrelated background job is running.
  const social = /\b(?:hola|chau|gracias|escuch\w*|pedir algo|bien|bueno|vos|convers\w*|habl\w*|acord\w*)\b/.test(normalized) || /\b(?:como (?:estas|andas)|que tal|me (?:podes|podrias) ayudar|me ayudas|necesito ayuda)\b/.test(normalized);
  const slotAnswer=/^(?:\d|un(?:a|o)?\b|dos\b|tres\b|cuatro\b|cinco\b|en\b|local\b|deposito\b|se llama\b|el\b|la\b)/.test(normalized);
  if (context.collectingTask && !social && (slotAnswer || !control)) return { route: 'delegate', kind: 'task-continuation' };
  return { route: 'direct', kind: control ? 'conversation-control' : social ? 'social' : 'conversation' };
}
export function quickReadPlan(text) {
  const value = normalizeSpeech(text).replace(/^olivia /, '').replace(/ por favor$/, '').replace(/^cuanto stock (?:de |del )?/, 'cuantas unidades de ');
  if (/\b(?:carga|cargame|cargues|crea|creame|registra|agrega|ingresa|vende|cobra|manda|envia|borra|elimina|cambia|modifica|queria decir|en realidad)\b/.test(value)) return null;
  if (/^(?:quiero |necesito )?hablar con (?:un |el )?cliente$/.test(value)) return { kind: 'customer', query: '' };
  const customer = /^(?:(?:busca|buscame|buscar|mostrame|consulta)(?: al| el)? cliente |(?:quiero |necesito )?hablar con (?:el cliente |cliente ))(.+)$/.exec(value);
  if (customer) return { kind: 'customer', query: customer[1] };
  let match = /^(?:cuantas?|cuantos?) (.+?) (?:quedan|hay|tenemos|estan disponibles)(.*)$/.exec(value), kind = 'stock', query;
  if (match && (!match[2] || /^ en /.test(match[2]))) query = match[1] + match[2];
  if (!query) {
    match = /^(?:(?:decime|mostrame|consulta|revisa) )?(?:el )?(stock|precio)(?: actual)? (?:de |del )(.+)$/.exec(value);
    if (match) { kind = match[1] === 'precio' ? 'price' : 'stock'; query = match[2]; }
  }
  if (!query) {
    match = /^(?:cuanto (?:sale|cuesta)|cual es el precio de) (.+)$/.exec(value);
    if (match) { kind = 'price'; query = match[1]; }
  }
  if (!query || /\b(?:y|tambien|despues|ademas|si|cuando|comparado|compara|proyecta)\b/.test(query)) return null;
  const parts = query.split(/ en (?:el |la )?/);
  if (parts.length > 2 || !parts[0].trim()) return null;
  return { kind, query: parts[0].replace(/^(?:(?:el|la|los|las|de|del|botellas?|unidades?|frascos?|paquetes?|bolsas?|bidones?)\s+)+/, '').trim(), locationQuery: parts[1]?.trim() || null };
}
