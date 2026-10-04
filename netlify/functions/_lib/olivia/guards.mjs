import {
  can,
  actionsFor,
  normalizedRole,
  canAccessAdministration,
  canAccessManagementRoute,
  effectiveSellerLocations,
} from "../../../../src/gestion/permissions.js";
import { isLocationActiveNow } from "../../../../src/modules/locations/domain/locations.js";
import {
  safeId,
  oliviaError,
} from "../../../../src/shared/oliviaContracts.mjs";
export const sellerProfile = (profile) => normalizedRole(profile) === "seller";
export function assertOliviaAccess(session) {
  if (!session?.uid || session.profile?.active !== true)
    throw oliviaError("unauthenticated", "Tu sesión no está activa.", 401);
  if (
    !sellerProfile(session.profile) &&
    !canAccessAdministration(session.profile) &&
    !can(session.profile, "ai", "view")
  )
    throw oliviaError(
      "permission-denied",
      "Olivia todavía no está habilitada para tu rol.",
      403,
    );
  if (
    sellerProfile(session.profile) &&
    !can(session.profile, "quick-sales", "view")
  )
    throw oliviaError(
      "permission-denied",
      "No tenés acceso al Panel Vendedor.",
      403,
    );
}
export function assertCapability(session, name) {
  assertOliviaAccess(session);
  const p = session.profile;
  const checks = {
    get_current_user_context: () => true,
    list_locations: () => can(p, "locations", "view"),
    search_products: () =>
      can(p, "locations", "viewLocationProducts") ||
      (!sellerProfile(p) && can(p, "products", "view")),
    get_stock: () => can(p, "locations", "viewStock"),
    get_promotions: () => can(p, "quick-sales", "useDiscounts"),
    get_today_sales: () =>
      can(p, "quick-sales", "viewOwn") ||
      (!sellerProfile(p) && can(p, "quick-sales", "view")),
    navigate_to_module: () => true,
    prepare_sale: () => can(p, "quick-sales", "create"),
    prepare_stock_load: () =>
      !sellerProfile(p) && can(p, "locations", "loadStock"),
  };
  if (!checks[name]?.())
    throw oliviaError(
      "permission-denied",
      "Esta herramienta no está habilitada para tu usuario.",
      403,
    );
}
export function capabilities(session) {
  return [
    "get_current_user_context",
    "list_locations",
    "search_products",
    "get_stock",
    "get_promotions",
    "get_today_sales",
    "navigate_to_module",
    "prepare_sale",
    "prepare_stock_load",
  ].filter((name) => {
    try {
      assertCapability(session, name);
      return true;
    } catch {
      return false;
    }
  });
}
export async function permittedLocation(
  session,
  locationId,
  store,
  { action = "viewStock" } = {},
) {
  safeId(locationId, "ubicación");
  const p = session.profile;
  const location = await store.get(`locations/${locationId}`);
  if (!location || location.deleted || !isLocationActiveNow(location))
    throw oliviaError(
      "location-unavailable",
      "La ubicación no está disponible.",
      409,
    );
  if (!can(p, "locations", action))
    throw oliviaError(
      "permission-denied",
      "No tenés permiso para esta ubicación.",
      403,
    );
  const allowed = effectiveSellerLocations(p, [location]).length > 0;
  if (!allowed)
    throw oliviaError(
      "permission-denied",
      "La ubicación no está habilitada para tu usuario.",
      403,
    );
  return location;
}
export async function permittedLocations(session, store) {
  const p = session.profile;
  if (
    canAccessAdministration(p) ||
    (!sellerProfile(p) && can(p, "locations", "viewAllLocations"))
  ) {
    const locations = await store.query("locations", [], 100);
    return effectiveSellerLocations(p, locations).map((l) => ({
      id: l.id,
      name: l.name,
    }));
  }
  // Assignment queries are scoped, bounded and rechecked; never load all locations for a seller.
  const assigned = await store.query(
    "locations",
    [["assignedSellerIds", "ARRAY_CONTAINS", session.uid]],
    50,
  );
  const direct = await Promise.all(
    (p.allowedLocationIds || [])
      .slice(0, 50)
      .map((id) => store.get(`locations/${safeId(id)}`)),
  );
  const unique = [
    ...new Map(
      [...assigned, ...direct.filter(Boolean)].map((l) => [l.id, l]),
    ).values(),
  ];
  return effectiveSellerLocations(p, unique).map((l) => ({
    id: l.id,
    name: l.name,
  }));
}
export async function resolveLocation(session, candidate, context, store) {
  if (candidate) {
    await permittedLocation(session, candidate, store);
    return candidate;
  }
  if (context.locationId) {
    await permittedLocation(session, context.locationId, store);
    return context.locationId;
  }
  const locations = await permittedLocations(session, store);
  if (locations.length === 1) return locations[0].id;
  throw oliviaError(
    "location-required",
    locations.length
      ? "Indicá cuál de tus ubicaciones querés usar."
      : "No tenés una ubicación activa habilitada.",
    422,
  );
}
export function userContext(session) {
  const p = session.profile;
  return {
    userId: session.uid,
    role: normalizedRole(p),
    permissions: Object.fromEntries(
      ["locations", "products", "quick-sales", "warehouse", "alerts"].map(
        (m) => [m, actionsFor(p, m)],
      ),
    ),
    allowedLocationIds: (p.allowedLocationIds || []).slice(0, 50),
    capabilities: capabilities(session),
  };
}
export function navigationFor(session, args) {
  const p = session.profile;
  const entity = args.entityId ? safeId(args.entityId) : null;
  if (sellerProfile(p)) {
    const views = new Set([
      "sale",
      "sales",
      "pending",
      "stock",
      "prices",
      "help",
    ]);
    if (!views.has(args.module))
      throw oliviaError(
        "permission-denied",
        "Esa pantalla no pertenece a tu Panel Vendedor.",
        403,
      );
    return { path: `/vendedor?view=${args.module}` };
  }
  if (!canAccessManagementRoute(p, args.module))
    throw oliviaError(
      "permission-denied",
      "No tenés acceso a ese módulo.",
      403,
    );
  return {
    path:
      args.module === "dashboard"
        ? "/gestion"
        : args.module === "metrics"
          ? "/gestion/metrics/sales"
          : `/gestion/${args.module}${entity && ["locations", "warehouse"].includes(args.module) ? `/${entity}` : ""}`,
  };
}
