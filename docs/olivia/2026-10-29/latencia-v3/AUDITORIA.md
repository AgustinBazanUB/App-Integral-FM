# Olivia: latencia y diálogo v3

Base revisada: `d2d36b8407cd5acf49e09754dd6d1a1a443d7839`, preview #48. Rama nueva creada desde `origin/main` actualizado e incorporando la revisión pendiente #48. Esta actualización prepara otra preview: no integra `main`, no cambia reglas/índices ni copia datos. Los ~3 s hasta la primera frase, ~7 s en «¿cómo estás?» y >10 s en stock fueron observaciones del usuario, sin trazas de referencia. No se presentan como percentiles instrumentados.

## Hallazgos de la cadena anterior

1. `NaturalVoiceConversation.loop`: mínimo fijo de 1900 ms; 3000–4000 ms tras pausas o texto incompleto. El commit recién comenzaba después de esa espera. MediaRecorder y el respaldo por archivo se conservaban.
2. Live sí usaba `gpt-live-transcribe`, `languages: ['es']`, `delay: low` y `turn_detection: null`. La conexión WebRTC se reutilizaba, pero vencía a los 180 s y después continuaba con transcripción por archivo. La correlación podía perder un final recibido antes del acuse de commit.
3. El selector breve usaba Luna NONE, pero el motor principal seguía en HIGH para operaciones rutinarias y XHIGH para complejas. «Olivia, ¿cómo estás?» no era un saludo local válido. Cambiar solo el selector no resolvía esa espera.
4. Todas las consultas de voz creaban un trabajo en segundo plano: otra Function, transacciones de inicio, sondeo cada 350 ms y validación de autenticación en cada petición. El flush periódico era de 2000 ms, **pero accepted/phase/voice.ready ya solicitaban un flush inmediato**; no se atribuyen dos segundos fijos al audio final.
5. `configuration()` podía esperar a `resolveOliviaPricing`: dos webs de cotización, con timeout de 3000 ms cada una, antes del trabajo conversacional. Un cold start o una cotización no disponible podía introducir hasta ~6 s adicionales. Ese es un límite deducido del código, no una duración remota medida.
6. `search_products` ejecutaba secuencialmente dos variantes del prefijo; `get_stock` leía producto y stock en serie después de autorizar la ubicación. Las consultas sencillas podían pasar por modelo → herramientas → modelo para redactar una cifra.
7. Chirp **ya utilizaba StreamingSynthesize** y el navegador ya programaba PCM conforme llegaba. No había una descarga completa obligatoria del audio antes de reproducirlo. El retraso anterior al TTS era el principal objetivo de este cambio.
8. El diálogo imponía como máximo dos datos y pedía cantidad en una pregunta posterior, aunque el esquema permitía reunirlos. «Quiero hablar con un cliente» podía clasificarse como alta. La ubicación contextual tampoco se reutilizaba en todos los inicios de carga.

Auditoría estructural auxiliar con Graphify: 12 archivos de código, 115 nodos/220 aristas. Es un grafo parcial, con **129 referencias a extremos externos y 3 aristas colapsadas**; no se usa como prueba de cobertura completa. Los hallazgos se confirmaron leyendo las implementaciones y con pruebas. Los artefactos del grafo son locales e ignorados por Git.

## Correcciones

