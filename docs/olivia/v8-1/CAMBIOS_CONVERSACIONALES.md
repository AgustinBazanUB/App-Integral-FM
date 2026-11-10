# Cambios conversacionales — Olivia V8.1

## Foco de una conversación

`src/shared/oliviaConversationFocus.mjs` define la clasificación del último turno y el estado persistible: `activeIntentId`, `intentEpoch`, `activeDraftId`, `draftStatus`, `turnId`, `sourceTurnId`, `lastFinalUserTurn`, `taskId`, `targetType`, `targetId`, `awaitingField`, `acceptedAt` y `sessionId`.

Los turnos se clasifican como `ANSWER_SLOT`, `CORRECT_CURRENT`, `CHANGE_TARGET`, `NEW_INTENT`, `INDEPENDENT_READ`, `PAUSE_DRAFT`, `DISCARD_DRAFT`, `RESUME_DRAFT`, `TASK_STATUS`, `CANCEL_ACCEPTED_TASK`, `SOCIAL/GENERAL` o `AMBIGUOUS`. Las consultas comerciales de lectura rápida se atienden en el momento. Un borrador desplazado queda suspendido; solo vuelve con expresiones explícitas como «volvamos a la carga». Las referencias ambiguas a varias tareas piden aclaración.

## Correlación y salidas tardías

- El cliente asigna cada turno a `sessionId`, `turnId` e `intentEpoch`; el backend persiste el foco y rechaza una escritura de borrador fuera de revisión.
- Un resultado de una tarea ya aceptada se conserva como trabajo de fondo, pero no retoma el foco por su cuenta.
- Una respuesta Live obsoleta no publica texto/audio ni inicia una tarea; el audio se detiene solo para el turno reemplazado.
- La función vuelve a comprobar la identidad antes de aceptar una carga preparada.
- Las trazas distinguen intención detectada/sustituida, borrador suspendido, salida obsoleta, despacho y primeros eventos de audio/respuesta. `audio.schedule` es una programación del reproductor, no una medición acústica.

## Recolección y corrección de stock

El recolector conserva el dictado entre pausas, resuelve números comunes en español, diferencia local de depósito, resuelve referencias ordinales a las opciones mencionadas recientemente y permite corregir una línea. Una lectura como «¿cuánto vendimos ayer?» se responde sin llamar a Luna y no borra la lista pendiente.

La lista lista para enviar contiene el tipo e ID de destino, productos y cantidades, estado y revisión. El backend vuelve a buscar nombres/IDs y valida permisos y stock vigente; las líneas repetidas se agrupan y los límites se verifican en servidor. Los nombres dictados no se consideran prueba de existencia.

## Carga a depósito y confirmación

`prepare_warehouse_stock_load` prepara una operación aditiva contra el inventario del depósito. El plan crea/actualiza `warehouseStock/{warehouseId}/items/{productId}`, agrega `stockMovements`, crea `inventoryOperations` y registra auditoría. No usa `locationId`, no lleva precio de local y la tarjeta muestra el delta antes de la ejecución. La confirmación hablada no ejecuta; solo el botón visual confirma la transacción revalidada.

## Rutas preservadas

| Ruta | Uso | Luna |
|---|---|---:|
| `DIRECT` | Charla natural, aclaraciones simples, saludos y conversación mientras una tarea corre. | No |
| `FAST_READ` | Datos de negocio que devuelve una herramienta autorizada de lectura inmediata. | No |
| `TASK` | Operación compleja o trabajo aceptado que requiere cola, validación, plan o motor de tareas. | Solo si el flujo existente lo necesita |

No se abren sesiones Live nuevas por turno. El turno de voz se libera de la cola de trabajo aceptada y se conserva la confirmación visual ya existente.
