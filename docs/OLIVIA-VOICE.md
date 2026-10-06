# Dictado y conversación

El micrófono del composer inicia dictado, separado de Conversar con Olivia. `DictationCapture` utiliza MediaRecorder, AudioContext y AnalyserNode para barras reales de volumen sin transmitir audio mientras las dibuja. Cancela y libera tracks, timers y contexto incluso si el permiso llega tarde.

Cancelar descarta; STOP transcribe y deja texto editable; SEND transcribe y envía como mensaje normal. El backend valida tamaño/duración configurables, utiliza español y vocabulario contextual y contabiliza consumo. El audio no se almacena permanentemente. Se selecciona un MIME soportado por MediaRecorder y se informa cuando el navegador no admite captura.

## Conversación predeterminada: GPT-Live

El backend crea `/v1/live/sessions` con delegación cliente y WebRTC; la clave queda privada. El navegador espera ICE completo y `session.started`. Un sideband de servidor acumula transcripciones, resuelve delegaciones mediante `engine.chat` y conserva conversationId, tarea, Skills, permisos y tarjetas compartidos con texto.

Luna HIGH es el backend habitual y XHIGH el complejo. Sol se usa solo para creatividad autorizada. Live conversa y habla un resumen backend; no decide permisos ni confirma. El browser solo puede silenciar/reactivar entrada y cerrar sesión. Interrupción y contexto verificado se manejan en servidor. La tarjeta permite correcciones orales sin que un sí oral ejecute.

La duración se liquida con `session.closed`. Se conserva transporte hasta finalización o timeout; un corte previo registra costo desconocido. La sesión dura como máximo tres minutos; los tokens de razonamiento se registran aparte. Las transcripciones simples no necesitan una llamada a Luna. [Arquitectura, fuentes y contabilidad](OLIVIA-MODEL-ROUTER.md).

## Protocolo anterior, opción administrativa explícita

La configuración puede seleccionar `voiceProtocol=realtime`; no se activa como fallback automático. En esta opción, la conversación usa WebRTC y el endpoint server-side `/v1/realtime/calls`. El backend intercambia SDP y retiene el call ID; ninguna clave reutilizable llega al cliente. Las sesiones conservan duración máxima de 180 segundos, control de concurrencia/reservas, monitor de consumo e interrupción remota.

El modo nativo ejecuta herramientas backend autorizadas sin una segunda llamada Responses. El backend revalida perfil, sesión, esquema y límite de 20 herramientas, y deduplica call IDs. Los argumentos nunca confirman escrituras. La transcripción real identifica cada entrada, y la respuesta hablada se persiste una vez; una sesión cerrada admite hasta 60 segundos de gracia exclusivamente para guardar transcripciones ya encoladas.

Mute deshabilita el track sin cerrar la conexión. Olivia puede seguir hablando y el usuario puede escribir. Texto y respuesta verificada se agregan al contexto Realtime; al reactivar se usa la misma sesión. Interrumpir cancela respuesta y limpia el buffer de audio. Finalizar/reconectar libera recursos y conserva el chat.

Cuando una herramienta comienza, una frase predefinida local aporta feedback mediante SpeechSynthesis cuando está disponible, con subtítulo como respaldo. No llama al modelo para generar el ACK. Las propuestas visuales silencian la entrada hasta que se resuelven.

Se manejan llamadas que llegan antes del ASR, respuestas canceladas, fallos recuperables y cierre durante persistencia. Las métricas no confunden el inicio del buffer de audio con el sonido físico del altavoz. Safari necesita una interacción del usuario para iniciar AudioContext/reproducción; los errores permiten continuar por texto.
