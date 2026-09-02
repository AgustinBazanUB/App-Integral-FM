# Meta Ads — Etapa 5: Workspace Creativo + Google Drive

## Estado

**ETAPA 5 IMPLEMENTADA Y VALIDADA TÉCNICAMENTE — CIERRE BLOQUEADO POR CONFIGURACIÓN EXTERNA Y PUBLICACIÓN DE RULES.**

El QA final del 2 de septiembre de 2026 confirmó la implementación y dejó verdes las suites locales. La Etapa 5 todavía no se declara cerrada porque Google Drive no está configurado en Netlify, no se pudo ejecutar el flujo real OAuth/upload y Firebase devolvió `503` al intentar publicar las Rules en `app-integral-fm`.

## Objetivo

Etapa 5 convierte el `CampaignPlan` aprobado de Etapa 4 en un Workspace Creativo operativo. El sistema organiza cada `CreativePiece` como una `RecordingTask`, guía al usuario sobre qué grabar, permite cargar varias tomas y guarda el archivo real en Google Drive mientras Firestore conserva únicamente metadata y referencias.

Flujo:

```text
CampaignProject
  ↓
CampaignPlan aprobado + TheoryVersion fija
  ↓
CreativePieces[]
  ↓
RecordingTaskGenerator determinista
  ↓
RecordingTasks[]
  ↓
Workspace Creativo
  ↓
Browser solicita autorización de upload
  ↓
Netlify valida sesión/permisos/campaña/tarea y crea sesión resumible
  ↓
Browser ─────────────── archivo ───────────────> Google Drive
  ↓                                               ↓
confirmación metadata <──── Netlify/Drive API <── fileId
  ↓
CreativeAsset metadata en Firestore
  ↓
RecordingTask.selectedAssetId + ready_for_validation
```

Netlify es **control plane**. No recibe el binario del video como data plane.

## Base utilizada

- Base validada: `feature/meta-ads-campaign-planner`.
- HEAD validado de Etapa 4: `e8734ce748249b3830926e0ef8338fb9cb5ef644`.
- PR de Etapa 4: `#13`.
- Evidencia heredada de cierre de Etapa 4: 219/219 tests de aplicación, 46/46 Rules Emulator y build PASS.
- Rama de Etapa 5: `feature/meta-ads-creative-workspace`.

No se reconstruyen CampaignProject, Knowledge Base, Theory Engine, Question Generator, Campaign Planner ni AIUsage. Etapa 5 consume sus contratos existentes.

## Principio arquitectónico

Se mantiene **motor estable + teoría variable**. La UI y la estructura Drive consumen `requirementKey`, label e información de `TheoryConfig.creativeRequirements`; no dependen de una lista cerrada de hooks/bodies/endings.

Hay alias de presentación centralizados para categorías frecuentes, pero una nueva categoría como `testimonial`, `product_demo`, `ugc_creator` u otra key válida funciona sin crear un componente React nuevo.

## RecordingTaskGenerator

`src/gestion/marketing/metaAds/creativeWorkspaceDomain.js` implementa generación determinista a partir de:

- CampaignProject/campaignId;
- CampaignPlan **approved**;
- `plan.creativePieces[]`;
- TheoryConfig fijada a la campaña.

Cada tarea conserva solamente el snapshot necesario para producción e historia:

```text
RecordingTask
├── schemaVersion
├── id                       # r{revision}-{creativePieceId}
├── campaignId
├── sourcePlanRevision
├── creativePieceId
├── requirementKey
├── category
├── order
├── orderWithinCategory
├── title
├── script
├── objective
├── instructions
├── targetDurationSeconds
├── requirements[]
├── required
├── mediaKind                # video | audio | image
├── allowedMimePrefixes[]
├── acceptedExtensions[]
├── status                   # pending | ready_for_validation | error
├── selectedAssetId?
└── driveFolderId?
```

El id incluye la revisión del CampaignPlan, por lo que una revisión nueva no sobrescribe silenciosamente tareas históricas.

## Idempotencia de tareas

