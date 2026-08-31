import { requireFirebaseMetaAdsPermission } from "./_lib/firebaseAuth.mjs";
import {
  DRIVE_FOLDER_MIME,
  GOOGLE_DRIVE_CONNECTION_ID,
  buildGoogleAuthorizationUrl,
  clearGoogleDriveSecret,
  createDriveFolder,
  createResumableUpload,
  driveConnectionStatus,
  ensureDriveRootFolder,
  getDriveAbout,
  getDriveFile,
  googleDriveConfiguration,
  markDriveDisconnected,
  newBackendId,
  newOAuthState,
  revokeGoogleRefreshToken,
  saveDriveConnection,
} from "./_lib/googleDrive.mjs";
import { adminDelete, adminGet, adminList, adminPatch, adminSet } from "./_lib/serverFirestore.mjs";
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  DEFAULT_UPLOAD_CHUNK_BYTES,
  buildDriveFileName,
  folderNameForRequirement,
  generateRecordingTasks,
  summarizeCreativeProgress,
  validateCreativeAsset,
  validateUploadMetadata,
} from "../../src/gestion/marketing/metaAds/creativeWorkspaceDomain.js";

const CAMPAIGNS = "metaCampaignProjects";
const OAUTH_TTL_MS = 10 * 60 * 1000;
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 24 * 1024;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  },
});

const profileName = (session) => session?.profile?.name || session?.profile?.email || session?.email || "Usuario";
const safeString = (value, max = 180) => typeof value === "string" ? value.trim().slice(0, max) : "";
const taskPath = (campaignId, taskId) => `${CAMPAIGNS}/${campaignId}/recordingTasks/${taskId}`;
const assetPath = (campaignId, assetId) => `${CAMPAIGNS}/${campaignId}/creativeAssets/${assetId}`;

function maxUploadBytes() {
  const configured = Number(process.env.META_ADS_MAX_UPLOAD_BYTES);
  return Number.isFinite(configured) && configured >= 1024 * 1024 && configured <= 5 * 1024 * 1024 * 1024
    ? Math.floor(configured)
    : DEFAULT_MAX_UPLOAD_BYTES;
}

function chunkBytes() {
  const configured = Number(process.env.META_ADS_UPLOAD_CHUNK_BYTES);
  const unit = 256 * 1024;
  return Number.isFinite(configured) && configured >= unit && configured <= 64 * 1024 * 1024 && configured % unit === 0
    ? Math.floor(configured)
    : DEFAULT_UPLOAD_CHUNK_BYTES;
}

function requireId(value, label = "identificador") {
  const id = safeString(value, 180);
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    const error = new Error(`${label} inválido.`);
    error.code = "invalid-id";
    error.status = 400;
    throw error;
  }
  return id;
}

async function writeAudit(session, { campaignId = null, action, title, description = "", status = "completed" }) {
  await adminSet(`auditLogs/${newBackendId("audit")}`, {
    action,
    title,
    description,
    moduleId: "marketing",
    entityType: campaignId ? "metaCampaignProject" : "integration",
    entityId: campaignId || GOOGLE_DRIVE_CONNECTION_ID,
    userId: session.uid,
    userName: profileName(session),
    status,
    createdAt: new Date(),
  });
}

async function loadCampaign(campaignId) {
  const id = requireId(campaignId, "Campaña");
  const campaign = await adminGet(`${CAMPAIGNS}/${id}`);
  if (campaign.archived === true || campaign.status === "archived") {
    const error = new Error("La campaña está archivada.");
    error.code = "campaign-archived";
    error.status = 409;
    throw error;
  }
  return campaign;
}

async function loadCurrentApprovedPlan(campaign) {
  const revision = Number(campaign.approvedPlanRevision);
  if (!Number.isInteger(revision) || revision < 1 || campaign.planningStatus !== "approved") {
    const error = new Error("Primero aprobá un CampaignPlan antes de preparar las creatividades.");
    error.code = "creative-plan-not-approved";
    error.status = 409;
    throw error;
  }
  const plan = await adminGet(`${CAMPAIGNS}/${campaign.id}/plans/r${revision}`);
  if (plan.status !== "approved" || plan.revision !== revision) {
    const error = new Error("La revisión aprobada de la campaña no está disponible.");
    error.code = "creative-plan-not-approved";
    error.status = 409;
    throw error;
  }
  return plan;
}

