# Prueba de voz económica de Olivia

## Alcance autorizado

La preview ofrece al administrador «Probar voz económica», en paralelo con la voz GPT-Live predeterminada. La prueba fija `gpt-realtime-2.1-mini` para audio y `gpt-4o-mini-transcribe` para transcripción. Cada entrada transcrita pasa al mismo engine de texto: Luna HIGH para consultas habituales, Luna XHIGH para complejidad y la política Sol creativa existente. Mini recibe solo la respuesta verificada para leer, sin herramientas empresariales nativas. Una confirmación oral sigue sin ejecutar operaciones.

La conversación admite interrupciones; se aborta la consulta de chat y se descartan respuestas/transcripciones anteriores. No se abortan confirmaciones empresariales por una interrupción de voz. Los avisos breves de procesamiento utilizan síntesis local del navegador, sin tarifa API adicional; su calidad depende del dispositivo.

## Costos

El modo normal muestra la suma de la sesión (voz, transcripción y todas las consultas del negocio vinculadas). El modo desarrollador muestra los tres componentes. En GPT-Live, la transcripción se indica incluida en la voz, sin duplicar el cobro.

El sideband calcula Mini con contadores del proveedor separados por audio/texto y caché; la transcripción se calcula aparte. Las mediciones incompletas, pendientes y historiales truncados conservan el importe desconocido. Durante la conversación se muestra el subtotal medido; el total requiere cierre y liquidación completa. Solo el propietario en su sesión autenticada puede consultar el resumen; no contiene textos, claves ni credenciales de confirmación.

Los precios almacenados mantienen su precisión. La presentación ARS usa un decimal y los importes positivos menores a $0,1 se muestran «< $0,1». USD usa tres cifras significativas. Se conserva la conversión configurada más 5%.

Tarifas estándar consultadas el 5 de octubre de 2026: Mini audio entrada/caché/salida USD 10/0,30/20 por millón; texto 0,60/0,06/2,40; Mini Transcribe entrada/salida USD 1,25/5 por millón. [Tarifas oficiales](https://developers.openai.com/api/docs/pricing). [Modelo Mini](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini). El precio de sesión es cálculo sobre medición del proveedor, no factura conciliada ni promedio garantizado.

## Verificación

756 pruebas Node aprobadas, incluyendo 14 casos nuevos sobre precios, caché, transcripción, acumulación, importes faltantes, aislamiento entre usuarios/sesiones, arranque administrativo e interrupciones. Build unificado aprobado. La medición de fluidez y entrada de micrófono humano debe verificarse en la preview; los medios de las pruebas automatizadas están controlados.
