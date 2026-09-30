# Meta Ads — Etapa 4: Campaign Planner

## Objetivo

Etapa 4 convierte un `CampaignProject` interno en una planificación publicitaria revisable sin publicar nada en Meta, sin editar videos y sin avanzar a automatizaciones de etapas posteriores.

Flujo implementado:

`CampaignProject → CampaignPlanningContext → Missing Information → Questions → Answers → CampaignPlan → revisión humana → aprobación → creative`

La etapa reutiliza la Base de Conocimiento y el Theory Engine de Etapa 3. No crea catálogos de productos paralelos ni copia información de clientes.

## Base y compatibilidad

La rama de trabajo es `feature/meta-ads-campaign-planner` y está apilada sobre `feature/meta-ads-theory-engine`.

Se conserva el contrato de Etapa 2 para `metaCampaignProjects` y se agregan únicamente campos/operaciones de planificación. WhatsApp, ventas, stock, métricas y el resto de la aplicación permanecen fuera del flujo del Campaign Planner.

Como reparación de baseline, las Rules del Theory Engine se mantuvieron con un envelope estructural acotado para no superar el presupuesto de evaluación de Firestore. La validación profunda de `TheoryConfig` continúa en dominio y backend.

## CampaignPlanningContext

`buildCampaignPlanningContext` reúne únicamente datos relevantes para estrategia:

- campaña: id, nombre, estado y producto;
- BusinessContext de Flor Mía;
- producto canónico y su metadata Marketing;
- TheoryVersion fijada a la campaña;
- respuestas previas del usuario;
- hechos conocidos y hechos faltantes.

No se incluyen DNI, teléfonos, nombres individuales de clientes ni base de clientes.

## TheoryVersion fija

Al iniciar la planificación se guardan en el CampaignProject:

- `theoryId`;
- `theoryVersionId`;
- `theoryVersion`;
- `theoryNameSnapshot`.

El backend vuelve a cargar esa versión exacta. Una activación posterior de otra versión no cambia silenciosamente una campaña ya iniciada.

## Missing Information Resolver

La decisión de qué falta es determinista y ocurre antes de llamar a OpenAI.

Reglas principales:

- no preguntar datos ya conocidos;
- respetar `TheoryConfig.questionPolicy.requiredFields`;
- máximo 6 dimensiones faltantes;
- `questions=[]` es una salida válida cuando el contexto ya alcanza;
- no solicitar configuración técnica de Meta Ads ni PII de clientes.

## Questions

Tipos soportados:

- `single_choice`;
- `multi_choice`;
- `short_text`;
- `long_text`;
- `boolean`;
- `number`.

La salida de OpenAI usa Structured Outputs y después vuelve a validarse en `validateQuestions`. Las keys generadas deben pertenecer a las dimensiones faltantes permitidas.

Las respuestas pasan por `validateAnswers` antes de persistirse o generar el plan. Las preguntas booleanas y numéricas empiezan sin respuesta (`null`), para no transformar un dato desconocido en `No` o `0` sin intervención del usuario.

## CampaignPlan

El contrato versionado `CampaignPlan` incluye:

- resumen;
- estrategia;
- concepto;
- ángulo;
- objetivo comercial;
- público;
- mensaje central;
- oferta/argumento;
- CTA;
- dirección creativa;
- `creativePieces`;
- plan de pruebas;
- supuestos;
- advertencias.

No se guarda JSON libre como contrato de negocio: dominio y backend validan esquema, tipos, tamaños, claves y contenido potencialmente peligroso.

## CreativePieces dinámicas

Las piezas se derivan de `TheoryConfig.creativeRequirements`.

Por cada requirement se exige exactamente `recommendedCount`. El código no contiene una lista cerrada de `hook`, `body`, `ending`, etc. Una nueva key como `testimonial` se procesa con el mismo componente y el mismo validador.

Tests cubren, entre otros casos:

- 3 piezas requeridas → 3 piezas;
- 6 piezas requeridas → 6 piezas;
- categoría dinámica `testimonial`;
- rechazo de categorías desconocidas respecto de la TheoryConfig fijada;
- rechazo de cantidades distintas de `recommendedCount`.

## Revisiones, edición y aprobación

Los planes viven en:

`metaCampaignProjects/{campaignId}/plans/r{revision}`

Cada regeneración crea una nueva revisión; no sobrescribe la anterior.

Un plan `draft` puede editarse manualmente sin volver a llamar a OpenAI. Un plan `approved` queda inmutable por Rules.

La aprobación humana:

