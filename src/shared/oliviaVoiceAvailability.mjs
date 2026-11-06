import { canAccessAdministration } from "../gestion/permissions.js";

export function canUseOliviaVoice(identity, env = process.env) {
  const ownerTrial = typeof identity?.email === "string" && identity.email.trim().toLowerCase() === "agsreserva@gmail.com";
  const stagingAdminTrial = env.CONTEXT === "deploy-preview"
    && env.OLIVIA_HYBRID_LIVE_ENABLED === "true"
    && env.GEMINI_API_BILLING_TIER === "paid"
    && Boolean(env.GEMINI_API_KEY)
    && env.FIREBASE_PROJECT_ID === "app-integral-fm-pruebas"
    && identity?.profile?.active === true
    && canAccessAdministration(identity.profile);

  // Keep the existing owner trial and allow paid voice tests for active admins
  // only in the isolated Firebase Deploy Preview configured for the hybrid test.
  return ownerTrial || stagingAdminTrial;
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
