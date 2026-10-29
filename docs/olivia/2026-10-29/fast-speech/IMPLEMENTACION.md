# Olivia: transcripción en vivo y biblioteca de voz

Revisión sobre `origin/main` actualizado, incorporando la revisión pendiente #47. No integra código a producción ni migra datos. No cambia reglas ni índices de Firestore ni agrega dependencias.

## Circuito implementado

1. `NaturalVoiceConversation` pide un único micrófono autorizado. MediaRecorder conserva el turno como respaldo y el VAD existente sigue detectando voz. `LiveTranscription` reutiliza una pista clonada del mismo stream para WebRTC; no abre otro micrófono.
2. El servidor autentica con `oliviaSession`, verifica propiedad/login/permisos de la conversación y el alcance de la prueba de voz. Intercambia SDP con `/v1/realtime/calls`, configurando una sesión de tipo `transcription`, modelo `gpt-live-transcribe`, idioma `es`, delay `low` y `turn_detection: null`. La clave de OpenAI nunca llega al navegador.
3. El VAD conserva 1900 ms de silencio base y amplía a 3–4 segundos cuando se reanuda una pausa o el parcial termina con una preposición/conjunción. No acorta automáticamente un «hola» que podría continuar con una consulta.
4. Los deltas solo preparan candidatos. El commit explícito de cada turno habilita una transcripción final. Se concilia por `item_id` y se entregan los turnos en orden cronológico aunque sus finales lleguen fuera de orden. Un parcial tardío de un turno ya comprometido no reemplaza al turno siguiente.
5. Un saludo inequívoco puede reproducir un clip local y persiste el turno mediante una ruta determinística del motor, sin llamar a Luna. «Hola, revisame ventas» mantiene toda la solicitud. El audio principal del saludo no se reproduce por segunda vez si ya se usó el clip.
6. Para consultas, `FastSpeechRouter` (`fastSpeechRoute`) se inicia después del acuse de creación del trabajo, en paralelo con el motor principal. Usa `gpt-6-luna`, `reasoning.effort: none`, salida estructurada y ninguna herramienta. Los candidatos salen de hechos del servidor: trabajo activo, consultas de herramientas iniciadas, tarea y campos faltantes, ubicación disponible, confirmación pendiente y clips recientes. El backend valida la elección y vuelve a leer el trabajo para descartar carreras con una respuesta lista o una instrucción que lo haya reemplazado.
7. `FastSpeechPlayer` reproduce como máximo una intervención intermedia por solicitud. La selección tiene un presupuesto corto: si no llega a tiempo, puede usar una espera genérica elegible. Nunca espera este circuito para iniciar o terminar la respuesta principal. La personalización breve está limitada a plantillas verificables; los resultados y respuestas abiertas siguen a cargo del motor empresarial.
8. Barge-in, cancelación y respuesta principal invalidan la intervención intermedia. La salida PCM usa una ganancia de desvanecimiento de 35 ms. Silenciar deshabilita tanto la pista original como el envío clonado y limpia el buffer no comprometido. Minimizar no cierra estos recursos. Terminar sí los libera.

Si Live no conecta, falla, excede su ventana o no entrega un final, se conserva el turno y se usa la transcripción de archivo existente (`gpt-transcribe`). El aviso informa este cambio. No se ejecuta una segunda consulta comercial ni se reproduce un parcial.

## Biblioteca y autorización pendiente

`src/shared/oliviaSpeechLibrary.json` conserva los 90 clips y 10 templates recibidos. Las expresiones `eligibility` son datos: nunca se evalúan como código. La voz y speaking rate se toman de la configuración real; no se cambia Chirp ni el modelo principal de Olivia.

El generador `scripts/build-olivia-speech-library.mjs` calcula el costo sin llamadas de pago, crea manifiestos versionados y permite reanudar un lote verificando texto, voz y SHA-256 de los bytes antes de reutilizarlos. Incluye ID, texto, voz, idioma del texto, locale real de voz, PCM 16 bits/24 kHz, duración y checksum. Las duraciones/checksums de audio permanecen nulas mientras no existe un archivo.

Plan preparado para `es-US-Chirp3-HD-Aoede`, rate 1, manteniendo el locale `es-US` de la voz actual y frases en español argentino:

- 90 clips; 2699 caracteres.
- Tarifa de referencia: USD 30 por millón de caracteres.
- Lote genérico estimado: **USD 0,08097**, sin restar cuota gratuita y antes de impuestos, almacenamiento o transferencia.
- Diez variantes para un nombre de N caracteres: `184 + 10 × N` caracteres. Con N=8, USD 0,00792 si eventualmente se generan las diez; no se generan juntas.
- Hash del plan: `67ada6893c140142f7be305daa916da27cf43363a1d5f58e7f5bd600765d3904`.

Ejecutado solamente el cálculo:

```powershell
node scripts/build-olivia-speech-library.mjs
```

Después de autorización explícita de este lote y con las credenciales Google del entorno previsto verificadas, el comando preparado es:

```powershell
node scripts/build-olivia-speech-library.mjs --execute --approve-plan=67ada6893c140142f7be305daa916da27cf43363a1d5f58e7f5bd600765d3904
```

`--config=ruta.json` admite una exportación con `naturalVoice` para generar exactamente otra configuración autorizada; cambia el hash de aprobación. No se ejecutó `--execute`, no se generó audio con Google y el manifiesto público continúa con 90 entradas `pending-authorization`. La preview actual conserva el acuse dinámico anterior como alternativa mientras no estén autorizados/publicados los clips. No se promete el tiempo de un clip precargado cuando el archivo todavía no existe.

