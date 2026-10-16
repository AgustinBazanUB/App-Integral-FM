# Gestión de envíos v0.8 — auditoría y entrega

## Auditoría inicial (16/10/2026)

- HEAD: `6608b43eea831a9b4f348a8d7c79765fb449c376`, rama inicial `codex/vendedor-facturacion-cae`, árbol limpio. Rama de trabajo: `codex/modulo-envios-v08`, conservando los cambios fiscales existentes. `gh pr list --state open` devolvió `[]`.
- Fuentes disponibles: los seis archivos HTML/JSON/MD/TXT del paquete en Temp. No disponibles: propuesta funcional v0.5 PDF/DOCX y PDF original de etiquetas. El prototipo se inspeccionó como composición, sin copiar su CSS ni sus datos ficticios.
- Shipping era un módulo genérico con escrituras directas de navegador; no había motor logístico. Venta Rápida ya tenía selector de envío sin captura logística; el vendedor tenía cola offline propia.
- Reutilizar: POS, clientes, pagos, descuentos, planes operativos de ventas, permisos, cuenta de servicio REST/transacciones, estilos y componentes, alertas, Firebase Auth. No ejecutar ARCA ni tocar datos remotos durante las pruebas.
- Riesgos: doble descuento por reintento/aprobación, anulación fiscal que reponga stock diferido inexistente, edición de venta que altere snapshots logísticos, fuga de datos por QR, entrega sin ubicación verificable. Operaciones logísticas y ventas con envío serán autoridad del backend. La cola presencial existente se conserva; se bloquearán envíos offline explícitamente.
- No se despliega, mezcla ni modifica producción. No se activan integraciones Ecommerce/Uber/WhatsApp. Geocoding/mapas sin proveedor tendrán estado explícito; destino no verificado exigirá excepción supervisada para cerrar entrega.

## Resultado por fase

| Fase | Estado | Resultado verificable |
| --- | --- | --- |
| F0 Auditoría | HECHO | Base fiscal preservada; rama aislada y fuentes identificadas. |
| F1 Ventas y stock | HECHO en local | Modal en el POS existente; vendedor online con stock diferido; aprobación atómica del origen real. Idempotencia de venta, movimientos y solicitud, recuperación de confirmación perdida y compatibilidad con intentos anteriores a esta versión. |
| F2 Operación y etiquetas | HECHO en local | Tres pestañas, filtros, ficha, tareas compartidas, multi-asignación, campana persistente por destinatario y PDF A4 único con QR vectoriales independientes. |
| F3 QR, reparto e incidencias | HECHO en local | Selector público sin datos personales; sesión y asignación para preparar; credenciales por envío/tramo para repartidor; transiciones contextuales; incidentes críticos, revisión, corrección, reasignación y reintentos auditados. |
| F4 GPS, mapa y cliente | PARCIAL | Código de GPS voluntario en última milla, precisión/antigüedad, revocación, geocerca configurable y excepción supervisada, seguimiento sólo lectura y limpieza de puntos vencidos. El mapa integrado y autocompletado dependen de elegir/configurar proveedor. Hay verificación manual del marcador y enlaces a Google Maps. No se probó GPS físico ni seguimiento en segundo plano. |
| F5 Contratos futuros | HECHO | Contratos y adaptadores de Ecommerce, Uber API y WhatsApp deshabilitados; evento `shipping.tracking_ready` en outbox sin credenciales públicas en texto plano. |

Los cambios están en el árbol local de `codex/modulo-envios-v08`. No se creó commit, PR, merge ni despliegue. No se emitieron CAE ni se operaron ventas, clientes o pedidos productivos.

## Rutas y uso

- `/gestion/shipping`: Tablero / Solicitudes del vendedor / Mis preparaciones y etiquetas. El alta conduce exclusivamente al POS `/gestion/quick-sales`.
- `/gestion/shipping?shipment=…`: ficha accesible desde tablero y notificaciones. Incluye productos, cliente, origen comercial/físico, eventos, impresión y acciones autorizadas.
- `/vendedor?view=shipping-tasks`: mismo componente de tareas, después de Precios. `Pendientes` mantiene su significado offline. La venta y el recibo permiten abrir el estado del envío aunque el vendedor no esté asignado como preparador.
- `/e/:publicLookupId`: QR estable que sólo identifica el envío. Elegir personal requiere Firebase y asignación; elegir repartidor requiere credencial temporal adicional.
- `/reparto#credencial`: portal del repartidor. Una acción principal por estado y tramo. En repositorio el primer repartidor recibe sólo la dirección del repositorio, sin teléfono del cliente.
- `/seguimiento#credencial`: enlace distinto, revocable y de sólo lectura. En repositorio sólo puede generarse al salir a reparto final. Nunca muestra el recorrido previo ni datos de pagos, stock, CRM o repartidor.

