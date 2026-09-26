import { createSign } from "node:crypto";

const PROJECT_ID = "app-integral-fm";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
let tokenCache = null;

function required(name, env = process.env) {
  const value = String(env[name] || "").trim();
  if (!value) {
    const error = new Error(`Falta configurar ${name}.`);
    error.code = "firebase-admin-config-missing";
    error.field = name;
    throw error;
  }
  return value;
}

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function adminConfig(env = process.env) {
  const projectId = String(env.FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID || PROJECT_ID).trim();
  if (projectId !== PROJECT_ID) {
    const error = new Error("Configuración Firebase administrativa inválida.");
    error.code = "firebase-project-mismatch";
    throw error;
  }
  return {
    projectId,
    clientEmail: required("FIREBASE_ADMIN_CLIENT_EMAIL", env),
    privateKey: required("FIREBASE_ADMIN_PRIVATE_KEY", env).replace(/\\n/g, "\n"),
  };
}

function serviceAccountAssertion(config, now = new Date()) {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: config.clientEmail,
    scope: FIRESTORE_SCOPE,
    aud: TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(config.privateKey).toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
  return `${unsigned}.${signature}`;
}

export async function firebaseAdminAccessToken({
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  forceRefresh = false,
} = {}) {
  if (!forceRefresh && tokenCache && tokenCache.expiresAt - now.getTime() > 5 * 60 * 1000) {
    return tokenCache.token;
  }
  const config = adminConfig(env);
  const assertion = serviceAccountAssertion(config, now);
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const error = new Error("Google rechazó las credenciales administrativas de Firebase.");
    error.code = "firebase-admin-token-error";
    error.status = response.status || 500;
    throw error;
  }
  tokenCache = {
    token: payload.access_token,
    expiresAt: now.getTime() + Number(payload.expires_in || 3600) * 1000,
  };
  return tokenCache.token;
}

export function clearFirebaseAdminTokenCache() {
  tokenCache = null;
}

function firestoreBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

function encodePath(path) {
  return String(path || "").split("/").map((part) => encodeURIComponent(part)).join("/");
}

function fromFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in value) return Object.fromEntries(
    Object.entries(value.mapValue.fields || {}).map(([key, child]) => [key, fromFirestoreValue(child)]),
  );
  return null;
}

function toFirestoreValue(value) {
  if (value == null) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value)
            .filter(([, child]) => child !== undefined)
            .map(([key, child]) => [key, toFirestoreValue(child)]),
        ),
      },
    };
  }
  throw new Error("Tipo de dato no soportado para Firestore.");
}

function fieldsFromObject(object = {}) {
  return Object.fromEntries(
    Object.entries(object)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, toFirestoreValue(value)]),
  );
}

function documentFromResponse(payload, path) {
  if (!payload?.name) return null;
  const parts = payload.name.split("/documents/");
  return {
    path: parts[1] || path,
    createTime: payload.createTime || null,
    updateTime: payload.updateTime || null,
    data: Object.fromEntries(
      Object.entries(payload.fields || {}).map(([key, value]) => [key, fromFirestoreValue(value)]),
    ),
  };
}

async function adminFetch(path, {
  env = process.env,
  fetchImpl = fetch,
  method = "GET",
  query = "",
  body,
} = {}) {
  const config = adminConfig(env);
  const token = await firebaseAdminAccessToken({ env, fetchImpl });
  const response = await fetchImpl(`${firestoreBase(config.projectId)}/${encodePath(path)}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

export async function adminGetDocument(path, options = {}) {
  const { response, payload } = await adminFetch(path, options);
  if (response.status === 404) return null;
  if (!response.ok) {
    const error = new Error("No se pudo leer Firestore desde el backend.");
    error.code = "firebase-admin-read-error";
    error.status = response.status;
    throw error;
  }
  return documentFromResponse(payload, path);
}

export async function adminCreateDocument(collectionPath, documentId, data, options = {}) {
  const query = `?documentId=${encodeURIComponent(documentId)}`;
  const { response, payload } = await adminFetch(collectionPath, {
    ...options,
    method: "POST",
    query,
    body: { fields: fieldsFromObject(data) },
  });
  if (response.status === 409) {
    const error = new Error("El documento ya existe.");
    error.code = "firebase-admin-already-exists";
    error.status = 409;
    throw error;
  }
  if (!response.ok) {
    const error = new Error("No se pudo crear el documento fiscal.");
    error.code = "firebase-admin-create-error";
    error.status = response.status;
    throw error;
  }
  return documentFromResponse(payload, `${collectionPath}/${documentId}`);
}

export async function adminPatchDocument(path, data, {
  updateMask = Object.keys(data || {}),
  ...options
} = {}) {
  const query = updateMask.length
    ? `?${updateMask.map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join("&")}`
    : "";
  const { response, payload } = await adminFetch(path, {
    ...options,
    method: "PATCH",
    query,
    body: { fields: fieldsFromObject(data) },
  });
  if (!response.ok) {
    const error = new Error("No se pudo actualizar el documento fiscal.");
    error.code = "firebase-admin-update-error";
    error.status = response.status;
    throw error;
  }
  return documentFromResponse(payload, path);
}
