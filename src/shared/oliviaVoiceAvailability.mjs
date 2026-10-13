// El servidor verifica el correo devuelto por Firebase, nunca el del navegador.
export function canUseOliviaVoice(identity) {
  return typeof identity?.email === "string" && identity.email.trim().toLowerCase() === "agsreserva@gmail.com";
}
export const OLIVIA_VOICE_POLICY = Object.freeze({ model: "gpt-live-1", voice: "marin", backendModel: "gpt-6-luna", reasoningEffort: "low" });
export function oliviaVoiceConfiguration(config) {
  return { ...config, voiceProtocol: "live", profiles: { ...config.profiles, live: { model: OLIVIA_VOICE_POLICY.model, voice: OLIVIA_VOICE_POLICY.voice } }, voiceBackend: { model: OLIVIA_VOICE_POLICY.backendModel, reasoningEffort: OLIVIA_VOICE_POLICY.reasoningEffort } };
}
export const OLIVIA_VOICE_UNAVAILABLE_CODE = "voice-not-enabled";
export const OLIVIA_VOICE_UNAVAILABLE_MESSAGE = "La conversación por voz no está habilitada para esta cuenta. Podés seguir escribiendo o dictar un mensaje.";