Los tokens viajan en fragmentos de URL y cuerpos POST, con respuestas sin caché y política sin referente. No son credenciales de Firebase. No se guardan tokens en claro en Firestore, eventos ni outbox; sólo SHA-256, ámbito, versión y vencimiento. Cada nueva emisión revoca el enlace previo del mismo tipo/tramo; también se pueden revocar todos los accesos.

## Integridad y decisiones operativas

- La transacción de alta reutiliza `buildOperationalSalePlan`, clientes, descuentos, pagos y fecha argentina. Venta rápida conserva la política vigente: un local puede quedar negativo con advertencia; un depósito no admite negativos. No se agregó una excepción nueva de inventario.
- Vendedor: venta comercial en Local A, sin movimientos de stock al registrar. La aprobación con permiso `shipping.approve` y permiso sobre inventario descuenta de B, conservando `sales.locationId=A`. Un responsable logístico sin esos permisos puede gestionar pero no aprobar stock.
- Preparación, etiquetas, reparto, dirección y reintento nunca descuentan otra vez. Reintentar un `no_entregado` exige confirmar físicamente dónde está el pedido y un motivo. No equivale a nueva venta.
- Las operaciones releen perfil, estado, stock y credenciales dentro de la transacción. Eventos inmutables incluyen secuencia, rol/autor, estados y tramos. Las operaciones guardan recibos idempotentes sin secretos.
- Las solicitudes con envío offline se bloquean tanto en UI como en almacenamiento/servicio. La cola presencial y su sincronización no se reemplazan.
- Anular, devolver o no entregar un envío no repone stock ni devuelve dinero. La edición y anulación antiguas de ventas vinculadas quedan bloqueadas para evitar reposición sobre un origen incorrecto. La conciliación financiera/fiscal y los movimientos compensatorios necesitan un flujo supervisado separado; no se automatizaron en esta versión.
- Correcciones de dirección actualizan el snapshot del envío y su revisión, con antes/después y motivo; no modifican el CRM. Invalidan pruebas y excepciones anteriores de entrega.
- Las notificaciones usan `alerts`, deduplicadas por envío/evento/destinatario. Sólo asignación, solicitud, listo, entrega y problemas generan avisos. Los demás movimientos y puntos GPS no generan ruido. Resolver una incidencia cierra sus alertas críticas.
- Las etiquetas usan tres columnas y tamaño variable, con tres estándar por A4. No contienen precios, pagos, DNI/CUIT ni datos fiscales. Se auditan autorización/generación y solicitudes de reimpresión; el navegador no puede certificar que una impresora física imprimió. Si una etiqueta excede una página completa se informa el error y nunca se corta texto.

## Archivos y alcance técnico

| Archivos | Propósito / consideración |
| --- | --- |
| `netlify/functions/shipping.mjs`, `_lib/shipping.mjs` | Autenticación, ventas con envío, aprobación, transiciones, permisos, rate limit y credenciales. Reutilizan cuenta de servicio y transacciones REST existentes. |
| `src/shared/shippingDomain.mjs`, `shippingIntegrations.mjs` | Estados y proyecciones, validación GPS/geocerca, vista pública y contratos desactivados. |
| `src/gestion/services/shippingService.js` | Adaptador UI/backend, suscripciones autorizadas, persistencia de intentos del vendedor y emisión segura de enlaces. |
| `ShippingPage.jsx`, `gestion/shipping/*` | Tablero, ficha, formularios, portales, PDF, tareas y notificaciones con componentes/tokens existentes. |
| `QuickSalesPage.jsx`, `SellerPanel.jsx`, `sellerService.js`, `operationalWritePlans.mjs` | Extensión de los flujos de venta existentes, sin sustituir POS ni facturación. |
| `sellerDomain.js`, `sellerValidation.js`, `offlineSales.js` | Nueva pestaña, mensajes y bloqueo explícito de envíos offline. |
| `ManagementApp.jsx`, `ManagementShell.jsx`, `routePreload.js`, `modules.js`, `App.jsx`, `ManagementSurface.jsx`, `icons.jsx` | Rutas dedicadas, navegación, campana e iconos Lucide. |
| `firestore.rules`, `firestore.indexes.json` | Lectura por ámbito, bloqueo de escrituras directas y credenciales, índices y TTL. Finanzas conserva lectura individual para sus referencias existentes. |
| `managementService.js`, `olivia/extendedOperations.mjs`, `arca/saleCancellation.mjs` | Cierran las vías genéricas de alta y la anulación antigua que podrían violar la logística. |
| `shipping-retention.mjs`, `_lib/shippingRetention.mjs` | Limpieza horaria del último punto vencido, con relectura transaccional para preservar actualizaciones concurrentes. |
| `netlify.toml` | GPS limitado al propio origen. CSP y demás restricciones se conservan. |
| `package*.json` | jsPDF, qrcode, jsqr para QA; scripts de pruebas. Actualización puntual de la dependencia de desarrollo `source-map-js` corregida por auditoría. |
| `tests/shipping*.test.mjs`, `firestore.shipping.rules.mjs`, `helpers/shippingFixtures.mjs`, `qa-shipping-*.mjs` | Casos de negocio, reglas/concurrencia en emulador, PDF, lectura QR y navegador aislado. Se actualizaron los fixtures de pruebas existentes para los nuevos estados y el cierre de la vía genérica de Olivia. |

