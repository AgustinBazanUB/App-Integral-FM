const previewContexts = new Set(["deploy-preview", "branch-deploy"]);

// Netlify exposes CONTEXT at build time. Refuse to build a preview unless the
// browser bundle targets the known staging Firebase app. Functions credentials
// are scoped separately in Netlify and must also be verified operationally.
export function validatePreviewFirebase(env = process.env) {
  if (env.NETLIFY === "true" && env.CONTEXT === "production" && env.NETLIFY_PREVIEW_SERVER !== "true" && env.VITE_PREVIEW_FIREBASE_PROJECT_ID === "app-integral-fm-pruebas") {
    throw new Error("Deploy de producción bloqueado: la configuración web apunta a Firebase de pruebas. Ver docs/FIREBASE-PRUEBAS.md.");
  }
  if (env.NETLIFY !== "true" || (!previewContexts.has(env.CONTEXT) && env.NETLIFY_PREVIEW_SERVER !== "true")) return;

  const expected = {
    VITE_PREVIEW_FIREBASE_PROJECT_ID: "app-integral-fm-pruebas",
    VITE_PREVIEW_FIREBASE_AUTH_DOMAIN: "app-integral-fm-pruebas.firebaseapp.com",
    VITE_PREVIEW_FIREBASE_STORAGE_BUCKET: "app-integral-fm-pruebas.firebasestorage.app",
    VITE_PREVIEW_FIREBASE_MESSAGING_SENDER_ID: "545036860675",
    VITE_PREVIEW_FIREBASE_APP_ID: "1:545036860675:web:c76e458afc8f8f706f7d36",
  };
  const validIdentity = Object.entries(expected).every(([key, value]) => String(env[key] || "").trim() === value);
  const apiKey = String(env.VITE_PREVIEW_FIREBASE_API_KEY || "").trim();
  const productionApiKey = "AIzaSyCBVuIt36d_0DbDdEkGwRy85hmpZEjbrVg";
  if (!validIdentity || !apiKey || apiKey === productionApiKey) {
    throw new Error("Deploy Preview bloqueado: la configuración web de Firebase debe corresponder a app-integral-fm-pruebas y estar completa. Ver docs/FIREBASE-PRUEBAS.md.");
  }
}
