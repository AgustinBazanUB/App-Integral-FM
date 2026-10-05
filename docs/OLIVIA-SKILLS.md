# Skills de Olivia

El catálogo está en `netlify/functions/_lib/olivia/skills.mjs`; los procesos reales residen en `skills/<nombre>/SKILL.md` y se incluyen en el bundle de Netlify. Solo esos nombres cerrados pueden cargarse, sin rutas proporcionadas por el modelo.

| Skill | Versión | Uso |
|---|---|---|
| pronosticar-feria | 1.0.0 | Escenarios, mercadería y propuesta de transferencia |
| analizar-ventas | 1.0.0 | Métricas y comparación de períodos |
| operar-panel-vendedor | 1.0.0 | Venta, stock, precios y ayuda del vendedor |

Cada Skill contiene objetivo, intención, pasos, reglas, resultado y metadatos de rol/herramientas. `discover_skills` ofrece metadatos permitidos; `load_skill` valida nombre y versión antes de leer el contenido. El texto enruta hasta dos Skills por intención; Realtime descubre y carga procesos mediante herramientas.

Una Skill está disponible solo si su rol y todas sus herramientas necesarias están autorizadas. Cargarla no concede permisos. El engine incorpora el proceso y puede habilitar sus herramientas en rondas posteriores. La sesión de voz conserva las versiones realmente cargadas en el backend; declarar una Skill desde el navegador no basta para atribuirla.

Eventos de herramientas y operaciones correlacionan Skill/version, usuario, conversación y solicitud. Modificar un proceso requiere actualizar su versión y pruebas; el loader rechaza contenidos cuyo encabezado no coincide con el catálogo.
