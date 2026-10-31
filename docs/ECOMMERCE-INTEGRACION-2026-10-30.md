# Integración del canal web: implementación y verificación

Fecha de trabajo: 30/10/2026, Argentina. Base: `origin/main` `62bd617`. Rama: `codex/ecommerce-integral-main-20261030`.

**Métricas web:** se agregó el resumen de ventas e-commerce dentro del módulo de Métricas, con indicadores, desglose de envío/retiro y filtro para todo el informe. Ver [implementación y pruebas de métricas](ECOMMERCE-METRICAS-2026-10-30.md).

**Continuación del PR #53:** el canal remoto de `app-integral-fm-pruebas` ya está configurado, las reglas se publicaron en staging y se verificaron en Chrome dos checkouts remotos pendientes de pago y sus consultas privadas. Ver [configuración, conciliación y evidencia remota](ECOMMERCE-PR53-STAGING-2026-10-30.md). Por indicación posterior del usuario, ARCA se dejó para una futura instancia en producción; no se ejecutaron pruebas fiscales en esta continuación. Los apartados siguientes conservan la auditoría y la campaña local original.

**Resultado:** circuito comercial y logístico verificado con Google Chrome real y Firebase Emulator. No se considera terminada la habilitación comercial remota: faltan configuración comercial remota y verificación fiscal con credenciales de homologación. El proxy de la tienda separada se publicó y comprobó en un borrador aislado. Payway no se integró. No se modificó producción ni se emitieron comprobantes productivos.

## 1. Auditoría y problemas encontrados

La [auditoría inicial](ECOMMERCE-AUDITORIA-2026-10-30.md) se escribió antes de implementar. Se revisaron catálogo editorial/comercial, carrito, checkout, vendedor, Venta Rápida, CRM, inventario, métricas/finanzas, reglas, configuración Netlify, motor fiscal y Gestión de Envíos. Se consultó el grafo existente y se contrastó con el código, porque estaba desactualizado.

La carpeta inicial estaba en la rama de ARCA del PR #33, 174 commits por detrás de main y con 16 propios. Se creó otra rama desde main actualizado; no se fusionaron PR fiscales ni se reemplazó el trabajo original. GitHub CLI encontró 16 PR abiertos; el conector había devuelto una lista vacía. Los PR #40 y #52 ya habían integrado Envíos y sus correcciones en main.

Problemas principales: envío web bloqueado; ausencia de canal independiente y reservas; venta web sin logística; simulaciones contadas como ventas activas; seguimiento sin acceso privado al pedido; configuración pública con Functions vacías pero peticiones relativas; datos fiscales incompletos en checkout. Se reutilizó el módulo logístico existente, evitando llamar a `createShippingSale` para una venta web ya registrada.

Local Lavalle real se identificó en la aplicación autenticada, sólo lectura: `locations/JkPsCWvIsOxRhtlwuRRj`, una única tarjeta con ese nombre entre 26 ubicaciones. Ese documento y su inventario no se modificaron ni se copiaron a pruebas.

## 2. Arquitectura implementada

| Entidad | Relación y autoridad |
|---|---|
| `channels/ecommerce` | Canal comercial con nombre, activo, origen predeterminado, orígenes autorizados, administradores autorizados, transporte predeterminado, retiro y tarifas. No contiene inventario. |
| `locations` / `warehouses` | Orígenes físicos reales. El administrador selecciona documentos existentes y consulta disponibilidad por producto. |
| `locationStock` / `warehouseStock` | Conservan `currentStock`. El ledger `ecommerceReservations` contiene cantidades y vencimientos por pedido; `reservedQuantity` protege también las escrituras de otros módulos. |
| `orders` | Snapshot de comprador, datos fiscales, productos, precios, envío, canal, origen inicial/actual e historial. Pendiente de pago no es una venta. |
| `payments` | Pendiente desde checkout público. La simulación requiere administrador y entorno aislado; usa `simulated_approved`, nunca un cobro real. |
| `sales` | ID determinista por pedido. Una confirmación genera una sola venta, con `sourceChannel=ecommerce`, `channelId`, origen y referencias a Order/fulfillment. |
| `stockMovements` | Una salida por línea al confirmar. Una reasignación pagada produce entrada compensatoria en origen anterior y salida en el nuevo. |
| `shipments` | Agregado logístico existente, `shippingSchemaVersion=1`, con referencia a la venta existente y stock ya committed. También gestiona retiro con `fulfillmentType=pickup`; no hay una segunda plataforma. |
| `customers` | Clave existente por teléfono normalizado argentino. Pedido y simulación no actualizan `lastPurchaseAt`; el consentimiento de marketing se almacena separado. |
| `invoices` | Motor fiscal existente, una solicitud por venta/entorno. Snapshot de IVA pagado, receptor histórico y servicio de envío con su IVA configurado; el servicio no crea stock ficticio. |
| Métricas / Finanzas | Hechos comerciales compartidos excluyen `simulation`, `simulated_approved` y `simulated=true`, incluso de cancelaciones comerciales. Canal y origen clasifican una única venta. |

