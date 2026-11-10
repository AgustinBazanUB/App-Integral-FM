# Incidencias y correcciones — Olivia V5

Referencia: `ef54856`. Código final evaluado: `b1e1c6f72048339955e2aa9c6e8bda840f6d1431`. Modalidad: entrada virtual y proveedor real; aceptación acústica física pendiente.

| Problema / evidencia | Causa demostrada o hipótesis delimitada | Corrección | Verificación y límite |
|---|---|---|---|
| VAD irregular y dos saludos sin Hola | El detector dependía de requestAnimationFrame; se midieron intervalos cercanos a 1 s. Antes del umbral se descartaba el inicio | RMS del callback de captura; pre-roll máximo de 200 ms, transmitido solo al abrir un turno | Tres saludos completos después; pruebas de captura, orden y no transmisión en silencio. No es certificación física |
| Nota social delegada, 20,9 s | La frontera comercial encontraba caja en una nota explícita de conversación | Ruta de nota contextual acotada, conservando bloqueos de operaciones/datos comerciales | RE-15 sin herramienta, 1,6 s; no se debilitan confirmaciones |
| Corrección produce tool calls y queda sin voz | El turnComplete original podía retirar el turno antes de la regeneración posterior a rechazar una herramienta conversacional | awaitingToolResponse y plazo de respuesta conservado | Regresión automatizada reproduce ese orden; proveedor real respondió las correcciones directamente después del ajuste |
| Pausas, pedidos de avisar y charla sobre tarea quedan mudos | Palabras de negocio en la frase de contexto forzaban ruta delegada aunque el pedido real fuera conversacional | Clasificar la cláusula solicitada tras mientras; pausas y preferencia de aviso directas | RE-18/30/33/36 con audio; RE-30 no certifica una tarea simultánea real |
| Acuses variados silenciados | El prompt ofrecía una frase como ejemplo, pero el reproductor autorizaba solo frases neutrales exactas | Pedir exactamente Dale, lo reviso; se conserva la validación de seguridad | Hay acuses válidos identificados; no se certificó cero omisiones en toda tarea nueva |
| Listas de diez/veinte sin repetición completa | Instrucción de brevedad y techo bajo de salida eran candidatos; no se recibió un finish reason que permita atribuir cada corte a uno solo | Excepción de brevedad para enumeraciones y techo acotado 2.048, tras ensayos con 512/1.024 | Veinte confirmados por PCM en aed3c1b y en un ensayo b1e1c6f; otra repetición b1e1c6f tuvo audio parcial. Estabilidad pendiente |
| Audio largo detenido con sesión en reproducción | El timer original de 45 s seguía activo después de generationComplete; coincidió con el cierre antes del fin de buffers | Cambiar al plazo de reproducción pendiente más gracia acotada de turnComplete al terminar generación | 1.123 tests; dos ensayos nuevos de lista cerraron normalmente. El contenido de uno fue parcial: cerrar bien no basta |
| Ruido de 150 ms corta una explicación | Un solo frame RMS alto abría turno y detenía fuentes | Candidato sostenido de 160 ms solo durante reproducción, con tolerancia breve de caída; conserva el pre-roll y el inicio inmediato cuando está disponible | Antes once buffers detenidos; después cero en dos repeticiones, ninguna entrada nueva y tema completado. No clasifica intención humana ni rechaza música sostenida |
| Indicador pensando tras terminar una interrupción | El cierre local podía ocurrir después del cierre nativo y sobrescribir speaking/listening con processing | finishTurn conserva el estado ya resuelto de Gemini | Interrupción final en b1e1c6f volvió a Te escucho; regresión cubre speaking/listening/processing |
| Texto de veinte productos con PCM parcial | En CHECKED se reconocieron cinco productos, energía solo hasta 7,415 s y salida programada de 51,74 s | Sin corrección causal todavía | Otra repetición con niveles crudos del proveedor confirmó veinte y 35,90 s. La muestra mala no tiene niveles crudos equivalentes; origen por localizar |
| Música sin voz activa turno | RMS local mide energía, no identidad ni intención | Se filtran picos breves durante reproducción; no es solución para sonido sostenido | Control de 3 s original abrió turno sin ASR; rechazo general pendiente |
| Comunicación de tareas y concurrencia | Caso 25 habló de error pese a needs-input; 31 falló; 32 coexistió con avisos previos | Se conservan IDs/sourceTurnId y se impide certificar texto por último turno | Integración asíncrona real sigue pendiente; no se declara arreglada por tests |

## Archivos y commits

- `6991b36`: `naturalVoice.mjs`, `geminiLive.mjs`, `OliviaAssistant.jsx`, pruebas de captura/VAD y registro inicial.
- `1802d0c`: `oliviaConversationRouter.mjs`, `oliviaGeminiLive.mjs`, `geminiLive.mjs` y pruebas de controles/regeneración.
- `8cb5140` / `aed3c1b`: ensayos de techo de salida de 1.024 / 2.048; el último es el valor vigente.
- `31ff41d`: filtro de pico durante reproducción en `NaturalVoiceConversation.evaluateVoice` y su regresión.
- `dd29437`: transición de estado de `NaturalVoiceConversation.finishTurn`.
- `b1e1c6f`: plazo de finalización de `GeminiLiveSession.receive` después de generationComplete.

No se cambiaron el modelo, la voz, la integración con Luna, los límites mensuales, permisos ni reglas de producción. La documentación de Google indica que `thinking_config`/`thinking_level` no están soportados en gemini-3.8-live estándar; no se añadió un parámetro incompatible ni se cambió a Extended Thinking. Referencia primaria: [guía de migración de Google](https://github.com/google-gemini/gemini-skills/blob/main/skills/gemini-live-api-dev/references/migration.md).

## Fallos del laboratorio separados del producto

- WASAPI con salida ajena y un candidato inicial inválido de latencia: TTFA físico N/D; nada de voces privadas publicado.
- Dos intentos con sesión cerrada, CAL-02 y B1-NOISE-BASE: sin entrada enviada, inválidos.
- El envío de WAV largos interrumpió la conexión con la herramienta; se reencodificaron los estímulos de diez/veinte a MP3 y se recuperó Chrome. No se instaló un driver ni se cambió la seguridad.
- Cierres 1008 por inactividad durante preparación: reserva liberada y reconexión; no se presentan como falla estadística de conversación activa.
- Se restauraron getUserMedia, WebSocket, Response.json y hooks de audio temporales, se cerraron las pistas virtuales y la sesión; reserva final cero.
