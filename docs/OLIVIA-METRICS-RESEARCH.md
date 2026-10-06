# Períodos y métricas investigadas con Luna

Olivia interpreta cuánto vendimos como total cobrado por ventas, con las mismas reglas del Panel de Métricas; no equivale a ganancia ni emisión fiscal. Producto más vendido se ordena por unidades. Ticket promedio es monto / operaciones y no aplica si no hubo ventas.

Cuando no hay período elegido, pregunta mes, rango o todo el historial. Ayer/hoy se resuelven en Argentina. El período de una consulta exitosa queda guardado en la conversación y puede reutilizarse en repreguntas, incluso al salir del tramo reciente del chat. Promedio sin objeto requiere aclaración. No se toma el filtro visible de la pantalla sin una solicitud de usarlo.

`get_all_time_sales_metrics` consulta desde el primer registro hasta hoy, conservando filtros y la fórmula compartida del panel. No inventa un período previo para todo el historial. Las fechas explícitas admiten más de un año. La lectura histórica está acotada a 100 páginas de 150 registros; al alcanzar el límite se declara parcial y la primera fecha observada no se presenta como inicio completo del historial. Rangos comunes conservan 10 páginas. Una base sin ventas no inventa fecha inicial ni ticket.

`research_web_metric` se ofrece exclusivamente a admin/general_admin con permiso de métricas vigente, revalidado en el backend. Recibe un concepto público y consulta Responses/web_search con el modelo administrativo Luna, sin enviar conversación, adjuntos, registros de clientes, resultados internos ni totales a la petición de investigación. La selección del modelo y límites es del servidor; una investigación permite hasta una llamada de búsqueda. No ejecuta código, navega sesiones privadas ni publica contenido.

El resultado externo explica fórmula e insumos, entrega enlaces citados y fecha; el motor principal puede combinar esa metodología con herramientas internas autorizadas. Si faltan costos, visitas o identificadores necesarios, debe indicar qué falta. Un benchmark externo no sustituye datos del negocio. HTML y enlaces ejecutables permanecen como texto; las citas HTTP(S) se abren como enlaces sin credenciales.

El uso suma tokens de la llamada principal y de investigación y la tarifa de búsqueda observada ($0,01 por llamada de búsqueda), según [documentación oficial](https://developers.openai.com/api/docs/pricing). Un fallo sin medición conserva costo desconocido. Las consultas ordinarias a ventas no necesitan investigación web. La referencia de voz corta no representa el precio de una investigación.

Validación automatizada: períodos faltantes, datos de años anteriores, filtros, ranking por unidades, historial vacío/parcial, persistencia del período, permisos actualizados, aislamiento del contexto de investigación, citas seguras y costo de llamadas anidadas. La verificación manual se hace en la preview; no modifica operaciones comerciales.
