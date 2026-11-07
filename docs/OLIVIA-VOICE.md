# Voz natural de Olivia

La revisión V5 usa Gemini Live para conversar por voz en español argentino con Aoede. Los saludos y la charla breve reciben respuesta directa de Gemini Live. Las preguntas de negocio pasan por `delegate_to_olivia`: el backend autentica la sesión, revisa permisos y consulta el motor existente; el resultado vuelve a Gemini Live para expresarlo en voz y queda visible en el chat.

El chat escrito no solicita el micrófono. El dictado revisable continúa separado. La conversación natural mantiene audio PCM en streaming, VAD y detección de interrupciones. Las operaciones comerciales siguen requiriendo confirmación visual y validación del backend.

## Voz y disponibilidad

La disponibilidad requiere Gemini Live habilitado en el Deploy Preview, una sesión efímera del backend y el acceso de prueba permitido por Olivia. La credencial permanente de Gemini se configura solo en Functions; el navegador recibe el token efímero. La configuración Firebase del preview debe apuntar a `app-integral-fm-pruebas` para cliente, Functions, Authentication y Firestore antes de realizar cualquier prueba que escriba datos.

No hay integración de Google Cloud Text-to-Speech, voz Chirp, endpoint de síntesis, voces pregrabadas ni fallback de audio. Si Gemini Live no está habilitado, falla o devuelve texto sin audio, Olivia muestra el resultado disponible y solicita reconectar. No cambia automáticamente a otro sintetizador.

## Mediciones

Las trazas separan conexión, transcripción, clasificación, primer paquete de audio y primer audio programado. Los milisegundos entre envío de texto y PCM programado no representan latencia de micrófono a respuesta ni confirman que se oyó por el altavoz. Para validar experiencia física hacen falta micrófono, dispositivo de salida y escucha real.

El costo de voz se registra según los metadatos de uso recibidos de Gemini Live. Si el proveedor no entrega una medición completa, se marca como no confirmada; una estimación de audio no incluye todo el contexto acumulado y no debe tomarse como factura. Los límites mensuales y por sesión se aplican en Functions.

## Revisión de Deploy Preview

Usar conversaciones ficticias y solo el proyecto aislado de pruebas. Comprobar: saludo breve, charla social, cambio de tema, contexto de seguimiento y consulta de negocio que se delega. Confirmar que la respuesta corta tenga audio de Gemini Live; que la consulta comercial use el resultado del motor autorizado; y que una desconexión no active síntesis alternativa. No emitir comprobantes, enviar mensajes ni alterar stock durante la revisión.

La arquitectura está en [OLIVIA-ARCHITECTURE.md](OLIVIA-ARCHITECTURE.md); los controles y límites del despliegue están en [FIREBASE-PRUEBAS.md](FIREBASE-PRUEBAS.md).