Flujo: checkout → Order/Payment pendientes + reserva → confirmación administrativa simulada → Sale + salida + fulfillment en una transacción → preparación y entrega mediante Envíos → plan fiscal recuperable con motor ARCA. Un fallo fiscal conserva la venta válida.

## 3. Canal, origen e inventario

La configuración se administra en `/gestion/ecommerce`. Se valida la existencia y habilitación de cada origen y usuario. El catálogo publica disponibilidad de un origen efectivo; no suma depósitos como si fueran un inventario único.

Las reservas duran 15 minutos. Se evalúa su vencimiento al consultar disponibilidad y confirmar el pago, y se compactan al operar sobre el producto. No requieren TTL de Blaze. Cancelar un pendiente libera su reserva sin modificar existencias ni generar una venta. El panel permite liberar explícitamente una reserva vencida. Las reglas conservan el contador hasta su compactación/liberación: si un módulo cliente encuentra un contador vencido, administración debe liberarlo antes de consumir esas unidades; no se habilita un descuento inseguro.

La reserva puede trasladarse a otro origen autorizado antes del pago. Después del pago sólo se permite cambiar el origen antes de iniciar preparación, sin incidencia ni recorrido activo. Se registran dos movimientos compensatorios y el historial con usuario, fecha y motivo. La venta conserva su origen comercial histórico; el pedido y fulfillment muestran el origen físico actual. No se cambia su importe histórico. Si otro origen tiene precios incompatibles, la aprobación rechaza el cambio comercial silencioso y exige un nuevo checkout.

## 4. Checkout y cliente

Datos de contacto validados con las reglas de teléfono del CRM. Envío con calle, altura, localidad, provincia, CP, piso/departamento opcionales, instrucciones y receptor distinto. La cobertura y el costo provienen de tarifas administradas; no se habilitan precios inventados. Las tarifas con importe requieren IVA configurado.

Retiro obtiene nombre y dirección del punto configurado. El comprador elige Consumidor Final o datos fiscales; el segundo caso valida CUIT, razón social y domicilio. El backend conserva el receptor histórico y determina la clase mediante el motor existente. No se exige CUIT al Consumidor Final cuando el motor permite no identificarlo.

`/mi-pedido` consulta estado con ID y clave privada aleatoria, enviada por POST y almacenada como hash en backend. La respuesta omite teléfono, dirección, preparadores y datos administrativos. El PDF se ofrece solamente cuando la factura vinculada está autorizada y verificada; esa descarga con CAE real queda pendiente de homologación.

## 5. Logística y retiros

El tablero incluye **Pedidos web sin asignar**, sólo para pedidos confirmados y disponibles para asignar. Las tarjetas muestran origen web, pago simulado, estado fiscal, total, productos/destino y preparadores mediante el detalle existente. Los pendientes de pago permanecen separados en E-commerce.

Asignación/reasignación, preparación, incidencias, etiquetas, QR, caducidad, revocación y recorridos reutilizan el backend actual. Se mantienen `repository`, `uber` y `manual`. El transporte se configura por defecto en el canal y puede cambiarse antes del retiro. La autorización logística no crea otra venta ni descuenta nuevamente.

