# Verificación

Base PR31: 634 pruebas Node aprobadas antes de cambios. La evolución agrega pruebas de transporte SSE, dictado real mediante dependencias controladas, adjuntos y límites, RAG, Skills, permisos, métricas, pronóstico y operaciones.

Comandos:

- `npm test`: regresión completa, sin operaciones comerciales reales.
- `npm run build`: aplicación unificada.
- `npm run build:surfaces`: Gestión y Ecommerce.
- Emulador Firestore: ejecutar `firestore.olivia.rules.mjs`, `firestore.operations.rules.mjs`, `firestore.quick-sales.rules.mjs` y `firestore.crm-finance.rules.mjs` con proyecto demo.

La máquina dispone de Java 17; se utilizó Firebase CLI 13.35.1 para el emulador. La CLI instalada más reciente requiere Java 21. Esta elección afecta solo el ejecutor de pruebas.

La suite cubre tramas UTF-8 divididas, cancelación/error/finalización, mensaje aceptado e historial sin duplicados, MIME y firmas de ocho formatos, expansión comprimida, propiedad/expiración/hashes, STOP/SEND/cancelación/limpieza, voz antes/después de ASR, mute/interrupción/reconexión/contexto escrito, herramientas y permisos, conocimiento retirado, SKILLs, +20%, insuficiencia, stock real, transferencia física, doble confirmación, cancelación, concurrencia y auditoría.

Los fixtures inyectan proveedor y store únicamente en pruebas. La implementación usa Responses/Realtime, Files/vector stores y Firestore reales; no reemplaza servicios por fixtures en producción.

La preview requiere Firebase login para la revisión interactiva privada. No se usan ventas reales como pruebas ni se elude la autenticación. Revisar también viewport desktop, Android/iPhone, teclado móvil, focus, adjuntos, waveform y conversación desde un dispositivo con micrófono.

La matriz final registra evidencia y límites externos observados. Una compilación aprobada no sustituye pruebas funcionales ni demuestra por sí sola audio físico en iPhone/Android.

## Resultado del 5 de octubre de 2026

- `npm test`: 695 aprobadas, 0 fallos, 0 omitidas; 634 en la base y 61 añadidas.
- Emulador Firestore: 19 aprobadas, 0 fallos, proyecto demo. Se usó puerto 8093 en la ejecución final porque 8087 estaba ocupado; no se detuvieron procesos ajenos.
- `npm run build`: aprobado.
- `npm run build:surfaces`: Gestión y Ecommerce aprobadas. Vite mantiene advertencia de chunks mayores de 500 kB; no es un fallo del build.
- Navegador local con componentes y CSS reales: 1280×900, 390×844 y 360×400; textarea multilínea, Enter/Shift+Enter, envío inmediato/estado/cancelación, mute y escritura, selector múltiple TXT/PNG, chips, eliminación y retorno de foco. Las dimensiones son simulaciones responsive, no dispositivos físicos.
- Preview privada: carga/login Firebase verificados; sin sesión humana proporcionada no se verificaron consultas ni mutaciones contra datos empresariales. La preview utiliza el proyecto Firebase configurado y no constituye una base comercial aislada.
- Voz física/proveedor en Android/iPhone: no verificada en esta sesión. MediaRecorder, AnalyserNode, WebRTC, mute, interrupción, fallos, reconexión y orden de eventos se verificaron con dependencias controladas; no se presenta esa evidencia como una llamada real al proveedor.

[Matriz requisito → implementación → prueba](OLIVIA-REQUIREMENTS.md). [Auditoría de la base](OLIVIA-AUDIT.md).
