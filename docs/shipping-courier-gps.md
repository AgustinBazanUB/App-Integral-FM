# Panel del repartidor y prueba manual de GPS

Preview: https://deploy-preview-40--appintegralflormia.netlify.app/gestion/shipping

El QR de una etiqueta abre **¿Cómo querés continuar?**, con acceso interno y de repartidor. Al elegir **Soy repartidor**, el servidor activa una autorización temporal para el próximo tramo elegible de ese envío y abre el panel sin pedir código. La etiqueta debe estar disponible físicamente; el permiso queda limitado a un envío y vence a las cuatro horas por defecto (configurable entre 1 y 24). Los QR temporales de recorrido que Gestión genera para varios pedidos siguen entrando directamente con su propia sesión. El botón **Soy personal de Flor Mía · Preparar pedido** conserva el acceso interno con sesión y asignación.

## Preparar el acceso desde Gestión

1. Para una etiqueta de un solo envío, basta con imprimir el QR desde Gestión y escanearlo. El backend habilita únicamente la acción siguiente que corresponda al estado; no se puede saltar la preparación, recepción en repositorio ni un bloqueo por incidencia.
2. Para autorizar un recorrido con varios pedidos, abrí Gestión, elegí **Accesos limitados** y generá el acceso temporal para Manual/Uber o el tramo de Repositorio correspondiente.
3. Mostrá el QR de **Abrir en el teléfono del repartidor**. Al escanearlo se abre el panel autorizado, sin copiar códigos. También podés usar **Copiar enlace** y abrirlo manualmente en el teléfono. No se envían mensajes automáticamente.

El QR temporal de Gestión y la etiqueta tienen propósitos distintos. El QR permanente sólo activa una sesión temporal y acotada cuando alguien lo presenta; no da acceso a Firebase ni permite administrar inventario, dirección o asignaciones. Una sesión activa impide activar otra para ese envío. La sesión vence automáticamente y Gestión puede revocarla. Para el personal sigue siendo obligatorio iniciar sesión; si falta una cuenta, Administración la crea y asigna el envío.

## Acciones del repartidor

| Tramo | Acciones que aparecen en orden |
| --- | --- |
| Directo al cliente | **Confirmar que recibí el paquete** → **Confirmar entrega al cliente** |
| Origen → Repositorio | **Confirmar que recibí el paquete** → **Confirmar que lo dejé en el repositorio** |
| Repositorio → Cliente | **Salir del repositorio hacia el cliente** → **Confirmar entrega al cliente** |

Cada repartidor ve únicamente el tramo autorizado. Al dejar el paquete en el repositorio se informa que ese tramo terminó. El acceso de reparto final permite salir sólo después de la recepción en repositorio. No se exige dirección del repositorio. El primer tramo no muestra teléfono del cliente ni publica ubicación al cliente.

## Comprobar GPS real desde el teléfono

1. Abrí el enlace autorizado en Chrome o Safari del teléfono, con ubicación del equipo activa y conexión a Internet.
2. Confirmá la recepción del paquete (directo) o la salida del repositorio (tramo final).
3. En **Mi ubicación**, pulsá **Compartir mi ubicación** y aceptá el permiso del navegador.
4. Comprobá la secuencia **Esperando ubicación** → **Enviando ubicación** → **Ubicación compartida**. El estado verde aparece solamente después de una posición real confirmada por el servidor. Muestra hora del envío y precisión.
5. Desde otro dispositivo, abrí el enlace de cliente creado en Gestión. Durante el reparto final debe mostrar hora, precisión y **Ver ubicación real en Google Maps**. La ficha administrativa también muestra la última posición. La actualización de ambas vistas puede tardar hasta 20 segundos.
6. Caminá unos metros manteniendo la página abierta y la pantalla encendida. Comprobá un nuevo envío confirmado. El panel solicita mediciones reales aproximadamente cada 15 segundos aunque el teléfono permanezca quieto; no inventa coordenadas ni marcas de tiempo.
7. Pulsá **Dejar de compartir ubicación**. El GPS local se detiene y el servidor elimina la última posición. Al actualizar el seguimiento debe mostrar ubicación no disponible. Podés volver a compartir manualmente.
8. Confirmá la entrega. El pedido queda entregado y cesa la publicación. Solicitudes que hayan quedado pendientes de una sesión detenida no pueden volver a publicar la posición.

