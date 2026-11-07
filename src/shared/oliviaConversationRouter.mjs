import { isGreetingOnly, normalizeSpeech } from './oliviaSpeechText.mjs';

// Small, exact matchers. A partial, combined request, correction or bare confirmation
// must continue through the authenticated task engine.
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
export function classifyGeminiLiveTurn(text) {
  const normalized = normalizeSpeech(text)
    .replace(/^olivia /, '')
    .replace(/^hola olivia /, 'hola ')
    .replace(/ olivia$/, '');
  const socialOnly = /^(?:(?:muy |re )?(?:bien(?: por suerte)?|todo bien|todo tranqui|joya|genial|de diez)(?: y vos(?: como (?:estas|andas))?| que (?:andas haciendo|estas haciendo|haces))?|bien por suerte que (?:andas haciendo|estas haciendo|haces)|me alegro|que bueno|y vos(?: como (?:estas|andas))?|que (?:andas haciendo|estas haciendo|haces|onda)(?: hoy)?|como va tu dia|(?:muchas |muchisimas |mil )?gracias(?: por tu ayuda| olivia)?|todo bien gracias|te agradezco|contame algo(?: lindo| divertido| interesante)?|decime algo(?: lindo| divertido| interesante)?|dale me gusto|buenisimo|bueno hablamos(?: luego| mas tarde)?|hasta la proxima)$/.test(normalized.replace(/\s+/g, ' '));
  if (isGreetingOnly(text) || instantConversation(text) || socialOnly || isConversationalFollowUp(text)) return { route: 'direct', kind: 'small-talk' };
  return { route: 'delegate', kind: 'data-or-operation' };
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
