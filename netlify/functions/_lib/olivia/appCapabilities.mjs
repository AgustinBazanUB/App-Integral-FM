import { OLIVIA_APP_GUIDE, APP_GUIDE_VERSION } from "../../../../src/shared/oliviaAppGuide.mjs";
import { OLIVIA_CAPABILITIES } from "../../../../src/shared/oliviaCapabilities.mjs";
import { capabilities } from "./guards.mjs";
import { can, canAccessAdministration, normalizedRole } from "../../../../src/gestion/permissions.js";
const coreModules = { search_products: "products", list_locations: "locations", get_stock: "locations", get_prices: "locations", get_discounts: "locations", prepare_stock_load: "locations", prepare_sale: "quick-sales", get_my_sales: "seller" };

export function appCapabilities(session, query = "") {
  const names = capabilities(session), seller = normalizedRole(session.profile) === "seller";
  const terms = String(query).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/\W+/).filter(term => term.length > 3).slice(0, 12);
  const permitted = OLIVIA_APP_GUIDE.filter(row => seller ? row.module === "seller" : row.module !== "seller" && (row.module === "ai" ? canAccessAdministration(session.profile) : can(session.profile, row.module, "view")));
  const ranked = permitted.map(row => ({ row, score: terms.reduce((sum, term) => sum + (`${row.module} ${row.title} ${row.assisted} ${row.manual}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(term) ? 1 : 0), 0) }));
  const selected = terms.length && ranked.some(item => item.score) ? ranked.filter(item => item.score).sort((a, b) => b.score - a.score).slice(0, 4) : ranked;
  return { version: APP_GUIDE_VERSION, modules: selected.map(({ row }) => ({ ...row, tools: names.filter(name => (OLIVIA_CAPABILITIES[name]?.module || coreModules[name]) === row.module) })), instruction: "Solo las herramientas habilitadas ejecutan sus contratos. Lo manual se explica y abre en la app; ofrecé proponer a Agustín una capacidad faltante sin enviar nada hasta que el usuario lo pida." };
}
