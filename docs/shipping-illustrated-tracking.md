# Seguimiento ilustrado por etapas — Flor Mía

Vigente desde el 20/10/2026 para la rama `codex/modulo-envios-v08` y el Deploy Preview #40. Esta guía reemplaza en la interfaz el seguimiento operativo con GPS descrito en los documentos históricos de v0.8.

## Comportamiento actual

La vista de cliente, el detalle de Gestión y el portal del repartidor muestran una escena vectorial original de Flor Mía: local, caja, calle, moto y domicilio; en los envíos con Repositorio se agrega una parada ilustrada. La escena, el mensaje y la barra se derivan exclusivamente del estado persistido del envío. No interpolan posiciones, no inventan rutas geográficas, ETA ni avance temporal.

Los hitos completados aparecen en verde, la etapa actual en amarillo y las pendientes en gris. La moto se desplaza entre hitos cuando llega una actualización real del estado; las ruedas giran y el vehículo tiene un movimiento leve sólo mientras el envío está en tránsito. Al preparar, la caja se mueve dentro del local; al quedar listo, aparece en la moto; al registrarse en repositorio se muestra allí; al entregar, la moto queda junto al domicilio y la caja aparece en la puerta con una marca de confirmación. Estados cancelados, devueltos, rechazados o no entregados no muestran avance normal ni una moto circulando. Las incidencias mantienen el punto actual y pausan el movimiento.

La escena ilustrada reemplaza el mapa en el seguimiento del cliente, el detalle administrativo y el portal del repartidor. Ninguna de esas vistas pide permiso de ubicación ni envía coordenadas. El mapa Leaflet que queda en Gestión sirve únicamente para revisar y corregir manualmente el pin del domicilio; no representa movimiento ni recibe GPS. El Repositorio es un símbolo visual sin coordenadas ni dirección asumida.

La API pública de seguimiento devuelve sólo el código público, estado, tipo de envío, etiqueta, indicador booleano de incidencia, texto genérico de la ilustración y hora de actualización. No devuelve el motivo interno de la incidencia ni consulta o expone posición, precisión, traza o sesión GPS. Si falla una actualización por conexión, el cliente conserva la última respuesta confirmada e indica que puede estar desactualizada; si el enlace venció o fue revocado, borra el estado almacenado. Al volver la conexión, la consulta actualiza la escena. La preferencia `prefers-reduced-motion` reduce transiciones y animaciones, y la pestaña oculta pausa el movimiento decorativo.

## Hitos conectados a los estados actuales

| Transporte | Estado de envío | Hito actual | Representación |
| --- | --- | --- | --- |
| Directo | `solicitud_pendiente`, `aprobado` | Pedido recibido | Caja en el local; moto detenida. |
| Directo | `en_preparacion` | Preparando | Caja con movimiento suave dentro del local. |
| Directo | `listo_retirar` | Listo para salir | Caja sobre la moto detenida en Flor Mía. |
| Directo | `reparto_final` | En camino | Moto en ruta ilustrativa; el mapa no es geográfico. |
| Directo | `entregado` | Entregado | Moto en el domicilio, caja en la puerta y confirmación. |
| Repositorio | `solicitud_pendiente`, `aprobado`; `en_preparacion`; `listo_retirar` | Pedido recibido; Preparando; Listo para salir | Mismos hitos iniciales del envío directo. |
| Repositorio | `hacia_repositorio` | Hacia el repositorio | Moto en el primer tramo ilustrado. |
| Repositorio | `recibido_repositorio` | En repositorio | Moto detenida y paquete en el depósito simbólico. |
| Repositorio | `reparto_final` | Hacia tu domicilio | Moto en el segundo tramo ilustrado. |
| Repositorio | `entregado` | Entregado | Moto en el domicilio, caja en la puerta y confirmación. |

La lista `deliveryJourney` traduce estados sin cambiar el modelo operativo del envío. La barra usa el índice del hito confirmado dividido por los hitos del recorrido. El 100 % sólo ocurre cuando el servidor registra `entregado`. Una solicitud de vendedor pendiente muestra “Pedido recibido” con el mensaje de revisión, sin fingir preparación o salida.

## Ilustración y licencias

`src/gestion/shipping/AnimatedDeliveryJourney.jsx` y `shipping-journey.css` implementan la escena con SVG/CSS dibujados para este proyecto; no se descargan animaciones ni imágenes de terceros y no se agrega una dependencia Lottie. El proyecto no tenía un recurso Lottie de reparto con licencia comercial verificada. Se reutiliza el archivo de marca existente `/images/flor-mia/logo-flor-mia.svg`; no se modifica el logotipo. Los trazos nuevos son código original del proyecto.

Este enfoque sigue la alternativa indicada en el prompt cuando no hay una animación adecuada con licencia: ilustración vectorial propia con movimiento ligero. La interfaz sigue siendo informativa si el SVG o las animaciones no se reproducen; los mensajes y etapas HTML continúan disponibles. Las animaciones decorativas respetan movimiento reducido y se pausan con la pestaña oculta.

## GPS/Leaflet futuro

Los endpoints `gps_start`, `gps_stop`, `position` y `delivery_exception` responden `410` antes de abrir una transacción; los componentes activos ya no los llaman. Se eliminó el controlador de geolocalización del navegador, la interfaz de captura GPS, las trazas de ubicación y los mapas de seguimiento. Las escrituras de etapa eliminan también posiciones heredadas. Los campos antiguos se limpian sólo por compatibilidad/privacidad y no participan de la vista.

Leaflet queda como selector manual de domicilio y puede reaprovecharse en una etapa futura mediante un componente separado `LiveGpsMap`. Para reactivarlo en otro trabajo habrá que diseñar primero consentimiento, autenticación, retención, validación y contrato API; luego volver a habilitar permisos, lectura autorizada y mapa en forma explícita. Esta entrega no deja un control GPS oculto ni una sección de mapa vacía.

## Verificación

- `npm run test:shipping`: pruebas de mapeo de estados, excepciones, autorización, transacciones e invariantes sin coordenadas públicas.
- `npm run test:shipping:ui`: recorrido de navegador con datos sintéticos; valida QR del repartidor, cliente, ausencia de Leaflet/teselas/GPS, movimiento reducido, desborde móvil y conservación del último estado ante error de conexión.
- `npm run build`: valida el bundle de la aplicación.

La prueba de interfaz no escribe en Firebase. No es una prueba de entrega física ni despliega Production.

Capturas sintéticas de cada hito, la pausa por incidencia y la entrega fallida: [evidencia visual](shipping-evidence/illustrated-tracking/README.md).
