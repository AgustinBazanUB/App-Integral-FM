# Prueba de voz económica de Olivia

## Alcance autorizado

La preview ofrece al administrador el selector «Voz económica · prueba», en paralelo con la voz GPT-Live predeterminada. La prueba fija `gpt-realtime-2.1-mini` para audio y `gpt-4o-mini-transcribe` para transcripción. Cada entrada transcrita pasa al mismo engine de texto: Luna HIGH para consultas habituales, Luna XHIGH para complejidad y la política Sol creativa existente. Mini recibe solo la respuesta verificada para leer, sin herramientas empresariales nativas. Una confirmación oral sigue sin ejecutar operaciones.

La conversación admite interrupciones; se aborta la consulta de chat y se descartan respuestas/transcripciones anteriores. No se abortan confirmaciones empresariales por una interrupción de voz. Los avisos de procesamiento son solo subtítulos: se eliminó la síntesis local del navegador que alternaba la voz. Mini usa siempre marin; la respuesta verificada de Luna se pronuncia sin etiquetas técnicas. Las preguntas de carga piden producto/destino y luego cantidad; el motivo sigue siendo opcional.

## Costos

El modo normal muestra la suma de la sesión (voz, transcripción y todas las consultas del negocio vinculadas). El modo desarrollador muestra los tres componentes. En GPT-Live, la transcripción se indica incluida en la voz, sin duplicar el cobro.

El sideband calcula Mini con contadores del proveedor separados por audio/texto y caché; la transcripción se calcula aparte. Las mediciones incompletas, pendientes y historiales truncados conservan el importe desconocido. Durante la conversación se muestra el subtotal medido; el total requiere cierre y liquidación completa. Solo el propietario en su sesión autenticada puede consultar el resumen; no contiene textos, claves ni credenciales de confirmación.

Los precios almacenados mantienen su precisión. La presentación ARS usa un decimal y los importes positivos menores a $0,1 se muestran «< $0,1». USD usa tres cifras significativas. Se conserva la conversión configurada más 5%.

Tarifas estándar consultadas el 5 de octubre de 2026: Mini audio entrada/caché/salida USD 10/0,30/20 por millón; texto 0,60/0,06/2,40; Mini Transcribe entrada/salida USD 1,25/5 por millón. [Tarifas oficiales](https://developers.openai.com/api/docs/pricing). [Modelo Mini](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini). El precio de sesión es cálculo sobre medición del proveedor, no factura conciliada ni promedio garantizado.

## Verificación

769 pruebas Node aprobadas, incluyendo 27 casos nuevos desde la QA de 742 sobre precios, caché, transcripción, acumulación, importes faltantes, aislamiento entre usuarios/sesiones, arranque administrativo e interrupciones. Build unificado aprobado. La medición de fluidez y entrada de micrófono humano debe verificarse en la preview; los medios de las pruebas automatizadas están controlados.

Primera QA real: Mini inició WebRTC y el usuario escuchó audio. Capturó la conversación simultánea con Codex; Luna HIGH resolvió dos consultas y el subtotal backend fue $7,2 ARS. La sesión terminó con medición de voz incompleta y su total se conserva desconocido. Se detectó lectura de etiquetas técnicas; la salida ahora envía solo texto verificado para pronunciar, sin estados/objetos. La siguiente prueba debe evitar audio de otras conversaciones y cerrar después de terminar la respuesta.

Controles: el composer conserva los dos iconos. Durante una conversación, el icono de micrófono silencia/activa la captura; el icono de conversación inicia/finaliza la sesión. Se retiró la fila adicional de botones y el botón Interrumpir: hablar interrumpe automáticamente. Los subtítulos y el estado siguen visibles. El selector de voz actual/económica aparece solo antes de iniciar.


## Cierre de la prueba y guía orientativa

Se verificó en Chrome una entrada escrita con salida de audio Mini y micrófono silenciado. Luna mantuvo la ruta operativa habitual y la respuesta breve de carga. Los iconos permitieron silenciar y cerrar la sesión. La prueba anterior queda incompleta; no se rellena su contabilidad con un precio inventado.

El cierre autenticado podía cortar el sideband sin frame de cierre. Ahora solo se acepta como cierre esperado después de una solicitud server-side válida y hangup remoto confirmado, manteniendo controles de respuestas/transcripciones pendientes y modalidad/caché. Se conservan indicadores numéricos de incompletitud. Un nuevo cierre real entregó costos de voz con medición completa. Ese caso no incluye transcripción humana.

Se detectó una consulta escrita enviada antes de que terminara la conexión: quedaba fuera del costo de la sesión y de las instrucciones de brevedad. El envío espera ahora a que la conexión esté lista; el micrófono y finalizar siguen disponibles mientras conecta.

Por pedido del usuario, la interfaz Mini muestra una referencia inicial de $10,0–$20,0 ARS por consulta corta. Es orientativa para una frase breve de entrada, 10–20 segundos de voz de salida, incluido el saludo si lo hay, y una consulta simple de Luna. No es una tarifa fija, importe liquidado ni sustituto del total medido. Los componentes confirmados mantienen su cálculo independiente. La referencia se presenta de forma compacta para conservar espacio para los mensajes.
