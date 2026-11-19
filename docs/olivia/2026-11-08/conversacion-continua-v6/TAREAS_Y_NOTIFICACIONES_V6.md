# Tareas y notificaciones V6

Se reutiliza la cola persistente existente: hasta tres tareas ejecutando, prioridades, dependencias, scopes separados, lease e idempotencia. No se crea una segunda cola de trabajos.

El diario de progreso conserva hasta doce eventos reales y una revisión creciente. No tiene porcentajes porque las tareas abiertas no tienen un denominador verificable. Las herramientas producen inicio y fin de comprobación; solo el resultado final del backend autoriza anunciar finalización.

La política de voz espera al menos veinte segundos para progreso, reemplaza fases viejas por la más nueva y no anuncia mientras el usuario habla o Olivia tiene audio pendiente. Resultados finales tienen prioridad temporal y no esperan el intervalo de progreso. Como máximo dos intentos por aviso dentro del cliente. El recibo persistente corresponde a audio programado que terminó, no demuestra audición física ni exactitud semántica de todo el audio.

El recibo se rechaza si cambió request/status/revisión. Se valida el propietario. Un resultado ya comunicado no se repite al abrir otra sesión. Si se interrumpe puede volver a intentarse en una pausa. No hay garantía exactamente una vez frente a una caída entre reproducción y recibo.

Las preguntas de estado leen caché reciente o endpoint autenticado. Si hay varias solicitudes se pide aclaración. Pausar solo conserva fases que no están ejecutando; no se simula detener o revertir una operación en marcha.

Los resultados distinguen falta de datos, confirmación requerida, permiso, capacidad ausente, datos no encontrados y errores recuperables/no recuperables cuando el backend entrega códigos. Las alternativas generales no son una promesa de acceso a datos: el motor y los permisos existentes siguen siendo autoridad.

## Evidencia real y límites

- La tarea de análisis `7488ea5d…` realizó cuatro llamadas Luna y ocho herramientas (27.054 ms totales); se observó progreso real revisión 16 y recibo del resultado. No son 27 s de latencia social. Su entrada fue parcialmente afectada por recuperación y no aprueba todo el guion original.
- La carga `e5244bff…` se preparó en 17.984 ms de trabajo backend, se pausó, retomó y quedó esperando clic. Después de confirmar, Firestore verificó stock 11 → 12 y el estado fue `completed`, con notificación entregada. Los mensajes de voz quedaron correlacionados por las trazas de la aplicación; el laboratorio puede asignar un aviso posterior al último estímulo y no se usa esa asignación como latencia final exacta.
- La creación incompleta `4ef41478…` pidió un dato y se canceló por voz. No se creó un cliente en ese intento. El cliente ficticio creado antes mediante tarjeta se conserva como evidencia separada.
- La respuesta social durante la tarea de stock no inició otra herramienta ni Luna. Queda pendiente una batería de varias operaciones complejas simultáneas y conflictos sobre el mismo recurso.
- «¿Cómo venís?» usó lectura de estado, sin un trabajo nuevo. Algunos controles anteriores eligieron una tarea terminal; el backend rechazó 409, y la voz continuó. No se convierte ese rechazo en una pausa exitosa.
- Un pedido genérico de stock terminó con una pregunta en lenguaje libre pero `status:completed`. No se intenta adivinar intención a partir de un signo de pregunta: se registra como defecto pendiente del contrato estructurado de recolección. El flujo específico de cliente sí produjo `needs-input`.
- El mensaje hablado al pausar invitó a confirmar aunque la tarjeta estaba pausada y solo permitía retomar/cancelar. La autoridad visual se conservó; la redacción necesita corregirse.
- Para una métrica inexistente se ofrecieron opciones permitidas, pero no quedó demostrada una explicación y pregunta de continuación completas. La alternativa no se ejecutó por fuera de Olivia.

Un recibo `delivered:true` prueba que el cliente terminó de programar/reproducir su salida y confirmó la revisión; no prueba que una persona la oyera ni que cada palabra coincidiera con el texto. Los resultados físicos de ruido y de interrupciones semánticas continúan pendientes.