`prepareWorkspace` vuelve a calcular el conjunto esperado para la revisión aprobada y sólo crea los IDs ausentes. Abrir o recargar la pantalla no duplica tareas.

Si se aprueba una revisión posterior, sus tareas reciben IDs `rN-*`; las tareas/assets anteriores quedan históricas. `currentWorkspace` filtra la revisión aprobada actual y expone contadores de historia previa.

## Workspace Creativo

`src/gestion/pages/MetaAdsCreativeWorkspace.jsx` se integra al detalle de CampaignProject cuando la campaña está en estado `creative`.

La pantalla:

- agrupa dinámicamente por categoría/`requirementKey`;
- muestra título comprensible;
- muestra **Qué decir**, **Cómo hacerlo**, **Para qué sirve** y duración ideal;
- muestra requisitos;
- muestra estado Pendiente / Subiendo / Listo para validar / Error;
- permite seleccionar archivo o captura estándar desde móvil cuando el navegador lo ofrece;
- muestra progreso local sin escribir porcentajes a Firestore;
- permite varias tomas;
- permite seleccionar otra toma preferida sin mover ni borrar archivos;
- ofrece `Abrir en Drive` mediante `driveFileId`.

No se implementó un proxy multimedia pesado. Para esta etapa el fallback seguro de preview es metadata + abrir el archivo en Drive.

## CreativeAsset

Los archivos no viven en Firestore. Firestore guarda metadata equivalente a:

```text
CreativeAsset
├── schemaVersion
├── id
├── campaignId
├── recordingTaskId
├── creativePieceId
├── requirementKey
├── sourcePlanRevision
├── driveFileId
├── driveFolderId
├── driveId?
├── driveFileName
├── originalFileName
├── mimeType
├── sizeBytes
├── takeNumber
├── status                   # ready_for_validation | error
├── uploadedBy
├── uploadedByName
├── uploadedAt
├── driveCreatedAt?
├── createdAt
└── updatedAt
```

El validador rechaza campos con nombres de token, secret, resumable/session URL u otras credenciales.

## Multiple Takes

Cada `RecordingTask` admite múltiples `CreativeAsset`.

Ejemplo:

```text
Hook 1
├── Toma 1  ← preferida
├── Toma 2
└── Toma 3
```

`takeNumber` aumenta sin sobrescribir archivos anteriores. `selectedAssetId` vive en la RecordingTask y cambiar la toma preferida es una actualización liviana de metadata.

Una falla al subir una toma adicional no invalida una tarea que ya tenía una toma válida seleccionada.

## Tipos de archivo y validación local liviana

La política de medios se deriva de la requirement:

- video: mp4, mov, m4v, webm;
- audio: mp3, wav, m4a, aac, ogg;
- imagen: jpg/jpeg, png, webp, heic.

VoiceOver/audio se reconoce como audio; requirements de imagen se reconocen como imagen; el resto usa video por defecto. La validación de Etapa 5 sólo comprueba archivo, tamaño, MIME y extensión compatibles.

No analiza codec, FPS, audio interno, silencios, transcripción ni contenido. Eso corresponde a Etapa 6.

## Tamaño de archivo

El límite de aplicación por defecto es **1 GiB** (`META_ADS_MAX_UPLOAD_BYTES=1073741824`) y está centralizado/configurable server-side. El backend sólo acepta una configuración dentro de un rango defensivo y el frontend muestra el límite devuelto por health/workspace.

La decisión prioriza clips creativos reales, UX móvil y evitar cargas accidentales gigantes. No pretende reflejar el límite máximo teórico de Google Drive.

Chunks por defecto: 8 MiB (`META_ADS_UPLOAD_CHUNK_BYTES=8388608`), normalizados a múltiplos de 256 KiB.

## Google Drive: decisión My Drive / Shared Drive

La primera versión usa **una conexión organizacional única** y funciona por defecto con **My Drive**. Esto reduce configuración para Flor Mía si se utilizará una única cuenta de Google.

El núcleo no queda bloqueado a My Drive:

