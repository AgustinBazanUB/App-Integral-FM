const FIREBASE_PROJECT_ID = "app-integral-fm";
const FIREBASE_WEB_API_KEY_FALLBACK = "AIzaSyCBVuIt36d_0DbDdEkGwRy85hmpZEjbrVg";

function apiKey() {
  return process.env.FIREBASE_WEB_API_KEY
    || process.env.VITE_FIREBASE_API_KEY
    || FIREBASE_WEB_API_KEY_FALLBACK;
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
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey())}`, {
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

async function loadOwnProfile(idToken, uid) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(uid)}`, {
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
  const configuredProject = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID;
  if (configuredProject !== FIREBASE_PROJECT_ID) {
    const error = new Error("Configuración Firebase inválida.");
    error.code = "firebase-project-mismatch";
    error.status = 500;
    throw error;
  }
  const idToken = bearerToken(request);
  if (!idToken) {
    const error = new Error("Falta una sesión válida.");
    error.code = "unauthenticated";
    error.status = 401;
    throw error;
  }
  const identity = await lookupFirebaseUser(idToken);
  const profile = await loadOwnProfile(idToken, identity.localId);
  if (!allowedAction(profile, action)) {
    const error = new Error("No tenés permiso para esta operación.");
    error.code = "permission-denied";
    error.status = 403;
    throw error;
  }
  return { idToken, uid: identity.localId, email: identity.email || null, profile };
}

export function publicFirebaseProjectId() {
  return FIREBASE_PROJECT_ID;
}