1. valida nuevamente el plan contra la TheoryVersion fijada;
2. cambia las CreativePieces a `approved`;
3. marca la revisión como `approved`;
4. actualiza `planning/state`;
5. actualiza el CampaignProject de `planning` a `creative`;
6. conserva `approvedPlanRevision` y el historial.

La transición del documento padre sólo se permite desde un contexto `plan_ready` con al menos una revisión generada.

## Persistencia Firestore

Documento padre:

`metaCampaignProjects/{campaignId}`

Estado de planificación:

`metaCampaignProjects/{campaignId}/planning/state`

Revisiones del plan:

`metaCampaignProjects/{campaignId}/plans/{planId}`

AI usage:

`aiUsage/{usageId}`

Operaciones de IA de Etapa 4:

- `campaign_questions`;
- `campaign_plan`.

No se realizan escrituras de progreso por token/tick.

## Permisos

Acciones nuevas:

- `metaAdsPlanCampaign`;
- `metaAdsApprovePlan`.

`permissionDeny` continúa prevaleciendo. Admin/general admin y `marketing_manager` pueden recibir estas acciones según las plantillas actuales; permisos explícitos siguen siendo compatibles con el sistema existente.

Las Rules separan las rutas de actualización por tipo de operación para evitar evaluar simultáneamente edición de Etapa 2, archivo, planificación y aprobación. Esto mantiene las escrituras válidas dentro del presupuesto de expresiones de Firestore.

## Backend seguro

Función:

`/.netlify/functions/campaign-planner`

Controles:

- Firebase ID Token obligatorio para POST;
- validación server-side del perfil y permiso;
- proyecto Firebase fijado a `app-integral-fm`;
- `OPENAI_API_KEY` sólo server-side;
- Responses API;
- Structured Outputs con `json_schema` y `strict: true`;
- `store: false`;
- contexto tratado como datos no confiables, no como instrucciones;
- sin herramientas disponibles al modelo;
- timeout 45 s;
- límite de request;
- máximo 3 generaciones/minuto/usuario por instancia caliente;
- una generación simultánea por usuario/operación por instancia caliente;
- idempotencia temporal por `requestId` dentro de la instancia.

El rate limiting en memoria es una protección de abuso de instancia, no un sistema distribuido de cuotas/billing.

## Modelos y configuración

Fallback central actual: `gpt-5.6-luna`.

Variables opcionales:

- `OPENAI_QUESTION_MODEL`;
- `OPENAI_CAMPAIGN_PLAN_MODEL`;
- fallback a `OPENAI_THEORY_MODEL`;
- `OPENAI_PLANNER_INPUT_USD_PER_MTOK`;
- `OPENAI_PLANNER_OUTPUT_USD_PER_MTOK`.

Si las variables de precio no están configuradas, se registran tokens reales pero `actualCostUsd` queda `null`; no se inventan precios.

## Errores externos

La capa de UI/backend distingue al menos:

- API key ausente;
- billing/crédito no disponible;
- rate limit;
- credencial inválida;
- timeout;
- respuesta vacía/refusal;
- schema inválido;
- permisos/sesión;
- TheoryVersion inconsistente.

Las respuestas y planes ya guardados no se borran por un error posterior de OpenAI.

## Índices

Etapa 4 no requiere un índice compuesto nuevo.

Las lecturas agregadas usan documentos directos, subcolecciones por campaña y el orden simple por `revision`. `firestore.indexes.json` no se modifica por esta etapa.

## Pruebas y publicación de Rules

Barrera final limpia antes de publicar:

- `npm test`: **213/213 PASS**;
- Firestore Rules Emulator: **45/45 PASS**;
- `npm run build`: **PASS**;
- `.firebaserc`: default **`app-integral-fm`**;
- `firestore.indexes.json`: sin cambios respecto de Etapa 3.

Las Rules se publicaron de forma controlada exclusivamente con `--only firestore:rules --project app-integral-fm`. No se desplegaron Hosting ni índices y no se tocó el proyecto legado `fm-stock-y-venta`.

Después de publicar se repitieron:

- Firestore Rules Emulator: **45/45 PASS**;
- `npm test`: **213/213 PASS**.

El CI permanente del repositorio también pasó instalación, tests, Rules Emulator y build sobre el stack completo Etapas 2–4 mediante el PR auxiliar de Preview.

## Deploy Preview y smoke HTTP

PR real de Etapa 4: `#13`, base `feature/meta-ads-theory-engine`.

