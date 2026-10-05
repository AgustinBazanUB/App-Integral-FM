# Arquitectura de Olivia

La evolución deriva de PR 31, commit `12447682e2a24afd4b847f4a96af50b7d6363ac5`, en `codex/olivia-evolution`. No cambia producción.

El montaje autenticado conserva la carga diferida y la barrera de errores. `OliviaAssistant` coordina conversación, cancelación e historial; `OliviaComposer` agrupa escritura, adjuntos y dictado; `OliviaVoiceControls` presenta mute/interrupción/finalización; `OliviaUsage` presenta cuotas/costos; `DictationCapture` administra recursos de audio; `OliviaRealtime` administra WebRTC; `OliviaDeveloperPanel` presenta observabilidad; `OliviaKnowledgeManager` gestiona publicaciones administrativas.

Texto → endpoint `olivia` → sesión Firebase y perfil vigente → engine → Responses → herramientas explícitas → servicios/planes de dominio → respuesta SSE. Realtime → función backend autorizada → resultado → audio, sin volver a pasar por Responses.

El backend separa provider, guards, tools, capabilities, toolExecution, extendedTools, operations, extendedOperations, analytics, knowledge, skills, attachments, requestBody, voice, usage, conversations y store. La confirmación ejecutora es un endpoint de aplicación, no una herramienta del modelo.

Los planes compartidos `stockTransferWritePlans`, `productWritePlans` y `managementWritePlans`, junto con los planes comerciales previos, permiten usar las mismas validaciones que los formularios manuales. Las propuestas conservan una huella de lecturas; la transacción vuelve a leer permisos y datos antes de escribir.

Las lecturas consecutivas independientes usan lotes de tres. Preparaciones y navegación forman barreras. Una consulta escrita admite hasta ocho rondas, doce herramientas y 45 segundos; la última ronda no ofrece herramientas. Cada llamada al proveedor tiene un límite de 20 segundos.

SSE informa aceptación, fases, deltas y resultado terminal. El cliente valida tramas, UTF-8 y finalización; cancelar corta el lector y el proveedor. Los reintentos conservan la identidad y recuperan el estado si el resultado es incierto.

El cache conserva 40 mensajes; el contexto del modelo usa 16, memoria extractiva acotada, borrador y versiones de Skills activas para seguimientos. El archivo paginado conserva la conversación completa durante su retención. Usuario, autenticación y alcance de permisos impiden reutilizar contexto después de cambios de autoridad. Chats previos sin alcance registrado requieren evidencia de rol compatible antes de recuperar contexto para un vendedor.

Las métricas de desarrollo distinguen render de mensaje, despacho, primer delta, finalización, retrieval, proveedor, herramientas, llamadas, documentos y Skills. En voz miden fin de habla a transcripción, transcripción a herramienta, herramienta a respuesta y respuesta a inicio del buffer de audio; no miden la salida física del altavoz.
