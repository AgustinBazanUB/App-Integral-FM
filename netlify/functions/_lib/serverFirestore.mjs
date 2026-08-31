import { createSign } from "node:crypto";

const PROJECT_ID = "app-integral-fm";
const TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";
const DATASTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
let cachedToken = null;

const base64url = (value) => Buffer.from(value).toString("base64url");

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    const error = new Error("Falta FIREBASE_SERVICE_ACCOUNT_JSON en Netlify.");
    error.code = "firebase-admin-not-configured";
    error.status = 503;
    throw error;
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    const error = new Error("FIREBASE_SERVICE_ACCOUNT_JSON no tiene un formato válido.");
    error.code = "firebase-admin-invalid";
    error.status = 500;
    throw error;
  }
  if (parsed.project_id !== PROJECT_ID || !parsed.client_email || !parsed.private_key) {
    const error = new Error("La cuenta de servicio Firebase no corresponde a app-integral-fm.");
    error.code = "firebase-project-mismatch";
    error.status = 500;
    throw error;
  }
  return parsed;
}

async function serviceToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken?.accessToken && cachedToken.expiresAt - now > 120) return cachedToken.accessToken;
  const account = serviceAccount();
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: account.client_email,
    scope: DATASTORE_SCOPE,
    aud: TOKEN_AUDIENCE,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(account.private_key).toString("base64url")}`;
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const response = await fetch(TOKEN_AUDIENCE, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    const error = new Error("No se pudo autorizar el backend contra Firebase.");
    error.code = "firebase-admin-auth-failed";
    error.status = 503;
    throw error;
  }
  cachedToken = { accessToken: data.access_token, expiresAt: now + Number(data.expires_in || 3600) };
  return cachedToken.accessToken;
}

function toFsValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFsValue) } };
  if (typeof value === "object") return { mapValue: { fields: toFsFields(value) } };
  return { stringValue: String(value) };
}

function toFsFields(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, toFsValue(item)]));
}

function fromFsValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return new Date(value.timestampValue);
  if ("arrayValue" in value) return (value.arrayValue?.values || []).map(fromFsValue);
  if ("mapValue" in value) return fromFsFields(value.mapValue?.fields || {});
  return null;
}

function fromFsFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fromFsValue(value)]));
}

const documentUrl = (path) => `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path.split("/").map(encodeURIComponent).join("/")}`;

async function adminFetch(url, options = {}) {
  const token = await serviceToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  if (response.status === 404) return { response, data: null };
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("Firestore backend no pudo completar la operación.");
    error.code = "firebase-admin-operation-failed";
    error.status = 503;
    error.providerStatus = response.status;
    throw error;
  }
  return { response, data };
}

export async function adminGet(path, { optional = false } = {}) {
  const { response, data } = await adminFetch(documentUrl(path));
  if (response.status === 404) {
    if (optional) return null;
    const error = new Error("El documento solicitado no existe.");
    error.code = "not-found";
    error.status = 404;
    throw error;
  }
  return { id: path.split("/").at(-1), ...fromFsFields(data.fields || {}) };
}

export async function adminSet(path, value) {
  const { data } = await adminFetch(documentUrl(path), {
    method: "PATCH",
    body: JSON.stringify({ fields: toFsFields(value) }),
  });
  return { id: path.split("/").at(-1), ...fromFsFields(data.fields || {}) };
}

export async function adminPatch(path, patch) {
  const keys = Object.keys(patch || {});
  if (!keys.length) return adminGet(path);
  const params = new URLSearchParams();
  for (const key of keys) params.append("updateMask.fieldPaths", key);
  const { data } = await adminFetch(`${documentUrl(path)}?${params.toString()}`, {
    method: "PATCH",
    body: JSON.stringify({ fields: toFsFields(patch) }),
  });
  return { id: path.split("/").at(-1), ...fromFsFields(data.fields || {}) };
}

export async function adminDelete(path) {
  const token = await serviceToken();
  const response = await fetch(documentUrl(path), { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  if (![200, 204, 404].includes(response.status)) {
    const error = new Error("No se pudo eliminar el documento backend.");
    error.code = "firebase-admin-operation-failed";
    error.status = 503;
    throw error;
  }
}

export async function adminList(collectionPath, { pageSize = 200 } = {}) {
  const url = `${documentUrl(collectionPath)}?pageSize=${Math.min(500, Math.max(1, Number(pageSize) || 200))}`;
  const { data } = await adminFetch(url);
  return (data?.documents || []).map((document) => ({
    id: document.name.split("/").at(-1),
    ...fromFsFields(document.fields || {}),
  }));
}

export function backendFirebaseProjectId() {
  return PROJECT_ID;
}
