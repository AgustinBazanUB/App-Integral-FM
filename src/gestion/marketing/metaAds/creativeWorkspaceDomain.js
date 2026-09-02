export const CREATIVE_WORKSPACE_SCHEMA_VERSION = 1;
export const RECORDING_TASK_STATUSES = Object.freeze(["pending", "ready_for_validation", "error"]);
export const CREATIVE_ASSET_STATUSES = Object.freeze(["ready_for_validation", "error"]);
export const DEFAULT_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
export const DEFAULT_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

const SAFE_KEY = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const DANGEROUS = /<\s*script\b|javascript\s*:|data\s*:\s*text\/html|on[a-z]+\s*=/i;
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "aac", "ogg"]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "heic"]);

const text = (value, max = 2000) => typeof value === "string"
  ? value.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim().slice(0, max)
  : "";
const list = (value, max = 20, len = 500) => Array.isArray(value)
  ? value.map((item) => text(item, len)).filter(Boolean).slice(0, max)
  : [];
const plain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const safeInt = (value, fallback = 0) => Number.isInteger(Number(value)) ? Number(value) : fallback;

export function sanitizeDriveName(value, { max = 80, fallback = "Archivo" } = {}) {
  const normalized = text(value, max * 2)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/:*?"<>|#%{}\[\]]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\-_ ]+|[.\-_ ]+$/g, "")
    .slice(0, max);
  return normalized || fallback;
}

