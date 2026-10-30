import { EqualizerOrb } from './voiceorbs/EqualizerOrb';
import { OrbPill } from './voiceorbs/OrbPill';

export default function OliviaVoiceControls({ visual, active, compact, muted }) {
  return <section className={`fm-olivia-voice-stage${active ? ' is-active' : ''}${compact ? ' is-compact' : ''}`} data-orb-state={visual.state} aria-label="Estado de Olivia">
    {['error', 'disabled'].includes(visual.state) ? <OrbPill orb={EqualizerOrb} state={visual.state} text={visual.pill || (visual.state === 'error' ? 'Volver a conectar' : 'Voz desactivada')} orbScale={.8} /> : <><EqualizerOrb state={visual.state} size={compact ? 35.2 : active ? 134.4 : 76.8} label={`Olivia: ${visual.label}`} /><span className="fm-olivia-sr-only" role="status">{visual.label}</span></>}
    {active ? <small className="fm-olivia-microphone-status">{muted ? 'Micrófono silenciado' : 'Micrófono activado'}</small> : null}
  </section>;
}
