# Dictado y conversación

El micrófono del composer inicia dictado, separado de Conversar con Olivia. `DictationCapture` utiliza MediaRecorder, AudioContext y AnalyserNode para barras reales de volumen sin transmitir audio mientras las dibuja. Cancela y libera tracks, timers y contexto incluso si el permiso llega tarde.

Cancelar descarta; STOP transcribe y deja texto editable; SEND transcribe y envía como mensaje normal. El backend valida tamaño/duración configurables, utiliza español y vocabulario contextual y contabiliza consumo. El audio no se almacena permanentemente. Se selecciona un MIME soportado por MediaRecorder y se informa cuando el navegador no admite captura.

La conversación usa WebRTC y el endpoint server-side `/v1/realtime/calls`. El backend intercambia SDP y retiene el call ID; ninguna clave reutilizable llega al cliente. Las sesiones conservan duración máxima de 180 segundos, control de concurrencia/reservas, monitor de consumo e interrupción remota.

El modo nativo ejecuta herramientas backend autorizadas sin una segunda llamada Responses. El backend revalida perfil, sesión, esquema y límite de 20 herramientas, y deduplica call IDs. Los argumentos nunca confirman escrituras. La transcripción real identifica cada entrada, y la respuesta hablada se persiste una vez; una sesión cerrada admite hasta 60 segundos de gracia exclusivamente para guardar transcripciones ya encoladas.

Mute deshabilita el track sin cerrar la conexión. Olivia puede seguir hablando y el usuario puede escribir. Texto y respuesta verificada se agregan al contexto Realtime; al reactivar se usa la misma sesión. Interrumpir cancela respuesta y limpia el buffer de audio. Finalizar/reconectar libera recursos y conserva el chat.

Cuando una herramienta comienza, una frase predefinida local aporta feedback mediante SpeechSynthesis cuando está disponible, con subtítulo como respaldo. No llama al modelo para generar el ACK. Las propuestas visuales silencian la entrada hasta que se resuelven.

Se manejan llamadas que llegan antes del ASR, respuestas canceladas, fallos recuperables y cierre durante persistencia. Las métricas no confunden el inicio del buffer de audio con el sonido físico del altavoz. Safari necesita una interacción del usuario para iniciar AudioContext/reproducción; los errores permiten continuar por texto.
