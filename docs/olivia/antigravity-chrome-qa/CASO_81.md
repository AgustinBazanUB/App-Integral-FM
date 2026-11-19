# Especificación y Verificación del Caso 81 Permanente

**Módulo:** Autodiagnóstico, Registro de Incidencias y Prompt Automático para Codex  
**Estado:** IMPLEMENTADO Y CUBIERTO POR TESTS UNITARIOS Y DE INTEGRACIÓN  
**Archivos fuente:** `src/shared/oliviaIncidentReports.mjs`, `tests/olivia-caso-81.test.mjs`

---

## 1. Misión del Caso 81
El Caso 81 dota a Olivia de la capacidad permanente para:
1. Autodiagnosticar cuándo una operación pedida existe en App Integral FM pero no cuenta con tool/capability implementada en Olivia (`CAPABILITY_AUSENTE`), o cuándo ocurrió una excepción de software/API (`ERROR_SOFTWARE`).
2. Crear **UNA incidencia persistida e idempotente por turno/tarea**, vinculada a la solicitud y accesible al administrador.
3. Explicar brevemente en la conversación qué no se completó, informando con veracidad si el resultado de escritura es desconocido (`UNKNOWN`) y evitando promesas automáticas falsas.
4. Proveer un botón **«Copiar prompt para Codex»** con el texto técnico exacto, ordenado en 9 secciones obligatorias, listo para que un ingeniero o el agente Codex reproduzca y resuelva la causa raíz de punta a punta.
5. Permitir la acción manual **«Reportar un problema con mi último pedido»**, conservando el relato del usuario en un campo editable.
6. Aplicar sanitización estricta: nunca filtrar claves, cookies, JWT, contraseñas, teléfonos ni datos personales de clientes.

---

## 2. Matriz de Requisitos y Cobertura

| Requisito | Implementación | Validación de Test | Estado |
|---|---|---|---|
| **Módulo existente no cubierto por Olivia** | `diagnoseIncidentReason` detecta operaciones de WhatsApp, ARCA, y despacho directo de envíos ausentes en `OLIVIA_CAPABILITIES`. | `tests/olivia-caso-81.test.mjs` subtest 2 | **PASS** |
| **Falla de API o excepción técnica** | Categorización como `ERROR_SOFTWARE`, preserva código de error, status HTTP y traza sanitizada. | `tests/olivia-caso-81.test.mjs` subtest 3 | **PASS** |
| **Pedido confuso / datos insuficientes** | Categorización como `PEDIDO_CONFUSO`; no inventa rutas ni stack traces ficticios, marca "no verificado". | `tests/olivia-caso-81.test.mjs` subtest 4 | **PASS** |
| **Escritura en estado UNKNOWN** | Flag `preventBlindRetry: true`. En conversación advierte que no reintenta para no duplicar datos. | `tests/olivia-caso-81.test.mjs` subtest 5 | **PASS** |
| **Idempotencia estricta** | `IncidentStore` indexa por `incident_${convId}_${turnId}`; reintentos no duplican documentos. | `tests/olivia-caso-81.test.mjs` subtest 6 | **PASS** |
| **Acción manual de reporte con relato editable** | Campo `userRelato` editable que actualiza dinámicamente el prompt para Codex sin duplicar la incidencia. | `tests/olivia-caso-81.test.mjs` subtest 7 | **PASS** |
| **Estructura exacta en 9 secciones ordenadas** | `buildCodexPrompt` genera secciones 1 a 9 en orden secuencial estricto con metadatos verificados de staging. | `tests/olivia-caso-81.test.mjs` subtest 8 | **PASS** |
| **Sanitización de credenciales y datos privados** | `sanitizeText` enmascara Bearer, AIza, JWT, passwords, emails y teléfonos argentinos (+54 11 ...). | `tests/olivia-caso-81.test.mjs` subtest 1 | **PASS** |

---

## 3. Ejemplo de Prompt para Codex Generado por el Caso 81 (Sintético)

