import { CURRENT_CAPABILITIES } from "./oliviaCurrentCapabilities.mjs";

const normalize = value => String(value || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const tokens = value => [...new Set(normalize(value).match(/[a-z0-9]+/g) || [])].filter(word => word.length > 2);
const indexed = CURRENT_CAPABILITIES.map((entry, index) => ({ entry, index, title: new Set(tokens(entry.title)), body: new Set(tokens(entry.text)) }));

// This index describes the deployed code; proposed-solution knowledge is separate.
// Authorization and live business values always come from backend tools.
export function retrieveCurrentOliviaKnowledge(query, { role, module = "", allowedModules = [], limit = 4 } = {}) {
  const admin = ["admin", "general_admin"].includes(role);
  const seller = role === "seller";
  if (!admin && !seller && !allowedModules.length) return [];
  const terms = tokens(String(query || "").slice(0, 1000)).slice(0, 32);
  const results = [];
  for (const record of indexed) {
    const { entry } = record;
    if (seller ? entry.audience !== "seller" : entry.audience === "seller") continue;
    if (!admin && !seller && !allowedModules.includes(entry.module)) continue;
    let score = terms.reduce((sum, term) => sum + (record.title.has(term) ? 4 : record.body.has(term) ? 1 : 0), 0);
    if (terms.length && !score) continue;
    if (!terms.length && entry.module !== module) continue;
    if (entry.module === module) score += 2;
    results.push({ ...record, score });
  }
  return results.sort((a,b) => b.score - a.score || a.index - b.index).slice(0, Math.max(0, Math.min(4, Number(limit) || 0))).map(({ entry }) => ({ ...entry }));
}
