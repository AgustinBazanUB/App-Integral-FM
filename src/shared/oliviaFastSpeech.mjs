import library from './oliviaSpeechLibrary.json' with { type: 'json' };

export const SPEECH_LIBRARY_VERSION = '1.0.0';
export const speechClips = library.clips;
export const speechTemplates = library.personalized_templates;
export const normalizeSpeech = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
export const voiceVersion = ({ voice, speakingRate = 1 }) => `${voice}-r${speakingRate}-pcm24k-v1`;
export const isGreetingOnly = text => /^(?:(?:hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey)(?: olivia)?|hola como (?:va|estas)|como andas)$/.test(normalizeSpeech(text));
export function speechIntent(text) {
  const value = normalizeSpeech(text);
  if (isGreetingOnly(text)) return 'greeting';
  if (/stock|inventario|unidades disponibles/.test(value)) return 'stock';
  if (/ventas|vendimos|vendido|facturacion/.test(value)) return 'sales';
  if (/envio|pedido|entrega/.test(value)) return 'shipping';
  if (/producto|botella|aceite/.test(value)) return 'products';
  return 'general';
}

// Conditions are data, never eval'ed. Only server-derived facts unlock a category.
export function eligibleSpeechClips({ finalized, speaking, answerReady, intent, processingActive, toolQuery, pending, failed, recovering, missingSlot, availableSlots = [], recent = [] } = {}) {
  if (!finalized || speaking || answerReady) return [];
  const categories = new Set();
  if (intent === 'greeting') categories.add('saludo');
  if (processingActive) categories.add('espera_real');
  if (processingActive && toolQuery === intent) {
    const category = { stock:'stock_en_curso', sales:'ventas_en_curso', shipping:'envios_en_curso', products:'productos_en_curso' }[intent];
    if (category) categories.add(category);
  }
  if (pending) categories.add('confirmacion_condicional');
  if (failed && !recovering) categories.add('recuperacion_real');
  const slotClips = { location:['aclaracion_condicional_02','aclaracion_condicional_08'], period:['aclaracion_condicional_03'], product:['aclaracion_condicional_04'], order:['aclaracion_condicional_05'] };
  const allowed = new Set(!availableSlots.includes(missingSlot) ? slotClips[missingSlot] || [] : []);
  return speechClips.filter(clip => (categories.has(clip.category) || allowed.has(clip.id)) && !recent.slice(-4).includes(clip.id));
}
export function chooseLocalGreeting(text, recent = []) {
  if (!isGreetingOnly(text)) return null;
  return eligibleSpeechClips({ finalized:true, intent:'greeting', recent })[0] || speechClips.find(clip => clip.category === 'saludo');
}
export const silenceSpeech = intent => ({ mode:'silence', clip_id:null, text:'', intent:intent || 'general', requires_reply:false });
