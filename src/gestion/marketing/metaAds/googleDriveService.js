import { auth } from "../../services/firebase.js";
import { DEFAULT_MAX_UPLOAD_BYTES, validateUploadMetadata } from "./creativeWorkspaceDomain.js";

const ENDPOINT = "/.netlify/functions/google-drive";

async function authorizedRequest(operation, payload = {}) {
  const user = auth.currentUser;
  if (!user) {
    const error = new Error("Tu sesión venció. Volvé a iniciar sesión.");
    error.code = "unauthenticated";
    throw error;
  }
  const idToken = await user.getIdToken();
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ operation, ...payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "No pudimos completar la operación con Google Drive.");
    error.code = data.code || `drive-http-${response.status}`;
    error.status = response.status;
    throw error;
  }
  return data;
}

export const getGoogleDriveStatus = () => authorizedRequest("status");
export const loadCreativeWorkspace = (campaignId) => authorizedRequest("workspace", { campaignId });
export const prepareCreativeWorkspace = (campaignId) => authorizedRequest("prepareWorkspace", { campaignId });
export const provisionCampaignDrive = (campaignId) => authorizedRequest("provisionCampaign", { campaignId });
export const startGoogleDriveOAuth = () => authorizedRequest("oauthStart");
export const testGoogleDriveConnection = () => authorizedRequest("testConnection");
export const disconnectGoogleDrive = () => authorizedRequest("disconnect");
export const selectCreativeAsset = (campaignId, taskId, assetId) => authorizedRequest("selectAsset", { campaignId, taskId, assetId });

