# Gestión de envíos v0.8 — auditoría y entrega

> **ESTADO VIGENTE — 20/10/2026.** La sección GPS de esta auditoría registra la versión anterior y queda archivada. En la rama actual, cliente, detalle de Gestión y repartidor usan seguimiento ilustrado por estados. No se solicitan permisos ni se comparten coordenadas; el mapa de seguimiento fue retirado. Los modos GPS antiguos devuelven `410` sin escribir en Firestore. El Deploy Preview #40 está configurado para Firebase staging `app-integral-fm-pruebas`; no desplegar ni fusionar a Production desde esta tarea. Consultá [seguimiento ilustrado vigente](shipping-illustrated-tracking.md) antes de continuar desde esta documentación histórica.

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
| F3 QR, reparto e incidencias | HECHO en local | Selector público sin datos personales; sesión y asignación para preparar; activación limitada por posesión del QR impreso para el próximo tramo de un solo pedido; transiciones contextuales; incidentes críticos, revisión, corrección, reasignación y reintentos auditados. |
| F4 Seguimiento visual (reemplazo de la implementación GPS anterior) | VIGENTE | Escena SVG original y progreso dependiente de etapas confirmadas; sin mapa ni GPS en el cliente, detalle o portal del repartidor. Leaflet se conserva sólo para elegir manualmente el pin de domicilio en Gestión. Los modos GPS anteriores responden `410`. |
| F5 Contratos futuros | HECHO | Contratos y adaptadores de Ecommerce, Uber API y WhatsApp deshabilitados; evento `shipping.tracking_ready` en outbox sin credenciales públicas en texto plano. |

Los cambios están en `codex/modulo-envios-v08` y PR borrador #40. El Deploy Preview está en https://deploy-preview-40--appintegralflormia.netlify.app/gestion/shipping. La primera ronda manual usó Firebase original con autorización; luego se configuró `app-integral-fm-pruebas` para las pruebas del preview. Los registros de la ronda inicial identificados `PRUEBA QA ENVÍOS 40` son ventas reales del proyecto original y deben conciliarse; no se emitieron CAE ni se enviaron mensajes a clientes.

## Rutas y uso

- `/gestion/shipping`: Tablero / Solicitudes del vendedor / Mis preparaciones y etiquetas. El alta conduce exclusivamente al POS `/gestion/quick-sales`.
- `/gestion/shipping?shipment=…`: ficha accesible desde tablero y notificaciones. Incluye productos, cliente, origen comercial/físico, eventos, impresión y acciones autorizadas.
- `/vendedor?view=shipping-tasks`: mismo componente de tareas, después de Precios. `Pendientes` mantiene su significado offline. La venta y el recibo permiten abrir el estado del envío aunque el vendedor no esté asignado como preparador.
- `/e/:publicLookupId`: QR impreso para el envío. Elegir personal requiere Firebase y asignación; elegir repartidor activa en el servidor una autorización temporal limitada al próximo tramo, sin ingresar un código. El QR de acceso multi-pedido generado por Gestión sigue usando su sesión temporal independiente.
- `/reparto#credencial`: portal del repartidor. Una acción principal por estado y tramo, con escena ilustrativa por hitos. El primer tramo no muestra teléfono/domicilio del cliente y ningún tramo solicita GPS.
- `/seguimiento#credencial`: enlace distinto, revocable y de sólo lectura. Devuelve estado, tipo de transporte, código y fecha de actualización para representar etapas; no lee ubicación ni expone coordenadas, traza o sesión. Nunca muestra datos de pagos, stock, CRM o repartidor.

Los tokens viajan en fragmentos de URL y cuerpos POST, con respuestas sin caché y política sin referente. No son credenciales de Firebase. No se guardan tokens en claro en Firestore, eventos ni outbox; sólo SHA-256, ámbito, versión y vencimiento. Cada nueva emisión revoca el enlace previo del mismo tipo/tramo; también se pueden revocar todos los accesos.

## Integridad y decisiones operativas

