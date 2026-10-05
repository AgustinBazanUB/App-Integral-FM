# Entrega técnica de la evolución de Olivia

## Anexo aprobado: Luna, tareas persistentes y GPT-Live

PR34 incorpora la política central v2: Luna HIGH habitual, la misma Luna XHIGH para complejidad y Sol HIGH/XHIGH solo creativo en Marketing/Redes autorizados. Añade estado privado de tareas, mínimos por intención, correcciones y cancelación sin perder slots, carga progresiva determinística, selección de origen suficiente y recepción física desconocida explícita.

GPT-Live es el protocolo predeterminado de conversación, con backend cliente compartido con texto y sideband privado. El browser no puede inyectar herramientas/instrucciones/resultados. Se deduplican delegaciones, persisten transcripciones, invalidan resultados tardíos y separan duración de voz del consumo por llamada backend. La configuración y modo desarrollador muestran límites, ruta, motivo, tarea y distribución de llamadas.

Validación final del anexo: 732 pruebas Node, 19 pruebas de reglas en emulador demo, build unificado y builds Gestión/Ecommerce. Las 37 pruebas nuevas usan proveedor/store/media controlados. Ninguna demuestra audio físico, disponibilidad de la cuenta OpenAI ni operaciones privadas del Firebase empresarial. No se desplegaron reglas ni índices a producción.

[Matriz del anexo: 52 secciones](OLIVIA-ANNEX-REQUIREMENTS.md). [Política, tareas, diagramas y fuentes oficiales](OLIVIA-MODEL-ROUTER.md).

La sección siguiente conserva la entrega inicial de la evolución; la política y voz actuales se describen arriba.


La evolución está implementada en `codex/olivia-evolution`, derivada de PR 31. Se conserva el núcleo operativo previo y se amplía la capa conversacional. No se modificó producción ni se crearon operaciones empresariales de prueba.

Antes: un componente principal coordinaba UI/audio/historial y el engine combinaba almacenamiento, Responses y herramientas acotadas. Voz transcribía, pasaba por chat Responses y volvía a Realtime para hablar. Conocimiento era una selección documental por keywords.

Ahora: componentes coherentes para composer, controles de voz, consumo, biblioteca y observabilidad; backend separado en almacenamiento conversacional, proveedor, permisos, selección/ejecución de tools, Skills, retrieval, archivos, voz, operaciones y analytics. Los planes comerciales compartidos sirven a la interfaz manual y al agente. Realtime consulta herramientas nativas sin la vuelta adicional a Responses.

## Cambios de experiencia

- Composer con +, escritura multilínea, dictado y conversación. Los detalles técnicos quedan en modo desarrollador administrativo.
- Dictado con waveform de AnalyserNode, tiempo, cancelar, STOP para editar y SEND directo; cleanup de audio/contextos/timers.
- Conversación WebRTC con transcripción persistente, interrupción, finalizar/reconectar y protección frente a eventos tardíos. Mute deshabilita entrada sin cerrar sesión ni silenciar salida; texto permanece disponible y comparte contexto verificado.
- Streaming SSE muestra el mensaje y el estado inmediatamente, recibe deltas, permite abortar y recuperar conversación sin duplicados.
- Ocho formatos de adjunto con chips, miniaturas, carga/error/remoción, MIME/firma/tamaño y protección de archivos comprimidos. Los archivos del chat vencen a 24 horas y nunca se publican automáticamente en la biblioteca.

## Capacidades de negocio

Biblioteca administrativa publicada/retirada con confirmación, vector store semántico, filtro por módulo/audiencia, revalidación local y fallback curado. Los cargos de almacenamiento sin medición se muestran como desconocidos.

Skills `pronosticar-feria`, `analizar-ventas` y `operar-panel-vendedor`, versión 1.0.0: descubiertas/cargadas por intención, permisos y seguimiento. No conceden autoridad. El catálogo ampliado contiene herramientas explícitas seleccionadas por módulo/pantalla/proceso, con barreras para preparaciones.

Administrador autorizado: ventas/métricas históricas, productos, ubicaciones, stock/depósitos/transferencias, CRM, finanzas/gastos, ecommerce, envíos, alertas, proveedores, social/marketing, estados WhatsApp/Meta, auditoría, usuarios y configuración permitida. Fiscal, anulación, roles, publicación y catálogo se revisan en los flujos seguros existentes. Vendedor conserva su panel, ubicaciones habilitadas, precios/stock/promociones y ventas propias; no recibe esquemas administrativos.

