# Hallazgos de Calidad, UX y Seguridad — Olivia V8.1

**Fecha de auditoría:** 10 de noviembre de 2026  
**Entorno:** Google Antigravity IDE · Chrome 157 · Staging (`app-integral-fm-pruebas`)

---

## 1. Resumen de Severidad de Hallazgos

| ID | Área | Severidad | Descripción del Hallazgo | Estado |
|---|---|---|---|---|
| **H01** | Chrome / DevTools | **Alta (Bloqueante)** | En Google Chrome 157+, el parámetro `--remote-debugging-port=9222` exige `--remote-allow-origins=*`. Sin esta directiva, Chrome cierra el socket TCP en estado `FinWait1` al recibir peticiones HTTP o WebSocket. | **Corregido / Documentado** en `CHROME_SETUP.md`. |
| **H02** | Chrome / Perfiles | **Media** | Instancias background de Chrome (`--no-startup-window`) impiden que nuevas ejecuciones sobre el perfil habitual activen el puerto de depuración sin flags explícitos. | **Corregido / Mitigado** mediante perfil de QA aislado `.chrome-qa`. |
| **H03** | DevTools Protocol | **Media** | El cliente Puppeteer / Chrome DevTools MCP rechaza el archivo `DevToolsActivePort` si no contiene la segunda línea con la ruta WebSocket del navegador (`/devtools/browser/<guid>`). | **Verificado y resuelto** en inicialización de entorno. |
| **H04** | Conversación / Router | **Alta** | Un prefacio de consulta lateral durante la recolección de un borrador de carga (ej: *"Esperá, primero decime cuánto vendimos hoy"*) competía con el borrador o intentaba reutilizar la tarea. | **Corregido** en commits `d484b33` y `77667cb` (suspensión y retoma correlacionada). |
| **H05** | Seguridad / Transacciones | **Crítica** | Un usuario intentando confirmar una carga por texto o voz diciendo *"Sí, confirmalo"* no debe mutar Firestore directamente. El producto debe exigir confirmación visual en la tarjeta `pendingAction`. | **Verificado** en `tests/olivia-conversation-focus.test.mjs` y `olivia-v8-1-warehouse-stock.test.mjs`. |
| **H06** | UI / Layout | **Baja** | El panel de chat de Olivia no aprovechaba la altura completa del contenedor lateral en ciertas resoluciones, dejando media altura vacía. | **Corregido** en commit `8123a3f`. |
| **H07** | Diagnóstico / Caso 81 | **Alta** | Ante operaciones existentes en App Integral pero ausentes en la matriz de capabilities de Olivia (ej. campañas WhatsApp, despacho directo de envíos, liquidaciones), el sistema no contaba con un generador estructurado de incidencias y prompts de 9 secciones para Codex. | **Implementado y cubierto** por `oliviaIncidentReports.mjs` y suite `olivia-caso-81.test.mjs`. |

---

## 2. Detalle de Reproducción y Diagnóstico Técnico

### H01: Rechazo de Conexión Remote Debugging en Chrome 157
- **Síntoma:** Al invocar `mcp_chrome_devtools_list_pages` o enviar peticiones a `http://127.0.0.1:9222/json/version`, el servidor arrojaba `Unable to connect / Connection refused`.
- **Diagnóstico:** A partir de Chromium 124+, la protección contra DNS rebinding y accesos de terceros exige autorizar orígenes explícitos mediante `--remote-allow-origins=*` o el origen de llamada exacto.
- **Evidencia:** Registro en `task-220` y respuesta exitosa tras incorporar la bandera.

### H04: Manejo de Prefacios y Retoma de Borrador
- **Síntoma en pruebas manuales (caso M05):** La frase *"Esperá, primero decime cuánto vendimos hoy"* consumía tiempo innecesario y se desviaba a Luna en lugar de resolverse por FAST_READ conservando el borrador.
- **Causa Raíz:** Falta de correlación de estado `suspended` en el foco conversacional ante lecturas independientes.
- **Resolución:** Implementada en `oliviaConversationFocus.mjs` y `oliviaBusinessRead.mjs`, cubierto por 21 tests automatizados de foco y control.

### H07: Caso 81 — Autodiagnóstico y Prompt para Codex
- **Requerimiento:** Al fallar una tarea o solicitar una función no cubierta, Olivia debe:
  1. Crear una incidencia idempotente por turno/tarea.
  2. Notificar al usuario sin prometer soluciones falsas ni afirmar ejecuciones no verificadas.
  3. Prevenir reintentos automáticos a ciegas si el estado de escritura es `UNKNOWN`.
  4. Generar el prompt estructurado para Codex en 9 secciones exactas y sanitizadas (sin tokens, contraseñas, teléfonos ni datos personales).