- La transacción de alta reutiliza `buildOperationalSalePlan`, clientes, descuentos, pagos y fecha argentina. Venta rápida conserva la política vigente: un local puede quedar negativo con advertencia; un depósito no admite negativos. No se agregó una excepción nueva de inventario.
- Vendedor: venta comercial en Local A, sin movimientos de stock al registrar. La aprobación con permiso `shipping.approve` y permiso sobre inventario descuenta de B, conservando `sales.locationId=A`. Un responsable logístico sin esos permisos puede gestionar pero no aprobar stock.
- Preparación, etiquetas, reparto, dirección y reintento nunca descuentan otra vez. Reintentar un `no_entregado` exige confirmar físicamente dónde está el pedido y un motivo. No equivale a nueva venta.
- Las operaciones releen perfil, estado, stock y credenciales dentro de la transacción. Eventos inmutables incluyen secuencia, rol/autor, estados y tramos. Las operaciones guardan recibos idempotentes sin secretos.
- Las solicitudes con envío offline se bloquean tanto en UI como en almacenamiento/servicio. La cola presencial y su sincronización no se reemplazan.
- Anular, devolver o no entregar un envío no repone stock ni devuelve dinero. La edición y anulación antiguas de ventas vinculadas quedan bloqueadas para evitar reposición sobre un origen incorrecto. La conciliación financiera/fiscal y los movimientos compensatorios necesitan un flujo supervisado separado; no se automatizaron en esta versión.
- Correcciones de dirección actualizan el snapshot del envío y su revisión, con antes/después y motivo; no modifican el CRM. Invalidan pruebas y excepciones anteriores de entrega.
- Las notificaciones usan `alerts`, deduplicadas por envío/evento/destinatario. Sólo asignación, solicitud, listo, entrega y problemas generan avisos. Resolver una incidencia cierra sus alertas críticas.
- Las etiquetas usan tres columnas y tamaño variable, con hasta cinco estándar por A4. No contienen precios, pagos, DNI/CUIT ni datos fiscales. Se auditan autorización/generación y solicitudes de reimpresión; el navegador no puede certificar que una impresora física imprimió. Si una etiqueta excede una página completa se informa el error y nunca se corta texto.

## Archivos y alcance técnico

| Archivos | Propósito / consideración |
| --- | --- |
| `netlify/functions/shipping.mjs`, `_lib/shipping.mjs` | Autenticación, ventas con envío, aprobación, transiciones, permisos, rate limit y credenciales. Reutilizan cuenta de servicio y transacciones REST existentes. |
| `src/shared/shippingDomain.mjs`, `shippingIntegrations.mjs` | Estados y proyecciones stage-only, validación de coordenadas para selector manual de domicilio y contratos desactivados. |
| `src/gestion/services/shippingService.js` | Adaptador UI/backend, suscripciones autorizadas, persistencia de intentos del vendedor y emisión segura de enlaces. |
| `ShippingPage.jsx`, `gestion/shipping/*` | Tablero, ficha, formularios, portales, PDF, tareas y notificaciones con componentes/tokens existentes. |
| `QuickSalesPage.jsx`, `SellerPanel.jsx`, `sellerService.js`, `operationalWritePlans.mjs` | Extensión de los flujos de venta existentes, sin sustituir POS ni facturación. |
| `sellerDomain.js`, `sellerValidation.js`, `offlineSales.js` | Nueva pestaña, mensajes y bloqueo explícito de envíos offline. |
| `ManagementApp.jsx`, `ManagementShell.jsx`, `routePreload.js`, `modules.js`, `App.jsx`, `ManagementSurface.jsx`, `icons.jsx` | Rutas dedicadas, navegación, campana e iconos Lucide. |
| `firestore.rules`, `firestore.indexes.json` | Lectura por ámbito, bloqueo de escrituras directas y credenciales, índices y TTL. Finanzas conserva lectura individual para sus referencias existentes. |
| `managementService.js`, `olivia/extendedOperations.mjs`, `arca/saleCancellation.mjs` | Cierran las vías genéricas de alta y la anulación antigua que podrían violar la logística. |
| `shipping-retention.mjs`, `_lib/shippingRetention.mjs` | Limpieza de compatibilidad para posibles puntos heredados vencidos; no se generan ubicaciones nuevas. |
| `netlify.toml` | CSP de la aplicación; los mapas/teselas no forman parte de las pantallas de seguimiento. |
| `package*.json` | jsPDF, qrcode, jsqr para QA; scripts de pruebas. Actualización puntual de la dependencia de desarrollo `source-map-js` corregida por auditoría. |
| `tests/shipping*.test.mjs`, `firestore.shipping.rules.mjs`, `helpers/shippingFixtures.mjs`, `qa-shipping-*.mjs` | Casos de negocio, reglas/concurrencia en emulador, PDF, lectura QR y navegador aislado. Se actualizaron los fixtures de pruebas existentes para los nuevos estados y el cierre de la vía genérica de Olivia. |

