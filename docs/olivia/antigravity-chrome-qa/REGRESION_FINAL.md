# Informe de Regresión Final — Olivia V8.1 y Caso 81

**Fecha de ejecución:** 10 de noviembre de 2026  
**Rama:** `qa/olivia-antigravity-caso81` (Base: `feat/olivia-conversacion-v8-1`, Commit: `77667cb`)  
**Entorno de pruebas:** Node.js v22.17.1 · Google Chrome 157 · Staging (`app-integral-fm-pruebas`)

---

## 1. Resultados de Suites Automatizadas

| Suite de Pruebas | Total Tests | Aprobados (PASS) | Fallidos (FAIL) | Cancelados / Skipped | Duración |
|---|---|---|---|---|---|
| **Suite General del Repositorio (`npm test`)** | 1.217 | 1.217 | 0 | 0 | 3,70 s |
| **Suite de Reglas Firestore (`test:rules` en emulador local)** | 140 | 140 | 0 | 0 | ~1,2 s |
| **Suite Conversación y Foco (`olivia-conversation-*.test.mjs`)** | 21 | 21 | 0 | 0 | 346 ms |
| **Suite Caso 81 Permanente (`olivia-caso-81.test.mjs`)** | 8 | 8 | 0 | 0 | 75 ms |
| **Compilación de Producción (`npm run build`)** | Vite v6.4.5 | APROBADO (0 errores) | 0 | 0 | 6,41 s |

---

## 2. Revalidación de Rutas Críticas y Comportamientos Clave

1. **DIRECT (Charla Social y Hold):**
   - Saludos, bienestar, agradecimiento y despedidas se resuelven en el borde conversacional sin llamadas a Luna.
   - Hold con *"esperá"* preserva el contexto de charla sin invocar mutaciones.
2. **FAST_READ (Lecturas Rápidas Verificadas):**
   - Consultas de ubicaciones activas, depósitos, ventas de hoy/ayer y productos se extraen directamente sin coste de modelo ni latencias subsegundo falsificadas.
   - Una consulta lateral como *"¿Cuánto vendimos hoy?"* suspende limpiamente el borrador de carga sin destruirlo.
3. **TASK (Operaciones y Borradores de Carga):**
   - Ingesta de mercadería en depósito (`prepare_warehouse_intake`) acumula productos de forma aditiva (+10 y +5).
   - Retoma explícita con *"Bueno, volvamos a la carga"* recupera el borrador intacto.
   - Corrección de cantidades actualiza la tarjeta `pendingAction` in-place.
4. **Seguridad Transaccional:**
   - La respuesta escrita o hablada *"Sí, confirmalo"* rechaza la mutación comercial directa y exige obligatoriamente clic visual en el botón de confirmación de la tarjeta.
   - Aislamiento estricto verificado contra `app-integral-fm-pruebas`; cero llamadas a producción.
5. **Caso 81 Permanente:**
   - Creación de incidencia idempotente por turno/tarea.
   - Notificación al administrador y copia de prompt estructurado para Codex en 9 secciones ordenadas.
   - Protección contra reintento automático ante estado de escritura `UNKNOWN`.

---

## 3. Elementos Pendientes para Autorización de Producción

1. **Pruebas Acústicas Físicas:**
   - Las pruebas con entrada de voz mediante micrófono físico y emisión por altavoces reales en Windows WASAPI permanecen pendientes de una sesión humana presencial o arnés de hardware calibrado. Las pruebas de DevTools CDP y virtualización de `getUserMedia` no sustituyen la acústica real.
2. **Revisión Visual Humana del Usuario:**
   - El usuario debe inspeccionar visualmente en el Deploy Preview de Netlify la disposición de las tarjetas y el comportamiento del chat.
3. **Autorización Expresa del Usuario:**
   - Conforme a la regla obligatoria de `AGENTS.md`, ninguna actualización se integrará a `main` ni se desplegará a producción sin la autorización explícita y específica del usuario tras su revisión.