Los retiros pasan por confirmado → preparación → listo para el cliente → retirado, con código y empleado autenticado. El backend rechaza cualquier recorrido o acceso de repartidor para un retiro. La UI no muestra la ilustración del repartidor en ese circuito.

Una entrega fallida revocó el recorrido compartido anterior durante las pruebas. Tras confirmar físicamente el punto de reintento, se creó otro acceso y se completó la entrega sin otra salida de stock. Cancelar/devolver una operación ya vendida no reintegra dinero ni inventario automáticamente; se conserva la política comercial/fiscal del módulo existente.

## 6. Seguridad y recuperación

- Firestore niega escrituras cliente a canal, Orders, Payments, ventas web, Invoices, shipments, recibos idempotentes y rate limits. Los ledgers de reservas sólo los modifica el backend.
- Precios, cantidades, IVA, cobertura, tarifas y stock se resuelven del servidor. Máximo 80 líneas y 99 unidades por producto; importes enteros seguros.
- IDs deterministas, fingerprints, precondiciones, transacciones y recibos evitan duplicar checkout, venta, movimientos, cambios de origen y operaciones logísticas.
- Confirmación simulada comprueba permisos y perfil activo dentro de la transacción, además del endpoint autenticado. Fuera de tests inyectados requiere `app-integral-fm-pruebas` y ARCA homologación; producción no se habilita por el flag.
- Checkout y consulta privada limitan solicitudes por IP/minuto y tamaño del body. Los endpoints públicos no aceptan una aprobación arbitraria de pago.
- Los emuladores requieren flag server exclusivo, contexto local, proyecto de pruebas y hosts loopback. No aceptan usar producción como sustituto. El script local elimina secretos heredados y no autoriza CAE.
- Las simulaciones no pueden prepararse ni autorizarse fiscalmente en producción. Los gates productivos existentes se conservaron.
- El sitio público separado genera proxies para tres contratos públicos. No se copian credenciales ni se publican las Functions administrativas en esa superficie.
- Fechas fiscales y comerciales reutilizan el motor/funciones de Argentina existentes. No se modificó la configuración fiscal productiva.

## 7. Pruebas automatizadas

| Comando realmente ejecutado | Resultado |
|---|---|
| `npm test` | **1.100/1.100** aprobadas. |
| `FIRESTORE_EMULATOR_HOST=127.0.0.1:8186 FM_TEST_FIRESTORE_PORT=8186 npm run test:rules` | **156/156** aprobadas. |
| `npm run build:surfaces` | Gestión y E-commerce compilados. Vite conserva advertencia de tamaño de chunks. |
| `node --test tests/ecommerce-channel-integral.test.mjs` | 18 pruebas nuevas aprobadas, incluidas regresiones de Chrome. |
| Conciliación del snapshot del emulador contra IDs observados en Chrome | 14 pedidos distintos, vínculos 1:1 y saldos exactos; ver JSON de evidencia. |
| `git diff --check` | Sin errores de whitespace. |

Las pruebas nuevas cubren último producto concurrente, replay, reservas, traslado antes/después del pago, rechazo de origen sin stock, vencimiento, cancelación, tres transportes completos, retiro, perfil revocado, configuración idempotente, métricas y receptor fiscal histórico. Se mantienen pruebas existentes de precio alterado, producto inactivo, importes manipulados, pagos incompatibles, conciliación fiscal, PDF/QR y recuperación.

El primer intento de Rules usó por error el puerto fijo 8080 del test de Envíos; se corrigió la invocación con `FM_TEST_FIRESTORE_PORT=8186` y se repitió toda la suite. No se desactivaron reglas ni tests. Se usa Firebase CLI 14.12.0, igual que CI, porque el CLI global exige Java 21 y este equipo tiene Java 17.

## 8. Pruebas reales en Google Chrome

