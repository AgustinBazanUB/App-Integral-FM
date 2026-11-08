# Recuperación Gemini V6

- Un proceso de recuperación por cliente; tres intentos por incidente, máximo cinco incidentes por cliente. Backoff 400/800/1600 ms con jitter ±20%, techo 3000 ms.
- Reanuda con handle privado si sigue vigente el token y la reserva. Nunca se muestra ni exporta el handle o el token.
- Si no puede reanudar, libera la reserva anterior, solicita token nuevo, reinyecta últimos ocho mensajes acotados y hasta veinte estados de tareas como contexto histórico, sin repetir instrucciones ni confirmaciones.
- Conserva las tareas persistentes y elimina function IDs de conexiones anteriores. Una interrupción de reproducción no cancela trabajos.
- No reintenta denegaciones 400/401/403/429 ni límites de gasto. Cierre del usuario aborta recuperación y libera credenciales recibidas tarde.
- Aviso normal después de 1,8 s de recuperación. Al agotar intentos: permite continuar por escritura o volver a iniciar voz. Diagnóstico técnico solo en modo desarrollador administrador.
- La entrada que se perdió durante una caída no se reenvía automáticamente. Puede requerir que el usuario repita la frase. La voz no es una sesión eterna.
- La pérdida de la respuesta HTTP de emisión de token puede dejar reserva temporal hasta su vencimiento; no se sortea el control con otra sesión paralela.

Verificación local: reanudación, renovación, no replay, límite de reintentos, cierre durante backoff y corte por presupuesto. Las mediciones reales se completan en RESULTADOS_PRUEBAS_V6.md.


## Causa observada de reanudaciones rechazadas

En las pruebas reales se registraron cierres `1008: Session closed due to client inactivity.` seguidos por `1011: new_session_expire_time deadline exceeded`. El cliente solo comparaba la expiración total del token, no la ventana de apertura que el servidor configuraba en 60 s.

Ahora la Function devuelve también `newSessionExpiresAt` y el cliente no intenta reanudar usando esa credencial después de esa ventana: libera la reserva y solicita una nueva. No se aumenta ninguna vigencia ni se permiten sesiones paralelas. La decisión es conservadora para el comportamiento observado en este endpoint, no una afirmación de que todo uso de sessionResumption tenga idénticas restricciones.

Referencia primaria: [AuthToken — expireTime y newSessionExpireTime](https://ai.google.dev/api/generate-content#AuthToken). La segunda limita la apertura de conexiones nuevas; la primera limita la vigencia total de uso. Los rechazos y tiempos medidos se conservan por separado en las trazas.

No se envía audio de silencio continuo para evitar cierres por inactividad: eso tendría costo y no garantiza una sesión eterna. Se recupera cuando el servicio cierra. El audio emitido mientras la conexión no está lista puede perderse; no se promete recuperación de esa entrada y no se reenvían operaciones anteriores.
