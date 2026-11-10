# Auditoría técnica de Olivia V8 hacia V8.1

**Fecha:** 2026-11-10
**V8 inspeccionada:** `abbc1521734d0b8b89fb52238a5d705571a3fda9` (`feat/olivia-ultra-fluida-v8`, PR #62)
**Base remota actualizada:** `origin/main` = `62bd617e8e452d25aa8fa5ff26bdee796d5ccf00`; `origin/main` es ancestro de V8.
**Rama V8.1:** `feat/olivia-conversacion-v8-1`.
**Entorno previsto:** Netlify Deploy Preview + Firebase aislado `app-integral-fm-pruebas`.

## Alcance y evidencia

Se inspeccionaron el enrutador Live, el recolector de voz, la sesión WebSocket, la UI de Olivia, el cliente de tareas, el motor del backend y las capacidades/permisos de inventario. La revisión del V8 anterior es estática y se contrasta con sus pruebas y documentos existentes en `docs/olivia/v8/`. Durante esta implementación se ejecutaron pruebas automáticas sobre V8.1; la matriz de pruebas reales de Chrome y audio se registra por separado en `PRUEBAS_CONVERSACIONALES_CHROME.csv` y `REPORTE_AUDIO_REAL.md`.

PR #62 sigue abierto como Draft, dirigido a `main`, con 55 commits y el V8 arriba de la base. Por eso V8.1 parte del SHA V8 vigente y no reescribe ni reemplaza PR #62. El nuevo PR se mantiene Draft y no se integra.

## Hallazgos comprobados en el código V8

| Hallazgo | Evidencia en V8 | Estado de la causa |
|---|---|---|
| No había un estado único de foco conversacional entre la clasificación local, la transcripción, las respuestas Live y el despacho del backend. | No existía `oliviaConversationFocus.mjs`; el cliente correlacionaba eventos por turno, pero el servidor no persistía una revisión de intención y borrador con la misma identidad. | Hallazgo estático; el comportamiento exacto de una conversación cruzada no se volvió a reproducir en el preview V8 en esta ejecución. |
| Una consulta independiente durante un borrador podía depender de contexto residual del recolector o de la tarea activa. | El router y `oliviaVoiceCollection.mjs` resolvían intención y ranuras, pero no registraban explícitamente `suspended`/`paused` ni exigían retoma expresa después de una lectura independiente. | Hallazgo estático, cubierto ahora por pruebas de foco y lecturas independientes. |
| Una salida tardía o un tool call podía competir con el último turno visible. | Había protección local para eventos de sesión, pero no un `intentEpoch` común validado en cliente y backend para autorizar el despacho. | Riesgo de carrera inferido del flujo; no se presenta como reproducción acústica. |
| No existía una operación de carga de stock para depósitos. | V8 ofrecía lectura de inventario, transferencias y alta de depósitos, pero no `prepare_warehouse_stock_load`; `prepare_catalog_stock_load` representaba el destino como ubicación. | Ausencia confirmada por la matriz real de capacidades y las ramas del backend. |

## Correcciones V8.1

- Se agrega un foco con turno, revisión de intención, estado del borrador, destino, campo pendiente y tarea aceptada.
- La lectura rápida desplaza el foco sin borrar el borrador; para continuarlo hace falta una petición expresa.
- Las respuestas de transcripción, audio y herramientas se correlacionan y las obsoletas se suprimen. Cliente y función vuelven a validar turno y revisión antes de delegar.
- Las cargas de inventario admiten destino `location` o `warehouse`; la carga al depósito usa inventario, movimientos, operación y auditoría propios del depósito.
- Las operaciones siguen preparando una tarjeta y conservan la confirmación visual obligatoria.

La cobertura automática comprobada y los límites de las pruebas físicas están detallados en los demás archivos de esta carpeta. No se afirma que se hayan alcanzado 80 turnos manuales mientras la planilla no contenga 80 resultados observados.