Herramienta: `cua_repl`, navegador Chrome existente, pestañas dedicadas. Frontend React/Vite completo, Auth Emulator y Firestore Emulator reales; sin mocks de ventas, stock, pedidos o logística. Proyecto `app-integral-fm-pruebas`, Auth `127.0.0.1:9186`, Firestore `127.0.0.1:8186`, frontend `http://127.0.0.1:5186`. Datos, direcciones, usuarios, productos y precios exclusivamente sintéticos. No se enviaron mensajes ni se despacharon personas reales.

| Caso | Transporte / entrega | Resultado comprobado |
|---|---|---|
| 01 | Repositorio | Checkout con doble clic: un Order. Origen sin stock rechazado. Pago en Lavalle QA; reasignación pagada a depósito compensada. Preparación, QR individual origen y QR compartido final, entregado. Reintento fiscal sin duplicación. |
| 02 | Repositorio | Pedido pendiente; reserva trasladada a otro local antes del pago; aprobación, asignación, preparación y ambos tramos completados. |
| 03–05 | Repositorio | Tres checkouts distintos; asignación/preparación, QR compartido origen → repositorio → cliente, entregados. |
| 06–08 | Uber | Tres checkouts distintos; transporte cambiado por administración, asignación/preparación y entrega directa confirmada por QR. |
| 09 | Manual | Checkout, preparación y entrega directa completos. |
| 10 | Manual | Entrega fallida sintética, revocación del acceso anterior, reintento desde posición final confirmada y nuevo recorrido. Entregado sin otro movimiento físico. |
| 11 | Retiro presencial | Asignado y preparado. Código incorrecto rechazado; código válido confirmado por empleado. Retirado sin repartidor. |
| 12 | Retiro presencial | Consulta privada del cliente, preparación y código de retiro confirmado por empleado. Retirado. |
| 13 | Manual, regresión adicional | Nuevo checkout, pago/plan fiscal, asignación, preparación, QR individual, retiro y entrega. El cliente consultó `completed` / `Entregado`. |
| 14 | Pendiente cancelado | CUIT inválido rechazado sin pedido. Corregido a CF; Order pendiente creado, luego cancelado con motivo. Reserva liberada; sin Sale, shipment ni Invoice. |

Campaña principal: **10 envíos (5 Repositorio, 3 Uber, 2 Manual) + 2 retiros**. Adicionales: **1 envío Manual de regresión + 1 pendiente cancelado**. Total: **14 pedidos; 13 operaciones completas**.

También se observaron errores de nombre/email/teléfono obligatorios, dirección incompleta, clave privada incorrecta, falta inicial de preparador, cambios de origen y reintento tras reiniciar el backend durante diagnóstico. Se guardó y consultó la configuración del canal. El enlace a métricas abrió el filtro E-commerce con ingresos reales en cero. Las restantes variantes automatizadas no se presentan como pruebas manuales.

Evidencia: [IDs observados en Chrome](ecommerce-evidence-2026-10-30/chrome-orders.json), [conciliación verificable](ecommerce-evidence-2026-10-30/verification.json) y capturas en `docs/ecommerce-evidence-2026-10-30/`. Las capturas corresponden sólo a datos sintéticos. Los accesos QR son locales, temporales y revocables.

## 9. Conciliación final

| Origen sintético | Inicial | Suma de movimientos | Final | Reservado |
|---|---:|---:|---:|---:|
| Lavalle QA | 100 | -11 | 89 | 0 |
| Otro local QA | 100 | -1 | 99 | 0 |
| Depósito QA | 100 | -1 | 99 | 0 |
| Total | 300 | -13 | 287 | 0 |

13 Sales, 13 fulfillments entregados, 13 solicitudes fiscales pendientes y 15 movimientos: 13 salidas + 2 compensaciones de reasignación. Cada compra completa tiene exactamente una venta, una tarea y una solicitud fiscal. El pedido cancelado no tiene ninguna. Importe comercial **simulado** acumulado: ARS 18.500; ingresos reales registrados: **ARS 0**.

El snapshot se conservó bajo `.netlify/ecommerce-emulator-data`, excluido de Git. El exportador tuvo un error de rename en Windows/OneDrive; se preservó la exportación completa mediante un movimiento nativo con rutas verificadas. No se borraron registros.

## 10. Fiscal: lo verificado y lo pendiente

