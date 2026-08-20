import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import { can, normalizedRole } from "../permissions";

const SALES_CACHE_TTL = 60_000;
const salesCache = new Map();
const chunk = (items, size = 10) => Array.from(
  { length: Math.ceil(items.length / size) },
  (_, index) => items.slice(index * size, index * size + size),
);

const hasAllLocations = (profile) =>
  ["admin", "general_admin"].includes(normalizedRole(profile)) ||
  can(profile, "locations", "viewAllLocations");

function allowedIds(profile, requestedIds) {
  const requested = requestedIds ? [...new Set(requestedIds)] : null;
  if (hasAllLocations(profile)) return requested;
  const permitted = new Set(profile?.allowedLocationIds || []);
  return (requested || [...permitted]).filter((id) => permitted.has(id));
}

const snapshotDate = (snapshot) => snapshot.data().createdAt?.toDate?.() || new Date(0);

export async function listSalesByRange({ profile, locationIds, start, end, useCache = true }) {
  if (!hasAllLocations(profile) && !can(profile, "quick-sales", "view") && !can(profile, "metrics", "view")) return [];
  const scopedIds = allowedIds(profile, locationIds);
  if (Array.isArray(scopedIds) && !scopedIds.length) return [];
  const key = [
    profile.id,
    scopedIds?.slice().sort().join(",") || "all",
    start.toISOString(),
    end.toISOString(),
  ].join("|");
  const cached = salesCache.get(key);
  if (useCache && cached && Date.now() - cached.savedAt < SALES_CACHE_TTL) return cached.data;

  const groups = scopedIds ? chunk(scopedIds) : [null];
  const snapshots = await Promise.all(groups.map((ids) => {
    const constraints = [
      where("status", "==", "active"),
      where("createdAt", ">=", Timestamp.fromDate(start)),
      where("createdAt", "<", Timestamp.fromDate(end)),
    ];
    if (ids) constraints.unshift(where("locationId", "in", ids));
    constraints.push(orderBy("createdAt", "desc"));
    return getDocs(query(collection(db, "sales"), ...constraints));
  }));
  const unique = new Map();
  snapshots.forEach((result) => result.docs.forEach((item) => {
    const data = item.data();
    if (data.deleted !== true) unique.set(item.id, { id: item.id, ...data });
  }));
  const data = [...unique.values()].sort((a, b) => {
    const left = a.createdAt?.toMillis?.() || 0;
    const right = b.createdAt?.toMillis?.() || 0;
    return right - left;
  });
  salesCache.set(key, { savedAt: Date.now(), data });
  return data;
}

const activitySourcesFor = (profile) => [
  ...(can(profile, "locations", "view") ? ["auditLogs", "stockMovements"] : []),
  ...(can(profile, "quick-sales", "view") || can(profile, "metrics", "view") ? ["sales"] : []),
];

function activityGroups(profile, requestedLocationIds) {
  const scopedIds = allowedIds(profile, requestedLocationIds);
  if (Array.isArray(scopedIds) && !scopedIds.length) return [];
  return scopedIds ? chunk(scopedIds).map((ids, index) => ({ ids, suffix: String(index) })) : [{ ids: null, suffix: "all" }];
}

