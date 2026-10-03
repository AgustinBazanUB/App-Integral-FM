import { withRuntimeCache, invalidateRuntimeCache } from "../services/runtimeCache";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp, startAfter, where } from "firebase/firestore";
import { db } from "../services/firebase";
import { can, normalizedRole } from "../permissions";
import { listSalesByRange } from "../services/dashboardService";
import { listMasterProductsShared } from "../services/sharedResources";
import { addArgentinaDays, argentinaDateKey, argentinaDateFromKey } from "../../modules/locations/domain/time";
import { isActiveSale, saleDate } from "../../modules/locations/domain/saleFacts";
import { customerPurchaseIndex, validateLoyaltyPolicy } from "./customerPurchases";
import { normalizeCustomerPhone } from "./customerDomain";

const requireCRM = profile => { if (!can(profile, "loyal-customers", "view")) throw new Error("No tenés permiso para consultar el CRM."); };
export async function listCustomerPage(profile, cursor = null) {
  requireCRM(profile);
  const constraints = [orderBy("updatedAt", "desc"), ...(cursor ? [startAfter(cursor)] : []), limit(51)];
  const snapshot = await getDocs(query(collection(db, "customers"), ...constraints));
  const documents = snapshot.docs.slice(0, 50);
  /** @type {any[]} */
  const items = documents.map(item => ({ id: item.id, ...item.data() }));
  return { items: items.filter(item => item.deleted !== true), cursor: documents.at(-1) || null, hasMore: snapshot.size > 50 };
}
export async function getLoyaltyPolicy(profile) {
  requireCRM(profile);
  return withRuntimeCache(`crm-loyalty:${profile.id}`, async () => {
    const snapshot = await getDoc(doc(db, "settings", "crmLoyalty"));
    return validateLoyaltyPolicy(snapshot.exists() ? snapshot.data() : {});
  }, 60_000);
}
export async function saveLoyaltyPolicy(profile, input) {
  if (!["admin", "general_admin"].includes(normalizedRole(profile))) throw new Error("Sólo Administración puede configurar la fidelización.");
  const policy = validateLoyaltyPolicy(input);
  const reference = doc(db, "settings", "crmLoyalty");
  const audit = doc(collection(db, "auditLogs"));
  await runTransaction(db, async transaction => {
    const previous = await transaction.get(reference);
    transaction.set(reference, { ...policy, version: Number(previous.data()?.version || 0) + 1, updatedBy: profile.id, updatedAt: serverTimestamp() });
    transaction.set(audit, { moduleId: "loyal-customers", action: "customer.loyalty.configured", entityType: "setting", entityId: "crmLoyalty", userId: profile.id, userName: profile.name || profile.email, description: "Regla de fidelización configurada", policy, createdAt: serverTimestamp() });
  });
  invalidateRuntimeCache("crm-loyalty:");
  return policy;
}
export async function customerAnalysis(profile, customers, policy, viewDays = 90) {
  requireCRM(profile);
  const today = argentinaDateFromKey(argentinaDateKey());
  const days = policy.enabled ? policy.windowDays : Math.max(1, Math.min(3660, Number(viewDays) || 90));
  const start = addArgentinaDays(today, 1 - days);
  const end = addArgentinaDays(today, 1);
  const [sales, products] = await Promise.all([listSalesByRange({ profile, start, end, locationIds: undefined, includeCancelled: true }), listMasterProductsShared(profile)]);
  return { stats: customerPurchaseIndex(customers, sales, products, policy), products, start, end, days };
}

// Paginación por grupo: cada cursor avanza sólo hasta los documentos consumidos.
// Incluye IDs anteriores sin reescribir ventas y teléfonos de ecommerce existentes.
export async function customerHistoryPage(profile, customer, cursor = {}, activeOnly = false) {
  requireCRM(profile);
  const identities = new Set([customer.id, ...(customer.previousCustomerIds || []), customer.migratedFromCustomerId].filter(Boolean));
  let legacyId = customer.migratedFromCustomerId;
  for (let depth = 0; legacyId && depth < 20; depth++) {
    const previous = await getDoc(doc(db, "customers", legacyId));
    const parent = previous.data()?.migratedFromCustomerId;
    if (!parent || identities.has(parent)) break;
    identities.add(parent); legacyId = parent;
  }
  const ids = [...identities];
  const groups = Array.from({ length: Math.ceil(ids.length / 10) }, (_, index) => ({ key: `id:${index}`, field: "customerId", values: ids.slice(index * 10, index * 10 + 10) }));
  const phone = normalizeCustomerPhone(customer.phoneNormalized || customer.phone);
  const phones = phone ? [...new Set([customer.phone, phone, `+54${phone}`, `+549${phone}`, `54${phone}`, `549${phone}`].filter(Boolean))] : [];
  if (phones.length) groups.push({ key: "phone", field: "customerPhoneSnapshot", values: phones });
  const pages = await Promise.all(groups.map(async group => {
    const constraints = [where(group.field, "in", group.values), orderBy("createdAt", "desc"), ...(cursor[group.key] ? [startAfter(cursor[group.key])] : []), limit(21)];
    const snapshot = await getDocs(query(collection(db, "sales"), ...constraints));
    return snapshot.docs.map(document => ({ group: group.key, document, sale: { id: document.id, ...document.data() } }));
  }));
  const raw = pages.flat().sort((a, b) => (saleDate(b.sale)?.getTime() || 0) - (saleDate(a.sale)?.getTime() || 0) || b.sale.id.localeCompare(a.sale.id));
  const items = [], seen = new Set(), next = { ...cursor };
  let consumed = 0;
  for (const entry of raw) {
    // Consumir todas las apariciones de la última venta elegida antes de cortar.
    // La misma venta puede coincidir por customerId y por teléfono histórico.
    if (items.length === 20 && !seen.has(entry.sale.id)) break;
    next[entry.group] = entry.document; consumed++;
    if (seen.has(entry.sale.id) || (activeOnly && !isActiveSale(entry.sale))) continue;
    seen.add(entry.sale.id); items.push(entry.sale);
  }
  return { items, cursor: next, hasMore: consumed < raw.length || pages.some(page => page.length === 21) };
}
export async function customerLastPurchase(profile, customer) {
  let cursor = {};
  for (;;) {
    const page = await customerHistoryPage(profile, customer, cursor, true);
    if (page.items.length) return saleDate(page.items[0]);
    if (!page.hasMore) return null;
    cursor = page.cursor;
  }
}
