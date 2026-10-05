/** Shared public Olivia contracts. All business authorization is server-side. */
import { realtimeMiniCosts } from "./oliviaVoicePricing.mjs";
export const OLIVIA_POLICY_VERSION = "olivia-1.0.0";
export const OLIVIA_STATES = Object.freeze([
  "INFORMACION",
  "PREPARANDO_ACCION",
  "DATOS_INCOMPLETOS",
  "ESPERANDO_CONFIRMACION",
  "EJECUTANDO",
  "COMPLETADA",
  "RECHAZADA",
  "ERROR",
  "CANCELADA",
]);
/** @typedef {{route:string,module:string,entityType?:string,entityId?:string,locationId?:string,productId?:string}} ScreenContext */
/** @typedef {{id:string,role:'user'|'assistant',content:string,createdAt:string,inputMode?:string}} ConversationMessage */
/** @typedef {{id:string,userId:string,messages:ConversationMessage[],state:string,pendingActionId:string|null,expiresAt:Date}} Conversation */
/** @typedef {{id:string,toolName:string,canonicalArgs:object,summary:string,snapshotFingerprint:string}} PendingAction */
/** @typedef {{id:string,userId:string,conversationId:string,tokenHash:string,expiresAt:Date,status:string,result?:object}} Confirmation */
/** @typedef {{name:string,kind:'read'|'navigation'|'prepare',module:string,action:string,parameters:object}} ToolDefinition */
/** @typedef {{ok:boolean,state?:string,data?:object,code?:string,message?:string}} ToolResult */
/** @typedef {{userId:string,role:string,action:string,moduleId:string,origin:string,conversationId:string,confirmationId:string,requestId:string,status:string,createdAt:Date}} AuditEvent */
/** @typedef {{userId:string,model:string,operation:string,inputTokens:number,outputTokens:number,totalTokens:number,actualCostUsd:number|null,createdAt:Date}} UsageEvent */
/** @typedef {{userId:string,role:string,permissions:object,allowedLocationIds:string[],capabilities:string[]}} AIUserContext */
/** @typedef {{tools:string[],allowedLocationIds:string[],canViewCosts:false}} SellerAICapabilities */
/** @typedef {{tools:string[],canViewCosts:true,canConfigure:boolean}} AdminAICapabilities */
/** @typedef {{enabled:boolean,retentionMonths:number,profiles:object,defaultQuota:object,userQuotas:object,complexModules:string[],pricing:object,officialDollarSellRate:number|null}} AIConfiguration */
export function oliviaError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}
export function safeId(value, label = "identificador") {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    throw oliviaError("invalid-input", `${label} inválido.`);
  return value;
}
export function screenContext(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw oliviaError("invalid-input", "Contexto de pantalla inválido.");
  const clean = {
    route: typeof value.route === "string" ? value.route.slice(0, 250) : "",
    module: typeof value.module === "string" ? value.module.slice(0, 60) : "",
  };
  if (clean.route && !/^\/(gestion|vendedor)(\/|$)/.test(clean.route))
    clean.route = "";
  for (const key of [
    "entityType",
    "entityId",
    "locationId",
    "productId",
    "customerId",
    "warehouseId",
    "saleId",
  ])
    if (value[key] != null && value[key] !== "")
      clean[key] = safeId(value[key], key);
  if (
    typeof value.view === "string" &&
    /^[A-Za-z0-9_-]{1,60}$/.test(value.view)
  )
    clean.view = value.view;
  if (
    value.filters &&
    typeof value.filters === "object" &&
    !Array.isArray(value.filters)
  ) {
    const filters = {};
    for (const key of ["status", "search"])
      if (typeof value.filters[key] === "string")
        filters[key] = value.filters[key].slice(0, 100);
    if (value.filters.categoryId)
      filters.categoryId = safeId(value.filters.categoryId);
    if (Object.keys(filters).length) clean.filters = filters;
  }
  return clean;
}
const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const str = { type: "string", maxLength: 180 };
const id = { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" };
const quantity = { type: "integer", minimum: 1, maximum: 1000000 };
const customer = object(
  Object.fromEntries(
    ["phone", "name", "zoneId", "zoneName", "customZone"].map((key) => [
      key,
      nullable(str),
    ]),
  ),
);
const discount = object({
  discountId: nullable(id),
  type: nullable({ type: "string", enum: ["fixed", "percent"] }),
  value: nullable({ type: "integer", minimum: 1 }),
  source: nullable({ type: "string", enum: ["saved", "manual"] }),
  name: nullable(str),
});
export const OLIVIA_TOOL_SCHEMAS = {
  get_current_user_context: object({}),
  list_locations: object({}),
  search_products: object({
    query: { type: "string", maxLength: 100 },
    locationId: nullable(id),
  }),
  get_stock: object({ locationId: nullable(id), productId: id }),
  get_promotions: object({ locationId: nullable(id) }),
  get_today_sales: object({ locationId: nullable(id) }),
  navigate_to_module: object({
    module: { type: "string", maxLength: 60 },
    entityId: nullable(id),
  }),
  prepare_stock_load: object({
    locationId: nullable(id),
    productId: nullable(id),
    quantity: nullable(quantity),
    reason: nullable({ type: "string", maxLength: 400, description: "Motivo opcional de la carga. null si no se indicó." }),
  }),
  prepare_sale: object({
    locationId: nullable(id),
    items: {
      type: "array",
      maxItems: 30,
      items: object({ productId: id, qty: quantity }),
    },
    paymentMethod: nullable({
      type: "string",
      enum: ["cash", "debit", "credit", "alias", "multiple"],
    }),
    payments: nullable({
      type: "array",
      maxItems: 4,
      items: object({
        method: { type: "string", enum: ["cash", "debit", "credit", "alias"] },
        amount: { type: "integer", minimum: 0 },
      }),
    }),
    discounts: nullable({ type: "array", maxItems: 10, items: discount }),
    ticketRequested: nullable({ type: "boolean" }),
    customer: nullable(customer),
    customerDecision: nullable({ type: "string", enum: ["none", "associate"] }),
    promotionDecision: nullable({ type: "string", enum: ["none", "apply"] }),
  }),
};
export function validateSchema(value, schema, path = "parámetros") {
  if (schema.anyOf) {
    for (const choice of schema.anyOf) {
      try {
        validateSchema(value, choice, path);
        return value;
      } catch {}
    }
    throw oliviaError("invalid-input", `${path} inválido.`);
  }
  if (schema.type === "null") {
    if (value !== null) throw oliviaError("invalid-input", `${path} inválido.`);
    return value;
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw oliviaError("invalid-input", `${path} inválido.`);
    if (
      Object.keys(value).some((key) => !Object.hasOwn(schema.properties, key))
    )
      throw oliviaError(
        "invalid-input",
        `${path} contiene campos no permitidos.`,
      );
    for (const key of schema.required || [])
      if (!Object.hasOwn(value, key))
        throw oliviaError("invalid-input", `Falta ${path}.${key}.`);
    for (const [key, item] of Object.entries(value))
      validateSchema(item, schema.properties[key], `${path}.${key}`);
  } else if (schema.type === "array") {
    if (!Array.isArray(value) || value.length > (schema.maxItems ?? 100))
      throw oliviaError("invalid-input", `${path} inválido.`);
    value.forEach((item, i) =>
      validateSchema(item, schema.items, `${path}[${i}]`),
    );
  } else if (schema.type === "string") {
    if (
      typeof value !== "string" ||
      value.length > (schema.maxLength ?? 1000) ||
      (schema.pattern && !new RegExp(schema.pattern).test(value))
    )
      throw oliviaError("invalid-input", `${path} inválido.`);
  } else if (schema.type === "integer") {
    if (
      !Number.isSafeInteger(value) ||
      value < (schema.minimum ?? -Infinity) ||
      value > (schema.maximum ?? Infinity)
    )
      throw oliviaError("invalid-input", `${path} inválido.`);
  } else if (schema.type === "boolean" && typeof value !== "boolean")
    throw oliviaError("invalid-input", `${path} inválido.`);
  if (schema.enum && !schema.enum.includes(value))
    throw oliviaError("invalid-input", `${path} inválido.`);
  return value;
}
export function defaultOliviaConfiguration(env = {}) {
  return {
    enabled: env.OLIVIA_ENABLED !== "false",
    retentionMonths: 1,
    defaultQuota: { tokens: 100000, frequency: "monthly" },
    userQuotas: {},
    modelPolicyVersion: 2,
    routing: { toolThreshold: 6, entityThreshold: 5, rowThreshold: 500, documentThreshold: 2 },
    responseLimits: { maxOutputTokens: 2400, maxToolCalls: 12, maxRounds: 8, timeoutMs: 45000, providerTimeoutMs: 20000 },
    voiceProtocol: "live",
    liveUsdPerMinute: 0.05,
    profiles: {
      adminDefault: {
        model: env.OLIVIA_MODEL_ADMIN || "gpt-6-luna",
        reasoningEffort: "high",
      },
      adminComplex: {
        model: env.OLIVIA_MODEL_ADMIN || "gpt-6-luna",
        reasoningEffort: "xhigh",
      },
      seller: {
        model: env.OLIVIA_MODEL_SELLER || "gpt-6-luna",
        reasoningEffort: "high",
      },
      creative: { model: env.OLIVIA_MODEL_CREATIVE || "gpt-6.1-sol", reasoningEffort: "high" },
      creativeComplex: { model: env.OLIVIA_MODEL_CREATIVE || "gpt-6.1-sol", reasoningEffort: "xhigh" },
      live: { model: env.OLIVIA_MODEL_LIVE || "gpt-live-1", voice: "marin" },
      transcription: {
        model: env.OLIVIA_MODEL_TRANSCRIPTION || "gpt-transcribe",
      },
      liveTranscription: {
        model: env.OLIVIA_MODEL_LIVE_TRANSCRIPTION || "gpt-realtime-whisper",
      },
      realtime: {
        model: env.OLIVIA_MODEL_REALTIME || "gpt-realtime-2.1",
        voice: "marin",
      },
    },
    complexModules: [],
    pricing: {},
    officialDollarSellRate: null,
    audioLimits: { maxSeconds: 60, maxBytes: 4194304 },
    forecast: { safetyStockPercent: 20 },
  };
}
export function validateConfiguration(value) {
  const defaults = defaultOliviaConfiguration();
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !Object.hasOwn(defaults, k))
  )
    throw oliviaError("invalid-configuration", "Configuración inválida.");
  const clean = { ...defaults, ...value };
  // Read-time migration only: old expensive administrative profiles cannot
  // silently survive the new policy. No production document is rewritten.
  if (value.modelPolicyVersion !== 2) {
    clean.profiles = { ...clean.profiles, adminDefault: defaults.profiles.adminDefault, adminComplex: defaults.profiles.adminComplex, seller: defaults.profiles.seller, creative: defaults.profiles.creative };
    clean.complexModules = [];
  }
  clean.modelPolicyVersion = 2;
  validateSchema(clean.responseLimits, object({ maxOutputTokens: { type: "integer", minimum: 700, maximum: 8000 }, maxToolCalls: { type: "integer", minimum: 2, maximum: 12 }, maxRounds: { type: "integer", minimum: 2, maximum: 8 }, timeoutMs: { type: "integer", minimum: 10000, maximum: 55000 }, providerTimeoutMs: { type: "integer", minimum: 5000, maximum: 30000 } }));
  validateSchema(clean.routing, object({ toolThreshold: { type: "integer", minimum: 2, maximum: 12 }, entityThreshold: { type: "integer", minimum: 2, maximum: 100 }, rowThreshold: { type: "integer", minimum: 50, maximum: 10000 }, documentThreshold: { type: "integer", minimum: 1, maximum: 4 } }));
  if (!["live", "realtime"].includes(clean.voiceProtocol) || !Number.isFinite(clean.liveUsdPerMinute) || clean.liveUsdPerMinute <= 0 || clean.liveUsdPerMinute > 10) throw oliviaError("invalid-configuration", "Política de voz inválida.");
  validateSchema(clean.audioLimits, { type: "object", additionalProperties: false, required: ["maxSeconds", "maxBytes"], properties: { maxSeconds: { type: "integer", minimum: 5, maximum: 60 }, maxBytes: { type: "integer", minimum: 65536, maximum: 4194304 } } });
  validateSchema(clean.forecast, { type: "object", additionalProperties: false, required: ["safetyStockPercent"], properties: { safetyStockPercent: { type: "integer", minimum: 0, maximum: 100 } } });
  if (
    typeof clean.enabled !== "boolean" ||
    !Number.isInteger(clean.retentionMonths) ||
    clean.retentionMonths < 1 ||
    clean.retentionMonths > 12
  )
    throw oliviaError(
      "invalid-configuration",
      "Retención: entre 1 y 12 meses.",
    );
  const quota = (q) => {
    if (
      !q ||
      Object.keys(q).some(
        (k) =>
          ![
            "tokens",
            "frequency",
            "temporaryExtraTokens",
            "temporaryPeriod",
          ].includes(k),
      ) ||
      !Number.isSafeInteger(q.tokens) ||
      q.tokens < 1000 ||
      q.tokens > 100000000 ||
      !["daily", "weekly", "monthly"].includes(q.frequency)
    )
      throw oliviaError(
        "invalid-configuration",
        "Cupo o frecuencia inválidos.",
      );
    if (
      q.temporaryExtraTokens != null &&
      (!Number.isSafeInteger(q.temporaryExtraTokens) ||
        q.temporaryExtraTokens < 0 ||
        q.temporaryExtraTokens > 100000000 ||
        typeof q.temporaryPeriod !== "string")
    )
      throw oliviaError(
        "invalid-configuration",
        "Ampliación temporal inválida: indicá el período vigente.",
      );
    return {
      tokens: q.tokens,
      frequency: q.frequency,
      ...(q.temporaryExtraTokens != null
        ? {
            temporaryExtraTokens: q.temporaryExtraTokens,
            temporaryPeriod: q.temporaryPeriod,
          }
        : {}),
    };
  };
  clean.defaultQuota = quota(clean.defaultQuota);
  if (
    !clean.userQuotas ||
    typeof clean.userQuotas !== "object" ||
    Array.isArray(clean.userQuotas) ||
    Object.keys(clean.userQuotas).length > 500
  )
    throw oliviaError("invalid-configuration", "Cupos por usuario inválidos.");
  clean.userQuotas = Object.fromEntries(
    Object.entries(clean.userQuotas).map(([uid, q]) => [safeId(uid), quota(q)]),
  );
  clean.profiles = { ...defaults.profiles, ...clean.profiles };
  for (const [key, p] of Object.entries(clean.profiles)) {
    if (
      !Object.hasOwn(defaults.profiles, key) ||
      !p ||
      Object.keys(p).some(
        (k) => !Object.hasOwn(defaults.profiles[key] || {}, k),
      ) ||
      typeof p.model !== "string" ||
      !/^[a-zA-Z0-9._-]{1,100}$/.test(p.model)
    )
      throw oliviaError("invalid-configuration", "Perfil de modelo inválido.");
    if (
      ["adminDefault", "adminComplex", "seller", "creative", "creativeComplex"].includes(key) &&
      !["high", "xhigh"].includes(p.reasoningEffort)
    )
      throw oliviaError(
        "invalid-configuration",
        "Nivel de razonamiento inválido.",
      );
    if (
      ["realtime", "live"].includes(key) &&
      ![
        "alloy",
        "ash",
        "ballad",
        "coral",
        "echo",
        "sage",
        "shimmer",
        "verse",
        "marin",
        "cedar",
      ].includes(p.voice)
    )
      throw oliviaError("invalid-configuration", "Voz inválida.");
  }
  if (["adminDefault", "adminComplex", "seller"].some((key) => !/^gpt-6-luna(?:-|$)/.test(clean.profiles[key].model)) || clean.profiles.adminComplex.model !== clean.profiles.adminDefault.model || !/^gpt-6\.1-sol(?:-|$)/.test(clean.profiles.creative.model) || clean.profiles.creativeComplex.model !== clean.profiles.creative.model || clean.profiles.live.model !== "gpt-live-1") throw oliviaError("invalid-configuration", "Usá Luna para operación y análisis, el mismo modelo en ambos niveles, Sol solo para creatividad y GPT-Live para voz.");
  if (
    !Array.isArray(clean.complexModules) ||
    clean.complexModules.length > 20 ||
    clean.complexModules.some((m) => typeof m !== "string" || m.length > 60)
  )
    throw oliviaError("invalid-configuration", "Módulos complejos inválidos.");
  if (
    !clean.pricing ||
    typeof clean.pricing !== "object" ||
    Array.isArray(clean.pricing) ||
    Object.keys(clean.pricing).length > 30
  )
    throw oliviaError("invalid-configuration", "Precios inválidos.");
  for (const [model, rate] of Object.entries(clean.pricing))
    if (
      !/^[a-zA-Z0-9._-]{1,100}$/.test(model) ||
      !rate ||
      Object.keys(rate).some(
        (k) => !["inputUsdPerMillion", "outputUsdPerMillion"].includes(k),
      ) ||
      ["inputUsdPerMillion", "outputUsdPerMillion"].some(
        (k) => !Number.isFinite(rate[k]) || rate[k] < 0 || rate[k] > 10000,
      )
    )
      throw oliviaError("invalid-configuration", "Tarifa de modelo inválida.");
  if (
    clean.officialDollarSellRate !== null &&
    (!Number.isFinite(clean.officialDollarSellRate) ||
      clean.officialDollarSellRate <= 0)
  )
    throw oliviaError("invalid-configuration", "Cotización inválida.");
  return clean;
}
export function quotaPeriod(frequency, now = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [y, m, d] = date.split("-").map(Number);
  let start = new Date(Date.UTC(y, m - 1, d, 3));
  let end;
  if (frequency === "monthly") {
    start = new Date(Date.UTC(y, m - 1, 1, 3));
    end = new Date(Date.UTC(y, m, 1, 3));
  } else if (frequency === "weekly") {
    const day = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - day);
    end = new Date(start.getTime() + 7 * 86400000);
  } else end = new Date(start.getTime() + 86400000);
  return {
    key: `${frequency}_${start.toISOString().slice(0, 10)}`,
    start,
    renewsAt: end.toISOString(),
  };
}
export function retentionDate(months, now = new Date()) {
  const date = new Date(now),
    day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date;
}
export function costForUsage(usage, configuration) {
  if (usage.modelCalls?.length) {
    const calls = usage.modelCalls.map((call) => costForUsage(call, configuration));
    const usd = calls.every((call) => call.actualCostUsd != null) ? calls.reduce((total, call) => total + call.actualCostUsd, 0) : null;
    return { actualCostUsd: usd, actualCostArs: usd != null && configuration.officialDollarSellRate ? usd * configuration.officialDollarSellRate * 1.05 : null };
  }
  if (usage.billingUnit === "realtime-tokens") {
    const costs = realtimeMiniCosts(usage);
    const usd = costs ? costs.voiceUsd + costs.transcriptionUsd : null;
    return { actualCostUsd: usd, actualCostArs: usd != null && configuration.officialDollarSellRate ? usd * configuration.officialDollarSellRate * 1.05 : null, ...(costs ? { voiceCostUsd: costs.voiceUsd, transcriptionCostUsd: costs.transcriptionUsd, voiceCostArs: configuration.officialDollarSellRate ? costs.voiceUsd * configuration.officialDollarSellRate * 1.05 : null, transcriptionCostArs: configuration.officialDollarSellRate ? costs.transcriptionUsd * configuration.officialDollarSellRate * 1.05 : null } : {}) };
  }
  if (usage.route === "deterministic") return { actualCostUsd: 0, actualCostArs: configuration.officialDollarSellRate ? 0 : null };
  if (usage.operation === "live" || usage.billingUnit === "live-seconds") {
    const usd = usage.measurement === "provider" && Number.isFinite(usage.billedSeconds) ? usage.billedSeconds * configuration.liveUsdPerMinute / 60 : null;
    return { actualCostUsd: usd, actualCostArs: usd != null && configuration.officialDollarSellRate ? usd * configuration.officialDollarSellRate * 1.05 : null };
  }
  const rate = configuration.pricing?.[usage.model];
  if (!rate || (usage.measurement && usage.measurement !== "provider"))
    return { actualCostUsd: null, actualCostArs: null };
  const usd = (usage.webSearchCalls || 0) * 0.01 +
    ((usage.inputTokens || 0) * rate.inputUsdPerMillion +
      (usage.outputTokens || 0) * rate.outputUsdPerMillion) /
    1000000;
  return {
    actualCostUsd: usd,
    actualCostArs: configuration.officialDollarSellRate
      ? usd * configuration.officialDollarSellRate * 1.05
      : null,
  };
}