| Punto | Antes | Ahora, con respuesta ágil activada |
| --- | --- | --- |
| Saludo/charla inequívoca | Saludo limitado; «cómo estás» podía ir al modelo | Matcher completo; respuesta real, sin Luna ni herramientas |
| Silencio de charla | ≥1900 ms | 450 ms con parcial estable; se valida con energía de voz |
| Lectura completa | ≥1900 ms | 700–900 ms; casos desconocidos más conservadores |
| Listas/frases inconclusas | 3000–4000 ms | Hasta 2000 ms; cargas sin destino completo conservan 1800 ms |
| STT | Live `low` | Live `minimal`, comparador configurable `low`; VAD solo en la aplicación |
| Respuesta simple | Worker + sondeo | SSE directo para charla y lectura tipada; recuperación y cancelación por ID |
| Stock/precio inequívoco | Posibles dos llamadas LLM | Controlador tipado + herramientas autorizadas + formato determinista |
| Cliente existente | Posible confusión con alta | Búsqueda por nombre/teléfono; «hablar» no crea una ficha |
| Luna rutinaria | HIGH | NONE, con 1200 tokens máximos de salida en voz rutinaria |
| Luna compleja | XHIGH | MEDIUM; Sol creativo conserva su modelo/política existente |
| Intervención intermedia | Selector Luna concurrente | Selección local tras ~850 ms, solo con trabajo confirmado; como máximo una |
| Cotización en la conversación | Podía bloquear con una petición externa | Solo cotización manual o caché vigente; la estimación escrita puede actualizarla aparte |
| Lecturas independientes | Secuenciales | Prefijos en paralelo; producto/stock en paralelo después de autorización |
| Live prolongado | Caía a respaldo tras la ventana | Renueva entre ventanas, solo en reposo y después de liberar el lease; conserva cuotas y captura autorizada |

Las rutas estrictas no interpretan libremente instrucciones ni conceden permisos. Solicitudes combinadas, ambiguas, correcciones y mutaciones siguen al motor y sus herramientas. No se ejecutan escrituras ni se pronuncian cifras a partir de parciales. La búsqueda de clientes declara su límite de 150 registros cuando afecta la respuesta. La búsqueda de productos acotada pide aclaración antes de elegir una presentación ambigua.

El esquema real de cliente requiere teléfono; nombre y zona pueden ser opcionales. No se agregan requisitos inexistentes. Se conservan slots, propuestas exactas, comprobación de duplicados y la tarjeta visual de confirmación. Un «sí» hablado conserva la propuesta; no ejecuta stock, ventas, CRM ni mensajes. La cancelación de un turno en primer plano se vincula al request ID: no invalida un turno nuevo y marca una cancelación temprana para impedir una respuesta tardía.

## Medición antes/después

`node scripts/audit-olivia-latency.mjs` carga el VAD anterior desde el commit de referencia y ejecuta ambos con los mismos frames/partials sintéticos. 40 casos: 10 de charla, 10 lecturas, 10 controlados y 10 inconclusos. **Mide el algoritmo de endpointing, no precisión de STT, red, ruido ni latencia física de un micrófono.** Los percentiles iguales se deben a ventanas y frames controlados, no a una población de usuarios.

| Flujo: silencio de cierre en ms | Antes P50 / P90 / P95 | Después P50 / P90 / P95 |
| --- | --- | --- |
| Charla breve, N=10 | 1904 / 1904 / 1904 | 464 / 464 / 464 |
| Lecturas completas, N=10 | 1904 / 1904 / 1904 | 704 / 704 / 704 |
| Controlados, N=10 | 1904 / 1904 / 1904 | 1808 / 1808 / 2000 |
| Inconclusos, N=10 | 4000 / 4000 / 4000 | 2000 / 2000 / 2000 |

En el adaptador backend de stock (Firestore en memoria, modelos simulados, N=12 por modo) se verificó **2 → 0 llamadas de modelo**. El tiempo de CPU/adaptadores de esta computadora figura en `MEDICIONES.json`; no estima duración de Firestore ni de OpenAI en Netlify.

QA de navegador con audio, STT y red simulados, una muestra por flujo:

| Flujo | Silencio | Commit → final STT | Fin de voz estimado → primer audio útil | Llamadas nuevas |
| --- | --- | --- | --- | --- |
| «Olivia, ¿cómo estás?» | 466 ms | 31 ms | 534 ms | 0 selector, 0 TTS dinámico, 0 transcripción de archivo |
| «¿Cuántas almendras quedan?» | 707 ms | 31 ms | 778 ms | 0 selector, 1 TTS dinámico simulado, 0 transcripción de archivo |

El saludo responde «¡Bien! ¿Y vos?». En la lectura se respondió una cifra sintética y se comprobó una ruta en primer plano. Evidencias en `evidence/`. **Estos tiempos no son mediciones de proveedores reales ni garantías de 1 s/3 s en el dispositivo del usuario.** La medición completa antes/después con voz real queda pendiente; no se inventan P50/P90/P95 para esa población.

