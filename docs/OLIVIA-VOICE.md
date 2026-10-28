# Voz natural de Olivia

## Modalidades

La conversación escrita sigue disponible. **Conversar por voz** usa una sola ruta: micrófono/VAD en el navegador → GPT Transcribe (`gpt-transcribe`) al cerrar cada turno → motor Luna y herramientas autorizadas de Olivia → respuesta escrita canónica y resumen hablado → Google Cloud Text-to-Speech Chirp 3 HD transmitido como PCM. El dictado revisable sigue usando su control independiente y deja la transcripción editable antes de enviarla.

GPT-Live, Realtime y la prueba de voz económica se retiraron como modalidades de conversación. El endpoint `olivia` responde HTTP 410 a las operaciones antiguas. No existe fallback automático a otro proveedor. La conversación nueva queda limitada a `agsreserva@gmail.com` mientras esté en prueba administrativa; se requieren Olivia, OpenAI y Google TTS habilitados en el servidor.

## Flujo y datos

- `NaturalVoiceConversation` solicita el micrófono solo después del clic del usuario, con cancelación de eco, supresión de ruido y control automático de ganancia. Detecta la voz localmente, corta el turno tras 350 ms de silencio y limita cada grabación a 60 s/4 MB.
- Cada turno completo se envía como archivo a `gpt-transcribe`, junto a `language=es`, contexto de Flor Mía y sugerencias de términos. Las sugerencias son pistas, no obligan al modelo a incluir palabras no escuchadas. GPT Transcribe trabaja con audio completo; transmitir los bytes de Chirp sí es streaming, no una transcripción continua.
- El audio de entrada vive en memoria del navegador y se descarta tras procesar el turno. La transcripción del usuario y las respuestas de Olivia se conservan en el historial normal. No se guarda audio sintetizado ni texto de TTS en el registro de medición.
- El motor de Olivia usa la misma política Luna HIGH/XHIGH, permisos, herramientas de solo lectura y tarjetas de confirmación que el chat escrito. Ninguna confirmación oral ejecuta una acción. La respuesta escrita es canónica; el modelo puede preparar una versión breve para voz.
- Chirp 3 HD se invoca solo después de persistir la respuesta. El endpoint autenticado valida identidad, propiedad de conversación, límites y cuota mensual, y transmite PCM mono de 24 kHz. Cortar el audio cancela el lector local y el stream proveedor. Hablar durante la reproducción interrumpe el audio y cancela la solicitud anterior antes del siguiente turno.
- La interfaz mide fin de habla a transcripción, transcripción a primer bloque de audio programado, y TTFA de síntesis. Mediana y P95 usan hasta 100 muestras de la sesión abierta. TTFA indica cuándo el navegador programó la reproducción, no cuándo el sonido llegó físicamente al altavoz.

## Configuración backend

1. En un proyecto de Google Cloud habilitá Cloud Text-to-Speech y la facturación. La síntesis bidireccional está en Preview y solo admite Chirp 3 HD; verificá su disponibilidad y condiciones antes de habilitar tráfico.
2. Configurá ADC o una identidad de servicio con privilegios mínimos. En Netlify usá secretos de entorno del servidor: `GOOGLE_APPLICATION_CREDENTIALS_JSON` (JSON de cuenta de servicio), `GOOGLE_CLOUD_PROJECT` y el `OPENAI_API_KEY` existente. También puede usarse `GOOGLE_APPLICATION_CREDENTIALS` cuando el runtime tiene acceso al archivo ADC. No agregues estas variables al frontend ni las guardes en Firestore.
3. En Olivia, habilitá “Conversación natural por voz”, elegí Aoede o Charon, ajustá velocidad/silencio y límites, revisá el resumen y confirmá el cambio auditado. El dictado se mantiene separado.

Cloud TTS admite ADC en sus librerías; las cuentas de servicio requieren permisos IAM de síntesis según la configuración vigente del proyecto. Si el proyecto de cuota lo requiere, Google documenta `roles/serviceusage.serviceUsageConsumer`. [Autenticación de Cloud TTS](https://docs.cloud.google.com/text-to-speech/docs/authentication).

## Costos y límites

El registro mide duración de entrada cuando el navegador la proporciona y caracteres solicitados a Chirp; no persiste contenido. Los valores publicados actualmente son USD 0,0045/minuto para GPT Transcribe y USD 30 por millón de caracteres para Chirp 3 HD. Son referencias de tarifas del proveedor y el costo final puede variar con promociones, cuota gratuita, impuestos y conversión. [Tarifa de GPT Transcribe](https://developers.openai.com/api/docs/models/gpt-transcribe) · [Tarifa de Cloud TTS](https://cloud.google.com/text-to-speech/pricing).

Netlify documenta un tope de 60 segundos y 20 MB para funciones con respuesta streaming. La configuración limita el texto por turno y la cuota mensual para contener consumo. Los errores de transcripción ofrecen reintento; los errores de síntesis conservan la respuesta escrita y permiten reintentar el audio.

## Validación pendiente para uso real

Sin secretos de proveedores, el backend cloud no puede confirmar una respuesta real de Chirp ni su precio final. La aceptación de audio, el comportamiento de barge-in, voces, ruido y reproducción deben verificarse con micrófono/altavoz en Chrome y Safari/iPhone antes de habilitar usuarios adicionales. La respuesta de la API confirma que el backend recibió el stream; no prueba la salida física del dispositivo.