export async function getGoogleDriveHealth() {
  try {
    const response = await fetch(`${ENDPOINT}?health=1`, { headers: { Accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    return {
      available: response.ok,
      configured: data.configured === true,
      firebaseBackendConfigured: data.firebaseBackendConfigured === true,
      scope: data.scope || "",
      mode: data.mode || "my_drive",
      redirectConfigured: data.redirectConfigured === true,
      maxUploadBytes: Number(data.maxUploadBytes) || DEFAULT_MAX_UPLOAD_BYTES,
      chunkBytes: Number(data.chunkBytes) || 8 * 1024 * 1024,
    };
  } catch {
    return { available: false, configured: false, firebaseBackendConfigured: false, scope: "", mode: "my_drive", redirectConfigured: false, maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES, chunkBytes: 8 * 1024 * 1024 };
  }
}

function parseReceivedRange(value) {
  const match = /bytes=0-(\d+)/i.exec(String(value || ""));
  return match ? Number(match[1]) + 1 : 0;
}

function xhrPut(url, blob, { contentRange, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    if (contentRange) xhr.setRequestHeader("Content-Range", contentRange);
    xhr.setRequestHeader("Content-Type", blob?.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };
    xhr.onerror = () => {
      const error = new Error("Se interrumpió la conexión mientras se subía el archivo.");
      error.code = "drive-upload-network";
      reject(error);
    };
    xhr.onabort = () => {
      const error = new Error("La carga fue cancelada.");
      error.code = "drive-upload-aborted";
      reject(error);
    };
    xhr.onload = () => {
      let data = null;
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { data = null; }
      resolve({
        status: xhr.status,
        ok: xhr.status >= 200 && xhr.status < 300,
        range: xhr.getResponseHeader("Range"),
        data,
      });
    };
    xhr.send(blob);
  });
}

async function queryUploadPosition(sessionUrl, totalSize) {
  const response = await fetch(sessionUrl, {
    method: "PUT",
    headers: { "Content-Range": `bytes */${totalSize}` },
  });
  if (response.status === 308) return { complete: false, offset: parseReceivedRange(response.headers.get("Range")) };
  if (response.ok) return { complete: true, offset: totalSize, data: await response.json().catch(() => ({})) };
  const error = new Error(response.status === 404
    ? "La sesión de carga venció. Volvé a iniciar la carga."
    : "No pudimos recuperar el estado de la carga.");
  error.code = response.status === 404 ? "drive-upload-session-expired" : "drive-upload-status-failed";
  error.status = response.status;
  throw error;
}

export async function uploadFileDirectToDrive({ sessionUrl, file, chunkBytes, onProgress } = {}) {
  if (!sessionUrl || !(file instanceof Blob) || !file.size) {
    const error = new Error("La carga resumible no recibió un archivo válido.");
    error.code = "drive-upload-invalid";
    throw error;
  }
  const unit = 256 * 1024;
  const requestedChunk = Number(chunkBytes) || 8 * 1024 * 1024;
  const size = Math.max(unit, Math.floor(requestedChunk / unit) * unit);
  let offset = 0;
  let finalData = null;
  onProgress?.(0);

  while (offset < file.size) {
    const endExclusive = Math.min(offset + size, file.size);
    const chunk = file.slice(offset, endExclusive, file.type || "application/octet-stream");
    let attempt = 0;
    let delivered = false;

    while (!delivered && attempt < 3) {
      attempt += 1;
      try {
        const response = await xhrPut(sessionUrl, chunk, {
          contentRange: `bytes ${offset}-${endExclusive - 1}/${file.size}`,
          onProgress: (loaded) => onProgress?.(Math.min(99, Math.round(((offset + loaded) / file.size) * 100))),
        });
        if (response.status === 308) {
          offset = parseReceivedRange(response.range) || endExclusive;
          delivered = true;
        } else if (response.ok) {
          finalData = response.data || {};
          offset = file.size;
          delivered = true;
        } else if (response.status >= 500 || response.status === 429) {
          const state = await queryUploadPosition(sessionUrl, file.size);
          if (state.complete) {
            finalData = state.data || {};
            offset = file.size;
            delivered = true;
          } else if (state.offset >= offset) {
            offset = state.offset;
            delivered = true;
          }
        } else {
          const error = new Error("Google Drive rechazó esta sesión de carga. Iniciá una carga nueva.");
          error.code = "drive-upload-restart-required";
          error.status = response.status;
          throw error;
        }
      } catch (error) {
        if (error.code === "drive-upload-restart-required" || error.code === "drive-upload-session-expired" || error.code === "drive-upload-aborted") throw error;
        if (attempt >= 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
        const state = await queryUploadPosition(sessionUrl, file.size);
        if (state.complete) {
          finalData = state.data || {};
          offset = file.size;
          delivered = true;
        } else if (state.offset > offset) {
          offset = state.offset;
          delivered = true;
        }
      }
    }
    onProgress?.(Math.min(99, Math.round((offset / file.size) * 100)));
  }
  onProgress?.(100);
  if (!finalData?.id) {
    const state = await queryUploadPosition(sessionUrl, file.size);
    finalData = state.data || finalData;
  }
  if (!finalData?.id) {
    const error = new Error("Drive completó la transferencia pero no devolvió el identificador del archivo.");
    error.code = "drive-file-missing";
    throw error;
  }
  return finalData;
}

export async function uploadCreativeTake({ campaignId, task, file, maxUploadBytes, onProgress } = {}) {
  const validation = validateUploadMetadata(file, task, { maxBytes: Number(maxUploadBytes) || DEFAULT_MAX_UPLOAD_BYTES });
  if (!validation.valid) {
    const error = new Error(validation.errors[0]);
    error.code = "creative-file-invalid";
    throw error;
  }
  const session = await authorizedRequest("createUpload", {
    campaignId,
    taskId: task.id,
    originalFileName: validation.value.originalFileName,
    mimeType: validation.value.mimeType,
    sizeBytes: validation.value.sizeBytes,
  });
  try {
    const driveFile = await uploadFileDirectToDrive({
      sessionUrl: session.sessionUrl,
      file,
      chunkBytes: session.chunkBytes,
      onProgress,
    });
    return await authorizedRequest("confirmUpload", {
      uploadId: session.uploadId,
      driveFileId: driveFile.id,
    });
  } catch (error) {
    await authorizedRequest("reportUploadError", {
      uploadId: session.uploadId,
      errorCode: error.code || "upload_interrupted",
    }).catch(() => {});
    throw error;
  }
}

export function driveFileOpenUrl(fileId) {
  const id = String(fileId || "").trim();
  return id ? `https://drive.google.com/open?id=${encodeURIComponent(id)}` : "";
}

export function googleDriveFriendlyError(error) {
  const code = error?.code || "";
  if (code === "drive-not-configured") return "Google Drive todavía no está configurado.";
  if (code === "drive-not-connected") return "Google Drive todavía no está conectado.";
  if (code === "drive-reconnect-required") return "La conexión con Google Drive necesita renovarse.";
  if (code === "drive-folder-inaccessible") return "Flor Mía ya no puede acceder a la carpeta de esta campaña.";
  if (code === "drive-quota") return "Google Drive no tiene espacio o cuota disponible para esta carga.";
  if (code === "drive-upload-network") return "La carga se interrumpió por un problema de red. Podés reintentar sin perder la tarea.";
  if (code === "drive-upload-session-expired" || code === "drive-upload-restart-required") return "La sesión de carga venció. Volvé a seleccionar el archivo para reintentar.";
  if (code === "creative-file-invalid") return error?.message || "El archivo no es compatible con esta tarea.";
  if (code === "permission-denied") return "No tenés permiso para realizar esta acción.";
  if (code === "unauthenticated") return "Tu sesión venció. Volvé a iniciar sesión.";
  return error?.message || "No pudimos completar la operación con Google Drive.";
}
