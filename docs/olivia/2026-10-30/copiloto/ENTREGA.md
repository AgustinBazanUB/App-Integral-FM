# Entrega: Olivia conversacional, creativa y visual

Esta actualización se prepara en `codex/olivia-contextual-copilot` para un PR hacia `main` y su Deploy Preview. La rama se creó desde `origin/main` actualizado (`985032ad8ad0430544eed8de0ae2e37b3b5ee87b`) e incorpora la continuidad pendiente hasta el PR #50 (`f0f777abb5b27acda6aa00b225c0540359dd18ed`). El nuevo PR contiene esos cambios acumulados. No se fusionó ni desplegó a producción; el enlace y el commit publicado se informan en el PR y en la entrega del chat.

## Cambios entregados

- Cuatro skills internas: `guiar-uso-aplicacion`, `guiar-interfaz-visual`, `conversacion-natural-argentina` e `idear-y-crear`. Selección contextual en el cargador existente.
- Skill de desarrollo independiente: `.agents/skills/olivia-guia-conversacional/SKILL.md`, validada con el validador de la instalación local de Codex.
- Generación y revisión de nombres, textos, promociones, identificadores y código sin consultas empresariales innecesarias. El contexto conserva la propuesta anterior; registrar una entidad vuelve a los permisos y confirmaciones existentes.
- Banco versionado de expresiones naturales y respuestas habladas breves consistentes con el contenido visual. Se conserva la infraestructura de voz y los proveedores actuales.
- Guía contextual determinista, controles conversacionales y 27 guías registradas: 9 procedimientos detallados y 18 orientaciones de módulos. Las orientaciones generales no cubren todos los formularios de cada módulo.
- Driver.js `1.10.2` como única dependencia agregada, sin subdependencias. Carga diferida, controles reales marcados, espera de formularios, pausa, reanudación, cancelación, teclado y movimiento reducido. No ejecuta código, selectores ni clics decididos por el modelo.
- Dos herramientas nuevas: `get_ui_guide` y `show_ui_guide`, con catálogo y permisos filtrados. `ScreenContext` solo comparte IDs registrados y códigos de error, sin valores de formularios.
- Validación de prefijos de ubicaciones al preparar y confirmar; reserva atómica para altas/cambios confirmados mediante Olivia. El formulario manual comparte la comprobación previa cuando el perfil puede ver todas las ubicaciones.

La evaluación de CopilotKit y Agents SDK, las fuentes oficiales y la arquitectura están en [OLIVIA-COPILOT.md](../../../OLIVIA-COPILOT.md). Se adoptan patrones de estado y acciones tipadas sin añadir otro runtime. La auditoría de 71 herramientas y 18 módulos, con permisos, campos, operaciones, pasos y funciones manuales pendientes, está en [CAPACIDADES.json](CAPACIDADES.json).

## Validación aprobada

- `npm test`: **1077/1077** pruebas; incluye 22 nuevas de creatividad, contexto, rutas mixtas, permisos, rechazo de ejecución inesperada, guías, privacidad, limpieza y unicidad transaccional.
- `npm run build:gestion`: correcto. Continúa el aviso previo de chunks grandes.
- `git diff --check`: correcto.
- Validador `quick_validate.py` de skill-creator: `Skill is valid!`.
- Prueba de interfaz real en Chrome con adaptadores en memoria: pedir guía, iniciar, abrir formulario, avanzar, validación nativa de campos vacíos, teclado entre formulario y guía, Escape, cancelación y vista móvil de 390 × 844.
- Prueba de chat en la misma interfaz: tres propuestas y modificación de la segunda. El motor y la interfaz son reales; los datos y la redacción del proveedor son simulados. Las capturas llevan ese aviso.
- El servidor local de QA no carga Firebase ni permite guardar ubicaciones. No se crearon registros remotos ni se consumieron llamadas pagadas a modelos, STT o TTS durante estas pruebas.

Capturas: [guía móvil](evidence/guia-movil.png), [guía de campo](evidence/guia-campo-desktop.png), [revisión de propuesta](evidence/ideas-chat.png).

Las verificaciones de CI, estado de Netlify y configuración de la nueva preview se añaden al PR cuando el despliegue está listo. No se realizan pruebas remotas con escrituras si el aislamiento completo de frontend, Functions, Authentication, Firestore y credenciales no puede verificarse.

## Rendimiento y consumo

[MEDICIONES.json](MEDICIONES.json) contiene 20 muestras locales con respuesta de modelo simulada: P50 de 4,57 ms y P95 de 10,31 ms. **No son tiempos del modelo real, de red ni de voz.** Las guías y sus controles necesitan cero llamadas de modelo; generar/revisar una idea usa una y cero herramientas empresariales en los casos probados. Persistir conversación y cuota conserva el uso de Firestore existente.

El cuerpo de una petición creativa de muestra pesa 16.717 bytes; el mismo cuerpo con los 33 esquemas que se habrían ofrecido pesa 42.011 bytes. Es aproximadamente un 60 % menos de bytes en esa comparación controlada, no una medición de tokens facturados ni del rendimiento de la versión anterior. Driver.js añade 27.759 bytes de JavaScript (8.076 gzip), descargados solo al iniciar una guía.

