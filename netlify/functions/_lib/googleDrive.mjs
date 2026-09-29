import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { adminDelete, adminGet, adminSet } from "./serverFirestore.mjs";

export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GOOGLE_DRIVE_CONNECTION_ID = "googleDrive";
export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const SECRET_PATH = "integrationSecrets/googleDrive";
const CONNECTION_PATH = "integrationConnections/googleDrive";

function configValue(name) {
  return String(process.env[name] || "").trim();
}

export function googleDriveConfiguration() {
  const clientId = configValue("GOOGLE_CLIENT_ID");
  const clientSecret = configValue("GOOGLE_CLIENT_SECRET");
  const redirectUri = configValue("GOOGLE_OAUTH_REDIRECT_URI");
  const encryptionKey = configValue("GOOGLE_TOKEN_ENCRYPTION_KEY");
  const rootFolderName = configValue("GOOGLE_DRIVE_ROOT_FOLDER_NAME") || "Meta Ads";
  const sharedDriveId = configValue("GOOGLE_DRIVE_SHARED_DRIVE_ID") || null;
  return {
    configured: Boolean(clientId && clientSecret && redirectUri && encryptionKey),
    clientId,
    clientSecret,
    redirectUri,
    encryptionKey,
    rootFolderName,
    sharedDriveId,
    mode: sharedDriveId ? "shared_drive" : "my_drive",
    scope: GOOGLE_DRIVE_SCOPE,
  };
}

function requireDriveConfiguration() {
  const config = googleDriveConfiguration();
  if (!config.configured) {
    const error = new Error("Google Drive todavía no está configurado.");
    error.code = "drive-not-configured";
    error.status = 503;
    throw error;
  }
  let redirect;
  try { redirect = new URL(config.redirectUri); } catch {
    const error = new Error("GOOGLE_OAUTH_REDIRECT_URI no es una URL válida.");
    error.code = "drive-config-invalid";
    error.status = 500;
    throw error;
  }
  if (redirect.protocol !== "https:" && redirect.hostname !== "localhost") {
    const error = new Error("El callback de Google Drive debe utilizar HTTPS.");
    error.code = "drive-config-invalid";
    error.status = 500;
    throw error;
  }
  if (config.encryptionKey.length < 32) {
    const error = new Error("GOOGLE_TOKEN_ENCRYPTION_KEY debe tener al menos 32 caracteres aleatorios.");
    error.code = "drive-config-invalid";
    error.status = 500;
    throw error;
  }
  return config;
}

