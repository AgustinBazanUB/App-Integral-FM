# Olivia V6 — implementación y diagnóstico

Estado: candidata de preview con aceptación parcial. No está aprobada para producción; ver RESULTADOS_PRUEBAS_V6.md y RESULTADOS_PARA_CHATGPT_V6.md.

## Punto de partida

- Base V5: `516ef2468ef527507a3d9a97d1ab6d21ece144dd`, último HEAD remoto de PR #56 al comenzar.
- `origin/main` verificado: `62bd617e8e452d25aa8fa5ff26bdee796d5ccf00`.
- Rama nueva: `codex/olivia-conversacion-continua-v6`. Se conserva V5 y el worktree ajeno de Payway.
- Se parte de V5 por instrucción específica del pedido V6. No se integra a main ni se despliega producción.

## Diagnóstico del código de V5 y correcciones V6

| Hallazgo demostrado en código | Impacto | Cambio | Verificación |
|---|---|---|---|
| Al cerrar WebSocket se termina la voz y se pide reconectar manualmente | Conversación discontinua | Recuperación limitada y renovación de credenciales/contexto | Tests y cortes reales; recuperación final 5762,4 ms desde volver la red |
| Preguntas elípticas de progreso podían quedar como charla sin consultar estado | Riesgo de respuesta no fundamentada | Ruta task-status y cliente con caché de 1,5 s / estado autenticado | Tests sin llamadas al motor de trabajo |
| Progreso limitado a fase/texto sin revisión estructurada | No hay evento verificable que anunciar | Diario acotado de aceptación, procesamiento e inicio/fin de herramientas reales | Tests de contrato; no porcentajes |
| Resultados de tareas sin recibo persistente de reproducción | Avisos repetidos o perdidos entre conexiones | Clave por revisión, coalescencia, entrega acotada y recibo autenticado | Tests de revisiones obsoletas y propietario |
| Detalles de cola/costos técnicos en vista normal | Interfaz distrae y expone implementación | Actividad discreta y tarjetas de datos/confirmación; detalles solo administrador desarrollador | Revisión Chrome normal/Developer y exportación sanitizada |
| Pausa de tarea no disponible desde contrato de voz | Control incompleto | Pausa/reanudación de fases seguras, rechazo explícito si ya ejecuta | Tests y carga QA pausada/retomada por voz; redacción aún pendiente |

## Arquitectura

Se conservan `engine.mjs`, `chatJobs.mjs`, los scopes de `delegatedTasks.mjs`, herramientas y confirmaciones transaccionales. No se incorpora otro proveedor, cola, orquestador ni dependencia. Gemini conversa; el motor existente Luna ejecuta solicitudes autorizadas. El cliente de estado no usa Luna.

El audio de escucha no se convierte en permiso. Los acuses nunca confirman ni prueban finalización. La tarjeta visual sigue siendo obligatoria. Resúmenes no legibles no permiten confirmar a ciegas.

Los backchannels se mantienen conservadores mediante instrucciones nativas; no se agrega una voz grabada ni un temporizador que hable encima del dictado. La identificación semántica de toda interrupción accidental aún debe demostrarse con audio. No se presenta el prompt como evidencia suficiente.

## Validación local

Código final validado: `3c43f1e2cb43a7f752f4a5775cc891f6a686292b`. `npm test`: 1150 pruebas aprobadas. `npm run build`: aprobado, conserva aviso conocido por tamaño de chunks. Reglas y permisos de Firestore no se modifican. Los tests locales no sustituyen los resultados reales detallados en el informe.

## Fuentes de contrato

- https://ai.google.dev/gemini-api/docs/live-api/session-management
- https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens
- Tipos del SDK `@google/genai` 2.32.0 instalado.

Un token de un uso puede reanudar su sesión dentro de su vigencia según el contrato oficial; si falla se cierra la reserva anterior y se solicita otro. No se reproducen operaciones comerciales ni function calls antiguas.


## Hallazgos de pruebas reales e iteraciones

