# Matriz de las 52 secciones del anexo

Fuente: `Prompt_Anexo_Olivia_Model_Router_Luna_Sol (1).txt`, aprobado por el usuario para integrarlo a PR34 sin modificar producción. Complementa la matriz del prompt maestro; reemplaza su selección anterior de modelos y voz predeterminada.

Abreviaturas: **R** = `modelRouter.mjs`; **T** = `tasks.mjs`; **E** = `engine.mjs`; **L** = backend `live.mjs` / `liveMonitor.mjs` y cliente `src/gestion/olivia/live.mjs`; **C** = `oliviaContracts.mjs`; **RT** = `tests/olivia-router-tasks.test.mjs`; **LT** = `tests/olivia-live.test.mjs`. Los tests de proveedor usan fixtures: «implementado» no acredita una llamada real a OpenAI, un micrófono físico ni una operación comercial empresarial.

| Sección | Implementación | Archivos responsables | Evidencia / resultado | Pendiente y motivo |
|---|---|---|---|---|
| 1. Objetivos | Sí | R, T, E, L | RT, LT, regresión | Validación real de cuenta/audio |
| 2. Responsabilidades | Sí | L, E, guards, operations | LT: canal sin autoridad; core compartido | Hardware/proveedor real |
| 3. Recopilación progresiva | Sí | T, E | RT: producto → destino → tarjeta; motivo opcional | Formulación de modelo real en otras tareas |
| 4. Evitar repreguntas | Sí | T, E, contexto de tarea | RT: cantidad y entidades conservadas | Ninguno de código |
| 5. Solo datos relevantes | Sí | mínimos T, tools, instrucciones E | RT: carga y recepción física preguntan solo faltantes | Evaluación de lenguaje del proveedor real |
| 6. Resolver entidades | Sí | progressiveStock, búsqueda, resolve_transfer_origin | RT: producto real, ambigüedad, depósitos vivos | Búsquedas acotadas declaran parcialidad |
| 7. Correcciones naturales | Sí | T, E, invalidateTask | RT: cantidad/destino; LT: respuesta tardía descartada | Audio físico de correcciones |
| 8. Cambio de intención | Sí | classifyIntent, working task, saveTurn | RT: tarea nueva sin slots anteriores | Ninguno de código |
| 9. Capa conversacional | Sí | GPT-Live cliente + sideband | LT: transcripciones simples sin Luna | Cuenta con acceso GPT-Live |
| 10. Texto | Sí | E, cliente SSE | Regresión de SSE/historial; RT | Ninguno de código |
| 11. Delegación automática | Sí | L → E → R | LT: delegación cliente, correlación, deduplicación | Medir delegación del proveedor real |
| 12. Luna predominante | Sí | R, C | RT: stock/métricas/análisis/roles | No se mide porcentaje de producción |
| 13. HIGH estándar | Sí | defaults C | RT: operaciones básicas y métricas | Administrador puede configurar esfuerzo |
| 14. XHIGH complejo | Sí | R, Skills | RT: pronóstico, comparación y señales | Latencia real de XHIGH |
| 15. Complexity Router | Sí | R, metadata de herramientas E | RT: volumen, módulos, entidades, documentos; fechas/restricciones en código | Calibración con uso real |
| 16. Complejidad no usa Sol | Sí | C, R | RT: rechaza perfil administrativo Sol; timeout no cambia de modelo | Ninguno de código |
| 17. Sol creativo | Sí | R, creative/creativeComplex | RT: concepto y campaña creativa autorizada | Calidad creativa del proveedor |
| 18. Marketing no equivale a Sol | Sí | Intent y permiso R | RT: registro de campaña usa Luna | Ninguno de código |
| 19. Redes no equivale a Sol | Sí | Intent y permiso R | RT: métricas/inbox usan Luna | Ninguno de código |
| 20. Routing creativo | Sí | R, brief T | RT: creativo dentro/fuera de módulo; enum validado | Evaluación de casos creativos reales |
| 21. Modelos ocultos en uso normal | Sí | OliviaAssistant, DeveloperPanel, Usage | Inspección/build; panel técnico solo administrativo y optativo | Ninguno de código |
| 22. Modo desarrollador | Sí | DeveloperPanel, telemetry E | RT: modelo, esfuerzo, ruta y taskId; revisión visual local | Mediciones de dispositivo real |
| 23. Determinístico sin modelo | Sí | T, controls E, confirm | RT: diálogo completo de carga con cero llamadas | Ninguno de código |
| 24. Confirmación visual | Sí | E, operations, planes compartidos | RT: sí no escribe; suites de confirmación/idempotencia | No se ejecuta una prueba en empresa |
| 25. Carga Original/Tribunales | Sí | T, tools, prepare_stock_load | RT: 12 botellas, destino, reposición, stock sin alterar antes de Sí | Presentación ambigua se pregunta |
| 26. Transferir a Pilar | Sí | resolve_transfer_origin, T, extendedOperations | RT: uno suficiente se propone, dos exigen elección, recepción nula se pregunta | Diálogo íntegro de modelo real |
| 27. Métricas fin de semana | Sí | R, analytics, get_sales_metrics | RT: Luna HIGH; suites de métricas/períodos vivos | Inferencia lingüística real del período |
| 28. Forecast Pilar sábado/domingo | Sí | R, forecast_fair, pronosticar-feria 1.1.0 | RT: Luna XHIGH y fecha/días persistidos; suites forecast | Audio y fuente empresarial no se usan en QA |
| 29. Instagram Guara creativo | Sí | R, creative brief | RT: Sol HIGH solo en Redes autorizado | Calidad de concepto no evaluada con proveedor |
| 30. Continuidad de modelo | Sí | task.route, R | RT: aclaración mantiene XHIGH, nueva lectura vuelve a HIGH | Ninguno de código |
| 31. Costo por llamada | Sí | modelCalls E, usage, aggregateRoutes | RT: tokens/costo/IDs; LT: voz separada y finalización | Factura del proveedor no consultada |
| 32. Objetivo económico | Política implementada | R, C | Menos llamadas para slots; exclusión de Sol general | Ahorro real requiere volumen y facturación reales |
| 33. Performance/router económico | Sí | R determinístico, fast path T | RT: no llamada para router ni stock inequívoco | Benchmark contra proveedor real |
| 34. Intent Router | Sí | classifyIntent, operationalIntent | RT: stock, métricas, forecast, creatividad; schema de tools | Ampliar vocabulario según casos reales |
| 35. Required fields | Sí | T y contratos de herramientas | RT: mínimos, slots inválidos y recepción física | Ninguno de código |
| 36. Preguntas desde faltantes | Sí | missingQuestion, T | RT: lenguaje natural sin IDs/nombres de campo | Calidad de redacción de casos complejos reales |
| 37. Agrupación | Sí | missingQuestion, instrucciones E | Preguntas agrupadas de mínimos relacionados, esquema validado | UX lingüística real |
| 38. Ambigüedad | Sí | T, resolve_transfer_origin | RT: Original 500 ml / 2 L y dos orígenes | Casos comerciales fuera de fixtures |
| 39. Voz y texto, mismo estado | Sí | L usa E y conversationId | RT: continúa por voz y termina por texto; LT | Prueba hablada física |
| 40. Simple sin delegación innecesaria | Sí | GPT-Live, taskControl, recordSpeech | LT: espera/transcripción sin modelo backend; RT: sí no ejecuta | Comportamiento conversacional real de Live |
| 41. Configuración central | Sí | C, Settings, saveConfiguration | Build; validación de perfiles, umbrales y límites | No se guarda configuración empresarial en QA |
| 42. Modelos configurables | Sí, acotados por política | C y Settings | RT: mismo Luna, Sol creativo, rechazo fuera de política | Acceso a variantes/snapshots configurados |
| 43. Fallback | Sí | catch E, estado persistido, error de voz | RT: timeout conserva política; LT: cierre incompleto | Sin reintento automático de costo incierto |
| 44. Live habla resultados | Sí | liveSummary + commentary | LT: resumen, estado y tarjeta sin token de confirmación | Naturalidad/latencia de audio real |
| 45. Chat escrito | Sí | E, R, T, SSE | RT y regresión de transporte | Ninguno de código |
| 46. Tests de Router | Sí | RT | Operación, complejo, Marketing/Redes, roles, señales, no fallback Sol | Ninguno de código |
| 47. Tests progresivos | Sí | RT, LT | Cantidad/destino/motivo/ambigüedad/cancelar/nueva intención/orígenes | No son conversaciones con proveedor real |
| 48. Seguridad | Sí | guards, C, lease E, canal L, reglas | Cliente no elige estado/modelo/permisos; ownership; reglas demo | Reglas empresariales no desplegadas |
| 49. Documentación | Sí | OLIVIA-MODEL-ROUTER, arquitectura, voz, pruebas | Diagrama y explicación de fuentes/costos/fallback | Ninguno documental |
| 50. Matriz final | Sí | Este archivo | 52 secciones con evidencia y pendientes explícitos | Ninguno documental |
| 51. Experiencia natural | Sí | T, E, composer existente | Diálogo sin formularios técnicos, contexto persistido | Evaluación humana con audio real |
| 52. Integración final | Sí en draft PR34 | Rama, preview, regresión y docs | Implementación revisable, sin modificar producción | Promoción y QA real fuera del alcance autorizado |

La evidencia final y los IDs de entrega están en [OLIVIA-DELIVERY](OLIVIA-DELIVERY.md). La matriz conserva la evidencia de fixtures del anexo; los resultados posteriores con la sesión humana de Firebase y el proveedor real están en [QA manual](OLIVIA-MANUAL-QA.md). Las limitaciones externas no se convierten en checks aprobados y las pruebas no eluden la autenticación.
