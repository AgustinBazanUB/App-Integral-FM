# Inventario de capacidades de Olivia

Las capacidades se toman de `src/shared/oliviaCapabilities.mjs`. Las lecturas pasan por permisos de módulo y rol. Las acciones `prepare_*` crean una propuesta; no ejecutan por voz. El backend vuelve a validar permisos y condiciones al confirmar.

| Módulo | Lecturas | Acciones preparables / límites |
|---|---|---|
| Métricas | `get_sales_metrics`, `get_sales_history`, `get_location_metrics`, `compare_locations`, `get_product_performance`, `get_product_sales_history`, `get_seller_performance`, `get_all_time_sales_metrics`, `forecast_product_demand`, `forecast_fair`, `research_web_metric` | Sin escritura comercial. Investigación web solo con conceptos públicos y sin datos privados. |
| Depósitos e inventario | `get_inventory_summary`, `get_stock_movements`, `get_transfer_history`, `list_warehouses`, `resolve_transfer_origin` | `prepare_stock_transfer`, `prepare_warehouse_create`, `prepare_warehouse_stock_load`. Depósito requiere perfil no vendedor, acceso al Panel de Administración y permiso `warehouse` de la acción solicitada. |
| Ubicaciones | `list_fair_events` | `prepare_create_location`, `prepare_update_location`, `prepare_catalog_stock_load`. El stock de local conserva su servicio y contrato propios. |
| Clientes | `search_customers`, `get_customer`, `get_customer_history` | `prepare_customer_create`, `prepare_customer_update`; el alta respeta teléfono único y la edición exige cambio explícito. |
| Finanzas | `get_financial_summary`, `get_expenses` | `prepare_expense_create`; no emite comprobantes ni crea ingresos duplicados de ventas. |
| Envíos | `get_shipments` | `prepare_shipment_create` y `prepare_shipment_update` están bloqueadas para Olivia por la política actual. |
| Alertas | `get_alerts` | `prepare_alert_create`; no cambia alertas automáticas. |
| Proveedores | `get_suppliers` | `prepare_supplier_create`. |
| E-commerce | `get_orders` | `prepare_ecommerce_order_review` guía a revisar el pedido; no simula cobros. |
| Marketing | `get_marketing_campaigns`, `get_whatsapp_campaigns`, `get_meta_ads_campaigns` | `prepare_marketing_campaign` crea un borrador; no lo publica ni envía mensajes. |
| Redes sociales | `get_social_leads` | `prepare_social_lead_create`. |
| Auditoría | `get_audit_activity` | Solo lectura. |
| Administración | `get_users` | `prepare_user_role_review` requiere revisar permisos en la aplicación; Olivia no concede accesos por sí misma. |
| Configuración | `get_configuration_summary` | `prepare_configuration_review` dirige a revisión manual. |
| Ventas rápidas | `get_invoice_status` | `prepare_invoice_review`, `prepare_sale_cancellation_review`, `prepare_batch_sales`. La venta en lote necesita canal, origen, productos, cantidades y pagos válidos; no factura fiscal. |
| Productos | — | `prepare_product_create`; requiere tarjeta y datos validados. |
| Base conversacional | `search_tools`, `get_app_capabilities`, `get_ui_guide`, `show_ui_guide`, `discover_skills`, `load_skill`, `search_knowledge` | Lecturas y guías. `show_ui_guide` no pulsa controles ni completa formularios. |

## Restricciones globales

- Vendedores no acceden a capacidades de administración general. El control final ocurre otra vez en el backend.
- Las modificaciones pasan por `pendingAction`, revalidación de fingerprint y confirmación visual.
- Confirmar por voz no equivale a pulsar el botón.
- No están habilitados cobros, facturación ARCA, envíos masivos ni ejecución automática de campañas.
- La cobertura de cada módulo se basa en el código; la prueba manual de negocio realizada para este cambio se registra aparte y no implica que todos los módulos hayan sido ejercitados.