Se reutiliza WSAA/WSFEv1, persistencia, locks, conciliación, PDF y QR del repositorio. Se verificaron **13 planes/solicitudes locales marcados homologación**, CF y total con IVA del envío. Los tests verifican datos fiscales válidos con adaptador de Padrón inyectado, CUIT inválido, receptor histórico, clases, factura repetida, errores y reintentos; no equivalen a una comunicación oficial.

**Solicitudes reales de CAE a homologación: 0. CAE reales de homologación obtenidos/verificados: 0. Facturas productivas emitidas: 0.** El entorno aislado disponible no tiene certificado/clave ni configuración completa de emisor de homologación; el laboratorio utiliza datos sintéticos sólo para preparar planes y bloquea autorización. No se utilizó el certificado productivo como sustituto. PDF fiscal y QR fiscal de un CAE real quedan pendientes; el QR logístico sí se probó en Chrome.

No se identificaron operaciones comerciales reales verificables por hasta ARS 100 que cumplieran la autorización productiva. No se fabricaron, dividieron ni alteraron precios para emitir. Los comprobantes productivos preexistentes visibles en la app no se atribuyen a esta auditoría.

La documentación oficial consultada confirma identificación general de CF desde ARS 10.000.000 y reglas del receptor: https://www.arca.gob.ar/fe/emision-autorizacion/datos-comprobantes.asp. La selección de CF no omite la obligación de emitir el comprobante correspondiente.

## 11. Errores reproducidos y corregidos

| Error | Corrección y repetición |
|---|---|
| Confirmación detenida al listar usuarios dentro de la transacción REST | `adminListDocuments` usa `runQuery` transaccional acotado; conserva el read set y añade timeout. Se repitió el mismo pedido y después 12 confirmaciones adicionales; una sola venta por pedido. |
| Sincronización fiscal leía Order/Shipment después de escribir Sale | Reúne todas las lecturas y ejecuta un único commit. Test específico prohíbe leer después de escribir; reintento real en Chrome conservó venta/stock/factura. |
| UI mantenía un pedido seleccionado con estado previo después de un error parcial | Refresca la selección con el Order persistido. |
| Retiro mostraba ilustración/espera de repartidor | Vista y textos específicos de retiro; no ofrece acceso de repartidor. Verificado con ambos retiros. |
| Consulta con clave inválida conservaba visualmente un resultado previo | Limpia el resultado al consultar otra clave; el backend siempre rechazó la clave incorrecta. |
| Simulaciones contaminaban compras/ingresos/cancelaciones de métricas | Separación en hechos comerciales compartidos y CRM; panel general y canal en cero real. |
| IVA del costo de envío no estaba representado fiscalmente | Línea de servicio fiscal, con IVA configurado y sin inventario. Total comercial/fiscal consistente en los tests y planes guardados. |
| El parser de Netlify rechazaba proxies con origen `/.netlify/*` y devolvía HTML | Rutas públicas `/api/ecommerce/catalog`, `/api/ecommerce/checkout` y `/api/ecommerce/order-status`; la app unificada conserva sus Functions. Se verificaron cuatro reglas sin errores, JSON remoto y catálogo en Chrome. |
| Dos entradas de CUIT y posible sustitución de receptor del canal | Una sección fiscal; el motor toma el snapshot del pedido, valida datos completos y conserva nombre/domicilio. |

Los fallos de tests durante implementación se corrigieron: mock antiguo de paginación transaccional actualizado al contrato `runQuery`, actor de prueba sin UID y fixture compartida mutable. No se debilitaron aserciones comerciales ni de permisos.

## 12. Archivos y motivos

