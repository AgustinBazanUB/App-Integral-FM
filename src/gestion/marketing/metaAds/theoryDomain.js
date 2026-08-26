import {
  THEORY_CONFIG_SCHEMA_VERSION,
  THEORY_LIMITS,
  assertValidTheoryConfig,
  makeEmptyTheoryConfig,
} from "./theorySchema.js";

export const THEORY_COLLECTION = "metaAdTheories";
export const THEORY_VERSION_SCHEMA_VERSION = 1;
export const THEORY_PARENT_SCHEMA_VERSION = 1;
export const THEORY_PAGE_SIZE = 20;
export const THEORY_VERSION_PAGE_SIZE = 10;

export const THEORY_SOURCE_TYPES = Object.freeze(["text", "markdown", "pdf", "editor"]);
export const THEORY_VERSION_STATUSES = Object.freeze([
  "draft",
  "compiling",
  "review",
  "approved",
  "active",
  "archived",
  "error",
]);

const editableStatuses = new Set(["draft", "review", "error"]);
const compileableStatuses = new Set(["draft", "review", "error"]);
const activeLikeStatuses = new Set(["active", "archived", "approved"]);

function cleanText(value, max, { allowEmpty = true } = {}) {
  const text = typeof value === "string"
    ? value.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim()
    : "";
  const clipped = text.slice(0, max);
  if (!allowEmpty && !clipped) {
    const error = new Error("Este campo es obligatorio.");
    error.code = "required";
    throw error;
  }
  return clipped;
}

export function profileName(profile = {}) {
  return cleanText(profile.name || profile.email || "Usuario", 160) || "Usuario";
}

export function normalizeTheoryName(value) {
  return cleanText(value, THEORY_LIMITS.name, { allowEmpty: false });
}

export function normalizeTheoryDescription(value) {
  return cleanText(value, THEORY_LIMITS.description);
}

export function normalizeTheorySource({
  sourceType = "text",
  sourceName = "",
  sourceText = "",
  sourceSize = null,
  sourceHash = "",
} = {}) {
  if (!THEORY_SOURCE_TYPES.includes(sourceType)) {
    const error = new Error("Tipo de fuente no soportado.");
    error.code = "source-type-invalid";
    throw error;
  }
  const text = cleanText(sourceText, THEORY_LIMITS.sourceCharacters);
  if (!text) {
    const error = new Error("La metodología no contiene texto para procesar.");
    error.code = "source-empty";
    throw error;
  }
  if (sourceText.length > THEORY_LIMITS.sourceCharacters) {
    const error = new Error(`El texto supera el límite de ${THEORY_LIMITS.sourceCharacters.toLocaleString("es-AR")} caracteres.`);
    error.code = "source-too-large";
    throw error;
  }
  const numericSize = Number(sourceSize);
  if (Number.isFinite(numericSize) && numericSize > THEORY_LIMITS.sourceBytes) {
    const error = new Error("El archivo supera el tamaño máximo permitido.");
    error.code = "source-too-large";
    throw error;
  }
  const name = cleanText(sourceName || (sourceType === "pdf" ? "Documento PDF" : "Entrada manual"), 180) || "Entrada manual";
  const hash = cleanText(sourceHash, 128);
  return {
    text,
    metadata: {
      sourceType,
      sourceName: name,
      sourceHash: hash || null,
      sourceSize: Number.isFinite(numericSize) && numericSize >= 0 ? Math.round(numericSize) : null,
      sourceCharacterCount: text.length,
    },
  };
}

