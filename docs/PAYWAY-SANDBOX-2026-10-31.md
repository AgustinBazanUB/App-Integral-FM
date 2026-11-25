# Payway Sandbox — integración y verificación

Estado: compra auténtica aprobada por Payway Sandbox desde Chrome y circuito comercial verificado en pruebas. Implementación en rama de revisión; no autoriza fusión a `main` ni cobros productivos.

## Auditoría inicial

Base actualizada: `origin/main`, commit `62bd617`. Main tenía checkout pendiente, contrato `payway` y confirmación comercial interna, sin SDK, tokenización ni endpoint real de pagos. El circuito de reservas físicas, canal Página web, CRM, métricas, logística y seguimiento privado existía en el PR #53, aún abierto. Esta rama incorpora sus commits hasta `ed3990a` como dependencia; no se fusionó ese PR en main. No se tocaron los archivos locales no versionados de `auditorias/`.

La tienda independiente no despliega Functions administrativas. Sus proxies públicos permitidos llegan a las Functions del Deploy Preview de Gestión. Se agrega únicamente `/api/ecommerce/payway` a catálogo, checkout y seguimiento; la clave privada permanece en el backend. Las reglas ya niegan escrituras del navegador sobre orders, payments y ventas web.

Se detectaron pruebas desactualizadas tras el cambio del catálogo para ocultar cantidades físicas y la disponibilidad agregada entre orígenes. Se mantienen las aserciones de disponibilidad y se ajusta el fixture del último producto para tener un único origen disponible. Se corrigió el cambio administrativo de origen: ahora actualiza también `items[].stockAllocations`; antes podía dejar la reserva apuntando al origen anterior.

## SDK y fuentes

