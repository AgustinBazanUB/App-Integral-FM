# Code Map — FM Product System

Este documento no reemplaza la arquitectura real del repositorio. Su función es permitir que desde Figma/FigJam se pueda llegar rápidamente al código responsable.

## Router y shell

- `src/gestion/ManagementApp.jsx`
  - router principal del panel de gestión;
  - decide páginas especializadas vs `GenericModulePage`;
  - monta `WhatsAppExtensionSync`.
- `src/gestion/ManagementShell.jsx`
  - shell visual y navegación.
- `src/gestion/modules.js`
  - registro de módulos, nombres, orden y rutas.
- `src/gestion/permissions.js`
  - visibilidad y permisos.

## Panel General

- UI: `src/gestion/pages/DashboardPage.jsx`
- Servicios: `src/gestion/services/dashboardService.js`
- Recursos compartidos: `src/gestion/services/sharedResources.js`
- Dominio de métricas/tiempo: `src/modules/locations/domain/`

## FM-MOD-01 — Ubicaciones

- UI principal: `src/gestion/pages/LocationsPage.jsx`
- Detalle: `src/gestion/pages/LocationDetailPage.jsx`
- Servicios de gestión: `src/gestion/services/locationManagementService.js`
- Inventario: `src/gestion/services/inventoryService.js`
- Dominio: `src/modules/locations/domain/`

## FM-MOD-02 — Productos

- UI: `src/gestion/pages/ProductsPage.jsx`
- Formulario: `src/gestion/components/ProductForm.jsx`
- Servicios: `src/gestion/services/inventoryService.js`

## FM-MOD-03 — Ventas rápidas

- UI: `src/gestion/pages/QuickSalesPage.jsx`
- Creación de venta: `src/gestion/services/managementService.js`
- Inventario: `src/gestion/services/inventoryService.js`
- Descuentos/pagos: `src/modules/locations/domain/`

## FM-MOD-04 — Clientes

- UI: `src/gestion/pages/LoyalCustomersPage.jsx`
- Dominio: `src/gestion/customers/customerDomain.js`
- Importación: `src/gestion/customers/CustomerImportModal.jsx`
- Servicio CRM: `src/gestion/services/customerService.js`

## FM-MOD-05 — Métricas

- UI: `src/gestion/pages/SalesMetricsPage.jsx`
- Filtros: `src/gestion/components/MetricsFiltersPanel.jsx`
- Visuales: `src/gestion/components/MetricsVisuals.jsx`
- Dominio: `src/modules/locations/domain/metrics.js`
- Lectura de ventas: `src/gestion/services/dashboardService.js`

## FM-MOD-07 — Depósitos

- UI: `src/gestion/pages/WarehousePage.jsx`
- Servicio: `src/gestion/services/inventoryService.js`
- Dominio: `src/modules/inventory/domain/inventory.js`

## Módulos genéricos

- UI compartida: `src/gestion/pages/GenericModulePage.jsx`
- Servicio base: `src/gestion/services/managementService.js`

Actualmente esta base es usada por módulos que todavía no tienen experiencia especializada completa, entre ellos Finanzas, Envíos, Alertas, Proveedores y partes de Redes/Ecommerce/Marketing según el router vigente.

## FM-MOD-10-WA — Marketing / WhatsApp

- UI: `src/gestion/pages/WhatsAppCampaignsPage.jsx`
- Dominio: `src/gestion/marketing/whatsapp/campaignDomain.js`
- Campañas: `src/gestion/marketing/whatsapp/campaignService.js`
- Bridge: `src/gestion/marketing/whatsapp/extensionBridge.js`
- Reconciliación: `src/gestion/marketing/whatsapp/campaignReconciliation.js`
- Sync global: `src/gestion/marketing/whatsapp/WhatsAppExtensionSync.jsx`
- Contrato documentado: `docs/whatsapp-extension-contract.md`

Repositorio de extensión relacionado:

`AgustinBazanUB/Flor-Mia-WhatsApp-Sender`

Capas principales del repositorio de extensión:

- `src/background/`
- `src/campaign/`
- `src/engine/`
- `src/content/`
- `src/whatsapp/`
- `src/storage/`
- `src/compatibility/`
- `src/diagnostics/`
- `src/popup/`

## FM-MOD-10-META — Meta Ads

- UI principal: `src/gestion/pages/MetaAdsPage.jsx`
- Workspace: `src/gestion/pages/MetaAdsCampaignPlanningWorkspace.jsx`
- Dominio/servicios: `src/gestion/marketing/metaAds/`
- Estilos: `src/gestion/styles/meta-ads.css`

## Regla para futuras implementaciones

Cada ficha de Figma debe terminar enlazando, cuando aplique, a:

1. UI/page.
2. Domain.
3. Service.
4. Firestore/Rules.
5. Tests.
6. Integración externa.

No mover archivos productivos únicamente para que el Code Map quede “bonito”. El mapa debe reflejar la arquitectura real; las refactorizaciones se deciden por razones técnicas separadas.