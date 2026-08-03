import { businessModules } from "./modules.js";

export const ACTIONS = [
  "view",
  "create",
  "edit",
  "archive",
  "restore",
  "export",
  "approve",
  "admin",
  "viewFinancial",
  "viewSensitive",
  "viewAllLocations",
  "viewLocationProducts",
  "configureLocationProducts",
  "viewStock",
  "loadStock",
  "adjustStock",
  "assignSellers",
  "assignDiscounts",
];

const everyAction = [...ACTIONS];
const operational = ["view", "create", "edit", "export"];
const viewOnly = ["view"];

export const ROLE_TEMPLATES = {
  admin: Object.fromEntries(businessModules.map(({ id }) => [id, everyAction])),
  general_admin: Object.fromEntries(
    businessModules.map(({ id }) => [id, everyAction]),
  ),
  operational_admin: Object.fromEntries(
    businessModules.map(({ id, sensitive }) => [
      id,
      sensitive ? ["view"] : id === "locations"
        ? [...operational, "approve", "viewAllLocations", "viewLocationProducts", "configureLocationProducts", "viewStock", "loadStock", "adjustStock", "assignDiscounts"]
        : [...operational, "approve", "viewAllLocations"],
    ]),
  ),
  seller: {
    locations: ["view", "viewLocationProducts", "viewStock"],
    "quick-sales": ["view", "create", "edit"],
    alerts: ["view", "edit"],
  },
  location_manager: {
    locations: [...operational, "approve", "viewLocationProducts", "configureLocationProducts", "viewStock", "loadStock", "adjustStock"],
    "quick-sales": operational,
    metrics: viewOnly,
    alerts: ["view", "edit"],
  },
  warehouse_manager: {
    locations: viewOnly,
    warehouse: [...operational, "approve"],
    suppliers: operational,
    alerts: ["view", "edit"],
  },
  marketing_manager: {
    "loyal-customers": ["view", "viewSensitive"],
    social: operational,
    marketing: operational,
    metrics: viewOnly,
  },
  ecommerce_manager: {
    ecommerce: operational,
    shipping: operational,
    "loyal-customers": ["view", "viewSensitive"],
    metrics: viewOnly,
  },
  shipping_manager: {
    shipping: operational,
    alerts: ["view", "edit"],
  },
  supplier_manager: {
    suppliers: [...operational, "approve"],
    warehouse: operational,
    finance: ["view"],
  },
  financial_manager: {
    finance: [...everyAction],
    metrics: ["view", "export", "viewFinancial"],
  },
  analyst: {
    metrics: ["view", "export", "viewFinancial"],
  },
};

const roleAliases = {
  administrator: "admin",
  administrador: "admin",
  administrador_general: "general_admin",
  administrador_operativo: "operational_admin",
  encargado_ubicacion: "location_manager",
  responsable_deposito: "warehouse_manager",
  responsable_marketing: "marketing_manager",
  responsable_ecommerce: "ecommerce_manager",
  responsable_envios: "shipping_manager",
  responsable_proveedores: "supplier_manager",
  responsable_financiero: "financial_manager",
  analista_metricas: "analyst",
};

export function normalizedRole(profile = {}) {
  if (
    profile.role === "admin" ||
    profile.canAccessAdmin === true ||
    profile.isAdmin === true ||
    profile.roles?.includes?.("admin")
  ) {
    return "admin";
  }
  const role = String(profile.role || profile.roles?.[0] || "seller")
    .trim()
    .toLowerCase()
    .replaceAll(" ", "_");
  return roleAliases[role] || role;
}

function explicitActions(profile, moduleId) {
  const modulePermission = profile.permissions?.[moduleId];
  if (Array.isArray(modulePermission)) return modulePermission;
  if (modulePermission && typeof modulePermission === "object") {
    return Object.entries(modulePermission)
      .filter(([, allowed]) => allowed === true)
      .map(([action]) => action);
  }
  return null;
}

export function actionsFor(profile, moduleId) {
  if (!profile?.active) return [];
  const denied = new Set(profile.permissionDeny?.[moduleId] || []);
  const explicit = explicitActions(profile, moduleId);
  const template = ROLE_TEMPLATES[normalizedRole(profile)]?.[moduleId] || [];
  const allowed = new Set(explicit ?? template);
  for (const action of profile.permissionAllow?.[moduleId] || []) {
    allowed.add(action);
  }
  for (const action of denied) allowed.delete(action);
  return [...allowed];
}

export const can = (profile, moduleId, action = "view") =>
  actionsFor(profile, moduleId).includes(action) ||
  actionsFor(profile, moduleId).includes("admin");

export const canAccessModule = (profile, moduleId) =>
  can(profile, moduleId, "view");

export const visibleBusinessModules = (profile) =>
  businessModules.filter(({ id }) => canAccessModule(profile, id));

export const canAccessAdministration = (profile) =>
  ["admin", "general_admin"].includes(normalizedRole(profile));

export const canAccessManagementRoute = (profile, routeId) => {
  if (["dashboard", "settings"].includes(routeId)) return Boolean(profile?.active);
  if (routeId === "actividad") return can(profile, "locations", "view");
  if (["administration", "audit"].includes(routeId)) {
    return canAccessAdministration(profile);
  }
  return canAccessModule(profile, routeId);
};
