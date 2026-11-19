# Registro de Correcciones de Causa Raíz — Olivia V8.1 y Caso 81

**Rama de trabajo:** `qa/olivia-antigravity-caso81`  
**Base:** `feat/olivia-conversacion-v8-1` (HEAD `77667cb`)  
**Fecha:** 10 de noviembre de 2026

---

## 1. Registro Append-Only de Correcciones

### Fix 1: Protocolo de Conexión Chrome 157 y DevTools MCP
- **Módulos afectados:** Scripting de inicio de Chrome y configuración de entorno QA.
- **Causa raíz:** Requerimiento estricto de `--remote-allow-origins=*` en Chrome 157 para habilitar CDP por WebSocket y REST sin desconexión inmediata.
- **Solución implementada:** Parámetros de lanzamiento formalizados en `CHROME_SETUP.md` y script de orquestación CDP `scratch/cdp_smoke_test.mjs` y `scratch/run_full_smoke_test.mjs`.
- **Verificación:** Ejecución de 10 rutas en Chrome real, captura de pantalla y HTTP 200 en todas las superficies.

### Fix 2: Suspensión y Retoma de Borradores de Voz ante Lecturas Independientes
- **Commits asociados:** `d484b33`, `27c6259`, `77667cb`
- **Módulos afectados:** `src/shared/oliviaConversationFocus.mjs`, `src/shared/oliviaConversationRouter.mjs`, `src/shared/oliviaVoiceCollection.mjs`.
- **Causa raíz:** Una lectura rápida intermedia borraba el estado del colector o intentaba enviar la tarea como mutación en curso.
- **Solución implementada:** Estado `suspended` para borradores ante consultas independientes (`isIndependentBusinessRead`), y restauración del borrador original ante solicitudes de retoma explícita (`isDraftResumeRequest`).
- **Verificación:** Tests unitarios `tests/olivia-conversation-focus.test.mjs` (21/21 ok).

### Fix 3: Corrección de Altura Completa en Panel de Chat
- **Commit asociado:** `8123a3f`
- **Módulos afectados:** `src/gestion/olivia/olivia.css`.
- **Causa raíz:** Reglas de flexbox y scroll interno provocaban un colapso vertical en ciertas resoluciones de escritorio.
- **Solución implementada:** Ajuste de constraints de altura en contenedor `.fm-olivia-chat` asegurando 100% del viewport asignado.
- **Verificación:** Inspección visual en Chrome en resolución 1440x900 y 390x844.

### Fix 4: Implementación del CASO 81 Permanente
- **Archivos creados/modificados:**
  - `src/shared/oliviaIncidentReports.mjs`
  - `tests/olivia-caso-81.test.mjs`
- **Causa raíz:** Ausencia de un motor de autodiagnóstico idempotente que construya prompts completos y ordenados para Codex ante fallas o capabilities no cubiertas.
- **Solución de punta a punta:**
  1. **Sanitización estricta (`sanitizeText`):** Enmascara Bearer tokens, contraseñas, claves API (AIza), JWTs, teléfonos de Argentina y correos electrónicos.
  2. **Diagnóstico de capacidades (`diagnoseIncidentReason`):** Cruza la solicitud contra la matriz de `OLIVIA_CAPABILITIES` y los módulos de App Integral FM para clasificar en `CAPABILITY_AUSENTE`, `ERROR_SOFTWARE` o `PEDIDO_CONFUSO`.
  3. **Generador del Prompt para Codex (`buildCodexPrompt`):** Estructura exactamente las 9 secciones en el orden establecido:
     1. ROL y entorno verificado (con aislamiento a `app-integral-fm-pruebas` y commit verificado).
     2. PEDIDO ORIGINAL sanitizado y transcripción.
     3. QUÉ ENTENDIÓ OLIVIA (intención, ruta DIRECT/FAST_READ/TASK, slots).
     4. EXPECTATIVA y RESULTADO OBSERVADO (con estado de la operación y de escritura en BD).
     5. ERROR y diagnóstico confirmado vs. hipótesis.
     6. PASOS PARA REPRODUCIR EN STAGING.
     7. TAREAS PARA CODEX (investigación de punta a punta, tests, build, Chrome).
     8. CRITERIOS DE ACEPTACIÓN y seguridad.
     9. LOG DE EVIDENCIAS y estado.
  4. **Protección ante Escritura Desconocida (`preventBlindRetry`):** Si una escritura queda en estado `unknown`, se bloquea el reintento automático y se advierte al usuario en la conversación para evitar duplicaciones.
  5. **Idempotencia (`IncidentStore`):** Reintentos sobre la misma combinación de conversación y turno/tarea no generan registros duplicados.
  6. **Relato del Usuario:** Se preserva el relato en un campo editable que se incorpora al prompt de Codex.
- **Verificación:** Suite de pruebas unitarias `tests/olivia-caso-81.test.mjs` con 8/8 pruebas aprobadas al 100%. Suite completa `npm test` con 1.217/1.217 pruebas aprobadas. Build Vite exitoso en 6.41s.
