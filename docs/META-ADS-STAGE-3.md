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

### Contrato del Theory Compiler

La entrada del compilador es una fuente normalizada de metodología (`sourceText`, tipo y nombre de fuente) más el contexto de una versión `draft`, `review` o `error`. El texto siempre se trata como dato no confiable, aun si proviene de PDF o Markdown.

Una compilación procesada correctamente devuelve un `TheoryConfig` que supera el Structured Output estricto del servidor y `validateTheoryConfig` en cliente/dominio. Por lo tanto tiene `schemaVersion`, plataforma Meta Ads y colecciones estructuradas válidas; cada requisito creativo conserva cantidades coherentes y sus duraciones son numéricas y consistentes. Los conceptos de la fuente se expresan como datos: por ejemplo, hooks, cuerpo, cierre y voice-over pueden ser requisitos o instrucciones, pero no existen campos especiales codificados para un caso de prueba.

La función persiste el resultado sólo después de validarlo y deja la versión en `review`; nunca aprueba ni activa. Si la respuesta del proveedor, el parseo o la validación fallan, no se inventa una configuración: la versión queda en `error` con el error seguro para reintento controlado y conserva su fuente. En ese estado la persona autorizada puede corregir el texto o reintentar cuando se resuelva la dependencia externa.

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

El PDF se procesa lazy en el navegador al seleccionar el archivo. No se guarda el binario en Firestore: sólo se conserva el texto extraído, el nombre de fuente y su tamaño para crear o procesar una metodología. Límites: 3 MB, 80 páginas y 60.000 caracteres. Un PDF textual pequeño debe mostrar el feedback `PDF listo: … caracteres extraídos` y cargar el contenido en el editor antes de crear la versión. Un PDF escaneado o sin texto debe informar `Este PDF no contiene texto extraíble` y no se simula OCR ni se inventa contenido. Los errores de tipo, tamaño, páginas o extracción se muestran sin cerrar el modal.

El selector de PDF es un único control dentro de `FormField`; la explicación sobre el procesamiento local se entrega mediante su `hint`. Esto conserva la asociación accesible de etiqueta y control, y evita que el modal falle por tener más de un hijo directo.

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

Admin/general admin conservan acceso total. `marketing_manager` recibe ambas acciones por plantilla. Seller no recibe acceso. `permissionDeny` prevalece.

| Rol | Conocimiento | Metodologías | Dónde se aplica |
| --- | --- | --- | --- |
| `admin` / administrador general | Permitido | Permitido | Guard de ruta, servicios cliente, Netlify Function y Firestore Rules. |
| `marketing_manager` activo | Permitido | Permitido | Guard de ruta, servicios cliente, Netlify Function y Firestore Rules. |
| `seller` | Denegado | Denegado | No recibe `metaAdsView`; incluso al forzar la ruta, los servicios y Rules rechazan lectura/escritura. |
| Perfil inactivo o con `permissionDeny` | Denegado según la acción | Denegado según la acción | `permissionDeny` prevalece en frontend, función y Rules. |

La visibilidad de botones no es la única protección: `ManagementApp` bloquea la ruta de Meta Ads con `metaAdsView`; `knowledgeService` y `theoryService` vuelven a exigir permisos antes de leer o escribir; Firestore Rules verifican el perfil activo y el permiso. La Function exige el mismo permiso de gestión para compilar.

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

## Responsive

Las vistas de Conocimiento y Theory Engine conservan una cuadrícula de detalle en desktop y pasan a una columna en móvil. En pantallas angostas, las pestañas de Meta Ads permiten desplazamiento horizontal; formularios, acciones de diálogo, requisitos del preview e historial deben permanecer alcanzables con scroll normal, sin zoom obligatorio ni overflow horizontal del documento. La verificación manual mínima usa un viewport de 390 px: Conocimiento, selector de producto, lista/detalle de metodología, editor JSON, preview estructurado e historial.

## Regresión manual de Etapa 3

1. Como Admin o `marketing_manager`, crear o abrir una metodología en borrador y procesar este texto: `La campaña requiere 3 hooks. Cada hook debe durar entre 3 y 6 segundos. Debe existir 1 cuerpo principal. Se recomienda 1 cierre. El voice-over es opcional.` El resultado correcto es un `TheoryConfig` en `review` que represente esos requisitos semánticamente, sin activarse. Si el proveedor rechaza la credencial o no está configurado, marcar el flujo como bloqueo externo; no escribir un JSON manual para simular una respuesta IA.
2. En “Nueva metodología”, elegir PDF. El modal debe permanecer abierto y mostrar el control de archivo. Con un PDF textual pequeño, debe informar caracteres extraídos y cargar el texto antes de crear. Con un PDF de imagen/escaneado, debe informar que no contiene texto extraíble, sin crear ni guardar contenido inventado.
3. Repetir Conocimiento y Metodologías con sesiones reales de `admin`, `marketing_manager` y `seller`. Seller debe recibir “No autorizado” al forzar una URL de Meta Ads y Firestore debe rechazar la lectura/escritura.
4. A 390 px de ancho, recorrer Conocimiento, un producto, lista/detalle de metodología, preview, editor e historial. Confirmar que cada acción está alcanzable por scroll, que los diálogos se pueden cerrar y que no aparece scroll horizontal del documento. Terminar con smoke desktop de las mismas rutas.

