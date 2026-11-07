# Olivia V5: conversación nativa y tareas independientes

Implementación sobre `codex/olivia-ultra-fluida-v5`, desde `4e514881bfc1372bc644ed120254c2818d060480`. PR 56 permanece draft. Preview: https://deploy-preview-56--appintegralflormia.netlify.app/gestion/settings. No se autoriza producción ni migración de datos.

## Diagnóstico reproducido

- El clasificador anterior delegaba «Perfecto, muchas gracias», «¿Me escuchás bien?», «¿Te puedo pedir algo?» y «No, dejá» sin contexto operativo. Se reprodujo importando la función del HEAD inicial. La coincidencia exacta excluía charla válida.
- `onToolCall` esperaba `perform`, que bloqueaba con `requestRef` una única consulta y el sondeo completo del trabajo. La conversación y el estado del trabajo compartían ese bloqueo.
- `finishTurn` esperaba registrar consumo antes de completar su estado visible. Una demora de contabilidad podía prolongar la indicación de procesamiento.
- Los tiempos de audio/consumo usaban referencias del último turno. Una respuesta tardía podía asignarse a otro turno. Un acuse también podía ocupar la marca de primera respuesta definitiva.

No se atribuyen estas causas a la latencia de un proveedor sin medición. El intento acústico de base de esta revisión fue contaminado por voces ambientales y se excluye. Los siete estímulos del informe anterior sobre `91eaeaa` son evidencia histórica aproximada, no una base comparable para porcentajes de mejora.

## Implementación

Gemini Live conserva el diálogo general y la comprensión contextual. Una política local reconoce límites comerciales y controles con tarea pendiente; no realiza una llamada extra de clasificación. Las intervenciones sociales se devuelven a Gemini sin llamar a Luna. Los fragmentos ambiguos sin contexto operativo piden aclaración en Gemini: una llamada de herramienta del modelo no basta para convertirlos en trabajos. Con una tarea que recopila datos, las respuestas elípticas se derivan a su contexto autenticado. La autenticación, permisos, datos actuales y confirmación de mutaciones siguen siendo responsabilidad del motor existente.

`delegate_to_olivia` usa `NON_BLOCKING`. Las aceptaciones son respuestas `SILENT` con `willContinue`; los resultados verificados se notifican `WHEN_IDLE`. El ingreso de otra voz detiene el audio, conserva el trabajo aceptado y espera a que termine el turno antes de notificar. Se deduplican resultados por llamada, intento y estado. Al reconectar se observan las tareas pendientes: si ya no existe una llamada válida en esa sesión, se comunica un evento interno con el resultado del servidor. Ese evento es una notificación, no una prueba de entrada acústica.

Las tareas persisten bajo `oliviaConversations/{parent}/delegatedTasks/{id}` y tienen un ámbito interno del mismo motor y la misma cola `oliviaChatJobs`. Se aíslan slots, confirmaciones y leases. No se duplican integraciones de OpenAI ni herramientas comerciales. Los ámbitos internos se ocultan de la lista de chats.

Límites: tres ejecuciones por conversación, veinte tareas y veinte intentos por tarea. Hay prioridades, dependencias solo sobre tareas anteriores propias, identificadores idempotentes y recuperación de un despacho con lease vencido. El límite compartido de admisión de 1,2 s se conserva: el worker reintenta únicamente ese rechazo previo a reservar/ejecutar, hasta tres intentos. No se reintenta automáticamente una operación comercial fallida. Una dependencia fallida o cancelada impide despachar sus sucesoras.

Las modificaciones requieren la tarjeta visual y la validación transaccional original. Un sí hablado no ejecuta operaciones. Dos propuestas sobre el mismo stock pueden coexistir, pero la segunda se rechaza si su versión quedó desactualizada; debe prepararse de nuevo. Cancelar no revierte una operación finalizada. Confirmación y cancelación se excluyen mediante estado de control persistente. Las tareas, sus mensajes y confirmaciones siguen la retención; el padre no se elimina dejando tareas huérfanas.

La interfaz muestra las tareas aparte de escuchar/procesar/hablar. El registro de consumo deja de bloquear el fin de respuesta. Las trazas conservan turno, sesión, solicitud, tarea, trabajo y turno de origen; los acuses y los resultados tienen marcas de audio distintas. Los tiempos del navegador describen audio programado, no emisión física verificada. Los relojes de servidor y navegador se exportan separados.

## Parámetros y alternativas

Se conserva `gemini-3.8-live`, Aoede, PCM de entrada 16 kHz, salida 24 kHz, VAD y ventanas de endpointing anteriores. No se ajustaron buffers ni silencios sin una comparación acústica válida. El modelo Live elegido no admite `thinking_level`; no se agrega ese parámetro. Se conserva la integración existente de GPT-6 Luna y sus perfiles NONE/MEDIUM, sin crear otra API.