## Configuración antes de habilitar en un entorno

Las reglas e índices de esta rama todavía no se publicaron en Firebase. El usuario autorizó expresamente usar el Firebase original en un Deploy Preview para pruebas manuales (16/10/2026). Sus ventas, clientes y movimientos son reales. No se emiten facturas como parte de las pruebas automáticas.

Si faltan reglas o índices de esta versión, las suscripciones de envíos y avisos pasan a una lectura autenticada de backend, limitada por creador/asignación/rol y destinatario. Se actualiza al operar, recuperar el foco o cada minuto con la pestaña visible. Esto permite probar el preview sin publicar reglas globales que podrían afectar la aplicación anterior. El backend vuelve a validar el usuario y sólo permite marcar como leídos sus propios avisos. Las lecturas de respaldo invocan funciones y pueden consumir cómputo/tráfico; un Deploy Preview no implica consumo total cero.

Las ventas vinculadas a envíos tienen bloqueada la anulación fiscal habitual para evitar devolver stock a un origen incorrecto. Cancelar un envío no repone inventario ni revierte dinero. Anotar ventas y movimientos de cualquier prueba real para su conciliación/compensación administrativa posterior. El transporte Repositorio requiere su dirección configurada; sin geocerca, la entrega requiere una excepción supervisada con motivo.

El adaptador Firebase heredado fija el proyecto actual. Las pruebas de esta entrega usan fakes y emuladores de proyectos `demo-*`, sin autenticación contra producción. Para conectar un proyecto remoto de staging distinto hay que ampliar primero la lista de proyectos permitidos del adaptador común mediante una configuración explícita; no se debilitó esa protección durante este trabajo.

| Configuración | Comportamiento |
| --- | --- |
| `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY` | Credenciales del backend existente; nunca exponerlas en variables `VITE_*`. Se conserva la validación del proyecto Firebase actual. |
| `SHIPPING_ENABLED=false` | Deshabilita las operaciones y limpieza del módulo. Sin esta bandera, el código queda disponible al desplegar. |
| `VITE_PUBLIC_APP_BASE_URL` | URL HTTPS pública de gestión para etiquetas. Si falta, se usa el origen actual. Localhost está permitido únicamente para pruebas. |
| `SHIPPING_REPOSITORY_ADDRESS` | Dirección real obligatoria para crear/aprobar transporte Repositorio; se guarda snapshot. Sin configuración ese transporte se bloquea. |
| `SHIPPING_GEOFENCE_RADIUS_METERS` | Sin valor predeterminado; rango aceptado 10–1000 m. Definir con el responsable operativo. |
| `SHIPPING_GPS_MAX_ACCURACY_METERS` | Sin valor predeterminado; rango 5–200 m. Precisión peor que este valor exige excepción. |
| `SHIPPING_GPS_MAX_AGE_SECONDS` | Sin valor predeterminado; rango 10–300 s. Los tres valores deben configurarse para habilitar geocerca. |
| `SHIPPING_COURIER_TTL_HOURS` | 1–24 h; predeterminado técnico 4 h por tramo, modificable. |
| `SHIPPING_TRACKING_TTL_HOURS` | 1–720 h; predeterminado técnico 168 h. Enlace siempre revocable. |

La geocerca usa destino verificado, último punto del permiso vigente, hora y precisión. Ante coordenadas sin verificar, GPS denegado/obsoleto o configuración incompleta, se bloquea la entrega hasta que administración autorice una excepción para esa credencial y revisión del destino, válida 30 minutos. El repartidor no puede autorizarla con su token. GPS de navegador no es una prueba antifraude ni garantiza funcionamiento en segundo plano.

