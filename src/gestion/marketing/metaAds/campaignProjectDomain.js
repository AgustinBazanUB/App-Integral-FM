export const META_ADS_CAMPAIGN_SCHEMA_VERSION = 1;
export const META_ADS_CAMPAIGN_CHANNEL = "meta_ads";

export const META_ADS_CAMPAIGN_STATUSES = Object.freeze([
  "draft",
  "planning",
  "creative",
  "validation",
  "rendering",
  "ready",
  "publishing",
  "active",
  "paused",
  "completed",
  "error",
  "archived",
]);

export const META_ADS_STATUS_LABELS = Object.freeze({
  draft: "Borrador",
  planning: "Planificación",
  creative: "Creatividades",
  validation: "Validación",
  rendering: "Producción",
  ready: "Lista para publicar",
  publishing: "Publicando",
  active: "Activa",
  paused: "Pausada",
  completed: "Completada",
  error: "Con problemas",
  archived: "Archivada",
});

export const META_ADS_STATUS_TONES = Object.freeze({
  draft: "neutral",
  planning: "neutral",
  creative: "neutral",
  validation: "warning",
  rendering: "warning",
  ready: "success",
  publishing: "warning",
  active: "success",
  paused: "neutral",
  completed: "success",
  error: "error",
  archived: "neutral",
});

export const META_ADS_CAMPAIGN_TRANSITIONS = Object.freeze({
  draft: ["planning", "archived"],
  planning: ["creative", "error", "archived"],
  creative: ["validation", "error", "archived"],
  validation: ["creative", "rendering", "error", "archived"],
  rendering: ["ready", "error", "archived"],
  ready: ["publishing", "archived"],
  publishing: ["active", "error"],
  active: ["paused", "completed"],
  paused: ["active", "completed", "archived"],
  completed: ["archived"],
  error: ["draft", "planning", "creative", "validation", "rendering", "archived"],
  archived: [],
});

const MAX_NAME_LENGTH = 120;
const MAX_PRODUCT_ID_LENGTH = 128;
const MAX_PRODUCT_NAME_LENGTH = 180;

const cleanText = (value) => String(value ?? "").trim();

export function isMetaAdsCampaignStatus(value) {
  return META_ADS_CAMPAIGN_STATUSES.includes(String(value || ""));
}

export function canTransitionMetaAdsCampaignStatus(from, to) {
  if (!isMetaAdsCampaignStatus(from) || !isMetaAdsCampaignStatus(to)) return false;
  if (from === to) return true;
  return META_ADS_CAMPAIGN_TRANSITIONS[from]?.includes(to) === true;
}

export function normalizeCampaignProjectInput(input = {}) {
  const name = cleanText(input.name);
  if (!name) throw new Error("Ingresá un nombre para la campaña.");
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(`El nombre puede tener hasta ${MAX_NAME_LENGTH} caracteres.`);
  }

  const productId = cleanText(input.productId) || null;
  const productNameSnapshot = cleanText(input.productNameSnapshot) || null;
  if (productId && productId.length > MAX_PRODUCT_ID_LENGTH) {
    throw new Error("El identificador del producto no es válido.");
  }
  if (productNameSnapshot && productNameSnapshot.length > MAX_PRODUCT_NAME_LENGTH) {
    throw new Error("El nombre del producto es demasiado largo.");
  }
  if (Boolean(productId) !== Boolean(productNameSnapshot)) {
    throw new Error("La referencia de producto está incompleta.");
  }

  return { name, productId, productNameSnapshot };
}

export function campaignProjectEditablePatch(input = {}) {
  return normalizeCampaignProjectInput(input);
}

export function metaAdsStatusLabel(status) {
  return META_ADS_STATUS_LABELS[status] || "Estado desconocido";
}

export function metaAdsStatusTone(status) {
  return META_ADS_STATUS_TONES[status] || "neutral";
}