La entrega normal exige destino verificado y geocerca configurada. En el preview esos parámetros siguen pendientes: para cerrar una prueba, Administración debe usar **Autorizar excepción de entrega** con motivo, después de iniciar el reparto final. Esa excepción no es necesaria para probar que se comparte GPS. No cambies el domicilio real para simular una geocerca.

Si aparece permiso denegado, habilitá Ubicación para el sitio desde los ajustes del navegador. Si hay tiempo agotado o ubicación no disponible, revisá la ubicación del equipo y probá al aire libre. Ante un fallo de red el panel informa que el envío no está confirmado y reintenta mientras permanece abierto. La ayuda está incluida en **Ayuda con la ubicación**.

El GPS del navegador requiere HTTPS y permiso del usuario; la API permite detener la observación, pero no garantiza seguimiento con la página cerrada o en segundo plano. Referencia técnica: [Geolocation.watchPosition — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition).

## Verificación de esta ampliación

- Pruebas del motor: inicio únicamente durante reparto final, vínculo etiqueta/autorización, posición confirmada, parada que borra la ubicación, rechazo de puntos tardíos, aislamiento entre sesiones y cierre al entregar.
- Pruebas del controlador: permiso denegado, falta de navegador compatible/HTTPS, fallo de red, ausencia de confirmación del servidor, medición periódica con equipo quieto, descarte de respuestas tardías y revocación.
- Prueba manual local de interfaz con el motor real y almacenamiento en memoria: recepción → repositorio → salida final → compartir → visualización por cliente → detener. Coordenadas **sintéticas**, con aviso visible de laboratorio. Se generó y decodificó el QR temporal; abre el pedido y tramo correctos. Vista móvil comprobada sin desborde horizontal.
- Prueba manual en Deploy Preview 40 + Firebase staging (20/10/2026): un envío ficticio completó QR de origen y QR final, confirmó salida al cliente, compartió una ubicación real de este equipo y la mostró en los mapas administrativo y del cliente. Se detuvo el GPS y se comprobó que ambos dejaron de exponer el punto. Una excepción QA supervisada permitió completar el pedido ficticio y el recorrido se cerró automáticamente. El pedido quedó marcado como **Entregado** sólo en Firebase staging; no hubo entrega física ni cambios en Production.
- Esta ampliación no creó nuevas ventas ni descontó inventario en el Firebase original. Los dos registros anteriores siguen documentados en [el informe de pruebas](shipping-manual-preview-40.md).
- La captura de GPS desde un teléfono físico sigue pendiente de la prueba del usuario. El indicador verde del laboratorio no acredita una medición física.

Evidencia local en `tmp/shipping-manual-preview-40/`: capturas 14–16 y logs `gps-*`. Las coordenadas y el QR de laboratorio son ficticios.

## Recorrido GPS compartido (20/10/2026)

La versión ampliada permite crear desde el **Tablero** un **Recorrido del repartidor**. Filtrá y marcá uno o varios envíos listos, elegí el tramo, y pulsá **Crear QR de N envío(s)**. El repartidor escanea el QR temporal, ve las órdenes autorizadas y comparte una sola ubicación para el recorrido. En un envío por Repositorio, primero se autoriza el tramo de origen si corresponde; el GPS sólo se habilita para el tramo al cliente.

Al entregar un pedido, el recorrido conserva GPS para los pedidos restantes. Cuando se entrega el último, el servidor completa la sesión y borra la posición y la traza. En Repositorio, confirmar el ingreso quita ese pedido del tramo de origen y permite crear un QR independiente para el tramo al cliente; los pedidos que todavía viajan al repositorio siguen autorizados en el QR original. En el detalle de Gestión aparece la posición de la sesión y el enlace del cliente sólo presenta el punto de su propio envío mientras esté en reparto final. Para verificar la sesión y los casos que requieren un teléfono físico, consultar [arquitectura y validación GPS](shipping-live-tracking.md).

La validación física previa confirmó que este equipo pudo compartir una posición real con Firebase staging. Todavía falta completar en Android Chrome los períodos de cinco minutos en primer plano, segundo plano, otra aplicación, pantalla bloqueada y recuperación. El navegador no garantiza actualización continua con la pantalla bloqueada o Chrome en segundo plano.