El último punto se sobrescribe, nunca se agrega un historial GPS. Se deja de publicar al vencer (120 s de fallback visual si falta configuración); entrega/cancelación/revocación lo eliminan. La función programada elimina puntos vencidos cada hora, hasta 200 por ejecución, revalidando que no hayan sido reemplazados. Requiere verificar su activación en Netlify al desplegar. `shipmentAccess.expiresAt` y `shippingRateLimits.expiresAt` incluyen configuración TTL; aun antes del borrado físico se comprueba vencimiento en cada request. Una IP admite hasta 90 solicitudes públicas por minuto, persistidas por bucket.

Los índices nuevos cubren `shippingSchemaVersion + updatedAt`, asignación/creador con actualización, y alertas por origen/destinatario/activo. No se usaron permisos públicos de Firestore. El mapa y geocodificación quedan sin proveedor; `createShippingGeocoder(provider)` define el punto de extensión y no inventa candidatos cuando no está configurado. Elegir proveedor/costo y conectar autocompletado/mapa requiere una siguiente decisión técnica explícita.

## Pruebas y evidencias

- `npm test`: **978 pruebas** de regresión (incluye envíos y lectura autenticada de respaldo; última salida en `tmp/shipping-preview-tests.log`).
- `npm run test:shipping`: **22 pruebas** focalizadas, todas correctas.
- `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run test:rules`: **138 pruebas** correctas. Nueva suite shipping: **5**, incluida concurrencia real de venta/aprobación. Tras los últimos cambios del backend se volvió a ejecutar la suite shipping con resultado correcto.
- `npm run build:surfaces`: compilación correcta de gestión y ecommerce. Se volvió a compilar gestión tras cambios de UI. Vite conserva advertencia de chunks grandes; no es un error de compilación.
- Empaquetado esbuild de ambas funciones con objetivo Node 20: correcto.
- `npm run test:shipping:ui`: **6 verificaciones** en Chrome headless, 1440 px / 390 px; aprobación desde depósito, PDF por asignación, Escape, ausencia de desborde móvil, modal en POS existente y QR que exige autorización de repartidor. Cero errores JavaScript. Servicios aislados con datos sintéticos, sin Firebase/ARCA reales. Requiere Playwright y Chrome locales; `SHIPPING_QA_NODE_MODULES` puede apuntar al runtime de Codex.
- `node tests/qa-shipping-pdf.mjs`: PDF sintético de 4 etiquetas en 2 páginas, renderizado con Poppler y revisado visualmente. `pdftoppm -r 300 -png …` + `qa-shipping-qr-render.mjs`: **4 QR diferentes decodificados desde el PDF real a 300 dpi**, no sólo desde el generador QR.
- `npm audit`: **0 vulnerabilidades** después de la actualización puntual de `source-map-js`. `git diff --check`: correcto.

Evidencia sintética conservada en `docs/shipping-evidence/`: vistas de escritorio/móvil, modal del POS, selector QR, PDF y resultados. No demuestra GPS en un dispositivo físico ni acceso productivo. Las pruebas de reglas emiten denegaciones esperadas al probar ataques; la salida final tiene cero fallos.

## Históricos y pendientes de activación

No hay migración automática. El tablero consulta sólo `shippingSchemaVersion=1` para no interpretar registros genéricos antiguos como pedidos operativos. Si se recupera una confirmación vieja de Venta Rápida se devuelve la venta existente y se exige revisión logística, sin segunda venta ni nuevo descuento.

Plan seguro de backfill: inventariar registros antiguos y ventas con `deliveryMethod=shipping` en staging; cruzar venta↔movimientos reales; resolver duplicados y faltantes con administración; preparar un informe de simulación; sólo después de autorización explícita crear vínculos/snapshots con stock marcado según evidencia y eventos de migración. No asumir que un envío antiguo ya estaba preparado, descontado o entregado.

Pendientes que requieren decisión o prueba externa: proveedor y costo de mapas/geocoding; radio/antigüedad/precisión de geocerca; revisar vigencia de credenciales y forma de compartirlas; política/evidencia de entrega; retención GPS operativa; cualquier excepción de inventario; costos logísticos; conciliación financiera y compensación de stock tras cancelación/devolución. Escalabilidad: tablero acotado a 250 pedidos recientes, catálogo de usuarios limitado a 180 por operación y ficha a 1000 eventos; ampliar con paginación/consultas antes de superar esas capacidades. Validar GPS y permisos en móviles físicos, entrega/reintento supervisados e impresión A4 al 100 % en staging antes de producción.