PR auxiliar `#14`, base `main`: posteriormente quedó fusionado el 30/08/2026 y conserva el Deploy Preview histórico utilizado para la validación funcional. El PR real de desarrollo continúa siendo `#13`.

Deploy Preview exacto:

`https://deploy-preview-14--appintegralflormia.netlify.app`

Smoke HTTP ejecutado desde GitHub Actions:

- `/`: HTTP 200;
- `/gestion/marketing/meta-ads`: HTTP 200;
- `/.netlify/functions/campaign-planner?health=1`: HTTP 200;
- POST con operación real `generateQuestions` pero sin Firebase ID Token: HTTP 401, `code=unauthenticated`.

Health observado en el Preview:

- `configured: true`;
- `questionModel: gpt-5.6-luna`;
- `planModel: gpt-5.6-luna`;
- `pricingConfigured: false`;
- precios por token: `null`.

El health confirma que `OPENAI_API_KEY` está presente en el contexto de Deploy Preview y que la función está desplegada, pero por sí solo no prueba una generación. La validación autenticada real se completó posteriormente mediante Theory Compiler, Question Generator y Campaign Planner; la evidencia y el resultado se detallan en el cierre de etapa incluido más abajo.

El workflow temporal de smoke fue eliminado después de la verificación.

## Fuera de alcance

Etapa 4 no:

- publica campañas reales en Meta;
- configura Ads/AdSets/Campaigns en Meta Marketing API;
- edita o renderiza videos;
- sube contenido a Drive;
- ejecuta Remotion;
- automatiza resultados;
- modifica WhatsApp;
- implementa Etapa 5 o posteriores.

## Preparación para la etapa siguiente

La salida estable para una etapa creativa posterior es el `CampaignPlan` aprobado y su conjunto de `CreativePieces`, siempre enlazados a una CampaignProject y a una TheoryVersion fija. Una etapa posterior debe consumir ese contrato aprobado en lugar de volver a inferir estrategia desde cero.

## VALIDACIÓN FINAL / CIERRE DE ETAPA 4 — 31/08/2026

### Comportamiento esperado verificado

El flujo de usuario validado es:

`CampaignProject de QA → TheoryVersion activa fijada → preguntas mínimas → respuestas → CampaignPlan draft → edición manual → aprobación → regeneración en una revisión nueva`.

La prueba autenticada se ejecutó como administrador en el Deploy Preview de Etapa 4 y utilizó OpenAI real con `gpt-5.6-luna`. No se usaron fixtures, mocks ni endpoints sin autenticación. El Question Generator produjo dos preguntas estructuradas (`commercial_objective` y `cta`) y el Campaign Planner produjo planes que superaron Structured Outputs, validación de dominio y persistencia Firestore. La v2 activa exigía 6 hooks y el resultado persistido incluyó exactamente 6 `hooks`, 1 `main_body` y 1 `closing`; `voice_over` era opcional con `recommendedCount = 0`.

La edición manual del resumen se guardó sin llamar nuevamente a OpenAI y persistió después de una recarga completa. La aprobación dejó la revisión sin acción de edición. La regeneración creó una revisión draft nueva y conservó la revisión aprobada anterior. La UI ahora expone un selector `rN · Aprobada/Borrador` para abrir el historial sin sobrescribir revisiones.

### Bugs encontrados y corregidos

1. **Inicio de planificación rechazado por Firestore.** El servicio iniciaba la planificación con un batch que actualiza el CampaignProject y crea `planning/state`. La Rule comparaba la TheoryVersion contra `get(...)`, que veía el documento anterior al batch y por eso rechazaba la creación. Se cambió a `getAfter(...)` y se agregó una prueba que reproduce el batch real completo. Las Rules corregidas se publicaron únicamente en `app-integral-fm` con `--only firestore:rules`.
2. **Detalle de metodología desactualizado después de procesar, guardar, aprobar o activar.** `reload(version.id)` mantenía el mismo `selectedId`; el efecto dependiente del id no volvía a leer la versión. `reload` ahora recupera explícitamente la versión seleccionada y sincroniza estado, fuente y editor JSON.
3. **Plan desactualizado después de edición manual.** Firestore persistía el cambio pero el componente seguía mostrando el objeto anterior hasta recargar. El callback de guardado ahora vuelve a cargar el workspace.
4. **Historial de CampaignPlan no navegable.** Las revisiones ya se preservaban en Firestore, pero la interfaz sólo mostraba la última. Se agregó navegación por revisión para comprobar la anterior y la inmutabilidad de una aprobada.
5. **Cobertura incompleta de categoría dinámica.** La documentación mencionaba `product_demo`, pero faltaba una prueba explícita. Se agregó junto con pruebas de roles e idempotencia temporal.

