# Reporte de Concurrencia, Cola de Tareas y Permisos (RBAC) — Olivia Ultra Fluida V8

**Fecha:** 2026-11-10  
**Versión auditada:** `feat/olivia-ultra-fluida-v8` (base `9f5371a`)

---

## 1. Arquitectura de Concurrencia y Aislamiento de Scopes

### 1.1 Aislamiento por Tarea (`scopeId = task_${id}`)
Cada tarea delegada creada mediante `startDelegatedTask` (`netlify/functions/_lib/olivia/delegatedTasks.mjs`) opera sobre un documento de conversación hijo aislado (`oliviaConversations/task_${id}`) con `internalTask: true` y `parentConversationId: parent`.
- Sus `slots`, `ambiguities`, `pendingActionId`, `activeChatJobId` y lease `busyRequestId` están completamente aislados de la conversación raíz y de cualquier otra tarea hermana.
- Esto permite que el usuario:
  1. Mantenga charla social (`DIRECT`) mientras hasta **3 tareas activas** (`running`) se procesan en segundo plano (`Caso D-01`).
  2. Ejecute consultas rápidas (`FAST_READ`) en `foreground: true` sin esperar ni cancelar tareas activas (`Caso D-02`, `Caso C-07`).
  3. Lance múltiples tareas independientes simultáneamente (`Caso D-03`) y encole automáticamente la 4ta tarea (`status: "queued"`), promoviéndola a `status: "running"` en cuanto se libera uno de los 3 slots activos (`Caso D-04`).

### 1.2 Eliminación de la Condición de Carrera `foreground` vs. `pumpDelegatedTasks` (Hallazgo H-04)
- **Problema en V7:** `startDelegatedTask` creaba inicialmente toda tarea con `status: "queued"` y `jobId: null` incluso cuando `body.foreground === true && quickReadPlan(text)`. Si un polling concurrente (`listDelegatedTasks`) ejecutaba `pumpDelegatedTasks` en esa ventana, reclamaba la tarea y despachaba un job duplicado en background.
- **Solución en V8:** Cuando `isForegroundFastRead === true`, la transacción inicial escribe atómicamente `status: "running"`, `phase: "Consultando datos"` y `jobId: "fg_${requestId}"`. De este modo, `pumpDelegatedTasks` jamás reclama ni duplica una lectura rápida en primer plano.

### 1.3 Gestión de Dependencias (`dependsOn`) y Rotación de Historial (>20 Tareas)
- Si una tarea declara `dependsOn: [taskA]`, permanece en `status: "queued"` (`phase: "Esperando tarea previa"`) hasta que `taskA` pase a `completed`. Si `taskA` pasa a `cancelled` o `failed`, la tarea dependiente aborta automáticamente a `status: "failed"` (`failure.code = "dependency-failed"`) sin despachar ningún job (`Caso D-09`).
- Cuando `root.delegatedTaskIds` supera las 20 tareas en una misma conversación y existen tareas terminales (`completed`, `cancelled`, `failed`), la transacción poda las tareas terminales más antiguas no referenciadas en `dependsOn`, permitiendo conversaciones largas sin error `409 task-limit` (`Caso D-10`).

---

## 2. Verificación de Permisos (RBAC) y Confirmación Visual Obligatoria

### 2.1 Matriz de Verificación de Permisos Ejecutada

| Caso | Rol / Perfil | Acción probada | Resultado obtenido | Estado |
| :--- | :--- | :--- | :--- | :---: |
| **`E-01`** | `seller` (`allowedLocationIds: ["local_a"]`) | Consultar stock de ubicación ajena (`Local B`) por `FAST_READ` | Rechaza acceso a `Local B`: *"No encontré una ubicación permitida con el nombre Local B."* | **PASS** |
| **`E-02`** | `seller` | Intentar cargar stock (`prepare_stock_load`) | `state: "RECHAZADA"`, `pendingAction: null`, `0` escrituras. Mensaje claro de falta de permisos. | **PASS** |
| **`E-03`** | `admin` con `permissionDeny.locations = ["loadStock", "admin"]` | Intentar cargar stock (`prepare_stock_load`) | `state: "RECHAZADA"`, `pendingAction: null`, `0` escrituras. Respeta `permissionDeny` granular. | **PASS** |
| **`C-08`** | `admin` | Decir `"Sí"` por voz (`inputMode: "natural-voice"`) ante una tarjeta `pendingAction` | **0 escrituras en Firestore**. La tarjeta `pendingAction` permanece intacta esperando confirmación visual explícita. | **PASS** |
| **`C-09`** | `admin` | Hacer clic en `"No, cancelar"` (`engine.cancel`) | Cancela `pendingAction` y deja `currentStock` intacto (`0` escrituras de negocio). | **PASS** |
| **`C-10`** | `admin` | Hacer clic en `"Sí, confirmar"` (`engine.confirm`) sobre `prepare_catalog_stock_load` | Ejecuta transacción atómica incrementando `Aceite` (`4 -> 14`) y `Coratina Reserva 500ml` (`3 -> 8`) con registro de auditoría. | **PASS** |
| **`C-11`** | `admin` | Doble clic concurrente en `"Sí, confirmar"` con el mismo `confirmationToken` | Idempotencia transaccional verificada: el stock se incrementa **una sola vez**. | **PASS** |
| **`C-12`** | `admin` | Modificación externa del stock en Firestore entre la preparación y el clic en `"Sí"` | Revalidación transaccional detecta discrepancia de `currentStock` y aborta con `409 context-changed` (`0` escrituras). | **PASS** |
| **`E-06`** | `system` | Verificación de destino Firebase (`assertGeminiLivePreview`) | Permite `app-integral-fm-pruebas` y bloquea `app-integral-fm` (producción) con `403 gemini-live-disabled`. | **PASS** |

### 2.2 Pruebas Automatizadas de Reglas Firestore (`npm run test:olivia:rules`)
- Las reglas de Firestore para las colecciones de Olivia (`oliviaConversations`, `delegatedTasks`, `oliviaConfirmations`, `oliviaGeminiLiveSessions`, `oliviaBudgets`) mantienen aislamiento estricto por usuario/rol y bloquean escrituras directas desde el cliente sobre colecciones de confirmación y presupuestos.