Forecast de feria: heurística transparente con histórico propio/comparables del mismo tipo, recencia/weekday/tendencia/dispersión, calendario y horarios explícitos. Devuelve tres escenarios diarios/totales, operaciones/ticket/unidades/mix/evidencia/confianza. Stock recomendado = esperado + buffer central inicial 20%. Lee stock vivo y ofrece preparar transferencia, diferenciando cantidades previstas, preparadas y físicamente recibidas. La confirmación visual revalida efectos y deja auditoría; un sí hablado/escrito no ejecuta.

## Seguridad, auditoría y rendimiento

Sesión Firebase y perfil vigente, scopes conversacionales, schemas cerrados, ownership de archivos, límites de sesiones/consultas/publicación, reglas backend-only y credenciales server-side. Datos/documentos son contexto no confiable. Confirmaciones opacas vencen en cinco minutos, deduplican ejecución y escriben atómicamente efectos, auditoría y estado.

Auditoría comercial conserva usuario/rol/fecha/módulo/acción/input/Skill/tool/entidad/antes/después/resultado y conversationId/requestId/confirmationId con origen «Asistente IA / Olivia». La identidad de preparación se conserva al confirmar.

Lecturas independientes hasta tres en paralelo, selección de herramientas, ventana reciente/memoria acotada, carga de Skills y retrieval selectivos. Panel de desarrollo mide render/despacho/deltas/finalización, provider/tools/retrieval y etapas de voz. No se afirma una mejora en milisegundos medida contra OpenAI ni audio físico sin prueba real.

## Verificación y entregables

695 pruebas Node aprobadas; 19 reglas Firestore aprobadas en proyecto demo; build unificado y builds de Gestión/Ecommerce aprobados. Vite conserva advertencia de tamaño de algunos chunks. Revisión visual local a 1280×900, 390×844 y 360×400, con composer, teclado, estados/cancelación, mute/texto y selector TXT/PNG real.

Commits de implementación:

- `2b688e2`: planes comerciales compartidos e historial CRM, sin perder identidades/teléfonos históricos.
- `841857f`: evolución multimodal, voz nativa, capacidades, permisos, pruebas y Skills.
- `0cc7847`: auditoría de base, documentación de nueve áreas y matriz de las 65 secciones.
- `94f36d1`: finalización de retención de recursos compatible con Scheduled Functions.

Archivos principales: `OliviaAssistant`, `OliviaComposer`, `dictation`, `realtime`, `OliviaVoiceControls`, `OliviaUsage`, `OliviaKnowledgeManager`, `OliviaDeveloperPanel`; backend `engine`, `conversations`, `extendedTools`, `extendedOperations`, `knowledge`, `skills`, `attachments`, `analytics`; shared `oliviaCapabilities`, `oliviaAnalytics`, `oliviaStream` y planes de dominio; nuevos endpoints, rules/indexes y tres suites de evolución.

[PR 34 de revisión](https://github.com/AgustinBazanUB/App-Integral-FM/pull/34), draft con base `codex/olivia-integration`. [Preview final de revisión](https://olivia-evolution-pr31--appintegralflormia.netlify.app/gestion), draft Netlify `6ac346a6baa0d78cbf5e70ab`, código de implementación `94f36d1`. La autenticación Firebase está preservada: los endpoints `olivia`, `olivia-attachment` y `olivia-knowledge` rechazaron solicitudes anónimas con 401. La preview usa el proyecto Firebase configurado; no es una base comercial aislada.

Límites externos observados: no se recibió login humano para recorrer datos privados; no se probaron micrófono/altavoz físicos en Android/iPhone ni llamadas reales al proveedor; no se desplegaron rules/índices al Firebase empresarial para cumplir la orden de no tocar producción. El índice versionado de movimientos por depósito acompaña una futura promoción de infraestructura. Estos puntos no se presentan como pruebas completadas en preview.

[Matriz completa de requisitos, implementación y pruebas](OLIVIA-REQUIREMENTS.md). [Pruebas y evidencia](OLIVIA-TESTING.md). [Auditoría de base](OLIVIA-AUDIT.md).
