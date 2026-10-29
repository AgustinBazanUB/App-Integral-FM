import { EqualizerOrb } from './voiceorbs/EqualizerOrb';

export default function OliviaVoiceControls({ visual, levelRef, active, compact, caption, notice, onRetryTranscription, onRetryAudio }) {
  return <section className={`fm-olivia-voice-stage${active ? ' is-active' : ''}${compact ? ' is-compact' : ''}`} data-orb-state={visual.state} aria-label="Estado de Olivia">
    <EqualizerOrb state={visual.state} size={compact ? 44 : active ? 168 : 96} levelRef={['listening', 'speaking'].includes(visual.state) ? levelRef : undefined} label={`Olivia: ${visual.label}`} />
    <div className="fm-olivia-voice-stage__copy"><p className="fm-olivia-state-label" role="status" aria-live="polite">{visual.label}</p>
      {active && caption ? <p className="fm-olivia-caption">{caption}</p> : null}
      {notice ? <p className="fm-olivia-voice-notice">{notice}</p> : null}
      {notice && onRetryAudio ? <button type="button" onClick={onRetryAudio}>Reintentar audio</button> : null}
      {notice && onRetryTranscription ? <button type="button" onClick={onRetryTranscription}>Reintentar transcripción</button> : null}
    </div>
  </section>;
}
