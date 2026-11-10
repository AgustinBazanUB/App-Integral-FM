import { EqualizerOrb } from './voiceorbs/EqualizerOrb';
import { OrbPill } from './voiceorbs/OrbPill';

export default function OliviaVoiceControls({ visual, active, compact, muted }) {
  return <section className={`fm-olivia-voice-stage${active ? ' is-active' : ''}${compact ? ' is-compact' : ''}`} data-orb-state={visual.state} aria-label="Estado de Olivia">
    {['error', 'disabled'].includes(visual.state) ? <OrbPill orb={EqualizerOrb} state={visual.state} text={visual.pill || (visual.state === 'error' ? 'Revisar conexión' : 'Voz desactivada')} orbScale={.8} /> : <><span className={`fm-olivia-orb-frame${visual.state === 'connecting' ? ' is-connecting' : ''}`}><EqualizerOrb state={visual.state === 'connecting' ? 'idle' : visual.state} size={compact ? 36 : active ? 108 : 88} label={`Olivia: ${visual.label}`} />{visual.state === 'connecting' ? <span className="fm-olivia-connection-ring" aria-hidden="true" /> : null}</span><p className="fm-olivia-state-label" role="status">{visual.label}</p></>}
    {active ? <small className="fm-olivia-microphone-status">{muted ? 'Micrófono silenciado' : 'Micrófono activado'}</small> : null}
  </section>;
}
