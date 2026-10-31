import { localFirebaseEmulator } from "./firebaseEmulator.mjs";
import {
  configuredFirebaseProjectId,
  PRODUCTION_FIREBASE_PROJECT_ID,
} from "./firebaseProject.mjs";

const FIREBASE_WEB_API_KEY_FALLBACK = "AIzaSyCBVuIt36d_0DbDdEkGwRy85hmpZEjbrVg";

function apiKey() {
  const configuredKey = process.env.FIREBASE_WEB_API_KEY
    || process.env.VITE_FIREBASE_API_KEY
    || "";
  if (configuredKey) return configuredKey;
  if (configuredFirebaseProjectId() !== PRODUCTION_FIREBASE_PROJECT_ID) {
    const error = new Error("Falta la clave web de Firebase para el proyecto configurado.");
    error.code = "firebase-config-missing";
    error.status = 503;
    throw error;
  }
  return FIREBASE_WEB_API_KEY_FALLBACK;
}

function firestoreValueToJs(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue?.values || []).map(firestoreValueToJs);
  if ("mapValue" in value) return firestoreFieldsToJs(value.mapValue?.fields || {});
  return null;
}

function firestoreFieldsToJs(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, firestoreValueToJs(value)]));
}

function bearerToken(request) {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || "";
}

async function lookupFirebaseUser(idToken) {
  const response = await fetch(`${localFirebaseEmulator("auth") ? localFirebaseEmulator("auth") + "/identitytoolkit.googleapis.com" : "https://identitytoolkit.googleapis.com"}/v1/accounts:lookup?key=${encodeURIComponent(apiKey())}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!response.ok) {
    const error = new Error("Firebase rechazó la sesión.");
    error.code = "unauthenticated";
    error.status = 401;
    throw error;
  }
  const payload = await response.json();
  const user = payload?.users?.[0];
  if (!user?.localId || user.disabled === true) {
    const error = new Error("La sesión no está activa.");
    error.code = "unauthenticated";
    error.status = 401;
    throw error;
  }
  return user;
}

async function loadOwnProfile(idToken, uid, projectId) {
  const response = await fetch(`${localFirebaseEmulator("firestore") || "https://firestore.googleapis.com"}/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(uid)}`, {
    headers: { Authorization: `Bearer ${idToken}`, Accept: "application/json" },
  });
  if (response.status === 403) {
    const error = new Error("El perfil no está autorizado.");
    error.code = "permission-denied";
    error.status = 403;
    throw error;
  }
  if (!response.ok) {
    const error = new Error("No se pudo validar el perfil.");
    error.code = "profile-unavailable";
    error.status = 503;
    throw error;
  }
  const payload = await response.json();
  return { id: uid, ...firestoreFieldsToJs(payload.fields || {}) };
}

function normalizedRole(profile = {}) {
  if (profile.role === "admin" || profile.canAccessAdmin === true || profile.isAdmin === true || profile.roles?.includes?.("admin")) return "admin";
  const value = String(profile.role || profile.roles?.[0] || "seller").trim().toLowerCase().replaceAll(" ", "_");
  const aliases = { administrator: "admin", administrador: "admin", administrador_general: "general_admin", responsable_marketing: "marketing_manager" };
  return aliases[value] || value;
}

function explicitAction(profile, action) {
  const modulePermission = profile.permissions?.marketing;
  if (Array.isArray(modulePermission)) return modulePermission.includes(action) || modulePermission.includes("admin");
  if (modulePermission && typeof modulePermission === "object") return modulePermission[action] === true || modulePermission.admin === true;
  return false;
}

const MARKETING_MANAGER_META_ADS_ACTIONS = new Set([
  "metaAdsView", "metaAdsCreateProject", "metaAdsEditProject", "metaAdsArchiveProject",
  "metaAdsManageKnowledge", "metaAdsManageTheory", "metaAdsPlanCampaign", "metaAdsApprovePlan",
  "metaAdsViewCreativeWorkspace", "metaAdsUploadCreative",
]);

function allowedAction(profile, action) {
  if (profile?.active !== true) return false;
  const denied = new Set(profile.permissionDeny?.marketing || []);
  if (denied.has(action)) return false;
  const role = normalizedRole(profile);
  if (role === "admin" || role === "general_admin") return true;
  if (role === "marketing_manager") return MARKETING_MANAGER_META_ADS_ACTIONS.has(action);
  if (explicitAction(profile, action)) return true;
  return (profile.permissionAllow?.marketing || []).includes(action);
}

export async function requireFirebaseMetaAdsPermission(request, action) {
  const projectId = configuredFirebaseProjectId();
  const idToken = bearerToken(request);
  if (!idToken) {
    const error = new Error("Falta una sesión válida.");
    error.code = "unauthenticated";
    error.status = 401;
    throw error;
  }
  const identity = await lookupFirebaseUser(idToken);
  const profile = await loadOwnProfile(idToken, identity.localId, projectId);
  if (!allowedAction(profile, action)) {
    const error = new Error("No tenés permiso para esta operación.");
    error.code = "permission-denied";
    error.status = 403;
    throw error;
  }
  return { idToken, uid: identity.localId, email: identity.email || null, profile };
}

export function publicFirebaseProjectId() {
  return configuredFirebaseProjectId();
}


export async function requireFirebaseActiveProfile(request) {
  const projectId = configuredFirebaseProjectId();
  const idToken = bearerToken(request);
  if (!idToken) {
    const error = new Error("Falta una sesión válida.");
    error.code = "unauthenticated";
    error.status = 401;
    throw error;
  }
  const identity = await lookupFirebaseUser(idToken);
  const profile = await loadOwnProfile(idToken, identity.localId, projectId);
  if (profile?.active !== true) {
    const error = new Error("El perfil no está activo.");
    error.code = "permission-denied";
    error.status = 403;
    throw error;
  }
  return { idToken, uid: identity.localId, email: identity.email || null, profile };
}

export async function requireFirebaseAdmin(request) {
  const session = await requireFirebaseActiveProfile(request);
  const role = normalizedRole(session.profile);
  if (!["admin", "general_admin"].includes(role)) {
    const error = new Error("Esta operación requiere permisos de administración.");
    error.code = "permission-denied";
    error.status = 403;
    throw error;
  }
  return session;
}
