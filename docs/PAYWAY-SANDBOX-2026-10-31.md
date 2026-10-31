# Payway Sandbox — integración y verificación

Estado: implementación en rama de revisión; las pruebas contra el proveedor se documentan abajo a medida que se ejecutan. No autoriza fusión a `main` ni cobros productivos.

## Auditoría inicial

Base actualizada: `origin/main`, commit `62bd617`. Main tenía checkout pendiente, contrato `payway` y confirmación comercial interna, sin SDK, tokenización ni endpoint real de pagos. El circuito de reservas físicas, canal Página web, CRM, métricas, logística y seguimiento privado existía en el PR #53, aún abierto. Esta rama incorpora sus commits hasta `ed3990a` como dependencia; no se fusionó ese PR en main. No se tocaron los archivos locales no versionados de `auditorias/`.

La tienda independiente no despliega Functions administrativas. Sus proxies públicos permitidos llegan a las Functions del Deploy Preview de Gestión. Se agrega únicamente `/api/ecommerce/payway` a catálogo, checkout y seguimiento; la clave privada permanece en el backend. Las reglas ya niegan escrituras del navegador sobre orders, payments y ventas web.

Se detectaron pruebas desactualizadas tras el cambio del catálogo para ocultar cantidades físicas y la disponibilidad agregada entre orígenes. Se mantienen las aserciones de disponibilidad y se ajusta el fixture del último producto para tener un único origen disponible. Se corrigió el cambio administrativo de origen: ahora actualiza también `items[].stockAllocations`; antes podía dejar la reserva apuntando al origen anterior.

## SDK y fuentes