- conserva `driveId?`;
- usa `supportsAllDrives=true` en operaciones compatibles;
- permite configurar `GOOGLE_DRIVE_SHARED_DRIVE_ID`;
- cambia el modo reportado a `shared_drive` cuando esa variable existe.

Por lo tanto Shared Drive puede adoptarse sin reconstruir RecordingTask/CreativeAsset.

## Scope Google

Scope seleccionado:

`https://www.googleapis.com/auth/drive.file`

Se usa por menor privilegio: la app trabaja con archivos/carpetas que crea o que el usuario abre/autoriza para esta integración, en lugar de solicitar acceso general a todo Drive por comodidad.

Si un caso futuro exige operaciones fuera de ese alcance deberá revisarse explícitamente; Etapa 5 no amplía el scope a `drive`.

## OAuth 2.0

Flujo implementado:

```text
Admin autorizado
  ↓
Conectar Google Drive
  ↓
POST autenticado a Netlify
  ↓
state aleatorio backend-only + TTL
  ↓
Google Authorization Endpoint
  ↓
Authorization Code
  ↓
/.netlify/functions/google-drive-callback
  ↓
validación state/provider/expiración
  ↓
intercambio server-side con client secret
  ↓
prueba de Drive + carpeta raíz
  ↓
refresh token cifrado backend-only
  ↓
connection metadata no secreta
```

Se usa Authorization Code Flow para web server/confidential client, `state`, `access_type=offline`, redirect URI exacto, client secret sólo server-side y refresh token renovable.

No se expone `GOOGLE_CLIENT_SECRET` al navegador ni existe una variable `VITE_*` para secretos de Google. PKCE no se agregó como pseudo-seguridad en el frontend: el código de autorización se procesa únicamente en el backend confidencial que posee client secret; `state` y redirect controlado cubren la protección del flujo implementado. Si la política oficial o el tipo de cliente cambia en el futuro, este punto debe reevaluarse.

## Redirect URI y Deploy Preview

Google exige redirect URI autorizada exacta; no se diseñaron wildcards inseguros para previews.

`GOOGLE_OAUTH_REDIRECT_URI` debe apuntar a un callback HTTPS estable autorizado en Google Cloud. El `state` guarda también el `returnUrl` de la sesión que inició la conexión, limitado a `/gestion/settings`, de modo que el callback pueda retornar al entorno iniciador sin convertir el redirect registrado en un wildcard.

## Seguridad de tokens

Refresh tokens:

- nunca se guardan en frontend, localStorage o sessionStorage;
- nunca se guardan en CampaignProject;
- nunca se guardan plaintext en documentos legibles por clientes;
- nunca se imprimen en logs.

Persistencia backend-only:

`integrationSecrets/googleDrive`

Campo sensible:

`encryptedRefreshToken`

Cifrado: AES-256-GCM con IV aleatorio y authentication tag. La clave proviene únicamente de `GOOGLE_TOKEN_ENCRYPTION_KEY` server-side; la clave no se almacena en Firestore.

Las Rules preparadas niegan toda lectura/escritura cliente sobre `integrationSecrets`, `integrationOauthStates` y `creativeUploadSessions`.

## DriveService / control plane

Responsabilidades implementadas entre `netlify/functions/_lib/googleDrive.mjs` y `netlify/functions/google-drive.mjs`:

- status/health;
- OAuth start/callback;
- refresh access token;
- cifrado/descifrado refresh token;
- revocación/desconexión;
- crear/reusar root folder;
- crear/reusar folder de campaña;
- crear/reusar folders de categorías;
- iniciar resumable upload;
- verificar metadata real del fileId después del upload;
- confirmar CreativeAsset;
- seleccionar toma;
- auditoría segura.

Se usan APIs HTTP y Web APIs; no se añadió un SDK grande de Google.

## Estructura Drive

Estructura real conceptual:

```text
Meta Ads/
└── Campaign-{campaignId}/
    ├── Source/
    ├── {Dynamic Category 1}/
    ├── {Dynamic Category 2}/
    ├── ...
    ├── Renders/
    └── Final/
```

