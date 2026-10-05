import { randomUUID } from "node:crypto";
import { OLIVIA_TOOL_SCHEMAS, validateSchema, oliviaError } from "../../../../src/shared/oliviaContracts.mjs";
import { OLIVIA_CAPABILITIES } from "../../../../src/shared/oliviaCapabilities.mjs";

const normalize = (text = "") => String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const isCorrection = (text = "") => /^(no |mejor |corregi|corrigi|cambia|cancel|eran |que sean )/.test(normalize(text));
export const operationalIntent = (intent) => ({ "stock.load": "prepare_stock_load", "stock.transfer": "prepare_stock_transfer", "stock.read": "get_stock", "fair.forecast": "forecast_fair", "metrics.analysis": "get_sales_metrics", "sales.compare": "compare_locations", "customer.create": "prepare_customer_create", "customer.read": "get_customer", "shipping.create": "prepare_shipment_create", "marketing.creative": "creative_brief", "social.creative": "creative_brief" })[intent] || intent;
const labels = { inventoryType: "si es un depósito o una ubicación", inventoryId: "el depósito o ubicación", locationId: "la ubicación de destino", productId: "el producto y su presentación", quantity: "la cantidad", reason: "el motivo", originId: "el origen", destinationId: "el destino", paymentMethod: "el medio de pago", ticketRequested: "si necesitás factura", customerDecision: "si asociamos un cliente", promotionDecision: "si aplicamos promociones", lines: "los productos y cantidades", carrierName: "quién transporta la mercadería" };
export function requiredFields(intent) {
  if (intent === "forecast_fair") return ["locationId", "startDate", "days"];
  if (intent === "creative_brief") return ["objective", "audience", "format"];
  const minimum = {
    prepare_stock_load: ["locationId", "productId", "quantity"],
    prepare_sale: ["locationId", "items", "paymentMethod", "ticketRequested", "customerDecision", "promotionDecision"],
    prepare_stock_transfer: ["originId", "destinationId", "lines", "reason"],
    prepare_create_location: ["name", "type", "codePrefix", "dniMode"],
    prepare_update_location: ["locationId", "name", "type", "codePrefix", "dniMode"],
    prepare_customer_create: ["phone"], prepare_customer_update: ["customerId", "phone"],
    prepare_product_create: ["name", "abbreviation", "defaultPrice"],
    prepare_expense_create: ["name", "amountCents", "category", "nature", "accruedOn"],
    prepare_shipment_update: ["entityId", "name"], prepare_configuration_review: ["reason"],
  };
  if (minimum[intent]) return minimum[intent];
  if (intent.startsWith("prepare_") && intent.endsWith("_review")) return ["entityId", "reason"];
  if (intent.startsWith("prepare_") && OLIVIA_CAPABILITIES[intent]?.parameters?.properties?.name && OLIVIA_CAPABILITIES[intent]?.parameters?.properties?.notes) return ["name"];
  return (OLIVIA_TOOL_SCHEMAS[intent] || OLIVIA_CAPABILITIES[intent]?.parameters)?.required || [];
}
export function taskUpdateTool(intents) {
  return { type: "function", name: "update_task", description: "Guardar datos parciales y correcciones de la tarea actual antes de pedir lo que falta. No consulta ni ejecuta operaciones. slotsJson es un objeto JSON parcial con las mismas claves y tipos que los parámetros de la herramienta intent; si no está cargada, descubrí su esquema con search_tools. No agregues campos descriptivos como period o locationName. null indica desconocido. Para creative_brief solo objective, audience, format y style (strings). Si la validación falla, corregí usando el esquema devuelto antes de continuar. Nunca inventes IDs ni datos vivos.", strict: true, parameters: { type: "object", additionalProperties: false, required: ["intent", "slotsJson"], properties: { intent: { type: "string", enum: [...intents, "creative_brief"] }, slotsJson: { type: "string", maxLength: 5000 } } } };
}
export function taskSlotSchema(intent) {
  return intent === "creative_brief" ? { properties: { objective: { type: "string", maxLength: 500 }, audience: { type: "string", maxLength: 500 }, format: { type: "string", maxLength: 180 }, style: { type: "string", maxLength: 500 } } } : OLIVIA_TOOL_SCHEMAS[intent] || OLIVIA_CAPABILITIES[intent]?.parameters;
}
export function updateTask(previous, intent, slotsJson, now = new Date()) {
  const schema = taskSlotSchema(intent);
  const patch = JSON.parse(slotsJson);
  if (!schema || !patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some((key) => !Object.hasOwn(schema.properties, key))) throw oliviaError("invalid-input", "Datos de tarea inválidos.");
  for (const [key, value] of Object.entries(patch)) if (value !== null) validateSchema(value, schema.properties[key]);
  const same = previous?.intent === intent && !["cancelled", "completed"].includes(previous.status);
  const slots = { ...(same ? previous.slots : {}), ...patch };
  const missing = requiredFields(intent).filter((key) => slots[key] == null || slots[key] === "" || (Array.isArray(slots[key]) && !slots[key].length));
  return { id: same ? previous.id : randomUUID(), intent, revision: (same ? previous.revision : 0) + 1, status: "collecting", slots, missingFields: missing, ambiguities: {}, route: same ? previous.route || null : null, createdAt: same ? previous.createdAt : now, updatedAt: now };
}
export function missingQuestion(fields = []) {
  const more = { startDate: "la fecha", endDate: "la fecha de cierre", days: "la cantidad de días", objective: "el objetivo", audience: "el público", format: "el formato", name: "el nombre", type: "el tipo", codePrefix: "el prefijo", dniMode: "si el DNI es obligatorio", phone: "el teléfono", amountCents: "el monto", category: "la categoría", nature: "el tipo de gasto", accruedOn: "la fecha del gasto", entityId: "el registro que querés revisar", customerId: "el cliente", items: "los productos y cantidades" };
  const names = [...new Set(fields.map((field) => /receivedQuantity/.test(field) ? "cuántas unidades llegaron físicamente" : /preparedQuantity/.test(field) ? "cuántas unidades preparaste" : labels[field] || more[field] || "un dato del registro; indicame qué querés completar") )];
  return names.length ? `Me falta ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`}.` : "Revisá la propuesta antes de confirmar.";
}
export function shortVoiceQuestion(task, fallback) {
  if (task?.intent !== "prepare_stock_load" || task.status !== "collecting" || Object.values(task.ambiguities || {}).some((options) => options?.length) || /no (?:pude|encontr)/i.test(fallback || "")) return fallback;
  const missing = task.missingFields || [];
  if (missing.includes("productId") && missing.includes("locationId")) return "Ok. ¿Qué producto y en dónde querés cargarlo?";
  if (missing.includes("productId")) return "¿Qué producto querés cargar?";
  if (missing.includes("locationId")) return "¿En qué ubicación querés cargarlo?";
  if (missing.includes("quantity")) return "¿Cuántas unidades querés cargar?";
  return fallback;
}
export function taskFromTool(previous, intent, args, result, now = new Date()) {
  if (!intent.startsWith("prepare_")) return previous;
  const same = previous?.intent === intent && !["cancelled", "completed"].includes(previous.status);
  const slots = structuredClone(result.prepared?.canonicalArgs || args);
  const missing = result.data?.missing || result.data?.missingFields || requiredFields(intent).filter((key) => slots[key] == null || slots[key] === "");
  return { id: same ? previous.id : randomUUID(), intent, revision: (same ? previous.revision : 0) + 1, status: result.prepared ? "prepared" : "collecting", slots, missingFields: result.prepared ? [] : missing, ambiguities: {}, route: same ? previous.route || null : null, createdAt: same ? previous.createdAt : now, updatedAt: now };
}
export function taskControl(text) {
  const value = normalize(text);
  if (/^(cancela|cancelar|cancelalo|no sigas|olvidalo|dejalo|no gracias)$/.test(value)) return "cancel";
  if (/^(si|dale|ok|perfecto|espera|espera un segundo|aguarda)$/.test(value)) return "acknowledge";
  return null;
}

/** Bounded fast path for stock loading. All entity resolution and preparation
 * uses the same permission-checked tools as the reasoning backend. Other
 * intents continue through Luna with this persisted task in its context. */
export async function progressiveStock({ previous, initialId, message, context, run, check = () => {}, now = new Date() }) {
  const text = normalize(message);
  const start = /^(?:cargame|carga|ingresa|ingresame|agrega|agregame)\s+(\d+)\s+(?:unidades? |botellas? |bidones? )?(?:de )?(.+)$/.exec(text);
  const continuation = previous?.intent === "prepare_stock_load" && ["collecting", "prepared"].includes(previous.status) && !/[?¿]/.test(message) && !/^(ahora|consulta|otra cosa|mostra|decime|quiero saber|como |que |quien |donde |cuanto|compara|analiza|pronostic|mandame|transferi|vende|registra|crea|disena)/.test(text);
  if (!start && !continuation) return null;
  check();
  let task = continuation ? structuredClone(previous) : { id: initialId || randomUUID(), intent: "prepare_stock_load", revision: 0, status: "collecting", slots: { locationId: null, productId: null, quantity: null, reason: null }, missingFields: [], ambiguities: {}, route: null, createdAt: now };
  task.revision++; task.updatedAt = now; task.status = "collecting";
  const quantityCorrection = /^(?:no )?(?:mejor |eran |son |que sean |cambia a |corregi a )?(?:de )?(\d+)(?: unidades?| botellas?)?$/.exec(text);
  let productQuery = null, locationQuery = null;
  if (start) {
    task.slots.quantity = Number(start[1]);
    const parts = start[2].split(/ en /);
    productQuery = parts[0]; locationQuery = parts[1] || null;
    task.slots.productId = null; task.ambiguities.productId = [];
  } else if (quantityCorrection) task.slots.quantity = Number(quantityCorrection[1]);
  else if (/^(?:mejor |no |destino )/.test(text) && task.slots.locationId) locationQuery = text.replace(/^(?:mejor |no |destino )/, "").replace(/^(?:en |a )/, "");
  else if (task.ambiguities.productId?.length) productQuery = text;
  else if (!task.slots.productId) { const parts = text.split(/ en /); productQuery = parts[0]; if (parts[1] && !task.slots.locationId) locationQuery = parts[1]; }
  else if (!task.slots.locationId) locationQuery = text.replace(/^(en |a )/, "");
  else if (!task.slots.reason) task.slots.reason = message.trim().slice(0, 400);
  else return null; // A new query or complex correction belongs to Luna.
  if (task.slots.quantity != null) validateSchema(task.slots.quantity, OLIVIA_TOOL_SCHEMAS.prepare_stock_load.properties.quantity, "cantidad");
  if (productQuery) {
    let products = task.ambiguities.productId || [];
    if (!products.length || start) {
      products = (await run("search_products", { query: productQuery, locationId: null })).data.products || [];
      if (!products.length) products = (await run("search_products", { query: "", locationId: null })).data.products || [];
    }
    const words = normalize(productQuery).split(" ");
    const matches = products.filter((product) => words.every((word) => normalize(product.name).includes(word)));
    if (matches.length === 1) { task.slots.productId = matches[0].productId; task.productName = matches[0].name; delete task.ambiguities.productId; }
    else { task.ambiguities.productId = matches; task.slots.productId = null; }
  }
  if (locationQuery) {
    const locations = (await run("list_locations", {})).data.locations || [];
    const query = normalize(locationQuery);
    const exact = locations.filter((location) => normalize(location.name) === query);
    const matches = exact.length ? exact : locations.filter((location) => query.split(" ").every((word) => normalize(location.name).split(" ").includes(word)));
    if (matches.length === 1) { task.slots.locationId = matches[0].id || matches[0].locationId; task.locationName = matches[0].name; delete task.ambiguities.locationId; }
    else { task.slots.locationId = null; task.ambiguities.locationId = matches.map(({ id, locationId, name }) => ({ id: id || locationId, name })); }
  }
  task.missingFields = requiredFields(task.intent).filter((key) => task.slots[key] == null || task.slots[key] === "");
  if (!task.missingFields.length) {
    const result = await run(task.intent, { ...task.slots, reason: task.slots.reason ?? null });
    task = { ...task, ...taskFromTool(task, task.intent, task.slots, result, now), revision: task.revision };
    return { task, result, content: result.prepared?.summary || missingQuestion(task.missingFields) };
  }
  const options = task.ambiguities.productId?.map((product) => product.name) || [];
  const destinations = task.ambiguities.locationId?.map((location) => location.name) || [];
  const locationQuestion = destinations.length > 1 ? `Encontré ${destinations.join(" o ")}. ¿Cuál es el destino?` : Object.hasOwn(task.ambiguities, "locationId") ? "No encontré una ubicación disponible con ese nombre. ¿En qué ubicación lo cargamos?" : "¿En qué ubicación lo cargamos?";
  const content = options.length > 1 ? `Encontré ${options.join(" o ")}. ¿Cuál querés cargar?` : task.missingFields.includes("productId") ? "No pude identificar el producto. Decime su nombre o presentación." : task.missingFields.includes("locationId") ? locationQuestion : missingQuestion(task.missingFields);
  return { task, result: { state: "DATOS_INCOMPLETOS" }, content };
}
