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

PR auxiliar en draft, sólo para CI/Preview: `#14`, base `main`, marcado explícitamente **NO MERGE**.

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

Esto confirma que `OPENAI_API_KEY` está presente en el contexto de Deploy Preview y que la función está desplegada. No demuestra que la cuenta de API tenga saldo/crédito disponible, porque el health no consume OpenAI y una generación real requiere una sesión Firebase autorizada y una campaña real en estado de planificación. Esa validación autenticada queda explícitamente pendiente en lugar de inventarse.

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