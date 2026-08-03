# Modelo de datos Firestore

## Colecciones principales

- `users`: perfil, rol, permisos y ubicaciones. Datos de autenticación permanecen en Firebase Auth.
- `roles`: plantillas configurables; lectura y escritura administrativa.
- `locations`: punto operativo y configuración de DNI/actividad.
- `products` y `productCategories`: catálogo maestro compartido.
- `locationStock/{locationId}/items/{productId}`: stock por ubicación; evita documentos gigantes.
- `stockMovements`: ledger inmutable con stock anterior/posterior.
- `stockTransfers`: cabecera y estado; sus ítems se embeben porque se consultan con la transferencia.
- `sales`: venta con ítems, descuentos y pagos embebidos para integridad histórica.
- `customers/{id}/interactions`: cliente protegido y seguimiento como subcolección de crecimiento independiente.
- `orders`: pedido web con ítems embebidos; referencia al cliente y al envío.
- `shipments`: seguimiento operativo independiente por consultas de estado/fecha.
- `invoices`: metadatos del comprobante; nunca credenciales fiscales.
- `suppliers`: datos del proveedor; productos negociados pueden resumirse o referenciar catálogo.
- `purchases`: compra con ítems embebidos y referencias a proveedor/recepción.
- `financialEntries`: ledger económico, separado por seguridad.
- `cashSessions`: apertura/cierre por ubicación.
- `campaigns`, `contentItems`, `socialLeads`: operación comercial y marketing.
- `alerts`: tipo, severidad, responsable, módulo y entidad relacionada.
- `auditLogs`: eventos sensibles inmutables.
- `dailySummaries`: agregados por fecha/ubicación/canal para métricas de bajo costo.
- `settings`: configuración pública interna no sensible.

## Decisiones

Los ítems de ventas, pedidos y compras se embeben: deben leerse juntos, preservan el estado histórico y evitan N lecturas. Stock, interacciones y movimientos son subcolecciones o colecciones independientes porque crecen sin límite y requieren consultas propias. Se usan referencias por ID acompañadas de nombres históricos cuando una edición futura no debe alterar comprobantes previos.

Las bajas son lógicas (`active`, `deleted`, `deletedAt`, `deletedBy`). Ventas, movimientos y auditoría nunca se borran físicamente. Los timestamps operativos se generan con `serverTimestamp()`.

## Datos sensibles

DNI, teléfono, dirección, preferencias y consentimiento sólo pueden leerse desde módulos/acciones autorizadas. Finanzas y facturación tienen reglas separadas. Las credenciales de pagos, ARCA y cuentas de servicio no pertenecen a Firestore cliente.
