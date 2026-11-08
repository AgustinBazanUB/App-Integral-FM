# Olivia V6 — implementación y diagnóstico

Estado: candidata en desarrollo; la aceptación acústica y funcional requiere el registro de pruebas de este directorio.

## Punto de partida

- Base V5: `516ef2468ef527507a3d9a97d1ab6d21ece144dd`, último HEAD remoto de PR #56 al comenzar.
- `origin/main` verificado: `62bd617e8e452d25aa8fa5ff26bdee796d5ccf00`.
- Rama nueva: `codex/olivia-conversacion-continua-v6`. Se conserva V5 y el worktree ajeno de Payway.
- Se parte de V5 por instrucción específica del pedido V6. No se integra a main ni se despliega producción.

## Diagnóstico del código de V5 y correcciones V6

| Hallazgo demostrado en código | Impacto | Cambio | Verificación |
|---|---|---|---|
| Al cerrar WebSocket se termina la voz y se pide reconectar manualmente | Conversación discontinua | Recuperación limitada, reanudación privada y renovación de credenciales/contexto | Tests con sockets controlados; prueba de proveedor pendiente |
| Preguntas elípticas de progreso podían quedar como charla sin consultar estado | Riesgo de respuesta no fundamentada | Ruta task-status y cliente con caché de 1,5 s / estado autenticado | Tests sin llamadas al motor de trabajo |
| Progreso limitado a fase/texto sin revisión estructurada | No hay evento verificable que anunciar | Diario acotado de aceptación, procesamiento e inicio/fin de herramientas reales | Tests de contrato; no porcentajes |
| Resultados de tareas sin recibo persistente de reproducción | Avisos repetidos o perdidos entre conexiones | Clave por revisión, coalescencia, entrega acotada y recibo autenticado | Tests de revisiones obsoletas y propietario |
| Detalles de cola/costos técnicos en vista normal | Interfaz distrae y expone implementación | Actividad discreta y tarjetas de datos/confirmación; detalles solo administrador desarrollador | Build; revisión Chrome pendiente |
| Pausa de tarea no disponible desde contrato de voz | Control incompleto | Pausa/reanudación de fases seguras, rechazo explícito si ya ejecuta | Tests persistentes e idempotencia |

## Arquitectura

Se conservan `engine.mjs`, `chatJobs.mjs`, los scopes de `delegatedTasks.mjs`, herramientas y confirmaciones transaccionales. No se incorpora otro proveedor, cola, orquestador ni dependencia. Gemini conversa; el motor existente Luna ejecuta solicitudes autorizadas. El cliente de estado no usa Luna.

El audio de escucha no se convierte en permiso. Los acuses nunca confirman ni prueban finalización. La tarjeta visual sigue siendo obligatoria. Resúmenes no legibles no permiten confirmar a ciegas.

Los backchannels se mantienen conservadores mediante instrucciones nativas; no se agrega una voz grabada ni un temporizador que hable encima del dictado. La identificación semántica de toda interrupción accidental aún debe demostrarse con audio. No se presenta el prompt como evidencia suficiente.

## Validación local

`npm test`: 1135 pruebas aprobadas, incluidas 12 nuevas V6. `npm run build`: aprobado, conserva aviso conocido por tamaño de chunks. Se requiere repetir si cambian estos módulos. Reglas y permisos de Firestore no se modifican.

## Fuentes de contrato

- https://ai.google.dev/gemini-api/docs/live-api/session-management
- https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens
- Tipos del SDK `@google/genai` 2.32.0 instalado.

Un token de un uso puede reanudar su sesión dentro de su vigencia según el contrato oficial; si falla se cierra la reserva anterior y se solicita otro. No se reproducen operaciones comerciales ni function calls antiguas.
