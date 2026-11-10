# Validación de Olivia V5 — resultados del 7 y 8 de noviembre de 2026

## Dictamen

Olivia puede repetir los veinte productos completos por el circuito virtual real, pero todavía presenta una falla intermitente de audio. En el último código hubo dos repeticiones diagnósticas: CHECKED-LIST-20 cerró normalmente, mostró 20 nombres en texto, pero la verificación independiente de su PCM reconoció solo los primeros cinco; PCM-PROBE-LIST-20 sí reconoció por audio los 20, hasta «veinte Tango», y cerró normalmente. No se aprueba la estabilidad general de listas largas.

El ruido sintético breve de 150 ms dejó de detener la explicación después de la corrección. La interrupción hablada «No sigas» sí detuvo la voz y el estado volvió a «Te escucho». Esto acredita esos casos controlados; no acredita comprensión general de la intención de interrumpir ante música, voces ajenas o asentimientos.

La aceptación física sigue bloqueada por ambiente no controlado. La matriz consolida varios commits; no representa 37 casos repetidos íntegramente sobre el último SHA. Los aprobados se limitan al comportamiento descrito en cada fila, no certifican toda la integración comercial.

## Versión, entorno y límites de autorización

- Rama: `codex/olivia-ultra-fluida-v5`; referencia inicial `ef5485643c516ade20c1bfdaeba7eb0449b6e377`.
- Código final evaluado: `b1e1c6f72048339955e2aa9c6e8bda840f6d1431`. El commit documental posterior conserva los mismos ejecutables.
- [PR #56, draft](https://github.com/AgustinBazanUB/App-Integral-FM/pull/56); [Deploy Preview](https://deploy-preview-56--appintegralflormia.netlify.app/gestion/settings). Netlify informó Success para el código probado; la respuesta de voz se verificó aparte.
- Frontend, Authentication y Functions/credenciales del servidor verificados contra `app-integral-fm-pruebas`. Los guards del servidor rechazan un proyecto distinto. Sesión administrativa de pruebas autenticada; Gemini Live habilitado en el preview.
- Sin merge a main, publicación en producción, mensajes a terceros, altas comerciales confirmadas ni movimientos de stock. Sí se persistieron conversaciones, tareas y consumo de QA en staging, como parte del funcionamiento normal.
- No se cambiaron credenciales, facturación, firewall, antivirus ni controladores de Windows.

## Equipamiento y aislamiento

| Elemento | Observado |
|---|---|
| Entrada física | Microphone Array, Intel Smart Sound Technology; 48 kHz, dos canales |
| Salida física | Speakers, Realtek Audio; 48 kHz, dos canales |
| Volúmenes observados | Entrada 94,1%; salida 82%; sin mute; no modificados |
| Chrome | Permiso de micrófono concedido; constraints originales de cancelación de eco, supresión de ruido y AGC activadas |
| WASAPI | Loopback disponible; sin micrófono virtual del sistema activo; Stereo Mix deshabilitado y sin cambios |
| Preflight físico | Tres segundos de niveles agregados: RMS mediano 0,0472; P95 0,1489; pico 0,7467; 201/302 ventanas superaban 0,025 |
| Privacidad | No se guardó ni transcribió el contenido del preflight ambiental |

Se utilizó un MediaStream generado temporalmente dentro de Chrome, autorizado para esta auditoría. El micrófono físico quedó desconectado del circuito de pruebas. Los estímulos sintéticos se enviaron como audio, atravesando captura PCM, VAD y Gemini Live real. La salida de Olivia no se realimentó a la entrada. No se reemplazó esta batería por inyección de texto ni por respuestas simuladas.

Los estímulos también podían reproducirse por los parlantes, pero el audio entrante de las pruebas siguió siendo virtual. Esta modalidad no evalúa la acústica del ambiente, la respuesta del micrófono ni la eficacia física de echoCancellation/noiseSuppression/AGC. Una captura WASAPI encontró salida ajena; se detuvo el proceso propio sin guardar esa muestra en memoria. El candidato de latencia del primer loopback tampoco pasó la validación de correlación y queda N/D.

## Batería y evidencia

Se ejecutaron los 37 estímulos originales por audio virtual. Se conservaron sin modificar `BATERIA_ACUSTICA_V5_37.csv` y `.json`; sus estados originales son el guion, no resultados. El resultado está en `RESULTADOS_37_INTERACCIONES.csv`.

El manifiesto contiene 76 IDs de estímulos/intentos: los 37 originales y 39 auxiliares de calibración, listas, regresiones y controles. No son 76 conversaciones completas: dos intentos se hicieron con la sesión cerrada y se invalidaron; varios controles debían justamente no abrir un turno. Se registraron 71 IDs con PCM transmitido. Hubo cero validaciones acústicas físicas completas; las 37 equivalentes físicas siguen pendientes.

La matriz consolidada tiene 26 comportamientos puntuales aprobados en modalidad virtual, siete fallidos y cuatro bloqueados. Esto incluye solicitudes de datos y controles seguros; no implica que se hayan creado clientes o transferido productos. Las filas 15, 16, 18, 33 y 36 incorporan repeticiones corregidas sobre `1802d0c`; se conserva su evidencia original. La repetición de la frase 30 sin una tarea en ejecución verifica el enrutamiento, no certifica simultaneidad.

| Caso | Estado en su alcance virtual | T1 → T7 (ms) | Resultado / límite |
|---|---|---:|---|
| V5-01 | aprobado | 2016.3 | Respuesta contextual/social con audio, sin tarea ni delegación. |
| V5-02 | aprobado | 1427.1 | Respuesta contextual/social con audio, sin tarea ni delegación. |
| V5-03 | aprobado | 1226.6 | Respuesta contextual/social con audio, sin tarea ni delegación. |
| V5-04 | aprobado | 2019.9 | Respuesta contextual/social con audio, sin tarea ni delegación. |
| V5-05 | aprobado | 1348.5 | Respuesta contextual/social con audio, sin tarea ni delegación. |
| V5-06 | aprobado | 2011.5 | Respuesta contextual/social con audio, sin tarea ni delegación. |
| V5-07 | aprobado | 1458.8 | Respuesta contextual/social con audio, sin tarea ni delegación. |
| V5-08 | aprobado | 1313.9 | Respuesta contextual/social con audio, sin tarea ni delegación. |
| V5-09 | aprobado | 1309.7 | Respuesta contextual/social con audio, sin tarea ni delegación. |
| V5-10 | aprobado | 1335.8 | Respuesta contextual/social con audio, sin tarea ni delegación. |
| V5-11 | aprobado | 1350.6 | Respuesta contextual/social con audio, sin tarea ni delegación. |
| V5-12 | aprobado | 1587.8 | Respuesta contextual/social con audio, sin tarea ni delegación. |
| V5-13 | aprobado | 1417.4 | Respuesta contextual/social con audio, sin tarea ni delegación. |
| V5-14 | aprobado | 1369.3 | Respuesta contextual/social con audio, sin tarea ni delegación. |
| V5-15 | aprobado | 1602.6 | Nota conversacional: se eliminó la delegación; repetición con audio sin tarea. |
| V5-16 | aprobado | 1776.7 | Conservó cuatro frascos en la repetición; antes hubo dos tool calls sin audio. |
| V5-17 | aprobado | 2329.6 | Continuación de nota; el resumen del caso 19 conservó las cantidades. |
| V5-18 | aprobado | 2078.4 | Pausa: la repetición produjo audio; antes solo hubo texto retenido. |
| V5-19 | aprobado | 1490.7 | Resumen conserva una caja, dos bolsas, cuatro frascos y los dos tamaños de pistachos. |
| V5-20 | aprobado | 2053.1 | Lectura verificada en staging: cero ventas. Acuse y resultado separados. |
| V5-21 | aprobado | 1746.9 | Lectura verificada: sin ventas, sin producto más vendido. |
| V5-22 | bloqueado | 17000 | Lavalle no existe entre ubicaciones permitidas; pidió aclaración. Stock no validado. |
| V5-23 | bloqueado | 23064.8 | No identificó productos con el término prueba; catálogo QA concreto pendiente. |
| V5-24 | fallido | N/D | Sin producto previo y sin llamada de herramienta; se retuvo el audio comercial. |
| V5-25 | fallido | 15924.5 | Tarea pide producto, pero el aviso hablado informó error del sistema. Sin escritura. |
| V5-26 | bloqueado | 20229.1 | Pide teléfono; ficha y alta no verificadas. Solo recopilación de datos. |
| V5-27 | fallido | 19790.3 | ASR convirtió QA Olivia V5 Uno en CUA Olivia V51; faltó teléfono. Sin alta. |
| V5-28 | bloqueado | 1965.7 | No hay productos de prueba identificados para transferir; sin movimiento. |
| V5-29 | fallido | N/D | La solicitud terminó en borrador para enviar a Agustín; no se envió. Hubo un tool call desde notificación sin transcripción. |
| V5-30 | fallido | N/D | Primera ejecución sin audio. RE-30 respondió directamente, pero sin trabajo en ejecución: simultaneidad no certificada. |
| V5-31 | fallido | N/D | La segunda tarea independiente falló en backend. No aprobada. |
| V5-32 | fallido | N/D | Se solicitó status, pero coexistieron avisos anteriores; respuesta final no atribuible de forma exclusiva al último estímulo. |
| V5-33 | aprobado | 1368.7 | Repetición con preferencia de notificación respondida por Gemini; entrega concurrente de resultados pendiente. |
| V5-34 | aprobado | 14883.1 | Control de cancelación por voz; verificar estado de la tarea por su ID, no alta de cliente. |
| V5-35 | aprobado | 7622.9 | Con varias tareas pidió aclarar cuál cancelar; no eligió una operación arbitraria. |
| V5-36 | aprobado | 1901.5 | Repetición con audio directo de espera. El guion original no era una interrupción solapada. |
| V5-37 | aprobado | 1604.6 | Continuación de charla; interrupción real evaluada aparte con estímulos solapados. |

## Latencias observadas

| Ruta / muestra | n | P50 ms | P90 ms | P95 ms | Promedio ms | Máximo ms |
|---|---:|---:|---:|---:|---:|---:|
| Social, 8 casos | 8 | 1427.1 | 2019.9 | 2019.9 | 1602.8 | 2019.9 |
| Contextual, 6 casos | 6 | 1350.6 | 1587.8 | 1587.8 | 1395.1 | 1587.8 |
| Gemini directo, ambos grupos | 14 | 1369.3 | 2016.3 | 2019.9 | 1513.8 | 2019.9 |
| Acuse delegado identificado | 3 | 1965.7 | N/D | N/D | 1921.9 | 2053.1 |

Los valores sociales son **fin significativo del estímulo virtual → primer buffer programado**, medidos en el reloj del navegador. Son cuantiles descriptivos de esta muestra, mediante nearest-rank; sus colas no certifican un SLO poblacional. No son latencias acústicas. La muestra directa de 14 contiene un primer turno de sesión (caso 04, 2.019,9 ms) y trece posteriores; el CSV conserva cada caso. Ninguno de los 14 solicitó herramientas ni creó tareas. Tres superaron 2.000 ms en esta métrica de software.

Los tres acuses identificados pertenecen a 20, 21 y 28: 2.053,1; 1.746,9 y 1.965,7 ms. P90/P95 se dejan N/D por muestra insuficiente. Los casos sin acuse autorizado no se sustituyen por cero ni se mezclan con resultados definitivos. Por ejemplo, el primer audio de resultado delegado de 20 y 21 llegó aproximadamente a 23.696 y 24.924 ms; son marcas de navegador correlacionadas con la tarea, no una resta de relojes de servidor y cliente.

### Veinte productos, por ejecución

| ID / código | T1 → primer buffer ms | Fin local → primer buffer ms | PCM programado | Verificación del contenido y cierre |
|---|---:|---:|---:|---|
| FINAL-2048-LIST-20 / aed3c1b | 3.401,6 | 1.693,7 | 25,52 s | Vosk offline sobre PCM confirma los 20; cierre normal |
| HEAD-LIST-20 / dd29437 | 2.926,5 | 1.222,2 | 50,76 s programados | Timeout de respuesta detuvo la sesión antes del cierre; no aprobado |
| CHECKED-LIST-20 / b1e1c6f | 3.525,6 | 1.820,5 | 51,70 s | Texto completo, audio independiente solo hasta cinco Eco; cierre normal; contenido fallido |
| PCM-PROBE-LIST-20 / b1e1c6f | 3.313,0 | 1.475,3 | 35,90 s | Audio confirma del uno Alfa al veinte Tango; cierre normal; caso completo |

En las dos últimas grabaciones de PCM programado, el primer tramo con RMS superior a 0,006 apareció 35 ms después del primer buffer. Es otro indicador de software: aproximadamente 3.561 y 3.348 ms desde el fin del estímulo, respectivamente. No demuestra salida física audible. En CHECKED, la última energía significativa estuvo hacia 7,415 s de los 51,74 s reconstruidos; el resto no respalda la transcripción textual de veinte productos. En PCM-PROBE, el audio tuvo energía hasta 35,575 s y el reconocimiento independiente confirmó todas las cantidades. El reconocedor pequeño confunde alguna grafía ficticia (Mike/mick, Foxtrot/fox truth); no se presenta como exactitud ortográfica perfecta.

La observación de niveles de 106 frames recibidos desde Gemini en la repetición buena confirma que el método también conserva audio válido. No se capturaron niveles crudos equivalentes en la repetición mala: la causa de su discrepancia entre texto y PCM queda abierta; no se atribuye automáticamente a Google, Web Audio o Luna.

## Ruido e interrupciones

| Prueba | Resultado observado |
|---|---|
| Silencio virtual, 8,008 s | Ningún evento nuevo ni delegación |
| Ruido gaussiano controlado, 3 s, RMS fuente 0,01 | Sin turno transmitido ni herramienta |
| Música sintética sin voz, 3 s | En 6991b36 abrió un turno local sin transcripción y dejó procesamiento; recuperación con la siguiente voz. Sigue pendiente rechazo de ruido prolongado |
| Voz sintética ajena al guion | Una respuesta conversacional, sin herramientas; no prueba filtrado de voces ambientales físicas |
| Pulso de ruido de 150 ms durante una explicación, antes | Se detuvieron once buffers y no se retomó la voz dentro de la observación |
| Mismo pulso, después, 31ff41d y b1e1c6f | Cero buffers detenidos; cero nuevos turnos transmitidos; explicación completada y estado disponible |
| «Esperá, no sigas. Quiero preguntarte otra cosa», b1e1c6f | Se detuvo la explicación; capturó «No sigas» y la segunda solicitud; terminó en «Te escucho» |

La intervención hablada se segmentó en dos turnos locales y el ASR omitió «Esperá». Sus marcas se superponen con audio anterior, por lo que no se publica un TTFA negativo o de una supuesta intervención única. Detener 32 buffers acredita cancelación de reproducción en ese ensayo, no reconocimiento general de intención. Faltan monosílabos cortos, asentimientos («ajá»), habla ajena, ruido más largo y recuperación semántica automática cuando una interrupción efectiva ya ocurrió.

## Conexión, trazas y correspondencia de relojes

Cuatro aperturas exportadas completas dieron clic → sesión lista: 3.784,9; 4.017,3; 4.698,5 y 6.014,9 ms. El HTTP del token en esos mismos registros ocupó aproximadamente 1.583,9; 2.467,3; 2.628,4 y 3.104,6 ms. Son aperturas virtuales en condiciones distintas, sin percentiles representativos. Los cierres por inactividad durante preparación están separados de fallos de una interacción activa.

| Marca pedida | Evidencia / correspondencia |
|---|---|
| T0 / T1 | Inicio y última ventana significativa del estímulo decodificado; reloj performance; RMS en ventanas de 5 ms, umbral 0,006 |
| T2 | local.audioStreamEnd; la traza del producto también registra voice.turn.end y voiceEndedAt |
| T3 | provider.transcription / gemini.transcript.final |
| T4 | gemini.classification.local; política local, sin segunda llamada de clasificación |
| T5 | provider.audio.frame / gemini.audio.first_pcm |
| T6 | gemini.audio.released / autorización de acuse o respuesta |
| T7 | lab.output.scheduled / gemini.audio.first_scheduled; el segundo conserva kind, taskId y sourceTurnId |
| T8 | N/D: ninguna primera salida acústica física validada |
| T9 | Fin calculado de buffers programados; provider.turn.complete y estado visual se verifican aparte |
| T10 / T11 | task.state, resultado sanitizado y trazas del servidor; no hay alta comercial completa verificada en esta batería |

Los relojes performance de distintas recargas no se restan entre sí. Las duraciones Unix del servidor se usan dentro de su propia traza. Los avisos tardíos se unen por taskId/sourceTurnId, nunca simplemente por el último estímulo reproducido. Para 31 y 32, el texto no atribuible exclusivamente se identifica como tal en el CSV.

## Cambios, pruebas y costos

Se modificaron `naturalVoice.mjs`, `geminiLive.mjs`, `OliviaAssistant.jsx`, `oliviaConversationRouter.mjs` y `oliviaGeminiLive.mjs`, más pruebas de regresión. Se mantuvieron Gemini `gemini-3.8-live`, Aoede y la integración existente con Luna. No se añadió infraestructura ni un clasificador remoto por frase.

Las correcciones y sus límites están en `PROBLEMAS_Y_CORRECCIONES.md`. Última ejecución automatizada: **1.123/1.123** aprobadas y build aprobado; continúa la advertencia existente de chunks grandes. Las tres comprobaciones de reglas del emulador pertenecen a la etapa previa documentada; no se cambiaron reglas aquí y no sustituyen pruebas de permisos con cuentas reales de QA.

Gemini: USD 0.402871 registrados en los eventos propios: USD 0.370492 calculados aplicando las tarifas configuradas en la app a usageMetadata y USD 0.032379 estimados por duración, sin contexto. Luna: USD 0.0143498 identificables en 17 llamadas con responseId único.

Son costos calculados/estimados, no conciliación con facturas. Hay tareas cuyo resumen no expone costo por llamada: su costo queda N/D. El subtotal identificable Gemini + Luna es USD 0.4172208. No se inventa un costo de Netlify ni del generador de estímulos. El contador mensual pasó de USD 0,169 a 0,593538, una diferencia de 0,424538 que incluye consumo ajeno a los eventos propios; no se atribuye toda a esta prueba. La reserva final fue cero. El presupuesto incremental de USD 1 se respetó según los registros disponibles. Permanecen los límites 5/6/10 y 660; no se presenta una proyección de 660 basada en esta muestra heterogénea.

## Pendientes para aprobar Olivia

1. Reproducir y localizar la discrepancia intermitente texto completo / PCM incompleto en listas largas; exigir validación del contenido audible.
2. Reducir endpointing y apertura sin recortar listas: el fallback sin parcial espera aproximadamente 1,1 s y sube con pausas; la meta física de 500 ms sigue sin medición válida.
3. Completar simultaneidad real hasta tres tareas, notificaciones correlacionadas y recuperación de errores. Los casos 31/32 no aprobaron.
4. Preparar por conversación datos QA concretos para lecturas, fichas, stock y transferencias; verificar tarjetas, confirmación visual, doble confirmación, idempotencia y valor posterior. Ningún backend ejecutado directamente vale como aprobación funcional de Olivia.
5. Probar permisos insuficientes con cuenta QA disponible, cambios entre preparación/confirmación y reintentos controlados. La cobertura automatizada no equivale a ejecución manual.
6. Probar voces ajenas, música sostenida, «sí/no» breves y asentimientos durante reproducción; no confundir duración de energía con intención humana.
7. Completar equivalentes físicos en un ambiente sin conversaciones ajenas y con loopback aislado; no reutilizar la medición acústica inválida.

Se cerró la voz, se liberó la reserva y se restauraron las funciones temporales de audio/navegador. Modo desarrollador volvió a su valor anterior. Los PCM y reconocimientos offline permanecen como artefactos locales privados; Git contiene trazas sanitizadas y resultados, no grabaciones ni credenciales.
