# Seguimiento GPS compartido — revisión del 20/10/2026

## Alcance y entorno

El cambio extiende el módulo existente de envíos. El Deploy Preview de la rama `codex/modulo-envios-v08` usa el proyecto Firebase staging `app-integral-fm-pruebas`; la credencial de servicio permanece como secreto de Netlify para Deploy Previews. No se modifican Production, reglas remotas, planes de Firebase ni infraestructura de Realtime Database. La preview se actualiza al publicar esta rama en el PR #40.

Se reutilizan `shipments`, los estados logísticos, autenticación/permisos Firebase, funciones Netlify y validaciones de servidor. Las posiciones se sincronizan en Cloud Firestore porque el proyecto ya usa Firestore y no tiene RTDB configurada. La sesión de reparto vive en `deliverySessions/{sessionId}` y conserva una sola posición y una traza acotada para todos los pedidos de esa ruta. Cada seguimiento de cliente recibe exclusivamente la proyección permitida de su propio envío.

## Recorrido y mapa

1. Una persona con permiso de edición en Gestión selecciona pedidos compatibles y el tramo **Entrega directa · cliente**, **Repositorio · origen a repositorio** o **Repositorio · repositorio a cliente**. Puede vincular de 1 a 25 pedidos en una sesión temporal.
2. **Crear QR de N envío(s)** emite una URL HTTPS con un token aleatorio en el fragmento. Firestore guarda su hash, tramo, envíos, vencimiento y estado. La ruta expira en cuatro horas por omisión (configurable entre 1 y 24), cada pedido queda asociado en una transacción y las asignaciones previas activas se rechazan.
3. El repartidor abre una sola vez el QR y ve únicamente los pedidos incluidos. En el tramo final puede pulsar **Compartir mi ubicación** y autorizar Geolocation; no se pide permiso ni se activa el GPS en preparación o camino al repositorio.
4. El servidor valida coordenadas, hora, precisión, autorización y saltos; confirma cada punto antes de mostrar “Ubicación compartida”. El objetivo de captura es 15 segundos, sujeto a la frecuencia que permita el navegador. Al completar un pedido el punto sigue disponible para los pedidos activos; al entregar el último se completa la sesión y se borra la posición y la traza.
5. El equipo administrativo escucha la sesión directamente cuando sus reglas lo permiten. Si la regla de Firestore todavía no está instalada en staging, una función autenticada ofrece una lectura de respaldo cada 15 segundos sólo a usuarios con `shipping.view`; la respuesta excluye hash de acceso y credenciales de sesión. Si el listener y el respaldo fallan, se informa el error y no se simula una posición.
6. El seguimiento del cliente consulta cada 15 segundos mientras la pestaña está visible y al recuperar foco. Cada enlace de cliente queda limitado al envío, sólo lectura y revocable. No expone historial privado, teléfono, nombre del repartidor ni otros pedidos. No hay ETA sin un proveedor confiable de rutas.

Los accesos existentes por pedido siguen funcionando. El QR permanente de la etiqueta no contiene el token del repartidor ni datos personales: Gestión crea un QR temporal distinto para autorizar la ruta. Corregir dirección, reasignar, cancelar, cerrar o revocar accesos invalida la sesión y limpia la ubicación activa. La fecha de expiración se vuelve a verificar en cada operación.

### Mapas

`ShippingMap.jsx` usa Leaflet **1.9.4**, la versión estable publicada en la revisión; la 2.0 disponible figura como prerelease alpha. La dependencia es exacta (`leaflet@1.9.4`). El mapa aparece en el detalle administrativo, el panel del repartidor, el seguimiento privado del cliente y el selector manual para verificar el pin de domicilio. Muestra una moto, destinos verificados, traza recibida, hora y precisión, control para centrar, estado de señal y atribución visible. El pin de CABA es un centro de referencia; no representa la ubicación de nadie. Coordenadas viejas de más de dos minutos desaparecen como posición actual. El movimiento visual suave sólo interpola entre dos puntos confirmados.

El preview usa la capa raster pública `tile.openstreetmap.org`; `VITE_SHIPPING_TILE_URL` permite cambiar de proveedor en el build. Los enlaces de seguimiento envían a OSM sólo el origen del sitio como `Referer`, nunca el fragmento que contiene el token. El mapa incluye atribución a OpenStreetMap y enlace para informar problemas. No hace geocodificación: una persona verifica manualmente el pin.

