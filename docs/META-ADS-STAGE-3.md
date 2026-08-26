# Meta Ads — Etapa 3: Knowledge Base + Theory Engine

## Base

Esta etapa se construye sobre el HEAD validado de Etapa 2 (`feature/meta-ads-foundations`), sin mergear el PR anterior sólo para comenzar. La rama de trabajo es `feature/meta-ads-theory-engine`.

## Knowledge Base

La base de conocimiento usa dos contratos específicos y referencias selectivas a datos existentes:

- `marketingKnowledge/businessContext`: contexto editable del negocio.
- `marketingProductProfiles/{productId}`: metadata de Marketing asociada por ID al catálogo maestro `products`.

El catálogo `products` continúa siendo la fuente de verdad. No existe una colección `metaProducts` ni se copian masivamente ventas, clientes, stock o métricas. La capa de conocimiento declara explícitamente que no incluye PII de clientes; futuras etapas deberán preferir segmentos, agregados y tendencias.

## Theory Engine

Modelo Firestore:

- `metaAdTheories/{theoryId}`: metadata ligera, `latestVersion`, `activeVersion` y estado.
- `metaAdTheories/{theoryId}/versions/{versionId}`: fuente, `TheoryConfig`, estado y metadata del compilador.
- `aiUsage/{usageId}`: operación, usuario, modelo, tokens, éxito/error y costo sólo cuando pueda calcularse de forma fiable.

Los listados cargan metadata acotada. El historial usa `orderBy(version desc)` y límite/cursor. La configuración completa se lee al abrir una versión o usarla. No se usan listeners globales ni escrituras de progreso porcentual.

## TheoryConfig v1

`TheoryConfig` está centralizado en `theorySchema.js` y expone el mismo contrato a dominio, cliente y Structured Outputs del backend. Incluye:

- `schemaVersion`;
- `platform`;
- `name` y `description`;
- `campaignRules[]`;
- `creativeRequirements[]` genéricos;
- `validationRules[]`;
- `questionPolicy`;
- `testingRules[]`;
- `recommendationRules[]`;
- `metadata`.

`creativeRequirements[].key` es dinámico. Hooks, bodies, endings, testimonials o product demos son datos de la teoría, no componentes codificados. Se validan cantidades, relaciones `min <= recommended <= max`, duraciones, claves desconocidas y contenido potencialmente peligroso. Para mantener Rules simples y acotadas en Spark, cada grupo de reglas/requisitos queda limitado a 20 elementos.

## Versionado y activación

Estados implementados:

`draft → compiling → review → approved → active → archived`

También existe `error` para fallos del compilador y reintento controlado.

Una versión activa o histórica no se edita silenciosamente. La modificación parte de una nueva versión draft. Activar una nueva versión se realiza en transacción: la activa anterior pasa a histórica y la nueva queda activa. El contenido histórico no se reescribe. Una versión histórica puede reactivarse sin cambiar su contenido.

La IA sólo lleva una versión a `review`; aprobación y activación son acciones humanas separadas.

## Entradas

Se aceptan:

- texto;
- Markdown;
- editor interno;
- PDF textual.

El PDF se procesa lazy en el navegador. No se guarda el binario en Firestore. Límites: 3 MB, 80 páginas y 60.000 caracteres. Si no se obtiene texto suficiente se informa `Este PDF no contiene texto extraíble` y no se simula OCR.

## OpenAI backend

Ruta: `/.netlify/functions/theory-compiler`.

Flujo:

`Firebase user → ID token → Netlify Function → validar sesión/perfil/permiso → OpenAI Responses API → Structured Output → validación server → validación cliente/dominio → review`.

La función usa `OPENAI_API_KEY` sólo del entorno server-side. Nunca se lee desde `VITE_*`. El modelo está centralizado mediante `OPENAI_THEORY_MODEL`; el valor por defecto implementado es `gpt-5.6-luna`.

El source se delimita como datos no confiables. Las instrucciones del compilador prohíben obedecer prompt injection, solicitar secretos, ejecutar herramientas o modificar sistemas. La función no ofrece herramientas al modelo y usa `store: false`.

Protecciones implementadas:

- autenticación Firebase real;
- perfil activo y permiso `metaAdsManageTheory`;
- proyecto Firebase fijado a `app-integral-fm`;
- máximo 60.000 caracteres;
- request body acotado;
- un procesamiento concurrente por usuario/instancia;
- máximo 3 inicios por minuto por usuario/instancia caliente;
- timeout de 45 s;
- Structured Outputs estricto;
- validación de schema antes de devolver/persistir;
- logs sin prompts ni secretos.

## Costos y AIUsage

Antes del procesamiento la UI muestra modelo y estimación aproximada de tokens. Si no se configuraron precios fiables, el costo aparece como `NO CALCULADO`.

Variables opcionales para cálculo:

- `OPENAI_THEORY_INPUT_USD_PER_MTOK`;
- `OPENAI_THEORY_OUTPUT_USD_PER_MTOK`.

No se hardcodean precios que puedan quedar obsoletos. `aiUsage` registra tokens reales devueltos por OpenAI, usuario, modelo, operación, éxito/error y costo sólo cuando existe configuración de precios válida.

## Permisos

Nuevas acciones:

- `metaAdsManageKnowledge`;
- `metaAdsManageTheory`.

Admin/general admin conservan acceso total. `marketing_manager` recibe ambas acciones por plantilla. Seller no recibe acceso. `permissionDeny` prevalece. Rules y frontend aplican el mismo criterio.

## Firestore Rules

Las Rules nuevas son aditivas sobre los contratos existentes de ventas, stock, clientes, ubicaciones, WhatsApp y CampaignProject. Protegen:

- payloads y ownership de Knowledge;
- referencia del perfil de producto a un producto real;
- esquema y estados de Theory;
- inmutabilidad de identidad/versiones;
- transiciones permitidas;
- estructura anidada de TheoryConfig, cantidades y duraciones;
- AIUsage inmutable y propiedad del usuario.

No se habilita delete físico.

## Índices

No se agregó ningún índice compuesto. Las consultas de esta etapa usan ordenamiento simple por un solo campo (`updatedAt` o `version`) más límite/cursor, por lo que no se justifica desplegar índices hipotéticos.

## Configuración requerida

Para compilación real con IA se necesita en Netlify:

`OPENAI_API_KEY`

No debe configurarse con prefijo `VITE_`, copiarse al repositorio ni compartirse en logs o documentación.

## Fuera de alcance

No se implementaron Campaign Planner, preguntas dinámicas, estrategia, guiones, hooks/bodies/endings como tareas, Google Drive, multimedia, videos, Validation Engine, FFmpeg/renderer, Meta Marketing API, Insights ni recomendaciones IA.

## Etapa 4

Cuando esta etapa haya sido validada de extremo a extremo, Campaign Planner + Question Generator podrán consumir:

- `BusinessContext`;
- `ProductContext` canónico + metadata de Marketing;
- una referencia inmutable `theoryId / theoryVersionId / theoryVersion` y su `TheoryConfig`.

Las campañas históricas no reciben automáticamente una teoría nueva ni cambian retroactivamente de metodología.