Aliases amigables centralizados:

- hook → `Hooks`;
- main_body/body → `Bodies`;
- ending/closing → `Endings`;
- b_roll → `B-Roll`;
- voice_over → `VoiceOver`;
- testimonial → `Testimonials`;
- product_demo → `Product-Demo`.

Para categorías nuevas se usa label/key saneado. El identificador de seguridad siempre es `folderId`, no el nombre visible.

`Renders` y `Final` se crean como estructura preparatoria de archivos; **Etapa 5 no renderiza ni edita video**.

## Idempotencia Drive

La carpeta raíz se registra en `integrationConnections/googleDrive.rootFolderId`.

Cada CampaignProject guarda referencias como:

- `driveFolderId`;
- `driveConnectionId`;
- `driveId?`;
- `driveProvisionedAt`;
- `driveStructure` con IDs de subcarpetas.

Si los IDs existen se verifican y reutilizan. No se hace una búsqueda global de toda la unidad en cada visita.

## Upload resumible directo

Contrato:

1. browser valida metadata básica;
2. browser solicita `createUpload` con campaignId/taskId/nombre/MIME/tamaño;
3. backend valida Firebase ID token, usuario activo, permiso, campaña, revisión, tarea, tipo/tamaño y folder confiable;
4. backend refresca acceso a Drive e inicia sesión resumible;
5. browser recibe la `sessionUrl` temporal;
6. browser sube chunks **directamente a Google Drive** usando `PUT` + `Content-Range`;
7. 308 reanuda desde el offset confirmado; fallas recuperables consultan posición; 404 obliga a iniciar nueva sesión;
8. browser envía `uploadId` + `driveFileId` al backend;
9. backend lee metadata real de Drive y verifica appProperties, nombre, MIME, tamaño y parent folder;
10. sólo entonces persiste CreativeAsset y actualiza la RecordingTask.

La URL de sesión resumible se considera credencial temporal: se devuelve al usuario autorizado, no se persiste en Firestore y no se registra en logs.

## Aislamiento de campañas

El frontend no decide libremente el folder destino. El backend resuelve/valida `driveFolderId` desde CampaignProject y RecordingTask confiables.

Antes de emitir una sesión verifica:

- Firebase ID token;
- usuario activo;
- permiso de upload;
- CampaignProject existente/no archivado;
- `status=creative`;
- CampaignPlan actual aprobado;
- RecordingTask de esa campaña y revisión;
- folder Drive asociado a esa campaña/tarea;
- MIME/extensión/tamaño.

En confirmación vuelve a validar identidad mediante `appProperties` de Drive. Cambiar IDs en el navegador no debe permitir escribir en otra campaña.

## Firestore

Modelo preparado:

```text
metaCampaignProjects/{campaignId}
├── planning/state                     # Etapa 4
├── plans/{revision}                   # Etapa 4
├── recordingTasks/{taskId}            # Etapa 5
└── creativeAssets/{assetId}            # Etapa 5

integrationConnections/googleDrive      # metadata no secreta
integrationSecrets/googleDrive          # backend-only
integrationOauthStates/{state}          # backend-only, temporal
creativeUploadSessions/{uploadId}       # backend-only, temporal, SIN sessionUrl
```

No se guardan binarios ni arrays gigantes en CampaignProject. El workspace lee sólo tareas/assets de la campaña abierta, con límite acotado. No hay listener global.

## Firestore Rules

Etapa 5 prepara cambios en `firestore.rules` para:

- permitir lectura de `recordingTasks` y `creativeAssets` sólo con `metaAdsViewCreativeWorkspace`;
- negar escrituras cliente de ambos: las mutaciones sensibles pasan por backend autenticado;
- permitir lectura de connection metadata según permiso;
- negar completamente secretos, OAuth state y upload sessions al cliente;
- incorporar permisos de workspace respetando `permissionDeny`.

**ESTADO DE QA: 50/50 tests del Rules Emulator PASS.**

