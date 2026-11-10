# Conversación contextual V6.2

Gemini sigue siendo el motor conversacional. El borrador nativo contiene únicamente lo dicho por el usuario: intención, ubicación solicitada, productos/cantidades mencionados, nombre solicitado, campos faltantes, pregunta pendiente, correcciones, revisión e historial acotado. `validation: unverified` nunca autoriza una operación ni afirma entidades existentes.

Stock pregunta ubicación y productos/cantidades antes de delegar. «Cargar un producto» debe aclarar alta frente a stock. El alta pregunta nombre; los demás datos y todas las validaciones pasan al motor existente. Consultas de negocio siguen requiriendo herramientas autorizadas. Capacidades, sesión y confirmación visual permanecen en backend. No se añadió otra llamada de clasificación.

La política combina límites de datos comerciales, contexto de tareas y un borrador acotado; no es una lista exhaustiva de respuestas sociales. Los controles ambiguos con varias tareas requieren aclaración. Una petición independiente explícita no puede reutilizar el ID de una propuesta ajena, aunque Gemini lo solicite. Una operación con efectos comerciales continúa requiriendo la tarjeta visual.

## Casos reales relevantes

| Caso | Resultado |
|---|---|
| Ocho expresiones sociales S01–S08 | Respuestas nativas, cero tool calls y cero tareas observadas |
| C01 → C02 → C03 | Preguntó ubicación y productos antes de delegar. Primera transcripción de ubicación/producto ambigua: backend pidió aclarar, sin carga |
| R-C01 → R-C02 → R-C03 | Backend identificó QA Envíos - Producto de prueba y propuso stock 12 → 13; esperaba confirmación. No se confirmó |
| Tres tareas R-C03/B01/B02 | Coexistieron en running; la voz respondió R-S03. Dos consultas terminaron y stock llegó a propuesta |
| Cambio a cliente tras stock | Primera versión reutilizó la tarea incorrecta; evidencia conservada. Después se forzó un ID nuevo para pedidos independientes |
| Producto/cliente/transferencia F-* | Tres IDs diferentes; las tres terminaron pidiendo datos. El nombre omitido del cliente sigue siendo una alerta de interpretación: pidió teléfono aunque se había dicho que el nombre no estaba disponible |
| C09 → C10 → C11 | Reprodujo borrador anterior activo y camino rápido marcado como completado. Corregidos ambos mecanismos |
| Q-C09 → Q-C10 → Q-C11, último código lógico | Stock quedó reemplazado; misma tarea de producto recibió el nombre y quedó needs-input por abreviación/precio. `final-scope-tasks.json` privado conserva el resultado |
| C07/C08 | Borrador de stock sin enviar y cancelación conversacional; sin modificación comercial |
| B06 | Se inició un reporte de QA mediante Olivia; backend pidió qué ocurre y debe mejorar. No se publicó ni envió un mensaje a terceros |

## Lo que aún impide aprobar la fluidez

El filtro de preguntas exige coherencia con el campo pendiente y bloquea afirmaciones comerciales. Varias respuestas naturales no pasaron esa gramática y terminaron como pregunta escrita sin audio. El caso «Tomado» se corrigió; los casos restantes no están resueltos. No se debe abrir el filtro para permitir hechos sin validar ni llamar a otro TTS silenciosamente.

La cola y el proveedor pueden completar un aviso mientras otro turno habla. El harness acústico usa un propietario aproximado de salida; esa aproximación se vuelve ambigua con avisos simultáneos. Las trazas de la aplicación incluyen sessionId, sourceTurnId y taskId. Se conservan aparte y no se publican latencias definitivas por tarea basadas solo en la heurística del harness.

Ruido sintético de 500 ms todavía puede detener la reproducción sin reanudar. No hay evidencia suficiente para distinguir de forma fiable una interrupción involuntaria de una intención breve en un micrófono físico. Repetición estable de veinte, pausa/reanudación completa, tres escrituras verificadas en paralelo y notificaciones durante habla necesitan otra batería controlada antes de aprobar producción.
