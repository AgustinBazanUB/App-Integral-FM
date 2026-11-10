# Resultados de pruebas Olivia V6

## Identidad y alcance

Código final: `3c43f1e2cb43a7f752f4a5775cc891f6a686292b`, rama `codex/olivia-conversacion-continua-v6`. [PR #57, draft](https://github.com/AgustinBazanUB/App-Integral-FM/pull/57), [Deploy Preview](https://deploy-preview-57--appintegralflormia.netlify.app/gestion/settings). Base V5 `516ef2468ef527507a3d9a97d1ab6d21ece144dd`. Cada fila conserva el SHA donde se ejecutó; las correcciones de transporte posteriores no convierten las muestras anteriores en pruebas del último SHA.

Se actuó en Chrome con la aplicación y los proveedores reales. La modalidad principal fue voz sintética decodificada en un MediaStream de entrada, no texto enviado a Olivia. El navegador, VAD, transcripción, Gemini Live, herramientas, Luna y backend sí participaron. Esa modalidad aísla el ruido de la PC, pero no comprueba el micrófono físico, parlantes, cancelación de eco o audición humana. Las consultas directas al backend se usaron para inspección posterior y lectura de estado; las dos operaciones funcionales se iniciaron conversando con Olivia.

Una prueba física genuina se conserva por separado. No se completaron 37 interacciones físicas válidas. Los intentos sin transcripción, sin audio, interrumpidos por recuperación, con solo acuse o repetidos siguen en el registro y no cuentan como aprobados.

Registro final: 81 intentos/estímulos, 76 con alguna transcripción y 67 con buffers programados. Incluye repeticiones, dos pulsos de ruido sin habla, un intento físico no validado y fallos. Hay registros relacionados con los 37 casos base, pero eso no equivale a 37 aprobaciones funcionales o físicas. No se calcula una tasa global mezclando esas rutas.

Antes de escribir se comprobó `app-integral-fm-pruebas` en frontend, audiencia de Auth y respuesta autenticada de Functions; el servidor exige coincidencia del proyecto y de su cuenta de servicio. No se expusieron credenciales. No se tocó producción, ARCA ni se enviaron mensajes externos.

## Evidencia individual y metodología

- `INTERACCIONES_V6.csv`: intentos individuales, transcripción, texto generado, herramientas, buffers y tiempos; el texto generado no prueba que se haya pronunciado completo.
- `LATENCIAS_V5_V6.csv`: los 37 casos originales y los intentos V6 relacionados. Incluye transcripción real para no suponer equivalencia por número de caso.
- `TRAZAS_V6.json`: etapas del laboratorio sanitizadas, reloj `performance` separado por sesión.
- `TRAZAS_APP_V6.json`: exportación del panel Developer con correlación propia del cliente y servidor.
- `EVIDENCIA_ADICIONAL_V6.json`: lecturas de 20 elementos, operaciones QA y cortes controlados.
- PCM, estímulos y ASR completos permanecen fuera de Git, bajo el directorio privado `validacion-v6-41cb4d7` de esta auditoría. El sufijo es histórico; cada JSON identifica su SHA real.

El fin del estímulo se estima por ventanas RMS de 5 ms, umbral 0,006. Primer buffer es la marca de programación de WebAudio. Primera energía PCM usa el mismo umbral en las muestras conservadas. Ninguna de las dos es una medición acústica en el parlante. Las marcas del servidor no se restan directamente de `performance.now()`. La respuesta final delegada se distingue del acuse; el respaldo asíncrono puede emitir avisos por `clientContent`, por lo que el dueño de un bloque en el laboratorio puede ser ambiguo. En esos casos mandan la traza de la aplicación y el estado persistente, y no se publica una latencia final atribuida sin prueba.

## Conversación y latencia

Dos cohortes de diez turnos sociales se completaron sin herramientas nativas ni Luna. La segunda, `V6-F01` a `V6-F10`, corresponde a `6e28f19`. Se comprobó también el audio con ASR offline. Hubo cero delegaciones innecesarias y cero turnos sin audio en esa cohorte. Esto no implica tasa de error cero para todas las rutas.

| Cohorte / métrica | n | P50 | P90 | P95 | Promedio | Máximo |
|---|---:|---:|---:|---:|---:|---:|
| Histórico V5, casos 01–10, primer buffer | 10 | 1348,5 | 2016,3 | 2019,9 | 1546,8 | 2019,9 |
| V6 inicial, primer buffer | 10 | 1426,2 | 1750,3 | 2512,2 | 1540,0 | 2512,2 |
| V6 repetición social, primer buffer | 10 | 1466,8 | 1762,0 | 2081,7 | 1531,0 | 2081,7 |
| V6 repetición social, primera energía PCM | 10 | 1484,3 | 1797,0 | 2111,7 | 1559,0 | 2111,7 |

Tiempos en ms, percentiles de rango más próximo, descriptivos de diez observaciones. No se atribuye una mejora porcentual ni se garantiza menos de 1 s o 500 ms. Los valores históricos de 18–20 s del informe inicial mezclaban rutas delegadas y aproximaciones acústicas; no son una base equivalente para porcentajes.

La fila histórica V5 procede del CSV de `6991b366…`, no de una nueva ejecución del HEAD V5 `516ef246…`. Los casos incluyen ocho frases sociales y dos contextuales; el CSV detalla diferencias literales de estímulo/transcripción. V6 conserva el orden de magnitud observado, pero estas muestras no prueban no inferioridad estadística ni mejora porcentual.

`V6-CONTEXT-FINAL` en `c59c624` repitió el caso que antes creaba un trabajo innecesario: respondió «Entendido, no le voy a enviar mensajes», con cero herramientas y cero tareas nuevas. La versión anterior usaba una llamada Luna, cero herramientas, 2621 ms de proveedor y 7971 ms de trabajo total.

## Lista de veinte elementos

| Muestra | SHA | Texto | Audio contrastado | Resultado |
|---|---|---|---|---|
| V6-LIST20-A | 41cb4d7 | 20 | Vosk y Whisper: 20 | Completa en esa muestra; PCM programado 29,76 s |
| V6-LIST20-B | 6e28f19 | 20 | Ambos ASR señalan omisión/cambio alrededor de 10–12 | Fallo conservado; PCM 22,92 s |
| V6-LIST20-C | c59c624 | 20 | Vosk y Whisper: 20, incluido audio crudo del proveedor | Completa en esa muestra; PCM 26,62 s |

C conserva 75 bloques recibidos y 75 programados, 638.880 muestras en ambos, diferencia máxima de una unidad int16 por cuantización. Whisper produjo la misma lista completa sobre ambos archivos. Esto descarta pérdida de bloques del reproductor en C; no localiza retrospectivamente el fallo B porque allí no se conservó el PCM recibido antes del reproductor. No se certifica repetición estable 20/20. Son elementos ficticios dictados, no veinte productos reales recuperados del catálogo. La lista tiene pausas; no equivale a una batería completa de veinte productos con correcciones complejas.

## Operaciones QA y controles

1. Alta de cliente iniciada por audio, datos ficticios por audio, tarjeta revisada y clic visual. Documento verificado: `customers/customer_019f4696d589ed87d3ef9af5c6d543f55197f190`. Se conserva el registro. La frase de autorización negativa no ejecutó la operación.
2. Carga de stock final iniciada por audio. Producto existente sintético `TyLvf3SaCgPElBUNvspc`, «QA Envíos - Producto de prueba»; local sintético `7011f524-ce34-4e55-a5e4-9330ad4ee492`, «QA Envíos Preview - 20 Oct 2026». Tarjeta: una unidad, stock 11 → 12. Pausa por voz → `paused`; reanudación por voz → `awaiting-confirmation`; la operación se ejecutó solo al tocar «Sí, confirmar operación». Firestore terminó en 12 y guardó movimiento `olivia_stock_9c9cb955-8516-480d-9644-9b142ded941a_TyLvf3SaCgPElBUNvspc`. El backend informó éxito y se verificó recibo de notificación. Se conserva el movimiento.
3. Solicitud posterior de crear un cliente sin datos → `needs-input`; cancelación explícita por voz → `cancelled`, recibo entregado, sin crear otro cliente.

La primera solicitud de stock sin ubicación no se resolvió completamente: ASR reconoció «Q envíos», la búsqueda por comienzo no encontró el producto y preguntó por ubicación. Esa tarea quedó `completed` aunque su texto pedía información. La solicitud completa posterior preparó correctamente la tarjeta, pero no se considera aprobado todo el diálogo de datos faltantes. Hace falta representar estructuralmente la recolección genérica, sin inferir permisos de una pregunta en texto libre.

Durante una tarea activa, «Muchas gracias» recibió «De nada» directamente, sin herramienta. Una tarea de análisis persistida realizó cuatro llamadas de modelo y ocho herramientas, proveedor 15.158 ms, total 27.054 ms; dejó progreso real revisión 16 y resultado final. La entrada inicial de ese análisis se perdió parcialmente en recuperación; no se aprueba como reproducción íntegra del guion complejo.

La pausa persistente fue correcta, pero el audio agregó «revisá y confirmá la tarjeta» estando pausada. La tarjeta solo ofrecía retomar/cancelar, sin ejecutar. Queda pendiente mejorar la redacción contextual de los controles.

## Matriz de los quince escenarios pedidos

| # | Escenario | Resultado verificable / límite |
|---:|---|---|
| 1 | Diez turnos sociales | Aprobado en audio virtual en dos cohortes; cero delegaciones |
| 2 | Escucha activa con pausas | Parcial: dictados y pausas registrados; naturalidad de backchannels, eco y palabras perdidas físicos pendientes |
| 3 | Tarea y conversación simultánea | Parcial: respuesta social directa durante trabajo; guion completo de tareas complejas concurrentes pendiente |
| 4 | Consulta de estado | Ruta `status` observada, sin trabajo Luna nuevo; pronombres y estados semánticos complejos pendientes |
| 5 | Progreso automático | Evento y revisión reales observados, aviso de progreso y recibo; utilidad de la frase y variedad pendientes |
| 6 | Operación con dato faltante | Parcial: operación QA completa confirmada y verificada; primera recolección genérica quedó terminal indebidamente |
| 7 | Función inexistente | Parcial: ofreció métricas reales; explicación explícita de incapacidad y pregunta de continuación insuficientes |
| 8 | Cortes breve y prolongado | Recuperación automática real y continuación por voz; detalles en RECUPERACION_GEMINI_V6.md; frases durante caída pueden perderse |
| 9 | Panel normal | Revisado en Chrome: sin IDs/tokens/cola técnica; conserva tarjetas seguras; avisos de error legibles |
| 10 | Developer | Revisado y exportado: costos, tareas, recuperación, trazas y recibos; acceso de administrador |
| 11 | Dictado de 20 | Dos lecturas completas y una incompleta; aceptación estable pendiente |
| 12 | Notificación final | Resultado stock verificado y recibo posterior; exclusión sistemática de habla activa y audición física pendientes |
| 13 | Error recuperable de herramienta | Fixtures técnicos y rechazo real 409 sin cierre de charla; falta fallo transitorio real de una herramienta por voz |
| 14 | Costos | Baseline y cierre autenticados; límites intactos; hay consumo sin confirmar, ver COSTOS_V6.md |
| 15 | Varios minutos y silencio | Sesiones prolongadas reales, cierres por inactividad y recuperación observados; no certifica estabilidad continua ni memoria/CPU; micrófono liberado al finalizar |

## Prueba física y ruido ambiente

`V6-PHYS-01` sí recorrió parlantes → micrófono Intel → Chrome. El saludo se segmentó y hubo actividad posterior. La correlación de referencia y respuesta no alcanzó el criterio 0,9; no se publica un tiempo acústico de ese intento. El preflight de 3 s tuvo RMS mediana 0,000017 y P95 0,000632; eso describe solo esos segundos, no toda la sesión.

Cuando el usuario pidió poder utilizar la PC, se dejó de controlar ventanas nativas y se continuó con la pestaña de Chrome en segundo plano y una entrada virtual sin micrófono físico. No se graba el ambiente del usuario en esa modalidad. La cancelación de eco y la supresión de ruido pueden estar solicitadas en `getUserMedia`, pero no se dan por efectivas por ese solo hecho. La identificación semántica de interrupciones accidentales y la reanudación automática exacta de la frase anterior siguen pendientes de validación e implementación específica.

### Pulsos sintéticos en el código final

Se enviaron señales sin palabras, banda 300–4000 Hz, RMS 0,08 antes de ganancia 0,65, semilla reproducible 20261108. No son grabaciones del ambiente de la PC.

- 150 ms durante una explicación: cero llamadas `stop()` de salida y cero interrupciones del proveedor; la respuesta continuó. Compatible con el filtro local de 160 ms, sin certificar todos los ruidos cortos.
- 500 ms durante otra explicación: nueve nodos detenidos, ninguna palabra transcrita, cero bloques programados después del primer `stop()` y antes de la siguiente solicitud. Olivia pidió repetir y no retomó automáticamente. La entrada de esa segunda explicación además conservó solo la última cláusula.
- Ante «Ese ruido no era para vos, seguí con lo que estabas contando», continuó con el brote y la fotosíntesis, sin herramientas. Conservó el tema, pero necesitó la petición. La recuperación semántica automática de ruido accidental no está aprobada.

## Verificación técnica y pendientes

1150 tests aprobados, build aprobado con aviso de chunks grandes. Se verificó red restaurada, voz finalizada y ausencia de reservas activas al cierre. Sin cambios a reglas/índices y sin despliegue de Firebase o producción. Los tests de reglas de V5 no se presentan como una nueva ejecución V6.

Pendientes prioritarios: repetición de listas estable; recolección estructurada de datos genéricos; ruido y reanudación accidental física; mensajes de pausa/reanudación; fallo transitorio real de herramientas; batería física completa; varias operaciones complejas simultáneas y notificaciones mientras se habla; reconciliar consumo desconocido. No aprobar producción con este informe parcial.