## Configuración antes de habilitar en un entorno

Las reglas e índices de esta rama todavía no se publicaron en Firebase. El usuario autorizó expresamente usar el Firebase original en un Deploy Preview para pruebas manuales (16/10/2026). Sus ventas, clientes y movimientos son reales. No se emiten facturas como parte de las pruebas automáticas.

Los nombres de configuración GPS conservados en el historial de abajo corresponden al despliegue anterior y no habilitan seguimiento en la versión vigente. `gps_start`, `gps_stop`, `position` y `delivery_exception` se rechazan antes de abrir una transacción; la interfaz actual no envía esos modos.

Si faltan reglas o índices de esta versión, las suscripciones de envíos y avisos pasan a una lectura autenticada de backend, limitada por creador/asignación/rol y destinatario. Se actualiza al operar, recuperar el foco o cada minuto con la pestaña visible. Esto permite probar el preview sin publicar reglas globales que podrían afectar la aplicación anterior. El backend vuelve a validar el usuario y sólo permite marcar como leídos sus propios avisos. Las lecturas de respaldo invocan funciones y pueden consumir cómputo/tráfico; un Deploy Preview no implica consumo total cero.

Las ventas vinculadas a envíos tienen bloqueada la anulación fiscal habitual para evitar devolver stock a un origen incorrecto. Cancelar un envío no repone inventario ni revierte dinero. Anotar ventas y movimientos de cualquier prueba real para su conciliación/compensación administrativa posterior. El transporte Repositorio opera por estados sin dirección obligatoria; la entrega se confirma por la acción autorizada del repartidor, no por geocerca.

El adaptador Firebase heredado fija el proyecto actual. Las pruebas de esta entrega usan fakes y emuladores de proyectos `demo-*`, sin autenticación contra producción. Para conectar un proyecto remoto de staging distinto hay que ampliar primero la lista de proyectos permitidos del adaptador común mediante una configuración explícita; no se debilitó esa protección durante este trabajo.

| Configuración | Comportamiento |
| --- | --- |
| `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY` | Credenciales del backend existente; nunca exponerlas en variables `VITE_*`. Se conserva la validación del proyecto Firebase actual. |
| `SHIPPING_ENABLED=false` | Deshabilita las operaciones y limpieza del módulo. Sin esta bandera, el código queda disponible al desplegar. |
| `VITE_PUBLIC_APP_BASE_URL` | URL HTTPS pública de gestión para etiquetas. Si falta, se usa el origen actual. Localhost está permitido únicamente para pruebas. |
| `SHIPPING_REPOSITORY_ADDRESS` | Dirección opcional del repositorio. Sin ella se muestra Repositorio de Flor Mía y se permite operar sus dos tramos. Nunca se usa como domicilio del cliente. |
| `SHIPPING_COURIER_TTL_HOURS` | 1–24 h; predeterminado técnico 4 h por tramo, modificable. |
| `SHIPPING_TRACKING_TTL_HOURS` | 1–720 h; predeterminado técnico 168 h. Enlace siempre revocable. |