async function loadTheoryConfig(campaign) {
  if (!campaign.theoryId || !campaign.theoryVersionId) {
    const error = new Error("La campaña no tiene una TheoryVersion fijada.");
    error.code = "theory-missing";
    error.status = 409;
    throw error;
  }
  const theory = await adminGet(`metaAdTheories/${campaign.theoryId}/versions/${campaign.theoryVersionId}`);
  if (theory.version !== campaign.theoryVersion || !theory.config) {
    const error = new Error("La TheoryVersion fijada ya no coincide con la campaña.");
    error.code = "theory-mismatch";
    error.status = 409;
    throw error;
  }
  return theory.config;
}

async function listCampaignTasks(campaignId) {
  return adminList(`${CAMPAIGNS}/${campaignId}/recordingTasks`, { pageSize: 250 });
}

async function listCampaignAssets(campaignId) {
  return adminList(`${CAMPAIGNS}/${campaignId}/creativeAssets`, { pageSize: 250 });
}

async function currentWorkspace(campaignId) {
  const campaign = await loadCampaign(campaignId);
  const revision = Number(campaign.approvedPlanRevision) || null;
  const [allTasks, allAssets, connection] = await Promise.all([
    listCampaignTasks(campaign.id),
    listCampaignAssets(campaign.id),
    driveConnectionStatus(),
  ]);
  const tasks = revision ? allTasks.filter((task) => task.sourcePlanRevision === revision).sort((a, b) => a.order - b.order) : [];
  const taskIds = new Set(tasks.map((task) => task.id));
  const assets = allAssets.filter((asset) => taskIds.has(asset.recordingTaskId)).sort((a, b) => a.takeNumber - b.takeNumber);
  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      approvedPlanRevision: revision,
      theoryId: campaign.theoryId || null,
      theoryVersionId: campaign.theoryVersionId || null,
      theoryVersion: campaign.theoryVersion || null,
      driveFolderId: campaign.driveFolderId || null,
      driveProvisionedAt: campaign.driveProvisionedAt || null,
    },
    tasks,
    assets,
    progress: summarizeCreativeProgress(tasks),
    history: {
      previousTaskCount: revision ? allTasks.filter((task) => task.sourcePlanRevision !== revision).length : 0,
      previousAssetCount: revision ? allAssets.filter((asset) => asset.sourcePlanRevision !== revision).length : 0,
    },
    drive: connection,
    maxUploadBytes: maxUploadBytes(),
    uploadChunkBytes: chunkBytes(),
  };
}

async function prepareWorkspace(session, campaignId) {
  const campaign = await loadCampaign(campaignId);
  if (campaign.status !== "creative") {
    const error = new Error("La campaña todavía no está en la etapa creativa.");
    error.code = "campaign-state-invalid";
    error.status = 409;
    throw error;
  }
  const [planRecord, theoryConfig, existing] = await Promise.all([
    loadCurrentApprovedPlan(campaign),
    loadTheoryConfig(campaign),
    listCampaignTasks(campaign.id),
  ]);
  const generated = generateRecordingTasks({ campaignId: campaign.id, planRecord, theoryConfig });
  const byId = new Map(existing.map((task) => [task.id, task]));
  const now = new Date();
  let created = 0;
  for (const task of generated) {
    if (byId.has(task.id)) continue;
    await adminSet(taskPath(campaign.id, task.id), {
      ...task,
      createdBy: session.uid,
      createdByName: profileName(session),
      createdAt: now,
      updatedBy: session.uid,
      updatedByName: profileName(session),
      updatedAt: now,
    });
    created += 1;
  }
  if (created > 0) {
    await writeAudit(session, {
      campaignId: campaign.id,
      action: "metaAds.creative.workspace_prepared",
      title: "Workspace Creativo preparado",
      description: `${generated.length} tareas para CampaignPlan r${planRecord.revision}`,
    });
  }
  return currentWorkspace(campaign.id);
}

