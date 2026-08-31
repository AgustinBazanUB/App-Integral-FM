import crypto from "node:crypto";

const PROJECT_ID = "app-integral-fm";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
let tokenCache = null;

const b64url = (value) => Buffer.from(value).toString("base64url");
const nowSeconds = () => Math.floor(Date.now() / 1000);

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_APP_INTEGRAL_FM || "";
  if (!raw) {
    const error = new Error("Falta configurar la credencial server-side de Firebase para integraciones.");
    error.code = "firebase-admin-not-configured";
    error.status = 503;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const error = new Error("La credencial server-side de Firebase no tiene un formato válido.");
    error.code = "firebase-admin-invalid";
    error.status = 500;
    throw error;
  }
  if (parsed.project_id !== PROJECT_ID || !parsed.client_email || !parsed.private_key) {
    const error = new Error("La credencial server-side de Firebase no pertenece al proyecto autorizado.");
    error.code = "firebase-admin-project-mismatch";
    error.status = 500;
    throw error;
  }
  return parsed;
}

async function adminAccessToken() {
  if (tokenCache?.token && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const account = serviceAccount();
  const iat = nowSeconds();
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: account.client_email,
    scope: FIRESTORE_SCOPE,
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), account.private_key).toString("base64url");
  const assertion = `${unsigned}.${signature}`;
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    const error = new Error("No se pudo autorizar el backend contra Firebase.");
    error.code = "firebase-admin-auth-failed";
    error.status = 503;
    throw error;
  }
  tokenCache = { token: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
  return tokenCache.token;
}

function jsValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Firestore no admite números no finitos.");
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(jsValue) } };
  if (typeof value === "object") return { mapValue: { fields: jsFields(value) } };
  return { stringValue: String(value) };
}

function jsFields(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, jsValue(item)]));
}

function fromValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue?.values || []).map(fromValue);
  if ("mapValue" in value) return fromFields(value.mapValue?.fields || {});
  return null;
}

function fromFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fromValue(value)]));
}

function baseUrl() {
  return `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
}

async function adminFetch(url, options = {}) {
  const token = await adminAccessToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  return response;
}

export async function adminGetDocument(path, { optional = false } = {}) {
  const response = await adminFetch(`${baseUrl()}/${path.split("/").map(encodeURIComponent).join("/")}`);
  if (response.status === 404 && optional) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("No se pudo leer la configuración interna.");
    error.code = response.status === 404 ? "admin-document-not-found" : "firebase-admin-read-failed";
    error.status = response.status === 404 ? 404 : 503;
    throw error;
  }
  return { id: body.name?.split("/").pop() || "", name: body.name || "", updateTime: body.updateTime || null, ...fromFields(body.fields || {}) };
}

export async function adminSetDocument(path, data) {
  const response = await adminFetch(`${baseUrl()}/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PATCH",
    body: JSON.stringify({ fields: jsFields(data) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("No se pudo guardar la configuración interna.");
    error.code = "firebase-admin-write-failed";
    error.status = 503;
    throw error;
  }
  return { id: body.name?.split("/").pop() || "", ...fromFields(body.fields || {}) };
}

export async function adminPatchDocument(path, patch) {
  const keys = Object.keys(patch || {});
  if (!keys.length) return adminGetDocument(path);
  const url = new URL(`${baseUrl()}/${path.split("/").map(encodeURIComponent).join("/")}`);
  for (const key of keys) url.searchParams.append("updateMask.fieldPaths", key);
  const response = await adminFetch(url.toString(), {
    method: "PATCH",
    body: JSON.stringify({ fields: jsFields(patch) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("No se pudo actualizar la configuración interna.");
    error.code = response.status === 404 ? "admin-document-not-found" : "firebase-admin-write-failed";
    error.status = response.status === 404 ? 404 : 503;
    throw error;
  }
  return { id: body.name?.split("/").pop() || "", ...fromFields(body.fields || {}) };
}

export async function adminDeleteDocument(path, { ignoreMissing = true } = {}) {
  const response = await adminFetch(`${baseUrl()}/${path.split("/").map(encodeURIComponent).join("/")}`, { method: "DELETE" });
  if (response.status === 404 && ignoreMissing) return;
  if (!response.ok) {
    const error = new Error("No se pudo eliminar el registro interno.");
    error.code = "firebase-admin-delete-failed";
    error.status = 503;
    throw error;
  }
}

export async function adminListCollection(path, { pageSize = 100, pageToken = "" } = {}) {
  const url = new URL(`${baseUrl()}/${path.split("/").map(encodeURIComponent).join("/")}`);
  url.searchParams.set("pageSize", String(Math.min(Math.max(Number(pageSize) || 100, 1), 300)));
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  const response = await adminFetch(url.toString());
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("No se pudo leer la colección interna.");
    error.code = "firebase-admin-list-failed";
    error.status = 503;
    throw error;
  }
  return {
    items: (body.documents || []).map((document) => ({ id: document.name?.split("/").pop() || "", ...fromFields(document.fields || {}) })),
    nextPageToken: body.nextPageToken || null,
  };
}

export function firebaseAdminConfigured() {
  try {
    serviceAccount();
    return true;
  } catch {
    return false;
  }
}

export function firebaseAdminProjectId() {
  return PROJECT_ID;
}
