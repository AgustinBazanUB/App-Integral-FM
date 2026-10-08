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
export function invalidateDashboardSales() {
  salesCache.clear();
}
const chunk = (items, size = 10) => Array.from(
  { length: Math.ceil(items.length / size) },
  (_, index) => items.slice(index * size, index * size + size),
);

const hasAllLocations = (profile) =>
  ["admin", "general_admin"].includes(normalizedRole(profile)) ||
  can(profile, "locations", "viewAllLocations") || can(profile, "finance", "view") || can(profile, "loyal-customers", "view") || (normalizedRole(profile) === "analyst" && can(profile, "metrics", "view"));

function allowedIds(profile, requestedIds) {
  const requested = requestedIds ? [...new Set(requestedIds)] : null;
  if (hasAllLocations(profile)) return requested;
  const permitted = new Set(profile?.allowedLocationIds || []);
  return (requested || [...permitted]).filter((id) => permitted.has(id));
}

const snapshotDate = (snapshot) => snapshot.data().createdAt?.toDate?.() || new Date(0);

export async function listSalesByRange({ profile, locationIds, start, end, useCache = true, includeCancelled = false }) {
  if (!hasAllLocations(profile) && !can(profile, "quick-sales", "view") && !can(profile, "metrics", "view")) return [];
  const scopedIds = allowedIds(profile, locationIds);
  if (Array.isArray(scopedIds) && !scopedIds.length) return [];
  const key = [
    profile.id,
    scopedIds?.slice().sort().join(",") || "all",
    start.toISOString(),
    end.toISOString(),
    includeCancelled ? "history" : "active",
  ].join("|");
  const cached = salesCache.get(key);
  if (useCache && cached && Date.now() - cached.savedAt < SALES_CACHE_TTL) return cached.data;

  const groups = scopedIds ? chunk(scopedIds) : [null];
  const snapshots = await Promise.all(groups.map((ids) => {
    /** @type {import("firebase/firestore").QueryConstraint[]} */
    const constraints = [
      ...(!includeCancelled ? [where("status", "==", "active")] : []),
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
    locationName: data.locationName || data.warehouseName || data.stockOriginName || "",
    userId: data.userId || data.sellerId || data.createdBy || "",
    userName: data.userName || data.sellerName || data.createdByName || "Sistema",
    moduleId: data.moduleId || (source === "sales" ? "quick-sales" : source === "stockMovements" ? (data.inventoryType === "warehouse" ? "warehouse" : "locations") : "system"),
    entityId: data.entityId || data.saleId || item.id,
    ...(data.amount != null || data.total != null ? { amount: Number(data.amount ?? data.total) } : {}),
    raw: data,
  };
  if (source === "auditLogs") {
    const entityType = String(data.entityType || "").toLowerCase();
    const saleKey = (entityType === "sale" || String(data.action).startsWith("sale.")) && data.entityId && data.action === "sale.created"
      ? `sale:${data.entityId}:created`
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
    return {
      ...base,
      key: `sale:${item.id}:created`,
      action: "sale.created",
      title: "Venta registrada",
      description: [data.saleCode, data.locationName].filter(Boolean).join(" · "),
      // Cancellation/editing has its own immutable audit event and date. The
      // mutable sale document is only a fallback for the original creation.
      status: "completed",
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

/** @param {*} options */
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
  const size = Math.floor(Math.min(50, Math.max(1, Number(pageSize) || 20)));
  const sourceLimit = size + 1;
  // Freeze the upper bound across pages so a new record in another stream
  // cannot be appended below older activity. Refresh starts a new timeline.
  const asOf = cursor.__asOf || new Date();
  const upperBound = to && to < asOf ? to : asOf;
  const streams = sources.flatMap(source => groups.map(group => ({ source, group, key: `${source}:${group.suffix}`, buffer: [], exhausted: false, position: cursor[`${source}:${group.suffix}`] })));
  const fetchStream = async stream => {
    const constraints = [];
    if (stream.group.ids) constraints.push(where("locationId", "in", stream.group.ids));
    if (from) constraints.push(where("createdAt", ">=", Timestamp.fromDate(from)));
    constraints.push(where("createdAt", "<", Timestamp.fromDate(upperBound)));
    constraints.push(orderBy("createdAt", "desc"));
    if (stream.position) constraints.push(startAfter(stream.position));
    constraints.push(limit(sourceLimit));
    const snapshot = await getDocs(query(collection(db, stream.source), ...constraints));
    stream.buffer = snapshot.docs;
    stream.exhausted = snapshot.docs.length < sourceLimit;
  };
  const items = [];
  const seen = new Set(cursor.__seen || []);
  const nextCursor = { ...cursor, __asOf: asOf };
  let scanned = 0;
  // Merge the head of every stream, refilling before choosing an older record.
  // A sparse filter must not return old matches ahead of unseen newer matches.
  // The scan is bounded; the UI can continue even when a page has no matches.
  while (items.length < size && scanned < 600) {
    await Promise.all(streams.filter(stream => !stream.buffer.length && !stream.exhausted).map(fetchStream));
    const candidates = streams.filter(stream => stream.buffer.length).sort((a, b) => snapshotDate(b.buffer[0]) - snapshotDate(a.buffer[0]) || a.source.localeCompare(b.source) || b.buffer[0].id.localeCompare(a.buffer[0].id));
    if (!candidates.length) break;
    const stream = candidates[0], document = stream.buffer.shift();
    stream.position = document;
    nextCursor[stream.key] = document;
    scanned++;
    const activity = activityFromDocument(stream.source, document);
    if (!activity || !matchesActivityFilters(activity, filters)) continue;
    const uniqueKey = activity.key || activity.id;
    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);
    items.push(activity);
  }
  nextCursor.__seen = [...seen];
  return {
    items,
    cursor: nextCursor,
    hasMore: streams.some(stream => stream.buffer.length || !stream.exhausted),
  };
}

export async function listRecentActivity({ profile, locationIds, pageSize = 6 }) {
  const page = await listActivityPage({ profile, locationIds, pageSize });
  return page.items;
}
