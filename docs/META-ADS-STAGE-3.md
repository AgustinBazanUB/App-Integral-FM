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

## Validación funcional — Deploy Preview #12

El 28/08/2026 se reintentó el Deploy Preview #12 de `codex/stage3-validation` (`b604c90`) después de configurar `OPENAI_API_KEY` como secreto server-side para Deploy Previews en Netlify. El deploy finalizó correctamente: compilación, redirects, headers y la Function `theory-compiler` quedaron publicados. La clave no se leyó ni se incluyó en el repositorio, logs ni documentación.

### Theory Compiler

La preview autenticada como Admin abrió `Metodología de prueba` y verificó que la Function quedó configurada: muestra el modelo por defecto `gpt-5.6-luna`, la estimación de tokens y habilita el botón `Procesar con IA`. La fuente conserva exactamente la metodología de regresión: tres hooks de 3 a 6 segundos, un cuerpo principal, un cierre recomendado y voice-over opcional.

El procesamiento real quedó **pendiente de confirmación explícita** porque transmite esa metodología a OpenAI, consume créditos de la API y persiste el `TheoryConfig` en Firestore. Por eso la versión continúa en `error` por el intento anterior de credencial inválida; no se fabricó un JSON, no se aprobó ni activó una teoría. Una vez confirmado, el resultado esperado es una versión `review` cuyo `creativeRequirements` exprese semánticamente esos requisitos genéricos y que supere el schema en servidor y cliente.

### Bloqueo operativo — Campaign Planner en Deploy Preview #14

El 28/08/2026 se probó la preview `https://deploy-preview-14--appintegralflormia.netlify.app` con la sesión Admin. La campaña borrador `Prueba 2` (producto real: `Aceite de Oliva Arbequina 500cc`) carga correctamente el producto y permite abrir el área **Planificar campaña**. Sin embargo, el área muestra exactamente:

> No hay una metodología activa

El mensaje agrega: “Activá una metodología en Meta Ads → Metodologías antes de planificar una campaña.” La inspección de Metodologías confirma que la única metodología, `Metodología de prueba`, tiene `v1 · Error`, no posee `TheoryConfig` y no tiene una versión activa. La Function está disponible —la UI muestra `gpt-5.6-luna` y el botón `Procesar con IA` habilitado—, por lo que no es un error de routing, permisos, producto ni de la preview.

**Clasificación:** bloqueo operativo de datos/configuración de la metodología. El guard del Campaign Planner funciona como corresponde al impedir preguntas y generación de plan sin una referencia inmutable a una teoría activa. No corresponde simular preguntas, crear un `CampaignPlan` manual ni modificar código para saltear el guard.

**Cómo destrabarlo en un próximo chat:**

1. Con confirmación explícita para el consumo de API, abrir `Metodología de prueba` y pulsar `Procesar con IA`.
2. Si OpenAI devuelve un error de crédito o billing, registrar literalmente el mensaje y clasificarlo como `API sin saldo`; no corregir código.
3. Si responde correctamente, revisar que el `TheoryConfig` represente la fuente, aprobarlo y activarlo.
4. Volver a `Prueba 2` y recién entonces continuar la cadena `CampaignProject → preguntas → respuestas → CampaignPlan → aprobación`.

Esta secuencia guarda datos en Firestore y el primer paso consume créditos de OpenAI; no debe ejecutarse sin autorización vigente del usuario.

### Corrección: PDF textual

- **Comportamiento esperado:** elegir PDF mantiene el modal abierto, permite seleccionar un archivo y carga únicamente texto extraíble; un escaneado o PDF sin operadores de texto informa `Este PDF no contiene texto extraíble`, sin OCR ni contenido inventado.
- **Primer bug corregido:** `FormField` exigía un único hijo para asociar etiqueta y descripción, pero el caso PDF renderizaba input y párrafo hermanos. El texto se integró en `hint` y el selector quedó accesible.
- **Segundo bug encontrado en esta validación:** un PDF textual generado por ReportLab era seleccionable, pero el extractor devolvía falsamente “sin texto”.
- **Causa raíz:** el extractor sólo descomprimía Flate directo y su regex exigía un salto antes de `endstream`. El PDF usaba los filtros válidos `ASCII85Decode` + `FlateDecode` y terminaba con `~>endstream`.
- **Solución:** `pdfTextExtractor` decodifica ASCII85 antes de Flate y acepta el final de stream sin ese salto opcional. No se agregó OCR ni se alteró el contrato de privacidad: el binario sigue sin persistirse.
- **Archivos afectados:** `src/gestion/marketing/metaAds/pdfTextExtractor.js`, `tests/pdf-text-extractor.test.mjs` y este documento.
- **Pruebas automáticas:** extracción `ASCII85 + Flate`, extracción sin salto antes de `endstream`, rechazo de PDF sin texto, y regresiones de UI del selector.
- **Evidencia local:** la muestra textual recuperó las cinco reglas de la metodología, incluidas cantidades y duraciones. La subida de esa muestra a la preview queda pendiente de confirmación, porque es una transferencia de archivo al navegador.

### Roles

La sesión Admin real abrió Conocimiento, selector de producto y Metodologías. La cobertura de dominio verifica guard de ruta y acciones Meta Ads para `admin`, `marketing_manager` y `seller`; las Rules cubren permiso para Marketing y denegación para Seller, perfil inactivo y `permissionDeny`.

No hay sesiones de prueba de Marketing Manager ni Seller disponibles para repetir la UI real, y el emulador Firestore no estaba iniciado en este entorno. En consecuencia, la matriz de permisos implementada se mantiene como contrato cubierto por código y tests, pero la comprobación manual de esas dos sesiones queda bloqueada hasta disponer de cuentas o emulador, sin ampliar permisos ni solicitar contraseñas.

### Responsive

Se recorrió en la preview autenticada la navegación móvil disponible: Conocimiento, selector de producto, lista/detalle de metodología, fuente, historial y editor JSON. No se detectó overflow horizontal del documento; las acciones principales se adaptan a ancho completo y permanecen alcanzables mediante scroll normal. El viewport controlado por el navegador de prueba informó 462 px de ancho efectivo; la repetición exacta a 390 px sigue recomendada antes de cerrar la validación móvil.

### Verificación automática y límites del entorno

Después de la corrección, el build de producción pasó y la suite de aplicación pasó completa (`203/203`). La suite de Rules no pudo ejecutarse en esta sesión porque falta un emulador Firestore con host y puerto configurados; es una dependencia de entorno, no un fallo de las Rules ni una razón para relajarlas.

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