La publicación se intentó dos veces exclusivamente contra `app-integral-fm`. En ambas oportunidades las Rules compilaron, pero `firebaserules.googleapis.com` respondió HTTP `503` antes de crear el ruleset. Por lo tanto, este cierre no afirma que las Rules de Etapa 5 estén publicadas.

## Índices

Etapa 5 no agrega índices compuestos. `firestore.indexes.json` no cambia respecto de la base de Etapa 4.

Las lecturas nuevas son subcolecciones acotadas por campaña y no necesitan un composite index en el contrato actual.

## Permisos

Acciones nuevas:

- `metaAdsViewCreativeWorkspace`;
- `metaAdsUploadCreative`;
- `metaAdsManageDrive`.

Comportamiento:

- admin/general admin: acceso completo por plantilla;
- marketing_manager: ver Workspace + subir/seleccionar material;
- marketing_manager: **no** administrar OAuth Drive por defecto;
- seller: sin acceso Meta Ads por defecto;
- permisos explícitos y `permissionDeny` siguen aplicando.

Frontend, backend y Rules preparadas reflejan la misma separación.

## Configuración / secretos

Variables server-only documentadas en `.env.example`:

```text
FIREBASE_SERVICE_ACCOUNT_JSON=
# también se reconoce FIREBASE_SERVICE_ACCOUNT_APP_INTEGRAL_FM si ya existe en el entorno
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=
GOOGLE_TOKEN_ENCRYPTION_KEY=
GOOGLE_DRIVE_ROOT_FOLDER_NAME=Meta Ads
GOOGLE_DRIVE_SHARED_DRIVE_ID=
META_ADS_MAX_UPLOAD_BYTES=1073741824
META_ADS_UPLOAD_CHUNK_BYTES=8388608
```

No se guardan valores reales en GitHub.

## Configuración externa de Google Cloud

Si todavía no existe:

1. abrir Google Cloud Console con el proyecto organizacional elegido;
2. habilitar **Google Drive API**;
3. configurar OAuth consent screen / Google Auth Platform según la cuenta/organización;
4. crear un OAuth Client de tipo **Web application**;
5. registrar como Authorized redirect URI exactamente el valor HTTPS de `GOOGLE_OAUTH_REDIRECT_URI`;
6. colocar Client ID y Client Secret únicamente en variables server-side de Netlify;
7. generar una clave aleatoria fuerte para `GOOGLE_TOKEN_ENCRYPTION_KEY` y guardarla sólo server-side;
8. verificar que la cuenta de servicio Firebase configurada corresponda exactamente a `app-integral-fm`;
9. si se decide Shared Drive, configurar `GOOGLE_DRIVE_SHARED_DRIVE_ID` y confirmar que la cuenta autorizada tenga acceso suficiente.

No usar `fm-stock-y-venta`.

## Desconexión / reconexión

Desconectar:

- intenta revocar la credencial Google;
- elimina el refresh token cifrado local;
- marca la integración desconectada;
- conserva `driveFileId`, folders y archivos históricos;
- nunca borra masivamente Drive.

Si Google invalida el refresh token, el sistema muestra que debe reconectarse y conserva referencias históricas.

## Auditoría

Eventos útiles registrados sin secretos:

- workspace preparado;
- campaign Drive provisioned;
- upload completed;
- upload failed;
- asset selected;
- Drive connected;
- Drive disconnected.

No se registran access tokens, refresh tokens ni URLs resumibles.

## Performance / Spark

- binario: browser → Google Drive;
- Netlify: autorización, OAuth, metadata y coordinación;
- porcentaje: sólo estado local React/browser;
- Firestore: hitos y metadata, no 1%, 2%, 3%...;
- tareas/assets: sólo por campaña abierta;
- no listener global;
- no nueva dependencia grande de Google;
- Workspace/CSS permanecen dentro del chunk de Meta Ads ya cargado bajo la ruta del módulo.

## Mobile y accesibilidad

La UI tiene breakpoint móvil, tarjetas de una columna, acciones grandes, progress nativo, labels/estado legibles, botones reales, `role=status/alert` donde corresponde y file input estándar.

