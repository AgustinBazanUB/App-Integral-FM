/** Shared public Olivia contracts. All business authorization is server-side. */
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
    reason: nullable({ type: "string", maxLength: 400 }),
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
    profiles: {
      adminDefault: {
        model: env.OLIVIA_MODEL_ADMIN || "gpt-6-luna",
        reasoningEffort: "xhigh",
      },
      adminComplex: {
        model: env.OLIVIA_MODEL_COMPLEX || "gpt-6-sol",
        reasoningEffort: "high",
      },
      seller: {
        model: env.OLIVIA_MODEL_SELLER || "gpt-6-luna",
        reasoningEffort: "medium",
      },
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
    complexModules: ["marketing"],
    pricing: {},
    officialDollarSellRate: null,
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
      ["adminDefault", "adminComplex", "seller"].includes(key) &&
      !["low", "medium", "high", "xhigh", "max"].includes(p.reasoningEffort)
    )
      throw oliviaError(
        "invalid-configuration",
        "Nivel de razonamiento inválido.",
      );
    if (
      key === "realtime" &&
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
  const rate = configuration.pricing?.[usage.model];
  if (!rate || (usage.measurement && usage.measurement !== "provider"))
    return { actualCostUsd: null, actualCostArs: null };
  const usd =
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