async function ensureFolder(existingId, { name, parentId, campaignId, purpose, requirementKey = null }) {
  if (existingId) {
    const existing = await getDriveFile(existingId);
    if (existing.mimeType !== DRIVE_FOLDER_MIME || existing.trashed === true || !existing.parents?.includes(parentId)) {
      const error = new Error("Flor Mía ya no puede acceder a la carpeta de esta campaña.");
      error.code = "drive-folder-inaccessible";
      error.status = 409;
      throw error;
    }
    return existing;
  }
  return createDriveFolder({
    name,
    parentId,
    appProperties: {
      purpose,
      campaignId,
      ...(requirementKey ? { requirementKey } : {}),
    },
  });
}

async function provisionCampaign(session, campaignId) {
  const prepared = await prepareWorkspace(session, campaignId);
  const campaign = await loadCampaign(campaignId);
  const root = await ensureDriveRootFolder();
  let campaignFolder;
  if (campaign.driveFolderId) {
    campaignFolder = await getDriveFile(campaign.driveFolderId);
    if (campaignFolder.mimeType !== DRIVE_FOLDER_MIME || campaignFolder.trashed === true || !campaignFolder.parents?.includes(root.id)) {
      const error = new Error("Flor Mía ya no puede acceder a la carpeta de esta campaña.");
      error.code = "drive-folder-inaccessible";
      error.status = 409;
      throw error;
    }
  } else {
    campaignFolder = await createDriveFolder({
      name: `Campaign-${campaign.id}`,
      parentId: root.id,
      appProperties: { purpose: "meta_ads_campaign", campaignId: campaign.id },
    });
  }

  const previousStructure = campaign.driveStructure && typeof campaign.driveStructure === "object" ? campaign.driveStructure : {};
  const source = await ensureFolder(previousStructure.sourceFolderId, { name: "Source", parentId: campaignFolder.id, campaignId: campaign.id, purpose: "source" });
  const renders = await ensureFolder(previousStructure.rendersFolderId, { name: "Renders", parentId: campaignFolder.id, campaignId: campaign.id, purpose: "renders" });
  const finalFolder = await ensureFolder(previousStructure.finalFolderId, { name: "Final", parentId: campaignFolder.id, campaignId: campaign.id, purpose: "final" });
  const categories = { ...(previousStructure.categories || {}) };
  const categoryDefinitions = new Map(prepared.tasks.map((task) => [task.requirementKey, task.category]));
  for (const [requirementKey, category] of categoryDefinitions) {
    const folder = await ensureFolder(categories[requirementKey], {
      name: folderNameForRequirement(requirementKey, category),
      parentId: campaignFolder.id,
      campaignId: campaign.id,
      purpose: "creative_category",
      requirementKey,
    });
    categories[requirementKey] = folder.id;
  }

  const structure = {
    sourceFolderId: source.id,
    rendersFolderId: renders.id,
    finalFolderId: finalFolder.id,
    categories,
  };
  const now = new Date();
  await adminPatch(`${CAMPAIGNS}/${campaign.id}`, {
    driveFolderId: campaignFolder.id,
    driveConnectionId: GOOGLE_DRIVE_CONNECTION_ID,
    driveId: campaignFolder.driveId || root.driveId || null,
    driveProvisionedAt: campaign.driveProvisionedAt || now,
    driveStructure: structure,
  });
  for (const task of prepared.tasks) {
    const folderId = categories[task.requirementKey];
    if (task.driveFolderId !== folderId) {
      await adminPatch(taskPath(campaign.id, task.id), {
        driveFolderId: folderId,
        updatedBy: session.uid,
        updatedByName: profileName(session),
        updatedAt: now,
      });
    }
  }
  if (!campaign.driveFolderId) {
    await writeAudit(session, {
      campaignId: campaign.id,
      action: "metaAds.drive.campaign_provisioned",
      title: "Carpetas Drive creadas para la campaña",
      description: `Campaign-${campaign.id}`,
    });
  }
  return currentWorkspace(campaign.id);
}