### Evidencia automática final

- `npm test`: **219/219 PASS**.
- Firestore Rules Emulator: **46/46 PASS**.
- `npm run build`: **PASS** (1776 módulos; sólo advertencia no bloqueante por tamaño de chunk).
- HTTP `/`: **200**.
- HTTP `/gestion/marketing/meta-ads`: **200**.
- health del Planner: **200**, `configured=true`, modelos de preguntas y plan `gpt-5.6-luna`.
- POST anónimo a `generateQuestions`: **401 unauthenticated**.
- Rules desplegadas: **`app-integral-fm`**, exclusivamente `firestore:rules`.

### Evidencia funcional real

- Metodología `Metodología de prueba`: v1 histórica y v2 activa, con TheoryConfig persistido después de recarga.
- CampaignProject `QA ETAPA 4 — OPENAI — NO USAR` (`nS9HcQ96MYQbvtdzNwiB`): preguntas reales, respuestas, dos CampaignPlan generados, edición manual, aprobación y regeneración verificadas.
- CampaignProject auxiliar `QA ETAPA 4 — NO USAR` (`vGQAE38UPGtI9LJF4XDN`): conservado en planificación con v1 fijada para demostrar que activar v2 no cambia una campaña ya iniciada.
- Los CampaignProject de QA no se eliminaron. El archivado lógico existente sólo admite campañas en `draft`; después de iniciar planificación la UI no ofrece archivo, por lo que quedan claramente identificados para no mezclarlos con campañas reales.
- El write de `AIUsage` forma parte del mismo batch que persiste preguntas/plan; si esa escritura hubiera sido rechazada, la operación completa no habría llegado al estado observado.
- Mobile 390×844: ancho de documento y contenido iguales, sin overflow horizontal; tabs y tarjetas creativas quedaron dentro del viewport. Desktop se volvió a comprobar después de resetear el viewport.

### Contrato para repetir esta QA

Usar una cuenta admin o `marketing_manager`, una campaña marcada como QA con producto canónico y una metodología activa cuya `questionPolicy.requiredFields` incluya al menos un dato faltante. `Preparar preguntas` debe devolver preguntas reales y persistirlas; después de responder, `Preparar estrategia` debe producir un draft con cantidades exactamente iguales a `creativeRequirements[].recommendedCount`. Editar el draft debe persistir sin consumo de IA; aprobar debe retirar la edición; regenerar debe crear `rN+1` y el selector de historial debe seguir permitiendo abrir `rN`.

### Verificación del artefacto corregido

El commit funcional `4dfd08b` se publicó en `feature/meta-ads-campaign-planner` y se validó mediante el PR auxiliar draft `#17`, marcado **NO MERGE**. Netlify generó `https://deploy-preview-17--appintegralflormia.netlify.app` correctamente. El smoke del artefacto devolvió HTTP 200 en `/`, `/gestion/marketing/meta-ads` y el health del Planner; este último informó `configured=true` y modelos `gpt-5.6-luna`.

La verificación autenticada del Preview `#17` confirmó después de una recarga completa:

- CampaignPlan `r1` y `r2` visibles y seleccionables;
- `r1` conserva `[QA edición manual]` y no ofrece edición por estar aprobada;
- la campaña conserva estado `Creatividades` y vuelve a seleccionar la última revisión;
- la metodología conserva `v1 · Histórica` y `v2 · Activa`;
- la v1 histórica mantiene fuente y editor JSON deshabilitados y exige crear una versión nueva;
- la v2 conserva el TheoryConfig de 6 hooks, 1 cuerpo, 1 cierre y voice-over opcional;
- a 390×844, Conocimiento, producto canónico, metodología, historial y CampaignPlan no generan overflow horizontal; el ancho de documento se mantiene en 375 px.

El CI del PR auxiliar `#17` ejecuta el merge sintético contra el `main` actual, que incorporó posteriormente trabajo de Productos/Stock/Ubicaciones. Allí fallan cinco pruebas de esos módulos porque la rama apilada de Etapa 4 no contiene esas implementaciones más nuevas. No son fallos de Meta Ads ni del commit funcional: sobre la rama exacta de Etapa 4 la barrera permanece en 219/219 tests, 46/46 Rules Emulator y build PASS. No se mezclaron cambios ajenos a Etapa 4 para forzar ese PR auxiliar a verde.