## Validación funcional — Deploy Preview #11

El 28/08/2026 se validó manualmente el preview `feature/meta-ads-theory-engine` (`5fcef10`) en la aplicación Gestión integral | Flor Mía. Se publicaron las Rules de este documento en `app-integral-fm` antes de probar Knowledge y Theory Engine.

- Marketing mostró WhatsApp y Meta Ads; WhatsApp abrió sin envío real y Meta Ads mostró Campañas, Conocimiento y Metodologías. Se abrió una campaña preexistente.
- BusinessContext persistió un cambio mínimo tras recarga y se restauró el valor original.
- El producto real `Aceite de Oliva Arbequina 500cc` conservó su identidad de catálogo; su metadata de Marketing persistió sin duplicar el producto y se restauró el valor original.
- `Metodología de prueba` se creó como `v1 · Borrador`, no activa, y conservó el texto tras recarga. El procesamiento IA quedó disponible pero no se ejecutó.
- Los puntos posteriores al punto 6 quedan pendientes de un `TheoryConfig` procesado y validado por Terra; no se inventó ni se modificó uno manualmente.

La suite de aplicación pasó completa (`198/198`). La suite de Rules pasó `37/39` con el emulador Firestore compatible disponible; dos transiciones de TheoryConfig alcanzaron el límite de 1.000 expresiones del emulador antiguo. El archivo compiló en dry-run y las Rules fueron publicadas correctamente.

## Validación Terra — Theory Compiler, PDF, roles y responsive

El 28/08/2026 se intentó procesar `Metodología de prueba` en el Deploy Preview #11 con el texto de regresión de este documento. La Function respondió que el proveedor OpenAI rechazó la credencial configurada. La versión quedó en `error`, sin `TheoryConfig` fabricado, aprobación ni activación. Es un bloqueo externo: para reintentar se debe corregir la configuración server-side de la integración en Netlify, sin exponer ni pedir secretos.

### Corrección: selector de PDF textual

- **Comportamiento esperado:** elegir PDF mantiene el modal abierto, permite seleccionar un archivo y muestra el resultado de extracción.
- **Bug encontrado:** al seleccionar “PDF” el modal mostraba el error límite de la aplicación y no era posible llegar al selector de archivo.
- **Causa raíz:** `FormField` exige exactamente un hijo para asociar `label`, `id` y descripción. El caso PDF renderizaba el `input` y un párrafo hermano.
- **Solución:** el texto informativo se integró en `hint` y el único hijo directo quedó siendo el `input` de tipo archivo.
- **Archivos afectados:** `src/gestion/pages/MetaAdsTheoriesView.jsx`, `tests/meta-ads-theory-ui.test.mjs` y este documento.
- **Prueba automática:** `el selector PDF usa un único control FormField y no rompe el modal`.
- **Prueba manual:** se generaron un PDF textual pequeño y otro sólo de imagen; el extractor verificó texto en el primero y cadena vacía en el segundo. La repetición autenticada del selector en el Deploy Preview #12 requiere iniciar sesión en ese origen de preview; no se usaron credenciales ajenas ni se subieron archivos reales.
- **Resultado:** build y regresión pasan; la prueba de interfaz autenticada queda pendiente por esa sesión externa.

### Roles

La sesión Admin real abrió Conocimiento y Metodologías. La prueba de dominio cubre el guard de ruta y las tres acciones Meta Ads para `admin`, `marketing_manager` y `seller`; el test de Rules confirma lectura/escritura permitida para Marketing y denegada para Seller, inactivo y `permissionDeny`. No hubo sesión autenticada disponible para repetir en la UI como Marketing Manager o Seller, por lo que esas comprobaciones manuales quedan bloqueadas sin solicitar contraseñas.

### Responsive

Se hizo smoke desktop autenticado de la lista/historial de metodologías y las reglas responsive están documentadas arriba. La comprobación manual a 390 px y el preview estructurado quedan bloqueados: el control de navegador disponible no permite cambiar viewport y no existe TheoryConfig por el bloqueo externo de IA. No se declaró una corrección responsive sin haberla reproducido.

La suite de aplicación posterior pasó completa (`200/200`) y el build de producción pasó. La ejecución dedicada de Rules de Theory obtuvo `7/9`: las dos transiciones restantes alcanzaron el límite de 1.000 expresiones del emulador Firestore, el mismo límite externo ya observado; no se modificaron ni relajaron Rules seguras para ajustarse a ese emulador.

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
