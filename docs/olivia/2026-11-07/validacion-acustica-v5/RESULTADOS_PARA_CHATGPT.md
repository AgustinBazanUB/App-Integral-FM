# RESULTADOS PARA ANALIZAR EN CHATGPT — OLIVIA V5

Auditoría ejecutada el 7–8 de noviembre de 2026, America/Buenos_Aires. **No hay aceptación general de fluidez ni de acústica física.** Hay mejoras verificadas y fallos reproducidos que siguen pendientes.

1. **Versión.** App Integral Flor Mía, rama `codex/olivia-ultra-fluida-v5`, [PR #56 draft](https://github.com/AgustinBazanUB/App-Integral-FM/pull/56). Base ef54856; código final probado `b1e1c6f72048339955e2aa9c6e8bda840f6d1431`. [Preview](https://deploy-preview-56--appintegralflormia.netlify.app/gestion/settings); Firebase aislado `app-integral-fm-pruebas`. Commit documental posterior sin cambios ejecutables. Producción sin publicar.

2. **Dispositivos.** Micrófono Intel y parlantes Realtek, dos canales/48 kHz, WASAPI disponible. Volúmenes observados 94,1% entrada y 82% salida. Micrófono físico bloqueado para la batería por ruido no controlado; sus niveles se midieron sin guardar/transcribir contenido.

3. **Método.** Estímulos de voz sintética del guion → MediaStream virtual temporal en Chrome → captura PCM/VAD de Olivia → Gemini Live real → PCM programado en Web Audio. Sin inyección de texto como sustituto. Reconocimiento offline independiente sobre salida PCM en los casos largos, sin usar grabaciones privadas.

4. **Cantidad y modalidades.** Los 37 casos originales fueron ejecutados con entrada virtual. Hay 39 IDs auxiliares/intentos adicionales de calibración, regresión y controles; no son 39 conversaciones completas. Dos intentos sin sesión se invalidaron. Cero equivalentes físicos completos y 37 físicos pendientes. No se cuentan simulaciones ni pruebas de texto como voz.

5. **Resultados individuales.** 26 comportamientos puntuales aprobados en su alcance virtual, siete fallidos y cuatro bloqueados. La matriz mezcla commits documentados y repeticiones focalizadas; no son 37 pruebas finales sobre un único SHA. Las altas, transferencias y stock completos no están aprobados por esta cifra.

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

6. **Conversación social.** Catorce casos directos de Gemini, cero llamadas a herramientas y cero tareas: T1 del estímulo virtual → primer buffer programado, P50 1.369,3; P90 2.016,3; P95 2.019,9; promedio 1.513,8; máximo 2.019,9 ms. Son cuantiles descriptivos de muestra pequeña, no colas poblacionales certificadas. Contiene un primer turno de sesión (caso 04) y trece posteriores. Separando categorías: ocho sociales P50 1.427,1 ms; seis contextuales P50 1.350,6 ms. T8 acústico físico N/D.

7. **Acuses.** Tres acuses identificados: 2.053,1; 1.746,9 y 1.965,7 ms; P50 1.965,7 ms. P90/P95 N/D por muestra insuficiente. Acuses ausentes no se contabilizan como cero. Resultados finales de ventas estuvieron hacia 23,7/24,9 s y se miden aparte.

8. **Conexión.** Cuatro aperturas exportadas: 3.784,9; 4.017,3; 4.698,5 y 6.014,9 ms de clic a lista. Token HTTP aproximadamente 1.584–3.105 ms en esos registros; no se atribuye todo al proveedor. No se mezclan relojes Unix del servidor con performance del navegador.

9. **ASR y listas.** Tras separar VAD del refresco visual y agregar pre-roll, los tres saludos de calibración conservaron Hola, Olivia; antes dos perdían Hola. Hubo normalizaciones de voseo y QA Olivia V5 Uno se transcribió CUA Olivia V51. Las listas de 3/5/10/20 llegaron completas en un solo turno; diez/veinte no siempre se repitieron completas. En el último código, una lista de veinte dio audio reconocible solo hasta cinco Eco y otra sí confirmó veinte Tango. El texto de pantalla no certifica el contenido de voz.

10. **Ruido.** Silencio virtual 8 s: sin eventos; ruido suave 3 s: sin turno; música sintética 3 s: activación local sin ASR y estado pendiente. Un pulso de 150 ms mientras hablaba cortaba once buffers antes; tras el filtro no abrió turno ni detuvo fuentes y Olivia terminó el tema. No se mezcló ruido físico de la PC con la entrada de la batería.

11. **Simultaneidad e interrupciones.** Se observaron dos trabajos coexistiendo y estados persistidos, pero el máximo de tres tareas y su notificación correcta no quedaron aprobados. Hubo una segunda tarea fallida y avisos previos en consultas nuevas. En el último deploy, No sigas detuvo la reproducción, el nuevo pedido tuvo respuesta y volvió a Te escucho. Se segmentó en dos turnos; Esperá fue omitido. No se publican tiempos negativos de esa intervención solapada. Faltan asentimientos/monosílabos, música prolongada y reanudación semántica tras una interrupción accidental efectiva.

12. **Correcciones.** Reloj de VAD basado en captura y pre-roll de 200 ms; notas/pausas/preferencias sociales directas; retención del turno al rechazar herramientas conversacionales; acuse exacto neutral; excepción de brevedad para listas y techo de salida 2.048; filtro temporal de picos solo mientras habla; estado visual correcto ante cierre local tardío; timeout reemplazado por plazo de reproducción al completar generación. Última suite: 1.123/1.123 y build aprobado.

13. **Antes/después.** Nota: 20,9 s delegada → 1,6 s directa en una repetición. Corrección sin audio → respuesta en 1,8 s. Pulso accidental: once fuentes detenidas → cero. Son comparaciones individuales de estímulos controlados, no porcentajes generalizables. Los antecedentes V4 de 18–20 s eran aproximaciones físicas distintas y no se mezclan con estos datos.

14. **Costo.** Gemini: USD 0.402871 registrados en los eventos propios: USD 0.370492 calculados aplicando las tarifas configuradas en la app a usageMetadata y USD 0.032379 estimados por duración, sin contexto. Luna: USD 0.0143498 identificables en 17 llamadas con responseId único. Subtotal identificable USD 0.4172208; faltan costos no expuestos por algunos resultados y conciliación con facturas. Presupuesto incremental Gemini de USD 1 respetado en registros; contador mensual observado 0,169 → 0,593538 incluye consumo no atribuible a estos eventos propios. Reserva final cero. Sin cambio de límites 5/6/10 USD ni 660 turnos.

15. **660 consultas.** Proyección representativa N/D: se mezclaron calibraciones, contextos largos, repeticiones fallidas y operaciones. No extrapolar el promedio de esta auditoría al uso mensual.

16. **Cumplido en alcance limitado.** Los catorce casos sociales no delegaron; notas/pausas corregidas tuvieron audio; los controles de cancelación/ambigüedad no hicieron altas; el pulso breve dejó continuar la explicación y la interrupción hablada detuvo la voz. Un caso de veinte completo y cierre normal quedó confirmado en el último código. Aislamiento de staging y restauración del laboratorio verificados.

17. **Pendiente.** Estabilidad de audio largo; batería física sin contaminación; apertura rápida; meta de 500 ms; tres tareas concurrentes y avisos correctos; altas/stock/transferencias QA con revisión y verificación posterior; permisos insuficientes y doble confirmación manual; intención de interrumpir ante voces/música/asentimientos. El producto todavía no está listo para declararse ultra fluido.

18. **Tres cuellos de botella.** (a) Endpoint local sin parcial: espera aproximadamente 1,1 s y crece con pausas antes del inicio de respuesta. (b) Audio largo intermitentemente incompleto respecto del texto, con decenas de segundos programados de baja energía en una repetición: origen aún por localizar. (c) Delegación/notificaciones: procesamiento, persistencia, polling y correlación que producen respuestas de 15–25 s y errores de comunicación; no se atribuye automáticamente todo a Luna.

19. **Archivos y funciones.** `naturalVoice.mjs`: evaluateVoice/beginTurn/finishTurn; `geminiLive.mjs`: attachCapture/setListening/authorizeTurn/handleBackgroundTools/receive/finishTurn/drainToolResults; `oliviaConversationRouter.mjs`: classifyGeminiLiveTurn; `oliviaGeminiLive.mjs`: geminiLiveSetupConfig; `OliviaAssistant.jsx`: unión de callbacks, estados y tareas; `delegatedTaskClient.mjs`: runTask/refresh/control. Los CSV/JSON adjuntos conservan los IDs, costos, rutas y relojes separados.

20. **Siguiente etapa recomendada.** Priorizar una reproducción del fallo de audio largo con niveles PCM crudos y programados simultáneos, contenido y fin de reproducción, antes de ajustar más parámetros. Luego completar tareas QA independientes y notificaciones correlacionadas. Evaluar endpointing con parciales reales o señales de voz más robustas sin recortar listas. Repetir la aceptación física solo en ambiente controlado. Mantener el PR draft y pedir revisión visual antes de integrar a main.

Últimas dos listas en b1e1c6f: CHECKED, primer buffer 3.525,6 ms, salida programada 51,70 s, audio parcial; PCM-PROBE, 3.313,0 ms, salida 35,90 s y los veinte confirmados. El primer PCM con energía apareció 35 ms después del buffer inicial en ambos. Son mediciones reales de software/proveedor, no TTFA acústico físico.

Se cerraron las sesiones, se liberó la reserva, se desconectaron pistas virtuales y se restauraron hooks/preferencias. Audio y reconocimiento offline quedan privados; el repositorio contiene evidencia sanitizada.