## Caché y privacidad

- Se precargan tres clips genéricos frecuentes; se comprueba opcionalmente si ya existe el saludo privado, sin sintetizar durante esa comprobación. Los demás clips se cargan bajo demanda y se valida su checksum.
- La caché local es memoria de la sesión, máximo ocho entradas, aislada por instancia/usuario y versión de voz. Se vacía al finalizar, desconectar o desmontar; no persiste nombres, transcripciones ni credenciales en localStorage.
- Las variantes usan el nombre del perfil autenticado y admiten `oliviaUseName: false`. No aceptan un nombre ni UID enviados por el navegador. El servidor guarda audio privado bajo usuario, versión de voz y hash del texto/nombre, con lease para evitar síntesis concurrente. Si no está listo se oye la opción genérica inmediatamente y se prepara solo la variante pertinente.
- `oliviaPrivateSpeech` está protegido por la denegación general de las reglas existentes; solo se entrega desde el endpoint autenticado, sin caché HTTP compartida. El job de retención elimina variantes vencidas. La cuota de caracteres y el registro de costo de Chirp se conservan.
- No se almacenan parciales ni audio del usuario. Las transcripciones finales siguen el historial y la retención empresarial existentes. SDP y credenciales temporales de transporte quedan solo en registros backend protegidos; no se registran en logs ni en este repositorio.

## Límites y costos de Live

La prueba sigue restringida a la cuenta administrativa habilitada. Cada conexión Live dura hasta 180 segundos en el cliente. El servidor conserva el `callId` y su lease, admite cierre autenticado y utiliza el cleanup ya programado cada minuto para colgar conexiones vencidas. Se reserva una ventana conservadora de 240 segundos por inicio y 18000 segundos mensuales reservados por usuario de la prueba. Una sesión activa impide abrir otra simultánea. La reproducción y el dictado por turnos pueden continuar cuando finaliza el tramo Live.

Precio Live de referencia: USD 0,017/minuto. El registro de sesión separa reserva y duración estimada; no presenta uso facturado como confirmado si el proveedor no lo confirmó. Los turnos tienen costo estimado asignado, marcado `costIncludedInSession`, para no duplicar el costo agregado. Luna registra uso del proveedor y estimación con USD 0,10/M de entrada y 0,50/M de salida. Los costos dinámicos de Chirp y el plan de generación son independientes.

## Validación

- `npm run build:gestion`: correcto (continúa el aviso previo de chunks grandes). `npm test`: **994/994**. Pruebas focalizadas de Olivia: **326/326**. Importación de las tres nuevas Functions correcta. Generación paga ejecutada: **0 clips**.
- Pruebas focalizadas y suite general cubren biblioteca, elegibilidad contextual, saludo combinado, stock sin/reutilizando ubicación, selección sin herramientas, respuestas falsas, carreras con la respuesta principal, privacidad y nombre autenticado, caché/checksum, autorización y reanudación del lote, orden de finales, fallos Live, pausas, mute y liberación del micrófono, retención privada y límites de sesión.
- QA local de navegador con datos, red OpenAI y PCM simulados: saludo final «Hola» con **0 llamadas al selector, 0 a transcripción de archivo, 0 a TTS genérico y 3 clips cargados**. La comprobación/preparación privada es simulada. No contacta a Google ni OpenAI.
- Una muestra sintética de saludo: silencio 1906 ms, detección a final 32 ms, primera intervención 33 ms desde el turno confirmado.
- Una muestra sintética de «Hola, revisame ventas. Consulta lenta»: silencio 1909 ms, detección a final 31 ms, clip disponible 123 ms desde selección, primera intervención 157 ms desde el turno confirmado. El procesamiento principal demoró 25 segundos; siguió con el panel minimizado en Productos.
- El modo desarrollador muestra P50/P90/P95 y cantidad de muestras de la sesión para silencio, transcripción, selección, disponibilidad del clip y primera intervención. «Fin de voz» es la aproximación del umbral acústico local; «primer audio» es el primer bloque programado, no el inicio físico del altavoz. Con una sola muestra los percentiles coinciden; estas muestras no son una medición de latencia real ni una comparación estadística con los ~3 s percibidos por el usuario.
- También se verifica fallback de Live con aviso y continuidad por turnos, conservación de borrador, minimizar/reabrir y separación de los estados del orb. Capturas y lectura de métricas en `evidence/`.

Falta probar proveedores reales, disponibilidad de `gpt-live-transcribe` en la cuenta, acento/ruido, micrófono físico y Safari/iPhone/Android. Se conserva detección MediaRecorder/mp4 y WebKit AudioContext. La continuidad está limitada por permisos y suspensión del navegador. Antes de cualquier prueba remota con escrituras hay que verificar frontend, Functions, Authentication, Firestore y cuenta de servicio de `app-integral-fm-pruebas`; esta revisión usa fixtures locales y comprobaciones remotas de lectura.

## Fuentes verificadas el 29 de octubre de 2026

- [OpenAI Docs: Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)
- [OpenAI Docs: WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=realtime)
- [OpenAI: creación de llamadas](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/create)
- [OpenAI: GPT Live Transcribe y precio](https://developers.openai.com/api/docs/models/gpt-live-transcribe)
- [OpenAI: GPT-6 Luna, NONE y precio](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [Google Cloud: precio de Chirp 3 HD](https://cloud.google.com/text-to-speech/pricing)