La lógica de geocerca, los puntos y sesiones descritos en la especificación anterior no son parte del flujo vigente. El limpiador programado puede borrar datos GPS heredados vencidos como medida de compatibilidad; no hay captura nueva. Leaflet 1.9.4 se conserva para el selector manual de dirección de Gestión; no carga mapas en seguimiento de cliente, portal de reparto ni panel de detalle. No se utiliza geocodificación ni se inventa una ruta real.

## Pruebas y evidencias

- `npm test`: **1000 pruebas** correctas después del ajuste compacto de etiquetas.
- `npm run test:shipping`: **42 pruebas** focalizadas correctas tras la ampliación visual y del QR.
- `npm run test:shipping:ui`: **11 verificaciones** headless con Playwright y datos sintéticos, incluidas las nuevas vistas del tablero, filtros, acciones, controles del mapa y QR sin código.
- Seguimiento ilustrado v0.9: validar también `npm run test:shipping`, `npm run test:shipping:ui` y `npm run build`; el resultado más reciente se registra en la [guía vigente](shipping-illustrated-tracking.md). La captura física de GPS dejó de ser un requisito de esta etapa.
- `npm run test:rules`: debe ejecutarse con Firestore Emulator. La última invocación local no encontró `FIRESTORE_EMULATOR_HOST`; los casos terminaron antes de evaluar reglas. La regla de lecturas manager-only de `deliverySessions` tiene cobertura en `tests/firestore.shipping.rules.mjs`.
- `npm run build:surfaces`: compilación correcta de gestión y ecommerce. Vite conserva advertencia de chunks grandes; no es un error de compilación.
- Empaquetado esbuild de ambas funciones con objetivo Node 20: correcto.
- `node tests/qa-shipping-pdf.mjs`: PDF sintético de 6 etiquetas en 2 páginas; entran cinco etiquetas compactas estándar en la primera y la etiqueta extensa continúa en la segunda. Renderizado con Poppler y revisado visualmente. `pdftoppm -r 300 -png …` + `qa-shipping-qr-render.mjs`: **6 QR diferentes decodificados desde el PDF real a 300 dpi**, no sólo desde el generador QR.
- `npm audit`: **0 vulnerabilidades** después de la actualización puntual de `source-map-js`. `git diff --check`: correcto.

Evidencia sintética conservada en `docs/shipping-evidence/`: vistas de escritorio/móvil, modal del POS, selector QR, PDF y resultados. No demuestra GPS en un dispositivo físico ni acceso productivo. Las pruebas de reglas emiten denegaciones esperadas al probar ataques; la salida final tiene cero fallos.

Prueba manual remota del 16/10/2026: [informe del Preview 40](shipping-manual-preview-40.md). Ambos recorridos ficticios se completaron en el Firebase original con consentimiento del usuario, conservando un único descuento por pedido. El GPS real no obtuvo posición en este equipo; el cierre se verificó mediante excepción supervisada. El informe identifica ventas, movimientos, hallazgos corregidos y pendientes externos.

Historial GPS anterior: [panel y pruebas del repartidor](shipping-courier-gps.md), [arquitectura GPS](shipping-live-tracking.md). Ambos documentos están archivados y enlazan a la guía vigente de seguimiento ilustrado.

Adaptación visual del 19/10/2026: [continuidad desde otra PC](CONTINUAR-ENVIOS.md), [referencias originales v07](shipping-reference/v07/README.md) y [evidencia implementada](shipping-evidence/visual-v07/README.md). La etiqueta QR muestra el selector de acceso interno/repartidor; el personal conserva su autenticación y asignación.

## Tablero, detalle y acceso desde el QR impreso (20/10/2026)

El tablero abre en **Todos** y limita el período inicial a la semana actual de Argentina (lunes a domingo). El único botón **Filtrar envíos** despliega la búsqueda, domicilio, período, origen, transporte, preparador y estado; ofrece Hoy, Esta semana, Este mes, fechas manuales o todo el historial. La tabla abre el detalle al tocar una fila, admite teclado, muestra una mini ruta y ya no repite un botón por fila. El constructor de recorridos queda después de la tabla.