Para video se usa `capture="environment"` como sugerencia estándar cuando el navegador móvil la soporte; no se depende de APIs experimentales.

El CSS responsive y los contratos de UI están cubiertos por revisión y tests. El QA visual autenticado real en desktop/móvil queda pendiente porque el Preview 19 requiere una sesión de administrador y la integración Drive aún no está configurada.

## Evidencia de implementación previa

Workflow final liviano: `Stage 5 final light verification`, run `33647855405`.

Resultados finales sobre código de Etapa 5:

- tests focalizados: **16/16 PASS**;
- RecordingTaskGenerator: 3 piezas → 3 tareas;
- categoría dinámica `testimonial`;
- folder mapping dinámico;
- file naming seguro;
- validación de MIME/tamaño;
- CreativeAsset sin secretos;
- OAuth `drive.file` + offline + state;
- AES-GCM refresh token;
- resumable backend sin binario;
- browser directo a session URL;
- session URL no persistida;
- cliente sin escrituras sensibles;
- marketing_manager sin administración OAuth por defecto;
- toma adicional fallida conserva una toma válida previa;
- health acepta la credencial Firebase server-side ya usada por el proyecto;
- callback valida proveedor del OAuth state;
- `node --check`: PASS;
- `git diff --check`: PASS;
- `npm run build`: **PASS**, 1780 módulos.

Esta evidencia fue reemplazada por el QA final exhaustivo documentado al final de este archivo.

La vulnerabilidad high heredada de `nanoid 3.3.16` fue corregida durante el QA final actualizando el lockfile a `nanoid 3.3.18`, sin ampliar rangos directos ni agregar dependencias.

## Limitaciones deliberadas / fuera de alcance

Etapa 5 no implementa:

- Validation Engine;
- codec/FPS/resolución/transcripción/silencios;
- Renderer/FFmpeg/Remotion local;
- Video Director IA;
- selección IA de tomas;
- Meta Marketing API;
- Insights reales;
- recomendaciones IA automáticas.

El estado final de un asset es `ready_for_validation`, no `validated`.

La campaña permanece en `creative`; Etapa 5 no avanza automáticamente a validación.

## Reglas de producción

Durante la implementación y el QA de Etapa 5:

- no se hizo merge a `main`;
- se intentó publicar únicamente las Firestore Rules a `app-integral-fm`, pero Firebase respondió `503` y no confirmó publicación;
- no se desplegaron índices;
- no se tocó `fm-stock-y-venta`;
- no se simularon carpetas, archivos ni conexión Google real.

## Preparación para Etapa 6

El Validation Engine puede recibir, sin reconstruir almacenamiento:

```text
CampaignProject
  + TheoryVersion / TheoryConfig
  + CampaignPlan aprobado
  + RecordingTask
  + RecordingTask.requirements/script/targetDurationSeconds
  + selectedAssetId
  + CreativeAsset
  + driveFileId / mimeType / sizeBytes
  ↓
Validation Engine (Etapa 6)
```

El contrato estable para Etapa 6 es `RecordingTask + selected CreativeAsset + driveFileId`, con trazabilidad a campaign, CreativePiece, requirement y CampaignPlan revision.

## Próxima etapa

**Etapa 6 — Validation Engine, todavía no habilitada.**

No se implementó en este branch.

# QA FINAL / CIERRE ETAPA 5

## Identificación

- Fecha: 2026-09-02 (America/Buenos_Aires).
- Rama: `feature/meta-ads-creative-workspace`.
- HEAD inicial auditado: `93b769d992d5487e0880a4f374962d763114cdc2`.
- Commit técnico de correcciones: `bce3bbe`.
- PR funcional: #18, abierto, base `feature/meta-ads-campaign-planner`, sin merge.
- PR auxiliar de preview: #19, draft, base `main`, sin merge.
- Preview: `https://deploy-preview-19--appintegralflormia.netlify.app`.
- `main` no fue modificado.

## Barrera automática

Resultados obtenidos después de corregir el falso positivo inicial y agregar cobertura de Etapa 5:

