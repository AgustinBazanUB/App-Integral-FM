export const managementPageLoaders = {
  administration: () => import("./pages/AdministrationPage"),
  actividad: () => import("./pages/ActivityPage"),
  audit: () => import("./pages/AuditPage"),
  generic: () => import("./pages/GenericModulePage"),
  "loyal-customers": () => import("./pages/LoyalCustomersPage"),
  locations: () => import("./pages/LocationsPage"),
  locationDetail: () => import("./pages/LocationDetailPage"),
  products: () => import("./pages/ProductsPage"),
  warehouse: () => import("./pages/WarehousePage"),
  "quick-sales": () => import("./pages/QuickSalesPage"),
  metrics: () => import("./pages/SalesMetricsPage"),
  socialWhatsapp: () => import("./pages/WhatsAppInboxPage"),
  marketingWhatsapp: () => import("./pages/WhatsAppCampaignsPage"),
  marketingMetaAds: () => import("./pages/MetaAdsHubPage"),
  settings: () => import("./pages/SettingsPage"),
};

export function preloadManagementRoute(routeId) {
  const loader = managementPageLoaders[routeId] || managementPageLoaders.generic;
  loader?.().catch(() => {});
  if (routeId === "locations") managementPageLoaders.locationDetail().catch(() => {});
  if (routeId === "social") managementPageLoaders.socialWhatsapp().catch(() => {});
  if (routeId === "marketing") {
    managementPageLoaders.marketingWhatsapp().catch(() => {});
    managementPageLoaders.marketingMetaAds().catch(() => {});
  }
}