No se cambia de modelo ni proveedor. No se ofrece una cifra de ahorro monetario o latencia real sin medir esas llamadas. No se regeneró la biblioteca de audios.

## Límites y pendientes

- Medir primera respuesta audible y respuesta final con proveedor real, conexión y micrófono; evaluar ruido, transcripción, interrupciones y conversación libre por una persona. Las pruebas automáticas existentes verifican contratos de voz y cancelación, no calidad acústica real.
- Probar dispositivos físicos, Safari/iOS y Android. La emulación de ancho en Chrome no sustituye esas pruebas.
- Ampliar recorridos detallados para los formularios que hoy tienen orientación general. El catálogo marca las operaciones que siguen siendo manuales: Olivia no obtiene funciones empresariales nuevas por disponer de una guía.
- La reserva de prefijos es atómica entre escritores de Olivia. Los formularios manuales heredados no comparten una reserva atómica global: garantizarlo para todos requiere unificar el backend de escritura. No se migraron datos históricos.
- `npm audit` informa una alerta alta preexistente en `re2js@2.8.6`, presente también antes de agregar Driver.js. No se modificó esa dependencia ni se ejecutó una actualización masiva.
- No cambian reglas ni índices de Firestore; se amplían las pruebas de denegación para la colección de reservas. No se despliega Firebase de producción.

## Archivos de esta actualización

Listado relativo a la raíz del repositorio; excluye archivos temporales e ignorados. Los cambios acumulados de previews anteriores se ven en el diff completo del PR.

- `.agents/skills/olivia-guia-conversacional/SKILL.md`
- `docs/OLIVIA-ARCHITECTURE.md`
- `docs/OLIVIA-COPILOT.md`
- `docs/OLIVIA-SKILLS.md`
- `docs/OLIVIA-TOOLS.md`
- `docs/OLIVIA-VOICE.md`
- `docs/olivia/2026-10-30/copiloto/CAPACIDADES.json`
- `docs/olivia/2026-10-30/copiloto/ENTREGA.md`
- `docs/olivia/2026-10-30/copiloto/evidence/guia-campo-desktop.png`
- `docs/olivia/2026-10-30/copiloto/evidence/guia-movil.png`
- `docs/olivia/2026-10-30/copiloto/evidence/ideas-chat.png`
- `docs/olivia/2026-10-30/copiloto/MEDICIONES.json`
- `netlify/functions/_lib/olivia/conversations.mjs`
- `netlify/functions/_lib/olivia/engine.mjs`
- `netlify/functions/_lib/olivia/extendedOperations.mjs`
- `netlify/functions/_lib/olivia/extendedTools.mjs`
- `netlify/functions/_lib/olivia/modelRouter.mjs`
- `netlify/functions/_lib/olivia/provider.mjs`
- `netlify/functions/_lib/olivia/skills.mjs`
- `netlify/functions/_lib/olivia/skills/conversacion-natural-argentina/SKILL.md`
- `netlify/functions/_lib/olivia/skills/guiar-interfaz-visual/SKILL.md`
- `netlify/functions/_lib/olivia/skills/guiar-uso-aplicacion/SKILL.md`
- `netlify/functions/_lib/olivia/skills/idear-y-crear/SKILL.md`
- `netlify/functions/_lib/olivia/tools.mjs`
- `package-lock.json`
- `package.json`
- `scripts/audit-olivia-copilot.mjs`
- `src/gestion/components/InventoryTransferModal.jsx`
- `src/gestion/components/ProductForm.jsx`
- `src/gestion/ManagementShell.jsx`
- `src/gestion/olivia/guide.css`
- `src/gestion/olivia/OliviaAssistant.jsx`
- `src/gestion/olivia/OliviaGuideHost.jsx`
- `src/gestion/olivia/OliviaMount.jsx`
- `src/gestion/olivia/ScreenContext.jsx`
- `src/gestion/olivia/visualGuide.mjs`
- `src/gestion/pages/LocationDetailPage.jsx`
- `src/gestion/pages/LocationsPage.jsx`
- `src/gestion/pages/LoyalCustomersPage.jsx`
- `src/gestion/pages/ProductsPage.jsx`
- `src/gestion/pages/QuickSalesPage.jsx`
- `src/gestion/pages/WarehousePage.jsx`
- `src/gestion/seller/SellerPanel.jsx`
- `src/gestion/services/locationManagementService.js`
- `src/shared/managementWritePlans.mjs`
- `src/shared/oliviaAssistiveIntent.mjs`
- `src/shared/oliviaCapabilities.mjs`
- `src/shared/oliviaContracts.mjs`
- `src/shared/oliviaExpressions.mjs`
- `src/shared/oliviaOperationGuide.mjs`
- `src/shared/oliviaUiGuides.mjs`
- `tests/firestore.olivia.rules.mjs`
- `tests/fixtures/olivia-copilot/index.html`
- `tests/fixtures/olivia-copilot/main.jsx`
- `tests/fixtures/olivia-copilot/mocks.jsx`
- `tests/fixtures/olivia-copilot/service.mjs`
- `tests/olivia-conversation-control.test.mjs`
- `tests/olivia-copilot.test.mjs`
- `tests/olivia-visual-guide.test.mjs`
- `tests/qa-olivia-orb.mjs`
