import { normalizeSpeech } from './oliviaSpeechText.mjs';

// Live data questions are independent of collecting an operation's fields.
// This boundary neither answers the question nor grants tool permissions.
export function isIndependentBusinessRead(text) {
  const value = normalizeSpeech(text).replace(/^olivia /, '');
  if (/\b(?:carg\w*|crea\w*|registra\w*|agrega\w*|transfi\w*|borra\w*|elimina\w*|modifica\w*|actualiza\w*|corrijo|corregi|en realidad|queria decir)\b/.test(value)) return false;
  return /\b(?:ubicaciones?|locales|depositos?|stock|inventario|productos?|precios?|ventas?|vendimos|clientes?|pedidos?|envios?)\b/.test(value)
    && /^(?:(?:me )?(?:podes|podrias) (?:decir|mostrar|listar) |(?:decime|mostra\w*|lista\w*|consulta\w*|busca\w*) |(?:que|como|cual\w*|cuanto\w*|donde|hay|tenemos)\b)/.test(value);
}