| Archivos | Motivo |
|---|---|
| `netlify/functions/_lib/ecommerce/channelService.mjs`, `orderManagement.mjs` | Canal, cobertura, datos fiscales, configuración, disponibilidad, cambios de origen, cancelación y recibos. |
| `commerceService.mjs`, `commerceDomain.mjs`, `customerLink.mjs` | Checkout/catálogo autoritativos, reservas, normalización y CRM separado de compra real. Se retiró la rama inalcanzable de venta desde checkout público. |
| `paymentService.mjs`, `paymentContract.mjs`, `fiscalService.mjs`, `publicError.mjs` | Confirmación aislada y transaccional, fulfillment, fiscalidad histórica y errores públicos seguros. |
| `publicRequests.mjs`, `ecommerce-admin.mjs`, `ecommerce-order-status.mjs`, `ecommerce-checkout.mjs`, `ecommerce-catalog.mjs`, `ecommerce-simulated-payment.mjs` | Contratos públicos/administrativos, límites y consulta/PDF privados; metadato público de proyecto para verificar destino. |
| `netlify/functions/_lib/shipping.mjs`, `shippingFeed.mjs` | Adaptador a venta existente, transporte/retiro, sincronización de Order y transporte local de pruebas. |
| `firebaseEmulator.mjs`, `firebaseAuth.mjs`, `firestoreAdminRest.mjs` | Emuladores restringidos y consultas/commits seguros con timeout. |
| `netlify/functions/_lib/arca/invoicePersistence.mjs`, `authorizer.mjs` | Servicio de envío en snapshot fiscal, sincronización atómica y rechazo de simulaciones productivas. |
| `src/shared/stockReservations.mjs`, `operationalWritePlans.mjs`, `shippingDomain.mjs` | Disponibilidad y protección compartida de reservas, planes operativos y retiro. |
| `src/gestion/pages/EcommercePage.jsx`, `services/ecommerceAdminService.js`, `ManagementApp.jsx`, `routePreload.js` | Administración propia del canal y actualizaciones en tiempo real. |
| `ShippingPage.jsx`, `ShipmentDetail.jsx`, `ShippingPublicApp.jsx`, `services/shippingService.js` | Grupo web, asignación/preparación, transporte y retiro en UI existente. |
| `src/pages/CheckoutPage.jsx`, `OrderStatusPage.jsx`, `CatalogPage.jsx`, `Storefront.jsx`, `src/services/ecommerceService.js`, `ecommercePublicEndpoint.js` | Checkout completo, consulta privada y textos para compradores. |
| `saleFacts.js`, `metrics.js`, `SalesMetricsPage.jsx`, `services/sellerService.js` | Exclusión de simulaciones, filtro por canal y protección de reservas al editar ventas. |
| `firestore.rules` | Restricciones de reservas, canal y operaciones backend. |
| `deploy/ecommerce/prepare-preview.mjs`, `.env.example`, `docs/DEPLOYMENT-SURFACES.md` | Proxy limitado y configuración honesta de superficies. |
| `firebase.ecommerce-qa.json`, `scripts/qa-ecommerce-local.mjs`, `package.json` | Laboratorio reproducible, puertos independientes y comandos. |
| `tests/ecommerce-channel-integral.test.mjs`, `firestore.ecommerce-channel.rules.mjs`, `olivia-store.test.mjs` | Nuevos casos y contrato transaccional actualizado sin desactivar verificaciones. |
| Auditoría, este informe y carpeta de evidencia | Diagnóstico previo, arquitectura, pruebas y pendientes verificables. |

## 13. Reproducir el laboratorio

No requiere secretos productivos. En dos terminales del proyecto:

```powershell
npx --yes firebase-tools@14.12.0 emulators:start --only 'firestore,auth' --project app-integral-fm-pruebas --config firebase.ecommerce-qa.json --import .netlify/ecommerce-emulator-data
npm run dev:ecommerce:qa
```

Si no se dispone del snapshot, omitir `--import`: el script crea sólo datos sintéticos mínimos, sin copiar producción. Usuario local: `qa-admin@example.invalid`, contraseña sintética local `PruebaLocal123!`; no es una cuenta remota. UI de emuladores: `http://127.0.0.1:4186`. El script no limpia ni repone silenciosamente las existencias de una base ya sembrada.

## 14. Pendientes antes de desplegar

