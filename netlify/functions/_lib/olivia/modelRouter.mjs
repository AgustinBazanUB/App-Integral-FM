import { can, normalizedRole } from "../../../../src/gestion/permissions.js";

export const MODEL_POLICY_VERSION = 2;
export function classifyIntent(message = "", module = "") {
  const text = normalize(message);
  if (/pronostic|forecast|prevision/.test(text)) return "fair.forecast";
  if (/transfer|mandame|manda |enviame.*(aceite|botella|unidades)/.test(text)) return "stock.transfer";
  if (/cargame|ingresa|agrega/.test(text) && /stock|botella|unidades|mercaderia/.test(text)) return "stock.load";
  if (creative.test(text)) return `${["marketing", "social"].includes(module) ? module : "creative"}.creative`;
  if (/compara|comparacion/.test(text)) return "sales.compare";
  if (/stock|inventario/.test(text)) return "stock.read";
  if (/venta|nos fue|factur|ticket|rendimiento|metric/.test(text)) return "metrics.analysis";
  if (/client|telefono/.test(text)) return /crea|registra|agrega/.test(text) ? "customer.create" : "customer.read";
  if (/envio|despacho/.test(text)) return "shipping.create";
  return `${module || "core"}.query`;
}
const normalize = (text = "") => String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const creative = /disena.{0,50}(concepto|post|publicacion|reel|carrusel|campana|pieza|identidad|banner|visual|grafica|instagram|contenido|anuncio)|concepto creativo|campana.{0,30}creativ|creativ.{0,30}campana|crea.{0,35}(post|carrusel|reel|guion|pieza|identidad)|copywriting|redacta.{0,25}(post|publicacion|anuncio)|branding|storytelling/;
const complex = /pronostic|forecast|prevision|proyect|optimiza|compara|comparacion|tendencia|escenarios|restricciones|rentabilidad|historico|trimestre|semestre|anual|ultimos? \d+ meses|causa|cruza|cruzar|correlacion/;

/** Deterministic server policy. Neither model output nor browser flags select a model. */
export function routeModel(configuration, session, { message = "", context = {}, task = null, skills = [], attachments = [], signals = {} } = {}) {
  if (configuration.voiceBackend) return { ...configuration.voiceBackend, intent: classifyIntent(message, context.module), route: "luna-voice", routingReason: "live-delegation", policyVersion: MODEL_POLICY_VERSION };
  const text = normalize(message);
  const module = context.module || "";
  const seller = normalizedRole(session.profile) === "seller";
  const creativeModule = ["marketing", "social"].includes(module) && can(session.profile, module, "view");
  const creativeIntent = !seller && creativeModule && creative.test(text);
  const reasons = [];
  if (complex.test(text)) reasons.push("analysis-or-forecast");
  const dates = [...text.matchAll(/\d{4}-\d{2}-\d{2}/g)].map((match) => Date.parse(match[0])).filter(Number.isFinite);
  if (dates.length > 1 && Math.max(...dates) - Math.min(...dates) > 31 * 86400000) reasons.push("historical-horizon");
  if ((text.match(/\b(sin|maximo|minimo|limite|restriccion)\b/g) || []).length >= 2) reasons.push("multiple-constraints");
  if (skills.some((skill) => /forecast|fair|pronostic|analytics/.test(normalize(skill.name)))) reasons.push("complex-skill");
  if (attachments.length >= configuration.routing.documentThreshold) reasons.push("multiple-documents");
  if ((signals.toolCount || 0) >= configuration.routing.toolThreshold) reasons.push("tool-volume");
  if ((signals.entityCount || 0) >= configuration.routing.entityThreshold) reasons.push("entity-volume");
  if ((signals.dataRows || 0) >= configuration.routing.rowThreshold) reasons.push("data-volume");
  if ((signals.moduleCount || 0) >= 2) reasons.push("cross-module");
  // Carry the route only while collecting the same task. Completed tasks never
  // cause a following short/simple query to inherit an expensive route.
  const continuation = task?.status === "collecting" && task?.route && text.split(/\s+/).length <= 10 && !/[?¿]/.test(message) && !/^(consulta|ahora|otra cosa|mostra|decime|quiero saber|como |que |quien |donde |cuanto|compara|analiza|pronostic|carga|manda|transfer|vende|registra|crea|disena)/.test(text) && !/stock|ventas?|estadistic|metric|inbox|gasto|deposit|transfer|factura|permis|usuarios?/.test(text);
  if (continuation && task.route.route === "luna-complex") reasons.push("active-complex-task");
  if (continuation && task.route.route === "sol-creative" && creativeModule && !seller) {
    reasons.push("active-creative-task");
  }
  const useCreative = creativeIntent || reasons.includes("active-creative-task");
  const route = useCreative ? "sol-creative" : reasons.length ? "luna-complex" : "luna-normal";
  const creativeComplex = reasons.some((reason) => reason !== "active-creative-task") || (continuation && task.route.reasoningEffort === "xhigh");
  const profile = configuration.profiles[useCreative ? creativeComplex ? "creativeComplex" : "creative" : route === "luna-complex" ? "adminComplex" : seller ? "seller" : "adminDefault"];
  return { ...profile, ...(seller && !useCreative ? { model: configuration.profiles.seller.model } : {}), intent: continuation ? task.intent : classifyIntent(message, module), route, routingReason: useCreative ? ["creative-intent-authorized-module", ...reasons].join(",") : reasons.join(",") || "routine-operation", policyVersion: MODEL_POLICY_VERSION };
}

export function aggregateRoutes(events = []) {
  const totals = new Map();
  for (const event of events) {
    const calls = Array.isArray(event.modelCalls) ? event.modelCalls : event.route === "deterministic" ? [] : [event];
    for (const call of calls) {
      if (!call.route) continue;
      const row = totals.get(call.route) || { route: call.route, calls: 0, tokens: 0, costUsd: 0, unknownCosts: 0 };
      row.calls++; row.tokens += call.totalTokens || 0;
      if (call.actualCostUsd == null) row.unknownCosts++; else row.costUsd += call.actualCostUsd;
      totals.set(call.route, row);
    }
  }
  const count = [...totals.values()].reduce((sum, row) => sum + row.calls, 0);
  return [...totals.values()].map((row) => ({ ...row, percentage: count ? row.calls * 100 / count : 0 }));
}