function titleFromKey(key) {
  return text(key, 80)
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.length <= 3 && word === word.toUpperCase()
      ? word
      : `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ") || "Material";
}

const STANDARD_FOLDERS = Object.freeze({
  hook: "Hooks",
  hooks: "Hooks",
  body: "Bodies",
  bodies: "Bodies",
  main_body: "Bodies",
  ending: "Endings",
  endings: "Endings",
  closing: "Endings",
  b_roll: "B-Roll",
  broll: "B-Roll",
  voice_over: "VoiceOver",
  voiceover: "VoiceOver",
  testimonial: "Testimonials",
  testimonials: "Testimonials",
  product_demo: "Product-Demo",
  productdemo: "Product-Demo",
});

export function folderNameForRequirement(requirementKey, label = "") {
  const key = text(requirementKey, 80).toLowerCase();
  if (STANDARD_FOLDERS[key]) return STANDARD_FOLDERS[key];
  return sanitizeDriveName(label || titleFromKey(key), { max: 60, fallback: "Material" });
}

export function mediaPolicyForRequirement(requirement = {}) {
  const key = text(requirement.key || requirement.requirementKey, 80).toLowerCase();
  const hint = `${key} ${text(requirement.label, 120)} ${text(requirement.instructions, 500)}`.toLowerCase();
  if (/voice[_ -]?over|audio|locuci[oó]n|voz/.test(hint)) {
    return { kind: "audio", accept: "audio/*", mimePrefixes: ["audio/"], extensions: [...AUDIO_EXTENSIONS] };
  }
  if (/image|imagen|photo|foto|static|gr[aá]fic/.test(hint)) {
    return { kind: "image", accept: "image/*", mimePrefixes: ["image/"], extensions: [...IMAGE_EXTENSIONS] };
  }
  return { kind: "video", accept: "video/*", mimePrefixes: ["video/"], extensions: [...VIDEO_EXTENSIONS] };
}

function normalizedDuration(piece, requirement) {
  if (typeof piece?.durationSeconds === "number" && Number.isFinite(piece.durationSeconds) && piece.durationSeconds >= 0) {
    return piece.durationSeconds;
  }
  const ideal = requirement?.duration?.idealSeconds;
  return typeof ideal === "number" && Number.isFinite(ideal) && ideal >= 0 ? ideal : null;
}

export function generateRecordingTasks({ campaignId, planRecord, theoryConfig } = {}) {
  const campaign = text(campaignId, 128);
  const revision = safeInt(planRecord?.revision, 0);
  if (!campaign || !SAFE_KEY.test(campaign)) throw new Error("campaignId inválido para Workspace Creativo.");
  if (!planRecord || planRecord.status !== "approved" || revision < 1) throw new Error("Se necesita un CampaignPlan aprobado.");
  const pieces = planRecord?.plan?.creativePieces;
  if (!Array.isArray(pieces)) throw new Error("El CampaignPlan no contiene CreativePieces válidas.");
  const requirements = Array.isArray(theoryConfig?.creativeRequirements) ? theoryConfig.creativeRequirements : [];
  const byKey = new Map(requirements.map((requirement) => [requirement.key, requirement]));
  const counters = new Map();

  return pieces.map((piece, index) => {
    const requirementKey = text(piece.requirementKey, 80);
    if (!requirementKey || !SAFE_KEY.test(requirementKey)) throw new Error(`CreativePiece ${index + 1}: requirementKey inválido.`);
    const requirement = byKey.get(requirementKey);
    if (!requirement) throw new Error(`CreativePiece ${piece.id || index + 1}: la categoría no existe en TheoryConfig.`);
    const orderWithinCategory = (counters.get(requirementKey) || 0) + 1;
    counters.set(requirementKey, orderWithinCategory);
    const policy = mediaPolicyForRequirement(requirement);
    const creativePieceId = text(piece.id, 80);
    if (!creativePieceId || !SAFE_KEY.test(creativePieceId)) throw new Error(`CreativePiece ${index + 1}: id inválido.`);
    const category = text(requirement.label, 120) || titleFromKey(requirementKey);
    const task = {
      schemaVersion: CREATIVE_WORKSPACE_SCHEMA_VERSION,
      id: `r${revision}-${creativePieceId}`,
      campaignId: campaign,
      sourcePlanRevision: revision,
      creativePieceId,
      requirementKey,
      category,
      order: index + 1,
      orderWithinCategory,
      title: text(piece.title, 240) || `${category} ${orderWithinCategory}`,
      script: text(piece.script, 5000),
      objective: text(piece.objective, 1000),
      instructions: text(piece.instructions || requirement.instructions, 2400),
      targetDurationSeconds: normalizedDuration(piece, requirement),
      requirements: list(piece.requirements, 20, 500),
      required: requirement.required !== false && safeInt(requirement.recommendedCount, 0) > 0,
      mediaKind: policy.kind,
      allowedMimePrefixes: policy.mimePrefixes,
      acceptedExtensions: policy.extensions,
      status: "pending",
      selectedAssetId: null,
      driveFolderId: null,
    };
    const validation = validateRecordingTask(task);
    if (!validation.valid) throw new Error(validation.errors[0]);
    return validation.value;
  });
}

export function validateRecordingTask(input) {
  const errors = [];
  if (!plain(input)) return { valid: false, errors: ["RecordingTask debe ser un objeto."], value: null };
  const value = {
    schemaVersion: 1,
    id: text(input.id, 180),
    campaignId: text(input.campaignId, 128),
    sourcePlanRevision: safeInt(input.sourcePlanRevision, 0),
    creativePieceId: text(input.creativePieceId, 80),
    requirementKey: text(input.requirementKey, 80),
    category: text(input.category, 120),
    order: safeInt(input.order, 0),
    orderWithinCategory: safeInt(input.orderWithinCategory, 0),
    title: text(input.title, 240),
    script: text(input.script, 5000),
    objective: text(input.objective, 1000),
    instructions: text(input.instructions, 2400),
    targetDurationSeconds: typeof input.targetDurationSeconds === "number" && Number.isFinite(input.targetDurationSeconds) ? input.targetDurationSeconds : null,
    requirements: list(input.requirements, 20, 500),
    required: input.required === true,
    mediaKind: text(input.mediaKind, 20),
    allowedMimePrefixes: list(input.allowedMimePrefixes, 5, 40),
    acceptedExtensions: list(input.acceptedExtensions, 12, 12),
    status: text(input.status, 40),
    selectedAssetId: input.selectedAssetId == null ? null : text(input.selectedAssetId, 180),
    driveFolderId: input.driveFolderId == null ? null : text(input.driveFolderId, 220),
  };
  if (value.schemaVersion !== 1) errors.push("RecordingTask.schemaVersion inválido.");
  if (!value.id || value.id.length > 180) errors.push("RecordingTask.id inválido.");
  if (!value.campaignId || !SAFE_KEY.test(value.campaignId)) errors.push("RecordingTask.campaignId inválido.");
  if (value.sourcePlanRevision < 1) errors.push("RecordingTask.sourcePlanRevision inválido.");
  if (!value.creativePieceId || !SAFE_KEY.test(value.creativePieceId)) errors.push("RecordingTask.creativePieceId inválido.");
  if (!value.requirementKey || !SAFE_KEY.test(value.requirementKey)) errors.push("RecordingTask.requirementKey inválido.");
  if (!value.category || !value.title) errors.push("RecordingTask necesita categoría y título.");
  if (value.order < 1 || value.orderWithinCategory < 1) errors.push("RecordingTask.order inválido.");
  if (!RECORDING_TASK_STATUSES.includes(value.status)) errors.push("RecordingTask.status inválido.");
  if (!["video", "audio", "image"].includes(value.mediaKind)) errors.push("RecordingTask.mediaKind inválido.");
  if (!value.allowedMimePrefixes.length) errors.push("RecordingTask necesita tipos MIME permitidos.");
  if (value.targetDurationSeconds != null && (value.targetDurationSeconds < 0 || value.targetDurationSeconds > 3600)) errors.push("RecordingTask.targetDurationSeconds inválido.");
  if (DANGEROUS.test(JSON.stringify(value))) errors.push("RecordingTask contiene contenido no permitido.");
  return { valid: errors.length === 0, errors, value: errors.length ? null : value };
}

function extensionOf(name = "") {
  const match = /\.([a-z0-9]{1,10})$/i.exec(String(name));
  return match ? match[1].toLowerCase() : "";
}

export function validateUploadMetadata(file = {}, task = {}, { maxBytes = DEFAULT_MAX_UPLOAD_BYTES } = {}) {
  const errors = [];
  const size = Number(file.size ?? file.sizeBytes);
  const mimeType = text(file.type || file.mimeType, 120).toLowerCase();
  const originalFileName = text(file.name || file.originalFileName, 255);
  const extension = extensionOf(originalFileName);
  const prefixes = Array.isArray(task.allowedMimePrefixes) && task.allowedMimePrefixes.length ? task.allowedMimePrefixes : ["video/"];
  const extensions = new Set(Array.isArray(task.acceptedExtensions) ? task.acceptedExtensions.map((item) => String(item).toLowerCase()) : []);
  if (!originalFileName) errors.push("Elegí un archivo válido.");
  if (!Number.isFinite(size) || size <= 0) errors.push("El archivo está vacío o no tiene un tamaño válido.");
  if (Number.isFinite(size) && size > maxBytes) errors.push(`El archivo supera el límite de ${Math.round(maxBytes / (1024 * 1024))} MB.`);
  if (!mimeType || !prefixes.some((prefix) => mimeType.startsWith(prefix))) errors.push("El tipo de archivo no corresponde a este material.");
  if (extensions.size && (!extension || !extensions.has(extension))) errors.push("La extensión del archivo no es compatible con este material.");
  return { valid: errors.length === 0, errors, value: errors.length ? null : { originalFileName, mimeType, sizeBytes: size, extension } };
}

export function buildDriveFileName(task, takeNumber, file = {}) {
  const key = sanitizeDriveName(task?.requirementKey || "material", { max: 40, fallback: "material" }).toLowerCase();
  const order = String(Math.max(1, safeInt(task?.orderWithinCategory, 1))).padStart(2, "0");
  const take = String(Math.max(1, safeInt(takeNumber, 1))).padStart(2, "0");
  const ext = extensionOf(file.name || file.originalFileName) || (task?.mediaKind === "audio" ? "m4a" : task?.mediaKind === "image" ? "jpg" : "mp4");
  return `${key}-${order}-take-${take}.${ext}`.slice(0, 180);
}

export function validateCreativeAsset(input, { campaignId, task } = {}) {
  const errors = [];
  if (!plain(input)) return { valid: false, errors: ["CreativeAsset debe ser un objeto."], value: null };
  const value = {
    schemaVersion: 1,
    id: text(input.id, 180),
    campaignId: text(input.campaignId, 128),
    recordingTaskId: text(input.recordingTaskId, 180),
    creativePieceId: text(input.creativePieceId, 80),
    requirementKey: text(input.requirementKey, 80),
    sourcePlanRevision: safeInt(input.sourcePlanRevision, 0),
    driveFileId: text(input.driveFileId, 220),
    driveFolderId: text(input.driveFolderId, 220),
    driveFileName: text(input.driveFileName, 255),
    originalFileName: text(input.originalFileName, 255),
    mimeType: text(input.mimeType, 120).toLowerCase(),
    sizeBytes: Number(input.sizeBytes),
    takeNumber: safeInt(input.takeNumber, 0),
    status: text(input.status, 40),
    uploadedBy: text(input.uploadedBy, 128),
    uploadedByName: text(input.uploadedByName, 180),
  };
  if (!value.id || !value.campaignId || !value.recordingTaskId || !value.creativePieceId) errors.push("CreativeAsset no tiene identidad completa.");
  if (campaignId && value.campaignId !== campaignId) errors.push("CreativeAsset pertenece a otra campaña.");
  if (task && (value.recordingTaskId !== task.id || value.creativePieceId !== task.creativePieceId || value.requirementKey !== task.requirementKey)) errors.push("CreativeAsset no coincide con la RecordingTask.");
  if (!value.driveFileId || !value.driveFolderId || !value.driveFileName) errors.push("CreativeAsset necesita referencias Drive.");
  if (!value.mimeType || !Number.isFinite(value.sizeBytes) || value.sizeBytes <= 0) errors.push("CreativeAsset tiene metadata de archivo inválida.");
  if (value.takeNumber < 1) errors.push("CreativeAsset.takeNumber inválido.");
  if (!CREATIVE_ASSET_STATUSES.includes(value.status)) errors.push("CreativeAsset.status inválido.");
  if (Object.keys(input).some((key) => /token|secret|sessionurl|resumable/i.test(key))) errors.push("CreativeAsset no puede almacenar credenciales o sesiones.");
  return { valid: errors.length === 0, errors, value: errors.length ? null : value };
}

export function groupRecordingTasks(tasks = []) {
  const groups = new Map();
  for (const task of tasks) {
    const key = task.requirementKey || "material";
    if (!groups.has(key)) groups.set(key, { key, label: task.category || titleFromKey(key), tasks: [] });
    groups.get(key).tasks.push(task);
  }
  return [...groups.values()].map((group) => ({ ...group, tasks: group.tasks.sort((a, b) => a.order - b.order) }));
}

export function summarizeCreativeProgress(tasks = []) {
  const required = tasks.filter((task) => task.required !== false);
  const completed = required.filter((task) => task.status === "ready_for_validation" && task.selectedAssetId).length;
  return { total: required.length, completed, allRequiredReady: required.length > 0 && completed === required.length };
}