export async function hashTheorySource(text) {
  const source = String(text || "");
  if (!source) return "";
  if (!globalThis.crypto?.subtle) {
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function theoryVersionId(version) {
  const number = Number(version);
  if (!Number.isInteger(number) || number < 1) {
    const error = new Error("Número de versión inválido.");
    error.code = "version-invalid";
    throw error;
  }
  return `v${number}`;
}

export function canEditTheoryVersion(version) {
  return Boolean(version && editableStatuses.has(version.status));
}

export function canCompileTheoryVersion(version) {
  return Boolean(version && compileableStatuses.has(version.status));
}

export function canCreateNextTheoryVersion(version) {
  return Boolean(version && activeLikeStatuses.has(version.status));
}

export function canApproveTheoryVersion(version) {
  if (!version || version.status !== "review" || !version.config) return false;
  try {
    assertValidTheoryConfig(version.config);
    return true;
  } catch {
    return false;
  }
}

export function canActivateTheoryVersion(version) {
  return Boolean(version && (version.status === "approved" || version.status === "archived"));
}

export function normalizeCompilerMetadata(input = {}) {
  const inputTokens = Number.isInteger(input.inputTokens) && input.inputTokens >= 0 ? input.inputTokens : 0;
  const outputTokens = Number.isInteger(input.outputTokens) && input.outputTokens >= 0 ? input.outputTokens : 0;
  const totalTokens = Number.isInteger(input.totalTokens) && input.totalTokens >= 0
    ? input.totalTokens
    : inputTokens + outputTokens;
  const actualCostUsd = typeof input.actualCostUsd === "number"
    && Number.isFinite(input.actualCostUsd)
    && input.actualCostUsd >= 0
    ? input.actualCostUsd
    : null;
  return {
    provider: "openai",
    operation: "theory_compile",
    model: cleanText(input.model, 120) || "unknown",
    responseId: cleanText(input.responseId, 180) || null,
    inputTokens,
    outputTokens,
    totalTokens,
    actualCostUsd,
    compilerVersion: cleanText(input.compilerVersion, 40) || "1",
  };
}

export function createTheoryParentPayload(profile, { name, description = "" } = {}) {
  return {
    schemaVersion: THEORY_PARENT_SCHEMA_VERSION,
    name: normalizeTheoryName(name),
    description: normalizeTheoryDescription(description),
    status: "draft",
    latestVersion: 1,
    latestVersionId: theoryVersionId(1),
    activeVersion: null,
    activeVersionId: null,
    createdBy: profile.id,
    createdByName: profileName(profile),
    createdAt: null,
    updatedBy: profile.id,
    updatedByName: profileName(profile),
    updatedAt: null,
  };
}

export function createTheoryVersionPayload(profile, theoryId, {
  version = 1, sourceType = "text", sourceName = "", sourceText = "", sourceSize = null,
  sourceHash = "", config = null, derivedFromVersionId = null,
} = {}) {
  const normalized = normalizeTheorySource({ sourceType, sourceName, sourceText, sourceSize, sourceHash });
  const safeConfig = config ? assertValidTheoryConfig(config) : null;
  return {
    schemaVersion: THEORY_VERSION_SCHEMA_VERSION,
    theoryId,
    version,
    status: "draft",
    config: safeConfig,
    sourceText: normalized.text,
    sourceMetadata: normalized.metadata,
    compilerMetadata: null,
    compileError: null,
    derivedFromVersionId: derivedFromVersionId || null,
    createdBy: profile.id,
    createdByName: profileName(profile),
    createdAt: null,
    updatedBy: profile.id,
    updatedByName: profileName(profile),
    updatedAt: null,
    approvedBy: null,
    approvedByName: null,
    approvedAt: null,
    activatedBy: null,
    activatedByName: null,
    activatedAt: null,
  };
}

export function editableVersionPatch(version, {
  sourceType = version?.sourceMetadata?.sourceType || "editor",
  sourceName = version?.sourceMetadata?.sourceName || "Editor interno",
  sourceText = version?.sourceText || "",
  sourceSize = version?.sourceMetadata?.sourceSize ?? null,
  sourceHash = version?.sourceMetadata?.sourceHash || "",
  config = version?.config ?? null,
} = {}) {
  if (!canEditTheoryVersion(version)) {
    const error = new Error("La versión seleccionada es histórica o está bloqueada. Creá una nueva versión para modificarla.");
    error.code = "version-immutable";
    throw error;
  }
  const normalized = normalizeTheorySource({ sourceType, sourceName, sourceText, sourceSize, sourceHash });
  return {
    sourceText: normalized.text,
    sourceMetadata: normalized.metadata,
    config: config ? assertValidTheoryConfig(config) : null,
    status: version.status === "error" ? "draft" : version.status,
    compileError: null,
  };
}

export function buildCompiledReviewPatch(version, compilerResult) {
  if (!version || version.status !== "compiling") {
    const error = new Error("La versión ya no está esperando un resultado de compilación.");
    error.code = "compile-state-invalid";
    throw error;
  }
  return {
    status: "review",
    config: assertValidTheoryConfig(compilerResult?.config),
    compilerMetadata: normalizeCompilerMetadata(compilerResult?.usage || compilerResult?.compilerMetadata || {}),
    compileError: null,
  };
}

export function validateVersionTransition(fromStatus, toStatus) {
  const allowed = {
    draft: ["draft", "compiling"], compiling: ["review", "error"],
    review: ["review", "compiling", "approved"], approved: ["active"],
    active: ["archived"], archived: ["active"], error: ["draft", "compiling"],
  };
  return Boolean(allowed[fromStatus]?.includes(toStatus));
}

export function nextTheoryVersionNumber(parent) {
  const latest = Number(parent?.latestVersion);
  if (!Number.isInteger(latest) || latest < 1) return 1;
  return latest + 1;
}

export function makeTheoryDraftConfig(theoryName) {
  return makeEmptyTheoryConfig(normalizeTheoryName(theoryName));
}

export function theoryStatusLabel(status) {
  return { draft: "Borrador", compiling: "Procesando", review: "En revisión", approved: "Aprobada", active: "Activa", archived: "Histórica", error: "Error" }[status] || "Desconocido";
}

export function theoryStatusTone(status) {
  if (status === "active") return "success";
  if (status === "error") return "danger";
  if (status === "approved" || status === "review") return "warning";
  return "neutral";
}

export function estimateTheoryCompile(sourceText, {
  model = "gpt-5.6-luna", inputUsdPerMToken = null, outputUsdPerMToken = null,
} = {}) {
  const characters = String(sourceText || "").length;
  const inputTokens = Math.max(1, Math.ceil(characters / 4) + 900);
  const outputTokens = Math.min(6_000, Math.max(1_200, Math.ceil(inputTokens * 0.35)));
  const pricingKnown = [inputUsdPerMToken, outputUsdPerMToken]
    .every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
  return {
    model, inputTokens, outputTokens,
    estimatedCostUsd: pricingKnown
      ? ((inputTokens * inputUsdPerMToken) + (outputTokens * outputUsdPerMToken)) / 1_000_000
      : null,
  };
}

export { THEORY_CONFIG_SCHEMA_VERSION };
