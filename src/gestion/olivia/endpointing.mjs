import { isGreetingOnly, normalizeSpeech } from '../../shared/oliviaFastSpeech.mjs';
import { instantConversation, quickReadPlan } from '../../shared/oliviaConversationRouter.mjs';

export function endpointingWindow({ partial = '', stableMs = 0, pauseResumes = 0, legacySilenceMs = 1900, enabled = true } = {}) {
  const text = normalizeSpeech(partial);
  if (!enabled) return Math.max(legacySilenceMs, /\b(de|del|para|y|pero|con|en|a|que|porque|por|el|la|los|las|un|una)$/.test(text) ? 4000 : pauseResumes > 1 ? 4000 : pauseResumes ? 3000 : 1900);
  if (!text) return pauseResumes ? 1700 : 1100;
  const unfinished = /\b(?:de|del|para|y|pero|con|en|a|que|porque|por|el|la|los|las|un|una|mas|tambien|ademas|primero|segundo|tercero)$/.test(text);
  const mutation = /\b(?:carga|cargame|agrega|agregame|ingresa|crea|registra|vende|manda|envia|transferi)\b/.test(text);
  const enumeration = /\b(?:lista|productos|primero|segundo|tercero|tambien|ademas)\b/.test(text) || (mutation && (text.match(/\b\d+\b/g) || []).length >= 2 && /\by\b|,/.test(partial));
  if (unfinished || enumeration) return 2000;
  if (stableMs >= 140 && (isGreetingOnly(text) || instantConversation(text))) return 450;
  if (mutation) return !pauseResumes && /\ben (?:el |la )?\S+/.test(text) && stableMs>=220 ? 900 : 1800;
  if (pauseResumes > 1) return 1700;
  if (stableMs >= 180 && quickReadPlan(text)) return pauseResumes ? 900 : 700;
  return pauseResumes ? 1500 : stableMs >= 220 ? 950 : 1100;
}
