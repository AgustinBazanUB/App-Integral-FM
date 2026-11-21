import { isGreetingOnly, normalizeSpeech } from '../../shared/oliviaSpeechText.mjs';
import { instantConversation, isConversationalFollowUp, quickReadPlan } from '../../shared/oliviaConversationRouter.mjs';

export function endpointingWindow({ partial = '', stableMs = 0, pauseResumes = 0, legacySilenceMs = 1900, enabled = true } = {}) {
  const text = normalizeSpeech(partial);
  if (!enabled) return Math.max(legacySilenceMs, /\b(de|del|para|y|pero|con|en|a|que|porque|por|el|la|los|las|un|una)$/.test(text) ? 4000 : pauseResumes > 1 ? 4000 : pauseResumes ? 3000 : 1900);
  if (!text) return pauseResumes ? 1700 : 1100;
  const unfinished = /\b(?:de|del|para|y|pero|con|en|a|que|porque|por|el|la|los|las|un|una|mas|tambien|ademas|primero|segundo|tercero|coma)$/.test(text) || /[,;:]$/.test(String(partial).trim());
  const mutation = /\b(?:carga|cargame|agrega|agregame|ingresa|crea|registra|vende|manda|envia|transferi)\b/.test(text);
  const quantityTokens = text.match(/\b(?:\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|veinticinco|treinta|cuarenta|cincuenta|cien)\b/g) || [];
  const enumeration = /\b(?:lista|productos|primero|segundo|tercero|tambien|ademas)\b/.test(text) || (mutation && quantityTokens.length >= 2 && /\by\b|,/.test(partial));
  if (unfinished || enumeration) return 2000;
  // Keep the conversational fast path responsive without ending under the
  // provider's documented 500 ms safety floor for manually closed turns.
  if (stableMs >= 120 && (isGreetingOnly(text) || instantConversation(text) || isConversationalFollowUp(text))) return 500;
  if (mutation) return !pauseResumes && /\ben (?:el |la )?\S+/.test(text) && stableMs >= 180 ? 700 : 1650;
  if (pauseResumes > 1) return 1650;
  if (stableMs >= 140 && quickReadPlan(text)) return pauseResumes ? 700 : 600;
  const shortQuery = !mutation && (/[?¿]/.test(String(partial)) || text.split(/\s+/).length <= 10);
  if (shortQuery && stableMs >= 140) return pauseResumes ? 700 : 620;
  return pauseResumes ? 1300 : stableMs >= 200 ? 680 : 900;
}