## Trazas, costos y reversión

Por turno se guardan en memoria marcas con `performance.now()` para inicio/último frame de voz estimado, commit, primer delta/final STT, despacho/aceptación/final de request, cabeceras TTS, primer paquete y programación/final del audio. Se vinculan turn ID y request ID. El backend usa reloj Unix y registra router, comienzo/fin de LLM, primer token, herramientas y operaciones Firestore. AsyncLocalStorage aísla las trazas concurrentes. Nunca se restan directamente relojes de cliente y servidor.

`X-Olivia-Server-Ms` permite contrastar tiempo de servidor anterior a cabeceras con la espera del cliente. La diferencia es **una estimación que también puede incluir colas y obtención/renovación del token**, no una medición pura de la red. El tiempo de primer audio es programación WebAudio, no una captura física de los altavoces. Los percentiles se separan por flujo y las trazas se ven solo en el panel de desarrollo administrativo. No se envían textos, teléfonos, direcciones, filtros, rutas Firestore con IDs ni resultados a estas trazas. Los registros técnicos de TTS contienen ID, caracteres y tiempos; no contienen el texto sintetizado.

Se mantienen los 90 audios originales. Se agregan únicamente 3 respuestas breves necesarias («bien», agradecimiento y despedida), con la misma voz Aoede/rate 1: **66 caracteres, USD 0,00198 estimados** a USD 30/M. Su generación se ejecuta en el entorno de preview verificado; después se conservan como archivos estáticos. Reproducción de caché: 0 llamadas LLM/TTS; puede consumir transferencia de Netlify. Una lectura tipada usa 0 tokens LLM; el TTS dinámico cuesta `caracteres × 30 / 1.000.000`. STT Live mantiene su costo por duración (referencia USD 0,017/min), límites y reserva. En rutas con Luna se registra el uso devuelto por el proveedor; no se presenta una factura calculada como cargo confirmado. Los presupuestos de cuota, privacidad y retención siguen vigentes.

`conversationLatency.enabled` permite volver al modo anterior desde Configuración de IA mediante la confirmación y reautenticación existentes. `transcriptionDelay` permite comparar `minimal` y `low`. No se reescribe automáticamente la configuración de producción. El silencio de 1900–4000 ms se conserva para ese modo anterior.

## Validación y límites pendientes

- Suite general: **1047/1047** correctas; build de Gestión correcto (aviso previo de chunks grandes). Pruebas nuevas cubren 40 expresiones, lectura fresca, permisos por ubicación, contacto con cliente existente, conservación de propuestas, cancelación por ID, eventos STT fuera de orden, privacidad de trazas, ausencia de selector, listas con pausas, renovación de Live, cotización fuera de la conversación y reversión.
- Los proveedores no se cambian. No se regeneran los 90 audios. No se crean operaciones comerciales remotas ni se envían WhatsApp o comprobantes.
- Falta comparar `minimal`/`low` con 30–50 grabaciones reales en español argentino, ruido del local, pausas reales, formatos/presentaciones y escritorio/iPhone/Android. Las ventanas cortas pueden separar un saludo de una continuación después de una pausa; el barge-in conserva el nuevo pedido y la opción de modo anterior permite revertir. No se garantiza precisión con ese material sin probarlo.
- Consultas fuera del matcher estricto siguen usando Luna y pueden requerir varias herramientas. Trabajos largos mantienen worker y recuperación; la ruta rápida no convierte una acción en una escritura especulativa.
- Netlify puede introducir cold start, latencia de autenticación y Firestore. La nueva instrumentación permite medirlo en la siguiente prueba del usuario, pero no se promete eliminar esas demoras.

## Fuentes oficiales verificadas

- [OpenAI Docs: Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)
- [OpenAI Docs: Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization)
- [OpenAI Docs: Using GPT-6](https://developers.openai.com/api/docs/guides/latest-model)
- [Google Cloud: Bidirectional streaming synthesis](https://docs.cloud.google.com/text-to-speech/docs/create-audio-text-streaming)
