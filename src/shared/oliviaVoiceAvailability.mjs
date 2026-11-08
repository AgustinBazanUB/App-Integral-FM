import { canAccessAdministration } from "../gestion/permissions.js";

// Netlify exposes CONTEXT during builds but not inside Functions at runtime.
// Configure this marker only for the Deploy Previews context in Netlify.
export function isOliviaDeployPreview(env = process.env) {
  return env.OLIVIA_DEPLOY_PREVIEW_CONTEXT === "deploy-preview"
    && (!env.CONTEXT || env.CONTEXT === "deploy-preview");
}

export function canUseOliviaVoice(identity, env = process.env) {
  const ownerTrial = typeof identity?.email === "string" && identity.email.trim().toLowerCase() === "agsreserva@gmail.com";
  const stagingAdminTrial = isOliviaDeployPreview(env)
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

export const OLIVIA_VOICE_UNAVAILABLE_CODE = "voice-not-enabled";
export const OLIVIA_VOICE_UNAVAILABLE_MESSAGE = "La conversación por voz usa Gemini Live y está habilitada para la prueba administrativa en Deploy Preview. Podés seguir escribiendo o dictar un mensaje.";