Referencias primarias consultadas el 7/11/2026:

- [Google: herramientas Live](https://ai.google.dev/gemini-api/docs/live-api/tools): llamadas no bloqueantes y programación de respuestas. [SDK JS](https://github.com/googleapis/js-genai/blob/main/src/types.ts): `willContinue` en Gemini Developer API; no asumir el mismo contrato de Vertex.
- [Google: razonamiento Live](https://ai.google.dev/gemini-api/docs/live-api/thinking): restricciones del modelo y distinción de la variante de razonamiento extendido.
- [Pipecat: herramienta asíncrona Gemini](https://github.com/pipecat-ai/pipecat/blob/main/examples/realtime/realtime-gemini-live-async-tool.py): referencia para conservar trabajo durante interrupciones y entregar el resultado más tarde. Sus [releases](https://github.com/pipecat-ai/pipecat/releases) muestran soporte actual de Gemini 3.8 y requisitos de SDK Python. Adoptarlo completo requeriría un proceso Python y otro transporte; no es necesario para corregir estos bloqueos en React/Netlify.
- [LiveKit Agents](https://github.com/livekit/agents) y [turnos/interrupciones](https://docs.livekit.io/agents/logic/turns/): útiles para sesiones de voz y control del audio. Requerirían introducir servidor de agentes y transporte de medios. No hay medición que justifique ese costo operativo en esta revisión.
- [Async Deep Agents](https://github.com/langchain-ai/async-deep-agents): arquitectura de referencia para lanzar, consultar, actualizar y cancelar trabajos con estado independiente; depende de LangSmith Deployments/LangGraph. Se reutiliza el patrón, conservando la cola autenticada actual.
- [LiteLLM](https://github.com/BerriAI/litellm): proxy y normalización multiproveedor. No resuelve por sí solo VAD, turnos o el bloqueo local; agregaría un servicio intermedio en una aplicación con dos integraciones existentes. No se instaló.
- [OpenAI: GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) y [Background](https://developers.openai.com/api/docs/guides/background): la cola propia existente evita una segunda integración para esta ejecución asíncrona.

Los cuatro repositorios tienen material mantenido y pertinente, pero no se certifica compatibilidad de instalación porque no se incorporaron. No se atribuyen ahorros o costos adicionales numéricos sin una configuración desplegada y medida.

## Validación y límites de aprobación

Validación local final: 1.116 tests unitarios/de integración aprobados y build Vite aprobado; advertencia existente de tamaño de chunks. Tres pruebas de reglas aprobadas con Java 21 portátil y Firestore Emulator en puerto 8187, proyecto `demo-flor-mia-olivia`; el puerto 8080 estaba ocupado y no se detuvo su proceso. No se cambiaron reglas ni índices remotos. Pruebas nuevas cubren conversación contextual, trabajo no bloqueante, notificación deduplicada, errores síncronos, contabilidad lenta, correlación de acuse/resultado, recuperación, autenticación, idempotencia, dependencias, cancelación contra despacho y antes de claim del worker, stock concurrente y retención.

Piloto físico sobre `c48fb3c`: el saludo fue transcrito como «Hola, Bolivia. ¿Cómo estás?» y Gemini respondió directamente. Vosk sobre WASAPI loopback ubicó la última palabra del estímulo en 4,44 s y la primera de la respuesta en 7,35 s: intervalo aproximado 2,91 s. El ambiente abrió turnos ajenos y el primer audio llegó antes del cierre VAD local; por eso no se lo usa como TTFA de navegador ni en una distribución comparable. La apertura de esa sesión fue 5.859 ms; token HTTP 3.763 ms y WebSocket/setup 1.297 ms, sin atribuir toda la espera HTTP a Google. Costo de sesión mostrado: USD 0,0094, incluyendo turnos ambientales y estimaciones. Se cerró el micrófono y la reserva quedó en cero.

El ruido produjo además una delegación de un fragmento ambiguo ajeno al guion. La política final devuelve ese caso a Gemini para pedir aclaración sin llamar a Luna; su regresión está cubierta localmente, y su verificación acústica final sigue pendiente. El conector de Chrome permitió trabajar sin operar el aviso de Windows Security de Java. No se cambió ningún permiso de red.

Esto no certifica latencia acústica ni operaciones iniciadas por voz. La batería obligatoria de 37 interacciones, las aperturas/cierres, los resultados funcionales por Olivia, costos medidos y comparación por ruta se registran como evidencia de ejecución separada. Mientras esa evidencia no esté completa, la fluidez y la integración funcional permanecen pendientes de aprobación.
