# Estado de módulos — corte v0.2

| ID | Módulo | Ruta / superficie | Estado de código | Estado de diseño |
|---|---|---|---|---|
| — | Panel General | `/gestion` | Custom | Actual |
| FM-MOD-01 | Ubicaciones | `/gestion/locations` | Custom | Propuesto v0.2 |
| FM-MOD-02 | Productos | `/gestion/products` | Custom | Actual |
| FM-MOD-03 | Ventas rápidas | `/gestion/quick-sales` | Custom | Propuesto v0.2 |
| FM-MOD-04 | Clientes | `/gestion/loyal-customers` | Custom | Propuesto v0.2 |
| FM-MOD-05 | Métricas | `/gestion/metrics/sales` | Custom | Actual |
| FM-MOD-06 | Finanzas | `/gestion/finance` | GenericModulePage | Pendiente |
| FM-MOD-07 | Depósitos | `/gestion/warehouse` | Custom | Propuesto v0.2 |
| FM-MOD-08 | Ecommerce | `/gestion/ecommerce` + storefront | Híbrido | Pendiente detalle |
| FM-MOD-09 | Redes Sociales | `/gestion/social` | Base genérica | Propuesto: WhatsApp Inbox |
| FM-MOD-10 | Marketing | `/gestion/marketing` | Hub genérico + submódulos | En evolución |
| FM-MOD-10-WA | Campañas WhatsApp | `/gestion/marketing/whatsapp` | Custom | Actual + evolución |
| FM-MOD-10-META | Meta Ads | `/gestion/marketing/meta-ads` | Custom | Actual + roadmap |
| FM-MOD-11 | Envíos | `/gestion/shipping` | GenericModulePage | Pendiente detalle |
| FM-MOD-12 | Alertas | `/gestion/alerts` | GenericModulePage | Pendiente detalle |
| FM-MOD-13 | Proveedores | `/gestion/suppliers` | GenericModulePage | Pendiente detalle |

## Observaciones

1. La existencia de una entrada en `modules.js` no significa que el módulo esté diseñado en profundidad.
2. Los módulos que caen en `GenericModulePage` deben mantenerse visibles en el Master Map, pero marcados como `GENÉRICO`.
3. Las propuestas v0.2 de esta rama son decisiones de producto y no deben interpretarse como código implementado.
4. La documentación histórica puede quedar desactualizada frente al router y `modules.js`; el Master Map debe verificarse contra código antes de cada actualización importante.