- `npm ci`: PASS.
- `npm test`: 240/240 PASS en la barrera final.
- tests focalizados Workspace/Drive/OAuth: 21/21 PASS.
- Firestore Rules Emulator: 50/50 PASS, incluida la nueva suite `firestore.meta-ads-creative.rules.mjs`.
- `npm run build`: PASS, 1780 módulos.
- `git diff --check`: PASS.
- `npm audit`: 0 vulnerabilidades después de actualizar `nanoid` a 3.3.18.
- CI del HEAD inicial: `action_required`; debe revisarse nuevamente sobre el HEAD final.

## RecordingTasks, revisiones y categorías dinámicas

Se verificó que el generador:

- consume exclusivamente un CampaignPlan aprobado y la TheoryVersion fijada;
- crea exactamente una RecordingTask por CreativePiece;
- produce IDs deterministas `r{revision}-{creativePieceId}`;
- no cambia el resultado al ejecutarse nuevamente;
- separa una revisión nueva sin sobrescribir el histórico;
- acepta `hook`, `testimonial`, `product_demo` y categorías nuevas sin componentes específicos;
- rechaza una CreativePiece cuyo `requirementKey` no exista en TheoryConfig;
- conserva script, objetivo, instrucciones, duración, requisitos y trazabilidad de revisión.

El modelo mantiene RecordingTasks y CreativeAssets en subcolecciones de la campaña. No guarda binarios, tokens ni URL resumible. Las lecturas están acotadas a la campaña abierta y no utilizan listeners globales.

## Rules, permisos y aislamiento

La suite nueva confirma:

- admin y marketing_manager pueden leer el Workspace Creativo;
- seller, usuario inactivo y `permissionDeny` no pueden leerlo;
- ninguna identidad cliente, ni siquiera admin, puede crear o modificar RecordingTasks/CreativeAssets directamente;
- las mutaciones reales son backend-only y verifican campaña, tarea, revisión y asset;
- metadata de conexión puede leerse con permiso, pero secrets, OAuth states y upload sessions son inaccesibles;
- escrituras cruzadas entre campañas y escrituras directas de integración quedan denegadas.

No se necesitan índices nuevos para las consultas de Etapa 5 y `firestore.indexes.json` no fue modificado.

## Firebase real

- Proyecto confirmado por `.firebaserc` y Firebase CLI: `app-integral-fm` (`App Integral FM`).
- `fm-stock-y-venta` no fue tocado.
- Comando limitado ejecutado: `firebase deploy --only firestore:rules --project app-integral-fm`.
- Ambos intentos compilaron `firestore.rules`, pero finalizaron con HTTP `503` de `firebaserules.googleapis.com` al crear el ruleset.
- No hubo `Deploy complete`; por ello no hay post-deploy certificable.

## Configuración Google real en Netlify

La pantalla de Environment variables del proyecto `appintegralflormia` mostró únicamente `OPENAI_API_KEY`. El health real del Preview 19 devolvió:

```text
configured: false
firebaseBackendConfigured: false
redirectConfigured: false
scope: https://www.googleapis.com/auth/drive.file
mode: my_drive
```

Estado sin revelar valores:

```text
GOOGLE_CLIENT_ID: missing
GOOGLE_CLIENT_SECRET: missing
GOOGLE_OAUTH_REDIRECT_URI: missing
GOOGLE_TOKEN_ENCRYPTION_KEY: missing
Firebase Admin server-side: missing en el contexto del Preview 19
Google Drive API: no verificada
```

La ausencia de configuración impide conectar una cuenta real, crear carpetas reales y certificar un upload real o Multiple Takes end-to-end.

## OAuth y tokens

La implementación usa Authorization Code Flow server-side, `state` aleatorio de 256 bits, TTL de diez minutos, uso único antes del intercambio, redirect HTTPS, `access_type=offline`, `include_granted_scopes=true` y callback backend-only. Los tests verifican states ausentes, de otro provider, vencidos, callback sin code y errores seguros.