- Diez turnos sociales consecutivos sin herramientas ni Luna; no demuestra aún toda la batería funcional.
- Un dictado virtual de veinte elementos se verificó también mediante ASR offline del PCM programado (29,76 s). La muestra física presentó segmentación y actividad adicional; no se acepta una latencia física de ella.
- Una desconexión de transporte rechazó la reanudación y recuperó con token nuevo en aproximadamente 7,1 s. Una frase enviada durante recuperación se perdió y debió repetirse.
- El alta de un cliente ficticio se inició por audio, se preparó en tarjeta y se ejecutó solo después del clic visual; luego se comprobó el documento en Firestore aislado.
- Una pregunta dividida en dos cláusulas reveló que una finalización tardía con acuse parcial podía retirar el segundo segmento. Se descarta el estado de generación interrumpido y se preserva la entrada en curso.
- Una notificación interrumpida antes de generar PCM podía contabilizarse inmediatamente sin usageMetadata. Se espera hasta el mismo plazo acotado de transcripción por un frame del proveedor anterior a la nueva transcripción. Si no aparece una medición atribuible, el freno preventivo continúa vigente. No se rebajan cuotas ni se inventa consumo cero.
- Una entrada sin transcripción vuelve a escuchar tras el plazo existente de 3 s; no cancela tareas ni atribuye intencionalidad a un ruido. La reanudación semántica automática de toda interrupción accidental sigue pendiente.

Las verificaciones de cada SHA y sus fallos se detallan en los resultados; compilar o pasar tests locales no certifica los criterios pendientes.

- Las esperas de respuesta y la ausencia de cierre de un turno generado entran ahora en la misma recuperación automática acotada con sesión fresca. El guard de consumo desconocido sigue siendo terminal. Se preserva una entrada ya finalizada localmente cuando el proveedor interrumpe buffers de una generación anterior.

- Si Gemini omite una herramienta en una intervención que la política local ya exige validar, se inicia un respaldo asíncrono por el mismo cliente autenticado. No se reproduce el texto comercial sin verificar ni se inventa un function-call ID. Se correlaciona con el ID del turno, conserva las tarjetas visuales y no crea otra cola/modelo. Una continuación ambigua pide aclaración; un control sin herramienta solo consulta estado y pide precisar la acción. La ruta se marca `task.policy_fallback` y se mide por separado. Se notifica aceptación antes de publicar la tarea para impedir avisos sin su correlación.

- Una afirmación de nombre/registro ficticio, sin consulta ni acción ni recolección activa, disparó innecesariamente un trabajo que usó una llamada Luna y cero herramientas. Se agregó la intención estructural `provided-context`: Gemini conserva ese dato en la charla. La misma frase sigue pasando al motor si hay datos/confirmación pendientes; preguntas y acciones se mantienen autenticadas. No se agrega un clasificador remoto.

- El evento `offline` del panel cerraba la conversación antes de la recuperación de Gemini. Ahora deja a la sesión esperar el evento `online` hasta 30 s, con aborto al cerrar y fallo terminal al vencer ese plazo. `pagehide` sigue liberando recursos. Se reprodujo y repitió el corte real de pestaña de aproximadamente 12 s en Chrome.
- El proveedor rechazó reutilizar un token de un uso incluso dentro de su ventana de apertura. La Function informa el mismo `uses:1` con el que lo emite y el cliente solicita una credencial nueva antes de reconectar. No se aumentan usos, duración ni privilegios. La repetición final eliminó ese intento rechazado.
- Los avisos normales de error se mantienen legibles. El detalle de Developer filtra query strings, claves y credenciales efímeras antes de mostrarlo.

## Elección de infraestructura

Se revisaron los repositorios primarios de [Pipecat](https://github.com/pipecat-ai/pipecat), [LiveKit Agents](https://github.com/livekit/agents), [Async Deep Agents](https://github.com/langchain-ai/async-deep-agents) y [LiteLLM](https://github.com/BerriAI/litellm). No se instalaron en la aplicación.

Pipecat ofrece flujos de audio y Gemini Live, y LiveKit un runtime de agentes de voz. Serían candidatos para una futura migración de transporte; incorporarlos aquí implicaría operar otro runtime y verificar de nuevo autorización y audio. Async Deep Agents sirve como referencia de trabajos con IDs, consulta y cancelación, pero su ejemplo usa LangSmith/LangGraph: se conserva el motor persistente que ya tiene la aplicación. LiteLLM aporta una puerta común a proveedores; esta corrección necesita el protocolo bidireccional nativo y una integración Luna ya existente. Agregar un proxy no resuelve por sí solo los fallos observados. Estas conclusiones son decisiones de diseño, no benchmarks de esas alternativas. No se midió ni se promete ahorro de sus servicios.

No hay cambios de dependencias de la aplicación. Las herramientas ASR/diagnóstico se instalaron solo en el entorno privado de pruebas de la PC, fuera del repositorio.
