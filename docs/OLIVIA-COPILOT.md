# Olivia: copiloto conversacional y visual

La revisión incorpora creatividad y guía sobre el motor existente; no crea otro chatbot. La rama parte de main actualizado e incorpora las previews pendientes anteriores. Se publica para revisión, sin integración a main ni producción.

## Rutas y estado

`oliviaAssistiveIntent.mjs` clasifica generación directa, consultas mixtas y operación. Nombres, borradores, propuestas comerciales y ejemplos de programación no requieren que exista una entidad: envían una sola solicitud al modelo con `tools: []` y `tool_choice: none`, sin búsqueda de conocimiento empresarial. Si el proveedor devuelve una llamada de herramienta en esa ruta, se rechaza antes de ejecutarla. El historial y la cuota siguen escribiéndose como en toda conversación; no se afirma que la conversación opere sin Firestore.

Las consultas mixtas y operativas conservan los catálogos, límites, permisos y confirmaciones vigentes. `ideaContext` guarda la última propuesta y pedido para revisiones como «la segunda, más corta», dentro del chat y su retención. No hay ejecución de código generado, edición de archivos ni despliegue desde Olivia. El router no añade una llamada de clasificación y conserva Luna NONE/MEDIUM y Sol HIGH/XHIGH exclusivamente donde la política previa lo autoriza.

Los códigos generados no se reservan al proponerlos. El alta/cambio de prefijo mediante Olivia revisa formato y ubicaciones existentes al preparar, revalida al confirmar y crea una reserva `oliviaIdentifierClaims` junto con la ubicación en la misma transacción. La colección queda inaccesible a clientes por las reglas de denegación existentes. Se conservan prefijos históricos sin migración. El formulario manual comparte la validación contra ubicaciones existentes si el perfil puede ver todas; no agrega una reserva atómica global para todos los escritores manuales heredados. Esa última garantía requeriría unificar su backend de escrituras y queda como límite explícito.

## Skills

Se suman `guiar-uso-aplicacion`, `guiar-interfaz-visual`, `conversacion-natural-argentina` e `idear-y-crear` al cargador actual. Sus nombres/versiones se validan en el servidor. `oliviaExpressions.mjs` mantiene ejemplos agrupados por intención y evita elegir un ejemplo repetido recientemente; el modelo los usa como estilo, no como respuestas obligatorias.

La skill de desarrollo `.agents/skills/olivia-guia-conversacional/SKILL.md` es para Codex. No se carga en el chat de Olivia ni concede herramientas a usuarios.

## Guía visual

El registro `oliviaUiGuides.mjs` contiene recorridos específicos y una orientación general por módulo. Las guías detalladas cubren alta de ubicación, producto, cliente y depósito, venta administrativa/vendedor, mercadería de local/depósito y transferencias. Las orientaciones generales explican el módulo y sus límites; no equivalen a un recorrido de todos sus formularios.

`get_ui_guide` consulta pasos; `show_ui_guide` ofrece un botón de inicio. Ambas validan el permiso del procedimiento. El cliente vuelve a validar el ID, versión, perfil y ruta. Driver.js se descarga al iniciar los resaltados; el modelo no entrega selectores, HTML ni código. La persona abre formularios y decide cuándo guardar. La guía espera si falta un elemento y se pausa al ir a otra pantalla o al volver al chat. Incluye anterior/siguiente, pausa, reintento, cancelación, Escape, foco y movimiento reducido.

`ScreenContext` comparte únicamente identificadores registrados, estado del paso y códigos de validación. Los errores nativos se detectan por el evento `invalid`; no se leen ni transmiten valores, teléfonos, nombres o texto libre de error. El usuario puede hablar/escribir sobre el paso o pedir siguiente, anterior, pausar o cancelar la guía. Las guías no confirman operaciones empresariales.

## Decisiones de dependencias

- **Driver.js 1.10.2**, MIT, una dependencia directa sin subdependencias: aporta resaltados y popovers. Se usa con controles desarrollados en el repositorio, no con código del modelo. [Repositorio oficial](https://github.com/kamranahmedse/driver.js) y [configuración](https://driverjs.com/docs/configuration).
- **CopilotKit**: se adoptan los patrones de estado compartido y herramientas de frontend tipadas en `ScreenContext` y el host de guías. No se incorpora su runtime porque duplicaría el historial, transporte, autorización y confirmaciones existentes. [Estado compartido](https://docs.copilotkit.ai/shared-state), [repositorio](https://github.com/CopilotKit/CopilotKit).
- **OpenAI Agents SDK**: se mantienen las funciones con esquemas y el estado propio. No se migra el runner: ya hay cuotas, cancelación, sesiones y tarjetas transaccionales probadas. La guía oficial confirma el patrón de herramientas de función con validación en la aplicación. [Herramientas](https://openai.github.io/openai-agents-js/guides/tools/).

## Voz, costos y límites

Se mantienen [GPT Live Transcribe](https://developers.openai.com/api/docs/models/gpt-live-transcribe), [GPT Transcribe](https://developers.openai.com/api/docs/guides/transcription) y [Chirp 3 HD/Aoede](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd), documentados como vigentes al revisar esta actualización. La salida visual admite código; la salida hablada lo resume. La voz y los acuses existentes no se regeneran.

Las guías registradas y sus controles usan cero llamadas de modelo. Generar/revisar contenido usa una llamada; las consultas mixtas mantienen las rondas necesarias para datos reales. Estas cantidades se comprueban con fixtures, no son una medición facturada ni una garantía de latencia de red. Los caracteres TTS y minutos STT se siguen contabilizando por el sistema actual.

El registro debe ampliarse al cambiar pantallas. El grafo previo de Graphify es parcial y tiene referencias externas sin resolver: los hallazgos se contrastaron con código y contratos. Las pruebas de comprensión libre, ruido y dispositivos físicos requieren evaluación humana; los fixtures no prueban que el modelo real siempre clasifique o redacte perfectamente.

Los informes por módulo, cobertura de controles, validación y métricas se guardan en `docs/olivia/2026-10-30/copiloto/`.
