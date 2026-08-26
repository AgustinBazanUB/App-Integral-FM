export const MARKETING_KNOWLEDGE_SCHEMA_VERSION = 1;
export const PRODUCT_MARKETING_PROFILE_SCHEMA_VERSION = 1;

export const KNOWLEDGE_LIMITS = Object.freeze({
  longText: 5_000,
  noteText: 4_000,
  shortText: 500,
  listItems: 50,
  listItemLength: 500,
});

const DANGEROUS_TEXT = /<\s*script\b|javascript\s*:|data\s*:\s*text\/html|on[a-z]+\s*=/i;

function clean(value, max, { allowEmpty = true } = {}) {
  if (typeof value !== "string") return "";
  const text = value
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, max);
  if (!allowEmpty && !text) {
    const error = new Error("Este campo es obligatorio.");
    error.code = "required";
    throw error;
  }
  if (DANGEROUS_TEXT.test(text)) {
    const error = new Error("El contenido incluye texto no permitido.");
    error.code = "unsafe-content";
    throw error;
  }
  return text;
}

function list(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || "").split("\n");
  const seen = new Set();
  const result = [];
  for (const entry of source) {
    const item = clean(entry, KNOWLEDGE_LIMITS.listItemLength);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
    if (result.length >= KNOWLEDGE_LIMITS.listItems) break;
  }
  return result;
}

export function normalizeBusinessContext(input = {}) {
  return {
    schemaVersion: MARKETING_KNOWLEDGE_SCHEMA_VERSION,
    brandDescription: clean(input.brandDescription, KNOWLEDGE_LIMITS.longText),
    positioning: clean(input.positioning, KNOWLEDGE_LIMITS.longText),
    history: clean(input.history, KNOWLEDGE_LIMITS.longText),
    differentiators: list(input.differentiators),
    channels: list(input.channels),
    characteristics: list(input.characteristics),
    policies: list(input.policies),
    promotions: list(input.promotions),
    brandArguments: list(input.brandArguments),
  };
}

export function validateBusinessContext(input) {
  const value = normalizeBusinessContext(input);
  const errors = [];
  if (input?.schemaVersion != null && input.schemaVersion !== MARKETING_KNOWLEDGE_SCHEMA_VERSION) {
    errors.push(`schemaVersion debe ser ${MARKETING_KNOWLEDGE_SCHEMA_VERSION}.`);
  }
  const allowed = [
    "schemaVersion",
    "brandDescription",
    "positioning",
    "history",
    "differentiators",
    "channels",
    "characteristics",
    "policies",
    "promotions",
    "brandArguments",
    "createdBy",
    "createdByName",
    "createdAt",
    "updatedBy",
    "updatedByName",
    "updatedAt",
  ];
  const extra = Object.keys(input || {}).filter((key) => !allowed.includes(key));
  if (extra.length) errors.push(`Campos no permitidos: ${extra.join(", ")}.`);
  return { valid: errors.length === 0, errors, value };
}

export function normalizeProductMarketingProfile(input = {}) {
  const productId = clean(input.productId, 128, { allowEmpty: false });
  return {
    schemaVersion: PRODUCT_MARKETING_PROFILE_SCHEMA_VERSION,
    productId,
    benefits: list(input.benefits),
    objections: list(input.objections),
    differentiators: list(input.differentiators),
    origin: clean(input.origin, KNOWLEDGE_LIMITS.shortText),
    uses: list(input.uses),
    arguments: list(input.arguments),
    marketingNotes: clean(input.marketingNotes, KNOWLEDGE_LIMITS.noteText),
  };
}

export function validateProductMarketingProfile(input) {
  const errors = [];
  let value = null;
  try {
    value = normalizeProductMarketingProfile(input);
  } catch (error) {
    errors.push(error.message);
  }
  if (input?.schemaVersion != null && input.schemaVersion !== PRODUCT_MARKETING_PROFILE_SCHEMA_VERSION) {
    errors.push(`schemaVersion debe ser ${PRODUCT_MARKETING_PROFILE_SCHEMA_VERSION}.`);
  }
  const allowed = [
    "schemaVersion",
    "productId",
    "benefits",
    "objections",
    "differentiators",
    "origin",
    "uses",
    "arguments",
    "marketingNotes",
    "createdBy",
    "createdByName",
    "createdAt",
    "updatedBy",
    "updatedByName",
    "updatedAt",
  ];
  const extra = Object.keys(input || {}).filter((key) => !allowed.includes(key));
  if (extra.length) errors.push(`Campos no permitidos: ${extra.join(", ")}.`);
  return { valid: errors.length === 0, errors, value: errors.length ? null : value };
}

function canonicalProductContext(product) {
  if (!product) return null;
  return {
    productId: product.id,
    name: product.name || "",
    categoryId: product.categoryId || null,
    categoryName: product.categoryName || null,
    price: Number.isFinite(Number(product.price)) ? Number(product.price) : null,
    active: product.active !== false,
  };
}

export function buildMarketingKnowledge({
  businessContext = null,
  product = null,
  productProfile = null,
  locations = [],
} = {}) {
  const business = businessContext ? normalizeBusinessContext(businessContext) : null;
  const canonicalProduct = canonicalProductContext(product);
  const profile = productProfile ? normalizeProductMarketingProfile(productProfile) : null;
  if (profile && canonicalProduct && profile.productId !== canonicalProduct.productId) {
    const error = new Error("La metadata de Marketing no corresponde al producto seleccionado.");
    error.code = "product-profile-mismatch";
    throw error;
  }
  const locationNames = (locations || [])
    .filter((location) => location && location.deleted !== true)
    .map((location) => clean(location.name, 160))
    .filter(Boolean)
    .slice(0, 50);
  return {
    businessContext: business,
    productContext: canonicalProduct
      ? {
          canonical: canonicalProduct,
          marketing: profile,
        }
      : null,
    existingDataReferences: {
      productCatalog: "products",
      productMarketingProfiles: "marketingProductProfiles",
      businessContext: "marketingKnowledge/businessContext",
      locationCount: locationNames.length,
      locationNames,
      customerPIIIncluded: false,
    },
  };
}

export function toMultiline(value) {
  return Array.isArray(value) ? value.join("\n") : "";
}
