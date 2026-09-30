import { isLocationActiveNow } from "../modules/locations/domain/locations.js";
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
  "pin",
  "viewLocationProducts",
  "configureLocationProducts",
  "createLocationProducts",
  "editMasterProducts",
  "assignAllLocationProducts",
  "viewStock",
  "loadStock",
  "adjustStock",
  "transferStock",
  "assignSellers",
  "assignDiscounts",
  "viewOwn",
  "cancelOwn",
  "useDiscounts",
  "useManualDiscounts",
  "useMultiplePayments",
  "useOfflineSales",
  "useKeyboard",
  "requestTicket",
  "whatsappView",
  "whatsappCreateCampaign",
  "whatsappSendToExtension",
  "whatsappCancelCampaign",
  "whatsappViewHistory",
  "whatsappImportExcel",
  "metaAdsView",
  "metaAdsCreateProject",
  "metaAdsEditProject",
  "metaAdsArchiveProject",
  "metaAdsManageKnowledge",
  "metaAdsManageTheory",
  "metaAdsPlanCampaign",
  "metaAdsApprovePlan",
  "metaAdsViewCreativeWorkspace",
  "metaAdsUploadCreative",
  "metaAdsManageDrive",
];

const everyAction = [...ACTIONS];
const operational = ["view", "create", "edit", "export"];
const viewOnly = ["view"];
const whatsappMarketingActions = [
  "whatsappView",
  "whatsappCreateCampaign",
  "whatsappSendToExtension",
  "whatsappCancelCampaign",
  "whatsappViewHistory",
  "whatsappImportExcel",
];
const metaAdsMarketingActions = [
  "metaAdsView",
  "metaAdsCreateProject",
  "metaAdsEditProject",
  "metaAdsArchiveProject",
  "metaAdsManageKnowledge",
  "metaAdsManageTheory",
  "metaAdsPlanCampaign",
  "metaAdsApprovePlan",
  "metaAdsViewCreativeWorkspace",
  "metaAdsUploadCreative",
];
const sellerSalesActions = [
  "view",
  "create",
  "edit",
  "viewOwn",
  "cancelOwn",
  "useDiscounts",
  "useManualDiscounts",
  "useMultiplePayments",
  "useOfflineSales",
  "useKeyboard",
  "requestTicket",
];

export const ROLE_TEMPLATES = {
  admin: Object.fromEntries(businessModules.map(({ id }) => [id, everyAction])),
  general_admin: Object.fromEntries(
    businessModules.map(({ id }) => [id, everyAction]),
  ),
  operational_admin: Object.fromEntries(
    businessModules.map(({ id, sensitive }) => [
      id,
      sensitive ? ["view"] : id === "locations"
        ? [
            ...operational,
            "approve",
            "viewAllLocations",
            "viewLocationProducts",
            "configureLocationProducts",
            "viewStock",
            "loadStock",
            "adjustStock",
            "assignDiscounts",
          ]
        : id === "warehouse"
          ? [...operational, "approve", "transferStock"]
          : id === "quick-sales"
            ? [...operational, ...sellerSalesActions]
            : id === "marketing"
              ? [...operational, ...whatsappMarketingActions]
              : [...operational, "approve", "viewAllLocations"],
    ]),
  ),
  seller: {
    locations: ["view", "viewLocationProducts", "viewStock"],
    "quick-sales": sellerSalesActions,
    alerts: ["view", "edit"],
  },
  location_manager: {
    locations: [
      ...operational,
      "approve",
      "viewLocationProducts",
      "configureLocationProducts",
      "viewStock",
      "loadStock",
      "adjustStock",
    ],
    "quick-sales": [...operational, ...sellerSalesActions],
    metrics: viewOnly,
    alerts: ["view", "edit"],
  },
  warehouse_manager: {
    locations: ["view", "viewAllLocations"],
    warehouse: [...operational, "approve", "transferStock"],
    suppliers: operational,
    alerts: ["view", "edit"],
  },
  marketing_manager: {
    "loyal-customers": ["view", "viewSensitive"],
    social: operational,
    marketing: [...operational, ...whatsappMarketingActions, ...metaAdsMarketingActions],
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
    warehouse: [...operational, "transferStock"],
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

export const canAccessAdminPanel = (profile) =>
  Boolean(profile?.active) &&
  (canAccessAdministration(profile) || normalizedRole(profile) !== "seller") &&
  visibleBusinessModules(profile).length > 0;

export const canAccessSellerPanel = (profile) =>
  Boolean(profile?.active) &&
  (can(profile, "quick-sales", "create") || can(profile, "quick-sales", "view"));

export const isPureSeller = (profile) =>
  normalizedRole(profile) === "seller" && !canAccessAdminPanel(profile);

export function effectiveSellerLocations(profile, locations = [], now = new Date()) {
  if (!canAccessSellerPanel(profile)) return [];
  const canSeeAll =
    canAccessAdministration(profile) ||
    can(profile, "locations", "viewAllLocations");
  const allowed = new Set(profile.allowedLocationIds || []);
  return (locations || [])
    .filter((location) => location?.deleted !== true)
    .filter((location) => isLocationActiveNow(location, now))
    .filter((location) =>
      canSeeAll ||
      allowed.has(location.id) ||
      (location.assignedSellerIds || []).includes(profile.id),
    )
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"));
}

export const effectiveSellerLocationIds = (profile, locations = [], now = new Date()) =>
  effectiveSellerLocations(profile, locations, now).map((location) => location.id);

export const canAccessManagementRoute = (profile, routeId) => {
  if (["dashboard", "settings"].includes(routeId)) return canAccessAdminPanel(profile);
  if (routeId === "actividad") return canAccessAdminPanel(profile) && can(profile, "locations", "view");
  if (["administration", "audit"].includes(routeId)) {
    return canAccessAdministration(profile);
  }
  return canAccessAdminPanel(profile) && canAccessModule(profile, routeId);
};
