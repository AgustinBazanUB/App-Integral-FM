# Clientes/CRM, Métricas Generales y Administración Financiera

Informe de etapa integrada — 3 de octubre de 2026.

Base local: **482ae57b137b7efcc43a4ebb2a75a8e0e2b67736**, rama **codex/modulo-venta-rapida**. Cambios locales: sin commit, push, despliegue, migración productiva, cambios de secretos, emisión fiscal ni campañas reales.

## 1. Resumen ejecutivo

Se evolucionaron los tres módulos en el orden CRM → Métricas → Finanzas, reutilizando identidad, ventas, pagos, permisos, Alertas y Actividad. Se incorporaron deduplicación transaccional, historial paginado, fidelización configurable, promedios operativos y una pantalla financiera específica. Una venta representa un único ingreso económico; su factura nunca agrega otro ingreso.

Fuentes consultadas: [Parte 2 D–F](https://drive.google.com/file/d/1kbOtCZQIEhGt8NSYPkgj7JKNVbBxbihR/view), [Parte 3 G–I](https://drive.google.com/file/d/1V7o_dkOc1mHnIolE3g0U3X1jjhB8TYZz/view), [Finanzas preliminar del 26/09/2026](https://drive.google.com/file/d/10CXmW-OjeN5lE-ojVVPJte88qmIOKSdG/view) y [ARCA preliminar](https://drive.google.com/file/d/1_zSA9-4uAQlBnqyEhR1T-Icl8lZV-WQX/view). Decisiones abiertas permanecen pendientes; fixtures de QA no son valores comerciales por defecto.

## 2. Auditoría inicial (antes de modificar código)

- Rutas: `/gestion/loyal-customers`, `/gestion/metrics/sales`, `/gestion/finance`; carga diferida en `routePreload.js`, permisos en `permissions.js` y `ManagementApp.jsx`.
- Clientes: `LoyalCustomersPage`, `CustomerDialog`, `CustomerImportModal`, `customerDomain` y `customerService`. Colección maestra `customers`, zonas `customerZones`; identificación hash del teléfono normalizado. Nombre opcional, zona obligatoria actualmente. No hay regla configurable de fidelización ni consultas de historial. La venta mantiene `lastPurchaseAt`, pero editar/anular puede dejar ese dato orientativo desactualizado.
- Importación: formato de la extensión WhatsApp Sender, normalización compartida; exige zona, concatena zonas de duplicados del archivo y omite clientes ya existentes, sin completar campos vacíos ni informar conflictos de manera separada. El alta administrativa usa lectura + batch, con riesgo de sobrescribir datos que cambiaron concurrentemente.
- Cambio de teléfono administrativo: mueve el cliente a otro ID y deja referencia de migración; las ventas conservan el ID anterior. Hace falta compatibilidad explícita para reconstruir historial sin modificar ventas históricas.
- Panel Vendedor y Venta Rápida comparten `sellerService` y el maestro CRM. Ecommerce conserva teléfono/nombre en snapshots, pero actualmente guarda `customerId: null`; no crea una identidad comercial vinculada.
- Marketing/WhatsApp consulta `customers`; campañas conservan snapshots técnicos de destinatarios. No es una segunda identidad. Sus filtros leen etiquetas históricas `segment/category`, aún sin segmentación derivada desde compras.
- Métricas: `SalesMetricsPage`, `MetricsFiltersPanel`, `MetricsVisuals`, `metrics.js`, `dashboardService.listSalesByRange`. Períodos día/mes/año/rango, filtros combinables, pagos centrales, canales y origen físico separados. La query devuelve sólo ventas `active`. Faltan promedios operativos y desglose de categorías; anulaciones se excluyen pero no se muestran como contexto de historial en la consulta actual.
- Tiempo: helpers compartidos de Argentina en `time.js`; Ubicaciones ya almacena `operatingCalendar` (días, fechas, apertura/cierre) y fechas de feria/evento. No existe proveedor ni catálogo de feriados operativo.
- Finanzas: `GenericModulePage` sobre `financialEntries`, sin importes estructurados en su formulario. `SalesIncomePanel` ya deriva ingresos de ventas por día/mes y evita sumar facturas. Faltan egresos clasificados, caja, configuración de comisiones, presupuestos y conciliación trazable. Colecciones existentes: `financialEntries`, `cashSessions`, `payments`, `orders`, `shipments`, `suppliers`, `purchases`, `settings` y `alerts`.
- Costos: no existe un costo obligatorio de producto consumido por el flujo actual. No se puede inferir costo desde el precio ni usar el 30% mencionado como regla.
- Logística/proveedores: módulos genéricos y contratos Ecommerce; `shippingAmount` representa lo cobrado al cliente y no prueba el costo pagado por Flor Mía. No hay integración bancaria ni matching implementado.
- Firestore: índices existentes para ventas por estado/fecha y ubicación; clientes por segmento/última compra y movimientos por tipo/fecha. Reglas sensibles ya delimitan Finanzas, facturas y escrituras Ecommerce. Se revisarán nuevos accesos específicos, sin abrir datos globalmente.
- Tests: dominios de clientes/importación, métricas, ventas/anulaciones, Ecommerce, ARCA y reglas. Proyecto JS/JSX; se hará typecheck focalizado con `checkJs`, lint focalizado y build.

## 3. Clientes / CRM / Fidelización

**Anterior:** maestro por teléfono existente, zona obligatoria, importación poco flexible y última compra orientativa; sin historial consultable ni regla configurable.

**Cambios y estado final:**

- Teléfono obligatorio con normalización argentina e ID determinístico existentes; presentación preservada. Nombre/zona opcionales en Clientes, diálogo compartido de ventas e importación.
- Alta administrativa transaccional: crear o completar sólo campos vacíos. Datos conocidos no se reemplazan silenciosamente; conflictos se reportan y sólo cambios efectivos se auditan. No reactiva automáticamente clientes inactivos. Edición explícita administrativa conserva su flujo independiente.
- Cambio explícito de teléfono conserva IDs anteriores y referencia de migración, sin reescribir ventas históricas ni ejecutar migraciones automáticas.
- Listado inicial de 50 clientes con cursor y continuación. Búsqueda exacta global por documento de teléfono sin barrer la colección.
- Historial paginado desde sales: fecha, productos, cantidades, importe y estado. Conserva anulaciones/bajas sin contarlas. Última compra válida consultada desde ventas, sin confiar en lastPurchaseAt. Se deduplican coincidencias por ID y teléfono también en el límite entre páginas.
- settings/crmLoyalty permite habilitar compras mínimas, ventana, categorías mínimas y frecuencia máxima opcional. Sin regla no se inventa clasificación. Los 90 días iniciales son una ventana de consulta visible, no un umbral comercial.
- Segmentos por fidelización, zona, frecuencia/cantidad, producto, categoría y última compra. Operan sobre los clientes cargados y la ventana declarada; no afirman cubrir registros aún no cargados.
- Excel exige sólo Telefono; nombre/zona opcionales y columnas conocidas reordenadas. Duplicados no frenan toda la carga; completa vacíos, informa conflictos por fila y permite reintentos seguros.
- Marketing consume maestro y segmentos derivados; snapshots de campaña son datos técnicos propios, no otra identidad. Sin envío real.
- Ecommerce asocia el maestro dentro de la transacción que confirma la venta, usando normalización/enriquecimiento compartidos. Pedido pendiente sin venta no crea cliente. Teléfonos fuera de la regla actual quedan marcados para revisión, conservando compatibilidad de checkout y sin inventar política internacional.

## 4. Métricas Generales

**Anterior:** pantalla analítica detallada y filtros existentes; sin categorías ni promedio operativo.

**Cambios y estado final:**

- Fuente sales, con fecha/vigencia/deduplicación/ticket compartidos en saleFacts. Anuladas y bajas lógicas quedan fuera de importes efectivos; legado sin estado sigue el criterio compatible del dominio.
- Consultas por fecha inicial inclusiva/final exclusiva, cache 60 segundos. Se conserva contexto de anulaciones sin sumarlas.
- Filtros existentes día/mes/año/rango, ubicaciones, vendedores, productos/categorías, descuentos, pagos y canal combinables. Categorías/productos mantienen el facet compartido existente.
- Ticket = facturación válida / ventas válidas. Splits por monto real sin aumentar ventas. Adaptador de lectura conserva medios reales de ecommerce; validación de pagos POS intacta.
- Evolución hora/día/mes para día/mes/año y agrupación existente en rangos. Canal comercial y origen físico separados.
- Categorías: unidades, ventas distintas y subtotal antes de descuentos generales, usando snapshot o catálogo actual como fallback.
- Promedio diario por ubicación: bloques inclusivos, extensión por ventas fuera del horario, primera→última venta si no hay horario. 10:53–19:05 = 10 bloques. Sin información suficiente no se inventa promedio.
- Promedio mensual: calendario del local/fechas del evento, límites temporales y feriados configurados. Feriado con ventas cuenta; sin ventas se excluye. Año sin feriados declarados queda sin promedio calculable.
- Promedio anual = total / 12, por ubicación. Año parcial, jornada nocturna y fórmula conjunta de múltiples horarios quedan pendientes.
- Tiempo compartido America/Argentina/Buenos_Aires; el Dashboard continúa siendo un resumen y no recibe una segunda pantalla analítica.

## 5. Administración Financiera

**Anterior:** ruta genérica y panel de ingresos derivados, sin gastos estructurados, caja ni conciliación.

**Cambios y estado final:**

- Ruta dedicada/diferida y protegida por permiso financiero existente. Resumen, Ventas e ingresos, Gastos, Caja y acreditaciones, Presupuestos y Configuración autorizada.
- Ingreso reconocido derivado de ventas válidas de Vendedor, Venta Rápida y ecommerce. Dedupe por ID; facturar no escribe otro ingreso. Anulación comercial deja de sumar al actualizar y conserva historial.
- financialEntries para gastos/ingresos externos: importe, categoría extensible, naturaleza, alcance general/ubicación, devengamiento/vencimiento/pago efectivo, efectivo/banco, observaciones y referencias de proveedor/pedido/envío verificadas si se informan.
- Ingreso externo exige referencia y rechaza relación a venta/factura/pedido para evitar recargar un ingreso conocido.
- Intención estable y transacción evitan duplicados por doble envío/retry. Otro payload para el mismo ID se rechaza. Anulación lógica exige motivo y auditoría; para corregir un gasto se anula y se registra reemplazo, sin edición destructiva.
- Costo sólo unitCost explícito histórico. Sin costo/cantidad válida, comisión o impuesto estimado configurado, margen desconocido. No se usa precio ni 30% como costo.
- Con datos: contribución = ventas − costo vendido − comisiones − impuestos directos estimados. Resultado = contribución + ingresos externos − gastos devengados. Compra de la categoría inicial Mercadería deja resultado pendiente de imputación para evitar descontar inventario dos veces; egreso, presupuesto y caja siguen disponibles.
- Configuración versionada con vigencia explícita, tasas/plazos/categorías extensibles. Vacío = desconocido, cero = declaración expresa. No afecta impuestos de ARCA. Límite preventivo de 100 versiones, sin purgar historial.
- Presupuesto mensual por categoría/alcance con gastado, diferencia, consumo y umbral elegido. Presupuesto general mantiene gasto global aun con filtro de ubicación.
- Caja separa efectivo y acreditación bancaria documentada. Fecha efectiva permite incluir pagos del mes por ventas anteriores. Se muestra movimiento, no un saldo sin saldo inicial.
- Proyección sólo por compromisos con vencimiento y acreditaciones con monto/plazo configurados dentro del alcance consultado. No predice ventas ni simula banco.
- Evidencia por venta/medio con ID estable, fecha, importe y referencia. Dentro de plazo sin alerta; vencida/diferente abre control; coincidencia posterior cierra alerta y audita. Resolución manual con motivo no acredita dinero desconocido.
- Controles reutilizan alerts/auditLogs. Misma discrepancia resuelta manualmente no reaparece hasta cambiar evidencia. Se evalúan después de operaciones financieras y con Actualizar y evaluar controles, para el período consultado; sin ejecución automática en segundo plano.
- Envío cobrado ya integra venta; costo logístico real se registra como gasto relacionado. No se asumen equivalentes.
- Error posterior a guardar informa que la operación persistió para evitar recargarla. Loading/vacío/errores y móvil mantienen diseño existente.

## 6. Integración entre módulos

| Relación | Implementación |
| --- | --- |
| Venta → Cliente | Identidad/normalización y asociación transaccional POS/ecommerce; historial y segmentos derivados. |
| Venta → Métricas | Misma fecha, vigencia, canal, origen, productos, descuentos y splits; 1 venta combinada = 1 venta. |
| Venta → Finanzas | Importe de la misma venta, sin otra escritura económica ni ingresos desde Clientes. |
| Venta → ARCA | Comprobante fiscal asociado preservado; estado contextual, importe de factura no se suma. |
| Ubicación → Métricas/Finanzas | Calendario y origen/alcance; depósito nunca se convierte en canal. |
| Producto → CRM/Métricas/Finanzas | Productos/categorías reales; costo sólo con evidencia histórica explícita. |
| Gasto → Envío/Proveedor/Presupuesto | Referencias existentes, devengamiento/pago separados y Alertas compartidas. |
| Cliente → Marketing | Maestro y clasificación derivada; snapshots técnicos conservados. |

## 7. Protección de ARCA

Autenticación, endpoints, CAE, PDF, impresión, reintentos, recuperación, estados/contratos fiscales, asociación factura–venta y variables de entorno preservados.

Sin diff en src/gestion/services/arcaService.js, arcaInvoicePrint.js, src/gestion/components/ArcaInvoicePrintAction.jsx, netlify/functions/_lib/arca/ y netlify/functions/_lib/ecommerce/fiscalService.mjs.

Sí se tocaron dos archivos comerciales relacionados con el flujo completo: commerceService.mjs y paymentService.mjs, únicamente para asociar CRM al crear la venta y quitar un helper sin uso. Flujo fiscal sigue por el servicio existente; escrituras protegidas de invoices/payments/orders intactas. Tests con mocks/comprobantes sintéticos, sin emisión real.

## 8. Firestore

Colecciones reutilizadas: customers, customerZones, sales, products, productCategories, locations, warehouses, financialEntries, settings, alerts, auditLogs, suppliers, orders y shipments. Sin colecciones paralelas. Configuración en settings/crmLoyalty, operatingHolidays y financeConfig.

- Cliente exacto por ID; listado 50 + 1 por página.
- Historial: hasta 10 IDs anteriores por grupo más variantes de teléfono, orden/cursor y 21 documentos por grupo; 20 ventas únicas por página. Última compra avanza sólo si no hay compra válida; muchas bajas consecutivas pueden requerir más páginas.
- Segmentos: una query de ventas por ventana + catálogo/cache compartidos, sin N+1 por cliente.
- Métricas/Finanzas: rangos indexados y ubicación en lotes cuando corresponde. Cache de ventas 60 s; no histórico completo para día/mes.
- Movimientos: queries acotadas por occurredAt/paidAt/dueAt, presupuesto del mes y evidencia relacionada en lotes de 10 ventas. Unión por ID evita doble lectura lógica/contabilización.
- Registros financieros genéricos anteriores: hasta 30 recientes por updatedAt como contexto por clasificar, sin inventar importes.
- Sin listeners masivos ni denormalización de ventas/ingresos.

Cuatro índices compuestos nuevos: sales(customerId, createdAt desc), sales(customerPhoneSnapshot, createdAt desc), financialEntries(type, month) y financialEntries(type, saleId). Índices simples y de período/ubicación existentes reutilizados.

Reglas: CRM/analista autorizados consultan ventas comerciales. Vendedor conserva alcance anterior y queda fuera de finanzas. financeConfig tiene lectura financiera/edición administrativa financiera; financial_manager coincide con permisos JS existentes. Referencias permiten get financiero de pedido/proveedor/envío, sin ampliar listados ni escritura. Alertas/auditoría financieras restringidas por módulo/permiso.

Compatibilidad sin borrar/renombrar datos productivos. Cambios de teléfono sólo explícitos. **Reglas e índices no desplegados**: deben publicarse y estar disponibles antes de habilitar esta versión en un entorno real, en una entrega autorizada posterior.

## 9. Archivos modificados

Lista exacta de 46 archivos de código/configuración/pruebas/informe. Material temporal de QA separado.

| Archivo | Motivo |
| --- | --- |
| docs/CRM_METRICAS_FINANZAS.md | Auditoría e informe técnico final. |
| firestore.indexes.json | Cuatro índices compuestos para historial CRM, presupuestos y acreditaciones. |
| firestore.rules | Accesos específicos de CRM/Métricas/Finanzas, configuración, referencias, alertas y auditoría. |
| netlify/functions/_lib/ecommerce/commerceService.mjs | Vincular identidad CRM al crear la venta confirmada. |
| netlify/functions/_lib/ecommerce/customerLink.mjs | Nuevo adaptador CRM transaccional, sin cambios fiscales. |
| netlify/functions/_lib/ecommerce/paymentService.mjs | Vincular identidad CRM al confirmar pago y crear venta. |
| package.json | Agregar las nuevas pruebas CRM/Finanzas a test:rules. |
| src/design-system/index.jsx | JSDoc de props opcionales y valores ARIA numéricos; sin rediseño. |
| src/gestion/ManagementApp.jsx | Ruta financiera dedicada y eliminar prop de campaña ignorada para compatibilidad de tipos. |
| src/gestion/components/DashboardAlerts.jsx | Contexto financiero con permiso y props opcionales tipadas. |
| src/gestion/components/MetricsFiltersPanel.jsx | Catálogo central y métodos de pago reales; tipado de props. |
| src/gestion/components/OperatingMetricsPanel.jsx | Nuevo panel de promedios por ubicación y feriados explícitos. |
| src/gestion/customers/CustomerImportModal.jsx | Importación parcial segura, enriquecimiento y conflictos. |
| src/gestion/customers/CustomerInsights.jsx | Segmentos, configuración de fidelización e historial. |
| src/gestion/customers/crmService.js | Paginación, regla, análisis, historial y última compra válida. |
| src/gestion/customers/customerDomain.js | Zona opcional y enriquecimiento compartido sin sobrescritura. |
| src/gestion/customers/customerImport.js | Columnas opcionales/reordenadas, deduplicación y conflictos por fila. |
| src/gestion/customers/customerPurchases.js | Selectores de compras, fidelización y segmentos. |
| src/gestion/finance/financeDomain.js | Modelo, validación, políticas, ingresos, costos, caja, presupuesto y acreditaciones. |
| src/gestion/finance/financeService.js | Transacciones idempotentes, referencias, auditoría y Alertas. |
| src/gestion/marketing/whatsapp/campaignDomain.js | Filtros compatibles con segmentos derivados y props opcionales. |
| src/gestion/marketing/whatsapp/campaignService.js | Maestro CRM y regla compartida; quitar queries redundantes a etiquetas legadas. |
| src/gestion/pages/FinancePage.jsx | Nueva pantalla financiera protegida y responsive. |
| src/gestion/pages/LoyalCustomersPage.jsx | CRM paginado, campos opcionales, segmentos, historial y configuración. |
| src/gestion/pages/SalesMetricsPage.jsx | Vigencia compartida, contexto histórico, categorías y promedios. |
| src/gestion/routePreload.js | Carga diferida/preload de Finanzas. |
| src/gestion/seller/CustomerDialog.jsx | Zona opcional, enriquecer vacíos y proteger lookup de respuestas tardías. |
| src/gestion/services/customerService.js | Altas transaccionales y aliases de cambio explícito de teléfono. |
| src/gestion/services/dashboardService.js | Historial por rango/cache y alcance comercial autorizado. |
| src/gestion/services/operatingCalendarService.js | Calendario de feriados explícito con auditoría. |
| src/modules/alerts/domain/alerts.js | Navegar al contexto financiero sólo con permiso. |
| src/modules/locations/domain/dashboard.js | Reutilizar hechos comerciales preservando exports. |
| src/modules/locations/domain/metrics.js | Vigencia/ticket compartidos y filtro de categoría vacío/histórico. |
| src/modules/locations/domain/operatingMetrics.js | Fórmulas operativas y agrupación de categorías. |
| src/modules/locations/domain/payments.js | Leer splits/métodos reales manteniendo validación POS. |
| src/modules/locations/domain/saleFacts.js | Fecha, vigencia, dedupe y resumen compartido. |
| src/router.jsx | Tipado de props opcionales y elementos del router existente. |
| src/styles/seller-customers.css | Formularios responsive, segmentos plegables y pestañas móviles. |
| tests/crm-finance-domain.test.mjs | Fidelización, calendarios, filtros, caja, costos y contabilización única. |
| tests/crm-finance-services.test.mjs | Concurrencia, historial solapado/legado, configuración y servicios. |
| tests/customer-domain.test.mjs | Regla de nombre/zona opcionales. |
| tests/customer-import-ui.test.mjs | Columnas opcionales, conflictos y filas originales. |
| tests/ecommerce-stage6-runtime.test.mjs | Asociación CRM transaccional y preservación de identidad. |
| tests/firestore.crm-finance.rules.mjs | Permisos, transacciones financieras en emulador y protección fiscal. |
| tests/helpers/memoryFirestore.mjs | Adaptador local estricto de consultas y transacciones. |
| tests/quick-sale-services.test.mjs | Integración real del servicio POS con cliente/splits, comprobante y anulación. |

Material local: tmp/crm-finance-sources, checker y preview tmp/panel-general-qa/crm-finance-*.mjs, logs tmp/crm-*.log y capturas crm-history.png, crm-mobile.png, finance-mobile.png y finance-desktop.png. No se eliminaron temporales anteriores del usuario.

## 10. Tests realizados

| Verificación | Resultado individual |
| --- | --- |
| Baseline previo npm test | 469 aprobados. |
| Suite final npm test | **494 aprobados, 0 fallos, 0 omitidos**; incluye tests existentes de POS/stock, ecommerce, ARCA y Marketing. |
| Typecheck focalizado | **0 errores**, TypeScript 5.9.3, allowJs/checkJs/noEmit y tipos React sobre frontend afectado. No es migración ni typecheck integral inexistente. |
| Lint focalizado | **0 errores**, ESLint 10, JS/JSX/MJS afectados incl. backend/tests, sintaxis/variables/duplicados/código inalcanzable. |
| npm run test:rules | **121 aprobados, 0 fallos**, emulador 127.0.0.1:8188, proyecto demo; nuevos 4 casos y todas las reglas existentes. |
| npm run build | Aprobado; advertencia previa de chunks >500 kB. |
| npm run build:surfaces | Gestión y ecommerce aprobados; misma advertencia de tamaño. |
| node --check | Adaptador CRM y ambos servicios backend modificados aprobados. |
| Integración real del servicio POS | Cliente sin zona + pagos 2.000/3.000: 1 compra, 1 venta, ingreso 5.000. Factura sintética no aumenta importes; anulación fiscal sigue protegida. Venta sin factura anulada conserva documento/actividad, restaura stock y deja de sumar. |
| CRM/servicios | Alta concurrente sin duplicado, vacíos/conflictos, configuración, paginación/historial solapado, última compra vigente incluyendo legado; aprobados. |
| Métricas/dominio | Ticket, vacío/anuladas, splits/canal/origen, categoría vacía/histórica, horarios inclusivos/postcierre/sin horario, feriado vendido y anual/12; aprobados. Tests temporales existentes conservados. |
| Finanzas/servicios | Retry idempotente, motivos, referencias, presupuesto global, fechas efectivas, evidencia/plazo/diferencia/coincidencia, cierre de Alertas y vendedor denegado; aprobados. Inventario no se descuenta dos veces. |
| Ecommerce runtime | Pendiente sin CRM; aprobación concurrente 1 cliente/venta; conservación de datos existentes y tests fiscales anteriores aprobados. |
| Navegador CRM | Alta sólo teléfono aprobada; historial 2 válidas + 1 anulada y última válida; segmentos plegados en móvil. |
| Navegador Métricas | Día vacío 0; día con ventas 5.000/2/ticket 2.500 y 9 bloques; mes 5.000 con splits 50/50; año 5.000/12 ≈417 por ubicación. |
| Navegador Finanzas | 5.000 sin sumar factura; gasto 100 lleva resultado a 2.900; evidencia alias 2.500 acredita movimiento/estado Conciliado sin nuevo ingreso. |
| Estados/navegación | Loading, vacío y error de conexión visible en los tres módulos; navegación entre módulos y acceso a Venta Rápida aprobados. |
| Responsive | Móvil 390×844 y escritorio 1280×900; Finanzas sin overflow horizontal de página. |
| Diff/ARCA/HEAD | git diff --check limpio, puntos fiscales sin diff, HEAD sin cambios. |

Checker: node tmp/panel-general-qa/crm-finance-checks.mjs; herramientas externas de QA en $env:TEMP/flormia-panel-qa-tools, sin nuevas dependencias de producción. Reglas: FIRESTORE_EMULATOR_HOST=127.0.0.1:8188 con npm run test:rules.

Preview **http://127.0.0.1:5200/gestion/finance**: páginas/servicios/dominios reales con adaptador en memoria y autenticación de prueba. Datos sintéticos rotulados, sin Firebase real ni emisión fiscal. No E2E pesado, movimientos bancarios ni campañas reales.

## 11. Errores encontrados

Resueltos: zona obligatoria; altas administrativas con sobrescritura/concurrencia; importación sin enriquecimiento/conflictos; IDs anteriores sin continuidad explícita; segmentos sin regla; métodos ecommerce omitidos; categoría vacía devolviendo todas las ventas; ruta financiera genérica; falta de caja/evidencia/presupuesto; permisos de configuración/auditoría financiera; presupuesto global dependiente del filtro; inventario descontable dos veces; repetición de la venta límite del historial por ID/teléfono; props/checkJs y ARIA numérico.

En QA se corrigió una suposición de orden del test concurrente (ganador efectivo y cambios auditados) y un fixture integrado sin etiqueta requerida de pagos combinados, conservando el contrato POS. fill del selector nativo de fecha no disparaba React en este navegador; se verificó el cambio real con teclado.

Sin fallos técnicos conocidos que impidan las funciones locales implementadas. Datos/costos desconocidos, definición comercial, banco y despliegue pendiente se declaran, no se ocultan ni convierten en cifras ficticias.

## 12. Pendientes funcionales

- Números definitivos de fidelización, frecuencia/ventana/categorías; bienvenida automática y precedencia aprobada de conflictos. Configuración preparada sin umbrales impuestos.
- Política internacional de teléfono y backfill de ecommerce histórico con formatos fuera de variantes/identidad actual; requiere diseño/autorización propios.
- Promedio global de múltiples calendarios, jornadas nocturnas, años parciales, feriados aún no declarados y eventual proveedor.
- Fuente/valoración/imputación de inventario, costo histórico y compras de mercadería. Margen detallado por producto/categoría/canal y distribución de costos/descuentos dependen de esa definición; hoy hay estimación por período/ubicación cuando los snapshots bastan.
- Tratamiento definitivo de IVA/IIBB/retenciones/tasas/compras; parámetros internos no son determinación fiscal.
- Banco/cuenta exclusiva, autenticación/API, identificadores, matching, tolerancias y plazos reales. Evidencia manual disponible; integración automatizada pendiente.
- Controles automáticos entre períodos/en segundo plano y evidencia bancaria externa. Actualmente por operaciones/actualización del período seleccionado.
- Cuentas a pagar/proveedores especializadas, costos automáticos de envíos y adjuntos; vínculos por ID disponibles sin simular esos módulos.
- Proyección estadística de ferias/eventos y saldos iniciales; sólo compromisos consultados con evidencia.
- Subniveles de permisos e historial de configuración después de 100 versiones; no se purga para continuar.

## 13. Riesgos restantes

- Reglas/índices preparados pero no desplegados: entorno antiguo puede rechazar permisos/queries hasta entrega autorizada.
- Ventanas amplias/años aún leen por documento dentro del rango; sin nuevo motor de agregados. Segmentos sólo sobre clientes cargados.
- Cache 60 s, sin promesa de tiempo real. Finanzas actualiza explícitamente.
- Catálogo actual como fallback no reconstruye categoría histórica modificada; costo faltante no se infiere. Legado financiero genérico preservado sin clasificación.
- Última compra puede requerir más páginas por bajas consecutivas; cadena antigua de teléfono limitada a 20 eslabones, además de aliases nuevos. Sin migración destructiva.
- Protección de imputación identifica la categoría inicial Mercadería; una categoría personalizada de inventario requiere clasificación explícita futura. No interpretar resultado como contabilidad definitiva ni renombrar categoría para eludir esa protección.
- Referencia de ingreso externo es responsabilidad del usuario autorizado; no hay proveedor bancario externo que la autentique.
- Preview y emulador verifican comportamiento local, no datos/credenciales/conectividad productivos. Login y módulos protegidos cubiertos por compilación/tests existentes; sin nueva sesión real con escritura productiva.
- Advertencia preexistente de tamaño de bundles; mejora de performance independiente.

## 14. Estado final

**COMPLETADA CON PENDIENTES NO BLOQUEANTES para esta etapa local.** Funciones implementadas utilizables y pruebas aprobadas; requisitos abiertos y datos desconocidos explícitos. ARCA protegido y una venta facturada representa un único ingreso.

No significa producción aprobada ni banco integrado. Reglas/índices y configuración real necesitan una entrega posterior autorizada. **Sin commit ni push**, conforme a las restricciones del prompt.

### Publicación posterior autorizada

Después de cerrar esta etapa local, el usuario autorizó el 03/10/2026 subir la versión actual a main en GitHub y desplegarla. La restricción anterior describe la entrega local original; esa autorización posterior habilita la publicación. El destino de hosting se confirma porque el repositorio configura Netlify y el pedido menciona Azure. No se cambian contratos ni secretos fiscales como parte de esa aclaración.