En el detalle, **Acciones del envío** reúne las acciones permitidas al perfil y al estado. Cada opción explica el efecto antes de abrir su formulario; las acciones de preparación informan el cambio al Panel Vendedor. La tarjeta de seguimiento muestra una escena SVG por estados, sin mapa ni puntos GPS. El selector de coordenadas sólo aparece al editar manualmente la dirección del cliente. Eventos siguen a la derecha en escritorio.

El QR impreso es una capacidad temporal para el próximo tramo de un solo pedido: al elegir **Soy repartidor**, el servidor lo activa sin solicitar un código y devuelve una sesión de cuatro horas (configurable de 1 a 24). Sólo permite la siguiente acción logística e informar una incidencia; no permite revisar existencias, cambiar domicilio, asignar personal ni modificar stock. La etiqueta es el secreto físico que inicia este permiso: si se pierde o comparte, Gestión puede revocar el acceso. Un envío sin stock aprobado, aún no listo, pausado por incidencia, cerrado o ya asignado a un recorrido activo no se puede activar desde la etiqueta. Las entregas por Repositorio vuelven a escanear la misma etiqueta para habilitar el segundo tramo después de confirmar la recepción.

El acceso **Soy personal de Flor Mía** sigue requiriendo una cuenta activa. El backend comprueba que el pedido esté asignado a esa cuenta antes de permitir marcarlo listo. Si la persona aún no tiene usuario, Administración debe crear su cuenta y asignarle el pedido; escanear la etiqueta no crea permisos de personal.

Verificación de esta ampliación: `npm run test:shipping` cubre activación, idempotencia, vencimiento y rechazo de estados no elegibles; `npm run test:shipping:ui` cubre período predeterminado, filtros plegables, fila clicable, menú de acciones, posición de controles del mapa y QR sin ingreso manual. Ambos recorridos usan datos sintéticos en el laboratorio UI.

## Etiquetas compactas (20/10/2026)

Se revisó el PDF de ejemplo entregado por el usuario. La etiqueta estándar bajó de 78 mm a unos 46,8 mm de alto (40% menos); las fuentes principales crecieron un 20% y el QR vectorial quedó en 19,5 mm con su zona de silencio. Teléfono, dirección, observaciones y pedido ahora tienen el texto arriba y su renglón debajo. Las etiquetas más extensas crecen y saltan de página sin recortar información. La vista previa de Gestión muestra el formato compacto. Regresión: `npm run test:shipping`, compilación de Gestión y lectura de los seis QR desde el PDF renderizado a 300 dpi. [PDF sintético de muestra](../output/pdf/Flor-Mia-Etiquetas-compactas-ejemplo.pdf).

## Históricos y pendientes de activación

No hay migración automática. El tablero consulta sólo `shippingSchemaVersion=1` para no interpretar registros genéricos antiguos como pedidos operativos. Si se recupera una confirmación vieja de Venta Rápida se devuelve la venta existente y se exige revisión logística, sin segunda venta ni nuevo descuento.

Plan seguro de backfill: inventariar registros antiguos y ventas con `deliveryMethod=shipping` en staging; cruzar venta↔movimientos reales; resolver duplicados y faltantes con administración; preparar un informe de simulación; sólo después de autorización explícita crear vínculos/snapshots con stock marcado según evidencia y eventos de migración. No asumir que un envío antiguo ya estaba preparado, descontado o entregado.

Pendientes antes de producción: repetir manualmente el flujo completo con las cuentas reales de vendedor/preparador de permisos limitados e inspeccionar cámara e impresión A4 al 100 % en staging. No se requiere probar GPS, configurar geocerca ni contratar mapas para este seguimiento ilustrado. La conciliación financiera y cualquier compensación de stock tras cancelación/devolución siguen siendo flujos supervisados. Escalabilidad: tablero acotado a 250 pedidos recientes, catálogo de usuarios limitado a 180 por operación y ficha a 1000 eventos; ampliar con paginación/consultas antes de superar esas capacidades.
