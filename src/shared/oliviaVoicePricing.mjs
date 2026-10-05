// Official standard rates: https://developers.openai.com/api/docs/pricing
export const MINI_VOICE_MODEL = "gpt-realtime-2.1-mini";
export const MINI_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
export const emptyRealtimeUsage = () => ({ textInput: 0, audioInput: 0, cachedTextInput: 0, cachedAudioInput: 0, textOutput: 0, audioOutput: 0 });
const count = (value) => Number.isSafeInteger(value) && value >= 0;

// Missing modality or cache detail cannot be priced as zero.
export function realtimeTokenBreakdown(usage) {
  const input = usage?.input_token_details, output = usage?.output_token_details;
  if (!input || !output || ![usage.input_tokens, usage.output_tokens, usage.total_tokens, input.text_tokens, input.audio_tokens, output.text_tokens, output.audio_tokens].every(count)) return null;
  if (input.text_tokens + input.audio_tokens !== usage.input_tokens || output.text_tokens + output.audio_tokens !== usage.output_tokens || usage.input_tokens + usage.output_tokens !== usage.total_tokens) return null;
  const cached = input.cached_tokens;
  const cache = input.cached_tokens_details;
  const cachedText = cached === 0 ? 0 : cache?.text_tokens;
  const cachedAudio = cached === 0 ? 0 : cache?.audio_tokens;
  if (![cached, cachedText, cachedAudio].every(count) || cachedText + cachedAudio !== cached || cachedText > input.text_tokens || cachedAudio > input.audio_tokens) return null;
  return { textInput: input.text_tokens, audioInput: input.audio_tokens, cachedTextInput: cachedText, cachedAudioInput: cachedAudio, textOutput: output.text_tokens, audioOutput: output.audio_tokens };
}

export function realtimeMiniCosts(usage) {
  const parts = usage.realtimeUsage;
  if (usage.model !== MINI_VOICE_MODEL || usage.measurement !== "provider" || !parts || Object.keys(emptyRealtimeUsage()).some((key) => !count(parts[key])) || parts.cachedTextInput > parts.textInput || parts.cachedAudioInput > parts.audioInput) return null;
  const voice = ((parts.textInput - parts.cachedTextInput) * 0.60 + parts.cachedTextInput * 0.06 + (parts.audioInput - parts.cachedAudioInput) * 10 + parts.cachedAudioInput * 0.30 + parts.textOutput * 2.40 + parts.audioOutput * 20) / 1e6;
  if (!count(usage.observedTranscriptions)) return null;
  if (!usage.observedTranscriptions) return { voiceUsd: voice, transcriptionUsd: 0 };
  if (usage.transcriptionModel !== MINI_TRANSCRIPTION_MODEL || ![usage.transcriptionInputTokens, usage.transcriptionOutputTokens, usage.transcriptionTokens].every(count) || usage.transcriptionInputTokens + usage.transcriptionOutputTokens !== usage.transcriptionTokens || usage.transcriptionSeconds > 0) return null;
  return { voiceUsd: voice, transcriptionUsd: (usage.transcriptionInputTokens * 1.25 + usage.transcriptionOutputTokens * 5) / 1e6 };
}
export function realtimeMiniCost(usage) {
  const costs = realtimeMiniCosts(usage);
  return costs ? costs.voiceUsd + costs.transcriptionUsd : null;
}

const priced = (value) => Number.isFinite(value) && value >= 0;
// Sum recorded costs only. Missing provider measurements stay visibly pending.
export function aggregateVoiceCosts(live, voiceUsage, backendUsage, { truncated = false, backendPending = false } = {}) {
  const mini = live.voiceMode === "realtime-mini";
  const settled = live.meteringStatus === "settled";
  const amount = (value) => settled && priced(value) ? value : null;
  const voice = { usd: amount(mini ? voiceUsage?.voiceCostUsd : voiceUsage?.actualCostUsd), ars: amount(mini ? voiceUsage?.voiceCostArs : voiceUsage?.actualCostArs) };
  const transcription = mini ? { usd: amount(voiceUsage?.transcriptionCostUsd), ars: amount(voiceUsage?.transcriptionCostArs) } : { usd: 0, ars: 0, included: true };
  const backend = { usd: 0, ars: 0, knownArs: 0, queries: backendUsage.length, pending: backendPending || truncated };
  for (const event of backendUsage) {
    for (const [unit, key] of [["usd", "actualCostUsd"], ["ars", "actualCostArs"]]) {
      if (!priced(event[key])) backend[unit] = null;
      else if (backend[unit] !== null) backend[unit] += event[key];
    }
    if (priced(event.actualCostArs)) backend.knownArs += event.actualCostArs;
  }
  if (backend.pending) { backend.usd = null; backend.ars = null; }
  const parts = [voice, transcription, backend];
  const complete = settled && parts.every((part) => priced(part.ars));
  return { voiceMode: live.voiceMode || live.protocol || "realtime", voiceModel: live.model, measurement: voiceUsage?.measurement || "pending", closeReason: voiceUsage?.closeReason || null, settled, backendPending, truncated, voice, transcription, backend,
    complete, totalArs: complete ? parts.reduce((sum, part) => sum + part.ars, 0) : null,
    totalUsd: settled && parts.every((part) => priced(part.usd)) ? parts.reduce((sum, part) => sum + part.usd, 0) : null,
    knownArs: backend.knownArs + (voice.ars ?? 0) + (transcription.ars ?? 0) };
}

export function formatOliviaCost(value, currency = "ARS") {
  if (!priced(value)) return "Sin medición";
  if (currency === "USD") return new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", maximumSignificantDigits: 3 }).format(value);
  if (value > 0 && value < 0.1) return "< $0,1";
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}
