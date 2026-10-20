export const PRODUCTION_FIREBASE_PROJECT_ID = "app-integral-fm";
export const STAGING_FIREBASE_PROJECT_ID = "app-integral-fm-pruebas";

const SUPPORTED_FIREBASE_PROJECT_IDS = new Set([
  PRODUCTION_FIREBASE_PROJECT_ID,
  STAGING_FIREBASE_PROJECT_ID,
]);

export function configuredFirebaseProjectId(env = process.env) {
  const serverProjectId = String(env.FIREBASE_PROJECT_ID || "").trim();
  const clientProjectId = String(env.VITE_FIREBASE_PROJECT_ID || "").trim();
  if (serverProjectId && clientProjectId && serverProjectId !== clientProjectId) {
    const error = new Error("El proyecto Firebase del servidor y del cliente no coincide.");
    error.code = "firebase-project-mismatch";
    error.status = 500;
    throw error;
  }
  const projectId = serverProjectId || clientProjectId || PRODUCTION_FIREBASE_PROJECT_ID;
  if (!SUPPORTED_FIREBASE_PROJECT_IDS.has(projectId)) {
    const error = new Error("Configuración Firebase inválida.");
    error.code = "firebase-project-mismatch";
    error.status = 500;
    throw error;
  }
  return projectId;
}

export function assertFirebaseServiceAccountProject(projectId, clientEmail) {
  const match = /^.+@([a-z0-9-]+)\.iam\.gserviceaccount\.com$/i.exec(String(clientEmail || ""));
  if (!match || match[1] !== projectId) {
    const error = new Error("La cuenta de servicio Firebase no corresponde al proyecto configurado.");
    error.code = "firebase-project-mismatch";
    error.status = 500;
    throw error;
  }
}