El scope real es `https://www.googleapis.com/auth/drive.file`, clasificado por Google como no sensible y recomendado para acceso limitado por archivo. Google también recomienda `offline` para obtener refresh tokens en aplicaciones web server y documenta el protocolo `308`/`Range` usado por las cargas resumibles:

- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/drive/api/guides/manage-uploads

El refresh token se cifra con AES-256-GCM en `integrationSecrets/googleDrive`; la clave queda separada en Netlify. Access tokens se refrescan y usan sólo en backend. Los logs registran códigos/estados, no credenciales. La session URL temporal se entrega al navegador autorizado para el upload directo, pero no se persiste ni se registra.

## Upload, carpetas y Multiple Takes

Por código y tests se verificó:

- Browser → Google Drive directo mediante chunks;
- Netlify sólo autoriza, inicia y confirma; no transporta el binario pesado;
- `Content-Range`, respuesta `308`, consulta de offset, reintentos y sesión vencida;
- validación backend de identidad, campaña, tarea, revisión, folder, MIME y tamaño;
- confirmación posterior contra metadata real de Drive y `appProperties`;
- naming saneado e identidad por folderId;
- nombres distintos para toma 1, 2 y 3;
- preservación de la toma previa y cambio de `selectedAssetId` sin borrar archivos.

No se pudieron verificar contra Drive real la carpeta raíz, carpeta de campaña, folders dinámicos, archivo final, tres tomas ni selección persistida porque falta la configuración externa indicada arriba.

## Desktop, mobile y regresiones

El Preview 19 carga correctamente y presenta el login. Sin credenciales de administrador disponibles en esta sesión no se afirmó QA autenticado del Workspace. La revisión de código/CSS confirma layout de una columna bajo 720 px, botones de ancho completo, input nativo con `capture=environment`, progreso accesible y errores inline; esto no reemplaza la validación visual real.

La suite de aplicación cubre login, Dashboard, ubicaciones, productos, stock, ventas, vendedores, clientes, métricas, WhatsApp, CampaignProject, Knowledge, Theory Engine, Campaign Planner, Settings y Ecommerce: PASS. El Rules Emulator incluye las regresiones previas: PASS.

## Bugs encontrados y corregidos

1. El test que aseguraba que `sessionUrl` no se persistiera incluía accidentalmente el bloque de respuesta al navegador por una delimitación frágil y finales de línea Windows. Se delimitó exactamente la escritura `adminSet`; la implementación nunca persistió esa URL.
2. No existía una suite del Emulator dedicada a Etapa 5. Se agregó cobertura de roles, denegaciones, secrets y mutaciones backend-only.
3. La validación de OAuth state estaba embebida y sólo cubierta estáticamente. Se extrajo una función pura usada por el callback y se probaron estados inválidos/vencidos y uso único.
4. La cobertura del generador no demostraba determinismo, revisiones históricas, cantidades por categoría ni toma 3. Se agregaron estos casos.
5. `nanoid 3.3.16` tenía una vulnerabilidad high corregible. El lockfile quedó en 3.3.18 y `npm audit` pasó a cero vulnerabilidades.

## Pendientes externos y veredicto

Pendientes obligatorios antes de Etapa 6:

1. Configurar en Netlify las cuatro variables Google y una credencial Firebase Admin de `app-integral-fm` para el contexto usado por Deploy Preview.
2. Confirmar que Drive API esté habilitada y registrar el redirect URI HTTPS exacto en un OAuth Client web.
3. Completar OAuth con la cuenta organizacional elegida y probar conexión.
4. Ejecutar carpeta raíz/campaña, upload real, tres tomas, selección/persistencia y QA desktop/mobile autenticado.
5. Reintentar el deploy de Rules cuando Firebase Rules API deje de devolver `503`, confirmar `Deploy complete` y repetir tests post-deploy.
6. Obtener CI verde sobre el HEAD final y confirmar el Preview actualizado.

**Veredicto: ETAPA 5 NO CERRADA.** La implementación técnica local está sana, pero faltan publicación de Rules, configuración/validación real de Drive y CI/preview final. No pasar al Prompt 6 hasta completar estos puntos.