```markdown
### 1. ROL Y ENTORNO VERIFICADO
- Rol: Asistente técnico Codex / Ingeniero Senior QA App Integral Flor Mía.
- Repositorio: https://github.com/AgustinBazanUB/App-Integral-FM
- Branch: feat/olivia-conversacion-v8-1
- Commit SHA: 77667cb650555211e412b06810f443df634e058b
- Entorno autorizado: Staging (https://deploy-preview-63--appintegralflormia.netlify.app)
- Firebase de pruebas: app-integral-fm-pruebas (PROHIBIDO PRODUCCIÓN: app-integral-fm)

### 2. PEDIDO ORIGINAL SANITIZADO Y TRANSCRIPCIÓN
- Pedido original del usuario: "Mandá una campaña de WhatsApp a todos los clientes del local con la promo de aceite"
- Transcripción efectiva de voz: "Manda una campana de whatsapp a todos los clientes del local con la promo de aceite"
- Relato adicional del usuario: "El cliente pidió activar la difusión del evento pero Olivia dice que no puede"

### 3. QUÉ ENTENDIÓ OLIVIA
- Intención detectada: create_whatsapp_campaign
- Clasificación de ruta: TASK (delegate)
- Slots identificados: {"targetAudience":"clientes_local","campaignTopic":"promo_aceite"}
- Módulo destino: marketing/whatsapp

### 4. EXPECTATIVA Y RESULTADO OBSERVADO
- Expectativa: Ejecución segura con validación visual o respuesta informativa veraz.
- Resultado observado: Operación existente en App Integral (Campaña WhatsApp masiva) no cubierta por la API de Olivia.
- Estado de la operación: unsupported
- Estado de escritura en base de datos: aborted (Sin mutaciones inconsistentes)

### 5. ERROR Y DIAGNÓSTICO
- Código de error: CAPABILITY_AUSENTE
- Mensaje / Síntoma: Operación existente en App Integral (Campaña WhatsApp masiva) no cubierta por la API de Olivia.
- Diagnóstico confirmado vs. hipótesis: Autodiagnóstico por matriz de capacidades
- Capability / Herramienta: N/A (Estado: ausente)

### 6. PASOS PARA REPRODUCIR EN STAGING
1. Abrir https://deploy-preview-63--appintegralflormia.netlify.app/gestion en Google Chrome.
2. Activar Olivia (botón Conversar o panel lateral).
3. Enviar solicitud: "Mandá una campaña de WhatsApp a todos los clientes del local con la promo de aceite".
4. Observar respuesta de Olivia y estado de la interfaz.
- Datos sintéticos recomendados: Depósito QA Olivia V81 / Aceite QA PR53 (solo staging).

### 7. TAREAS PARA CODEX
1. Investigar de punta a punta: UI → transcripción → router (TASK) → backend → Firestore.
2. Corregir la causa raíz del módulo afectado preservando el diseño integral (no parches cosméticos ni ifs puntuales).
3. Si falta la capacidad, implementar el contrato formal en OLIVIA_CAPABILITIES y su handler seguro.
4. Agregar tests unitarios y de integración para el caso de falla y su recuperación.
5. Ejecutar npm test, npm run build y verificar en Chrome sobre el preview de staging.
6. Revalidar regresiones adyacentes de DIRECT, FAST_READ y TASK.

### 8. CRITERIOS DE ACEPTACIÓN Y SEGURIDAD
- Nunca ejecutar mutaciones comerciales sin confirmación visual explícita del usuario.
- Separación estricta de datos: operar exclusivamente contra app-integral-fm-pruebas.
- Idempotencia: las solicitudes repetidas no duplican registros ni ejecutan escrituras desconocidas.
- Revisión del commit final con hash SHA documentado.

### 9. LOG DE EVIDENCIAS Y ESTADO
- ID Incidencia: incident_conv_123_turn_45
- Fecha/Hora: 2026-11-10T17:55:00.000Z
- Estado de resolución: PENDIENTE_CODEX
- Evidencia archivada: docs/olivia/antigravity-chrome-qa/INCIDENCIAS_SINTETICAS.jsonl
```
