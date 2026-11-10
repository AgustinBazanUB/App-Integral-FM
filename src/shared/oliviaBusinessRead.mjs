import { normalizeSpeech } from './oliviaSpeechText.mjs';

export function normalizeBusinessRead(text) {
  // Keep the complete query and any negation/mutation. ASR can render the
  // Argentine "decime" as "dime"; both are the same read request boundary.
  return normalizeSpeech(text).replace(/^olivia /,'').replace(/^(?:(?:espera|para)(?: un segundo)?\s+)?(?:primero\s+)?(?:decime|dime|mostrame|muestrame|consulta|revisa)\s+(?=(?:cuant[oa]s?|que|cuales|como)\b)/,'');
}

// Live data questions are independent of collecting an operation's fields.
// This boundary neither answers the question nor grants tool permissions.
export function isIndependentBusinessRead(text) {
  const value = normalizeBusinessRead(text);
  if (/\b(?:carg\w*|crea\w*|registra\w*|agrega\w*|transfi\w*|borra\w*|elimina\w*|modifica\w*|actualiza\w*|corrijo|corregi|en realidad|queria decir)\b/.test(value)) return false;
  return /\b(?:ubicaciones?|locales|sucursales?|depositos?|stock|inventario|productos?|precios?|ventas?|vendimos|caja|plata|clientes?|pedidos?|envios?|promociones?|descuentos?|promos?|alertas?)\b/.test(value)
    && /^(?:(?:me )?(?:podes|podrias) (?:decir|mostrar|listar) |(?:decime|mostra\w*|lista\w*|consulta\w*|busca\w*|revisa\w*|llevame|abri|anda|ir) |(?:que|como|cual\w*|cuanto\w*|cuanta\w*|donde|hay|tenemos|a cuanto|resumen|estado|ventas|envios|alertas|promociones|descuentos)\b)/.test(value);
}
