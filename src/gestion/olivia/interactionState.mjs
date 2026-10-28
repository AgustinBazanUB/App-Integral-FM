// One visual lifecycle for text, dictation and natural voice. No timers drive states.
export function interactionState({ disabled, permissionDenied, error, voiceError, connecting, recording, speaking, busy, activeJob, processing, listening, muted, pending, phase, notice }) {
  if (permissionDenied) return { state: 'disabled', label: 'Habilitá el micrófono para conversar' };
  if (error || voiceError) return { state: 'error', label: 'Necesito tu ayuda para continuar' };
  if (disabled) return { state: 'disabled', label: 'Olivia no está disponible en este momento' };
  if (connecting) return { state: 'connecting', label: 'Preparando la conversación…' };
  if (recording) return { state: 'listening', label: 'Te escucho…' };
  if (speaking) return { state: 'speaking', label: 'Olivia está respondiendo…' };
  if (busy || activeJob || processing) return { state: 'thinking', label: phase || 'Olivia está pensando…' };
  if (pending) return { state: 'idle', label: 'Revisá la operación y confirmá en la tarjeta' };
  if (muted) return { state: 'idle', label: 'Micrófono silenciado' };
  if (listening) return { state: 'listening', label: 'Te escucho…' };
  return { state: 'idle', label: notice || '¿En qué te ayudo hoy?' };
}

export function appendDictation(draft, transcript) {
  return [String(draft || '').trimEnd(), String(transcript || '').trim()].filter(Boolean).join(' ');
}

export function requestFailure(failure, { reason, jobId } = {}) {
  if (failure.name === 'AbortError' || failure.code === 'chat-job-cancelled') {
    if (['user-stop', 'voice-ended', 'unmount'].includes(reason) || failure.code === 'chat-job-cancelled')
      return { kind: 'neutral', label: reason === 'voice-ended' ? 'La conversación por voz terminó' : 'Detuviste la respuesta. El chat se conserva.' };
    return { kind: 'recover', jobId, label: 'Estoy recuperando tu consulta…' };
  }
  if (jobId && ['olivia-network-error', 'olivia-timeout', 'stream-incomplete'].includes(failure.code))
    return { kind: 'recover', jobId, label: 'Sigo trabajando en tu consulta. Recuperando la conexión…' };
  return { kind: 'error', label: failure.message };
}
