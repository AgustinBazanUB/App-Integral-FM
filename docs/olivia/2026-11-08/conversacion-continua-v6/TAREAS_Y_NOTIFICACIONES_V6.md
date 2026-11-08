# Tareas y notificaciones V6

Se reutiliza la cola persistente existente: hasta tres tareas ejecutando, prioridades, dependencias, scopes separados, lease e idempotencia. No se crea una segunda cola de trabajos.

El diario de progreso conserva hasta doce eventos reales y una revisión creciente. No tiene porcentajes porque las tareas abiertas no tienen un denominador verificable. Las herramientas producen inicio y fin de comprobación; solo el resultado final del backend autoriza anunciar finalización.

La política de voz espera al menos veinte segundos para progreso, reemplaza fases viejas por la más nueva y no anuncia mientras el usuario habla o Olivia tiene audio pendiente. Resultados finales tienen prioridad temporal y no esperan el intervalo de progreso. Como máximo dos intentos por aviso dentro del cliente. El recibo persistente corresponde a audio programado que terminó, no demuestra audición física ni exactitud semántica de todo el audio.

El recibo se rechaza si cambió request/status/revisión. Se valida el propietario. Un resultado ya comunicado no se repite al abrir otra sesión. Si se interrumpe puede volver a intentarse en una pausa. No hay garantía exactamente una vez frente a una caída entre reproducción y recibo.

Las preguntas de estado leen caché reciente o endpoint autenticado. Si hay varias solicitudes se pide aclaración. Pausar solo conserva fases que no están ejecutando; no se simula detener o revertir una operación en marcha.

Los resultados distinguen falta de datos, confirmación requerida, permiso, capacidad ausente, datos no encontrados y errores recuperables/no recuperables cuando el backend entrega códigos. Las alternativas generales no son una promesa de acceso a datos: el motor y los permisos existentes siguen siendo autoridad. Falta verificar rutas comerciales reales de estas alternativas.
