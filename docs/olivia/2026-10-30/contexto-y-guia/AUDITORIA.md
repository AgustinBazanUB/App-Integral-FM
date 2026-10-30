# Auditoría de contexto y guía de Olivia

Se revisaron 69 herramientas y 18 módulos documentados, contrastados con los esquemas del servidor y la guía de funciones de la aplicación. Cero campos mínimos sin explicación. Las guías describen entradas: no agregan permisos ni herramientas.

## Qué fallaba en la charla revisada

- Pedir repetir con más detalle no se reconocía como explicación; el backend volvía a usar la repregunta de la tarea pendiente.
- La repregunta determinista reemplazaba la respuesta por una lista de campos sin explicar su significado.
- Pedir documentar la mejora no incluía el nombre Agustín y no entraba al flujo de sugerencias; se interpretaba como continuación del alta.
- Ubicaciones exigía dniMode, una configuración que no tiene consumidores activos en el código de ventas. Se retiró del formulario, contratos y nuevas escrituras. No se alteran documentos históricos.

## Cambios y límites

- Guía compartida con ejemplos por dato, uno o dos relacionados por turno; explicación detallada cuando se solicita. No pide IDs ni centavos al usuario.
- La explicación de campos conserva la tarea. Documentar una mejora la pausa y conserva los datos para retomar. Los datos de una tarea iniciada sin modelo también conservan su intención en turnos posteriores.
- La propuesta se guarda como borrador en el chat. Reformularla conserva la propuesta anterior y 16 mensajes recientes de contexto. Solo una aceptación inequívoca posterior envía exactamente la versión revisada a las notificaciones internas de Agustín.
- Rechazar no envía; una tarea nueva deja de usar el borrador. La confirmación de una sugerencia no confirma ninguna operación comercial. No se reprograma a Olivia automáticamente: el cambio de software lo revisa Agustín.
- Las tareas y el borrador pertenecen a la conversación y a su retención. No se promete memoria permanente entre chats. La guía natural es una regla general de esta versión para todos los usuarios autorizados.
- No se cambia de modelo, voz ni biblioteca de audios. Inicios acotados y explicaciones de campos usan cero llamadas de modelo; preparar/reformular sugerencias usa una llamada, aceptar/rechazar cero.
- El grafo de Graphify consultado es parcial (la extracción anterior tiene referencias externas sin resolver); los hallazgos se verificaron leyendo los contratos y flujos, no suponiendo que el grafo cubre toda la app.

## Funciones de la aplicación

