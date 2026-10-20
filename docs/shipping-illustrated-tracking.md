# Seguimiento ilustrado animado — Flor Mía

Vigente desde el 20/10/2026 para la rama `codex/modulo-envios-v08` y el Deploy Preview #40. Esta guía describe el flujo visual que reemplaza el mapa GPS en las vistas de Gestión, repartidor y cliente.

## Experiencia del pedido

La escena se inspira en la referencia visual compartida: el local de Flor Mía, el repartidor en moto y el domicilio, con una parada de repositorio para esos envíos. El paisaje es una ilustración panorámica local y la repartidora se anima con el reproductor oficial dotLottie para React. El panel ubica esa animación en la etapa guardada. La transición entre posiciones ocurre al cambiar un estado confirmado; no simula un trayecto geográfico ni el tiempo restante.

La interfaz separa los hitos guardados de la acción que está ocurriendo. Los hitos confirmados quedan en verde y los próximos en gris. Una tarjeta cálida muestra la fase activa con una barra indeterminada: comunica “preparando”, “esperando” o “en camino” sin inventar un porcentaje de avance. Cuando el estado es `entregado`, la barra desaparece y todos los hitos quedan completos. Una incidencia pausa la escena y elimina la fase activa.

### Envío directo

`Pedido recibido` → **Preparando tu pedido** → `Listo para retirar` → **Esperando al repartidor** → `Repartidor lo retiró` → **Hacia tu domicilio** → `Entregado`.

### Envío por repositorio

`Pedido recibido` → **Preparando tu pedido** → `Listo para retirar` → **Esperando al repartidor** → `Repartidor lo retiró` → **En camino al repositorio** → `Entregado en repositorio` → **Esperando al repartidor** → `Salió del repositorio` → **Hacia tu domicilio** → `Entregado`.

El panel público sigue sin exponer el nombre del cliente ni datos internos. El estado visual proviene de los estados existentes del envío; esta presentación no agrega transiciones ni modifica documentos de Firebase.

## Correspondencia con estados persistidos

| Transporte | Estado de envío | Hitos completados | Fase activa | Escena |
| --- | --- | --- | --- | --- |
| Directo | `solicitud_pendiente` | Pedido recibido | Confirmando tu pedido | Pedido en Flor Mía |
| Ambos | `aprobado`, `en_preparacion` | Pedido recibido | Preparando tu pedido | Preparación en Flor Mía |
| Ambos | `listo_retirar` | Pedido recibido, Listo para retirar | Esperando al repartidor | Retiro en el local |
| Directo | `retirado_origen`, `reparto_final` | Pedido recibido, Listo para retirar, Repartidor lo retiró | Hacia tu domicilio | Repartidor en el trayecto ilustrado |
| Repositorio | `retirado_origen`, `hacia_repositorio` | Primeros tres hitos | En camino al repositorio | Repartidor en el primer tramo ilustrado |
| Repositorio | `recibido_repositorio` | Primeros cuatro hitos | Esperando al repartidor | Paquete en el repositorio simbólico |
| Repositorio | `reparto_final` | Primeros cinco hitos | Hacia tu domicilio | Repartidor en el segundo tramo ilustrado |
| Ambos | `entregado` | Todos los hitos del recorrido | — | Entrega confirmada en el domicilio |

Los estados cancelados, devueltos, rechazados, fallidos o desconocidos muestran una pausa y no avanzan hitos. La ilustración congela la moto en vez de presentarla como si continuara el reparto.

## Implementación y recursos

- `src/gestion/shipping/AnimatedDeliveryJourney.jsx` conecta la escena y la línea de tiempo con el estado actual.
- `src/gestion/shipping/deliveryJourney.mjs` traduce estados existentes a hitos y fases activas.
- `src/gestion/shipping/DeliveryRiderAnimation.jsx` usa `@lottiefiles/dotlottie-react` y carga el recurso local `/animations/flor-mia-delivery-rider.lottie`.
- `src/gestion/shipping/assets/shipping-scene.webp` contiene el paisaje panorámico y `assets/delivery-rider.png` es la ilustración que anima el archivo dotLottie.
- `scripts/build-shipping-lottie.mjs` recompone el recurso local si cambia la ilustración. Se ejecuta con `npm run build:shipping:lottie`.

El jugador y el recurso se sirven desde la propia aplicación; la vista no depende de un CDN de animaciones. La escena no depende del reproductor para comunicar el estado: los títulos, hitos y texto accesible se renderizan como HTML. `prefers-reduced-motion` reduce el movimiento, la pestaña oculta pausa las animaciones y el avance sólo ocurre al recibir un estado nuevo confirmado.

## Ubicación y mapa

La escena no pide permiso de ubicación, no guarda ni envía coordenadas y no muestra un mapa interactivo. El repositorio es un símbolo ilustrativo, sin una dirección o geocerca supuesta. El mapa Leaflet se conserva sólo en Gestión para corregir manualmente el pin de destino. Los endpoints GPS anteriores permanecen deshabilitados con `410`.

## Verificación

- `npm run test:shipping`: mapeo de estados y fases, excepciones, permisos y invariantes de datos.
- `npm run test:shipping:ui`: navegación de escritorio y móvil con registros sintéticos en memoria; valida el recurso dotLottie, los estados directos y por repositorio, movimiento reducido, ausencia de mapa/GPS y errores del navegador.
- `npm run build:shipping:lottie`: genera el `.lottie` local desde el PNG.
- `npm run build:surfaces`: compila Gestión y Ecommerce.

La prueba de interfaz no escribe en Firebase ni completa una entrega real. Las capturas sintéticas están en [evidencia visual](shipping-evidence/illustrated-tracking/README.md).
