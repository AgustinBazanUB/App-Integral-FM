# Validación de Olivia sin micrófono

Entorno: PR #55, Deploy Preview de Netlify, Firebase `app-integral-fm-pruebas`. El usuario confirmó que la PC no tiene micrófono y autorizó continuar sin captura. No se habilitó Stereo Mix. No se confirmó ninguna operación de stock, venta, envío ni mensaje a terceros.

## Evidencia real

Hasta `c83c051` se enviaron **30 consultas escritas** en Chrome: 14 a Gemini Live con salida de audio y 16 al chat habitual. Incluyen fallos, aclaraciones y reintentos después de correcciones. La pulsación No para cancelar una propuesta se registra aparte; no aumenta ese número. No son 30 conversaciones por micrófono.

- Gemini: cuatro sesiones, con conexión en 5413, 3342, 4363 y 5198 ms. Fuentes: `chrome-text-session-1.json` a `chrome-text-session-4.json`. La primera evidencia resume las observaciones previas a instrumentar los tipos de frames; las restantes conservan el JSON visible del diagnóstico.
- Chat: `plain-initial.json` y `plain-qa-latest.json`. El primero incluye siete consultas; el segundo, nueve. La conversación queda conservada en staging.
- Referencia comercial: el catálogo mostraba Aceite QA PR53 a $1.000 y la ubicación QA PR53 tenía 19 unidades. Se prepararon 30 unidades, la tarjeta mostró 19 → 49, se eligió No y la lectura posterior volvió a dar 19. La propuesta y las capturas permanecen en esta carpeta.
- Una búsqueda sin producto y otra sin ubicación respondieron con aclaración y no inventaron cantidades. La consulta de pedidos y la comparación de septiembre/octubre usaron los datos del backend. La comparación invocó Luna / medium. Una transferencia incompleta pidió origen/destino y se canceló.

## Medición y límites

En ocho saludos/agradecimientos directos con audio programado y sin marca de transporte incompleto, texto enviado → primer audio programado dio P50 **1351 ms**, P90 **2453 ms** y P95 **2453 ms** (rango observado 777–2453 ms; percentil por rango más próximo). Es una muestra pequeña de distintas revisiones. No mide fin de voz, reconocimiento, inicio físico del altavoz ni continuidad audible completa; tampoco establece una comparación A/B válida con la arquitectura anterior.

El chat habitual midió 13821 ms hasta primer texto y otros 2545 ms hasta completar el saludo; para ventas de hoy midió 12522 + 2561 ms. Son entradas de texto con Luna, no mediciones de la ruta de voz anterior. Las lecturas rápidas de precio y stock reportaron cero llamadas/tokens de modelo.

El último turno de la cuarta sesión mostró USD **0,028032** acumulados Gemini: USD 0,027042 calculados desde contadores y USD 0,000990 estimados. Había un turno sin confirmar; dos fallos iniciales anteriores a corregir el cierre no tienen costo reconciliado. El contador incluye una imputación de audio tardío que motivó otra corrección; se conserva su auditoría sin borrar ni compensar registros. Estos importes no representan la factura ni permiten certificar USD 5–6/mes para conversaciones con entrada de audio. La proyección visible de 660 consultas usa la muestra escrita y no debe presentarse como proyección de voz.

## Problemas y correcciones

1. Los frames binarios se descartaban: ahora se decodifican como UTF-8; el handshake real pasó.
2. «Perfecto, gracias» llamaba al motor innecesariamente: la coincidencia exacta ahora permite Gemini directo; se verificó en Chrome.
3. Algunos turnos trajeron transcripción, PCM de dos bytes y generación finalizada sin cierre de turno. Se agregó recuperación tras el audio ya programado y cinco segundos de gracia, más un plazo de respuesta independiente. No se cuenta una recuperación como éxito de audio nativo.
4. Los turnos incompletos no se reportaban al cerrar: ahora se registran antes de liberar la reserva y permanecen sin confirmar cuando faltan contadores.
5. «Cuánto stock de…» se buscaba como parte del nombre del producto: se corrigió el parser y la repetición real dio las 19 unidades correctas.
6. Frames tardíos podían imputarse a un placeholder vacío como otro turno: se descartan cuando no hay turno pendiente. La regresión verifica que no generan audio, texto ni otro uso.
7. Una respuesta comercial terminó en «Tené en cuenta que figura»: el máximo de 180 tokens podía cortar la salida. Se eleva a 512, manteniendo una instrucción de respuestas de una o dos frases. Requiere repetición remota tras desplegar.
8. El consolidado de costos podía quedar un turno atrasado: se actualiza junto al nuevo uso de Gemini en el diagnóstico y en la voz habitual.

La formulación larga de preparación de stock exigió aclarar nombre y cantidad por separado. Una consulta referencial («cuál era el producto…») terminó con el error controlado «El producto no está habilitado en esta ubicación»; no se considera validada la continuidad semántica de ese caso. No se enviaron reportes a terceros ni se confirmó un cambio para sortearlo.

## Comprobaciones automatizadas y aceptación

### Repetición en `eca2c87`

Después de las 30 consultas anteriores se hicieron otras dos, para un total de **32 entradas reales escritas: 16 Gemini y 16 chat habitual**. No se cuentan los clics de conectar/cerrar ni la cancelación de la tarjeta como entradas conversacionales. El [registro final](chrome-text-session-5.json) confirmó:

| Consulta | Ruta | Texto → primer audio programado | Texto → resultado | Costo calculado Gemini |
| --- | --- | ---: | ---: | ---: |
| Precio del Aceite QA PR53 | Herramienta de Olivia | 8107 ms | 14120 ms | USD 0,002926 |
| Perfecto, gracias | Gemini directo | 1962 ms | 3490 ms | USD 0,002550 |

Ambos turnos recibieron cierre normal, uso y audio programado. La respuesta comercial fue completa: «El precio del Aceite QA PR53 en QA PR53 es de mil pesos». Esto verifica el dato y el cierre del flujo; no constituye evaluación auditiva física.

Gemini quedó con USD 0,033508 registrados (USD 0,032518 calculados desde uso y USD 0,000990 estimados), un uso sin confirmar y 15 turnos contabilizados, incluyendo la imputación histórica de frames tardíos descrita arriba. Configuración confirmó **USD 0,0000 reservados** tras cerrar. El consolidado mensual visible fue aproximadamente USD 0,0277 Luna/Sol + USD 0,00402 Chirp + USD 0,0335 Gemini = USD 0,0652; incluye actividad previa y no es el costo exacto de esta batería ni una factura.

Se comprobó otra discrepancia de presentación: el backend ya liberaba la reserva, pero el panel conservaba USD 0,50 hasta recargar. El cierre ahora propaga el resumen confirmado a la interfaz, conservando el uso por turno. La regresión verifica esa notificación; se repetirá el ciclo de conexión/cierre después del despliegue de esta corrección visual. El inventario fresco siguió en 19 unidades ([captura final](stock-final.png)).

La suite local pasa **1104/1104** y el build compila; mantiene el aviso previo de bundles mayores a 500 kB. Las pruebas focalizadas reproducen frames binarios, costo por modalidad, límites de staging, clasificación, audio retenido, cierre incompleto, uso sin confirmar y frames tardíos.

Pendientes: prueba física del micrófono y reconocimiento, ruido, barge-in real, comparación audible Gemini/Chirp, percentiles desde el fin del habla y costo de entrada de audio. Los tests simulados de esos mecanismos están separados de la evidencia de proveedor real. La integración sigue en preview y su aceptación de voz completa permanece pendiente.
