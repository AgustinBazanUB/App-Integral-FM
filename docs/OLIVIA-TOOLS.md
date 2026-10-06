# Catálogo de herramientas

El anexo añade `update_task` para slots parciales validados, sin ejecutar acciones, y `resolve_transfer_origin` para consultar inventarios suficientes y detectar ambigüedad. Cantidades preparadas/recibidas desconocidas en transferencias aceptan null y producen preguntas solo de esos campos. [Política vigente](OLIVIA-MODEL-ROUTER.md).

El catálogo combina los contratos existentes en `oliviaContracts.mjs` con `oliviaCapabilities.mjs`. Cada capacidad tiene descripción, módulo, esquema cerrado, clase y acción requerida. Se seleccionan herramientas por intención, pantalla y Skills, y `search_tools` descubre otras permitidas. No hay consultas Firestore arbitrarias.

| Área | Lecturas y preparaciones |
|---|---|
| Contexto/ayuda | Usuario, navegación, discover_skills, load_skill, search_knowledge, search_tools |
| Productos | Búsqueda/precios y preparación del formulario de catálogo validado |
| Ubicaciones | Ubicaciones permitidas, ferias/eventos, alta y actualización |
| Ventas/dashboard/métricas | Ventas de hoy, preparación de venta, períodos, comparaciones, productos, vendedores, pagos y promociones |
| Stock/depósitos | Stock, movimientos, cargas, inventario, depósitos y transferencia física |
| CRM | Búsqueda, ficha/historial, alta y actualización con identidad telefónica canónica |
| Finanzas | Resumen, gastos, preparación de gasto |
| Ecommerce | Pedidos y revisión del pedido seleccionado |
| Envíos | Consulta, alta y actualización del registro |
| Alertas/proveedores | Consulta y alta |
| Social/marketing | Consultas y altas; borradores de campaña; estado de WhatsApp y proyectos Meta Ads |
| Fiscal | Estado fiscal y preparación de revisión de la factura real en Configuración |
| Auditoría/administración | Actividad, usuarios y revisión del usuario seleccionado |
| Configuración | Resumen permitido y revisión de formularios seguros |

Las consultas señalan límites y lecturas parciales. Métricas usan hasta 1.500 ventas por período; finanzas recupera devengamientos, pagos, vencimientos, presupuesto y liquidaciones de hasta 30 ventas, dejando explícito ese límite. Totales por producto corresponden a renglones antes de descuentos globales/envío; filtrar operaciones que contienen un producto no atribuye todo el ticket a ese producto.

Las preparaciones no escriben comercialmente. Confirmar valida perfil vigente y huella, y escribe atómicamente operación/movimientos/auditoría/confirmación. Stock previsto, preparado y recibido son cantidades distintas; un pronóstico no acredita recepción.

Operaciones fiscales, roles/credenciales y catálogo preparado se completan con el flujo manual existente. La anulación abre el detalle de la venta en su ubicación; la factura se selecciona por su fuente; ecommerce y administración seleccionan el registro. La tarjeta de Olivia no emite una factura ni anula una venta por texto.

Vendedores conservan herramientas del Panel Vendedor, ubicaciones autorizadas, precios/stock, promociones, ventas propias y preparación de venta; el registro no ofrece esquemas administrativos a ese rol.

Historial CRM comparte los grupos de identidad/teléfono del flujo manual: IDs actuales, anteriores y cadena de migración acotada, más snapshots telefónicos históricos. Se deduplican ventas y se informa truncamiento a 100 registros; no se pierde una compra solo porque precedió a la normalización del cliente.
