export function canUseOliviaVoice(identity) {
  // Keep the current owner-only rollout boundary for the administrator trial.
  return typeof identity?.email === "string" && identity.email.trim().toLowerCase() === "agsreserva@gmail.com";
}

export function hasGoogleCloudTtsCredentials(env = process.env) {
  if (env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    try {
      const account = JSON.parse(env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      return Boolean(account?.project_id && account?.client_email && account?.private_key);
    } catch {
      return false;
    }
  }
  return Boolean(env.GOOGLE_APPLICATION_CREDENTIALS);
}

export const OLIVIA_VOICE_UNAVAILABLE_CODE = "voice-not-enabled";
export const OLIVIA_VOICE_UNAVAILABLE_MESSAGE = "La conversación natural por voz todavía está habilitada solo para la prueba administrativa. Podés seguir escribiendo o dictar un mensaje.";
