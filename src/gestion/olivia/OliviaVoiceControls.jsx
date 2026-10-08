export default function OliviaVoiceControls({ active, state, caption, modeLabel, pending, muted }) {
  if (!active && state !== "ended") return null;
  const label = state === "connecting" ? "Conectando voz…" : state === "processing" ? "Consultando el sistema…" : state === "speaking" ? "Olivia está hablando" : state === "ended" ? "La sesión de voz terminó" : pending ? "Confirmá en la tarjeta para continuar" : muted ? "Micrófono silenciado" : "Micrófono activo";
  return <section className="fm-olivia-voice" aria-live="polite">{modeLabel ? <small>{modeLabel}</small> : null}<strong>{label}</strong>{caption ? <p>{caption}</p> : null}</section>;
}