- Backend oficial `sdk-node-payway@1.0.8`, fijado en package.json y lockfile. Requiere Node >=18; Netlify utiliza Node 20. Integración CommonJS mediante `createRequire`, empaquetada como dependencia externa con esbuild.
- Dependencias originales: express 4.16.4, node-rest-client 3.1.1 y promise ^8.0.1. Overrides reproducibles: express 4.22.3 y re2js 2.9.1. `npm audit --omit=dev`: cero vulnerabilidades tras la corrección.
- Se desactiva exclusivamente el logger privado del SDK ANTES de cargarlo: el código publicado imprime `apikey` y payloads completos. No se silencia el console de la aplicación. Se añaden manejo de errores y timeouts a su transporte.
- Frontend oficial: `https://ventasonline.payway.com.ar/static/v2.6.4/decidir.js`. PAN y CVV se capturan en campos no controlados, se tokenizan directamente contra sandbox y se vacían; no se envían al backend, analítica ni almacenamiento local. El backend acepta token efímero, BIN, modo, pedido, clave privada de consulta y los campos permitidos de domicilio/fingerprint para la evaluación Retail. Una sola instancia del SDK por página evita inicializaciones duplicadas de captura antifraude al cambiar de pedido.
- [SDK Node](https://github.com/payway-ar/sdk-node-ventaonline), [SDK JavaScript](https://github.com/payway-ar/sdk-javascript-ventaonline), [referencia Node](https://documentacion-ventasonline.payway.com.ar/docs/sdk-s/8eucdoynmh3ox-alcance), [tabla de parámetros](https://documentacion-ventasonline.payway.com.ar/docs/sdk-s/qpqt8nfx10igh-tablas-de-referencia), [medios de pago](https://documentacion-ventasonline.payway.com.ar/docs/gateway/3jw3eiapx1jwu-medios-de-pago).

La tabla oficial especifica monto mínimo 1 = ARS 0,01: se envían centavos enteros, una sola conversión desde el total autoritativo. Mastercard crédito Payway es el medio **104**; el ID 1 corresponde a Visa aunque algunos ejemplos antiguos del SDK lo comentan incorrectamente como Mastercard. Se admite una cuota. El número comercial 6032049 no se utiliza como Site ID.

Se evaluó el checkout alojado disponible en el SDK, pero requiere plantilla/contrato de enlaces y notificaciones distinto de la tokenización directa. Esta implementación utiliza el mecanismo JavaScript oficial NO PCI documentado por Payway. Que los datos no pasen por el servidor no constituye certificación PCI: antes de producción corresponde validar con el adquirente el SAQ aplicable, integridad y controles de los scripts de la página de pago, antifraude y 3DS para el comercio.

## Arquitectura y seguridad

1. El checkout existente calcula precios, promociones, envío y disponibilidad desde Firestore. Crea un pedido, pago y reservas con referencia estable; no usa totales del cliente.
2. Payway sólo se habilita con `PAYWAY_ENABLED=true`, `PAYWAY_ENVIRONMENT=sandbox`, Firebase cliente/servidor de pruebas, cuenta de servicio de ese proyecto, contexto no productivo y ARCA homologación.
3. Un claim transaccional crea `payments.gateway` antes de llamar al proveedor. La referencia `fm_<hash del pedido>` no cambia. Un segundo clic o recarga no puede ejecutar otro POST de cobro. La reserva se extiende 24 horas mientras se verifica. No se guarda el token.
4. La respuesta autenticada se valida contra operación, Site ID, moneda, importe, medio y cuotas. Sólo se conserva un recibo con campos permitidos; nunca la respuesta completa ni sus tokens/card_data/PAN. La aprobación queda durable antes de registrar la venta.
5. El confirmador existente exige ese recibo para Payway y realiza una única transacción de pedido/pago/CRM/venta/stock/logística/auditoría. No depende de una confirmación del navegador ni de un webhook no autenticado.
6. Timeout, respuesta inválida, ausencia o resultado incierto conservan la referencia y bloquean otro cobro. Conciliación consulta `getAllPayments` por siteOperationId + merchantId y después `paymentInfo`. Sólo una coincidencia válida puede confirmar. Si la venta falla después de una aprobación, queda `recovery_required`, una incidencia visible en el pedido administrativo y se reintenta la operación comercial sin volver a cobrar. Administración puede consultar/conciliar desde el panel, con perfil activo verificado, sin conocer la clave del comprador.
7. Cambios administrativos y liberación de reserva se bloquean mientras el pago está incierto. Un rechazo/cancelación confirmado no crea venta ni salida y libera las reservas dentro de la confirmación transaccional. Esta primera versión conserva un único intento de cobro por pedido; un nuevo intento tras rechazo o vencimiento requiere pulsar explícitamente «Crear un nuevo pedido», sin borrar el anterior. Mi pedido permite recuperar el pago con la clave privada de consulta.
8. Sandbox usa `paymentEnvironment:sandbox` y `testData:true` en pedido, pago, venta, stock y logística. Se excluye de ingresos comerciales reales. Se bloquea preparación/autorización fiscal productiva. No se llama ARCA en el checkout Payway.

El botón queda bloqueado durante el intento; sólo se vacía el carrito después de aprobación y venta confirmadas. El pedido y los datos se conservan tras errores o recarga. La clave de consulta viaja en POST, no en URL. La CSP incorpora el script oficial versionado, los orígenes sandbox y `https://h.online-metrix.net` para la captura antifraude; no habilita la API productiva.

## Configuración

Variables nuevas, sin valores privados: `PAYWAY_ENABLED`, `PAYWAY_ENVIRONMENT`, `PAYWAY_SANDBOX_SITE_ID`, `PAYWAY_SANDBOX_PUBLIC_KEY`, `PAYWAY_SANDBOX_PRIVATE_KEY`. La clave privada es secreto de Netlify y nunca `VITE_*`. Se importó un CSV descargado fuera del repositorio sin imprimir sus valores secretos. Se validó acceso autenticado de lectura al sandbox (HTTP 200) y se configuraron valores exclusivamente en Deploy Previews del sitio backend. ARCA se fijó en homologación para ese contexto; no se modificó su contexto de producción.

El plan de Netlify no permite scopes específicos; el secreto usa los scopes de secretos admitidos builds/functions/runtime. No se incorpora al bundle Vite y se verifica que no aparezca en archivos versionados ni artifacts públicos. La tienda separada sólo necesita `ECOMMERCE_BACKEND_URL` apuntando a este Deploy Preview y la configuración Firebase web pública completa de pruebas.

Cambiar a producción no consiste en poner una clave productiva: el código falla cerrado. Requiere una actualización revisada con configuración, medios habilitados, adquirente, PCI/antifraude/3DS, conciliación operativa, política fiscal y autorización explícita del propietario. Nunca se promocionan documentos o cuentas de staging.

## Validación

- 1134 pruebas Node aprobadas, incluidas 24 específicas de Payway.
- Builds Gestión y E-commerce aprobados; advertencia existente de tamaño de chunks.
- SDK Node real: consulta autenticada de sandbox aprobada, sin datos ni claves en logs.
- 156 pruebas de reglas Firestore aprobadas en emulador local; sin cambios nuevos al archivo de reglas respecto del PR #53.
- CI y Deploy Preview #54 aprobados para el backend que procesó la compra (`39c272d`). Se verificaron los proyectos efectivos de Firestore y Authentication con las APIs administrativas de Google y la cuenta de servicio desde el endpoint del preview: `app-integral-fm-pruebas`, ARCA homologación. La tienda estática contiene cero Functions administrativas.
- Se encontró y descargó la [guía oficial de transacción simple](https://documentacion-ventasonline.payway.com.ar/docs/gateway/526ae201ec85c-flujo-de-una-transaccion-simple) y su OpenAPI. Su ejemplo de tarjeta es Visa; no se encontró una Mastercard de prueba verificable en las fuentes oficiales consultadas. Se agrega Visa crédito (ID 1) exclusivamente a esta implementación sandbox para verificar el ejemplo oficial; la respuesta debe coincidir con el medio seleccionado y persistido. No habilita Visa comercial productiva.
- Primer intento auténtico en Chrome: pedido `ecommerce_order_677a671f-751b-45ac-8b26-fdfb9c0964a1`, ARS 1.500, Visa, proveedor `16182378`, referencia estable `fm_6dd5193397fa4e67e074682fd8ced5bc`. Payway devolvió `rejected / cybersource_error`, consultado nuevamente mediante API privada (HTTP 200). Reserva liberada, stock físico 20, cero ventas, movimientos o envíos. Se conserva el intento y su evidencia; no se vuelve a cobrar sobre esa orden.
- Se completa la evaluación antifraude Retail oficial (`send_to_cs:true`), domicilio de facturación ingresado expresamente, totales y líneas autoritativos, IP del contexto Netlify y fingerprint del SDK. Se inicializa el SDK antes de completar la tarjeta. Se permite únicamente el origen de captura `h.online-metrix.net` en CSP. El mapper Retail del SDK 1.0.8 omitía `device_unique_id`: el adaptador lo preserva sin desactivar el antifraude ni imprimir payloads.
- La especificación descargada todavía usa un ejemplo Visa que una incidencia del repositorio oficial señala como obsoleto. Para la prueba se usó el [ejemplo corregido en esa incidencia](https://github.com/payway-ar/sdk-node-ventaonline/issues/42#issuecomment-2237502262), sin guardar su PAN/CVV en evidencia ni en el repositorio.
- **Compra aprobada desde Chrome:** pedido `ecommerce_order_34d35255-ab67-486c-bbde-b0ac7200056b`, Visa sandbox ID 1, ARS 1.500 (producto 1.000 + envío 500), Payway **16182379**, operación `fm_6b41e0ecb648937d738053a524736c37`. Envío al proveedor a las `2026-10-31T21:52:03.808Z`; consulta autenticada posterior HTTP 200 confirmó `approved`, Site ID, moneda, medio y 150.000 centavos. La fecha cruda devuelta por el proveedor se conserva sin reinterpretar en la evidencia.
- Doble clic en pagar y recarga: una única venta `ecommerce_sale_34d35255-ab67-486c-bbde-b0ac7200056b`, un movimiento de -1, stock del origen ficticio `qa-pr53-location` de **20 a 19**, reserva consumida y un envío vinculado. Carrito vacío sólo tras confirmar; consulta privada del comprador muestra aprobación y referencia. No hay incidencia pendiente.
- Logística probada en Chrome: se generó el pedido sin preparador, se asignó el usuario sintético de QA, se abrió el QR como personal asignado y se confirmó **Listo para retirar**. La preparación conserva una sola imputación de stock. Transporte manual de prueba; no se solicitó repartidor ni se realizó entrega física.
- Canal Página web: venta y envío conservan `sandbox`/`testData:true`. El modelo de métricas confirma una venta de ensayo por ARS 1.500 y **cero contribución a ingresos/ventas reales**. Administración incluye un resumen separado de pruebas Payway. Facturación queda pendiente: no se creó comprobante ni CAE y los guardas impiden emisión fiscal productiva de esta operación.
- Evidencia sin secretos ni datos de tarjeta: [consulta backend/proveedor y efectos](payway-evidence-2026-10-31/transaction.json), capturas `03-pago-aprobado.png`, `04-pedido-administrativo.png`, `05-seguimiento.png`, `06-preparacion-lista.png`, `07-metricas-sandbox.png`; se conserva además el rechazo anterior. Registros sintéticos permanecen en pruebas.
- Timeout, respuesta inconsistente, referencias ajenas y recuperación comercial se cubren con pruebas automatizadas; no se declaran ensayados manualmente todos los fallos de red. **Mastercard ID 104 está implementada pero no se realizó una aprobación auténtica con Mastercard**: falta una tarjeta de prueba certificada y validar su habilitación para este sitio. La aprobación Visa no prueba el contrato Mastercard del establecimiento 6032049.

## Revisión y archivos

- [PR #54](https://github.com/AgustinBazanUB/App-Integral-FM/pull/54), rama `codex/payway-sandbox-20261031`, hacia main. Incluye la dependencia abierta PR #53, sin integrarla a producción.
- [Tienda de revisión](https://payway-pr54--flor-mia-ecommerce-preview.netlify.app) y [Gestión de revisión](https://deploy-preview-54--appintegralflormia.netlify.app/gestion/ecommerce). Usar exclusivamente datos ficticios.
- Nuevos: adaptador `paywayGateway.mjs`, servicio `paywayService.mjs`, Function `ecommerce-payway.mjs`, formulario `PaywayPaymentForm.jsx`, 24 pruebas `ecommerce-payway.test.mjs`, esta guía y evidencia.
- Modificados: checkout y seguimiento, confirmador de pagos, gestión de pedidos, endpoint administrativo, logística, exclusión de métricas/facturación de sandbox, configuración Netlify/CSP/proxy y dependencias. Se ajustaron cuatro pruebas existentes relacionadas con catálogo/disponibilidad. El diff del PR identifica los archivos de la dependencia #53 por separado en sus commits.
- No se fusionó a main, no se desplegó código productivo ni se copiaron datos entre proyectos. La publicación requiere revisión visual y autorización explícita del propietario según AGENTS.md.

## Alcances pendientes antes de cobros reales

Esta integración está limitada deliberadamente al sandbox. Una respuesta incierta jamás habilita otro cobro automáticamente. La conciliación de esta versión es bajo consulta del cliente; no hay cron, webhook ni devolución automática. Una reserva extendida también vence: cobros tardíos que ya no puedan aplicar stock deben conservarse como incidencia para resolución supervisada, sin inventar una devolución. No se invocan repartidores, comunicaciones externas ni emisión fiscal productiva durante QA.

## Criterios de aceptación comprobados

- [x] Credenciales sandbox seguras, SDK oficial Node, tokenización directa, backend y checkout conectados. Verificación del destino real con frontend, credenciales de servicio, Authentication y Firestore de pruebas.
- [x] Totales autoritativos, protección de doble pago, aprobaciones y rechazos, recuperación incierta. Pruebas de idempotencia/timeout/mismatch/recuperación, rechazo auténtico y doble clic real en Chrome.
- [x] Compra en Chrome y aprobación auténtica, pedido, venta única, salida única de stock y canal Página web. Recibo autenticado y evidencia JSON vinculada.
- [x] Métricas de prueba separadas, tarea logística asignable, QR y preparación hasta listo. Capturas y estado persistido en pruebas.
- [x] Sin emisión fiscal productiva; sin claves privadas ni PAN/CVV en el código, bundle o evidencia. Escaneo de la clave privada sin coincidencias y revisión de capturas.
- [x] Pruebas automatizadas relevantes aprobadas, documentación y PR preparados. La matriz de fallos de red no fue reproducida por completo en Chrome: esos escenarios están verificados automáticamente.

El objetivo sandbox se verificó con Visa. Mastercard y la habilitación productiva siguen pendientes en los términos detallados arriba.

## Manifest de esta integración

Archivos agregados o modificados respecto de la dependencia PR #53 (`ed3990a`). Los archivos heredados de ese PR están en sus commits, no se atribuyen a Payway.

- `.env.example`
- `deploy/ecommerce/netlify.toml`
- `deploy/ecommerce/prepare-preview.mjs`
- `docs/PAYWAY-SANDBOX-2026-10-31.md`
- `docs/payway-evidence-2026-10-31/01-checkout-sandbox.png`
- `docs/payway-evidence-2026-10-31/02-rechazo-autentico.png`
- `docs/payway-evidence-2026-10-31/03-pago-aprobado.png`
- `docs/payway-evidence-2026-10-31/04-pedido-administrativo.png`
- `docs/payway-evidence-2026-10-31/05-seguimiento.png`
- `docs/payway-evidence-2026-10-31/06-preparacion-lista.png`
- `docs/payway-evidence-2026-10-31/07-metricas-sandbox.png`
- `docs/payway-evidence-2026-10-31/rejected-16182378.json`
- `docs/payway-evidence-2026-10-31/transaction.json`
- `netlify.toml`
- `netlify/functions/_lib/arca/authorizer.mjs`
- `netlify/functions/_lib/arca/invoicePersistence.mjs`
- `netlify/functions/_lib/ecommerce/orderManagement.mjs`
- `netlify/functions/_lib/ecommerce/paymentService.mjs`
- `netlify/functions/_lib/ecommerce/paywayGateway.mjs`
- `netlify/functions/_lib/ecommerce/paywayService.mjs`
- `netlify/functions/_lib/ecommerce/publicError.mjs`
- `netlify/functions/_lib/shipping.mjs`
- `netlify/functions/ecommerce-admin.mjs`
- `netlify/functions/ecommerce-order-status.mjs`
- `netlify/functions/ecommerce-payway.mjs`
- `package-lock.json`
- `package.json`
- `src/components/PaywayPaymentForm.jsx`
- `src/gestion/pages/EcommercePage.jsx`
- `src/modules/locations/domain/saleFacts.js`
- `src/pages/CheckoutPage.jsx`
- `src/pages/OrderStatusPage.jsx`
- `src/styles.css`
- `tests/ecommerce-channel-integral.test.mjs`
- `tests/ecommerce-payway.test.mjs`
- `tests/ecommerce-stage5.test.mjs`
- `tests/ecommerce-stage6-runtime.test.mjs`