async function createUpload(session, body) {
  const campaign = await loadCampaign(body.campaignId);
  if (campaign.status !== "creative") {
    const error = new Error("La campaña no está lista para cargar material.");
    error.code = "campaign-state-invalid";
    error.status = 409;
    throw error;
  }
  const taskId = requireId(body.taskId, "Tarea");
  let task = await adminGet(taskPath(campaign.id, taskId));
  if (task.campaignId !== campaign.id || task.sourcePlanRevision !== campaign.approvedPlanRevision) {
    const error = new Error("La tarea no pertenece a la revisión creativa actual.");
    error.code = "creative-task-mismatch";
    error.status = 409;
    throw error;
  }
  const local = validateUploadMetadata({
    name: body.originalFileName,
    type: body.mimeType,
    size: Number(body.sizeBytes),
  }, task, { maxBytes: maxUploadBytes() });
  if (!local.valid) {
    const error = new Error(local.errors[0]);
    error.code = "creative-file-invalid";
    error.status = 422;
    throw error;
  }
  if (!campaign.driveFolderId || !task.driveFolderId) {
    await provisionCampaign(session, campaign.id);
    task = await adminGet(taskPath(campaign.id, taskId));
  }
  if (!task.driveFolderId) {
    const error = new Error("No pudimos resolver la carpeta de esta tarea.");
    error.code = "drive-folder-inaccessible";
    error.status = 409;
    throw error;
  }
  const folder = await getDriveFile(task.driveFolderId);
  if (folder.mimeType !== DRIVE_FOLDER_MIME || folder.trashed === true || !folder.parents?.includes(campaign.driveFolderId)) {
    const error = new Error("Flor Mía ya no puede acceder a la carpeta de esta tarea.");
    error.code = "drive-folder-inaccessible";
    error.status = 409;
    throw error;
  }
  const assets = await listCampaignAssets(campaign.id);
  const takeNumber = assets.filter((asset) => asset.recordingTaskId === task.id).reduce((max, asset) => Math.max(max, Number(asset.takeNumber) || 0), 0) + 1;
  const uploadId = newBackendId("upload");
  const assetId = newBackendId("asset");
  const fileName = buildDriveFileName(task, takeNumber, { name: local.value.originalFileName });
  const { sessionUrl } = await createResumableUpload({
    fileName,
    mimeType: local.value.mimeType,
    sizeBytes: local.value.sizeBytes,
    parentId: task.driveFolderId,
    appProperties: {
      campaignId: campaign.id,
      recordingTaskId: task.id,
      creativePieceId: task.creativePieceId,
      requirementKey: task.requirementKey,
      sourcePlanRevision: String(task.sourcePlanRevision),
      uploadId,
      assetId,
      takeNumber: String(takeNumber),
    },
  });
  const now = new Date();
  const expiresAt = new Date(now.getTime() + UPLOAD_TTL_MS);
  await adminSet(`creativeUploadSessions/${uploadId}`, {
    schemaVersion: 1,
    uploadId,
    assetId,
    userId: session.uid,
    campaignId: campaign.id,
    recordingTaskId: task.id,
    creativePieceId: task.creativePieceId,
    requirementKey: task.requirementKey,
    sourcePlanRevision: task.sourcePlanRevision,
    driveFolderId: task.driveFolderId,
    driveFileName: fileName,
    originalFileName: local.value.originalFileName,
    mimeType: local.value.mimeType,
    sizeBytes: local.value.sizeBytes,
    takeNumber,
    status: "issued",
    createdAt: now,
    expiresAt,
  });
  return {
    uploadId,
    assetId,
    sessionUrl,
    fileName,
    takeNumber,
    chunkBytes: chunkBytes(),
    expiresAt,
  };
}

