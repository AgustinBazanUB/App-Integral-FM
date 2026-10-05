# Matriz de requisitos de la evolución

Fuente: prompt maestro de 65 secciones aportado por el usuario. Se releyeron sus secciones y se compararon con código, contratos y pruebas. Las filas desglosan requisitos funcionales paralelos dentro de una sección. «Sí» identifica implementación presente; la columna resultado distingue evidencia automatizada, inspección y revisión visual. No significa que se haya probado audio físico o una operación empresarial real.

Rutas abreviadas: `UI` = `src/gestion/olivia/`; `B` = `netlify/functions/_lib/olivia/`; `S` = `src/shared/`. Pruebas: `E` = `tests/olivia-evolution.test.mjs`; `W` = `tests/olivia-workflows.test.mjs`; `I` = `tests/olivia-integrations.test.mjs`; `Base` = suites previas; `Rules` = cuatro suites Firestore descritas en OLIVIA-TESTING. «Visual local» usa componentes/CSS de producción con datos sintéticos y sin proveedor ni escrituras empresariales.

| Sección / requisito | Implementado | Archivos responsables | Prueba realizada | Resultado |
|---|---|---|---|---|
| 1. Auditar, implementar, integrar, corregir, documentar | Sí | OLIVIA-AUDIT, código y docs | Base y matriz final | Cambios concretos versionados |
| 2. Texto, contexto y capa operativa transversal | Sí | UI/OliviaAssistant; B/engine, tools | Base, E, W, I | Aprobado |
| 2. Multimodalidad, análisis, recomendaciones y permisos | Sí | B/attachments, analytics, knowledge, skills, guards | E, W, I | Aprobado |
| 3. Backend real, sin mocks definitivos ni botones inertes | Sí | provider, store, endpoints, componentes | Inspección y builds | Fixtures solo en pruebas |
| 3. Matriz requisito → archivos → prueba → resultado | Sí | Este documento | Relectura de 65 secciones | Límites externos explícitos |
| 4. Derivar de PR31 y conservar implementación | Sí | Rama codex/olivia-evolution | SHA base y 634 pruebas iniciales | Base preservada |
| 4 / 65. No modificar producción | Sí | Worktree, draft Netlify, config demo | Git y ejecución de emulador | Sin deploy Firebase ni writes comerciales |
| 5. Tools explícitas sin consultas/commands arbitrarios | Sí | S/oliviaCapabilities; B/guards, tools | E, Base | Esquemas cerrados y autorización |
| 5. Compartir dominio manual | Sí | S/*WritePlans; servicios de gestión | Base, W, I | Mismos planes/efectos |
| 6. Composer limpio + textarea + mic + voz | Sí | UI/OliviaComposer, olivia.css | Visual local, build | Desktop y móvil |
| 6 / 45. Modelo/reasoning solo modo desarrollador | Sí | UI/OliviaDeveloperPanel; B/engine | Base, inspección | Restricción administrativa |
| 7. Fotos/documentos/cámara/selector múltiple | Sí | UI/OliviaComposer | Visual local TXT y PNG | Selección, chips y foco aprobados |
| 7. PDF/DOCX/XLSX/CSV/TXT/JPEG/PNG/WebP | Sí | S/oliviaAttachmentPolicy; B/attachments | E, ocho formatos | Aprobado |
| 7. Preview, nombre/tipo, carga/error/quitar | Sí | UI/OliviaAssistant, OliviaComposer | Visual local y E | Chips/remoción verificados |
| 7. Validación backend MIME/extensión/tamaño/firma | Sí | B/attachments, requestBody | E | Spoofing, ejecutables, macros, ZIP bomb rechazados |
| 7. Archivo vinculado al mensaje correcto | Sí | B/engine, attachments | E | Ownership/contexto/rehidratación |
| 8. Archivo temporal separado de conocimiento permanente | Sí | endpoints attachment/knowledge; UI/OliviaKnowledgeManager | E, W | Canales y retención separados |
| 9. Dictado pide permiso y graba con tiempo visible | Sí | UI/dictation, OliviaComposer | E | Captura/tiempo con dependencias controladas |
| 9. X cancela sin transcribir/enviar | Sí | UI/dictation, OliviaAssistant | E | Audio/recursos liberados |
| 9. STOP transcribe y deja texto editable | Sí | UI/OliviaAssistant; B/voice | E, Base | Semántica de revisión aprobada |
| 9. SEND transcribe/envía como mensaje normal | Sí | UI/OliviaAssistant; B/engine | E, Base | Semántica de envío aprobada |
| 9. Duración/tamaño configurable | Sí | S/oliviaContracts; UI/dictation; B/voice | Base, E | Límites cliente/backend |
| 10. Waveform real del AnalyserNode | Sí | UI/dictation, OliviaComposer | E: silencio/amplitud/distribución | No se simula en producción |
| 10. Limpieza de AudioContext/streams/timers | Sí | UI/dictation | E, permiso tardío/cancel | Aprobado |
| 11. Transcripción OpenAI y vocabulario contextual | Sí | B/voice | Base | Productos/ubicaciones y límites |
| 11. Texto persistido; audio no permanente | Sí | B/engine, voice; UI/dictation | Base, E | Audio temporal y tracks liberados |
| 12. Conversación Realtime/WebRTC distinta de dictado | Sí | UI/realtime; B/voice | Base, W | Conexión/errores/hangup aprobados |
| 12. Transcripción visible y persistente | Sí | UI/OliviaAssistant; B/engine | W, I | Deduplicación y cierre con gracia |
| 12. Interrumpir/finalizar/reconectar/pasar a texto | Sí | UI/OliviaVoiceControls, realtime | W, visual local | Controles y recursos comprobados |
| 13. Mute mantiene RTC y salida de Olivia | Sí | UI/realtime, OliviaVoiceControls | W, visual local | Solo track de entrada se deshabilita |
| 13. Unmute misma sesión/contexto | Sí | UI/realtime | W | Sin recrear conexión |
| 14. Escribir/enviar con voz activa o mute | Sí | UI/OliviaAssistant, realtime | W, visual local | Contexto verificado compartido |
| 15. Recepción local sin llamada IA adicional | Sí | UI/realtime | W | Frases locales y fallback visible |
| 16. Mensaje inmediato/historial/composer durante trabajo | Sí | UI/OliviaAssistant | E, visual local | Optimista, pensando y cancelar visibles |
| 17. Streaming Responses/SSE incremental | Sí | endpoint olivia; B/provider, engine; S/oliviaStream | E | Deltas antes de finalización |
| 17. UTF-8/CRLF, abort, error/incompleto/reintento | Sí | S/oliviaStream; UI/client, OliviaAssistant | E, Base | Parser y recuperación aprobados |
| 17. Tools y persistencia sin duplicación | Sí | B/engine, conversations, usage | E, Base | Un usuario/asistente por solicitud |
| 18. Click→visible→request→primer delta→final | Sí | UI/OliviaAssistant, OliviaDeveloperPanel | Inspección/build, E | Métricas de desarrollo |
| 18. Voz→ASR→tool→respuesta→audio | Sí | UI/realtime; B/engine | W y revisión | Inicio de buffer, no altavoz físico |
| 19. Lecturas paralelas controladas | Sí | B/toolExecution | E | Lotes máximos de tres |
| 19. Preparación/escritura/confirmación secuenciales | Sí | B/toolExecution, operations, engine | E, W | Barreras y transacción |
| 20. Voz nativa → tool backend → Realtime | Sí | UI/realtime; B/voice, engine | W | Sin llamada Responses intermedia |
| 20. Realtime no tiene autoridad de escritura | Sí | B/engine, guards, operations | W, Base | Sí hablado no confirma |
| 21–22. Productos y catálogo | Sí | B/tools, extendedOperations; ProductsPage | I, Base | Búsqueda/precios y formulario validado |
| 21–22. Ubicaciones y eventos | Sí | B/extendedTools, extendedOperations; S/managementWritePlans | W, I | Alta/edición conservan calendario/asignación |
| 21–22. Ventas y venta rápida | Sí | B/tools, operations; S/operationalWritePlans | Base, W | Preparación/autorización/confirmación |
| 21–22. Stock y depósitos | Sí | B/extendedTools, operations | Base, W, I | Cargas/inventario/movimientos |
| 21–22. Transferencias | Sí | S/stockTransferWritePlans; B/extendedOperations | W, I | Cantidad prevista/preparada/recibida/pérdidas |
| 21–22. Clientes/CRM | Sí | B/extendedTools, extendedOperations; customerDomain | W, Base | Identidad canónica y enriquecimiento seguro |
| 21–22. Dashboard/métricas/ventas históricas | Sí | B/analytics, extendedTools; S/oliviaAnalytics | E, I | Períodos/comparaciones/hechos reales |
| 21–22. Finanzas/gastos | Sí | B/extendedTools, extendedOperations; financeDomain | W, I, Base | Devengado/pagos y gasto confirmado |
| 21–22. Ecommerce | Sí | B/extendedTools, extendedOperations; GenericModulePage | Base, revisión/build | Pedido real seleccionado para revisión |
| 21–22. Social/marketing/WhatsApp/Meta | Sí | B/extendedTools, extendedOperations | W, Base | Lecturas, alta/borrador; publicación manual |
| 21–22. Envíos | Sí | B/extendedTools, extendedOperations; managementWritePlans | W | Alta/edición del dominio existente |
| 21–22. Alertas y proveedores | Sí | B/extendedTools, extendedOperations | W | Consulta/alta confirmadas |
| 21–22. Facturación/ARCA | Sí | B/extendedTools, extendedOperations; S/arcaSourceType; SettingsPage | I, Base | Estado real y flujo fiscal seguro |
| 21–22. Actividad/auditoría/usuarios/configuración | Sí | B/extendedTools, extendedOperations; AdministrationPage, SettingsPage | Base, revisión/build | Lecturas permitidas y revisión segura |
| 23. Tool Search y carga selectiva | Sí | S/oliviaCapabilities; B/extendedTools, engine | E, W | Intención/pantalla/Skill/permisos |
| 24. Core común admin/seller | Sí | B/engine, guards; UI/OliviaAssistant | Base, E | Sin duplicar agente |
| 24. Vendedor solo ubicaciones/ventas propias/panel | Sí | B/tools, guards, operations | Base, Rules, E | Sin esquemas administrativos |
| 24. Revalidación backend por ejecución | Sí | B/guards, operations, extendedOperations | W, Base | Revocación bloquea escrituras |
| 25. Biblioteca permanente escalable | Sí | B/knowledge; endpoint knowledge; UI/OliviaKnowledgeManager | W, I | Publicación, indexado, paginación, retiro |
| 25. Retrieval semántico relevante y permitido | Sí | B/knowledge; S/oliviaKnowledge | W | Cuatro hits, filtro remoto y revalidación local |
| 25. Fallback ante fallo de proveedor | Sí | B/knowledge; S/oliviaKnowledge | W | Contexto curado permitido |
| 26. Reglas críticas permanecen en código | Sí | B/guards, operations; schemas y reglas | Base, E, W, Rules | RAG no autoriza |
| 27. Skills reales/versionadas/discover/load/router | Sí | B/skills y tres SKILL.md | E, W, I | Metadatos + carga dinámica |
| 27. Roles/tools/auditoría sin cargar todas | Sí | B/skills, engine | E, W | Solo procesos permitidos, versión registrada |
| 28. Skill/tool/permiso/confirmación separados | Sí | B/skills, guards, engine, operations | W | Skill o sí hablado no concede autoridad |
| 29. pronosticar-feria activada por intención | Sí | B/skills/pronosticar-feria/SKILL.md | E, I | Preguntas de ventas/mercadería/feria |
| 30. Ubicación/fecha/días/weekday/calendario | Sí | S/oliviaAnalytics; B/extendedTools | E, I | Fechas reales y días cerrados |
| 30. Historia propia/comparables/recencia/tendencia | Sí | S/oliviaAnalytics; B/analytics | E, I | 180 días; comparables explícitos mismo tipo |
| 30. Facturación/operaciones/ticket/unidades/mix/variación | Sí | S/oliviaAnalytics | E | Hechos agregados únicos activos |
| 30. Duración y datos adicionales disponibles | Sí | S/oliviaAnalytics | E: horarios/nocturno/ausencia | Ajuste solo con calendarios explícitos |
| 30. Sin inventar geografía/clima/historia ausente | Sí | S/oliviaAnalytics; Skill | E | Null y límites/confianza explícitos |
| 31. Tres escenarios por día/total, evidencia/factores | Sí | S/oliviaAnalytics | E, I | Montos/operaciones/ticket/mix |
| 31. Stock esperado +20% parametrizado | Sí | S/oliviaAnalytics, oliviaContracts | E, I | Redondeo de stock robusto |
| 32. Forecast → propuesta de transferencia | Sí | Skill; B/extendedOperations; UI/confirmación | I, W | Stock vivo/origen/destino/impacto |
| 32. Sí escrito prepara; tarjeta confirma | Sí | B/engine, operations | W, Base | Preparación sin escritura comercial |
| 33. Ubicación/producto/cliente de pantalla | Sí | ScreenContext; ProductsPage, LocationDetailPage, LoyalCustomersPage, SellerPanel | Revisión/build y Base | Solo IDs/filtros candidatos |
| 33. Otra entidad explícita prevalece con permiso | Sí | B/tools, extendedTools, guards | Base, E | Args priorizan pantalla; permiso obligatorio |
| 34. Reciente + memoria + borrador + Skill activa | Sí | B/engine, conversations, skills; S/oliviaMemory | E, I, Base | Seguimientos acotados/reautorizados |
| 34. Historial paginado y chats previos | Sí | B/conversations; UI/OliviaAssistant | Base, I | Sin filtrar contexto de otro rol |
| 35–36. Conocimiento de negocio vs hechos vivos | Sí | knowledge, skills, tools, instrucciones | E, W, revisión | Fuentes diferenciadas |
| 37. Crecimiento/caídas/ranking/pagos/promos/ticket/períodos | Sí | B/analytics; S/oliviaAnalytics | E, I | Caídas a cero incluidas; atribución explícita |
| 38. Dato/inferencia/recomendación | Sí | B/provider; Skill; resultados analytics | E y revisión de instrucciones | Forecast identificado como estimación |
| 39. Anular/bajas/fiscal/roles/publicación sensibles | Sí | B/extendedOperations; páginas de revisión | W, I, Base | Flujo seguro existente conserva autoridad |
| 39. Finanzas/transferencias revalidan al confirmar | Sí | B/operations, extendedOperations | W | Sin escrituras parciales |
| 40. Usuario/rol/tiempo/módulo/acción/input/tool/Skill | Sí | B/engine, operations, extendedOperations | W | Auditoría comercial correlacionada |
| 40. Entidad/antes/después/resultado/IDs/origen | Sí | B/operations; shared plans | W | before/after y preparación vinculados |
| 41. Doble click/reintento/reconexión/timeout | Sí | B/engine, usage; UI/client, realtime | Base, E, W | Una operación/llamada por identidad |
| 42. Keys server-side/sesión/perfil real | Sí | B/http, provider, guards; endpoint olivia | Base, Rules, revisión | No OpenAI key VITE |
| 42. Strict schemas/params/MIME/rate/tamaño | Sí | S/contratos/capabilities; B/requestBody, attachments, usage | E, W, Base | Límites y rechazos comprobados |
| 42. Inyección/contexto no confiable/sin credenciales | Sí | B/provider, engine, knowledge, extendedTools | E, I y revisión | Proyección fiscal sin tokens privados |
| 42. Rol/precio/stock/pantalla no confiables | Sí | B/guards, operations | Base, W | Relecturas de dominio |
| 43. Fallos IA/tools/voz/SSE conservan operación | Sí | UI/OliviaAssistant, realtime; B/provider, engine | Base, E, W | Errores recuperables y chat conservado |
| 43. Atomicidad frente a inconsistencia | Sí | B/operations, extendedOperations | W | Huella obsoleta revoca propuesta |
| 44. Estados accesibles en lenguaje común | Sí | UI/OliviaAssistant, OliviaComposer, OliviaVoiceControls | Visual local, revisión | Pensando/escuchando/preparando/confirmación |
| 45. Observabilidad administrativa | Sí | UI/OliviaDeveloperPanel; B/engine | Base y revisión/build | Modelo/tokens/costo/tools/Skills/docs/IDs |
| 46. Texto/transcripción/voz medidos y ARS/FX | Sí | B/usage, pricing, voice; UI/OliviaUsage | Base, E | Medición y conversión trazable |
| 46. Archivos/retrieval sin cero ficticio | Sí | B/engine, knowledge; UI/OliviaUsage | W, revisión | Costo desconocido explícito |
| 47. Componentes coherentes | Sí | Composer, VoiceControls, Usage, DeveloperPanel, KnowledgeManager, ReviewPanel | Builds y visual local | Assistant conserva coordinación |
| 48. Backend separado por responsabilidad | Sí | engine/provider/tools/toolExecution/skills/knowledge/attachments/voice/guards/operations/usage/pricing/conversations/analytics/store | Suites e inspección | Dominio y transporte separados |
| 49. Desktop/Android/iPhone responsive | Sí | UI/olivia.css, dictation, realtime | Visual local y E/W | Viewports; hardware no verificado |
| 49. Permiso/MediaRecorder/AudioContext/file picker/keyboard/safe areas/scroll | Sí | UI/dictation, Composer, Assistant, CSS | E, W, visual local | Fallos/limpieza y selector real comprobados |
| 50. Labels/focus/keyboard/screen reader/estados | Sí | UI/componentes | AX y Enter/Shift+Enter, selector | Controles identificables y foco al textarea |
| 51. Auditoría PR31/servicios/rules/tests/docs | Sí | OLIVIA-AUDIT | Código base, git, suites iniciales | Clasificación consolidada |
| 52. Manual/otras superficies/seguridad/chats/costos | Sí | Servicios y montaje conservados | 695 tests + Rules + builds surfaces | Sin regresiones observadas |
| 53. Etapas integradas hasta auditoría final | Sí | Implementación y documentación | Matriz + pruebas completas | Sin entregar etapas como producto final |
| 54. Texto/SSE/chat nuevo/existente/historial | Sí | Base, E, I | Suites correspondientes | Aprobado |
| 54. Archivos/imagen/MIME/tamaño/dictado/waveform/STOP/SEND/cancel | Sí | E y Base | Suites correspondientes | Aprobado |
| 54. Conexión/mute/unmute/interrupción/texto/reconexión | Sí | W y Base | Suites correspondientes | Aprobado |
| 54. Tools/roles/registry/Skills/router/RAG | Sí | E, W, I | Suites correspondientes | Aprobado |
| 54. Forecast/buffer/insuficiencia/transferencia/confirmar/cancelar | Sí | E, W, I | Suites correspondientes | Aprobado |
| 54. Idempotencia/doble click/auditoría/rules/regresión/build | Sí | Base, W, Rules y scripts build | 695 + 19 pruebas | Aprobado |
| 55. Prueba funcional manual cuando sea posible | Sí | Componentes reales y preview privada | Visual local + login preview | Autenticación/audio físico limitan recorrido empresarial |
| 56. Docs generales y nueve documentos específicos | Sí | docs/OLIVIA*.md | Comparación con código | Funciones/limitaciones reales |
| 57. Fórmula/input/fuentes/pesos/fallback/confianza/buffer/seguridad/ejemplo | Sí | OLIVIA-FORECASTING y SKILL.md | E, I y revisión | Heurística identificada |
| 58. Sin duplicación delicada/frontend-authority/leaks/races | Sí | Shared plans; B/guards; UI/audio | E, W, Base | Cancel tardío y response.done desordenado |
| 59–61. Decisiones autónomas y persistencia | Sí | Código/tests/docs/worktree | Ejecución del trabajo | Sin detenerse por elecciones menores |
| 62. Relectura y auditoría final | Sí | Esta matriz | Comparación de las 65 secciones | Evidencia diferenciada de límites externos |
| 63. Informe con arquitectura/UX/seguridad/tests/archivos/commits/preview/límites | Sí | OLIVIA-DELIVERY.md y respuesta final | Datos de git/build/deploy | Informe reproducible |
| 64. Experiencia natural/multimodal/operativa/trazable | Sí | Conjunto integrado | E/W/I/Base, visual local | Flujos de negocio y confirmación conectados |
| 65. Comenzar desde PR31 y continuar implementando | Sí | Base derivada y commits | Git + auditoría | Sin intervención en producción |

## Recorrido manual y limitaciones externas

Se comprobaron en navegador los componentes de producción, sin reemplazar el backend real en la aplicación. Se verificaron composer, pensar/cancelar, texto multilínea, controles mute, texto mientras muteado, selección TXT/PNG, chips/remoción/foco y responsive. El harness local es una herramienta de QA ignorada por Git y excluida del build/deploy.

La preview exige login humano; no se recibieron credenciales ni sesión autenticada. No se elude Firebase ni se crean ventas empresariales para probar. Por eso los puntos de consulta/forecast/transferencia/cancelación/confirmación/auditoría del recorrido manual se comprobaron mediante fixtures de dominio y emulador, sin afirmar que se ejecutaron en preview. El audio físico, waveform de micrófono y conversación con OpenAI desde teléfonos no se verificaron con hardware real.

No se desplegaron rules/índices al proyecto Firebase empresarial. Se incluyen cambios para su futura promoción mediante el proceso habitual de despliegue; las nuevas colecciones mantienen denegación directa por reglas existentes y añadidas. El nuevo índice de movimientos por depósito debe acompañar esa promoción. Esta restricción cumple la orden de no modificar producción y no oculta una dependencia de infraestructura.
