# Venta Rápida — auditoría y adaptación

Base auditada: `3849939ef7ad725940f4db076f9fbc49d08df60e` (ARCA Etapa 7 preservada).

## Fuentes verificadas antes de modificar código

- [Parte 2 D–F, sección E](https://drive.google.com/file/d/1kbOtCZQIEhGt8NSYPkgj7JKNVbBxbihR/view): canal comercial separado del origen físico, catálogo global, precio editable, pagos, clientes e impacto económico.
- [Facturación ARCA preliminar](https://drive.google.com/file/d/1_zSA9-4uAQlBnqyEhR1T-Icl8lZV-WQX/view): comprobante asociado, venta conservada ante error fiscal e impresión manual. Los pendientes preliminares fiscales quedan subordinados a la Etapa 7 ya implementada.

## Auditoría inicial

- Ruta `/gestion/quick-sales`, `QuickSalesPage.jsx`, carga diferida por `routePreload.js`; formulario en dos columnas, catálogo sólo del stock de una ubicación, precio no editable, DNI sin CRM, pagos simples, descuentos asignados y entrega/receptor fiscal.
- Modelo documental `sales`, ítems normalizados en `modules/locations/domain/sales.js` y servicios. No existe un modelo TypeScript Sale único: el proyecto usa JavaScript/JSX.
- **Duplicación encontrada:** `managementService.createQuickSale` implementa su propia transacción; `sellerService.createSellerSale` ya integra teléfono normalizado/hash, cliente, pagos combinados, descuentos manuales/configurados, fechas Argentina, stock/movimientos/auditoría y sincronización offline idempotente.
- Venta Rápida tiene bloqueo de doble clic en React pero genera ID nuevo por reintento. Sólo descuenta `locationStock`; el servicio no revalida la ubicación dentro de la transacción. No admite `warehouseStock`.
- `inventoryService` mantiene depósitos y ubicaciones separados; productos globales con precio maestro y override local. `sharedResources` cachea catálogo/descuentos/ubicaciones.
- CRM: `customerDomain` y `customerService.findCustomerByPhone`, ID determinista por teléfono. La regla vigente exige zona para el alta, aunque Parte 2 propone zona opcional; conservar esa regla global en esta adaptación.
- Pagos centralizados en `modules/locations/domain/payments.js`; `normalizePayment` exige coincidencia exacta y al menos dos partes positivas para pagos combinados.
- Métricas/Dashboard consultan `sales` por período; Métricas no desglosa aún canales. La fuente económica es la venta, no `invoices`.
- Finanzas usa hoy `GenericModulePage` sobre `financialEntries`, sin integración real de ingresos derivados de ventas. Se debe mostrar el ingreso desde `sales`, evitando agregar asientos duplicados.
- Actividad/Auditoría reutiliza `auditLogs` y `stockMovements`. ARCA existente usa `admin_quick_sale` + ID de venta + `invoiceStatus: pending`; acepta `locationId` nulo, sin exigir un punto físico ficticio para depósitos.
- Puntos protegidos: `arcaService`, impresión, funciones `arca-*`, biblioteca `_lib/arca`, recuperación fiscal, reglas de facturas/ventas fiscalizadas. No se reimplementarán ni emitirán facturas reales en QA.

## Pendientes de la fuente que no se inventan

- Catálogo administrable de canales manuales: se reutilizan los valores actuales WhatsApp, Instagram, teléfono y presencial; se elimina la elección artificial «Carga manual».
- Administración y coexistencia de descuentos globales: se conserva el catálogo y sus restricciones actuales; un descuento asignado a ubicaciones no se aplica a depósitos.
- CRM con zona opcional requiere una decisión global independiente; este flujo respeta la validación vigente.
- Envío automático por WhatsApp e integración fiscal adicional no forman parte de esta adaptación del POS.

## Referencia visual adicional solicitada

Se inspeccionó el [POS vendedor del sistema anterior](https://github.com/AgustinBazanUB/FM-stock-y-ventas), commit `8113ebd831032340b21848c8c3f5e617e831b30b`, especialmente `seller.js: renderNewSale` y sus estilos. Se conservó el patrón de categorías desplegables, carruseles de productos, carrito, botones de pago y cierre visible. No se ejecutó su código ni se copiaron sus servicios o conexiones Firebase.

## Implementación final

- `createQuickSale` es un adaptador del mismo motor transaccional que usa `createSellerSale`. Se eliminó su transacción duplicada. La entrada del vendedor, su cola offline y su solicitud fiscal posterior conservan compatibilidad.
- Se registra el canal comercial real en `sourceChannel`. El origen físico queda separado en `stockOriginType/Id/Name`, `locationId` o `warehouseId`. Un depósito no aparece artificialmente como ubicación ni canal.
- El catálogo maestro se consulta mediante la caché compartida; el stock se lee únicamente del origen seleccionado. El servicio vuelve a verificar origen activo, productos activos y disponibilidad dentro de la transacción.
- El precio sugerido surge del catálogo y del override local. El Administrador puede editarlo desde el carrito; las diferencias contra el precio vigente se preservan en la venta y en Actividad (`priceOverrides`). Se reutilizan descuentos y permisos existentes.
- Los pagos simples y combinados usan el catálogo central y `normalizePayment`. Los combinados requieren al menos dos partes positivas y una suma exacta; el diálogo incluye «Completar» el importe restante.
- Se reutilizan los diálogos del vendedor para cliente y descuento. El cliente se busca por teléfono normalizado y se resuelve nuevamente dentro de la transacción, preservando nombre/zona existentes y evitando duplicados.
- El identificador de cada intento se guarda antes de confirmar en `sessionStorage`; determina el ID de `sales`. La transacción confirma venta, cliente, stock, contador, movimientos y Actividad juntos. El doble clic se bloquea de inmediato. Una confirmación incierta conserva el intento y permite recuperar el resultado después de navegar; el mismo ID y contenido no vuelven a descontar stock.
- La pantalla se organiza como POS, con categorías/productos táctiles, carrito, cantidades, precio y total. Los detalles opcionales se abren en diálogos. En móvil el total y «Cargar factura / Continuar» permanecen visibles abajo; ya no existe un checkbox fiscal.
- «Cargar factura» abre el receptor fiscal y ofrece «Generar factura y continuar» o «Solo continuar». La primera opción confirma la venta y utiliza `requestPendingArcaInvoice` y el flujo existente. Los errores fiscales conservan el éxito comercial y remiten a la recuperación fiscal ya disponible. Un reintento conserva la decisión y el receptor del intento original.
- Métricas agrega filtro/desglose de canal y desglose del origen físico usando el mismo conjunto de ventas filtradas. El Panel General incluye ventas desde depósitos cuando se selecciona el conjunto completo.
- Finanzas incorpora ingresos derivados directamente de `sales` por día/mes. No se escriben ingresos nuevos en `financialEntries` ni se suman facturas. La lista muestra hasta 100 ventas y el resumen incluye todas las del período consultado.

## Flujo y dependencias

1. Elegir canal y origen activo (ubicación o depósito).
2. Tocar productos; ajustar cantidades y, si corresponde, el precio.
3. Agregar descuentos, cliente y tipo de entrega cuando hagan falta.
4. Seleccionar pago simple o completar el pago combinado.
5. Continuar, o abrir factura y confirmar con los datos fiscales.
6. Confirmación central atómica; invalidación de la caché de ventas y refresco del stock.
7. Métricas, Dashboard y Finanzas consumen esa venta; ARCA asocia su comprobante existente.

Las consultas de ingresos y métricas se acotan por fecha. No se crean colecciones paralelas ni nuevas denormalizaciones. Para el selector de productos se carga una vez el catálogo activo y el inventario del origen, evitando la hidratación con una lectura adicional por producto.

## Archivos afectados

- POS: `src/gestion/pages/QuickSalesPage.jsx`, `src/gestion/styles/quick-sales.css`, `src/gestion/seller/quickSaleIntent.js` y texto contextual de `src/gestion/seller/DiscountDialog.jsx`.
- Motor y fuentes: `managementService.js`, `sellerService.js`, `inventoryService.js`, `dashboardService.js` dentro de `src/gestion/services`; `src/modules/locations/domain/channels.js` y `metrics.js`.
- Consumidores: `DashboardPage.jsx`, `SalesMetricsPage.jsx`, `GenericModulePage.jsx` y `src/gestion/components/SalesIncomePanel.jsx`.
- Tipado documental sin cambio de ejecución: `src/design-system/index.jsx`, `src/gestion/customers/customerDomain.js`, `src/gestion/services/customerService.js`.
- Reglas: `firestore.rules`, sólo permisos de lectura de ventas para perfiles con acceso a Finanzas; no se modificaron los guardas fiscales de creación/edición.
- Validación: `tests/quick-sale-services.test.mjs`, `tests/quick-sale-submission.test.mjs`, `tests/firestore.quick-sales.rules.mjs`, `tests/arca-invoice-persistence.test.mjs` y su incorporación al script `test:rules` de `package.json`.

## Verificación

- Suite local: 469 tests aprobados, incluyendo ventas simples, combinadas, descuentos, precio editado/auditoría, cliente existente/nuevo, depósitos/ubicaciones, WhatsApp/Instagram, productos duplicados/inactivos, stock insuficiente, concurrencia, respuesta perdida y recuperación con el mismo ID.
- Firestore Emulator aislado: 52 comprobaciones aprobadas de ventas, operaciones, guardas fiscales y recuperación. Incluye permisos de Finanzas, stock descontado una sola vez, pagos exactos y bloqueo de alteración fiscal.
- Typecheck focalizado (`checkJs`, TypeScript 5.9.3) y lint focalizado: cero errores. El proyecto es JS/JSX y no dispone de un typecheck global propio; las herramientas de QA se mantuvieron fuera de dependencias productivas.
- Build de gestión, ecommerce y build unificado; advertencias habituales de bundles grandes, sin errores de compilación.
- Navegación básica en navegador con componentes y motor reales sobre un adaptador de datos sintéticos: depósito + WhatsApp + 2 productos + precio 3000 + descuento 10% + transferencia 3400/efectivo 2000 = 5400; stock 20→18. Métricas y Finanzas muestran una venta y un ingreso de 5400. También se verificó venta simple Instagram desde ubicación, filtro día/mes, vacío, error controlado y recuperación después de respuesta perdida.
- Revisión responsive móvil a 390×844 y escritorio. Sin scroll horizontal del documento; carrito y cierre utilizables. No se realizó E2E pesado.
- ARCA: servicios fiscales, endpoints, autenticación, CAE, PDF, impresión y recuperación sin cambios. La prueba fiscal usó un comprobante sintético y pruebas de persistencia; no se emitieron comprobantes reales.

## Despliegue, límites y riesgos conocidos

- La lectura de ingresos por perfiles de Finanzas requiere publicar las reglas actualizadas de Firestore. Se verificaron localmente; no se desplegaron reglas ni funciones de producción en este trabajo. Los Administradores ya disponen de lectura global.
- No se migran ventas históricas con canal `manual`: se conserva su información y etiqueta legible. La elección nueva exige un canal comercial real.
- El intento pendiente persiste por usuario y pestaña; cerrar la pestaña/eliminar almacenamiento pierde esa recuperación local. No se agregó una cola offline ni sincronización entre dispositivos para Venta Rápida. Si el almacenamiento no está disponible se evita iniciar la operación.
- Los cambios de origen vacían el carrito para no trasladar cantidades de un inventario a otro. Cambios de catálogo, precios o descuentos se revalidan antes de confirmar.
- Se conserva la prohibición vigente de stock negativo. La edición/anulación de ventas desde depósito y nuevos flujos logísticos quedan fuera del alcance de este registro POS; no se extendieron los flujos del vendedor que trabajan por ubicación.
- Finanzas mantiene su módulo de movimientos manuales. No se implementó una conciliación global de asientos históricos cargados manualmente; los ingresos nuevos de este panel provienen sólo de ventas.
- La seguridad fiscal y los permisos existentes del stock permanecen vigentes. No se rediseñó globalmente el protocolo de escritura de los demás emisores.
