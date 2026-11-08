# Recuperación Gemini V6

- Un proceso de recuperación por cliente; tres intentos por incidente, máximo cinco incidentes por cliente. Backoff 400/800/1600 ms con jitter ±20%, techo 3000 ms.
- El mecanismo admite handle privado cuando el contrato de la credencial permite reutilización. Los tokens reales de este preview tienen `uses:1`: se liberan y sustituyen en cada nueva conexión. Nunca se muestra ni exporta el handle o el token.
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

## Cortes controlados y correcciones verificadas

| Código | Prueba real en Chrome | Resultado |
|---|---|---|
| V6 inicial | Corte del WebSocket propio | Reanudación rechazada, sesión nueva disponible en aproximadamente 7,1 s; una frase emitida durante recuperación se perdió |
| c59c624 | Corte del WebSocket después de vencer ventana de apertura | Sesión nueva en 6421,6 ms, sin intento con credencial vencida; pregunta posterior respondida |
| c59c624 | Pestaña sin red 12042,7 ms | Falló recuperación automática: el manejador `offline` del panel cerraba la conversación. Se restauró red y se cerró solo la reserva propia de pruebas, que había quedado activa |
| b64e257 | Pestaña sin red 12042,6 ms | Automática: 19684,7 ms desde corte, 7642,1 ms desde restablecer red. Primer intento recibió 1011 «Token has been used too many times», luego renovó |
| 3c43f1e | Repetición con `uses:1` explícito | Automática: sin red 12360,1 ms; disponible 18122,5 ms desde corte y 5762,4 ms después de restablecer red. Una emisión de token y un setup posterior al corte, sin 1011 |

Son muestras individuales, sin percentiles ni comparación porcentual. El tiempo de red impuesto se separa del tiempo de recuperación. La prueba fue exclusivamente de la pestaña de preview con DevTools; no se cambió la red, firewall ni configuración de Windows.

El evento `offline` ahora inicia recuperación y espera `online` como máximo 30 s. Vencido ese plazo el usuario recibe la alternativa de escritura/reconexión; no se reintenta indefinidamente. El cierre voluntario aborta la espera y elimina listeners. Se conservan los límites de tres intentos y cinco incidentes. El plazo de 30 s y su aborto tienen pruebas locales; no se prolongó artificialmente otro corte real hasta agotarlo.

La recuperación fresca restaura contexto histórico y estados persistentes, no una grabación perdida. Después de los cortes se comprobó respuesta por voz y conservación de la misma conversación; no se repitió la carga de stock. No se certifica continuidad acústica sin pérdidas durante una desconexión.
