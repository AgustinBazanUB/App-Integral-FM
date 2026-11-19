# Implementación Olivia V6.2

Estado: candidata parcial en [PR 58 draft](https://github.com/AgustinBazanUB/App-Integral-FM/pull/58). [Deploy Preview](https://deploy-preview-58--appintegralflormia.netlify.app/gestion/settings). No aprobada para producción.

Se creó `codex/olivia-ux-natural-v6-2` desde `origin/main` actualizado `62bd617e8e452d25aa8fa5ff26bdee796d5ccf00` y se incorporó por fast-forward la V6 `400b4a0b4e90a5f9116fa8a2a65d7e5c7ac6716b`. Main era ancestro de V6. No se editaron los worktrees Payway, V5 o V6 ni se descartaron cambios ajenos.

## Cambios y causas demostradas

| Problema | Causa e impacto | Corrección | Verificación |
|---|---|---|---|
| Abrir parecía una inferencia | `state/resume` compartían busy, requestRef y bloqueo del compositor con chat | Hidratación con promesa/controlador propios; borrador inmediato, envío espera sesión; estimaciones solo para texto no vacío | 36 aperturas previas y 30 posteriores; desapareció el estado falso, objetivo 500 ms pendiente |
| Developer ocupaba la conversación | Preferencia persistida y diagnósticos en el flujo principal | Vista administrativa separada, imports lazy, menú superior, chat normal al abrir | Fixture admin/seller y preview real; exportación sanitizada conservada |
| Voz conectando bloqueaba otras entradas | Estado de conexión usado como bloqueo general; callbacks tardíos de sesiones cerradas | Escritura independiente, anillo CSS, cancelación de la conexión antes de dictado, protección de callbacks obsoletos | Fixture lento, error 503, cancelación y dictado; integración real parcial |
| Acuse fijo y delegación prematura | Respuesta breve rígida; motor recibía pedidos todavía incompletos | Gemini pregunta campos básicos; borrador no verificado; delegación cuando corresponde; acuse futuro contextual | Stock: ubicación y productos sin Luna; tarea posterior con validación real |
| Pregunta válida sin audio | Filtro rechazó «Tomado. ¿Qué productos…?» | Gramática admite ese acuse seguro | Regresión unitaria; pregunta audible en segundo intento real. Otras variantes siguen bloqueadas |
| Reaparecía el borrador delegado | ASR/historial tardío restauraba revisiones antiguas | Revisión monotónica y fusión que conserva estados terminales | Test de orden inverso y regresión real posterior |
| Pedido nuevo reemplazaba stock pendiente | Modelo propuso `continue` sobre otra tarea | Pedidos explícitos independientes fuerzan `new` sin taskId; mismo límite en fallback local | IDs separados para producto, cliente y transferencia en preview |
| Stock sin enviar contaminaba el alta de producto | Cambiar intención no invalidaba su borrador nativo | Estado `superseded`, revisión y reemplazo persistido en transacción al aceptar la nueva tarea | Estado Firebase inspeccionado; última regresión continuó producto en la misma tarea y pidió abreviación/precio |
| «No sé en qué local» se tomaba por ubicación | Extracción literal aceptaba la interrogación indirecta | No aceptar valores que empiezan qué/cuál/dónde | Test y preview: requestedLocation permanece null |
| Pregunta incompleta terminaba como completada | Falta de señal estructurada genérica y salida determinista con INFORMACION | `requiresInput` en respuesta de proveedor; camino determinista devuelve DATOS_INCOMPLETOS cuando conserva campos faltantes | Test genérico, test de alta sin proveedor y tarea real `needs-input` |
| Pausa pedía confirmar | Resultado con pendingAction precedía al estado paused | Prioridad a paused; sin invitación de confirmación mientras está pausada | Tests; ciclo real completo de pausa/reanudación V6.2 pendiente |
| Panel móvil salía del dispositivo | Ancho porcentual del viewport de layout expandido | Superficie móvil anclada a izquierda y `100dvw` | Build y revisión visual final en Chrome; ver REDISENO |

## Archivos y arquitectura

Frontend: `OliviaAssistant.jsx`, `OliviaComposer.jsx`, `OliviaVoiceControls.jsx`, `OliviaUsage.jsx`, `OliviaDelegatedTasks.jsx`, `interactionState.mjs`, `interactionCosts.mjs`, `delegatedTaskClient.mjs`, `geminiLive.mjs`, `olivia.css` bajo `src/gestion/olivia/`.

Política compartida: `src/shared/oliviaVoiceCollection.mjs`, `oliviaConversationRouter.mjs`, `oliviaGeminiLive.mjs`, `oliviaTaskConversation.mjs`. Backend: `netlify/functions/_lib/olivia/engine.mjs` y `delegatedTasks.mjs`. Fixtures y regresiones bajo `tests/`.

Se reutilizan el token efímero, motor Luna, chatJobs, cola persistente, validaciones, permisos, idempotencia y confirmación visual existentes. No se añadió otro proveedor, clasificador LLM, cola, dependencia de aplicación ni infraestructura de Pipecat/LiveKit/LiteLLM. Reemplazar toda la arquitectura no era necesario para demostrar y corregir los errores de estado observados. Eso no certifica los requisitos aún fallidos de audio.

Gemini observado: `models/gemini-3.8-live`, herramienta `NON_BLOCKING`, maxOutputTokens 2048. No se agregaron parámetros thinking no compatibles ni se afirmó desactivar razonamiento: el proveedor siguió informando thoughtsTokenCount. Referencias técnicas: [modelo](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live) y [thinking](https://ai.google.dev/gemini-api/docs/live-api/thinking).

## Validación técnica y límites

1164 tests aprobaron después de la última corrección de lógica; build de producción correcto. Después solo cambió CSS móvil y se volvió a compilar. Sigue la advertencia existente de chunks grandes. No se añadieron tests que solo reflejen CSS.

Los cambios surgieron de reproducciones sucesivas, con builds de preview agrupados por cada corrección verificable. No se alteraron reglas ni índices de Firebase. No se fusionó main ni se desplegó producción. Las conversaciones, tareas y borradores sintéticos de QA se conservan.