La capa estándar de OSM está sujeta a política de capacidad y disponibilidad best-effort, sin SLA. No se descargan teselas en bloque ni se hacen precargas. Antes de operación comercial, medir el uso y seleccionar un proveedor con condiciones y capacidad apropiadas; cambiar `VITE_SHIPPING_TILE_URL` y permitir su origen en la CSP. Referencia: [política oficial de teselas de OSM](https://operations.osmfoundation.org/policies/tiles/) y [descargas oficiales de Leaflet](https://leafletjs.com/download.html).

## Privacidad y límites de GPS web

- HTTPS y permiso explícito del usuario son obligatorios. El repartidor ve cuándo transmite, la hora/precisión confirmadas y un control para detenerlo.
- `watchPosition` usa alta precisión y `maximumAge: 0`; un sondeo cada 15 segundos solicita una medición real nueva cuando el teléfono permanece quieto. Si no hay conexión, la pantalla no confirma envío y reintenta sólo mientras siga activa.
- `visibilitychange`, `online`/`offline`, `pagehide`, expiración y revocación se manejan explícitamente. La observación local se cierra con `clearWatch`. Al recuperar el foco se pide una posición nueva.
- Una página web no garantiza GPS continuo en segundo plano, con otra aplicación abierta, la pantalla bloqueada o el navegador cerrado. El sistema muestra antigüedad/falta de señal y no usa Service Workers para fingir que el GPS sigue activo.
- La última posición se valida en servidor y caduca por omisión a los 120 segundos. La respuesta pública sólo la muestra durante un reparto final activo y fresca. La traza en memoria/documento se acota a 120 puntos y se limpia al detener, entregar la última orden, revocar o vencer.
- La entrega no se deduce de estar cerca. Si no hay geocerca verificada, administración puede autorizar una excepción auditada para el token y la revisión vigentes; se conserva la confirmación humana como decisión real.

## Costos y límites

El Firebase staging se observó en el plan Spark. Cloud Firestore Standard incluye actualmente por proyecto una cuota diaria sin costo de 50.000 lecturas, 20.000 escrituras y 20.000 borrados, 1 GiB almacenado y 10 GiB/mes de salida. Las cuotas se restablecen diariamente; una base adicional no califica por sí misma para la cuota gratuita. Ver [precios oficiales de Firestore](https://firebase.google.com/docs/firestore/pricing).

Con una posición confirmada cada 15 segundos, una ruta activa genera aproximadamente **240 escrituras GPS por hora** (una actualización al documento compartido). Eso equivale a 3.840 escrituras por día para dos repartidores durante ocho horas, antes de cualquier otra operación. El repartidor y cada cliente mantienen consultas públicas cada 20 y 15 segundos respectivamente; el limitador público también actualiza un documento por solicitud. Como referencia de carga, un cliente con la pestaña abierta todo el día suma hasta 17.280 solicitudes diarias y escrituras del limitador, más lecturas de su token/envío/ruta. Con 10 rutas de ocho horas se alcanzarían unas 19.200 escrituras GPS diarias, sin contar limitadores ni operaciones del resto de la app. Por eso esta tasa es una meta, no una garantía ni un presupuesto de capacidad: medir Usage en staging con la cantidad real de repartidores, sesiones y clientes antes de producción y revisar cuota diaria y transferencia.

La función de GPS escribe un punto por envío cuando opera un QR individual, o un punto por ruta compartida cuando el repartidor lleva varios pedidos. No se copia la misma posición en cada pedido. El costo exacto también depende de transacciones, reintentos, listeners que se reconecten, índices y demás módulos que usan el proyecto. Las cuotas gratuitas no incluyen el borrado TTL administrado; esta implementación no requiere habilitar TTL para borrar posiciones activas. No cambiar a Blaze ni activar un servicio pago sin autorización.

## Validación ejecutada y pendiente

- `npm run test:shipping`: **36 pruebas correctas**, incluidas autenticación, revocación, sesión compartida de dos pedidos, continuidad después de entregar el primero, cierre después del último, limpieza y posición anómala.
- `npm test`: **994 pruebas correctas** después del ajuste de respaldo de lectura.
- `npm run build:surfaces`: gestión y ecommerce compilan. Vite informa advertencias existentes de chunks JavaScript mayores a 500 KB.
- `npm run test:shipping:ui`: **8 verificaciones en Chrome headless** con datos/posiciones sintéticas, incluidas mapa cliente Leaflet y privacidad de `Referer`. No constituye una prueba de GPS físico. Requiere los módulos Playwright del runtime de Codex indicados en el documento de continuidad.
- `npm run test:rules`: **no se pudo verificar en esta máquina** porque falta iniciar Firestore Emulator (`FIRESTORE_EMULATOR_HOST` no configurado). Los 139 casos terminaron antes de evaluar reglas. Las pruebas locales de dominio y autorización sí pasan; la regla `deliverySessions` está cubierta en `tests/firestore.shipping.rules.mjs` para cuando se ejecute con emulador.
- Ya se probó autorización/una posición real del equipo en Firebase staging durante la sesión manual anterior. Para esta ampliación aún se necesita un Android con Chrome (y, si se pretende admitirlos, Safari/iOS) para completar durante cinco minutos: página abierta, Chrome en segundo plano, otra aplicación como Maps/WhatsApp, pantalla bloqueada y recuperación. No se declara seguimiento continuo en esas situaciones hasta verificar qué permite el equipo.
- También queda pendiente comprobar con la nueva preview la ruta de dos pedidos con un teléfono físico y observar cuota/latencia en Firebase staging. No usar la preview para ventas reales: el panel de pruebas debe identificar sus registros y conciliar o eliminar por los procedimientos del proyecto.

## Revisión local

La suite de reglas agrega un caso que permite leer `/deliverySessions/{id}` sólo a una sesión autenticada con `shipping.view` y niega escritura, listado y lectura pública. La función de respaldo aplica el mismo permiso en servidor y devuelve una vista sin campos de autorización. El token aleatorio sólo existe en la URL temporal en el dispositivo del repartidor y no se registra ni se transmite como `Referer`; Firestore guarda su hash.

Para comandos y pasos manuales anteriores del módulo, consultar [guía del panel del repartidor](shipping-courier-gps.md), [auditoría v0.8](shipping-v08.md) y [prueba del Deploy Preview 40](shipping-manual-preview-40.md).
