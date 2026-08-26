# Marketing → Meta Ads — Etapa 2

## Objetivo

Esta etapa agrega las fundaciones reales de `Marketing → Meta Ads` sin implementar todavía OpenAI, Google Drive, renderer local, Meta Marketing API ni Insights.

El flujo implementado es:

`Marketing → Meta Ads → CampaignProject → crear → listar → abrir → editar → archivar`.

WhatsApp permanece como capacidad separada y no se modifica su contrato interno.

## Decisión de modelo de datos

Se usa una colección específica:

`metaCampaignProjects/{campaignId}`

Se descartó reutilizar `campaigns` en esta etapa porque esa colección es consumida por `GenericModulePage` con un contrato genérico. Mezclar CampaignProjects de Meta con registros genéricos de Marketing obligaría a discriminar dos esquemas y reglas diferentes dentro de la misma colección y haría que los proyectos Meta aparezcan en consumidores existentes que no fueron diseñados para ellos.

La colección separada mantiene el contrato estricto, evita contaminación de Marketing actual y no agrega costo relevante en Spark.

## Schema v1

Campos escritos al crear un proyecto:

- `name`;
- `channel = "meta_ads"`;
- `status = "draft"`;
- `schemaVersion = 1`;
- `productId` o `null`;
- `productNameSnapshot` o `null`;
- `archived = false`;
- `createdBy`;
- `createdByName`;
- `createdAt`;
- `updatedBy`;
- `updatedByName`;
- `updatedAt`.

Al archivar se agregan `archivedAt`, `archivedBy` y `archivedByName` y el estado pasa a `archived`.

El snapshot de producto conserva sólo el nombre como contexto histórico mínimo. El catálogo canónico sigue siendo `products`; no se crea un catálogo de Meta.

## Estados

Los estados válidos están centralizados en `campaignProjectDomain.js`:

`draft`, `planning`, `creative`, `validation`, `rendering`, `ready`, `publishing`, `active`, `paused`, `completed`, `error`, `archived`.

La Etapa 2 no expone saltos artificiales hacia estados futuros. El usuario puede crear `draft`, editar sólo mientras está en `draft` y archivar `draft → archived`.

## Consultas y Spark

El listado usa:

- `orderBy("updatedAt", "desc")`;
- `limit(20)` por defecto;
- máximo 50;
- cursor con `startAfter`;
- botón “Cargar más”.

No se agregan listeners realtime. No se guardan arrays crecientes ni multimedia.

No se requiere índice compuesto nuevo: la consulta actual usa un único `orderBy` sobre la colección específica.

## Permisos

Se agregan al módulo `marketing`:

- `metaAdsView`;
- `metaAdsCreateProject`;
- `metaAdsEditProject`;
- `metaAdsArchiveProject`.

Acceso por plantilla:

- `admin`: sí;
- `general_admin`: sí;
- `marketing_manager`: sí;
- `operational_admin`: no por defecto;
- `seller`: no por defecto.

Los permisos explícitos continúan funcionando mediante el mecanismo actual de `permissions`. `permissionDeny` se aplica también en Rules a las acciones Meta Ads.

## Firestore Rules

`metaCampaignProjects` tiene contrato propio. Las Rules:

- requieren usuario activo;
- exigen permiso Meta Ads equivalente al frontend;
- validan lista cerrada de campos;
- validan `channel`, `schemaVersion`, estado y producto;
- fijan `createdBy` al usuario autenticado al crear;
- impiden cambiar `createdBy`, `createdAt`, `channel` y `schemaVersion` en updates;
- permiten editar sólo campos de Etapa 2 y sólo en `draft`;
- permiten únicamente `draft → archived` como transición manual de esta etapa;
- prohíben delete físico;
- rechazan campos desconocidos, incluyendo cualquier secreto/token.

Estas Rules fueron validadas con Emulator y desplegadas de forma controlada el 26 de agosto de 2026 exclusivamente al proyecto `app-integral-fm`, después de confirmar que `npm test`, Rules Emulator y build estaban en verde. El CLI confirmó `Deploy complete!` y luego se repitieron Rules Emulator y `npm test` con resultado exitoso. No se desplegaron Rules a `fm-stock-y-venta`.

## Auditoría

Crear, editar y archivar CampaignProjects escribe eventos en `auditLogs` con `moduleId = "marketing"` y `entityType = "metaCampaignProject"`.

## Netlify y secretos futuros

No se crean Functions vacías en Etapa 2 porque todavía no existe una operación backend real que las necesite.

Futuras integraciones requerirán variables server-only, nunca `VITE_*`, por ejemplo:

- `OPENAI_API_KEY`;
- `META_APP_SECRET`;
- `META_ACCESS_TOKEN` o credencial equivalente según el flujo definitivo;
- `GOOGLE_CLIENT_SECRET`;
- `RENDERER_SIGNING_SECRET`.

No se agregan valores ni secretos reales en esta etapa.

## Spike Meta — estado al 26 de agosto de 2026

### Confirmado mediante recursos oficiales de Meta disponibles

El workspace oficial de Meta en Postman para Marketing API documenta como requisitos una Facebook/Meta App, Access Token y Ad Account. También documenta `ads_read` y `ads_management` para administrar la propia cuenta publicitaria, y distingue Standard Access de Advanced Access cuando se administran cuentas de terceros.

Fuente: https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi

Los SDK oficiales de Meta mantienen el requisito de registrar una app y añadir Marketing API como producto; también recomiendan proteger llamadas server-side con App Secret Proof.

Fuente: https://github.com/facebook/facebook-nodejs-business-sdk

### Parcial / no verificado

La documentación directa de `developers.facebook.com` para Marketing API no pudo recuperarse de forma fiable desde el entorno de esta etapa. Por eso quedan deliberadamente abiertos para validación con documentación directa y cuenta real antes de Etapa 9:

- lifecycle exacto vigente de user/system-user tokens;
- expiración/renovación aplicable al flujo definitivo;
- permisos adicionales concretos que pudiera requerir Business Manager;
- App Review y Advanced Access exactos para Flor Mía;
- Business Verification aplicable al caso real;
- acceso real al Ad Account de Flor Mía;
- permisos necesarios para Campaigns, Ad Sets, Ads e Insights con la configuración final.

**META SPIKE PARCIAL — REQUIERE VERIFICACIÓN antes de integrar OAuth o ejecutar operaciones reales.**

## Limitaciones deliberadas

No existe todavía:

- Theory Engine;
- Campaign Planner IA;
- Google Drive;
- carga de videos;
- Validation Engine;
- renderer local;
- Video Director;
- OAuth Meta;
- Campaign/AdSet/Ad reales;
- Insights;
- recomendaciones IA.

La UI comunica estas ausencias explícitamente y no simula conexiones.

## Preparación para Etapa 3

Etapa 3 puede construir Knowledge Base + Theory Engine relacionando teoría/versiones con el `CampaignProject` ya existente, sin rehacer routing, permisos, servicios base ni el contenedor interno de campaña.
