# Paso 0 — Relevamiento funcional actual de Flor Mía

**Corte auditado.** Versión de paquete `1.0.0` en `package.json`. PR [#68](https://github.com/AgustinBazanUB/App-Integral-FM/pull/68), commit [d0f122581231cdbd4046ce7b4651e90115556cbe](https://github.com/AgustinBazanUB/App-Integral-FM/commit/d0f122581231cdbd4046ce7b4651e90115556cbe). El diff directo con `056e847132e9167cfc971b6a19a0bb978d7c1e51` (`origin/main` al 26/11/2026) contiene únicamente `README.md` y archivos de documentación en `docs/`. Se verificó la igualdad de los árboles de código y configuración. El PR #67 tiene su propio árbol y sus funcionalidades quedan fuera de este corte.

**Evidencia y etiquetas.** Las rutas de archivo son relativas a la raíz de ese commit. El relevamiento combina el árbol Git, el grafo estático de imports, las rutas alcanzables, los manejadores de entrada, las operaciones del SDK/REST, las reglas de Firestore y los scripts de configuración. Se incluyen las acciones disponibles con los roles, condiciones y dependencias indicados. No se consultaron documentos de negocio ni se ejecutaron operaciones en Firebase, ARCA, pagos o mensajería.

| Etiqueta | Significado en este relevamiento |
| --- | --- |
| [FUNCIONAL] | Entrada alcanzable y lógica conectada a su fuente de datos, persistencia o salida efectiva. Una lectura, navegación o exportación local puede ser completa sin escritura. La etiqueta se refiere al código, condicionada a su entorno. |
| [SOLO UI] | Pantalla, control o presentación sin operación comercial conectada o con datos fijos/simulados. |
| [SOLO BACKEND] | Endpoint, proceso o contrato de datos sin pantalla que lo accione o código operativo sin UI propia. |
| [INCOMPLETO] | Hay una parte operativa, una dependencia ausente del artefacto, una rama bloqueada o un flujo comercial sin cierre. |
| [CÓDIGO MUERTO] | Sin camino de ejecución desde las entradas inventariadas. Cuando hay un test o script de desarrollo como único consumidor se indica expresamente. |

## 1. Frontera y Alcance Actual del Sistema (Modelo Ambiental)

**Resumen ejecutivo**

La App Web Integral FM reúne la operación física, comercial y fiscal de Flor Mía. Gestiona usuarios, ubicaciones, inventario, ventas, clientes, finanzas, envíos y actividad. También tiene herramientas de marketing, facturación ARCA y el asistente Olivia.

El E-Commerce presenta el catálogo editorial y comercial y conserva carrito y borrador de checkout en el navegador. Con las Functions de la app unificada y una ubicación configurada puede registrar un pedido pendiente de pago para retiro. El expediente fiscal y la venta web de extremo a extremo solo tienen aquí una simulación local de administrador.

El paquete independiente de la tienda es estático. El código de su interfaz pide un backend del mismo origen que la configuración de ese paquete no publica.

**Estructura física y ejecución**

| Parte | Entrada, ejecución o salida | Evidencia |
| --- | --- | --- |
| SPA React y router | `index.html` carga `src/main.jsx`. El alias `@flormia/surface` selecciona el árbol unificado, Gestión o E-Commerce según el modo de Vite. El router usa historial, parámetros de ruta y búsqueda propios. | `index.html`, `src/main.jsx`, `src/router.jsx`, `vite.config.js` |
| App unificada | `npm run dev`, `npm run build` → `dist`. `/`, `/gestion`, `/vendedor` y sus descendientes se despachan a Gestión. Se interceptan primero los accesos de envíos. Las demás rutas caen en el storefront con gate administrativo salvo flag público. | `package.json`, `src/surfaces/UnifiedSurface.jsx`, `src/App.jsx`, `src/gestion/StorePreviewGate.jsx` |
| Gestión independiente | `npm run dev:gestion`, `npm run build:gestion` → `dist/gestion`. Solo monta Gestión y los accesos de envíos. Tiene código de build propio y la configuración raíz de Netlify publica la variante unificada. | `package.json`, `.env.gestion`, `vite.config.js`, `src/surfaces/ManagementSurface.jsx`, `netlify.toml` |
| Tienda independiente | `npm run dev:ecommerce`, `npm run build:ecommerce` → `dist/ecommerce`. Monta storefront público desde `/`. El paquete ejecuta además `deploy/ecommerce/prepare-preview.mjs`, retira el sitemap y bloquea indexación. | `package.json`, `.env.ecommerce`, `vite.config.js`, `src/surfaces/EcommerceSurface.jsx`, `deploy/ecommerce/netlify.toml`, `deploy/ecommerce/prepare-preview.mjs` |
| Backend | El directorio de Functions de la app unificada contiene los handlers HTTP, jobs y bibliotecas bajo `_lib`. El directorio de Functions configurado para la tienda separada contiene solo `.gitkeep`. | `netlify.toml`, `netlify/functions/`, `deploy/ecommerce/netlify.toml`, `deploy/ecommerce/functions/.gitkeep` |
| Datos y seguridad | SDK Firebase para perfiles y operación directa. REST y cuenta de servicio en endpoints privilegiados. Las configuraciones `firebase.json` y `firebase.staging.json` referencian reglas e índices. El código de preview exige identidad web de pruebas y verifica el proyecto de servidor. | `.firebaserc`, `firebase.json`, `firebase.staging.json`, `firestore.rules`, `firestore.indexes.json`, `firestore.indexes.staging.json`, `scripts/validate-preview-firebase.mjs`, `netlify/functions/preview-firebase-status.mjs` |
| Validación y artefactos | `npm run build:surfaces` arma los dos builds. `npm run preview` sirve el build local. `npm test` corre los tests de Node. `test:rules`, `test:ecommerce`, `test:olivia:rules`, `test:shipping` y `test:shipping:ui` tienen alcances concretos. El manifiesto web, service worker y archivos estáticos viven en `public/`. | `package.json`, `tests/`, `.github/workflows/ci.yml`, `.github/workflows/arca-ci.yml`, `public/service-worker.js` |

**Elementos compartidos**

| Elemento | Uso en Gestión | Uso en E-Commerce | Evidencia |
| --- | --- | --- | --- |
| Montaje, tema, estado y rutas | El shell privado consume el router y estilos. | Header, páginas y carrito consumen el mismo router, assets y estilos de entrada. | `src/main.jsx`, `src/router.jsx`, `src/App.jsx`, `src/surfaces/UnifiedSurface.jsx` |
| Catálogo y stock | Edita el maestro y administra stock por ubicación/depósito. | El backend lee el maestro y el stock de **una ubicación**. Cruza el resultado con imágenes, atributos y textos estáticos mediante ID o slug. | `src/gestion/services/inventoryService.js`, `netlify/functions/_lib/ecommerce/commerceService.mjs`, `src/context/CommerceCatalogContext.jsx`, `src/data/products.js` |
| Identidad | Email/contraseña, perfil activo y permisos. | El storefront público tiene flujo de invitado. El storefront unificado privado exige `normalizedRole(profile) === "admin"`. La simulación usa token Firebase de administrador. | `src/gestion/services/firebase.js`, `src/gestion/AuthContext.jsx`, `src/gestion/StorePreviewGate.jsx`, `src/services/ecommerceService.js`, `netlify/functions/ecommerce-simulated-payment.mjs` |
| Pedidos, pagos y ventas | Consulta pedidos registrados y ventas en métricas/finanzas. | Checkout escribe pedido y pago pendiente por Function. Una aprobación simulada local vincula venta, stock, movimiento, cliente y borrador fiscal. | `src/gestion/pages/GenericModulePage.jsx`, `src/gestion/pages/FinancePage.jsx`, `netlify/functions/_lib/ecommerce/commerceService.mjs`, `netlify/functions/_lib/ecommerce/paymentService.mjs`, `netlify/functions/_lib/ecommerce/fiscalService.mjs` |
| Envíos | Operación logística desde venta con envío, con portales de preparador, repartidor y seguimiento. | El checkout de este corte bloquea domicilio. El storefront separado no aloja los portales logísticos. | `src/pages/CheckoutPage.jsx`, `src/surfaces/ManagementSurface.jsx`, `src/surfaces/EcommerceSurface.jsx`, `netlify/functions/shipping.mjs` |
| Recursos y caché | Manifiesto de Gestión/unificado y shell precacheado. | Manifiesto propio en modo E-Commerce, assets editoriales y caché por superficie. | `vite.config.js`, `public/manifest.gestion.webmanifest`, `public/manifest.ecommerce.webmanifest`, `public/manifest.webmanifest`, `public/service-worker.js` |

## 2. Actores, Roles y Permisos Reales

**Cómo se decide el acceso.** El login exige cuenta de Firebase Auth y `users/{uid}` activo. El perfil aporta rol, `allowedLocationIds`, `permissions`, `permissionAllow` y `permissionDeny`. La aplicación toma el mapa explícito del módulo o la plantilla, agrega concesiones y aplica denegaciones. `admin` como acción concede acceso a las acciones del módulo. El menú usa ese resultado. Firestore evalúa sus propias guardas, los endpoints revalidan sesión/rol y algunas operaciones limitan el alcance por lugar, propiedad, asignación o estado. Una opción presente en la plantilla no prueba que haya una pantalla o escritura en ese módulo. Evidencia común en `src/gestion/AuthContext.jsx`, `src/gestion/permissions.js`, `firestore.rules`, `netlify/functions/_lib/firebaseAuth.mjs`.

| Actor o rol exacto | Superficie | Acceso | Capacidades y restricciones del código | Evidencia específica |
| --- | --- | --- | --- | --- |
| `admin` | Gestión y vista de tienda | Cuenta y perfil activo. Normalización acepta `administrator`, `administrador`, `isAdmin`, `canAccessAdmin` o `roles` con admin. | Acciones de todos los módulos, administración de cuentas, auditoría, configuración protegida, vista unificada del storefront y operaciones fiscales con guardas adicionales. La simulación de pago exige también modo local habilitado. | `src/gestion/permissions.js`, `src/gestion/services/managementService.js`, `src/gestion/StorePreviewGate.jsx`, `netlify/functions/ecommerce-simulated-payment.mjs` |
| `general_admin` (`administrador_general`) | Gestión | Cuenta y perfil activo. | Plantilla integral, Administración/Auditoría y endpoints con `requireFirebaseAdmin`. Alta, activación y baja desde el servicio de usuarios comprueban específicamente rol normalizado `admin`. El gate del storefront también. | `src/gestion/permissions.js`, `src/gestion/services/managementService.js`, `src/gestion/StorePreviewGate.jsx`, `netlify/functions/_lib/firebaseAuth.mjs` |
| `operational_admin` (`administrador_operativo`) | Gestión y Vendedor | Cuenta activa y alcance operativo. | Consulta y acciones operativas en módulos. Todas las ubicaciones en la plantilla de Ubicaciones, configuración/carga/ajuste local, asignación de descuentos, transferencias de depósito, POS y WhatsApp. Finanzas queda en lectura en la plantilla. Los permisos especiales de Meta Ads y administración de usuarios requieren guardas propias. | `src/gestion/permissions.js`, `firestore.rules` |
| `seller` | Panel Vendedor | Cuenta activa. Redirección de vendedor puro a `/vendedor`. | Venta y consulta propia, descuentos permitidos, pagos combinados, pendientes offline, teclado y solicitud fiscal. Solo ubicaciones activas permitidas o asignadas. La edición y anulación tienen restricciones de pertenencia y estado. La identificación de cliente se acota a la operación y búsqueda puntual. | `src/gestion/ManagementApp.jsx`, `src/gestion/permissions.js`, `src/gestion/services/sellerService.js`, `firestore.rules` |
| `location_manager` (`encargado_ubicacion`) | Gestión y Vendedor | Cuenta activa, asignación/alcance. | Opera Ubicaciones, inventario local y ventas según ámbito. Ve Métricas y puede ver/editar Alertas según plantilla y operación implementada. | `src/gestion/permissions.js`, `src/gestion/services/locationManagementService.js`, `firestore.rules` |
| `warehouse_manager` (`responsable_deposito`) | Gestión | Cuenta activa. | Ve ubicaciones, opera Depósitos/transferencias, Proveedores y Alertas según guardas. | `src/gestion/permissions.js`, `src/gestion/services/inventoryService.js`, `firestore.rules` |
| `marketing_manager` (`responsable_marketing`) | Gestión | Cuenta activa. | Consulta Clientes y Métricas, opera Redes, Marketing, WhatsApp y Meta Ads conforme a guardas. Gestionar la conexión Drive exige permiso específico `metaAdsManageDrive`, ausente de su plantilla. | `src/gestion/permissions.js`, `netlify/functions/_lib/firebaseAuth.mjs`, `netlify/functions/google-drive.mjs`, `firestore.rules` |
| `ecommerce_manager` (`responsable_ecommerce`) | Gestión | Cuenta activa. | Ve pedidos web, puede operar Envíos según la guarda requerida y ver Clientes/Métricas. Las reglas deniegan escritura directa sobre pedidos y pagos. | `src/gestion/permissions.js`, `src/gestion/pages/GenericModulePage.jsx`, `netlify/functions/_lib/shipping.mjs`, `firestore.rules` |
| `shipping_manager` (`responsable_envios`) | Gestión y portales de Envíos | Cuenta activa y permisos de envío. | Consulta y maneja preparación, cambios autorizados, accesos, incidentes y alertas de envíos según el estado. No adquiere permisos de venta por esta plantilla. | `src/gestion/permissions.js`, `src/gestion/pages/ShippingPage.jsx`, `netlify/functions/_lib/shipping.mjs` |
| `supplier_manager` (`responsable_proveedores`) | Gestión | Cuenta activa. | Plantilla de proveedores, inventario de depósito y transferencias, con lectura de Finanzas. La pantalla de Proveedores implementa alta y consulta básicas. | `src/gestion/permissions.js`, `src/gestion/pages/GenericModulePage.jsx`, `firestore.rules` |
| `financial_manager` (`responsable_financiero`) | Gestión | Cuenta activa. | Finanzas y Métricas con acciones financieras. Lectura fiscal sujeta a relación con la venta, permiso y endpoint. Autorización fiscal administrativa tiene guardas distintas. | `src/gestion/permissions.js`, `src/gestion/finance/financeService.js`, `netlify/functions/arca-document.mjs`, `netlify/functions/arca-authorize.mjs` |
| `analyst` (`analista_metricas`) | Gestión | Cuenta activa. | Métricas con `view`, `export` y `viewFinancial` en plantilla. Se verificaron lectura y filtros. La plantilla por sí sola no implementa exportación. | `src/gestion/permissions.js`, `src/gestion/pages/SalesMetricsPage.jsx`, `firestore.rules` |
| Preparador (`internal`, `assignedPreparerIds`) | Gestión / QR de Envíos | Firebase Auth y cuenta activa incluida en la asignación. | Consulta datos permitidos del envío, confirma preparado o reporta impedimento. El vínculo QR por sí solo no reemplaza la asignación. | `src/gestion/shipping/ShippingPublicApp.jsx`, `src/gestion/shipping/ShippingTasks.jsx`, `netlify/functions/_lib/shipping.mjs` |
| Repartidor externo (`courier`) | Portal de Envíos | Acceso temporal por QR/token, limitado a envío/tramo o sesión de ruta. | Lee la proyección necesaria y confirma el evento permitido del tramo o reporta incidencia. Caducidad, revocación y estado limitan acciones. | `src/gestion/shipping/CourierPortal.jsx`, `src/shared/shippingDomain.mjs`, `netlify/functions/_lib/shipping.mjs` |
| Cliente de envío (`tracking`) | Portal de Envíos | Token del enlace en fragmento. | Consulta estados confirmados con una proyección pública reducida. El portal no modifica el pedido. | `src/gestion/shipping/ShippingPublicApp.jsx`, `src/shared/shippingDomain.mjs`, `netlify/functions/_lib/shipping.mjs` |
| Visitante/comprador invitado | E-Commerce | Navegador sin cuenta en el build público. Las dos Functions comerciales aceptan solicitudes sin sesión. | Consulta catálogo, arma carrito y, cuando existe el backend y se habilita el retiro, registra pedido pendiente. No hay perfil de comprador ni panel de pedidos. | `src/Storefront.jsx`, `src/pages/CheckoutPage.jsx`, `netlify/functions/ecommerce-catalog.mjs`, `netlify/functions/ecommerce-checkout.mjs` |
| Usuario de Olivia | Gestión / Vendedor / backend | Sesión activa. Administración, `seller` con permiso de venta o perfil con `ai.view`. Cada herramienta comprueba su capacidad. | Consulta/guía dentro del alcance, conserva chats, solicita cuota y confirma mutaciones autorizadas. Límites de cuota, adjuntos y contexto se aplican en servidor. | `src/gestion/olivia/OliviaMount.jsx`, `netlify/functions/_lib/olivia/guards.mjs`, `netlify/functions/_lib/olivia/engine.mjs` |
| Emisor externo WhatsApp | Sesión de Gestión / extensión | Puente `window.postMessage` con origen y protocolo validados. El operador requiere permisos de WhatsApp. | La extensión recibe un lote preparado y devuelve estado/eventos/controles. Los clientes de Firestore tienen validación de campos y transiciones. | `src/gestion/marketing/whatsapp/extensionBridge.js`, `src/gestion/marketing/whatsapp/WhatsAppExtensionSync.jsx`, `firestore.rules` |
| Cuenta de servicio Firebase | Backend | Credencial de servidor validada contra el proyecto efectivo. | Lee y escribe lo que cada handler autoriza. Las colecciones fiscales, comerciales y logísticas protegidas tienen operaciones de servidor y guardas separadas del SDK cliente. | `netlify/functions/_lib/firebaseProject.mjs`, `netlify/functions/_lib/serverFirestore.mjs`, `netlify/functions/_lib/firestoreAdminRest.mjs` |
| Titular de Google Drive / callback OAuth | Gestión y backend | Operador con `metaAdsManageDrive` y consentimiento de Google. Callback valida estado antes de intercambiar código. | Conecta/desconecta Drive, prueba conexión. El workspace usa carpetas y carga reanudable autorizada. | `src/gestion/pages/SettingsPage.jsx`, `netlify/functions/google-drive-callback.mjs`, `netlify/functions/google-drive.mjs` |
| `olivia-chat-background` | Backend | Despacho interno de la Function principal con sesión del propietario del job. | Ejecuta chat diferido y persiste resultado/error. El cliente consulta estado o pide cancelación. | `netlify/functions/olivia.mjs`, `netlify/functions/olivia-chat-background.mjs`, `netlify/functions/_lib/olivia/chatJobs.mjs` |
| `olivia-voice-meter-background` | Backend | Handler registrado. Responde con modo de voz retirado. | [INCOMPLETO] Conserva la ruta histórica, sin medidor GPT-Live en servicio en este corte. | `netlify/functions/olivia-voice-meter-background.mjs` |
| `shipping-retention` | Backend automático | Programación horaria de Netlify y cuenta de servicio. | Limpia campos de última ubicación vencida de envíos anteriores. | `netlify/functions/shipping-retention.mjs`, `netlify/functions/_lib/shippingRetention.mjs` |
| `olivia-retention` | Backend automático | Programación horaria y permisos de servidor. | Depura lotes, aplica vigencia configurada a conversaciones/registros y conserva los anclajes de consumo que define el proceso. | `netlify/functions/olivia-retention.mjs`, `netlify/functions/_lib/olivia/store.mjs` |
| `olivia-resource-retention` | Backend automático | Programación diaria y permisos del proveedor. | Retira adjuntos/recursos externos elegibles y registra estado de limpieza pendiente si falla. | `netlify/functions/olivia-resource-retention.mjs` |
| `olivia-voice-cleanup` | Backend automático | Cron cada minuto y credenciales de servidor. | Cierra sesiones vencidas de transcripción y del modo histórico. Registra consumo o estimación según el caso. | `netlify/functions/olivia-voice-cleanup.mjs`, `netlify/functions/_lib/olivia/voice.mjs` |
| Sincronización del vendedor | Navegador / Gestión | Sesión activa y recuperación de red o acción del operador. | Reintenta ventas pendientes del mismo usuario desde IndexedDB y registra éxito/error. | `src/gestion/seller/SellerPanel.jsx`, `src/gestion/seller/offlineSales.js`, `src/gestion/services/sellerService.js` |
| Service worker | Navegador / ambas superficies | Registro al cargar el build de producción. | Instala/renueva caché local y responde a navegación sin red con el shell. | `src/main.jsx`, `public/service-worker.js` |
| Workflows y operadores de scripts | Backend técnico | Push/PR/dispatch configurados en GitHub. Scripts manuales requieren credenciales y parámetros propios. | CI valida cambios. El workflow Firebase despliega reglas/índices en `main` con sus guardas. Migración/clonado y generación de assets son CLI de mantenimiento. | `.github/workflows/ci.yml`, `.github/workflows/arca-ci.yml`, `.github/workflows/deploy-firestore.yml`, `scripts/clone-firestore.mjs`, `scripts/migrate-legacy-data.mjs` |


## 3. Catálogo Exhaustivo de Capacidades — App Web Integral FM (Foco Profundo)

Las tablas cuentan patrones de ruta o redirección. Los paneles, pestañas, modales y parámetros de consulta se describen en su ruta anfitriona. `src/gestion/ManagementApp.jsx` y `src/gestion/routePreload.js` enlazan menús y pantallas. El cargador y la pantalla sin autorización se muestran dentro de la URL solicitada.

### 3.1 Acceso, sesión y navegación — [FUNCIONAL]

Identifica al operador y lo dirige al panel que corresponde a su perfil.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/` en unificado o modo Gestión | Login si falta sesión. Con sesión, Panel general o redirección al Vendedor puro. | `src/App.jsx`, `src/gestion/ManagementApp.jsx`, `src/gestion/pages/LoginPage.jsx` |

1. [FUNCIONAL] Ingresar con email y contraseña, mostrar/ocultar la clave y conservar la sesión local de Firebase. El contexto consulta el perfil y muestra error o bloqueo cuando falla la validación. `src/gestion/pages/LoginPage.jsx`, `src/gestion/AuthContext.jsx`, `src/gestion/services/firebase.js`.
2. [FUNCIONAL] Elegir módulo en el menú según rol, alternar Panel Vendedor/Administrador cuando hay acceso, cerrar sesión y limpiar caché de recursos. Carga diferida y precarga oportunista de módulos. El límite de error permite volver al panel o recargar. `src/gestion/ManagementShell.jsx`, `src/gestion/ManagementApp.jsx`, `src/gestion/routePreload.js`, `src/gestion/seller/SellerPanel.jsx`.
3. [FUNCIONAL] Ver conexión y recibir el shell PWA desde caché si falla una navegación. `src/gestion/components/ConnectionIndicator.jsx`, `src/gestion/connection.js`, `src/main.jsx`, `public/service-worker.js`.

**Datos y guardas.** Firebase Authentication, `users/{uid}`, preferencia local de panel y cachés del navegador. Las rutas reconocidas necesitan permisos y las reglas independizan lectura de escritura. La recuperación de contraseña pública carece de entrada de usuario en el login de este corte. `src/gestion/permissions.js`, `src/gestion/services/managementService.js`, `firestore.rules`.

### 3.2 Panel general — [FUNCIONAL]

Muestra el pulso comercial por fecha y ubicación y ofrece acceso al trabajo operativo.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/gestion` | Indicadores, ritmo de ventas, formas de pago, alertas, accesos permitidos y atajo de carga de stock. | `src/gestion/pages/DashboardPage.jsx` |

1. [FUNCIONAL] Seleccionar día, semana, mes o año y ubicaciones, actualizar ventas, unidades, ticket, evolución por hora/día o período, distribución de cobros, productos y vendedores destacados y stock restante autorizado. `src/gestion/components/DashboardFilters.jsx`, `src/gestion/components/DashboardPayments.jsx`, `src/modules/locations/domain/dashboard.js`, `src/modules/locations/domain/time.js`.
2. [FUNCIONAL] Ver y abrir alertas y módulos habilitados. Lanzar carga de stock sobre una ubicación activa si se tiene permiso. `src/gestion/pages/DashboardPage.jsx`, `src/gestion/components/DashboardAlerts.jsx`, `src/gestion/services/alertsService.js`.
3. [FUNCIONAL] Recuperar consultas parciales o fallidas mediante reintento. Reutilizar caché en memoria, invalidada tras ventas y cambios de recursos. `src/gestion/services/dashboardService.js`, `src/gestion/services/runtimeCache.js`.

**Datos y reglas.** Lectura de `sales`, `locations` y `alerts`. Para carga de stock se delega en la pantalla de Ubicaciones. No se replica inventario en el Panel general. Ventas y fechas se interpretan en horario de Argentina. `src/gestion/pages/DashboardPage.jsx`, `src/gestion/services/dashboardService.js`, `src/modules/locations/domain/time.js`.

### 3.3 Ubicaciones e inventario local — [FUNCIONAL]

Organiza lugares de venta y eventos, sus productos, vendedores, descuentos y ventas.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/gestion/locations` | Lista de ubicaciones y eventos, disponibilidad, pines, estados y alta/edición. | `src/gestion/pages/LocationsPage.jsx` |
| `/gestion/locations/:locationId` | Detalle de ubicación, con Cargar stock como pestaña inicial. | `src/gestion/pages/LocationDetailPage.jsx` |
| `/gestion/locations/:locationId/stock` | Inventario, configuración y movimientos. | `src/gestion/pages/LocationDetailPage.jsx` |
| `/gestion/locations/:locationId/sellers` | Vendedores asignados y selección de usuarios disponibles. | `src/gestion/pages/LocationDetailPage.jsx` |
| `/gestion/locations/:locationId/discounts` | Descuentos globales habilitables en la ubicación. | `src/gestion/pages/LocationDetailPage.jsx` |
| `/gestion/locations/:locationId/sales` | Ventas de la ubicación y detalle fiscal. | `src/gestion/pages/LocationDetailPage.jsx`, `src/gestion/components/LocationSalesPanel.jsx` |

1. [FUNCIONAL] Crear ubicación o evento con tipo, prefijo y reglas temporales. Editar, pausar/activar, dar de baja y restaurar. Buscar y filtrar ubicaciones. Fijar hasta cuatro visibles en el perfil. `src/gestion/pages/LocationsPage.jsx`, `src/gestion/services/locationManagementService.js`, `src/gestion/services/locationEnhancementsService.js`, `src/modules/locations/domain/locations.js`.
2. [FUNCIONAL] Consultar inventario por categoría/búsqueda y estado. Asociar un producto existente al inventario y definir stock inicial, precio maestro o especial, disponibilidad y parámetros locales. La creación de maestros usa Productos o la herramienta asistida de carga. `src/gestion/pages/LocationDetailPage.jsx`, `src/gestion/services/inventoryService.js`, `src/gestion/pages/ProductsPage.jsx`, `netlify/functions/_lib/olivia/catalogStock.mjs`.
3. [FUNCIONAL] Ingresar unidades, ajustar con motivo, transferir entre orígenes válidos y revisar movimientos paginados. Registra operación, unidades previas/posteriores y auditoría. `src/gestion/components/InventoryAdjustmentModal.jsx`, `src/gestion/components/InventoryTransferModal.jsx`, `src/gestion/services/inventoryService.js`, `src/shared/stockTransferWritePlans.mjs`.
4. [FUNCIONAL] Asignar y quitar vendedores existentes y habilitar descuentos globales activos para la ubicación. Guarda las relaciones en perfiles y/o ubicación. La UI de descuentos selecciona promociones. Su alta global no aparece en este panel. `src/gestion/pages/LocationDetailPage.jsx`, `src/gestion/services/locationManagementService.js`, `src/gestion/services/locationEnhancementsService.js`.
5. [FUNCIONAL] Filtrar ventas de la ubicación, cargar más, abrir detalle de productos, cobro, cliente y estado fiscal. Enviar a anulación con motivo y previsualización cuando se permite. Descargar/imprimir comprobante o enviarlo por email si cumple la guarda fiscal. `src/gestion/components/LocationSalesPanel.jsx`, `src/gestion/services/locationSalesService.js`, `src/gestion/services/arcaService.js`, `netlify/functions/sale-cancel.mjs`.

**Datos, servidor y reglas.** `locations`, `locationStock/{id}/items`, `products`, `productCategories`, `discounts`, `users`, `sales`, `stockMovements`, `stockOperations`, `inventoryOperations`, `stockTransfers`, `auditLogs` e `invoices` a través del servicio fiscal. Las ubicaciones borradas lógicamente, pausadas o fuera de calendario se excluyen de la selección de venta. Se comprueba el permiso específico para ajuste, carga, transferencia, asignación y baja. Quedan rutas de mutación antiguas coexistiendo con el servicio de inventario. El código compartido las distingue. `src/gestion/services/locationManagementService.js`, `src/gestion/services/inventoryService.js`, `src/shared/operationalWritePlans.mjs`, `firestore.rules`.

### 3.4 Productos y catálogo maestro — [FUNCIONAL]

Centraliza los productos y organiza categorías/subcategorías para los inventarios.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/gestion/products` | Catálogo maestro, filtros, alta/edición, diálogo de subcategorías y unificación. | `src/gestion/pages/ProductsPage.jsx` |

1. [FUNCIONAL] Listar, buscar y explorar productos por agrupación/estado. Crear o editar nombre, abreviatura, características del maestro, categoría/subcategoría, precio base, estado, datos de IVA e imágenes conforme al formulario y permiso. `src/gestion/pages/ProductsPage.jsx`, `src/gestion/components/ProductForm.jsx`, `src/gestion/services/inventoryService.js`, `src/shared/productWritePlans.mjs`.
2. [FUNCIONAL] Crear subcategorías y organizar el catálogo existente usando las asignaciones del dominio compartido. `src/gestion/components/SubcategoriesDialog.jsx`, `src/gestion/services/catalogOrganizationService.js`, `src/shared/productSubcategories.mjs`.
3. [FUNCIONAL] Previsualizar la unificación de dos productos y confirmar la operación administrativa. Consolida referencias de inventario permitidas, marca el producto origen según el plan y deja auditoría. Verifica que la vista previa siga siendo válida antes de aplicar. Conserva los snapshots históricos de ventas. `src/gestion/components/ProductMergeDialog.jsx`, `netlify/functions/catalog-merge.mjs`, `netlify/functions/_lib/catalogMerge.mjs`.

**Datos y límites.** `products`, `productCategories`, inventarios de ubicaciones/depósitos, `stockMovements` y `auditLogs`. Las imágenes seleccionables se apoyan en assets de `public/images/` y los mapeos de `src/shared/productImages.mjs` y `src/data/productImages.js`. El catálogo web no posee aquí un editor separado de publicación por ficha. `src/gestion/services/inventoryService.js`, `netlify/functions/_lib/ecommerce/commerceService.mjs`.

### 3.5 Depósitos y transferencias — [FUNCIONAL]

Administra mercadería almacenada y traslados trazables a otras ubicaciones.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/gestion/warehouse` | Listado de depósitos, alta, acceso a detalle y transferencia. | `src/gestion/pages/WarehousePage.jsx` |
| `/gestion/warehouse/:warehouseId` | Productos del depósito, unidades, ingresos, ajustes, transferencias y movimientos. | `src/gestion/pages/WarehousePage.jsx` |

1. [FUNCIONAL] Crear depósito y abrir inventario. Asociar un producto maestro con stock inicial, sumar unidades, ajustar con motivo y consultar historial de movimientos paginado. `src/gestion/pages/WarehousePage.jsx`, `src/gestion/services/inventoryService.js`.
2. [FUNCIONAL] Transferir líneas con cantidad y origen/destino permitidos. Puede registrar nombre de transportista. Une débito/crédito y movimientos en una transacción bajo un ID de operación. Valida cantidad, saldo y compatibilidad. `src/gestion/components/InventoryTransferModal.jsx`, `src/shared/stockTransferWritePlans.mjs`, `src/gestion/services/inventoryService.js`.
3. [FUNCIONAL] Consultar saldo consolidado donde el actor tiene permisos, y usar depósitos autorizados como origen en Venta Rápida. `src/gestion/services/remainingStockService.js`, `src/gestion/pages/QuickSalesPage.jsx`, `src/gestion/services/quickSaleStockService.js`.

**Datos y reglas.** `warehouses`, `warehouseStock/{id}/items`, `locations`, `locationStock/{id}/items`, `products`, `stockTransfers`, `inventoryOperations`, `stockMovements`, `auditLogs`. Ajuste o transferencia común valida saldo. El saldo negativo de una venta administrativa tiene una guarda de excepción específica y vínculo a su venta/movimiento. El alta de depósito no se acompaña de una pantalla dedicada de edición/baja en esta ruta. `src/modules/inventory/domain/inventory.js`, `src/gestion/services/inventoryService.js`, `firestore.rules`.

### 3.6 Venta Rápida — [FUNCIONAL]

Registra ventas asistidas fuera del POS habitual y relaciona canal comercial con origen físico.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/gestion/quick-sales` | POS administrativo con apertura de canal/origen, catálogo, carrito, pagos, cliente, factura y envío. | `src/gestion/pages/QuickSalesPage.jsx` |

1. [FUNCIONAL] Seleccionar canal WhatsApp, Instagram, llamada o contacto personal, y origen ubicación/depósito. Ver stock global agrupado en catálogo y saldo del origen elegido. Cambiar origen puede vaciar el carrito. `src/gestion/pages/QuickSalesPage.jsx`, `src/modules/locations/domain/channels.js`, `src/gestion/services/quickSaleStockService.js`.
2. [FUNCIONAL] Buscar/agregar/quitar productos y ajustar cantidad/precio, aplicar descuentos permitidos, marcar bonificación por línea y elegir pagos simples o combinados. Para una bonificación total habilitada se guarda `paymentMethod: "none"`. Los pagos combinados requieren partes positivas y suma exacta. El redondeo operativo de efectivo se calcula en dominio. `src/gestion/pages/QuickSalesPage.jsx`, `src/modules/locations/domain/discounts.js`, `src/modules/locations/domain/payments.js`, `src/gestion/services/sellerService.js`.
3. [FUNCIONAL] Revisar todos los faltantes y confirmar expresamente el saldo resultante. El servicio recalcula inventario en transacción y verifica que el alcance del faltante confirmado siga coincidiendo. Una operación aceptada puede dejar saldo negativo con marca y rastro vinculados. La interfaz no convierte stock global en un despacho multiorigen. `src/modules/locations/domain/saleStock.js`, `src/gestion/services/sellerService.js`, `src/shared/operationalWritePlans.mjs`, `firestore.rules`.
4. [FUNCIONAL] Identificar cliente, adjuntar factura o elegir envío. Persistir venta con código, origen, cobros y movimientos. La solicitud fiscal comparte el flujo de comprobantes. Con envío, despacha por la Function de Envíos que valida dirección, preparadores y modalidad. `src/gestion/seller/CustomerDialog.jsx`, `src/gestion/pages/QuickSalesPage.jsx`, `netlify/functions/shipping.mjs`, `src/gestion/services/arcaService.js`.
5. [FUNCIONAL] Recuperar una confirmación con intenciones e IDs estables para evitar duplicar la venta después de una respuesta incierta. `src/gestion/seller/quickSaleIntent.js`, `src/gestion/services/sellerService.js`, `src/gestion/services/shippingService.js`.

**Datos y fricción.** `sales`, `counters`, stock local/depósito, `stockMovements`, `customers`, `auditLogs`, `shipments`, `invoices` y `sessionStorage` de intención. Los canales son constantes. Queda sin pantalla la administración de ese catálogo de canales. Las variantes directa y con envío se validan en sus respectivos servicios. `src/modules/locations/domain/channels.js`, `src/gestion/services/sellerService.js`, `netlify/functions/_lib/shipping.mjs`.

### 3.7 Panel Vendedor — [FUNCIONAL]

Atiende el punto de venta con alcance de ubicación, ventas propias y trabajo pendiente sin red.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/vendedor` y descendientes | `view` cambia entre `sale`, `sales`, `pending`, `stock`, `prices` y `shipping-tasks`. `shipment` abre el detalle ligado cuando corresponde. | `src/gestion/ManagementApp.jsx`, `src/gestion/seller/SellerPanel.jsx`, `src/gestion/seller/sellerDomain.js`, `src/gestion/shipping/ShippingTasks.jsx` |

1. [FUNCIONAL] Elegir ubicación válida y recordar selección. Suscribirse a stock de ese origen, explorar categorías, buscar productos, usar teclado cuando se permite, ajustar carrito y consultar precios/saldo. `src/gestion/seller/SellerPanel.jsx`, `src/gestion/seller/SellerCatalogList.jsx`, `src/gestion/seller/catalogSearch.mjs`, `src/gestion/seller/hooks.js`.
2. [FUNCIONAL] Asociar cliente por teléfono, agregar datos opcionales y zona, aplicar descuentos habilitados/manuales, cobrar por un medio o por partes y registrar total cero si la bonificación pasa las guardas. Los envíos requieren conexión e identificación de cliente. `src/gestion/seller/CustomerDialog.jsx`, `src/gestion/seller/DiscountDialog.jsx`, `src/gestion/seller/sellerValidation.js`, `src/gestion/services/sellerService.js`, `src/gestion/services/shippingService.js`.
3. [FUNCIONAL] Registrar una venta y ver comprobante interno. Opcionalmente preparar/requerir factura con receptor fiscal y mostrar su estado/imprimir si está autorizada. Las ventas con envío del Vendedor se registran como solicitud para Gestión. `src/gestion/seller/SellerPanel.jsx`, `src/gestion/services/sellerService.js`, `netlify/functions/_lib/shipping.mjs`, `netlify/functions/arca-invoice.mjs`.
4. [FUNCIONAL] Guardar venta pendiente sin conexión en IndexedDB, reflejar unidades pendientes localmente, reintentar sincronización manual o al recuperar conexión, mostrar errores y descartar una pendiente local. El identificador offline hace repetible la sincronización. `src/gestion/seller/offlineSales.js`, `src/gestion/seller/SellerPanel.jsx`, `src/gestion/services/sellerService.js`.
5. [FUNCIONAL] Consultar ventas propias del día y su desglose por medio. Abrir detalle, cambiar los datos permitidos o anular con motivo. La corrección actualiza diferencias de stock y auditoría. Una venta con restricciones fiscales/logísticas sigue su circuito de regularización. `src/gestion/seller/SellerPanel.jsx`, `src/gestion/services/sellerService.js`, `netlify/functions/sale-cancel.mjs`.

**Datos y reglas.** `locations`, `locationStock/{locationId}/items`, `products`, `productCategories`, `discounts`, `sales`, `counters`, `stockMovements`, `customers`, `customerZones`, `auditLogs`, `shipments` e `invoices` por servidor. Una venta pendiente no es todavía una venta en Firestore. Sesión y permiso de cancelar/editar se reevalúan al intentar confirmarla. `src/gestion/permissions.js`, `src/gestion/services/sellerService.js`, `src/gestion/seller/offlineSales.js`, `firestore.rules`.

### 3.8 Clientes, zonas y fidelización — [FUNCIONAL]

Conserva la identidad comercial de clientes y su relación con compras.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/gestion/loyal-customers` | Registro, detalle y compras, configuración de zonas y regla de fidelización para roles autorizados. | `src/gestion/pages/LoyalCustomersPage.jsx`, `src/gestion/customers/CustomerInsights.jsx` |

1. [FUNCIONAL] Buscar clientes por datos normalizados y consultar teléfono exacto en la base, paginar y abrir ficha. Crear o editar, enriquecer datos sin duplicar clientes por teléfono normalizado y mostrar acceso de WhatsApp. `src/gestion/pages/LoyalCustomersPage.jsx`, `src/gestion/services/customerService.js`, `src/gestion/customers/customerDomain.js`.
2. [FUNCIONAL] Importar Excel de contactos con cabeceras Teléfono, Nombre y Apellido y Zona según el contrato del importador, previsualizar filas válidas/repetidas/existentes y procesar altas o enriquecimientos. `src/gestion/customers/CustomerImportModal.jsx`, `src/gestion/customers/customerImport.js`, `src/gestion/services/customerService.js`.
3. [FUNCIONAL] Crear/editar y activar/desactivar zonas. Ofrecer su versión activa a formularios, con caché local para recuperación offline. `src/gestion/pages/LoyalCustomersPage.jsx`, `src/gestion/services/customerService.js`.
4. [FUNCIONAL] Consultar últimas compras e historial paginado y segmentar por criterios de compra, zona y fidelización. Configurar compras mínimas y ventana como administrador. Las ventas anuladas conservan historial y se excluyen del cálculo de compras válidas. `src/gestion/customers/CustomerInsights.jsx`, `src/gestion/customers/crmService.js`, `src/gestion/customers/customerPurchases.js`.
5. [SOLO BACKEND] La regla de `customers/{id}/interactions` define acceso, pero la ficha activa no ofrece CRUD de interacciones en esa subcolección. `firestore.rules`, `src/gestion/pages/LoyalCustomersPage.jsx`.

**Datos y límites.** `customers`, `customerZones`, `sales`, `products`, `settings`, `auditLogs`, caché local de zonas. El POS asocia el cliente al escribir la venta. La simulación web aprobada lo puede vincular desde backend. El consentimiento del checkout no constituye inscripción a un sistema de email marketing. `src/gestion/services/sellerService.js`, `netlify/functions/_lib/ecommerce/customerLink.mjs`, `src/pages/CheckoutPage.jsx`.

### 3.9 Métricas — [FUNCIONAL]

Consulta ventas en dimensiones que la operación realmente registra.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/gestion/metrics` | Redirección al análisis canónico. | `src/gestion/ManagementApp.jsx`, `src/gestion/modules.js` |
| `/gestion/metrics/sales` | Historial y análisis con filtros, gráficos, rankings y tablas operativas. | `src/gestion/pages/SalesMetricsPage.jsx` |

1. [FUNCIONAL] Filtrar por período, ubicación, vendedor, producto, descuento y formas de pago. Consultar evolución, distribución de cobros y agregados por categoría, producto, canal, origen físico, ubicación y vendedor. `src/gestion/components/MetricsFiltersPanel.jsx`, `src/gestion/pages/SalesMetricsPage.jsx`, `src/modules/locations/domain/metrics.js`.
2. [FUNCIONAL] Consultar rankings y descuentos configurados/manuales, combinar partes reales de pagos múltiples y aplicar granularidad hora/día/semana/mes según ventana. `src/gestion/pages/SalesMetricsPage.jsx`, `src/gestion/components/MetricsVisuals.jsx`, `src/modules/locations/domain/saleFacts.js`, `src/modules/locations/domain/metrics.js`.
3. [SOLO BACKEND] `dailySummaries` tiene esquema de permisos pero la pantalla calcula a partir de ventas. `firestore.rules`, `src/gestion/modules.js`, `src/gestion/services/dashboardService.js`.

**Datos y fricción.** `sales`, `locations`, `products`, `productCategories`, `discounts`, `users` para dimensiones autorizadas. Los snapshots antiguos sin desglose limitan el neto por producto. El permiso `export` está definido, pero el análisis activo carece de acción de descarga. El calendario de métricas operativas que aparece en el grafo huérfano se detalla en la sección 7. `src/gestion/pages/SalesMetricsPage.jsx`, `src/gestion/services/dashboardService.js`, `src/gestion/permissions.js`.

### 3.10 Finanzas — [FUNCIONAL]

Reconcilia ingresos, gastos, caja y estimaciones usando como origen económico la venta registrada.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/gestion/finance` | Resumen, Ventas e ingresos, Gastos, Caja y acreditaciones, Presupuestos y Configuración financiera autorizada. | `src/gestion/pages/FinancePage.jsx` |

1. [FUNCIONAL] Filtrar período/ubicación, ver ingresos derivados de venta y otros ingresos, gastos devengados y resultado estimado. Se incluyen canales de Vendedor, Venta Rápida y web confirmado. Las anuladas se excluyen del resultado. Emitir factura no duplica el ingreso. `src/gestion/pages/FinancePage.jsx`, `src/gestion/finance/financeDomain.js`, `src/gestion/services/dashboardService.js`.
2. [FUNCIONAL] Registrar gasto u otro ingreso con importe, categoría, naturaleza, fechas, alcance, referencias opcionales y responsable. Anular con motivo y auditoría. `src/gestion/pages/FinancePage.jsx`, `src/gestion/finance/financeService.js`.
3. [FUNCIONAL] Comparar acreditaciones esperadas por medio con evidencia de acreditación, registrar importe/fecha/referencia, evaluar alertas y resolver casos manualmente con motivo. El guardado valida la venta y el medio asociados. `src/gestion/finance/financeDomain.js`, `src/gestion/finance/financeService.js`.
4. [FUNCIONAL] Guardar presupuesto mensual por categoría/ámbito y versionar la configuración de costos/plazos por fecha de vigencia. Distingue tasa desconocida de tasa cero. `src/gestion/pages/FinancePage.jsx`, `src/gestion/finance/financeDomain.js`, `src/gestion/finance/financeService.js`.
5. [SOLO BACKEND] Reglas de `cashSessions` definen lectura y escritura administrativa. La pestaña de caja trabaja con acreditaciones y no abre/cierra sesiones de caja en esa colección. `firestore.rules`, `src/gestion/pages/FinancePage.jsx`.

**Datos y fricción.** Lee `sales`, `locations`, `financialEntries`, configuración y referencias autorizadas a `orders`, `shipments`, `invoices` y `suppliers`. Escribe `financialEntries`, `settings/financeConfig`, `alerts` y `auditLogs`. Los controles se evalúan desde la operación de la pantalla. No hay conciliación bancaria automática en el flujo. `src/gestion/finance/financeService.js`, `src/gestion/pages/FinancePage.jsx`, `firestore.rules`.

### 3.11 Facturación ARCA — [FUNCIONAL]

Vincula comprobantes electrónicos a una venta y ofrece diagnóstico, recuperación y entrega documental con permisos.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| En `/gestion/quick-sales`, `/vendedor` y Ventas de una ubicación | Receptor fiscal, generación, estado, detalle, impresión/descarga y anulación según rol y estado. | `src/gestion/components/ArcaBillingDialog.jsx`, `src/gestion/components/SaleInvoicePanel.jsx`, `src/gestion/components/LocationSalesPanel.jsx` |
| En `/gestion/settings` | Estado, preflight, solicitudes, recuperación, homologación y acciones acotadas de producción. | `src/gestion/pages/SettingsPage.jsx` |

1. [FUNCIONAL] Completar receptor como consumidor final o consultar CUIT y condición fiscal. Validar borrador, alícuotas, importes y umbral de identificación antes de generar. `src/gestion/components/ArcaBillingDialog.jsx`, `netlify/functions/arca-receiver.mjs`, `netlify/functions/_lib/arca/invoiceDraft.mjs`, `netlify/functions/_lib/arca/receiverLookup.mjs`.
2. [FUNCIONAL] Solicitar comprobante desde venta vinculada, registrar su estado en `invoices` y aplicar autorización automática únicamente al cumplir las guardas de ambiente, origen y política de producción. La revisión y autorización explícitas usan WSAA, WSFE, bloqueo de secuencia y comprobación de resultado antes de finalizar. `netlify/functions/arca-invoice.mjs`, `netlify/functions/arca-authorize.mjs`, `netlify/functions/_lib/arca/authorizer.mjs`, `netlify/functions/_lib/arca/sequenceLock.mjs`.
3. [FUNCIONAL] Revisar solicitudes, ejecutar diagnóstico de conexión/TA, preflight de solo lectura, dry-run, autorización de homologación bajo bandera, recuperación pre-CAE, conciliación y verificación de comprobante. El modo de venta objetivo tiene límites adicionales en código. `src/gestion/pages/SettingsPage.jsx`, `netlify/functions/arca-taxpayer.mjs`, `netlify/functions/arca-authorize.mjs`, `netlify/functions/_lib/arca/recoveryService.mjs`.
4. [FUNCIONAL] Consultar metadatos y, con comprobante autorizado, descargar/imprimir PDF con QR fiscal o enviar email SMTP configurado. El endpoint verifica actor/venta, evita repetir un envío con el mismo intento y distingue resultado incierto. `src/gestion/components/ArcaInvoicePrintAction.jsx`, `src/gestion/components/ArcaInvoiceEmailDialog.jsx`, `netlify/functions/arca-document.mjs`, `netlify/functions/_lib/arca/invoicePdf.mjs`, `netlify/functions/_lib/arca/invoiceEmail.mjs`.
5. [FUNCIONAL] Anular venta con motivo, previsualizar impacto, generar el tratamiento fiscal aplicable y revertir stock conforme a los estados de la venta y el comprobante. Si hay CAE emitido se sigue el flujo de nota de crédito. Los estados inciertos no se tratan como una cancelación simple. `netlify/functions/sale-cancel.mjs`, `netlify/functions/_lib/arca/saleCancellation.mjs`, `netlify/functions/_lib/arca/creditNotePlan.mjs`.

**Datos y reglas.** `sales`, `orders`, `payments`, `invoices`, `stockMovements`, `auditLogs`, caché cifrada `arcaWsaaTickets`, `arcaSequenceLocks` e intentos de correo. Credenciales WSAA/SMTP y banderas determinan lo habilitado en cada entorno. El borrador fiscal de la simulación web por sí solo no emite en producción. `netlify/functions/_lib/arca/config.mjs`, `netlify/functions/_lib/arca/wsaaSharedCache.mjs`, `netlify/functions/_lib/ecommerce/fiscalService.mjs`, `firestore.rules`.


### 3.12 Envíos — [FUNCIONAL]

Coordina preparación, traslado y entrega con evidencias de estado, asignaciones y accesos limitados.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/gestion/shipping` | Tablero, detalle por `shipment` en query, solicitudes, preparaciones, filtros y acciones individuales o por selección. | `src/gestion/pages/ShippingPage.jsx`, `src/gestion/shipping/ShipmentDetail.jsx`, `src/gestion/shipping/ShippingRequests.jsx`, `src/gestion/shipping/ShippingTasks.jsx` |
| `/e/:lookupId` | Selector QR entre preparación interna autenticada y reparto. `role=internal` o `role=courier` permite elegir entrada. | `src/gestion/shipping/ShippingPublicApp.jsx` |
| `/reparto` | Reparto individual o recorrido con token del tramo. | `src/gestion/shipping/CourierPortal.jsx` |
| `/seguimiento` | Vista pública de solo lectura por token, recorrido ilustrado y último estado confirmado. | `src/gestion/shipping/ShippingPublicApp.jsx`, `src/gestion/shipping/AnimatedDeliveryJourney.jsx` |

1. [FUNCIONAL] Capturar destino y notas en una venta con envío. Alta administrativa autoriza origen, tipo de transporte, preparadores y stock. Vendedor abre solicitud pendiente de aprobación. La aprobación valida stock suficiente y efectiviza la salida en la ubicación o depósito elegido. Marcar revisión o rechazar exige motivo. `src/gestion/shipping/ShippingFields.jsx`, `src/gestion/shipping/ShippingRequests.jsx`, `netlify/functions/_lib/shipping.mjs`.
2. [FUNCIONAL] Ver tablero por Pendientes, En camino, Entregados o Excepciones. Buscar y aplicar filtros de dirección, fechas, estados, transporte y responsables. Abrir detalle que muestra destino, productos, eventos, origen y accesos según autorización. `src/gestion/pages/ShippingPage.jsx`, `src/gestion/shipping/ShipmentDetail.jsx`, `netlify/functions/_lib/shippingFeed.mjs`.
3. [FUNCIONAL] Asignar/reasignar preparadores, comenzar preparación, marcar listo, generar/imprimir/reimprimir etiquetas QR individuales o selección A4. Algunas acciones de la tabla admiten selección múltiple y el servidor valida cada operación. El preparador necesita asignación. Una incidencia impide avanzar hasta resolverla. `src/gestion/pages/ShippingPage.jsx`, `src/gestion/shipping/ShippingTasks.jsx`, `src/gestion/shipping/ShippingLabelSheet.jsx`, `src/gestion/shipping/shippingLabels.mjs`, `netlify/functions/_lib/shipping.mjs`.
4. [FUNCIONAL] Emitir o revocar enlace de cliente o repartidor. Autorizar recorrido de envíos compatibles y reemplazar accesos de reparto con motivo. El QR de etiqueta puede activar el tramo permitido. Repartidor confirma retiro y entrega directa, o retiro, recepción en repositorio, salida y entrega final. Guarda evento de confirmación y aplica vigencia acotada. `src/gestion/shipping/ShippingAccessQr.jsx`, `src/gestion/shipping/CourierPortal.jsx`, `src/gestion/shipping/bulkAssignments.mjs`, `src/shared/shippingDomain.mjs`, `netlify/functions/_lib/shipping.mjs`.
5. [FUNCIONAL] Reportar y resolver incidencia, modificar dirección con motivo, validar un punto manual, cancelar/devolver/marcar no entregado y reintentar indicando posición física. Un cierre logístico por sí solo no registra reintegro, anulación fiscal ni movimiento de devolución. `src/gestion/shipping/ShipmentDetail.jsx`, `src/gestion/shipping/ShippingMap.jsx`, `netlify/functions/_lib/shipping.mjs`.
6. [FUNCIONAL] Recibir y marcar aviso de preparación/incidencia en la campana. Consultar estado público con refresco. La proyección de cliente contiene código, estado, tipo, mensaje e instante de actualización. La ilustración sigue hitos, sin GPS del teléfono. El mapa usa teselas para edición manual, con salida de navegación si el panel ofrece enlace. `src/gestion/shipping/ShippingBell.jsx`, `src/gestion/shipping/ShippingPublicApp.jsx`, `src/gestion/shipping/ShippingMap.jsx`, `src/shared/shippingDomain.mjs`.
7. [SOLO BACKEND] El job horario elimina campos de última posición vencida que queden en envíos. `netlify/functions/shipping-retention.mjs`, `netlify/functions/_lib/shippingRetention.mjs`.
8. [SOLO BACKEND] El outbox registra `shipping.tracking_ready` con `adapter: "disabled"`. El transporte identificado como Uber funciona como selección operativa. No hay solicitud a una API de Uber ni envío automático del enlace. `netlify/functions/_lib/shipping.mjs`, `src/shared/shippingDomain.mjs`, `src/shared/shippingIntegrations.mjs`.

**Datos y estados.** `shipments` con `events` y `operations`, `shipmentLookups`, `shipmentAccess`, `deliverySessions`, `deliverySessionAccess`, `shippingRouteOperations`, `shippingRateLimits`, `shippingOutbox`, `alerts`, `sales`, `counters`, `customers`, `users`, inventario, `stockMovements` y `auditLogs`. Estados definidos en `src/shared/shippingDomain.mjs`

- Entrada y preparación `solicitud_pendiente`, `aprobado`, `en_preparacion`, `listo_retirar`.
- Tránsito `retirado_origen` (etiqueta reconocida por el dominio), `hacia_repositorio`, `recibido_repositorio`, `reparto_final`.
- Cierre `entregado`, `devuelto`, `cancelado`, `no_entregado`, `rechazado`. La incidencia es un dato aparte. Reintento de `no_entregado` no descuenta stock adicional.

**Guardas y fricción.** La Function multipropósito `netlify/functions/shipping.mjs` valida método, tamaño, sesión/acceso público y frecuencia. El servicio aplica idempotencia, estados y separación por embarque/tramo. El SDK lee según reglas y tiene respaldo por Function para el tablero/avisos. `src/gestion/services/shippingService.js`, `netlify/functions/_lib/shipping.mjs`, `firestore.rules`.

### 3.13 Pedidos web en Gestión — [INCOMPLETO]

Permite localizar pedidos del storefront y consultar su estado registrado.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/gestion/ecommerce` | Lista reciente de pedidos y acceso a catálogo. Olivia puede acotar la lista a un pedido revisado. | `src/gestion/pages/GenericModulePage.jsx` |

1. [FUNCIONAL] Consultar pedidos con permiso `ecommerce.view`, buscar por título/referencia y estado en el conjunto cargado, ver fecha y responsable si existe. `src/gestion/pages/GenericModulePage.jsx`, `src/gestion/services/managementService.js`.
2. [FUNCIONAL] Abrir el catálogo mediante `/productos` en el unificado, que sigue sujeto al gate de esa variante. `src/gestion/pages/GenericModulePage.jsx`, `src/App.jsx`, `src/gestion/StorePreviewGate.jsx`.
3. [INCOMPLETO] El módulo anuncia catálogo/publicación y pedidos. Su rama activa no expone editor de publicación, liquidación, cancelación/reembolso, configuración de checkout o asignación logística de pedidos web. `src/gestion/modules.js`, `src/gestion/pages/GenericModulePage.jsx`.

**Datos y regla.** Lee `orders` con límite por defecto de 40 y orden por actualización. También se puede leer `payments` por reglas según el rol. Las escrituras sobre `orders` y `payments` están reservadas al backend. `src/gestion/services/managementService.js`, `firestore.rules`, `netlify/functions/_lib/ecommerce/commerceService.mjs`.

### 3.14 Redes sociales — [INCOMPLETO]

Registra una consulta comercial de redes para poder encontrarla después.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/gestion/social` | Lista reciente y modal Nueva consulta. | `src/gestion/pages/GenericModulePage.jsx` |

1. [FUNCIONAL] Crear una consulta manual con título/contacto y notas. Guarda estado `new`, responsable de alta y marcas temporales. Buscar registros cargados por texto/estado. `src/gestion/modules.js`, `src/gestion/pages/GenericModulePage.jsx`, `src/shared/managementWritePlans.mjs`.
2. [INCOMPLETO] El listado no ofrece editor de conversación, asignación de responsable ni conversión automática en venta. El canal Instagram de Venta Rápida es un dato de origen manual. `src/gestion/pages/GenericModulePage.jsx`, `src/modules/locations/domain/channels.js`.

**Datos y regla.** `socialLeads` usa el CRUD genérico de alta/lectura, con acciones de escritura más amplias en Firestore que la pantalla. Olivia consulta o prepara alta según privilegios. `src/gestion/services/managementService.js`, `netlify/functions/_lib/olivia/extendedOperations.mjs`, `firestore.rules`.

### 3.15 Marketing general — [INCOMPLETO]

Registra borradores generales y enlaza las herramientas de campaña especializadas.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/gestion/marketing` | Lista de campañas generales, modal básico y accesos a WhatsApp y Meta Ads autorizados. | `src/gestion/pages/GenericModulePage.jsx` |

1. [FUNCIONAL] Crear campaña con nombre y notas como `draft`, listar y buscar. Abrir el workspace correspondiente. `src/gestion/pages/GenericModulePage.jsx`, `src/shared/managementWritePlans.mjs`, `src/gestion/services/managementService.js`.
2. [SOLO BACKEND] `contentItems` está definido en las reglas. Las entradas activas visitadas no escriben un calendario editorial en esa colección. `firestore.rules`, `src/gestion/ManagementApp.jsx`.
3. [INCOMPLETO] La pantalla genérica no expone editor de calendario, distribución del presupuesto ni resultados de campañas. La planificación de Meta Ads y la ejecución por extensión de WhatsApp usan sus propias colecciones. `src/gestion/modules.js`, `src/gestion/pages/GenericModulePage.jsx`, `src/gestion/pages/WhatsAppCampaignsPage.jsx`, `src/gestion/pages/MetaAdsPage.jsx`.

**Datos y reglas.** `campaigns`, `contentItems` (contrato), permisos del módulo y proyección de lectura de Olivia. Crear un borrador general no crea un proyecto Meta Ads ni un lote para la extensión. `netlify/functions/_lib/olivia/extendedTools.mjs`, `firestore.rules`.

### 3.16 Campañas de WhatsApp — [INCOMPLETO]

Arma la audiencia y coordina una campaña con un emisor externo al repositorio.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/gestion/marketing/whatsapp` | Lista/historial, estado de extensión, asistente de campaña y detalle/diagnóstico. | `src/gestion/pages/WhatsAppCampaignsPage.jsx` |

1. [FUNCIONAL] Elegir contactos de BD con búsqueda, filtros y selección, o importar Excel y mapear columnas. Normalizar teléfonos, excluir bloqueos/duplicados y previsualizar audiencia. El filtro excluye denegaciones explícitas y no exige un opt-in afirmativo para todos los registros históricos. `src/gestion/marketing/whatsapp/excelImport.js`, `src/gestion/marketing/whatsapp/campaignDomain.js`, `src/gestion/marketing/whatsapp/campaignService.js`.
2. [FUNCIONAL] Guardar borrador, redactar texto personalizable, revisar destinatarios y adjuntar hasta tres imágenes. Firestore guarda los metadatos permitidos y la extensión recibe temporalmente bytes. Si se pierden los archivos temporales, el estado puede requerir reponerlos. `src/gestion/pages/WhatsAppCampaignsPage.jsx`, `src/gestion/marketing/whatsapp/campaignDomain.js`, `src/gestion/marketing/whatsapp/extensionBridge.js`, `firestore.rules`.
3. [FUNCIONAL] Verificar conexión/preflight, preparar lote e iniciar, pausar, reanudar, reintentar, reintentar fallidos, detener, cancelar o liberar en el emisor según disponibilidad y estado. Guarda receptores/eventos y reconcilia progreso por mensajes y snapshots de la extensión, con distinción entre confirmados y no verificados. `src/gestion/marketing/whatsapp/extensionBridge.js`, `src/gestion/marketing/whatsapp/WhatsAppExtensionSync.jsx`, `src/gestion/marketing/whatsapp/campaignEventQueue.js`, `src/gestion/marketing/whatsapp/campaignReconciliation.js`, `src/gestion/marketing/whatsapp/campaignRelease.js`.
4. [FUNCIONAL] Revisar campañas paginadas, avance, errores, eventos y diagnóstico. Copiar reporte en texto o JSON. `src/gestion/pages/WhatsAppCampaignsPage.jsx`, `src/gestion/marketing/whatsapp/campaignService.js`.
5. [INCOMPLETO] El envío depende del emisor externo y de su sesión. El código auditado implementa el puente y la reconciliación. No contiene el motor de la extensión ni webhook de WhatsApp Business. `src/gestion/marketing/whatsapp/extensionBridge.js`, `netlify/functions/`.

**Datos y guardas.** `customers`, `customerZones`, `sales` para segmentos, `whatsappCampaigns/{id}/recipients` y `/events`. Estado del emisor temporal. Permisos `whatsappView`, `whatsappCreateCampaign`, `whatsappSendToExtension`, `whatsappCancelCampaign`, `whatsappViewHistory`, `whatsappImportExcel`. Estados del código `draft`, `received`, `ready`, `running`, `pause_requested`, `waiting_contact`, `waiting_batch`, `paused`, `daily_limit_reached`, `images_required`, `completed`, `stopped`, `error`, `cancelled`. `src/gestion/permissions.js`, `src/gestion/marketing/whatsapp/campaignDomain.js`, `firestore.rules`.

### 3.17 Meta Ads, conocimiento, metodología y creatividades — [INCOMPLETO]

Prepara campañas y contenidos internos hasta la grabación y carga del material.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/gestion/marketing/meta-ads` | Campañas, búsqueda/filtros, alta y navegación a conocimiento/metodologías. | `src/gestion/pages/MetaAdsHubPage.jsx`, `src/gestion/pages/MetaAdsPage.jsx` |
| `/gestion/marketing/meta-ads/:campaignId` | Detalle, planificación guiada y Workspace Creativo. | `src/gestion/pages/MetaAdsPage.jsx`, `src/gestion/pages/MetaAdsCampaignPlanningWorkspace.jsx`, `src/gestion/pages/MetaAdsCreativeWorkspace.jsx` |
| `/gestion/marketing/meta-ads/knowledge` | Conocimiento del negocio y metadata comercial por producto. | `src/gestion/pages/MetaAdsKnowledgeView.jsx` |
| `/gestion/marketing/meta-ads/theories` | Listado y alta de metodologías. | `src/gestion/pages/MetaAdsTheoriesView.jsx` |
| `/gestion/marketing/meta-ads/theories/:theoryId` | Versiones, fuente, compilación, revisión y activación. | `src/gestion/pages/MetaAdsTheoriesView.jsx` |

1. [FUNCIONAL] Crear campaña vinculada a producto cuando se elige, abrir listado/detalle, editar o archivar en borrador y bloquear edición de datos base al avanzar. `src/gestion/pages/MetaAdsPage.jsx`, `src/gestion/marketing/metaAds/campaignProjectService.js`, `src/gestion/marketing/metaAds/campaignProjectDomain.js`.
2. [FUNCIONAL] Guardar contexto del negocio y metadata de un producto del catálogo con permisos de conocimiento. `src/gestion/pages/MetaAdsKnowledgeView.jsx`, `src/gestion/marketing/metaAds/knowledgeService.js`.
3. [FUNCIONAL] Crear metodología a partir de texto, Markdown, PDF con extracción de texto o editor. Guardar borrador, compilar con IA, validar esquema, revisar, aprobar, activar/reactivar versión o generar una nueva. Estados `draft`, `compiling`, `review`, `approved`, `active`, `archived`, `error` con transiciones. `src/gestion/pages/MetaAdsTheoriesView.jsx`, `src/gestion/marketing/metaAds/pdfTextExtractor.js`, `src/gestion/marketing/metaAds/theoryService.js`, `netlify/functions/theory-compiler.mjs`, `firestore.rules`.
4. [FUNCIONAL] Seleccionar metodología activa, generar preguntas, guardar respuestas y generar/regenerar estrategia. Editar, comparar revisiones y aprobar plan. El plan tiene estructura validada y el flujo persiste revisión y referencia a la metodología. `src/gestion/pages/MetaAdsCampaignPlanningWorkspace.jsx`, `src/gestion/marketing/metaAds/campaignPlanningService.js`, `netlify/functions/campaign-planner.mjs`, `src/gestion/marketing/metaAds/campaignPlanningDomain.js`.
5. [FUNCIONAL] Preparar espacio creativo desde plan aprobado, aprovisionar carpetas Drive, agrupar tareas de grabación, cargar tomas por partes, registrar error, confirmar archivo y elegir toma. El estado indica material listo para revisión. `src/gestion/pages/MetaAdsCreativeWorkspace.jsx`, `src/gestion/marketing/metaAds/googleDriveService.js`, `src/gestion/marketing/metaAds/creativeWorkspaceDomain.js`, `netlify/functions/google-drive.mjs`.
6. [SOLO UI] Validación final, producción/render, publicación en Meta Ads y resultados se anuncian como etapas. Ninguna llamada a Meta Graph/Ads ni etapa de rendimiento aparece en los handlers de estas pantallas. `src/gestion/pages/MetaAdsPage.jsx`, `src/gestion/marketing/metaAds/campaignProjectDomain.js`, `netlify/functions/`.

**Datos, servidor y permisos.** `products`, `marketingKnowledge`, `marketingProductProfiles`, `metaAdTheories/{id}/versions`, `metaCampaignProjects/{id}/planning`, `/plans`, `/recordingTasks`, `/creativeAssets`, `aiUsage`, `integrationConnections`, `integrationSecrets`, `integrationOauthStates`, `creativeUploadSessions` y archivos Drive. Acciones `metaAds*` en cliente, reglas y guardas de servidor. Calcular aprobación no activa por sí solo un anuncio. `src/gestion/permissions.js`, `netlify/functions/_lib/firebaseAuth.mjs`, `firestore.rules`.

### 3.18 Alertas — [FUNCIONAL]

Muestra avisos y problemas provenientes de las operaciones del sistema.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/gestion/alerts` | Lista reciente filtrable. Administración abre errores/propuestas de Olivia y copia descripción de diagnóstico. | `src/gestion/pages/GenericModulePage.jsx` |

1. [FUNCIONAL] Consultar alertas en módulo/Panel general, priorizar abiertas según fecha y perfil, actualizar ante cambios. `src/gestion/services/alertsService.js`, `src/modules/alerts/domain/alerts.js`, `src/gestion/components/DashboardAlerts.jsx`.
2. [FUNCIONAL] Abrir incidentes logísticos desde aviso, registrar resolución financiera en Finanzas, y revisar reportes o sugerencias de Olivia en Alertas con rol de administración. `src/gestion/shipping/ShippingBell.jsx`, `src/gestion/finance/financeService.js`, `src/gestion/pages/GenericModulePage.jsx`, `netlify/functions/_lib/olivia/errorReports.mjs`, `netlify/functions/_lib/olivia/suggestions.mjs`.
3. [FUNCIONAL] Olivia puede preparar y confirmar una alerta manual con guardas. La página genérica de Alertas queda como consulta porque el módulo no declara `primaryAction`. `src/gestion/modules.js`, `src/gestion/pages/GenericModulePage.jsx`, `netlify/functions/_lib/olivia/extendedOperations.mjs`.

**Datos y reglas.** `alerts`, con alcance según origen/perfil. Envío notifica al responsable, Finanzas genera/evalúa controles al actualizar, y herramienta de Olivia conserva diagnóstico permitido. Las alertas no son una bandeja universal de mensajes externos. `firestore.rules`, `netlify/functions/_lib/shipping.mjs`, `src/gestion/finance/financeService.js`.

### 3.19 Proveedores — [INCOMPLETO]

Mantiene un registro básico para identificar proveedores.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/gestion/suppliers` | Lista de proveedores y modal cuya acción dice Nueva compra, aunque pide nombre del proveedor y notas. | `src/gestion/modules.js`, `src/gestion/pages/GenericModulePage.jsx` |

1. [FUNCIONAL] Registrar nombre y notas en `suppliers` con estado `active`. Consultar y buscar registros recientes. El registro puede vincularse desde un movimiento financiero. `src/gestion/services/managementService.js`, `src/shared/managementWritePlans.mjs`, `src/gestion/finance/financeService.js`.
2. [SOLO BACKEND] `purchases` tiene reglas propias. El botón Nueva compra persiste un proveedor y no invoca una compra, recepción, costo o reposición automática. Olivia consulta/proyecta alta del proveedor mediante sus permisos. `firestore.rules`, `src/gestion/modules.js`, `src/gestion/pages/GenericModulePage.jsx`, `netlify/functions/_lib/olivia/extendedTools.mjs`.

**Fricción.** El rótulo y la descripción del menú exceden el formulario y la operación que existen. `src/gestion/modules.js`, `src/gestion/pages/GenericModulePage.jsx`.

### 3.20 Actividad y Auditoría — [FUNCIONAL]

Expone el rastro de operaciones y permite consultar qué ocurrió con los registros que se pueden leer.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/gestion/actividad` | Registro cronológico filtrado, detalle y paginación. | `src/gestion/pages/ActivityPage.jsx` |
| `/gestion/audit` | Registro reciente general para roles de administración. | `src/gestion/pages/AuditPage.jsx` |

1. [FUNCIONAL] Filtrar actividad por período, ubicación, usuario y dimensiones disponibles en el formulario, cargar registros anteriores y abrir un detalle con snapshot o entidad permitida. `src/gestion/pages/ActivityPage.jsx`, `src/gestion/components/ActivityDetail.jsx`, `src/gestion/services/dashboardService.js`, `src/gestion/services/activityService.js`.
2. [FUNCIONAL] Consultar auditoría reciente por fecha con acción, actor, destino y estado, y reintentar lectura. La vista general limita la consulta. Actividad usa su propia paginación y guardas. `src/gestion/pages/AuditPage.jsx`, `src/gestion/services/managementService.js`, `firestore.rules`.
3. [SOLO BACKEND] Las mutaciones operativas producen entradas de auditoría/snapshots. Las reglas bloquean actualización y borrado de `auditLogs` desde cliente. `src/shared/activitySnapshots.mjs`, `src/shared/operationalWritePlans.mjs`, `firestore.rules`.

**Datos y límites.** `auditLogs`, `sales`, `locations`, `users`, entidades referenciadas según acción y permisos. Los datos faltantes en un snapshot histórico limitan el detalle disponible. `src/gestion/services/activityService.js`, `src/gestion/activity/activityDetails.js`.

### 3.21 Administración de usuarios — [FUNCIONAL]

Crea y controla perfiles de acceso sin borrar el historial operativo.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/gestion/administration` | Usuarios, plantillas de rol, alta, desactivación/reactivación y archivo. | `src/gestion/pages/AdministrationPage.jsx` |

1. [FUNCIONAL] Crear cuenta con email, contraseña temporal, nombre, rol y ubicaciones. Usa una instancia Firebase secundaria para no sustituir la sesión del administrador. Guarda el perfil en Firestore. `src/gestion/pages/AdministrationPage.jsx`, `src/gestion/services/managementService.js`.
2. [FUNCIONAL] Desactivar/reactivar otra cuenta a nivel de perfil y archivar tras desactivarla. Impide desactivar/archivar el propio perfil y conserva la cuenta Auth. Un archivo no se reactiva desde el servicio. `src/gestion/services/managementService.js`.
3. [INCOMPLETO] Plantillas visibles y permisos específicos soportados en código. No hay editor en esta ruta para cambiar permisos/rol de usuario ya creado. `src/gestion/pages/AdministrationPage.jsx`, `src/gestion/permissions.js`.

**Datos y límite.** Firebase Auth, `users`, `locations` y contratos `roles`/`permissions` en reglas. La alta de Auth y la de perfil ocurren en dos pasos. La guarda de la página acepta los dos roles administrativos y el guardado de usuarios exige `admin` normalizado. `src/gestion/permissions.js`, `src/gestion/services/managementService.js`, `firestore.rules`.

### 3.22 Configuración de plataforma — [FUNCIONAL]

Expone estado de servicios y controles de integración para los actores autorizados.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/gestion/settings` | Estado de Firebase, autenticación, pagos y canales. Paneles de ARCA, Drive y Olivia condicionados. | `src/gestion/pages/SettingsPage.jsx`, `src/gestion/olivia/OliviaSettings.jsx` |

1. [FUNCIONAL] Consultar panel de estado y diagnóstico fiscal. Acciones de homologación y producción (sección 3.11) se muestran de acuerdo con el ambiente y permisos. `src/gestion/pages/SettingsPage.jsx`, `netlify/functions/arca-taxpayer.mjs`.
2. [FUNCIONAL] Conectar Drive por OAuth, probar cuenta/carpeta y desconectar con permisos. Un perfil creativo puede consultar estado según acceso. `src/gestion/pages/SettingsPage.jsx`, `src/gestion/marketing/metaAds/googleDriveService.js`, `netlify/functions/google-drive.mjs`, `netlify/functions/google-drive-callback.mjs`.
3. [FUNCIONAL] Administrar política del asistente y biblioteca cuando se tienen permisos. `src/gestion/olivia/OliviaSettings.jsx`, `src/gestion/olivia/OliviaKnowledgeManager.jsx`, `netlify/functions/olivia.mjs`, `netlify/functions/olivia-knowledge.mjs`.
4. [SOLO UI] El estado de pagos online y el texto de configuración/migración reflejan presentación de la app. La pantalla no abre un administrador de pasarela ni demuestra el estado real de una migración activa. `src/gestion/pages/SettingsPage.jsx`.

**Datos y reglas.** Lectura de proyecto configurado, resultados de diagnóstico, credenciales y estado gobernados en servidor, `integrationConnections`, `integrationSecrets`, `integrationOauthStates`, estado fiscal y `oliviaConfiguration`. Los valores privados permanecen del lado del servidor. `netlify/functions/_lib/googleDrive.mjs`, `netlify/functions/_lib/arca/config.mjs`, `netlify/functions/_lib/olivia/store.mjs`.

### 3.23 Olivia — [FUNCIONAL]

Acompaña a usuarios autorizados con información, guías, tareas y operaciones confirmables.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| Panel superpuesto en Gestión y Vendedor. Administración en `/gestion/settings` | Lanzador fijo/flotante según preferencia, conversación, voz, adjuntos, guías, configuración, historial/consumo y revisiones contextuales. | `src/gestion/olivia/OliviaMount.jsx`, `src/gestion/olivia/OliviaAssistant.jsx`, `src/gestion/olivia/OliviaSettings.jsx` |
| `/olivia-speech/index.html` | Reproductor estático para escuchar biblioteca de clips. Se copia desde `public/` incluso en el build independiente. | `public/olivia-speech/index.html`, `public/olivia-speech/library.js` |

1. [FUNCIONAL] Conversar por texto, iniciar, paginar/retomar conversaciones, enviar adjuntos permitidos y cámara, cancelar turno, recuperar consulta, reportar error o guardar sugerencia. Las respuestas pueden llegar por stream o por trabajo diferido y el estado queda ligado a cuenta/conversación. `src/gestion/olivia/OliviaAssistant.jsx`, `src/gestion/olivia/OliviaComposer.jsx`, `netlify/functions/olivia.mjs`, `netlify/functions/_lib/olivia/chatJobs.mjs`, `netlify/functions/_lib/olivia/attachments.mjs`.
2. [FUNCIONAL] Dictar audio, usar transcripción en vivo y voz natural, reproducir clips de respuesta rápida y síntesis Chirp. El cliente controla interrupción/reintento y el backend registra consumo, duración y límites. Transcribir voz en vivo es una función distinta del modo conversacional GPT-Live retirado. `src/gestion/olivia/dictation.mjs`, `src/gestion/olivia/liveTranscription.mjs`, `src/gestion/olivia/naturalVoice.mjs`, `src/gestion/olivia/fastSpeechPlayer.mjs`, `netlify/functions/olivia-live-transcribe.mjs`, `netlify/functions/olivia-synthesize.mjs`, `netlify/functions/_lib/olivia/chirp.mjs`.
3. [FUNCIONAL] Guiar interfaz y navegación por permisos. `get_current_user_context`, `navigate_to_module`, `get_app_capabilities`, `search_tools`, `get_ui_guide`, `show_ui_guide`, `discover_skills`, `load_skill` y `search_knowledge` resuelven contexto, guías registradas, capacidades y conocimiento. La guía resalta/indica pasos. El usuario usa los controles. `src/shared/oliviaContracts.mjs`, `src/shared/oliviaCapabilities.mjs`, `src/shared/oliviaUiGuides.mjs`, `src/gestion/olivia/OliviaGuideHost.jsx`, `netlify/functions/_lib/olivia/tools.mjs`, `netlify/functions/_lib/olivia/skills.mjs`.
4. [FUNCIONAL] Consultar operación básica con `list_locations`, `search_products`, `get_stock`, `get_promotions` y `get_today_sales`. Aplica ubicaciones efectivas y permisos. Un vendedor obtiene datos de su ámbito. `netlify/functions/_lib/olivia/guards.mjs`, `netlify/functions/_lib/olivia/tools.mjs`.
5. [FUNCIONAL] Analizar ventas por período, historial, ubicaciones, productos, vendedores y alcance histórico con `get_sales_metrics`, `get_sales_history`, `get_location_metrics`, `compare_locations`, `get_product_performance`, `get_product_sales_history`, `get_seller_performance`, `get_all_time_sales_metrics`. Pronóstico orientativo con `forecast_product_demand`, `forecast_fair`, `list_fair_events`. Referencia pública con `research_web_metric`. Los resultados expresan límites y no se guardan como ventas. `src/shared/oliviaCapabilities.mjs`, `netlify/functions/_lib/olivia/analytics.mjs`, `netlify/functions/_lib/olivia/productForecast.mjs`, `netlify/functions/_lib/olivia/research.mjs`.
6. [FUNCIONAL] Consultar inventario, clientes, caja y otros módulos autorizados con `get_inventory_summary`, `get_stock_movements`, `get_transfer_history`, `list_warehouses`, `resolve_transfer_origin`, `search_customers`, `get_customer`, `get_customer_history`, `get_financial_summary`, `get_expenses`, `get_shipments`, `get_alerts`, `get_suppliers`, `get_orders`, `get_marketing_campaigns`, `get_whatsapp_campaigns`, `get_meta_ads_campaigns`, `get_social_leads`, `get_audit_activity`, `get_users`, `get_configuration_summary`, `get_invoice_status`. Las herramientas ampliadas requieren administración y el permiso correspondiente salvo las excepciones declaradas. `src/shared/oliviaCapabilities.mjs`, `netlify/functions/_lib/olivia/extendedTools.mjs`.
7. [FUNCIONAL] Preparar y confirmar ventas individuales/lote, carga simple de stock o carga conjunta de catálogo e inventario, traslado, alta/edición de ubicación/cliente y alta de gasto, depósito, alerta, proveedor, consulta social o borrador general. Herramientas `prepare_sale`, `prepare_batch_sales`, `prepare_stock_load`, `prepare_catalog_stock_load`, `prepare_stock_transfer`, `prepare_create_location`, `prepare_update_location`, `prepare_customer_create`, `prepare_customer_update`, `prepare_expense_create`, `prepare_warehouse_create`, `prepare_alert_create`, `prepare_supplier_create`, `prepare_social_lead_create`, `prepare_marketing_campaign`. Las transacciones vuelven a validar permisos, datos y confirmación. Lote de hasta veinte ventas. Alta de producto individual `prepare_product_create` prepara el formulario y la carga conjunta sí tiene plan de escritura de faltantes. `netlify/functions/_lib/olivia/operations.mjs`, `netlify/functions/_lib/olivia/extendedOperations.mjs`, `netlify/functions/_lib/olivia/batchSales.mjs`, `netlify/functions/_lib/olivia/catalogStock.mjs`.
8. [FUNCIONAL] Preparar revisión de factura, anulación, rol, configuración y pedido web con `prepare_invoice_review`, `prepare_sale_cancellation_review`, `prepare_user_role_review`, `prepare_configuration_review`, `prepare_ecommerce_order_review`. El efecto es abrir el contexto de revisión y delegar el acto sensible al flujo fuente. `netlify/functions/_lib/olivia/extendedOperations.mjs`, `src/gestion/olivia/OliviaReviewPanel.jsx`, `src/gestion/olivia/ScreenContext.jsx`.
9. [FUNCIONAL] Consultar consumo y costos, pedir ampliación, administrar límites por usuario, modelos, retención, historial y trazas de diagnóstico. Publicar/listar/retirar archivos en biblioteca semántica por audiencia y módulo. El contenido no modifica los permisos. `src/gestion/olivia/OliviaSettings.jsx`, `src/gestion/olivia/OliviaUsage.jsx`, `src/gestion/olivia/OliviaDeveloperPanel.jsx`, `src/gestion/olivia/OliviaKnowledgeManager.jsx`, `netlify/functions/_lib/olivia/usage.mjs`, `netlify/functions/_lib/olivia/knowledge.mjs`.
10. [INCOMPLETO] `prepare_shipment_create` y `prepare_shipment_update` están declaradas pero sus guardas las bloquean. El canal logístico vigente parte de ventas. Las operaciones conversacionales GPT-Live antiguas y el medidor anterior responden `410`. Quedan rutinas de limpieza y registros de compatibilidad. `src/shared/oliviaCapabilities.mjs`, `netlify/functions/_lib/olivia/extendedOperations.mjs`, `netlify/functions/olivia.mjs`, `netlify/functions/olivia-voice-meter-background.mjs`, `netlify/functions/olivia-voice-cleanup.mjs`.

**Persistencia y guardas.** Colecciones privadas `olivia*` del inventario en la sección 6, historial/proyección de los módulos al consultar, escritura operativa solo por plan autorizado, confirmación e idempotencia. El backend puede usar OpenAI y Chirp con credenciales. El cliente guarda preferencia flotante, modo de diagnóstico y usa streaming y clips estáticos. `netlify/functions/_lib/olivia/store.mjs`, `netlify/functions/_lib/olivia/engine.mjs`, `src/gestion/olivia/preferences.mjs`, `firestore.rules`.


### Registro técnico de entradas de servidor y automatizaciones

Las entradas HTTP de la tabla tienen prefijo `/.netlify/functions/`. Sus nombres señalan el archivo real bajo `netlify/functions/`. Las programadas se identifican por su función de Netlify. Inventario de **30 Functions**, incluidas **4 programadas**, en el build unificado.

| Entrada | Método/ejecución | Operación y guarda | Archivo |
| --- | --- | --- | --- |
| `arca-authorize` | POST | [FUNCIONAL] Roles administrativos. Revisión, dry-run, autorizar, conciliar, recuperar intento pre-CAE y verificar comprobante. Banderas por ambiente. | `netlify/functions/arca-authorize.mjs` |
| `arca-document` | POST | [FUNCIONAL] Perfil activo y acceso a la venta/factura. Metadatos, PDF, correo. Chequeo de conexión SMTP con guarda propia. | `netlify/functions/arca-document.mjs` |
| `arca-invoice` | POST | [FUNCIONAL] Perfil activo con autorización sobre la venta. Validar borrador, solicitar comprobante y eventualmente autoautorizar bajo política fiscal. | `netlify/functions/arca-invoice.mjs` |
| `arca-receiver` | POST | [FUNCIONAL] Perfil activo permitido, resolución de receptor por CUIT. | `netlify/functions/arca-receiver.mjs` |
| `arca-taxpayer` | POST | [FUNCIONAL] Administración. Estado, diagnostics, estado de caché TA, smoke WSAA/WSAA Padrón, preflight de solo lectura y consulta contribuyente. | `netlify/functions/arca-taxpayer.mjs` |
| `campaign-planner` | GET health / POST | [FUNCIONAL] Health sin contexto privado. Generar preguntas/plan con permiso `metaAdsPlanCampaign`, rate y control de trabajo concurrente. | `netlify/functions/campaign-planner.mjs` |
| `catalog-merge` | POST | [FUNCIONAL] Administración. Previsualizar y aplicar unificación de catálogo con verificación de cambios. | `netlify/functions/catalog-merge.mjs` |
| `ecommerce-catalog` | GET | [FUNCIONAL] Lectura comercial pública cuando la Function se incluye y la fuente está configurada. | `netlify/functions/ecommerce-catalog.mjs` |
| `ecommerce-checkout` | POST | [INCOMPLETO] Invitado, validación server-side y pedido/pago pendiente para retiro. Carece de cobro online en este corte. | `netlify/functions/ecommerce-checkout.mjs` |
| `ecommerce-simulated-payment` | POST | [FUNCIONAL] Administración, solo local habilitado. Estado de capacidad o simulación/plan fiscal repetible. | `netlify/functions/ecommerce-simulated-payment.mjs` |
| `google-drive-callback` | GET | [FUNCIONAL] Recibe código/estado OAuth, valida estado, procesa el retorno a Configuración. | `netlify/functions/google-drive-callback.mjs` |
| `google-drive` | GET health / POST | [FUNCIONAL] Estado, workspace, preparación y aprovisionamiento, crear/confirmar/reportar carga, elegir toma, arrancar OAuth, probar y desconectar. Comprueba acción Meta Ads por operación. | `netlify/functions/google-drive.mjs` |
| `olivia-attachment` | POST multipart | [FUNCIONAL] Sesión Olivia. Sube adjunto temporal con validación y presupuesto. | `netlify/functions/olivia-attachment.mjs` |
| `olivia-chat-background` | POST background | [FUNCIONAL] Trabajo diferido del propietario del chat. Comprueba sesión y job, persiste resultado o error. | `netlify/functions/olivia-chat-background.mjs` |
| `olivia-fast-speech` | POST | [FUNCIONAL] Sesión Olivia. Enrutamiento de respuesta breve para voz, sin abrir conversación GPT-Live antigua. | `netlify/functions/olivia-fast-speech.mjs` |
| `olivia-knowledge` | POST multipart/JSON | [FUNCIONAL] Publicar, listar o retirar documentos según guardas de biblioteca. | `netlify/functions/olivia-knowledge.mjs` |
| `olivia-live-transcribe` | POST | [FUNCIONAL] Sesión Olivia. Crear/cerrar sesión efectiva de transcripción en vivo y registrar duración/estimación. | `netlify/functions/olivia-live-transcribe.mjs` |
| `olivia-resource-retention` | Diario | [SOLO BACKEND] Retiro de recursos vencidos/de baja del proveedor y estado local de limpieza. | `netlify/functions/olivia-resource-retention.mjs` |
| `olivia-retention` | Horario | [SOLO BACKEND] Retención de conversaciones y registros propios en lotes. | `netlify/functions/olivia-retention.mjs` |
| `olivia-speech-audio` | POST | [FUNCIONAL] Sesión Olivia. Resolver audio autorizado de respuesta de voz según turno. | `netlify/functions/olivia-speech-audio.mjs` |
| `olivia-synthesize` | POST | [FUNCIONAL] Sesión Olivia. Sintetizar respuesta con Chirp y transmitir PCM. | `netlify/functions/olivia-synthesize.mjs` |
| `olivia-transcribe` | POST multipart | [FUNCIONAL] Transcribir audio enviado con límites y sesión Olivia. | `netlify/functions/olivia-transcribe.mjs` |
| `olivia-voice-cleanup` | Cada minuto | [SOLO BACKEND] Cierra transcripciones en vivo vencidas y sesiones históricas, asienta medición/consumo según modalidad. | `netlify/functions/olivia-voice-cleanup.mjs` |
| `olivia-voice-meter-background` | POST | [INCOMPLETO] Contrato anterior retirado, devuelve `410` tras validar sesión. | `netlify/functions/olivia-voice-meter-background.mjs` |
| `olivia` | POST / SSE | [FUNCIONAL] Estado, chat y herramientas, jobs (`startChat`, `chatStatus`, `cancelChat`, `cancelTurn`), confirm/cancel, estimate, resume/history, reportes, cuota y configuración. Comprueba sesión y permisos por acción. | `netlify/functions/olivia.mjs` |
| `preview-firebase-status` | GET en host de preview previsto | [SOLO BACKEND] Comprueba proyecto efectivo y señal de configuración web/credencial del servidor sin exponer credenciales. | `netlify/functions/preview-firebase-status.mjs` |
| `sale-cancel` | POST | [FUNCIONAL] Perfil activo. Previsualiza/aplica anulación con motivo, propiedad, permisos y guardas fiscales/logísticas. | `netlify/functions/sale-cancel.mjs` |
| `shipping-retention` | Horario | [SOLO BACKEND] Limpia última posición residual vencida. | `netlify/functions/shipping-retention.mjs` |
| `shipping` | POST | [FUNCIONAL] `create_sale`, `create_courier_session`, `activate_courier_qr`, `courier_session_detail`, `resources`, `feed`, `notifications`, `read_notification` y operación de Envíos mediante `detail`, `tracking`, `approve`, `start_preparing`, `ready`, `incident`, `resolve`, `reject`, `review`, `retry`, `cancel`, `return`, `undelivered`, `address`, `assign`, `issue_access`, `revoke_access`, `courier_action`, `labels`. Acceso y estado específicos por modo. | `netlify/functions/shipping.mjs`, `netlify/functions/_lib/shipping.mjs` |
| `theory-compiler` | GET health / POST | [FUNCIONAL] Health. Compilar texto en metodología estructurada con permiso `metaAdsManageTheory` y límites de entrada/concurrencia. | `netlify/functions/theory-compiler.mjs` |

**CLI y ejecución fuera de la interfaz**

| Entrada manual o build | Estado y efecto | Archivo |
| --- | --- | --- |
| Auditorías Olivia | [SOLO BACKEND] Resuelven capacidades, convivencia de herramientas/guías y latencia con fixtures/mediciones de desarrollo. No forman parte del launcher de producción. | `scripts/audit-olivia-capabilities.mjs`, `scripts/audit-olivia-copilot.mjs`, `scripts/audit-olivia-guidance.mjs`, `scripts/audit-olivia-latency.mjs` |
| Producción de recursos | [SOLO BACKEND] Genera clips de conversación/biblioteca, animación Lottie, placeholders y optimiza imágenes. Las páginas consumen recursos generados. | `scripts/build-olivia-conversation-clips.mjs`, `scripts/build-olivia-speech-library.mjs`, `scripts/build-shipping-lottie.mjs`, `scripts/generate_placeholders.py`, `scripts/optimize_flor_mia_assets.py` |
| Migración/clonado | [SOLO BACKEND] Entradas CLI con lectura y, en los modos autorizados, escritura/mapeo de datos legacy. Quedan fuera de la ejecución web y del despliegue de este documento. | `scripts/clone-firestore.mjs`, `scripts/migrate-legacy-data.mjs`, `scripts/legacy-migration/domain.mjs`, `scripts/legacy-migration/cleanup.mjs` |
| Validación de entorno y despliegue | [SOLO BACKEND] Vite valida identidad cliente al construir un preview. Function diagnóstica comprueba el servidor. CI y emulador verifican el repositorio, y el workflow de Firestore despliega reglas/índices de producción bajo su condición de rama. | `scripts/validate-preview-firebase.mjs`, `vite.config.js`, `netlify/functions/preview-firebase-status.mjs`, `.github/workflows/ci.yml`, `.github/workflows/arca-ci.yml`, `.github/workflows/deploy-firestore.yml` |


## 4. Catálogo Exhaustivo de Capacidades — Página Web E-Commerce

**Acceso y condición de operación.** `src/Storefront.jsx` monta las páginas y el carrito. `src/surfaces/EcommerceSurface.jsx` las hace alcanzables públicamente en el modo independiente. En el unificado `/` pertenece a Gestión y `/tienda` abre la portada del storefront. La tienda del unificado tiene gate de administrador por defecto. El modo público depende de `VITE_STOREFRONT_PUBLIC`. Los servicios comerciales usan `/.netlify/functions/` en el mismo origen, sin URL alternativa en `src/services/ecommerceService.js`. `deploy/ecommerce/netlify.toml` configura Functions vacías y CSP `connect-src 'self'`. La interfaz independiente puede verse, pero la configuración versionada de ese paquete no entrega el servicio comercial.

### 4.1 Portada, marca y navegación — [FUNCIONAL]

Presenta la oferta y dirige al visitante a secciones y productos según los datos disponibles.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/` en modo E-Commerce | Portada pública. | `src/surfaces/EcommerceSurface.jsx`, `src/pages/HomePage.jsx` |
| `/tienda` | Misma portada, con enlaces a secciones mediante fragmento. | `src/Storefront.jsx`, `src/pages/HomePage.jsx` |
| `/nosotros` | Origen, tienda y selección de Flor Mía. | `src/pages/AboutPage.jsx` |

1. [FUNCIONAL] Navegar por menú escritorio/móvil, anuncios, categorías, novedades destacadas, intensidades y ocasiones. Seleccionar perfil de oliva y saltar a secciones con anclas. Abrir búsqueda y carrito desde el header. `src/components/Header.jsx`, `src/components/AnnouncementBar.jsx`, `src/pages/HomePage.jsx`, `src/data/oliveProfiles.js`, `src/data/brand.js`.
2. [FUNCIONAL] Consultar información editorial y enlaces de marca/contacto del pie. Instagram tiene enlace externo. Teléfono, mapa, correo y WhatsApp del pie dependen de los campos de contacto, con texto de pendiente donde faltan. El enlace a Gestión se controla por modo y configuración. `src/pages/AboutPage.jsx`, `src/components/Footer.jsx`, `src/data/brand.js`.
3. [SOLO UI] Los destacados, promociones editoriales, mensajes de envío y recomendaciones de ocasión son presentación. El checkout no aplica descuentos por las tarjetas promocionales ni calcula servicio nacional. Selección editorial solo permite agregar una ficha vinculada y disponible comercialmente. `src/data/promotions.js`, `src/pages/HomePage.jsx`, `src/context/CommerceCatalogContext.jsx`, `netlify/functions/_lib/ecommerce/commerceDomain.mjs`.
4. [FUNCIONAL] Actualizar título, descripción, URL canónica y metadatos sociales. Publicar datos estructurados de tienda/producto. Una URL no reconocida monta la página de recuperación con enlaces. El paquete público de preview quita el sitemap y pide no indexar. `src/components/PageMeta.jsx`, `src/pages/NotFoundPage.jsx`, `src/Storefront.jsx`, `deploy/ecommerce/prepare-preview.mjs`, `deploy/ecommerce/netlify.toml`.

**Datos y estado.** El contenido y assets editoriales provienen de `src/data/` y `public/images/`. La navegación y las anclas no escriben en Firestore. La página auxiliar de audio indicada en 3.23 es un recurso estático, no una ruta del catálogo.

### 4.2 Catálogo y búsqueda — [INCOMPLETO]

Ayuda a descubrir productos por texto, categorías, colecciones y ocasiones.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/productos` | Índice de fichas comerciales, filtros, búsqueda, aviso de preparación y estados vacío/error. | `src/pages/CatalogPage.jsx`, `src/components/SearchExperience.jsx` |

1. [FUNCIONAL] Consultar catálogo por GET, unir datos comerciales con contenido editorial mediante IDs/slug y proyectar precio, existencia, IVA y disponibilidad. Los controles de venta se habilitan con producto activo, precio válido y saldo positivo en la fuente configurada. `src/context/CommerceCatalogContext.jsx`, `netlify/functions/ecommerce-catalog.mjs`, `netlify/functions/_lib/ecommerce/commerceService.mjs`.
2. [FUNCIONAL] Buscar con normalización de texto, tolerancia a variaciones y sugerencias. Agrupar resultados, abrir producto y combinar parámetros `q`, `categoria`, `coleccion`, `ocasion`. La búsqueda opera sobre el catálogo cargado. `src/components/SearchModal.jsx`, `src/components/SearchExperience.jsx`, `src/utils/search.js`, `src/pages/CatalogPage.jsx`, `src/data/catalogViews.js`.
3. [INCOMPLETO] En el build independiente versionado el catálogo solicita una Function ausente. Se mantiene contenido editorial de portada, pero el proveedor comercial registra error y carece de sustitución comercial por productos estáticos. En el unificado el GET monta una vista de lectura si está desplegado. Falta `ECOMMERCE_LOCATION_ID` implica precio/stock pendiente. `src/context/CommerceCatalogContext.jsx`, `src/services/ecommerceService.js`, `deploy/ecommerce/netlify.toml`.

**Datos y regla.** Lee `products` activos y `locations`/`locationStock/{id}/items` de origen web mediante REST Admin en servidor. `src/data/products.js` aporta atributos, imágenes y descripciones cuando encuentra correspondencia. La actualización es fetch inicial y refresco explícito del catálogo. La tienda no se suscribe a Firestore en tiempo real. `netlify/functions/_lib/ecommerce/commerceService.mjs`, `src/context/CommerceCatalogContext.jsx`.

### 4.3 Ficha de producto — [FUNCIONAL]

Expone la ficha comercial cuando el slug se puede resolver.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/producto/:slug` | Detalle descriptivo, foto, categoría, precio, estado, agregar al carrito y productos relacionados. | `src/pages/ProductPage.jsx` |

1. [FUNCIONAL] Abrir ficha por slug, consultar descripción, imagen, usos/formato/datos disponibles, volver al catálogo y escoger relacionados. La ficha muestra carga o producto no disponible si el slug carece de entrada comercial. `src/pages/ProductPage.jsx`, `src/context/CommerceCatalogContext.jsx`, `src/data/assetsManifest.js`.
2. [FUNCIONAL] Agregar el producto disponible y abrir el carrito. El HTML de ficha genera metadatos de producto/oferta con precio si existe. `src/pages/ProductPage.jsx`, `src/context/CartContext.jsx`, `src/components/PageMeta.jsx`.

**Datos y límite.** Comparte el catálogo de 4.2 y persiste en el carrito solo ID/cantidad. En el paquete sin Function los slugs comerciales no tienen fuente efectiva. `src/pages/ProductPage.jsx`, `src/services/ecommerceService.js`, `deploy/ecommerce/netlify.toml`.

### 4.4 Carrito — [FUNCIONAL]

Conserva la selección del visitante en este navegador y verifica si puede ir al checkout.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| Cajón superpuesto en las rutas de tienda | Líneas, cantidades, subtotal conocido, faltantes/precios pendientes, sugerencia y salida a checkout. | `src/components/CartDrawer.jsx`, `src/context/CartContext.jsx` |

1. [FUNCIONAL] Agregar unidades disponibles, modificar cantidad o quitar línea, mostrar unidades y subtotal, abrir/cerrar con foco y agregar sugerencia de otra categoría. Límite de 99 por línea en el estado del carrito. `src/context/CartContext.jsx`, `src/components/CartDrawer.jsx`, `src/hooks/useFocusTrap.js`.
2. [FUNCIONAL] Restaurar selección de `localStorage` (`flor-mia-cart-v2`) y resolver de nuevo los datos comerciales. Muestra faltantes/cambio de disponibilidad al perder correspondencia. El subtotal local es informativo. `src/context/CartContext.jsx`.
3. [INCOMPLETO] El carrito no reserva ni bloquea inventario. La validación de cantidad contra el saldo real se repite al registrar el pedido y al confirmar pago. `src/context/CartContext.jsx`, `netlify/functions/_lib/ecommerce/commerceDomain.mjs`, `netlify/functions/_lib/ecommerce/paymentService.mjs`.

### 4.5 Checkout, pedido y retiro — [INCOMPLETO]

Recoge datos de invitado y registra intención comercial si el entorno publica el backend y habilita el retiro.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| `/checkout` | Datos y contacto, Entrega, Pago, Confirmación y resultado. Vista vacía y bloqueos. | `src/pages/CheckoutPage.jsx` |

1. [FUNCIONAL] Ingresar nombre, email y teléfono válidos, notas y consentimiento opcional. Avanzar/volver entre pasos y recuperar borrador al recargar. `src/pages/CheckoutPage.jsx`, `netlify/functions/_lib/ecommerce/commerceDomain.mjs`.
2. [FUNCIONAL] Seleccionar retiro bajo `ECOMMERCE_PICKUP_ENABLED`, con costo de entrega cero. Releer catálogo, verificar precios/estado y solicitar el pedido. El backend normaliza y agrupa líneas, verifica cuenta de stock de la ubicación, precio e IVA, recalcula importe en ARS y usa ID estable/huella del pedido. Un reintento equivalente devuelve pedido previo. Un cambio incompatible no crea un segundo pedido con la misma clave. `src/pages/CheckoutPage.jsx`, `netlify/functions/ecommerce-checkout.mjs`, `netlify/functions/_lib/ecommerce/commerceService.mjs`, `netlify/functions/_lib/ecommerce/commerceDomain.mjs`.
3. [FUNCIONAL] Crear `orders` y `payments` en una operación de servidor. Deja `pending_payment`, `paymentStatus: "pending"` y `invoiceStatus: "not_requested"`. El resultado muestra ID, total y estados. Limpia carrito/borrador tras el éxito. En este paso todavía no se descuenta ni reserva stock, ni se crea venta/factura/envío. `netlify/functions/_lib/ecommerce/commerceService.mjs`, `src/pages/CheckoutPage.jsx`.
4. [SOLO UI] Entrega a domicilio figura como modalidad pendiente. Cliente y servidor bloquean su envío. No existe cotizador ni alta logística de ese pedido web. `src/pages/CheckoutPage.jsx`, `netlify/functions/_lib/ecommerce/commerceDomain.mjs`.
5. [INCOMPLETO] El pedido queda en esa pantalla con referencia de confirmación. El router no registra cuenta de comprador, historial/consulta pública del pedido o cancelación. El seguimiento logístico de Envíos usa rutas de Gestión/unificado, otro origen de operación y token. `src/Storefront.jsx`, `src/pages/CheckoutPage.jsx`, `src/App.jsx`, `src/gestion/shipping/ShippingPublicApp.jsx`.

**Persistencia.** `localStorage` guarda `flor-mia-checkout-draft-v2` con ID de solicitud, contacto, notas, consentimiento y, durante simulación, CUIT y pedido pendiente para recuperación. Los campos de dirección/ciudad/CP existen en el borrador inicial. El transporte a domicilio no se confirma. El cliente no escribe colecciones Firestore directamente. `src/pages/CheckoutPage.jsx`, `netlify/functions/ecommerce-checkout.mjs`, `firestore.rules`.

### 4.6 Pago y comprobante del pedido web — [INCOMPLETO]

Distingue el pedido pendiente de una transición de pago y su preparación fiscal.

| URL/Ruta | Qué muestra | Archivo principal |
| --- | --- | --- |
| Paso Pago y confirmación de `/checkout` | Estado de integración pendiente y, en local autorizado, opción de simular aprobación y plan fiscal. | `src/pages/CheckoutPage.jsx` |

1. [SOLO UI] Se menciona Payway pendiente y se muestra resumen/revisión. No hay tokenización de tarjeta, venta de pasarela, cobro en sandbox ni webhook Payway activo en este corte. `src/pages/CheckoutPage.jsx`, `netlify/functions/_lib/ecommerce/paymentContract.mjs`, `netlify/functions/`.
2. [FUNCIONAL] El administrador en entorno local habilitado consulta la capacidad y solicita aprobación simulada. El servicio revalida pedido, pago, origen, stock/precio y clave de operación, crea `sales` de origen web y movimientos, actualiza stock, y puede enlazar/enriquecer cliente CRM por teléfono. Los recursos se registran juntos y los reintentos no producen otro descuento de stock. `src/services/ecommerceService.js`, `netlify/functions/ecommerce-simulated-payment.mjs`, `netlify/functions/_lib/ecommerce/paymentService.mjs`, `netlify/functions/_lib/ecommerce/customerLink.mjs`.
3. [FUNCIONAL] Preparar el expediente fiscal ligado a venta/pago confirmados, consumidor final o CUIT, e informar plan sin solicitar CAE desde esta simulación. Si el armado fiscal falla luego del commit comercial, conserva el pedido para reintentar esa fase. `src/pages/CheckoutPage.jsx`, `netlify/functions/_lib/ecommerce/fiscalService.mjs`, `netlify/functions/ecommerce-simulated-payment.mjs`.
4. [SOLO BACKEND] Existe contrato de estados para Payway `pending`, `approved`, `rejected`, `cancelled`, usado como forma de confirmación en código interno. La única entrada de confirmación de pago registrada en este árbol invoca proveedor `simulation`. `netlify/functions/_lib/ecommerce/paymentContract.mjs`, `netlify/functions/_lib/ecommerce/paymentService.mjs`, `netlify/functions/ecommerce-simulated-payment.mjs`.

**Datos y límites.** `orders`, `payments`, `sales`, `customers`, `stockMovements`, `locationStock/{id}/items`, `auditLogs` e `invoices`. La simulación está bloqueada en `production`, `deploy-preview` y `branch-deploy`, aunque se configure su bandera. El límite de la pasarela es un hecho de este corte y no se extrapola a otros PRs. `netlify/functions/_lib/ecommerce/paymentContract.mjs`, `netlify/functions/_lib/ecommerce/paymentService.mjs`.

## 5. Integraciones y Servicios Externos (Entradas y Salidas)

Se cuentan **15 conexiones** identificables. Se incluyen plataforma de ejecución y enlaces externos funcionales. Los nombres de variables provienen de configuración o lecturas de código. Se omiten valores y credenciales.

| Servicio externo | Uso | Quién lo consume | Tipo de interacción | Variables de entorno | Evidencia |
| --- | --- | --- | --- | --- | --- |
| Firebase Authentication / Identity Toolkit | Login, sesión, alta de cuentas, validación backend del token y diagnóstico de preview. | App Integral. Tienda con gate/simulación | SDK cliente y REST servidor | `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`. Equivalentes `VITE_PREVIEW_FIREBASE_API_KEY`, `VITE_PREVIEW_FIREBASE_AUTH_DOMAIN`, `VITE_PREVIEW_FIREBASE_PROJECT_ID`, `VITE_PREVIEW_FIREBASE_STORAGE_BUCKET`, `VITE_PREVIEW_FIREBASE_MESSAGING_SENDER_ID`, `VITE_PREVIEW_FIREBASE_APP_ID`. Servidor `FIREBASE_WEB_API_KEY`, `FIREBASE_PROJECT_ID`. | `netlify.toml`, `src/gestion/services/firebase.js`, `netlify/functions/_lib/firebaseAuth.mjs`, `netlify/functions/preview-firebase-status.mjs`, `scripts/validate-preview-firebase.mjs` |
| Cloud Firestore | Perfiles, inventario, ventas, CRM y módulos. REST Admin con OAuth de cuenta de servicio para operaciones protegidas. | Ambos, vía servidor en la tienda | SDK, suscripciones, REST y transacciones | `FIREBASE_PROJECT_ID`, `VITE_FIREBASE_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`. Adaptadores aceptan `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_SERVICE_ACCOUNT_APP_INTEGRAL_FM` y guardas específicas del preview. | `src/gestion/services/firebase.js`, `netlify/functions/_lib/firestoreAdminRest.mjs`, `netlify/functions/_lib/serverFirestore.mjs`, `netlify/functions/_lib/olivia/store.mjs`, `firestore.rules` |
| Netlify | Hosting, fallback de SPA, Functions, trabajo diferido, cron y chequeo de preview. | Ambos | Build, HTTP del mismo origen, background y cron | `NODE_VERSION`, `CONTEXT`, `NETLIFY`, `NETLIFY_DEV`, `NETLIFY_LOCAL`, `NETLIFY_PREVIEW_SERVER`, `HEAD`, `SITE_ID`. Por modo `VITE_APP_SURFACE`, `VITE_STOREFRONT_PUBLIC`, `VITE_MANAGEMENT_URL`, `VITE_PUBLIC_APP_BASE_URL`. | `netlify.toml`, `deploy/ecommerce/netlify.toml`, `vite.config.js`, `scripts/validate-preview-firebase.mjs`, `netlify/functions/_lib/ecommerce/paymentContract.mjs` |
| GitHub Actions | Pruebas/build y workflow condicionado de reglas/índices Firestore desde `main`. | Infraestructura de ambos | PR, push y declaración de workflow | Para el despliegue, `FIREBASE_SERVICE_ACCOUNT_APP_INTEGRAL_FM`, `FIREBASE_SERVICE_ACCOUNT_INTEGRAL_FLOR_MIA`. | `.github/workflows/ci.yml`, `.github/workflows/arca-ci.yml`, `.github/workflows/deploy-firestore.yml` |
| ARCA | WSAA para TA, WSFE para parámetros/CAE/consulta, Padrón para contribuyente y receptor. | Gestión y plan fiscal web mediante servidor | SOAP servidor, QR fiscal como enlace | `ARCA_ENVIRONMENT`, `ARCA_ISSUER_CUIT`, `ARCA_POINT_OF_SALE`, `ARCA_CERTIFICATE_PEM`, `ARCA_PRIVATE_KEY_PEM`, `ARCA_TA_ENCRYPTION_KEY`, `ARCA_ISSUER_VAT_CONDITION`, `ARCA_DEFAULT_PRODUCT_VAT_RATE`, `ARCA_CONSUMER_FINAL_ID_THRESHOLD`, `ARCA_ISSUER_LEGAL_NAME`, `ARCA_ISSUER_COMMERCIAL_ADDRESS`, `ARCA_ISSUER_FISCAL_ADDRESS`, `ARCA_ISSUER_GROSS_INCOME`, `ARCA_ISSUER_ACTIVITY_START`, `ARCA_ALLOW_CAE_HOMOLOGATION`, `ARCA_ALLOW_PRODUCTION_READONLY`, `ARCA_ALLOW_PRODUCTION_INVOICE_PREPARE`, `ARCA_ALLOW_PRODUCTION_TAXPAYER_LOOKUP`, `ARCA_ALLOW_PRODUCTION_CAE`, `ARCA_PRODUCTION_CAE_SALE_CODE`, `ARCA_AUTO_AUTHORIZE_PRODUCTION`, `ARCA_AUTO_AUTHORIZE_PRODUCTION_SOURCES`. | `netlify/functions/_lib/arca/config.mjs`, `netlify/functions/_lib/arca/wsaa.mjs`, `netlify/functions/_lib/arca/wsfe.mjs`, `netlify/functions/_lib/arca/registry.mjs`, `netlify/functions/_lib/arca/invoiceQr.mjs`, `netlify/functions/_lib/arca/invoicePdf.mjs` |
| Servidor SMTP configurable | Verificar conexión y enviar PDF de comprobante autorizado a destinatario validado. | App Integral | SMTP servidor con Nodemailer | `INVOICE_SMTP_HOST`, `INVOICE_SMTP_PORT`, `INVOICE_SMTP_USER`, `INVOICE_SMTP_PASSWORD`, `INVOICE_SMTP_FROM`. | `netlify/functions/_lib/arca/invoiceEmail.mjs`, `netlify/functions/arca-document.mjs` |
| Google Drive / Google OAuth | Consentimiento, intercambio/renovación/revocación, carpetas y archivos creativos con sesiones de subida. | App Integral | OAuth con callback GET, API servidor y subida reanudable | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_TOKEN_ENCRYPTION_KEY`. Opcionales `GOOGLE_DRIVE_ROOT_FOLDER_NAME`, `GOOGLE_DRIVE_SHARED_DRIVE_ID`, `META_ADS_MAX_UPLOAD_BYTES`, `META_ADS_UPLOAD_CHUNK_BYTES`. | `netlify/functions/_lib/googleDrive.mjs`, `netlify/functions/google-drive-callback.mjs`, `netlify/functions/google-drive.mjs`, `src/gestion/marketing/metaAds/googleDriveService.js` |
| OpenAI | Olivia texto, adjuntos y conocimiento vectorial, búsqueda pública, transcripción de archivo y en vivo. Compilador y planificador Meta Ads. | App Integral | API servidor. Sesión WebRTC de transcripción negociada a través de servidor | `OPENAI_API_KEY`. Ajustes `OLIVIA_ENABLED`, `OLIVIA_MODEL_ADMIN`, `OLIVIA_MODEL_SELLER`, `OLIVIA_MODEL_CREATIVE`, `OPENAI_THEORY_MODEL`, `OPENAI_QUESTION_MODEL`, `OPENAI_CAMPAIGN_PLAN_MODEL`, `OPENAI_THEORY_INPUT_USD_PER_MTOK`, `OPENAI_THEORY_OUTPUT_USD_PER_MTOK`, `OPENAI_PLANNER_INPUT_USD_PER_MTOK`, `OPENAI_PLANNER_OUTPUT_USD_PER_MTOK`. | `netlify/functions/_lib/olivia/provider.mjs`, `netlify/functions/_lib/olivia/liveTranscription.mjs`, `netlify/functions/_lib/olivia/voice.mjs`, `netlify/functions/_lib/olivia/knowledge.mjs`, `netlify/functions/_lib/olivia/research.mjs`, `netlify/functions/theory-compiler.mjs`, `netlify/functions/campaign-planner.mjs` |
| Google Cloud Text-to-Speech | Síntesis Chirp 3 HD en stream y generación manual del banco de audio. | App Integral | SDK servidor y CLI de desarrollo | `GOOGLE_APPLICATION_CREDENTIALS_JSON` o `GOOGLE_APPLICATION_CREDENTIALS`. `GOOGLE_CLOUD_PROJECT` según configuración. | `netlify/functions/_lib/olivia/chirp.mjs`, `src/shared/oliviaVoiceAvailability.mjs`, `scripts/build-olivia-speech-library.mjs` |
| Banco Nación | Cotización oficial vendedora de referencia para mostrar costos de Olivia. | App Integral | GET y extracción de HTML en servidor, con caché | — | `netlify/functions/_lib/olivia/pricing.mjs` |
| PyME Nación | Fuente alterna de la misma cotización cuando falla o es inválida la primera. | App Integral | GET/extracción en servidor | — | `netlify/functions/_lib/olivia/pricing.mjs` |
| WhatsApp / extensión privada | Entrega y control de lote por puente Chrome. Abrir contacto CRM disponible mediante enlace `wa.me`. | App Integral | PostMessage y navegación externa | — | `src/gestion/marketing/whatsapp/extensionBridge.js`, `src/gestion/marketing/whatsapp/WhatsAppExtensionSync.jsx`, `src/gestion/customers/customerDomain.js` |
| Instagram | Navegar al perfil de la marca. Canal de venta anotado manualmente en Gestión. | E-Commerce y referencia manual de App Integral | Enlace externo | — | `src/data/brand.js`, `src/components/Footer.jsx`, `src/modules/locations/domain/channels.js` |
| OpenStreetMap | Teselas de mapa para revisar/editar manualmente el destino. | App Integral | Teselas cliente con Leaflet | `VITE_SHIPPING_TILE_URL` opcional | `src/gestion/shipping/ShippingMap.jsx`, `netlify.toml` |
| Google Maps | Abrir navegación externa de una dirección desde el portal/detalle habilitado. | App Integral | Enlace externo | — | `src/gestion/shipping/CourierPortal.jsx`, `src/gestion/shipping/ShipmentDetail.jsx` |

**Contratos sin servicio externo conectado.**

- [SOLO UI] Analítica del storefront emite eventos permitidos a `window.dataLayer` si existe y a `flor-mia:analytics`. Este árbol no instala un proveedor de analítica ni un tag de conversión. `purchase_intent_created` se invoca desde checkout pero queda fuera de la lista de eventos admitidos. `src/utils/analytics.js`, `src/pages/CheckoutPage.jsx`, `index.html`.
- [SOLO BACKEND] Payway está nombrado en el dominio. `ECOMMERCE_LOCATION_ID`, `ECOMMERCE_PICKUP_ENABLED` y `ECOMMERCE_SIMULATED_PAYMENT_ENABLED` parametrizan stock/retiro y simulación, sin conexión de pasarela. `netlify/functions/_lib/ecommerce/commerceDomain.mjs`, `netlify/functions/_lib/ecommerce/paymentContract.mjs`.
- [SOLO UI] Meta Ads no llama al proveedor de anuncios. Uber no dispara una orden externa. Eventos de tracking quedan en outbox con adaptador desactivado. `src/gestion/pages/MetaAdsPage.jsx`, `src/shared/shippingDomain.mjs`, `netlify/functions/_lib/shipping.mjs`.
- [SOLO BACKEND] El backend de Envíos lee `SHIPPING_ENABLED`, `SHIPPING_REPOSITORY_ADDRESS`, `SHIPPING_COURIER_TTL_HOURS`, `SHIPPING_TRACKING_TTL_HOURS`. El bucket figura en configuración Firebase. No se detectó un flujo cliente de Firebase Storage. `netlify/functions/shipping.mjs`, `netlify/functions/_lib/shipping.mjs`, `src/gestion/services/firebase.js`.


## 6. Mapa Macro de Datos y Flujos Críticos de Negocio

### Inventario de entidades de datos

**Convención.** I significa App Integral FM. E significa E-Commerce. «Servidor» indica Functions o automatización. Las lecturas están sujetas a las reglas y guardas del módulo. Una fila representa una colección o subcolección por ruta. Los documentos particulares de configuración y los campos embebidos se explican dentro de su colección. El inventario incluye **91 rutas Firestore** (reglas explícitas más rutas halladas por acceso servidor) y el cuadro de recursos de identidad, navegador y servicios.

**Operación e inventario**

| Colección / recurso | Qué almacena | Quién escribe | Quién lee | Evidencia |
| --- | --- | --- | --- | --- |
| `users` | Perfil, rol/acciones, actividad, ubicaciones y perfil de visualización. | I administración, asignaciones y perfil en operaciones autorizadas | I sesión, asignaciones, administración y servidor | `src/gestion/services/managementService.js`, `src/gestion/services/locationManagementService.js`, `firestore.rules` |
| `roles` | Contrato de documentos de rol. | Reglas para administración. Sin escritor web hallado | Reglas para administración. Las plantillas activas están en código | `firestore.rules`, `src/gestion/permissions.js` |
| `permissions` | Contrato de documentos de permisos. | Reglas para administración. Sin editor activo | Reglas para administración. La sesión toma permisos del perfil | `firestore.rules`, `src/gestion/permissions.js` |
| `settings` | `keyboardShortcuts`, `financeConfig`, `crmLoyalty` y contratos/sondas `operatingHolidays`, `arca_diagnostics_probe`, `previewFirebaseStatus`. | I Finanzas/CRM. Calendario huérfano y datos de configuración fuera de sus pantallas | I Vendedor, Finanzas, CRM y servidor | `src/gestion/services/sharedResources.js`, `src/gestion/finance/financeService.js`, `src/gestion/customers/crmService.js`, `src/gestion/services/operatingCalendarService.js`, `netlify/functions/arca-taxpayer.mjs`, `netlify/functions/preview-firebase-status.mjs` |
| `locations` | Local, feria/evento, prefijo, calendario, listas de asignación/estado. | I Ubicaciones, Olivia y operaciones autorizadas | Ambos. E vía catálogo/checkout | `src/gestion/services/locationManagementService.js`, `netlify/functions/_lib/ecommerce/commerceService.mjs` |
| `warehouses` | Depósito, datos de operación y estado. | I inventario y Olivia | I Depósitos, Ventas, Envíos, Olivia | `src/gestion/services/inventoryService.js`, `netlify/functions/_lib/olivia/extendedOperations.mjs` |
| `products` | Maestro, precio base, categoría, datos fiscales e imagen. | I catálogo, unificación y carga asistida de Olivia | Ambos. E vía catálogo/checkout | `src/gestion/services/inventoryService.js`, `netlify/functions/_lib/catalogMerge.mjs`, `netlify/functions/_lib/ecommerce/commerceService.mjs` |
| `productCategories` | Categorías y subcategorías del maestro. | I catálogo/Olivia | I operación y catálogo con referencias de producto | `src/gestion/services/catalogOrganizationService.js`, `netlify/functions/_lib/olivia/catalogStock.mjs` |
| `discounts` | Promociones autorizables, reglas e importes. | Contrato I admin. El alta directa carece de UI en este corte | I Ubicaciones, POS, Métricas, Olivia | `src/gestion/services/locationManagementService.js`, `src/gestion/services/sellerService.js`, `firestore.rules` |
| `locationStock` | Documento padre por ubicación, con reglas propias. | Reglas I. La operación usa sus ítems | I vía subcolección | `firestore.rules`, `src/gestion/services/inventoryService.js` |
| `locationStock/{locationId}/items` | Stock, precio/configuración local y vínculos de producto/movimiento. | Ambos. E solo en confirmación server-side funcionando en modo simulado | Ambos. E por proyección | `src/gestion/services/inventoryService.js`, `src/gestion/services/sellerService.js`, `netlify/functions/_lib/ecommerce/paymentService.mjs` |
| `warehouseStock` | Documento padre de inventario de depósito. | Cliente denegado. La operación usa ítems | Cliente denegado en padre. Inventario lee subcolección | `firestore.rules`, `src/gestion/services/inventoryService.js` |
| `warehouseStock/{warehouseId}/items` | Existencias y snapshots de producto por depósito. | I inventario, ventas administrativas, unificación y envíos | I Depósitos, Venta Rápida, Envíos, Olivia | `src/gestion/services/inventoryService.js`, `src/gestion/services/quickSaleStockService.js`, `netlify/functions/_lib/shipping.mjs` |
| `stockMovements` | Ingresos, ajustes, traslados, ventas y reversiones. Saldo, unidades y vínculo de origen. | Ambos. E aprobación simulada vía servidor | I inventario, Actividad, Olivia | `src/gestion/services/inventoryService.js`, `src/shared/operationalWritePlans.mjs`, `netlify/functions/_lib/ecommerce/paymentService.mjs` |
| `stockOperations` | Registro de operación de stock local, idempotencia o evidencia. | I inventario local/Olivia | I servicios de inventario/Olivia | `src/gestion/services/locationManagementService.js`, `netlify/functions/_lib/olivia/operations.mjs`, `firestore.rules` |
| `inventoryOperations` | Recibo de operación de inventario y correlación con resultado. | I inventario/Olivia | I inventario/Olivia para verificar repetición | `src/gestion/services/inventoryService.js`, `netlify/functions/_lib/olivia/catalogStock.mjs`, `firestore.rules` |
| `stockTransfers` | Origen, destino, líneas/movimientos y cantidades para transferencia. | I transferencias y Olivia | I inventario, Actividad, Olivia | `src/shared/stockTransferWritePlans.mjs`, `src/gestion/services/inventoryService.js` |
| `sales` | Venta, código, fecha local, origen/tipo, líneas, pagos, descuentos, estado, enlaces fiscal/logístico/CRM. | Ambos. I POS/Olivia/Envíos y E confirmación simulada por servidor | I paneles, CRM, métricas, fiscal. E backend para confirmación | `src/gestion/services/sellerService.js`, `src/shared/operationalWritePlans.mjs`, `netlify/functions/_lib/ecommerce/paymentService.mjs` |
| `counters` | Numeración por operación/origen y fecha comercial. | I ventas POS/Envíos/Olivia | I transacciones de alta de venta, autorización por reglas | `src/gestion/services/sellerService.js`, `netlify/functions/_lib/shipping.mjs`, `firestore.rules` |
| `customers` | Identidad por teléfono, datos enriquecidos, zona, flags y última compra. | Ambos. I CRM/POS/Olivia y E confirmación simulada | I y E por backend de CRM de la operación web | `src/gestion/services/customerService.js`, `src/gestion/customers/customerDomain.js`, `netlify/functions/_lib/ecommerce/customerLink.mjs` |
| `customers/{customerId}/interactions` | Contrato de interacción CRM. | Reglas I edición CRM. [SOLO BACKEND] | Reglas I lectura CRM. Ficha activa consulta ventas | `firestore.rules`, `src/gestion/pages/LoyalCustomersPage.jsx` |
| `customerZones` | Maestro de zonas activas/inactivas. | I Clientes | I CRM, POS, filtros y herramientas | `src/gestion/services/customerService.js` |
| `auditLogs` | Acción, actor, entidad, fecha y snapshots/razón de operaciones. | Ambos, desde las operaciones I y E server-side | I Actividad, Auditoría, Finanzas y Olivia con alcance | `src/gestion/services/dashboardService.js`, `src/shared/activitySnapshots.mjs`, `netlify/functions/_lib/ecommerce/paymentService.mjs`, `firestore.rules` |
| `alerts` | Alertas con origen, estado, responsable y evidencia. | I envíos, finanzas y Olivia | I paneles, avisos, asistente según alcance | `src/gestion/services/alertsService.js`, `src/gestion/finance/financeService.js`, `netlify/functions/_lib/shipping.mjs` |
| `dailySummaries` | Contrato para resúmenes diarios. | Reglas I admin. Sin materializador activo hallado | Contrato Métricas. Cálculo activo sobre `sales` | `firestore.rules`, `src/gestion/modules.js`, `src/gestion/pages/SalesMetricsPage.jsx` |

**Comercio, finanzas y fiscal**

| Colección / recurso | Qué almacena | Quién escribe | Quién lee | Evidencia |
| --- | --- | --- | --- | --- |
| `orders` | Pedido web, snapshot de líneas/contacto/retiro, estado y enlaces a pago/venta/factura. | E por Function. Fase fiscal servidor | I módulo Pedidos web/Olivia/Finanzas y E servicio del pedido | `netlify/functions/_lib/ecommerce/commerceService.mjs`, `netlify/functions/_lib/ecommerce/fiscalService.mjs`, `firestore.rules` |
| `payments` | Pago comercial web, importe, proveedor/estado/referencia y vínculo. | E por Function, pendiente/simulado | I lectura permitida y E confirmación servidor | `netlify/functions/_lib/ecommerce/commerceService.mjs`, `netlify/functions/_lib/ecommerce/paymentService.mjs`, `firestore.rules` |
| `invoices` | Solicitud, receptor, importes fiscales, autorización, CAE, conciliación, factura/nota de crédito. | Ambos mediante servidor en sus flujos | I fiscal/POS/Finanzas. E estado de plan fiscal mediante servidor | `netlify/functions/_lib/arca/invoicePersistence.mjs`, `netlify/functions/_lib/ecommerce/fiscalService.mjs` |
| `arcaWsaaTickets` | TA cifrado y estado de vigencia/bloqueo por ambiente/servicio. | Servidor fiscal I | Servidor fiscal I | `netlify/functions/_lib/arca/wsaaSharedCache.mjs`, `firestore.rules` |
| `arcaSequenceLocks` | Reserva de secuencia fiscal para autorizar de manera coordinada. | Servidor fiscal I | Servidor fiscal I | `netlify/functions/_lib/arca/sequenceLock.mjs`, `firestore.rules` |
| `invoiceEmailRequests` | Intento de envío, estado y recibo idempotente SMTP. | Servidor I | Servidor I | `netlify/functions/_lib/arca/invoiceEmail.mjs` |
| `invoiceEmailLimits` | Ventana de control de reintentos por comprobante. | Servidor I | Servidor I | `netlify/functions/_lib/arca/invoiceEmail.mjs` |
| `financialEntries` | Gastos, ingresos extra, presupuestos y evidencia de acreditaciones. | I Finanzas y Olivia para gastos autorizados | I Finanzas, Actividad, Olivia | `src/gestion/finance/financeService.js`, `netlify/functions/_lib/olivia/extendedOperations.mjs` |
| `cashSessions` | Contrato de sesiones de caja. | Reglas I Finanzas. Sin operación de pantalla hallada | Reglas I Finanzas | `firestore.rules`, `src/gestion/pages/FinancePage.jsx` |
| `suppliers` | Registro de proveedor, notas y estado. | I Proveedores y Olivia | I Proveedores, Finanzas y Olivia | `src/gestion/modules.js`, `src/gestion/services/managementService.js`, `src/gestion/finance/financeService.js` |
| `purchases` | Contrato de registro de compras. | Reglas I Proveedores. Sin entrada de compra en la pantalla | Reglas I Proveedores | `firestore.rules`, `firestore.indexes.json`, `src/gestion/pages/GenericModulePage.jsx` |

**Logística**

| Colección / recurso | Qué almacena | Quién escribe | Quién lee | Evidencia |
| --- | --- | --- | --- | --- |
| `shipments` | Envío asociado a venta, destino, snapshots, asignación, tramo, estado, incidencias y versiones. | Servidor I, incluidas acciones de preparador/repartidor autorizadas | I autorizado, Finanzas puntual y portales por proyección | `netlify/functions/_lib/shipping.mjs`, `netlify/functions/_lib/shippingFeed.mjs`, `firestore.rules` |
| `shipments/{shipmentId}/events` | Bitácora de pasos, actores, revisiones, motivo y evidencia. | Servidor I | I y backend según acceso | `netlify/functions/_lib/shipping.mjs`, `firestore.rules` |
| `shipments/{shipmentId}/operations` | Recibo idempotente de operación logística. | Servidor I | Servidor I | `netlify/functions/_lib/shipping.mjs`, `firestore.rules` |
| `shipmentAccess` | Grant temporal de seguimiento/reparto por envío y tramo. | Servidor I | Servidor I | `netlify/functions/_lib/shipping.mjs`, `firestore.rules` |
| `shipmentLookups` | Relación entre QR público de etiqueta y envío. | Servidor I | Servidor I | `netlify/functions/_lib/shipping.mjs`, `firestore.rules` |
| `deliverySessions` | Recorrido, miembros, vigencia, versión y estado de sesión. | Servidor I | I Gestión según permiso, backend y portal proyectado | `netlify/functions/_lib/shipping.mjs`, `src/gestion/services/shippingService.js`, `firestore.rules` |
| `deliverySessionAccess` | Grant temporal de ruta/sesión. | Servidor I | Servidor I | `netlify/functions/_lib/shipping.mjs`, `firestore.rules` |
| `shippingRouteOperations` | Recibos de creación/reemplazo de recorrido. | Servidor I | Servidor I | `netlify/functions/_lib/shipping.mjs`, `firestore.rules` |
| `shippingQrOperations` | Recibo para reintentar activación de QR. | Servidor I | Servidor I | `netlify/functions/_lib/shipping.mjs` |
| `shippingRateLimits` | Contador temporal de solicitudes públicas. | Servidor I | Servidor I | `netlify/functions/_lib/shipping.mjs`, `firestore.rules` |
| `shippingOutbox` | Evento preparado de seguimiento con adaptador desactivado. | Servidor I | Sin despachador activo | `netlify/functions/_lib/shipping.mjs`, `firestore.rules` |

**Marketing**

| Colección / recurso | Qué almacena | Quién escribe | Quién lee | Evidencia |
| --- | --- | --- | --- | --- |
| `socialLeads` | Consulta social, estado y notas. | I Redes/Olivia | I Redes/Olivia | `src/gestion/modules.js`, `src/gestion/services/managementService.js`, `netlify/functions/_lib/olivia/extendedTools.mjs` |
| `campaigns` | Registro de campaña genérica. | I Marketing/Olivia | I Marketing/Olivia | `src/gestion/modules.js`, `src/gestion/services/managementService.js`, `firestore.rules` |
| `contentItems` | Contrato de contenidos. | Reglas I Marketing. Calendario sin pantalla activa | Reglas I Marketing | `firestore.rules`, `src/gestion/pages/GenericModulePage.jsx` |
| `whatsappCampaigns` | Borrador, selección, estado/contadores y entrega al emisor. | I cliente de campañas y reconciliación | I campañas y Olivia con permiso | `src/gestion/marketing/whatsapp/campaignService.js`, `firestore.rules` |
| `whatsappCampaigns/{campaignId}/recipients` | Snapshot de destinatario y resultado por contacto. | I previsualización/entrega y reconciliación | I campañas con permiso | `src/gestion/marketing/whatsapp/campaignService.js`, `firestore.rules` |
| `whatsappCampaigns/{campaignId}/events` | Eventos y cambios de campaña. | I campañas/reconciliación | I historial de campaña | `src/gestion/marketing/whatsapp/campaignService.js`, `firestore.rules` |
| `marketingKnowledge` | Contexto del negocio en documento `businessContext`. | I Meta Ads Conocimiento | I Meta Ads Conocimiento y Planner servidor | `src/gestion/marketing/metaAds/knowledgeService.js`, `netlify/functions/campaign-planner.mjs` |
| `marketingProductProfiles` | Metadata de marketing asociada al producto maestro. | I Meta Ads Conocimiento | I Meta Ads Conocimiento y Planner servidor | `src/gestion/marketing/metaAds/knowledgeService.js`, `netlify/functions/campaign-planner.mjs` |
| `metaAdTheories` | Raíz de metodología, versión corriente y estado. | I Metodologías | I Metodologías y Planificación | `src/gestion/marketing/metaAds/theoryService.js`, `firestore.rules` |
| `metaAdTheories/{theoryId}/versions` | Fuente, configuración, revisión/activación por versión. | I Metodologías | I Metodologías, Planificación y Workspace | `src/gestion/marketing/metaAds/theoryService.js`, `netlify/functions/google-drive.mjs` |
| `metaCampaignProjects` | Proyecto, producto, teoría elegida, plan y datos de Drive. | I proyectos y workspace servidor | I Meta Ads y Olivia por permiso | `src/gestion/marketing/metaAds/campaignProjectService.js`, `netlify/functions/google-drive.mjs` |
| `metaCampaignProjects/{campaignId}/planning` | Estado de planificación, preguntas/respuestas y revisión activa. | I Planificación | I Planificación/Planner servidor | `src/gestion/marketing/metaAds/campaignPlanningService.js`, `netlify/functions/campaign-planner.mjs` |
| `metaCampaignProjects/{campaignId}/plans` | Revisiones del plan, estrategia, guiones, estado y aprobación. | I Planificación | I Planificación/Workspace | `src/gestion/marketing/metaAds/campaignPlanningService.js`, `netlify/functions/google-drive.mjs` |
| `metaCampaignProjects/{campaignId}/recordingTasks` | Tareas derivadas del plan, instrucciones, progreso y toma. | Servidor I Drive | I Workspace Creativo | `netlify/functions/google-drive.mjs`, `src/gestion/pages/MetaAdsCreativeWorkspace.jsx` |
| `metaCampaignProjects/{campaignId}/creativeAssets` | Referencia y metadata de archivos creativos/tomas. | Servidor I Drive | I Workspace Creativo | `netlify/functions/google-drive.mjs`, `firestore.rules` |
| `integrationConnections` | Señal operativa de conexión/cuenta/carpeta Drive. | Servidor I OAuth/Drive | I Configuración/Workspace y servidor | `netlify/functions/_lib/googleDrive.mjs`, `firestore.rules` |
| `integrationSecrets` | Refresh token Drive protegido. | Servidor I | Servidor I | `netlify/functions/_lib/googleDrive.mjs`, `firestore.rules` |
| `integrationOauthStates` | Estado temporal del consentimiento Google. | Servidor I | Callback OAuth servidor I | `netlify/functions/google-drive.mjs`, `netlify/functions/google-drive-callback.mjs` |
| `creativeUploadSessions` | Sesión de subida y consistencia entre tarea/archivo. | Servidor I | Servidor I | `netlify/functions/google-drive.mjs`, `firestore.rules` |
| `aiUsage` | Uso/costo conocido de compilación y planificación Meta Ads. | I servicio de Metodologías y Planificación según acción | I Marketing con permiso | `src/gestion/marketing/metaAds/theoryService.js`, `src/gestion/marketing/metaAds/campaignPlanningService.js`, `firestore.rules` |

**Olivia**

| Colección / recurso | Qué almacena | Quién escribe | Quién lee | Evidencia |
| --- | --- | --- | --- | --- |
| `oliviaConfiguration` | Política, modelos, precios, voz, retención y cambios administrativos. | Servidor I por configuración autorizada | Servidor I y UI autorizada por Function | `netlify/functions/_lib/olivia/engine.mjs`, `src/shared/oliviaContracts.mjs` |
| `oliviaConversations` | Propietario, estado, contexto, memoria y plazos de conversación. | Servidor I | Servidor I y usuario/autorizado por proxy | `netlify/functions/_lib/olivia/conversations.mjs`, `netlify/functions/olivia-retention.mjs` |
| `oliviaConversations/{conversationId}/messages` | Historial de mensajes de chat paginable. | Servidor I | Servidor I con reglas de propietario/admin | `netlify/functions/_lib/olivia/conversations.mjs` |
| `oliviaConfirmations` | Propuesta, dueño, argumentos canónicos, validez y ejecución. | Servidor I | Servidor I, resultado para el actor | `netlify/functions/_lib/olivia/operations.mjs`, `netlify/functions/_lib/olivia/engine.mjs` |
| `oliviaIdentifierClaims` | Reserva de identificador operativo para alta asistida de ubicación. | Servidor I | Servidor I | `netlify/functions/_lib/olivia/extendedOperations.mjs` |
| `oliviaChatJobs` | Trabajo diferido, solicitud, estado y resultado recuperable. | Servidor I | Servidor I y UI por estado de job | `netlify/functions/_lib/olivia/chatJobs.mjs`, `netlify/functions/olivia-chat-background.mjs` |
| `oliviaErrorReports` | Reporte de fallo, clasificación, resumen y estado de envío. | Servidor I | Servidor I. Se proyecta a Alertas cuando corresponde | `netlify/functions/_lib/olivia/errorReports.mjs` |
| `oliviaRequests` | Huella de solicitud, reserva, estado/consumo y resultado idempotente. | Servidor I | Servidor I | `netlify/functions/_lib/olivia/engine.mjs`, `netlify/functions/_lib/olivia/usage.mjs`, `netlify/functions/olivia-retention.mjs` |
| `oliviaUsage` | Eventos de tokens/audio/herramientas, medición y costo. | Servidor I | Servidor I y UI de consumo por Function | `netlify/functions/_lib/olivia/usage.mjs`, `netlify/functions/_lib/olivia/chirp.mjs`, `netlify/functions/_lib/olivia/liveTranscription.mjs` |
| `oliviaBudgets` | Reservas y acumulados de cupos de uso. | Servidor I | Servidor I | `netlify/functions/_lib/olivia/usage.mjs`, `netlify/functions/_lib/olivia/engine.mjs` |
| `oliviaQuotaRequests` | Solicitudes de ampliación y estado de atención. | Servidor I por usuario/admin según operación | Servidor I y Configuración autorizada | `netlify/functions/_lib/olivia/engine.mjs`, `src/gestion/olivia/OliviaSettings.jsx` |
| `oliviaAnonymousUsage` | Agregados anonimizados que deja la retención. | Job servidor I | Job servidor I | `netlify/functions/olivia-retention.mjs`, `firestore.rules` |
| `oliviaAttachments` | Titular/vigencia de adjunto y referencia de archivo. | Servidor I con usuario autorizado. Retención retira | Servidor I con autorización y job | `netlify/functions/_lib/olivia/attachments.mjs`, `netlify/functions/olivia-resource-retention.mjs` |
| `oliviaUploadBudgets` | Uso de adjuntos por usuario/ventana. | Servidor I | Servidor I | `netlify/functions/_lib/olivia/attachments.mjs`, `netlify/functions/olivia-resource-retention.mjs` |
| `oliviaKnowledgeDocuments` | Metadata, audiencia, módulo, vigencia y archivo/vector del documento. | Servidor I por biblioteca administrada | Servidor I para recuperación/listado y limpieza | `netlify/functions/_lib/olivia/knowledge.mjs` |
| `oliviaKnowledgeSettings` | Referencia a la biblioteca vectorial permanente. | Servidor I | Servidor I | `netlify/functions/_lib/olivia/knowledge.mjs`, `firestore.rules` |
| `oliviaToolEvents` | Registro de uso/efecto de herramientas con correlación. | Servidor I | Servidor I para operación/retención | `netlify/functions/_lib/olivia/toolExecution.mjs`, `netlify/functions/_lib/olivia/engine.mjs`, `netlify/functions/olivia-resource-retention.mjs` |
| `oliviaRealtime` | Estado de sesión de transcripción y registros de voz previos. | Servidor I transcripción/cleanup | Servidor I | `netlify/functions/_lib/olivia/liveTranscription.mjs`, `netlify/functions/olivia-voice-cleanup.mjs` |
| `oliviaRealtimeToolCalls` | Registros residuales de herramientas realtime del contrato anterior. | Sin escritor activo hallado. Job de limpieza | Servidor I retención | `netlify/functions/olivia-resource-retention.mjs`, `firestore.rules` |
| `oliviaRealtimeTurns` | Registros residuales de turnos realtime del contrato anterior. | Sin escritor activo hallado. Job de limpieza | Servidor I retención | `netlify/functions/olivia-resource-retention.mjs`, `firestore.rules` |
| `oliviaLiveDelegations` | Registros residuales de delegación de voz. | Sin escritor activo hallado. Job de limpieza | Servidor I retención | `netlify/functions/olivia-resource-retention.mjs`, `firestore.rules` |
| `oliviaVoiceBudgets` | Ventana/reserva de voz natural/transcripción. | Servidor I | Servidor I y job | `netlify/functions/_lib/olivia/chirp.mjs`, `netlify/functions/_lib/olivia/liveTranscription.mjs`, `netlify/functions/olivia-retention.mjs` |
| `oliviaVoiceRequests` | Solicitudes de síntesis y su coste/estado. | Servidor I | Servidor I y job | `netlify/functions/_lib/olivia/chirp.mjs`, `netlify/functions/olivia-retention.mjs` |
| `oliviaPrivateSpeech` | Audio personalizado temporal, vigencia, versión y comprobación de integridad. | Servidor I | Servidor I y retención | `netlify/functions/_lib/olivia/speechAudio.mjs`, `netlify/functions/olivia-retention.mjs` |

**Identidad, navegador y archivos**

| Colección / recurso | Qué almacena | Quién escribe | Quién lee | Evidencia |
| --- | --- | --- | --- | --- |
| Cuenta Firebase Auth | Identidad, login email y contraseña a través de Firebase. | I alta administrada y Auth | I sesión y E gate/administrador local | `src/gestion/services/firebase.js`, `src/gestion/services/managementService.js` |
| Persistencia Firebase Auth del navegador | Sesión mediante `browserLocalPersistence` cuando está disponible. | SDK Firebase | I y gate privado de E | `src/gestion/services/firebase.js` |
| IndexedDB `flor_mia_integral_offline/seller_pending_sales` | Pendientes por vendedor, ID/operación, estado y error de sincronización. | I Vendedor | I Vendedor | `src/gestion/seller/offlineSales.js`, `src/gestion/seller/SellerPanel.jsx` |
| `localStorage` preferencias I | `flor-mia-preferred-panel-{uid}`, `flor-mia-seller-location-{uid}`, `flor-mia-customer-zones-v1`, `flor-mia-olivia-floating:{uid}` y `flor-mia-olivia-dev:{uid}`. | I | I | `src/gestion/ManagementShell.jsx`, `src/gestion/seller/SellerPanel.jsx`, `src/gestion/services/customerService.js`, `src/gestion/olivia/preferences.mjs`, `src/gestion/olivia/OliviaAssistant.jsx` |
| `sessionStorage` intenciones I | `flor-mia-quick-sale-pending:{uid}`, `flor-mia-shipping-sale-pending:{uid}` e ID de conversación `flor-mia-olivia:{uid}`. | I | I | `src/gestion/seller/quickSaleIntent.js`, `src/gestion/services/shippingService.js`, `src/gestion/olivia/client.mjs` |
| `localStorage/flor-mia-cart-v2` | IDs y cantidades de carrito por origen web. | E | E | `src/context/CartContext.jsx` |
| `localStorage/flor-mia-checkout-draft-v2` | Datos y consentimiento de invitado, solicitud y reanudación local. | E | E | `src/pages/CheckoutPage.jsx` |
| Caché de recursos en memoria | Perfiles/dimensiones/consultas cacheadas según llave, retención local e invalidación. | I servicios | I servicios | `src/gestion/services/runtimeCache.js`, `src/gestion/services/sharedResources.js`, `src/gestion/services/dashboardService.js` |
| Cache Storage `flor-mia-{surface}-v3` | Shell y assets de cada build. | Ambos, service worker | Ambos | `src/main.jsx`, `public/service-worker.js` |
| Assets estáticos versionados | Imágenes, fuentes empaquetadas, manifiestos PWA, datos editoriales, audio PCM y animaciones. | Build/CLI/repo | Ambos | `public/images/`, `public/olivia-speech/`, `public/animations/`, `src/data/assetsManifest.js`, `scripts/build-shipping-lottie.mjs` |
| Google Drive carpetas/archivos | Tomas y material creativo de proyectos. | I por control servidor + carga | I Workspace y Drive autorizado | `netlify/functions/_lib/googleDrive.mjs`, `netlify/functions/google-drive.mjs`, `src/gestion/marketing/metaAds/googleDriveService.js` |
| OpenAI Files | Adjuntos temporales y fuentes de biblioteca. | I Olivia por servidor | I Olivia por servidor | `netlify/functions/_lib/olivia/attachments.mjs`, `netlify/functions/_lib/olivia/knowledge.mjs` |
| OpenAI vector store | Índice semántico de biblioteca de Olivia. | I Olivia por servidor | I Olivia por servidor | `netlify/functions/_lib/olivia/knowledge.mjs`, `netlify/functions/olivia-resource-retention.mjs` |

### Top flujos críticos end-to-end

**1. Venta Rápida y faltante del origen**

1. Operador elige canal, ubicación/depósito y productos con cantidades y descuentos.
2. El POS muestra saldo local contra demanda, pide confirmación de los faltantes y valida cobro o bonificación total.
3. El servicio relee el origen y confirma en transacción la venta, contador, stock, movimientos, cliente y auditoría según datos de la operación.
4. La venta alimenta Métricas y Finanzas. El estado fiscal avanza por su solicitud vinculada si se eligió.

Evidencia en `src/gestion/pages/QuickSalesPage.jsx`, `src/gestion/services/sellerService.js`, `src/shared/operationalWritePlans.mjs`, `src/gestion/pages/FinancePage.jsx`.

**2. Venta Vendedor sin conexión**

1. El vendedor elige ubicación autorizada y prepara el carrito con stock último conocido.
2. Al perder red, guarda un pendiente local con ID estable, pagos, descuentos y cliente si corresponde.
3. Al recuperar red revalida permisos y stock y confirma una vez. Si falla, conserva pendiente con el error.
4. Registro y saldo confirmado se reflejan en el día del vendedor y en Gestión.

Evidencia en `src/gestion/seller/SellerPanel.jsx`, `src/gestion/seller/offlineSales.js`, `src/gestion/services/sellerService.js`.

**3. Traslado de inventario**

1. Operador autorizado identifica origen, destino y líneas con cantidades.
2. El servicio lee inventario de ambos lados, valida saldo, operación repetida y existencia de recursos.
3. Confirma débito, alta/crédito de destino, movimientos, transferencia y auditoría juntos.
4. El nuevo saldo se consulta desde Depósitos/Ubicaciones y los paneles que usan ese stock.

Evidencia en `src/gestion/components/InventoryTransferModal.jsx`, `src/shared/stockTransferWritePlans.mjs`, `src/gestion/services/inventoryService.js`.

**4. Pedido de retiro desde la tienda**

1. El storefront pide catálogo del backend de su origen y cruza las fichas con el contenido editorial.
2. Invitado selecciona productos, deja contacto y elige retiro habilitado.
3. El backend vuelve a validar ubicación/productos, stock/IVA/precios y crea pedido y pago pendiente bajo la misma intención.
4. Gestión consulta el pedido. El flujo queda pendiente de aprobación de pago y el stock sigue libre.

Evidencia en `src/context/CommerceCatalogContext.jsx`, `src/pages/CheckoutPage.jsx`, `netlify/functions/_lib/ecommerce/commerceService.mjs`, `src/gestion/pages/GenericModulePage.jsx`.

**5. Simulación local de pago web y expediente fiscal**

1. Administrador local habilitado toma el mismo pedido pendiente y pide aprobación simulada.
2. El backend compara estado y snapshot comercial vigente. Confirma pago simulado, venta, salida de inventario, auditoría y vínculo CRM cuando corresponde.
3. Prepara comprobante y plan fiscal, sin solicitud de CAE por este camino.
4. Si falla la segunda fase, la interfaz mantiene la referencia para reintentar fiscal sin duplicar la venta.

Evidencia en `netlify/functions/ecommerce-simulated-payment.mjs`, `netlify/functions/_lib/ecommerce/paymentService.mjs`, `netlify/functions/_lib/ecommerce/fiscalService.mjs`, `src/pages/CheckoutPage.jsx`.

**6. Venta con envío y entrega**

1. POS captura cliente y destino. Gestión puede aprobar con origen/preparadores/transporte. El vendedor origina una solicitud que requiere revisión.
2. La aprobación imputa stock y asigna preparación. Preparador interno confirma listo o informa problema.
3. Repartidor habilitado confirma cada paso de su tramo. Gestión resuelve incidencias o reintenta según el estado.
4. El enlace que recibe el cliente refleja los eventos confirmados y separa el estado comercial de estados de entrega.

Evidencia en `src/gestion/shipping/ShippingFields.jsx`, `netlify/functions/_lib/shipping.mjs`, `src/gestion/shipping/CourierPortal.jsx`, `src/gestion/shipping/ShippingPublicApp.jsx`.

**7. Comprobante y anulación**

1. Operador selecciona receptor y solicita comprobante de una venta existente.
2. Backend valida estado, receptor, moneda/importes, reglas fiscales y política de ambiente. Autoriza o deja estado recuperable.
3. Con autorización, permite obtener PDF, imprimir o enviar si el correo está configurado.
4. Si se anula, comprueba el efecto fiscal, realiza el tratamiento de nota de crédito cuando corresponde y restituye existencias conforme al origen validado.

Evidencia en `netlify/functions/arca-invoice.mjs`, `netlify/functions/arca-authorize.mjs`, `netlify/functions/arca-document.mjs`, `netlify/functions/_lib/arca/saleCancellation.mjs`.

**8. Campaña Meta Ads hasta carga creativa**

1. Se registra proyecto y contexto de negocio/producto, y se activa la versión de metodología.
2. El planificador genera preguntas. El actor responde, genera/revisa la estrategia y el aprobador valida una revisión.
3. Workspace prepara tareas y carpetas Drive desde el plan.
4. Se suben y eligen tomas. El estado queda listo para validación posterior.

Evidencia en `src/gestion/pages/MetaAdsPage.jsx`, `src/gestion/marketing/metaAds/theoryService.js`, `src/gestion/marketing/metaAds/campaignPlanningService.js`, `netlify/functions/google-drive.mjs`.


## 7. Zonas Grises y Preguntas de Validación para el Dueño del Proyecto

### Hallazgos que requieren decisión

| Hallazgo | Implicancia para el alcance | Evidencia |
| --- | --- | --- |
| [INCOMPLETO] Límite de la tienda independiente | El proveedor React se queda sin datos comerciales cuando falta la Function del mismo origen. En el unificado hay registro de pedido pendiente para retiro y simulación administrativa local. | `deploy/ecommerce/netlify.toml`, `src/services/ecommerceService.js`, `netlify/functions/_lib/ecommerce/paymentContract.mjs` |
| [INCOMPLETO] Dos caminos de venta y logística | El POS confirma desde origen único o solicita aprobación logística. El e-commerce de este corte valida una ubicación especial, admite retiro parametrizado y no crea envío. Una devolución logística no corrige por sí sola stock, caja ni factura. | `src/gestion/services/sellerService.js`, `netlify/functions/_lib/shipping.mjs`, `netlify/functions/_lib/ecommerce/commerceService.mjs` |
| [INCOMPLETO] Pedidos, Proveedores, Redes y Marketing general | Tienen lecturas o altas conectadas. El backoffice de pedidos completo, compras/recepciones, conversión social y calendario editorial tienen entidades y rótulos de menú más amplios que las pantallas activas. | `src/gestion/modules.js`, `src/gestion/pages/GenericModulePage.jsx`, `firestore.rules` |
| [INCOMPLETO] Permisos y UI de administración | El servicio de usuarios exige `admin`, la página incluye `general_admin` y la plantilla no es un editor persistente. En Meta Ads la decisión de permisos se repite entre cliente, rules y Functions con guardas propias para Drive. | `src/gestion/permissions.js`, `src/gestion/services/managementService.js`, `src/gestion/pages/AdministrationPage.jsx`, `netlify/functions/_lib/firebaseAuth.mjs`, `firestore.rules` |
| [INCOMPLETO] Dependencias de campañas | Meta Ads termina en espacio creativo y archivos listos para revisar. WhatsApp depende de una extensión separada y la regla de audiencia admite registros sin consentimiento afirmativo si no hay exclusión explícita. | `src/gestion/pages/MetaAdsPage.jsx`, `src/gestion/marketing/whatsapp/extensionBridge.js`, `src/gestion/marketing/whatsapp/campaignDomain.js` |
| [INCOMPLETO] Analítica, publicación y contacto web | Promociones editoriales y texto de envío no cambian el total ni habilitan entrega. La analítica cliente admite eventos limitados sin proveedor configurado, y `purchase_intent_created` no pasa la lista. Varias vías de contacto dependen de contenido estático pendiente. | `src/data/promotions.js`, `src/data/brand.js`, `src/components/Footer.jsx`, `src/utils/analytics.js`, `src/pages/CheckoutPage.jsx` |
| [INCOMPLETO] Datos que atraviesan límites de producto | La venta web confirmada puede vincular por teléfono al CRM con reglas propias. Invitado/consentimiento permanecen en el pedido y el borrador local guarda contacto. El enriquecimiento CRM del checkout no copia el consentimiento como opt-in de campaña. | `netlify/functions/_lib/ecommerce/customerLink.mjs`, `netlify/functions/_lib/ecommerce/commerceDomain.mjs`, `src/pages/CheckoutPage.jsx` |

### Código sin entrada activa y remanentes

La inspección siguió imports estáticos, reexportaciones y cargas diferidas literales desde las tres superficies, las Functions, el service worker y la página de biblioteca estática. Los casos siguientes se contrastaron con el router / consumidor. Test, script manual y contrato de compatibilidad se distinguen del código de uso corriente.

| Estado | Hallazgo | Evidencia |
| --- | --- | --- |
| [CÓDIGO MUERTO] | Componentes editoriales independientes de armado por ocasión, comparación sensorial y encabezado de sección no montados. La portada actual implementa compra/editorial en su propio componente. | `src/components/OccasionBuilder.jsx`, `src/components/SensoryComparison.jsx`, `src/components/SectionHeading.jsx`, `src/pages/HomePage.jsx` |
| [CÓDIGO MUERTO] | Datos de FAQ, selección regional y espacios de galería sin importador desde storefront activo. | `src/data/content.js`, `src/Storefront.jsx` |
| [CÓDIGO MUERTO] | Formulario antiguo de alta/asignación de catálogo desde ubicación. El modal actual solo asocia productos existentes. La herramienta confirmable de carga de Olivia tiene su propia entrada y puede crear faltantes. | `src/gestion/components/LocationProductForm.jsx`, `src/gestion/pages/LocationDetailPage.jsx`, `src/gestion/services/locationEnhancementsService.js`, `netlify/functions/_lib/olivia/catalogStock.mjs` |
| [CÓDIGO MUERTO] | Panel de métricas operativas/calendario de feriados y servicio del calendario sin pantalla que los monte. Las agregaciones compartidas del dominio que sí importa otra pantalla siguen activas. | `src/gestion/components/OperatingMetricsPanel.jsx`, `src/gestion/services/operatingCalendarService.js`, `src/gestion/pages/SalesMetricsPage.jsx`, `src/modules/locations/domain/operatingMetrics.js` |
| [CÓDIGO MUERTO] | Rama `moduleId === "finance"` de la página genérica. Aunque existe su import, el router elige antes `FinancePage`. El panel antiguo de ingresos no se monta. | `src/gestion/components/SalesIncomePanel.jsx`, `src/gestion/pages/GenericModulePage.jsx`, `src/gestion/ManagementApp.jsx` |
| [CÓDIGO MUERTO] | Implementación antigua de atajos y helper simple de saldo tras venta. La botonera viva usa hooks de Vendedor. El helper de saldo tiene prueba de dominio como consumidor. | `src/modules/locations/domain/keyboard.js`, `src/modules/locations/domain/sales.js`, `src/gestion/seller/hooks.js`, `tests/management-domain.test.mjs` |
| [CÓDIGO MUERTO] | Contratos de adaptadores de envío con geocodificador parametrizable sin consumidor en rutas activas. Conservan prueba. El mapa de edición y navegación externa usa código directo. | `src/shared/shippingIntegrations.mjs`, `tests/shipping-integrations.test.mjs`, `src/gestion/shipping/ShippingMap.jsx`, `src/gestion/shipping/CourierPortal.jsx` |
| [CÓDIGO MUERTO] | Exportaciones de servicios sin llamada desde los flujos activos identificados, incluidas `saveLocation`, `listRecentSales`, `listLocationStockConfiguration`, `saveLocationProductConfiguration` y el alta antigua `saveMasterProductFromLocation`. Son funciones dentro de archivos que también contienen servicios vigentes. Algunas conservan prueba o consumidor en un componente huérfano. | `src/gestion/services/managementService.js`, `src/gestion/services/locationManagementService.js`, `src/gestion/services/locationEnhancementsService.js`, `tests/operations-services.test.mjs` |
| [SOLO BACKEND] | Contratos sin flujo completo visible (documentos de rol/permisos, compras, apertura/cierre de caja, interacciones CRM, calendario editorial y resúmenes materializados). Hallazgo de alcance, sin inferencia sobre presencia de documentos en ambientes. | `firestore.rules`, `src/gestion/pages/GenericModulePage.jsx`, `src/gestion/pages/AdministrationPage.jsx`, `src/gestion/pages/FinancePage.jsx`, `src/gestion/pages/LoyalCustomersPage.jsx`, `src/gestion/pages/SalesMetricsPage.jsx` |
| [INCOMPLETO] | Residuos conversacionales GPT-Live y operaciones logísticas bloqueadas en Olivia. Se conservan `410` y limpieza para sesiones/recursos históricos. La transcripción en vivo del sistema vigente sigue activa en su propia Function. | `netlify/functions/olivia.mjs`, `netlify/functions/olivia-voice-meter-background.mjs`, `netlify/functions/olivia-voice-cleanup.mjs`, `netlify/functions/olivia-live-transcribe.mjs`, `src/shared/oliviaCapabilities.mjs` |

### Preguntas para cerrar el Paso 0

1. **Corte de referencia.** ¿Validamos `d0f1225` como línea base de este Paso 0 y registramos las capacidades del PR #67 como una revisión posterior cuando decidas su alcance?
2. **Fuente y promesa de stock web.** ¿Qué ubicación o conjunto de inventarios debe abastecer la tienda? ¿En qué momento se reserva stock, al comenzar checkout, al confirmar pago o con otra regla? ¿Se conserva la excepción de saldo negativo solo para Venta Rápida?
3. **Cierre del pedido.** ¿Qué combinación de pago, retiro, entrega, seguimiento y cancelación debe ser obligatoria para publicar la tienda? ¿Cómo se reparte la actuación entre cliente, Gestión, operador fiscal y responsable de envío?
4. **Devoluciones e incidencias.** ¿Cuándo deben disparar restitución de mercadería, ajuste de caja/reembolso y nota de crédito, y quién debe autorizarlos?
5. **Roles y administración.** ¿Qué diferencia operativa querés mantener entre `admin` y `general_admin`? ¿Quién puede editar permisos/rol, administrar Drive y decidir qué consulta o confirma Olivia?
6. **Módulos parciales.** ¿Qué debe conservarse y qué esperás completar primero entre Pedidos web, Compras/Proveedores, Redes, calendario de Marketing, sesiones de caja y CRM de interacciones?
7. **Canales y consentimiento.** ¿La extensión de WhatsApp sigue siendo el emisor oficial y qué evidencia de consentimiento mínima exigirá cada campaña? ¿Hasta qué etapa debe llegar el flujo interno de Meta Ads?
8. **Reuso y retiro de componentes.** ¿Se recuperan el calendario operativo, los formularios viejos y los adaptadores de envío, o se planifica su retiro después de validar los usos reales? ¿Qué información de checkout y conversaciones debe conservarse y por cuánto tiempo?