function activityFromDocument(source, item) {
  const data = item.data();
  const base = {
    id: `${source}:${item.id}`,
    source,
    sourceId: item.id,
    createdAt: data.createdAt,
    locationId: data.locationId || "",
    locationName: data.locationName || "",
    userId: data.userId || data.sellerId || data.createdBy || "",
    userName: data.userName || data.sellerName || data.createdByName || "Sistema",
    moduleId: data.moduleId || (source === "sales" ? "quick-sales" : source === "stockMovements" ? "locations" : "system"),
    entityId: data.entityId || data.saleId || item.id,
    raw: data,
  };
  if (source === "auditLogs") {
    const entityType = String(data.entityType || "").toLowerCase();
    const saleKey = entityType === "sale" && data.entityId
      ? `sale:${data.entityId}:${String(data.action).includes("cancel") ? "cancelled" : "active"}`
      : null;
    return {
      ...base,
      key: saleKey || `audit:${item.id}`,
      action: data.action || "system.updated",
      title: data.title || data.description || "Operación registrada",
      description: data.description || data.entityName || data.entityType || "Actividad del sistema",
      status: data.status || "completed",
    };
  }
  if (source === "sales") {
    const cancelled = String(data.status || "active").toLowerCase() !== "active";
    return {
      ...base,
      key: `sale:${item.id}:${cancelled ? "cancelled" : "active"}`,
      action: cancelled ? "sale.cancelled" : "sale.created",
      title: cancelled ? "Venta anulada" : "Venta registrada",
      description: [data.saleCode, data.locationName].filter(Boolean).join(" · "),
      status: cancelled ? "cancelled" : "completed",
      amount: Number(data.total || 0),
    };
  }
  if (data.operationId || ["sale", "sale_edit", "sale_cancel", "sale_restore"].includes(data.type)) return null;
  const labels = {
    initial: "Stock inicial configurado",
    initial_adjustment: "Stock inicial ajustado",
    add: "Mercadería agregada",
    adjustment: "Inventario ajustado",
    stock_delete: "Stock desactivado",
  };
  return {
    ...base,
    key: `stock:${item.id}`,
    action: `stock.${data.type || "updated"}`,
    title: labels[data.type] || "Stock actualizado",
    description: data.reason || data.productName || "Movimiento de inventario",
    status: "completed",
  };
}

function matchesActivityFilters(activity, filters = {}) {
  if (filters.userId && activity.userId !== filters.userId) return false;
  if (filters.moduleId && activity.moduleId !== filters.moduleId) return false;
  if (filters.action && activity.action !== filters.action) return false;
  return true;
}

export async function listActivityPage({
  profile,
  locationIds,
  from,
  to,
  filters = {},
  pageSize = 20,
  cursor = {},
}) {
  const groups = activityGroups(profile, locationIds);
  if (!groups.length) return { items: [], cursor, hasMore: false };
  const sources = activitySourcesFor(profile);
  const hasPostFilter = Boolean(filters.userId || filters.moduleId || filters.action);
  const sourceLimit = hasPostFilter ? Math.min(100, Math.max(pageSize * 5, pageSize + 1)) : pageSize + 1;
  const tasks = sources.flatMap((source) => groups.map(async (group) => {
    const key = `${source}:${group.suffix}`;
    const constraints = [];
    if (group.ids) constraints.push(where("locationId", "in", group.ids));
    if (from) constraints.push(where("createdAt", ">=", Timestamp.fromDate(from)));
    if (to) constraints.push(where("createdAt", "<", Timestamp.fromDate(to)));
    constraints.push(orderBy("createdAt", "desc"));
    if (cursor[key]) constraints.push(startAfter(cursor[key]));
    constraints.push(limit(sourceLimit));
    const snapshot = await getDocs(query(collection(db, source), ...constraints));
    return snapshot.docs.map((item) => ({ key, source, item }));
  }));
  const fetchedGroups = await Promise.all(tasks);
  const raw = fetchedGroups.flat().sort((a, b) => {
    const difference = snapshotDate(b.item) - snapshotDate(a.item);
    return difference || b.item.id.localeCompare(a.item.id);
  });
  const items = [];
  const seen = new Set();
  const processed = [];
  for (const entry of raw) {
    processed.push(entry);
    const activity = activityFromDocument(entry.source, entry.item);
    if (!activity || !matchesActivityFilters(activity, filters)) continue;
    const uniqueKey = activity.key || activity.id;
    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);
    items.push(activity);
    if (items.length >= pageSize) break;
  }
  const nextCursor = { ...cursor };
  processed.forEach((entry) => { nextCursor[entry.key] = entry.item; });
  return {
    items,
    cursor: nextCursor,
    hasMore: processed.length < raw.length || fetchedGroups.some((entries) => entries.length >= sourceLimit),
  };
}

export async function listRecentActivity({ profile, locationIds, pageSize = 6 }) {
  const page = await listActivityPage({ profile, locationIds, pageSize });
  return page.items;
}