1. Revisar el PR y preview. No fusionar a main sin aprobación explícita de esta actualización, según AGENTS.md.
2. Configurar y verificar frontend, Functions, Auth, Firestore y cuenta de servicio del preview remoto contra `app-integral-fm-pruebas` antes de cualquier escritura allí. Los secretos de Netlify están enmascarados; las pruebas de esta entrega son locales.
3. Configurar `channels/ecommerce` con los documentos físicos del entorno correspondiente. En producción, validar Lavalle y su dirección real; las ubicaciones QA no se promocionan.
4. Cargar cobertura, tarifas, IVA del envío, punto de retiro, transporte y usuarios comerciales reales. Nada de la configuración sintética se copia a producción.
5. Conservar la conexión verificada en el borrador separado; antes de publicar comercialmente configurar `ECOMMERCE_BACKEND_URL` en el contexto correspondiente y repetir checkout/consulta con escrituras sólo después de verificar el aislamiento completo. La URL publicada preexistente no se modificó.
6. Publicar reglas revisadas en staging y comprobarlas remotamente. No se desplegaron reglas productivas en esta auditoría.
7. Aportar credenciales y datos reales de emisor exclusivamente de homologación, ejecutar WSAA/WSFE, autorizar/consultar CAE y verificar PDF/QR fiscal, errores de red y conciliación contra el servicio oficial.
8. Sólo considerar emisiones productivas si existen operaciones reales y se verifican todas las condiciones del permiso; no hay ninguna pendiente de emisión automática en esta entrega.
9. Payway queda para la etapa posterior: no hay checkout, tokenización, webhook, captura ni reembolso productivo incorporados.

## 15. Criterio de aceptación

Canal, pedidos, CRM, venta única, reservas, orígenes, métricas sin simulaciones, logística compartida, tres transportes, QR y retiro: **implementados y comprobados localmente**. Campaña Chrome 10+2, regresión y cancelación: **ejecutadas**. Comunicación de la tienda separada con backend de pruebas: **publicada como borrador y verificada por HTTP y Chrome**. Habilitación comercial remota y homologación oficial con CAE/PDF/QR: **pendientes por configuración y credenciales verificadas**. Por esos pendientes, no se declara la integración comercial/fiscal remota completamente terminada.


## Entrega para revisión: PR y previews

- PR en borrador: https://github.com/AgustinBazanUB/App-Integral-FM/pull/53. Primer commit de implementación: `8f1e2d8`.
- Gestión y backend: https://deploy-preview-53--appintegralflormia.netlify.app/gestion/ecommerce. API de catálogo identifica `app-integral-fm-pruebas`; la UI privada solicita autenticación.
- Tienda separada, borrador sin publicación productiva: https://6ae53c75ad2c6548bf636cfc--flor-mia-ecommerce-preview.netlify.app/productos. No incluye Functions ni edge functions; Netlify procesa cuatro reglas de routing. Sólo se proxifican los tres contratos públicos.
- Evidencia HTTP de lectura: `ecommerce-evidence-2026-10-30/preview-http.json`. Catálogo GET: JSON 200, proyecto de pruebas, `ready:false`; checkout y consulta GET: JSON 405. `/.netlify/functions/arca-authorize` en la tienda devuelve el HTML de la SPA, no ejecuta el autorizador. No se enviaron solicitudes fiscales.
- Chrome remoto muestra un artículo sintético preexistente del staging y el aviso «La ubicación de stock Ecommerce está PENDIENTE DE DEFINIR», con compra deshabilitada. No se copió ni modificó ese artículo. Captura `10-preview-publico.jpg`.
- La primera publicación estática detectó el rechazo de rutas reservadas `/.netlify/*`; se corrigió el código y se repitió la publicación y comprobación. El parser oficial instalado valida cuatro reglas sin errores. Referencia: https://docs.netlify.com/manage/routing/redirects/overview/.
- GitHub CI de implementación aprobó `test-build` y `arca-test-build`; Netlify aprobó el Deploy Preview. Tras la corrección del proxy, se repitieron las 1100 pruebas y el build público con configuración de pruebas.

No se fusionó a main, no se publicaron reglas productivas y no se movieron registros de los emuladores a Firebase remoto. El snapshot de la campaña Chrome permanece local y la evidencia sanitizada queda en el PR.