- Backend oficial `sdk-node-payway@1.0.8`, fijado en package.json y lockfile. Requiere Node >=18; Netlify utiliza Node 20. Integración CommonJS mediante `createRequire`, empaquetada como dependencia externa con esbuild.
- Dependencias originales: express 4.16.4, node-rest-client 3.1.1 y promise ^8.0.1. Overrides reproducibles: express 4.22.3 y re2js 2.9.1. `npm audit --omit=dev`: cero vulnerabilidades tras la corrección.
- Se desactiva exclusivamente el logger privado del SDK ANTES de cargarlo: el código publicado imprime `apikey` y payloads completos. No se silencia el console de la aplicación. Se añaden manejo de errores y timeouts a su transporte.
- Frontend oficial: `https://ventasonline.payway.com.ar/static/v2.6.4/decidir.js`. PAN y CVV se capturan en campos no controlados, se tokenizan directamente contra sandbox y se vacían; no se envían al backend, analítica ni almacenamiento local. El backend sólo acepta token efímero, BIN, modo, pedido y clave privada de consulta.
- [SDK Node](https://github.com/payway-ar/sdk-node-ventaonline), [SDK JavaScript](https://github.com/payway-ar/sdk-javascript-ventaonline), [referencia Node](https://documentacion-ventasonline.payway.com.ar/docs/sdk-s/8eucdoynmh3ox-alcance), [tabla de parámetros](https://documentacion-ventasonline.payway.com.ar/docs/sdk-s/qpqt8nfx10igh-tablas-de-referencia), [medios de pago](https://documentacion-ventasonline.payway.com.ar/docs/gateway/3jw3eiapx1jwu-medios-de-pago).

La tabla oficial especifica monto mínimo 1 = ARS 0,01: se envían centavos enteros, una sola conversión desde el total autoritativo. Mastercard crédito Payway es el medio **104**; el ID 1 corresponde a Visa aunque algunos ejemplos antiguos del SDK lo comentan incorrectamente como Mastercard. Se admite una cuota. El número comercial 6032049 no se utiliza como Site ID.

Se evaluó el checkout alojado disponible en el SDK, pero requiere plantilla/contrato de enlaces y notificaciones distinto de la tokenización directa. Esta implementación utiliza el mecanismo JavaScript oficial NO PCI documentado por Payway. Que los datos no pasen por el servidor no constituye certificación PCI: antes de producción corresponde validar con el adquirente el SAQ aplicable, integridad y controles de los scripts de la página de pago, antifraude y 3DS para el comercio.

## Arquitectura y seguridad

1. El checkout existente calcula precios, promociones, envío y disponibilidad desde Firestore. Crea un pedido, pago y reservas con referencia estable; no usa totales del cliente.
2. Payway sólo se habilita con `PAYWAY_ENABLED=true`, `PAYWAY_ENVIRONMENT=sandbox`, Firebase cliente/servidor de pruebas, cuenta de servicio de ese proyecto, contexto no productivo y ARCA homologación.
3. Un claim transaccional crea `payments.gateway` antes de llamar al proveedor. La referencia `fm_<hash del pedido>` no cambia. Un segundo clic o recarga no puede ejecutar otro POST de cobro. La reserva se extiende 24 horas mientras se verifica. No se guarda el token.
4. La respuesta autenticada se valida contra operación, Site ID, moneda, importe, medio y cuotas. Sólo se conserva un recibo con campos permitidos; nunca la respuesta completa ni sus tokens/card_data/PAN. La aprobación queda durable antes de registrar la venta.
5. El confirmador existente exige ese recibo para Payway y realiza una única transacción de pedido/pago/CRM/venta/stock/logística/auditoría. No depende de una confirmación del navegador ni de un webhook no autenticado.
6. Timeout, respuesta inválida, ausencia o resultado incierto conservan la referencia y bloquean otro cobro. Conciliación consulta `getAllPayments` por siteOperationId + merchantId y después `paymentInfo`. Sólo una coincidencia válida puede confirmar. Si la venta falla después de una aprobación, queda `recovery_required` y se reintenta la operación comercial sin volver a cobrar.
7. Cambios administrativos y liberación de reserva se bloquean mientras el pago está incierto. Un rechazo/cancelación confirmado no crea venta ni salida. Esta primera versión conserva un único intento de cobro por pedido; un nuevo intento tras rechazo requiere un pedido explícito nuevo, sin borrar el anterior.
8. Sandbox usa `paymentEnvironment:sandbox` y `testData:true` en pedido, pago, venta, stock y logística. Se excluye de ingresos comerciales reales. Se bloquea preparación/autorización fiscal productiva. No se llama ARCA en el checkout Payway.

El botón queda bloqueado durante el intento; sólo se vacía el carrito después de aprobación y venta confirmadas. El pedido y los datos se conservan tras errores o recarga. La clave de consulta viaja en POST, no en URL. La CSP sólo permite el script oficial versionado y los dos orígenes sandbox; no habilita la API productiva.

## Configuración

Variables nuevas, sin valores privados: `PAYWAY_ENABLED`, `PAYWAY_ENVIRONMENT`, `PAYWAY_SANDBOX_SITE_ID`, `PAYWAY_SANDBOX_PUBLIC_KEY`, `PAYWAY_SANDBOX_PRIVATE_KEY`. La clave privada es secreto de Netlify y nunca `VITE_*`. Se importó un CSV descargado fuera del repositorio sin imprimir sus valores secretos. Se validó acceso autenticado de lectura al sandbox (HTTP 200) y se configuraron valores exclusivamente en Deploy Previews del sitio backend. ARCA se fijó en homologación para ese contexto; no se modificó su contexto de producción.

El plan de Netlify no permite scopes específicos; el secreto usa los scopes de secretos admitidos builds/functions/runtime. No se incorpora al bundle Vite y se verifica que no aparezca en archivos versionados ni artifacts públicos. La tienda separada sólo necesita `ECOMMERCE_BACKEND_URL` apuntando a este Deploy Preview y la configuración Firebase web pública completa de pruebas.

Cambiar a producción no consiste en poner una clave productiva: el código falla cerrado. Requiere una actualización revisada con configuración, medios habilitados, adquirente, PCI/antifraude/3DS, conciliación operativa, política fiscal y autorización explícita del propietario. Nunca se promocionan documentos o cuentas de staging.

## Validación

- 1131 pruebas Node aprobadas, incluidas 21 específicas de Payway.
- Builds Gestión y E-commerce aprobados; advertencia existente de tamaño de chunks.
- SDK Node real: consulta autenticada de sandbox aprobada, sin datos ni claves en logs.
- Reglas, Deploy Preview, compra real en Chrome y evidencia transaccional: pendientes de finalizar en esta rama. No hay aprobación Payway declarada todavía.

## Alcances pendientes antes de cobros reales

Esta integración está limitada deliberadamente al sandbox. Una respuesta incierta jamás habilita otro cobro automáticamente. La conciliación de esta versión es bajo consulta del cliente; no hay cron, webhook ni devolución automática. Una reserva extendida también vence: cobros tardíos que ya no puedan aplicar stock deben conservarse como incidencia para resolución supervisada, sin inventar una devolución. No se invocan repartidores, comunicaciones externas ni emisión fiscal productiva durante QA.
