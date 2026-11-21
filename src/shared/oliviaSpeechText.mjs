export const normalizeSpeech = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
export const isGreetingOnly = text => /^(?:(?:hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey)(?: olivia)?|hola como (?:va|estas)|como andas)$/.test(normalizeSpeech(text).replace(/^olivia /,''));