async function confirmUpload(session, body) {
  const uploadId = requireId(body.uploadId, "Upload");
  const driveFileId = safeString(body.driveFileId, 220);
  if (!driveFileId) {
    const error = new Error("Google Drive no devolvió el identificador del archivo.");
    error.code = "drive-file-missing";
    error.status = 422;
    throw error;
  }
  const upload = await adminGet(`creativeUploadSessions/${uploadId}`);
  if (upload.userId !== session.uid) {
    const error = new Error("Esta sesión de carga pertenece a otro usuario.");
    error.code = "permission-denied";
    error.status = 403;
    throw error;
  }
  const expiresAt = upload.expiresAt instanceof Date ? upload.expiresAt.getTime() : new Date(upload.expiresAt || 0).getTime();
  if (!expiresAt || expiresAt < Date.now()) {
    await adminDelete(`creativeUploadSessions/${uploadId}`);
    const error = new Error("La sesión de carga venció. Iniciá la carga nuevamente.");
    error.code = "drive-upload-session-expired";
    error.status = 410;
    throw error;
  }
  const campaign = await loadCampaign(upload.campaignId);
  const task = await adminGet(taskPath(campaign.id, upload.recordingTaskId));
  if (task.sourcePlanRevision !== campaign.approvedPlanRevision || task.creativePieceId !== upload.creativePieceId) {
    const error = new Error("La tarea cambió desde que comenzó la carga.");
    error.code = "creative-task-mismatch";
    error.status = 409;
    throw error;
  }
  const file = await getDriveFile(driveFileId);
  const sizeBytes = Number(file.size);
  const app = file.appProperties || {};
  const validIdentity = app.uploadId === uploadId && app.assetId === upload.assetId
    && app.campaignId === campaign.id && app.recordingTaskId === task.id;
  if (!validIdentity || file.trashed === true || file.name !== upload.driveFileName || file.mimeType !== upload.mimeType
    || sizeBytes !== Number(upload.sizeBytes) || !file.parents?.includes(upload.driveFolderId)) {
    const error = new Error("La metadata confirmada por Drive no coincide con la carga autorizada.");
    error.code = "drive-upload-verification-failed";
    error.status = 422;
    throw error;
  }
  const coreAsset = {
    schemaVersion: 1,
    id: upload.assetId,
    campaignId: campaign.id,
    recordingTaskId: task.id,
    creativePieceId: task.creativePieceId,
    requirementKey: task.requirementKey,
    sourcePlanRevision: task.sourcePlanRevision,
    driveFileId: file.id,
    driveFolderId: upload.driveFolderId,
    driveFileName: file.name,
    originalFileName: upload.originalFileName,
    mimeType: file.mimeType,
    sizeBytes,
    takeNumber: upload.takeNumber,
    status: "ready_for_validation",
    uploadedBy: session.uid,
    uploadedByName: profileName(session),
  };
  const validation = validateCreativeAsset(coreAsset, { campaignId: campaign.id, task });
  if (!validation.valid) {
    const error = new Error(validation.errors[0]);
    error.code = "creative-asset-invalid";
    error.status = 422;
    throw error;
  }
  const now = new Date();
  await adminSet(assetPath(campaign.id, upload.assetId), {
    ...validation.value,
    driveId: file.driveId || campaign.driveId || null,
    driveCreatedAt: file.createdTime ? new Date(file.createdTime) : null,
    uploadedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const selectedAssetId = task.selectedAssetId || upload.assetId;
  await adminPatch(taskPath(campaign.id, task.id), {
    status: "ready_for_validation",
    selectedAssetId,
    updatedBy: session.uid,
    updatedByName: profileName(session),
    updatedAt: now,
  });
  await adminDelete(`creativeUploadSessions/${uploadId}`);
  await writeAudit(session, {
    campaignId: campaign.id,
    action: "metaAds.creative.upload_completed",
    title: "Material creativo cargado",
    description: `${task.title} · toma ${upload.takeNumber}`,
  });
  return { assetId: upload.assetId, selectedAssetId, driveFileId: file.id, status: "ready_for_validation" };
}

async function reportUploadError(session, body) {
  const uploadId = requireId(body.uploadId, "Upload");
  const upload = await adminGet(`creativeUploadSessions/${uploadId}`, { optional: true });
  if (!upload) return { reported: false };
  if (upload.userId !== session.uid) {
    const error = new Error("Esta sesión de carga pertenece a otro usuario.");
    error.code = "permission-denied";
    error.status = 403;
    throw error;
  }
  const task = await adminGet(taskPath(upload.campaignId, upload.recordingTaskId), { optional: true });
  if (task) {
    await adminPatch(taskPath(upload.campaignId, upload.recordingTaskId), {
      status: "error",
      updatedBy: session.uid,
      updatedByName: profileName(session),
      updatedAt: new Date(),
    });
  }
  await writeAudit(session, {
    campaignId: upload.campaignId,
    action: "metaAds.creative.upload_failed",
    title: "Carga de material interrumpida",
    description: safeString(body.errorCode, 100) || "upload_interrupted",
    status: "error",
  });
  await adminDelete(`creativeUploadSessions/${uploadId}`);
  return { reported: true };
}

async function selectAsset(session, body) {
  const campaign = await loadCampaign(body.campaignId);
  const taskId = requireId(body.taskId, "Tarea");
  const assetId = requireId(body.assetId, "Toma");
  const [task, asset] = await Promise.all([
    adminGet(taskPath(campaign.id, taskId)),
    adminGet(assetPath(campaign.id, assetId)),
  ]);
  if (task.campaignId !== campaign.id || asset.campaignId !== campaign.id || asset.recordingTaskId !== task.id
    || asset.creativePieceId !== task.creativePieceId || asset.sourcePlanRevision !== task.sourcePlanRevision
    || task.sourcePlanRevision !== campaign.approvedPlanRevision) {
    const error = new Error("La toma no pertenece a esta tarea creativa.");
    error.code = "creative-asset-mismatch";
    error.status = 409;
    throw error;
  }
  await adminPatch(taskPath(campaign.id, task.id), {
    selectedAssetId: asset.id,
    status: "ready_for_validation",
    updatedBy: session.uid,
    updatedByName: profileName(session),
    updatedAt: new Date(),
  });
  await writeAudit(session, {
    campaignId: campaign.id,
    action: "metaAds.creative.asset_selected",
    title: "Toma creativa seleccionada",
    description: `${task.title} · toma ${asset.takeNumber}`,
  });
  return { taskId: task.id, selectedAssetId: asset.id };
}

async function oauthStart(session, request) {
  const state = newOAuthState();
  const origin = new URL(request.url).origin;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OAUTH_TTL_MS);
  await adminSet(`integrationOauthStates/${state}`, {
    schemaVersion: 1,
    provider: "google_drive",
    uid: session.uid,
    userName: profileName(session),
    returnUrl: `${origin}/gestion/settings`,
    createdAt: now,
    expiresAt,
  });
  return {
    authorizationUrl: buildGoogleAuthorizationUrl({ state, loginHint: session.email || "" }),
    expiresAt,
  };
}

async function testConnection(session) {
  const access = await getDriveAbout();
  const root = await ensureDriveRootFolder();
  const previous = await adminGet("integrationConnections/googleDrive", { optional: true });
  const connection = await saveDriveConnection({ account: access.user || {}, rootFolder: root, connectedBy: previous?.connectedBy || session.uid, previous });
  return { ok: true, connection };
}

async function disconnectDrive(session) {
  let warning = null;
  try { await revokeGoogleRefreshToken(); } catch (error) { warning = error?.code || "drive-revoke-failed"; }
  await clearGoogleDriveSecret();
  const connection = await markDriveDisconnected({ disconnectedBy: session.uid });
  await writeAudit(session, {
    action: "metaAds.drive.disconnected",
    title: "Google Drive desconectado",
    description: warning ? "La credencial local fue eliminada; Google no confirmó la revocación remota." : "Los archivos existentes se conservaron.",
  });
  return { connection, warning };
}

function friendlyError(error) {
  const code = error?.code || "drive-error";
  const messages = {
    "drive-not-configured": "Google Drive todavía no está configurado.",
    "drive-not-connected": "Google Drive todavía no está conectado.",
    "drive-reconnect-required": "La conexión con Google Drive necesita renovarse.",
    "drive-folder-inaccessible": "Flor Mía ya no puede acceder a la carpeta de esta campaña.",
    "drive-quota": "Google Drive no tiene cuota disponible para completar esta carga.",
    "drive-rate-limit": "Google Drive recibió demasiadas solicitudes. Esperá un momento y reintentá.",
    "drive-upload-session-expired": "La sesión de carga venció. Volvé a seleccionar el archivo.",
    "creative-file-invalid": error?.message || "El archivo seleccionado no es válido para esta tarea.",
    "permission-denied": "No tenés permiso para realizar esta acción.",
    "unauthenticated": "Tu sesión venció. Volvé a iniciar sesión.",
  };
  return messages[code] || error?.message || "No pudimos completar la operación con Google Drive.";
}

export default async function handler(request) {
  if (request.method === "GET") {
    const url = new URL(request.url);
    if (url.searchParams.get("health") === "1") {
      const config = googleDriveConfiguration();
      return json({
        configured: config.configured,
        firebaseBackendConfigured: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
        scope: config.scope,
        mode: config.mode,
        redirectConfigured: Boolean(config.redirectUri),
        maxUploadBytes: maxUploadBytes(),
        chunkBytes: chunkBytes(),
        version: "1",
      });
    }
    return json({ code: "not-found", message: "Recurso no disponible." }, 404);
  }
  if (request.method !== "POST") return json({ code: "method-not-allowed", message: "Método no permitido." }, 405);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) return json({ code: "request-too-large", message: "La solicitud supera el límite permitido." }, 413);
  let body;
  try { body = await request.json(); } catch { return json({ code: "invalid-json", message: "La solicitud no tiene un formato válido." }, 400); }
  const operation = safeString(body?.operation, 60);
  const permission = {
    status: "metaAdsViewCreativeWorkspace",
    workspace: "metaAdsViewCreativeWorkspace",
    prepareWorkspace: "metaAdsUploadCreative",
    provisionCampaign: "metaAdsUploadCreative",
    createUpload: "metaAdsUploadCreative",
    confirmUpload: "metaAdsUploadCreative",
    reportUploadError: "metaAdsUploadCreative",
    selectAsset: "metaAdsUploadCreative",
    oauthStart: "metaAdsManageDrive",
    testConnection: "metaAdsManageDrive",
    disconnect: "metaAdsManageDrive",
  }[operation];
  if (!permission) return json({ code: "operation-invalid", message: "Operación no disponible." }, 400);

  let session;
  try {
    session = await requireFirebaseMetaAdsPermission(request, permission);
  } catch (error) {
    return json({ code: error.code || "unauthenticated", message: error.status === 403 ? "No tenés permiso para esta operación." : "Tu sesión no es válida." }, error.status || 401);
  }

  try {
    let result;
    if (operation === "status") result = await driveConnectionStatus();
    else if (operation === "workspace") result = await currentWorkspace(requireId(body.campaignId, "Campaña"));
    else if (operation === "prepareWorkspace") result = await prepareWorkspace(session, requireId(body.campaignId, "Campaña"));
    else if (operation === "provisionCampaign") result = await provisionCampaign(session, requireId(body.campaignId, "Campaña"));
    else if (operation === "createUpload") result = await createUpload(session, body);
    else if (operation === "confirmUpload") result = await confirmUpload(session, body);
    else if (operation === "reportUploadError") result = await reportUploadError(session, body);
    else if (operation === "selectAsset") result = await selectAsset(session, body);
    else if (operation === "oauthStart") result = await oauthStart(session, request);
    else if (operation === "testConnection") result = await testConnection(session);
    else if (operation === "disconnect") result = await disconnectDrive(session);
    return json(result);
  } catch (error) {
    if (error?.code === "drive-reconnect-required") {
      await markDriveDisconnected({ disconnectedBy: null, errorCode: "drive-reconnect-required" }).catch(() => {});
    }
    console.error("Google Drive control plane failed", {
      code: error?.code || "drive-error",
      status: error?.status || 500,
      uid: session.uid,
      operation,
    });
    return json({ code: error?.code || "drive-error", message: friendlyError(error) }, error?.status || 500);
  }
}