function encryptionKeyBytes(secret) {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptRefreshToken(token) {
  const config = requireDriveConfiguration();
  if (!token || typeof token !== "string") throw new Error("Refresh token inválido.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKeyBytes(config.encryptionKey), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptRefreshToken(payload) {
  const config = requireDriveConfiguration();
  if (!payload || payload.version !== 1 || payload.algorithm !== "aes-256-gcm") {
    const error = new Error("La credencial de Google Drive no tiene un formato válido.");
    error.code = "drive-token-invalid";
    error.status = 503;
    throw error;
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKeyBytes(config.encryptionKey),
      Buffer.from(payload.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    const error = new Error("No se pudo descifrar la conexión con Google Drive.");
    error.code = "drive-token-invalid";
    error.status = 503;
    throw error;
  }
}

export function buildGoogleAuthorizationUrl({ state, loginHint = "" } = {}) {
  const config = requireDriveConfiguration();
  if (!state || typeof state !== "string") throw new Error("OAuth state requerido.");
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GOOGLE_DRIVE_SCOPE,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  if (loginHint) params.set("login_hint", String(loginHint).slice(0, 254));
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeAuthorizationCode(code) {
  const config = requireDriveConfiguration();
  if (!code) throw new Error("Código OAuth faltante.");
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    const error = new Error("Google no pudo completar la autorización de Drive.");
    error.code = data.error === "invalid_grant" ? "drive-oauth-invalid-grant" : "drive-oauth-failed";
    error.status = 400;
    throw error;
  }
  return data;
}

async function refreshAccessToken(refreshToken) {
  const config = requireDriveConfiguration();
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    const error = new Error("La conexión con Google Drive necesita renovarse.");
    error.code = data.error === "invalid_grant" ? "drive-reconnect-required" : "drive-token-refresh-failed";
    error.status = data.error === "invalid_grant" ? 401 : 503;
    throw error;
  }
  return data.access_token;
}

export async function storeGoogleDriveSecret(refreshToken, { connectedBy } = {}) {
  const encryptedRefreshToken = encryptRefreshToken(refreshToken);
  await adminSet(SECRET_PATH, {
    schemaVersion: 1,
    provider: "google_drive",
    encryptedRefreshToken,
    connectedBy: connectedBy || null,
    updatedAt: new Date(),
  });
}

export async function clearGoogleDriveSecret() {
  await adminDelete(SECRET_PATH);
}

export async function getDriveAccessToken() {
  const secret = await adminGet(SECRET_PATH, { optional: true });
  if (!secret?.encryptedRefreshToken) {
    const error = new Error("Google Drive todavía no está conectado.");
    error.code = "drive-not-connected";
    error.status = 409;
    throw error;
  }
  return refreshAccessToken(decryptRefreshToken(secret.encryptedRefreshToken));
}

function driveError(status, payload = {}) {
  const reason = payload?.error?.errors?.[0]?.reason || payload?.error?.status || "";
  const message = String(payload?.error?.message || "");
  const error = new Error("Google Drive no pudo completar la operación.");
  error.providerStatus = status;
  if (status === 401 || status === 403 && /invalid credentials|auth/i.test(message)) {
    error.code = "drive-reconnect-required";
    error.status = 401;
  } else if (status === 403 && /quota|storagequota|ratelimit|limit/i.test(`${reason} ${message}`)) {
    error.code = "drive-quota";
    error.status = 429;
  } else if (status === 404) {
    error.code = "drive-folder-inaccessible";
    error.status = 404;
  } else if (status === 429) {
    error.code = "drive-rate-limit";
    error.status = 429;
  } else {
    error.code = "drive-provider-error";
    error.status = status >= 500 ? 503 : 400;
  }
  return error;
}

async function driveFetch(path, { accessToken = null, method = "GET", body = undefined, headers = {}, raw = false } = {}) {
  const token = accessToken || await getDriveAccessToken();
  const response = await fetch(path.startsWith("http") ? path : `${DRIVE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json; charset=UTF-8" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return response;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw driveError(response.status, data);
  return data;
}

export async function getDriveAbout(accessToken = null) {
  return driveFetch("/about?fields=user(displayName,emailAddress,permissionId),storageQuota(limit,usage)", { accessToken });
}

export async function getDriveFile(fileId, { accessToken = null } = {}) {
  const id = encodeURIComponent(String(fileId || ""));
  if (!id) throw new Error("Drive fileId requerido.");
  return driveFetch(`/files/${id}?supportsAllDrives=true&fields=id,name,mimeType,size,parents,createdTime,modifiedTime,trashed,driveId,webViewLink,appProperties`, { accessToken });
}

export async function createDriveFolder({ name, parentId = null, driveId = null, appProperties = {}, accessToken = null } = {}) {
  const config = requireDriveConfiguration();
  const parents = parentId ? [parentId] : (driveId || config.sharedDriveId ? [driveId || config.sharedDriveId] : undefined);
  return driveFetch("/files?supportsAllDrives=true&fields=id,name,mimeType,parents,driveId,createdTime,webViewLink,appProperties", {
    accessToken,
    method: "POST",
    body: {
      name: String(name || "Carpeta").slice(0, 120),
      mimeType: DRIVE_FOLDER_MIME,
      ...(parents ? { parents } : {}),
      appProperties: {
        owner: "flor_mia_meta_ads",
        ...appProperties,
      },
    },
  });
}

export async function ensureDriveRootFolder({ accessToken = null } = {}) {
  const config = requireDriveConfiguration();
  const connection = await adminGet(CONNECTION_PATH, { optional: true });
  if (connection?.rootFolderId) {
    try {
      const existing = await getDriveFile(connection.rootFolderId, { accessToken });
      if (existing.mimeType === DRIVE_FOLDER_MIME && existing.trashed !== true) return existing;
    } catch (error) {
      if (!["drive-folder-inaccessible", "drive-provider-error"].includes(error.code)) throw error;
    }
  }
  return createDriveFolder({
    name: config.rootFolderName,
    driveId: config.sharedDriveId,
    accessToken,
    appProperties: { purpose: "meta_ads_root" },
  });
}

export async function createResumableUpload({ accessToken = null, fileName, mimeType, sizeBytes, parentId, appProperties = {} } = {}) {
  const token = accessToken || await getDriveAccessToken();
  const query = new URLSearchParams({ uploadType: "resumable", supportsAllDrives: "true", fields: "id,name,mimeType,size,parents,createdTime,driveId,webViewLink,appProperties" });
  const response = await fetch(`${DRIVE_UPLOAD_API}/files?${query.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mimeType,
      "X-Upload-Content-Length": String(sizeBytes),
    },
    body: JSON.stringify({
      name: String(fileName).slice(0, 180),
      mimeType,
      parents: [parentId],
      appProperties: {
        owner: "flor_mia_meta_ads",
        ...appProperties,
      },
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw driveError(response.status, payload);
  }
  const sessionUrl = response.headers.get("location");
  if (!sessionUrl) {
    const error = new Error("Google Drive no devolvió una sesión resumible.");
    error.code = "drive-upload-session-missing";
    error.status = 502;
    throw error;
  }
  return { sessionUrl };
}

export async function revokeGoogleRefreshToken() {
  const secret = await adminGet(SECRET_PATH, { optional: true });
  if (!secret?.encryptedRefreshToken) return { revoked: false };
  const token = decryptRefreshToken(secret.encryptedRefreshToken);
  const response = await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  if (!response.ok && response.status !== 400) {
    const error = new Error("Google no pudo revocar la conexión en este momento.");
    error.code = "drive-revoke-failed";
    error.status = 503;
    throw error;
  }
  return { revoked: response.ok };
}

export async function saveDriveConnection({ account = {}, rootFolder, connectedBy, previous = null } = {}) {
  const config = requireDriveConfiguration();
  const now = new Date();
  const record = {
    schemaVersion: 1,
    provider: "google_drive",
    status: "connected",
    scope: GOOGLE_DRIVE_SCOPE,
    mode: config.mode,
    accountEmail: account.emailAddress || previous?.accountEmail || null,
    accountName: account.displayName || previous?.accountName || null,
    rootFolderId: rootFolder?.id || previous?.rootFolderId || null,
    rootFolderName: rootFolder?.name || previous?.rootFolderName || config.rootFolderName,
    driveId: rootFolder?.driveId || config.sharedDriveId || previous?.driveId || null,
    connectedBy: connectedBy || previous?.connectedBy || null,
    connectedAt: previous?.connectedAt || now,
    updatedAt: now,
    disconnectedAt: null,
    errorCode: null,
  };
  await adminSet(CONNECTION_PATH, record);
  return record;
}

export async function markDriveDisconnected({ disconnectedBy = null, errorCode = null } = {}) {
  const existing = await adminGet(CONNECTION_PATH, { optional: true });
  const now = new Date();
  const record = {
    schemaVersion: 1,
    provider: "google_drive",
    status: errorCode ? "error" : "disconnected",
    scope: GOOGLE_DRIVE_SCOPE,
    mode: existing?.mode || googleDriveConfiguration().mode,
    accountEmail: existing?.accountEmail || null,
    accountName: existing?.accountName || null,
    rootFolderId: existing?.rootFolderId || null,
    rootFolderName: existing?.rootFolderName || null,
    driveId: existing?.driveId || null,
    connectedBy: existing?.connectedBy || null,
    connectedAt: existing?.connectedAt || null,
    updatedAt: now,
    disconnectedAt: now,
    disconnectedBy,
    errorCode,
  };
  await adminSet(CONNECTION_PATH, record);
  return record;
}

export async function driveConnectionStatus() {
  const config = googleDriveConfiguration();
  const connection = await adminGet(CONNECTION_PATH, { optional: true }).catch(() => null);
  return {
    configured: config.configured,
    status: connection?.status || (config.configured ? "not_connected" : "not_configured"),
    connected: connection?.status === "connected",
    accountEmail: connection?.accountEmail || null,
    accountName: connection?.accountName || null,
    rootFolderId: connection?.rootFolderId || null,
    rootFolderName: connection?.rootFolderName || config.rootFolderName,
    driveId: connection?.driveId || config.sharedDriveId || null,
    mode: connection?.mode || config.mode,
    scope: GOOGLE_DRIVE_SCOPE,
    errorCode: connection?.errorCode || null,
  };
}

export function newOAuthState() {
  return randomBytes(32).toString("base64url");
}

export function newBackendId(prefix = "id") {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}
