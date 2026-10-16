# Panel del repartidor y prueba manual de GPS

Preview: https://deploy-preview-40--appintegralflormia.netlify.app/gestion/shipping

El QR de una etiqueta abre directamente **Panel del repartidor** para ese pedido. El botón **Soy personal de Flor Mía · Preparar pedido** conserva el acceso interno con sesión y asignación. La etiqueta identifica el pedido; para operar se utiliza el código o enlace temporal que entrega Gestión. El backend comprueba que esa autorización corresponda a la misma etiqueta.

## Preparar el acceso desde Gestión

1. Abrí un envío aprobado y listo para retirar.
2. En **Accesos limitados**, elegí **Autorizar repartidor** para Manual/Uber. Para Repositorio elegí **Acceso · origen a repositorio** o **Acceso · reparto final**, según el tramo.
3. Mostrá el QR de **Abrir en el teléfono del repartidor**. Al escanearlo se abre el panel autorizado, sin copiar códigos. También podés usar **Copiar enlace** y abrirlo manualmente en el teléfono. No se envían mensajes automáticamente.
4. Si escaneaste directamente la etiqueta impresa, ingresá el enlace o código temporal en **Autorizar este reparto**. Un código de otro pedido se rechaza.

El QR temporal de Gestión y la etiqueta tienen propósitos distintos. La autorización temporal no se imprime en la etiqueta permanente. Un nuevo acceso del mismo tramo revoca el anterior; se muestra su vencimiento. El navegador no guarda el código en almacenamiento persistente.

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
6. Caminá unos metros manteniendo la página abierta y la pantalla encendida. Comprobá un nuevo envío confirmado. También se solicita una medición nueva cada 20 segundos aunque el teléfono permanezca quieto; no se inventan coordenadas ni marcas de tiempo.
7. Pulsá **Dejar de compartir ubicación**. El GPS local se detiene y el servidor elimina la última posición. Al actualizar el seguimiento debe mostrar ubicación no disponible. Podés volver a compartir manualmente.
8. Confirmá la entrega. El pedido queda entregado y cesa la publicación. Solicitudes que hayan quedado pendientes de una sesión detenida no pueden volver a publicar la posición.

La entrega normal exige destino verificado y geocerca configurada. En el preview esos parámetros siguen pendientes: para cerrar una prueba, Administración debe usar **Autorizar excepción de entrega** con motivo, después de iniciar el reparto final. Esa excepción no es necesaria para probar que se comparte GPS. No cambies el domicilio real para simular una geocerca.

Si aparece permiso denegado, habilitá Ubicación para el sitio desde los ajustes del navegador. Si hay tiempo agotado o ubicación no disponible, revisá la ubicación del equipo y probá al aire libre. Ante un fallo de red el panel informa que el envío no está confirmado y reintenta mientras permanece abierto. La ayuda está incluida en **Ayuda con la ubicación**.

El GPS del navegador requiere HTTPS y permiso del usuario; la API permite detener la observación, pero no garantiza seguimiento con la página cerrada o en segundo plano. Referencia técnica: [Geolocation.watchPosition — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition).

## Verificación de esta ampliación

- Pruebas del motor: inicio únicamente durante reparto final, vínculo etiqueta/autorización, posición confirmada, parada que borra la ubicación, rechazo de puntos tardíos, aislamiento entre sesiones y cierre al entregar.
- Pruebas del controlador: permiso denegado, falta de navegador compatible/HTTPS, fallo de red, ausencia de confirmación del servidor, medición periódica con equipo quieto, descarte de respuestas tardías y revocación.
- Prueba manual local de interfaz con el motor real y almacenamiento en memoria: recepción → repositorio → salida final → compartir → visualización por cliente → detener. Coordenadas **sintéticas**, con aviso visible de laboratorio. Se generó y decodificó el QR temporal; abre el pedido y tramo correctos. Vista móvil comprobada sin desborde horizontal.
- Esta ampliación no creó nuevas ventas ni descontó inventario en el Firebase original. Los dos registros anteriores siguen documentados en [el informe de pruebas](shipping-manual-preview-40.md).
- La captura de GPS desde un teléfono físico sigue pendiente de la prueba del usuario. El indicador verde del laboratorio no acredita una medición física.

Evidencia local en `tmp/shipping-manual-preview-40/`: capturas 14–16 y logs `gps-*`. Las coordenadas y el QR de laboratorio son ficticios.
