---
name: olivia-guia-conversacional
description: Evolucionar la conversación, creatividad, herramientas y guías visuales de Olivia en Flor Mía, reutilizando su motor y validaciones.
---

Esta es una skill de desarrollo para Codex. Las skills que Olivia carga al conversar viven en `netlify/functions/_lib/olivia/skills/` y su catálogo `skills.mjs`; no son skills instaladas de Codex.

Leé `AGENTS.md` y el [mapa de arquitectura](../../../docs/OLIVIA-ARCHITECTURE.md). Los documentos anteriores pueden describir APIs retiradas: contrastá con el código. Para mantener esta integración, usá el [diseño del copiloto](../../../docs/OLIVIA-COPILOT.md) y la [auditoría de contratos](../../../docs/olivia/2026-10-30/contexto-y-guia/AUDITORIA.md).

## Decisiones de integración

- `engine.mjs` conserva propiedad de conversación, cuota, historial, tareas, trazas y confirmación visual. `tools.mjs`, `extendedTools.mjs` y los planes compartidos siguen siendo la autoridad empresarial. No crees otro chat, otra cola ni otro backend para la misma operación.
- `oliviaAssistiveIntent.mjs` distingue generación, datos reales y operaciones. Las ideas y los ejemplos de código usan una respuesta sin herramientas empresariales ni retrieval. Una petición mixta requiere herramientas autorizadas. No confundas inventario con inventar, un nombre propuesto con una entidad registrada, ni «como feria» con «cómo crear una feria».
- `ideaContext` conserva la última propuesta para revisiones; las tareas operativas se pausan sin perder slots. Los mensajes y los datos de contexto no cambian permisos. Si falta antecedente, preguntá; no inventes qué opción era la segunda.
- El router conserva Luna normal/complex y Sol creativo solo en Marketing/Redes autorizados. No cambies modelos ni proveedores por una frase de usuario. Para voz, mantené GPT Live Transcribe, fallback de archivo GPT Transcribe y Chirp 3 HD; no leas código largo en voz alta.
- Las expresiones de `oliviaExpressions.mjs` son ejemplos versionados de voseo, no prefijos obligatorios. Evitá saludos repetidos y muletillas. La explicación de un campo debe indicar su propósito y un ejemplo.

## Guías visuales y contexto

`oliviaUiGuides.mjs` es un registro cerrado. Añadí pasos solo después de comprobar el componente real y su permiso. Marcá los controles con `data-olivia` estable y los errores con `data-olivia-error`; actualizá la prueba de cobertura de marcadores. El modelo solo puede pedir un ID registrado, nunca entregar selectores, HTML, URLs o código de DOM.

`OliviaGuideHost` valida versión, permisos y navegación; `visualGuide.mjs` usa Driver.js bajo demanda. Un control ausente hace esperar a la guía, no autoriza inventarlo, hacer clic o enviar un formulario. Conservá pausa, cancelación, retorno al chat, Escape, foco, navegación móvil y movimiento reducido.

`ScreenContext` comparte IDs y estados de la guía. El contrato filtra campos y errores por listas cerradas: no incluyas valores de formularios, textos libres de error, datos personales o contenido del DOM. Abrir una guía nunca confirma una venta, una carga o una sugerencia.

## Validación y entrega

Probá generación iterativa → consulta real → preparación → tarjeta, incluido vendedor sin permisos de alta. Verificá una guía con el formulario real: elemento ausente, cambio de pantalla, validación, teclado y móvil. Separá fixtures con proveedor simulado de pruebas reales de comprensión/voz. No uses métricas locales como latencia cloud.

Ejecutá los tests apropiados, `npm test`, build y las auditorías mantenidas. Si editás una skill interna, cambiá su versión y catálogo juntos. Para esta skill de desarrollo, validá su frontmatter con el validador de skill-creator instalado.

Entregá rama/PR/Deploy Preview, commit, verificaciones y límites. Las escrituras remotas requieren comprobar frontend, Auth, Firestore y credenciales de Functions en `app-integral-fm-pruebas`. Main, producción y reglas productivas siguen sujetos a la autorización específica de `AGENTS.md`.