| Módulo | Ayuda de Olivia | Flujo manual y límites |
| --- | --- | --- |
| Ubicaciones y stock de locales | Consultar ubicaciones, productos y stock. Preparar altas/ediciones de ubicación, cargas individuales y listas de mercadería con productos existentes o faltantes, y transferencias con recepción explícita. | Fijar, pausar/restaurar ubicaciones, calendario operativo, asignaciones de vendedores/descuentos y ajustes físicos de inventario se realizan en sus formularios. |
| Depósitos y transferencias | Consultar depósitos, inventario y movimientos; preparar depósito y transferencias entre depósitos y ubicaciones con cantidades previstas, preparadas y recibidas. | El ingreso inicial, la suma directa de stock y el ajuste por conteo físico en depósito tienen formulario manual; prepare_stock_load solo carga ubicaciones. No afirmar que ya existe esa herramienta para depósito. |
| Catálogo y categorías | Buscar productos y categorías, resolver presentaciones; preparar revisión de alta y listas de catálogo/stock en ubicación. | Editar/desactivar productos, imágenes, categorías, precios y reglas locales se hace en los formularios de catálogo e inventario. Una revisión no es un producto creado. |
| Ventas administrativas | Consultar ventas autorizadas, preparar ventas individuales o listas de hasta veinte con origen físico, canal, productos, pagos, cliente, descuentos y decisión de comprobante. Revisión de anulación y estado fiscal. | Emisión fiscal, anulación y edición de ventas usan sus flujos de revisión. Seleccionar un pago no procesa dinero bancario. |
| Clientes y fidelización | Buscar por nombre/teléfono, consultar ficha e historial y preparar alta o enriquecimiento/edición explícita de nombre y zona. El teléfono evita duplicados. | Importar Excel, gestionar zonas, filtros de fidelización y cambio del teléfono existente se revisan en CRM. No inferir consentimiento para campañas. |
| Métricas y proyección de demanda | Ventas, unidades, ticket, productos, ubicaciones, vendedores, períodos históricos, comparación y métricas derivadas de datos disponibles. Pronóstico de feria y estimación por presentación con forecast_product_demand. Asesoría estratégica, escenarios y supuestos explícitos. | Los filtros visuales se manejan en pantalla. Sin costos no calcular ganancia; sin base suficiente no inventar demanda ni relaciones causales. |
| Finanzas | Consultar resumen e historial financiero y preparar gastos con validación del módulo. | Editar gastos, presupuestos, parámetros y acreditar/conciliar caja y banco se hace en Finanzas; no hay movimiento bancario autónomo. |
| Gestión de envíos vigente | Leer envíos registrados y explicar el proceso vigente de preparación, repositorio, repartidor y entrega. Ayudar a identificar el envío y orientar al formulario correspondiente. | Los envíos nacen desde Venta Rápida/Panel Vendedor; no se crean con prepare_shipment_create. Aprobar origen físico, asignar preparación/repartidor, verificar domicilio en mapa, QR/etiquetas, repositorio, rutas, comprobación de retiro/entrega, incidencias y reintentos tienen controles propios. Olivia no ejecuta esas transiciones. El módulo actual ya no es una tabla genérica. |
| Marketing, WhatsApp y Meta Ads | Leer campañas/estados, preparar registro de campaña en borrador, analizar resultados y diseñar estrategia de venta. Producción creativa autorizada usa el router de Marketing/Redes. | Crear/operar campañas de WhatsApp, seleccionar destinatarios, iniciar/pausar emisor, aprobar teorías/planes y organizar archivos de Meta se hace en sus workspaces. Un registro genérico no publica ni envía mensajes. |
| Redes sociales | Leer consultas/leads, preparar registro de una consulta y desarrollar conceptos, textos y propuestas creativas. | No hay publicación ni respuesta automática a bandejas externas mediante estas herramientas. |
| Pedidos y tienda | Consultar pedidos registrados y abrir revisión segura del pedido. | El estado de pagos, disponibilidad pública y checkout depende de la configuración del entorno; no inferir que un proveedor de pagos está habilitado por ver el catálogo. |
| Alertas y sugerencias | Leer alertas y preparar una alerta manual autorizada. Si el usuario pide enviarle una idea a Agustín, el flujo de sugerencias conserva la idea y pantalla; requiere petición explícita. | No existe una herramienta universal para resolver/reasignar todas las alertas. Ofrecer una sugerencia no significa que se haya enviado. |
| Proveedores | Consultar proveedores y preparar un alta de registro. | No hay compra/pago automático, cuentas corrientes ni recepción de mercadería implícita. |
| Actividad y auditoría | Consultar actividad autorizada y explicar los cambios registrados. | El historial no se edita ni se borra con Olivia; no prometer exportaciones inexistentes. |
| Usuarios y permisos | Consultar perfiles autorizados y preparar revisión de rol en Administración. | Crear cuentas, modificar acceso/credenciales y confirmar cambios sensibles se hace en su flujo administrativo. |
| Configuración y facturación | Consultar configuración segura/estado fiscal y abrir revisión administrativa. | Credenciales, emisión ARCA y cambios de configuración requieren el formulario seguro; una tarjeta de revisión no emite un comprobante. |
| Conversación de Olivia | Texto, archivos, dictado, historial con scroll, tareas pausadas/canceladas/retomadas y guía de procesos. Voz de preview: GPT Transcribe → Luna → Chirp 3 HD con Equalizer Orb, según habilitación de la cuenta. Espera hablada breve y progreso visual; las correcciones nuevas reemplazan la respuesta en curso conservando los datos de tarea. | Conocimiento no agrega permisos ni herramientas. Las acciones comerciales requieren tarjeta Sí/No. Audio físico y ruido necesitan prueba en dispositivo. Las tareas pausadas viven dentro de esa conversación y vencen con su retención. |
| Panel Vendedor | Ayuda del panel, stock/precios autorizados, ventas propias de hoy y preparación de ventas individuales/listas con confirmación. Mensajes de sugerencias a Agustín cuando el vendedor lo pide. | Sin acceso administrativo, historial global, carga de stock, publicaciones ni cambios de permisos. Operaciones offline permanecen en la cola local del dispositivo. |

## Datos de cada herramienta

