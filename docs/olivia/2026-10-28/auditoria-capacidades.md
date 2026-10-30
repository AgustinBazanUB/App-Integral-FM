# Auditoría de capacidades de Olivia · 28/10/2026

Inventario previo de acciones de interfaz, revisión de rutas/servicios montados actuales, reemplazo del módulo de envíos y contraste con esquemas/guards/handlers de Olivia. Los conteos de filas no son un porcentaje de equivalencia funcional. Pruebas locales con datos sintéticos; no acredita aceptación de todas las operaciones reales ni configuración de proveedores externos.

Catálogo de 546 acciones en 31 secciones; 69 herramientas registradas, 2 contratos retirados de descubrimiento. La base del catálogo es del 10/10 y conserva ese origen: no se presenta como una nueva prueba manual de cada acción.

## Qué puede hacer y dónde necesita la interfaz

| Módulo | Asistencia actual | Flujo manual o límite |
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

## Hallazgos corregidos

- Carga de stock interceptaba cambios de intención y frases de ayuda; ahora hay pausa/cancelación/retoma y prioridad de la instrucción nueva.
- Los slots validados se guardan antes de la siguiente llamada al modelo. Las confirmaciones anteriores vencen al interrumpir y una retoma prepara una tarjeta nueva.
- Voz ya no espera a que termine el razonamiento previo para transcribir el siguiente turno; reemplaza la respuesta activa conservando datos. Hablar sin completar/transcribir un turno solo interrumpe audio.
- El conocimiento anterior describía Envíos como tabla genérica y voz como GPT-Live/deshabilitada. El mapa actual tiene prioridad y deja de ofrecer altas/ediciones genéricas de envíos que el backend rechaza.
- forecast_product_demand calcula base diaria y sensibilidad explícita por presentación, sin inventar demanda cuando no hay unidades registradas.

## Diferencias que siguen existiendo

Olivia todavía no ejecuta toda acción de interfaz. Entre las brechas están ajustes físicos y carga directa en depósitos, importación masiva de clientes/zonas, configuración de catálogo/asignaciones, ciclo logístico completo, acreditaciones financieras y operación de campañas/archivos. El mapa explica el flujo manual y ofrece enviar una sugerencia solo si el usuario lo pide. Agregar conocimiento no convierte estas funciones en herramientas de ejecución. Las revisiones fiscal, de roles y de configuración siguen en sus formularios seguros.

## Latencia

Se conservan Luna HIGH/XHIGH y Chirp. Se eliminan llamadas de modelo para inicios acotados y controles; un update_task válido con datos faltantes formula la repregunta sin otra ronda. Respuestas cortas de tarea omiten retrieval semántico. Las instrucciones especializadas se cargan por proceso. El evento de voz sale después de persistir la respuesta, antes de reconstruir estado/consumo. Un acuse Chirp se sintetiza una vez por sesión de voz y se reutiliza en memoria; cuenta caracteres al prepararse, no tokens de Luna, y no bloquea la respuesta real. Se cancela al hablar, llegar la respuesta, detener o cerrar. La espera acústica de 1,9–4 s se conserva para no cortar pausas naturales.

No se afirma una reducción de milisegundos real del proveedor: las pruebas controladas verifican rondas evitadas, identidad/cancelación, persistencia y render. El tiempo real depende también de transcripción, red, herramientas y TTS. Referencia: [OpenAI Docs · Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization).

## Cómo revisar la preview

1. Pedir cargar stock y después cambiar a un cliente, antes y durante una respuesta lenta.
2. Pedir una explicación en mitad de la carga y luego decir Retomemos el stock; conserva producto/cantidad sin ejecutar nada.
3. Conversar por voz y comprobar acuse, interrupción y respuesta final; usar auriculares para evaluar eco del dispositivo.
4. Subir con scroll por el historial y comprobar que conserva el mensaje visible.
5. Pedir una estimación de una presentación para un horizonte, usando el mes pasado; revisar período, fórmula, escenarios y límites.

Los permisos se vuelven a validar al operar. Las pruebas con escrituras solo pueden ejecutarse tras verificar app-integral-fm-pruebas en cliente, Functions, Authentication y Firestore.
