import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizedRole } from "../../../../src/gestion/permissions.js";
import { capabilities } from "./guards.mjs";
import { normalizeIntent } from "../../../../src/shared/oliviaCapabilities.mjs";
import { oliviaError } from "../../../../src/shared/oliviaContracts.mjs";
import { assistiveIntent } from '../../../../src/shared/oliviaAssistiveIntent.mjs';
const catalog = [
  { name: 'guiar-uso-aplicacion', version: '1.0.0', description: 'Explicar procedimientos reales y datos faltantes de la pantalla autorizada', roles: ['*'], requiredTools: ['get_app_capabilities', 'get_ui_guide'], intent: /como |guiame|paso a paso|donde (?:cargo|creo|registro)|que necesita/ },
  { name: 'guiar-interfaz-visual', version: '1.0.0', description: 'Ofrecer pasos visuales registrados sin hacer clic ni completar formularios', roles: ['*'], requiredTools: ['show_ui_guide'], intent: /mostrame como|senala|resalta|guia visual|guiame|paso a paso/ },
  { name: 'conversacion-natural-argentina', version: '1.0.0', description: 'Conversar con voseo, claridad y continuidad, sin muletillas mecánicas', roles: ['*'], requiredTools: [], intent: /habla.*argent|voseo|conversa.*natural/ },
  { name: 'idear-y-crear', version: '1.0.0', description: 'Idear nombres, códigos, textos, estrategias y ejemplos de programación; generar no es guardar ni ejecutar', roles: ['*'], requiredTools: [], intent: /inventa|idea|redacta|borrador|nombre|programacion/ },
  { name: "pronosticar-feria", version: "1.1.0", description: "Pronóstico y mercadería para una feria futura", roles: ["admin", "general_admin"], requiredTools: ["list_fair_events", "forecast_fair", "list_warehouses", "get_inventory_summary", "resolve_transfer_origin", "prepare_stock_transfer"], intent: /pronostic|cuanto.*vend|cuanto.*factur|que.*llevo|mercaderia|stock.*(mand|env|feria)|feria.*(pilar|fin de semana|sabado|domingo)/ },
  { name: "analizar-ventas", version: "1.1.0", description: "Analizar ventas, períodos elegidos y métricas derivadas", roles: ["admin", "general_admin"], requiredTools: ["get_sales_metrics"], intent: /vend|venta|compar|rendim|ticket|promedio|metric|rotacion|recompra|producto.*cayo|ubicacion.*crec/ },
  { name: "operar-panel-vendedor", version: "1.1.0", description: "Venta y ayuda del Panel Vendedor", roles: ["seller"], requiredTools: ["search_products", "get_stock", "prepare_sale"], intent: /venta|vend|producto|precio|stock|cobr|pago|ayud|como|funcion|descuento|factura|cliente|categoria|botonera|pendiente/ },
];
export function discoverSkills(session) {
  if (session?.profile?.active !== true) return [];
  const allowed = new Set(capabilities(session)), role = normalizedRole(session.profile);
  return catalog.filter((skill) => (skill.roles.includes(role) || skill.roles.includes('*')) && skill.requiredTools.every((name) => allowed.has(name))).map(({ intent, ...metadata }) => ({ ...metadata }));
}
const contentCache = new Map();
export async function loadSkill(session, name) {
  const metadata = discoverSkills(session).find((skill) => skill.name === name);
  if (!metadata) throw oliviaError("skill-not-allowed", "Esta Skill no está habilitada para tu usuario.", 403);
  if (!contentCache.has(name)) {
    let content;
    try { content = await readFile(new URL(`./skills/${name}/SKILL.md`, import.meta.url), "utf8"); }
    catch { content = await readFile(resolve(process.cwd(), "netlify/functions/_lib/olivia/skills", name, "SKILL.md"), "utf8"); }
    if (!content.includes(`name: ${name}`) || !content.includes(`version: ${metadata.version}`)) throw oliviaError("skill-invalid", "La versión de la Skill necesita revisión.", 503);
    contentCache.set(name, content);
  }
  return { ...metadata, content: contentCache.get(name) };
}
export async function routeSkills(session, query, previous = [], options = {}) {
  const available = new Set(discoverSkills(session).map((skill) => skill.name)), intent = normalizeIntent(query);
  const assistance = assistiveIntent(query, options.ideaContext);
  let selected = assistance.pure ? catalog.filter(skill => ['idear-y-crear', 'conversacion-natural-argentina'].includes(skill.name) && available.has(skill.name)) : catalog.filter((skill) => available.has(skill.name) && skill.intent.test(intent)).slice(0, 2);
  if (!assistance.pure && normalizedRole(session.profile) === 'seller' && available.has('operar-panel-vendedor') && catalog.find(skill => skill.name === 'operar-panel-vendedor').intent.test(intent)) selected = [catalog.find(skill => skill.name === 'operar-panel-vendedor'), ...selected.filter(skill => skill.name !== 'operar-panel-vendedor')].slice(0, 2);
  // Follow-ups retain only server-recorded, still authorized process versions.
  if (!selected.length && /^(si|no|dale|continua|prepara|preparame|hace|hacelo|eso|ese|esa|y |ahora|con ese|con esa)\b/.test(intent)) {
    selected = catalog.filter((skill) => available.has(skill.name) && previous.some((prior) => prior.name === skill.name && prior.version === skill.version)).slice(0, 2);
  }
  return Promise.all(selected.map((skill) => loadSkill(session, skill.name)));
}