| Herramienta | Alcance | Datos mínimos explicados |
| --- | --- | --- |
| get_current_user_context | lectura o navegación | Sin datos mínimos adicionales; valida su contrato |
| list_locations | lectura o navegación | Sin datos mínimos adicionales; valida su contrato |
| search_products | lectura o navegación | query: qué querés buscar o conocer<br>locationId: el nombre de la ubicación donde vamos a trabajar; por ejemplo, Local Centro |
| get_stock | lectura o navegación | locationId: el nombre de la ubicación donde vamos a trabajar; por ejemplo, Local Centro<br>productId: el nombre del producto y su presentación; por ejemplo, aceite Arbosana de 500 ml |
| get_promotions | lectura o navegación | locationId: el nombre de la ubicación donde vamos a trabajar; por ejemplo, Local Centro |
| get_today_sales | lectura o navegación | locationId: el nombre de la ubicación donde vamos a trabajar; por ejemplo, Local Centro |
| navigate_to_module | lectura o navegación | module: qué sección de la aplicación querés abrir; por ejemplo, Productos o Ubicaciones<br>entityId: qué registro querés revisar: podés decirme su nombre o referencia; no necesitás conocer un identificador interno |
| prepare_stock_load | tarjeta de confirmación | locationId: el nombre de la ubicación donde vamos a trabajar; por ejemplo, Local Centro<br>productId: el nombre del producto y su presentación; por ejemplo, aceite Arbosana de 500 ml<br>quantity: cuántas unidades querés cargar; por ejemplo, 12 botellas |
| prepare_sale | tarjeta de confirmación | locationId: el nombre de la ubicación donde vamos a trabajar; por ejemplo, Local Centro<br>items: los productos y sus cantidades; por ejemplo, 12 botellas de aceite de 500 ml<br>paymentMethod: cómo se pagó: efectivo, tarjeta, transferencia o una combinación; si combinás medios, indicá cuánto en cada uno<br>ticketRequested: si necesitás un comprobante; la emisión fiscal se revisa en su propio formulario<br>customerDecision: si asociamos un cliente a la venta o la dejamos sin cliente<br>promotionDecision: si aplicamos alguna promoción o dejamos la venta sin promociones |
| get_sales_metrics | lectura o navegación | startDate: la fecha de inicio o desde cuándo querés analizar los datos<br>endDate: la fecha de finalización o hasta cuándo querés analizar los datos |
| get_sales_history | lectura o navegación | startDate: la fecha de inicio o desde cuándo querés analizar los datos<br>endDate: la fecha de finalización o hasta cuándo querés analizar los datos |
| get_location_metrics | lectura o navegación | startDate: la fecha de inicio o desde cuándo querés analizar los datos<br>endDate: la fecha de finalización o hasta cuándo querés analizar los datos |
| compare_locations | lectura o navegación | startDate: la fecha de inicio o desde cuándo querés analizar los datos<br>endDate: la fecha de finalización o hasta cuándo querés analizar los datos |
| get_product_performance | lectura o navegación | startDate: la fecha de inicio o desde cuándo querés analizar los datos<br>endDate: la fecha de finalización o hasta cuándo querés analizar los datos |
| get_product_sales_history | lectura o navegación | startDate: la fecha de inicio o desde cuándo querés analizar los datos<br>endDate: la fecha de finalización o hasta cuándo querés analizar los datos |
| get_seller_performance | lectura o navegación | startDate: la fecha de inicio o desde cuándo querés analizar los datos<br>endDate: la fecha de finalización o hasta cuándo querés analizar los datos |
| get_all_time_sales_metrics | lectura o navegación | Sin datos mínimos adicionales; valida su contrato |
| forecast_product_demand | lectura o navegación | productId: el nombre del producto y su presentación; por ejemplo, aceite Arbosana de 500 ml<br>startDate: la fecha de inicio o desde cuándo querés analizar los datos<br>endDate: la fecha de finalización o hasta cuándo querés analizar los datos<br>forecastDays: para cuántos días querés la estimación |
| research_web_metric | lectura o navegación | topic: qué tema público querés investigar |
| get_inventory_summary | lectura o navegación | inventoryType: si querés consultar un depósito o una ubicación<br>inventoryId: el nombre del depósito o ubicación que querés consultar |
| get_stock_movements | lectura o navegación | inventoryType: si querés consultar un depósito o una ubicación<br>inventoryId: el nombre del depósito o ubicación que querés consultar<br>productId: el nombre del producto y su presentación; por ejemplo, aceite Arbosana de 500 ml |
| get_transfer_history | lectura o navegación | Sin datos mínimos adicionales; valida su contrato |
| list_warehouses | lectura o navegación | Sin datos mínimos adicionales; valida su contrato |
| resolve_transfer_origin | lectura o navegación | productId: el nombre del producto y su presentación; por ejemplo, aceite Arbosana de 500 ml<br>quantity: cuántas unidades querés cargar; por ejemplo, 12 botellas<br>destinationType: si el destino es un depósito o una ubicación<br>destinationId: el nombre del depósito o ubicación que recibe la mercadería |
| list_fair_events | lectura o navegación | query: qué querés buscar o conocer |
| search_customers | lectura o navegación | query: qué querés buscar o conocer |
| get_customer | lectura o navegación | customerId: el nombre o teléfono del cliente que querés actualizar; voy a buscar su ficha |
| get_customer_history | lectura o navegación | customerId: el nombre o teléfono del cliente que querés actualizar; voy a buscar su ficha |
| get_financial_summary | lectura o navegación | startDate: la fecha de inicio o desde cuándo querés analizar los datos<br>endDate: la fecha de finalización o hasta cuándo querés analizar los datos<br>locationId: el nombre de la ubicación donde vamos a trabajar; por ejemplo, Local Centro<br>productId: el nombre del producto y su presentación; por ejemplo, aceite Arbosana de 500 ml<br>sellerId: el nombre del vendedor que querés consultar |
| get_expenses | lectura o navegación | startDate: la fecha de inicio o desde cuándo querés analizar los datos<br>endDate: la fecha de finalización o hasta cuándo querés analizar los datos<br>locationId: el nombre de la ubicación donde vamos a trabajar; por ejemplo, Local Centro<br>productId: el nombre del producto y su presentación; por ejemplo, aceite Arbosana de 500 ml<br>sellerId: el nombre del vendedor que querés consultar |
| get_shipments | lectura o navegación | entityId: qué registro querés revisar: podés decirme su nombre o referencia; no necesitás conocer un identificador interno |
| get_alerts | lectura o navegación | entityId: qué registro querés revisar: podés decirme su nombre o referencia; no necesitás conocer un identificador interno |
| get_suppliers | lectura o navegación | entityId: qué registro querés revisar: podés decirme su nombre o referencia; no necesitás conocer un identificador interno |
| get_orders | lectura o navegación | entityId: qué registro querés revisar: podés decirme su nombre o referencia; no necesitás conocer un identificador interno |
| get_marketing_campaigns | lectura o navegación | entityId: qué registro querés revisar: podés decirme su nombre o referencia; no necesitás conocer un identificador interno |
| get_social_leads | lectura o navegación | entityId: qué registro querés revisar: podés decirme su nombre o referencia; no necesitás conocer un identificador interno |
| get_audit_activity | lectura o navegación | entityId: qué registro querés revisar: podés decirme su nombre o referencia; no necesitás conocer un identificador interno |
| get_users | lectura o navegación | entityId: qué registro querés revisar: podés decirme su nombre o referencia; no necesitás conocer un identificador interno |
| get_configuration_summary | lectura o navegación | entityId: qué registro querés revisar: podés decirme su nombre o referencia; no necesitás conocer un identificador interno |
| get_invoice_status | lectura o navegación | entityId: qué registro querés revisar: podés decirme su nombre o referencia; no necesitás conocer un identificador interno |
| get_whatsapp_campaigns | lectura o navegación | entityId: qué registro querés revisar: podés decirme su nombre o referencia; no necesitás conocer un identificador interno |
| get_meta_ads_campaigns | lectura o navegación | entityId: qué registro querés revisar: podés decirme su nombre o referencia; no necesitás conocer un identificador interno |
| forecast_fair | lectura o navegación | locationId: el nombre de la ubicación donde vamos a trabajar; por ejemplo, Local Centro<br>startDate: la fecha de inicio o desde cuándo querés analizar los datos<br>days: cuántos días dura la feria |
| prepare_create_location | tarjeta de confirmación | name: cómo querés que se llame la ubicación; por ejemplo, Local Centro<br>codePrefix: un código corto para identificar sus ventas; por ejemplo, LC para Local Centro (hasta 8 letras o números)<br>type: si se trata de un local permanente, una feria o un evento |
| prepare_update_location | tarjeta de confirmación | locationId: el nombre de la ubicación donde vamos a trabajar; por ejemplo, Local Centro<br>name: cómo querés que se llame la ubicación; por ejemplo, Local Centro<br>codePrefix: un código corto para identificar sus ventas; por ejemplo, LC para Local Centro (hasta 8 letras o números)<br>type: si se trata de un local permanente, una feria o un evento |
| prepare_stock_transfer | tarjeta de confirmación | originId: el nombre del depósito o ubicación de donde sale la mercadería<br>destinationId: el nombre del depósito o ubicación que recibe la mercadería<br>lines: los productos, cuántas unidades salen y cuántas preparaste y recibiste físicamente; si algo está pendiente, decímelo<br>reason: qué querés hacer o corregir y por qué |
| prepare_customer_create | tarjeta de confirmación | phone: el teléfono del cliente, con código de área; sirve para encontrar su ficha y evitar duplicados |
| prepare_customer_update | tarjeta de confirmación | customerId: el nombre o teléfono del cliente que querés actualizar; voy a buscar su ficha<br>phone: el teléfono del cliente, con código de área; sirve para encontrar su ficha y evitar duplicados |
| prepare_expense_create | tarjeta de confirmación | name: cómo querés que se llame el gasto; por ejemplo, un nombre que te resulte fácil reconocer<br>amountCents: el monto del gasto en pesos; por ejemplo, 12500 (yo hago la conversión interna)<br>category: la categoría del gasto; por ejemplo, alquiler o transporte<br>nature: si el gasto es fijo, variable o extraordinario<br>accruedOn: la fecha a la que corresponde el gasto |
| prepare_shipment_create | manual: sin herramienta habilitada | name: el nombre con el que querés reconocer el registro |
| prepare_shipment_update | manual: sin herramienta habilitada | entityId: qué registro querés revisar: podés decirme su nombre o referencia; no necesitás conocer un identificador interno<br>name: el nombre con el que querés reconocer el registro |
| prepare_alert_create | tarjeta de confirmación | name: cómo querés que se llame la alerta; por ejemplo, un nombre que te resulte fácil reconocer |
| prepare_supplier_create | tarjeta de confirmación | name: cómo querés que se llame el proveedor; por ejemplo, un nombre que te resulte fácil reconocer |
| prepare_social_lead_create | tarjeta de confirmación | name: cómo querés que se llame la consulta; por ejemplo, un nombre que te resulte fácil reconocer |
| prepare_marketing_campaign | tarjeta de confirmación | name: cómo querés que se llame la campaña; por ejemplo, un nombre que te resulte fácil reconocer |
| prepare_warehouse_create | tarjeta de confirmación | name: cómo querés que se llame el depósito; por ejemplo, un nombre que te resulte fácil reconocer |
| prepare_product_create | revisión en formulario | name: cómo querés que se llame el producto; por ejemplo, Aceite Arbosana de 500 ml<br>abbreviation: una abreviación para reconocer el producto; por ejemplo, AO500 para un aceite de 500 ml (hasta 8 caracteres)<br>defaultPrice: el precio de venta en pesos; por ejemplo, 8500 |
| prepare_catalog_stock_load | tarjeta de confirmación | locationId: el nombre de la ubicación donde vamos a trabajar; por ejemplo, Local Centro<br>items: los productos y sus cantidades; por ejemplo, 12 botellas de aceite de 500 ml |
| prepare_invoice_review | revisión en formulario | entityId: qué registro querés revisar: podés decirme su nombre o referencia; no necesitás conocer un identificador interno<br>reason: qué querés hacer o corregir y por qué |
| prepare_sale_cancellation_review | revisión en formulario | entityId: qué registro querés revisar: podés decirme su nombre o referencia; no necesitás conocer un identificador interno<br>reason: qué querés hacer o corregir y por qué |
| prepare_user_role_review | revisión en formulario | entityId: qué registro querés revisar: podés decirme su nombre o referencia; no necesitás conocer un identificador interno<br>reason: qué querés hacer o corregir y por qué |
| prepare_configuration_review | revisión en formulario | reason: qué querés hacer o corregir y por qué |
| prepare_ecommerce_order_review | revisión en formulario | entityId: qué registro querés revisar: podés decirme su nombre o referencia; no necesitás conocer un identificador interno<br>reason: qué querés hacer o corregir y por qué |
| search_tools | lectura o navegación | query: qué querés buscar o conocer |
| get_app_capabilities | lectura o navegación | query: qué querés buscar o conocer |
| discover_skills | lectura o navegación | Sin datos mínimos adicionales; valida su contrato |
| load_skill | lectura o navegación | name: el nombre con el que querés reconocer el registro |
| search_knowledge | lectura o navegación | query: qué querés buscar o conocer |
| prepare_batch_sales | tarjeta de confirmación | sales: cada venta por separado, con productos, cantidades, origen, canal y pago; después te preguntaré por cliente, promociones y comprobante si faltan |

## Validación

Ver VALIDACION.md para los resultados del commit publicado y el entorno verificado. Las pruebas automáticas usan datos sintéticos y adaptadores en memoria; no miden comprensión general de todos los mensajes posibles ni calidad de audio físico.
