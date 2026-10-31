# Auditoría e integración del canal web — 30/10/2026

## Base y alcance comprobado antes de implementar

Base actualizada: `origin/main` `62bd617`. Rama: `codex/ecommerce-integral-main-20261030`.
El checkout local inicial estaba en `feature/arca-pos-ux` (`4bdfbe9`): 174 commits de main ausentes y 16 commits propios. Se conserva esa rama. No se integran automáticamente PR fiscales ni cambios de producción.

GitHub CLI encontró 16 PR abiertos (el conector devolvió incorrectamente cero). Relevantes: #33 POS/ARCA, #32 ARCA operativa y #26 integración ARCA. #40 Envíos y #52 correcciones ya están en main. El grafo existente está desactualizado: sólo identifica CheckoutPage y stock; se contrastó con código real.

## Diagnóstico por módulo

| Módulo | Estado encontrado y archivos | Trabajo necesario |
|---|---|---|
| Catálogo | `commerceService.mjs`, CommerceCatalogContext: combina proyección comercial con contenido editorial. Lee un origen `ECOMMERCE_LOCATION_ID`; sin reservas. | Canal separado de ubicación; disponibilidad de un origen efectivo. |
| Checkout | `commerceDomain.mjs`, CheckoutPage: backend recalcula, limita 99 por línea; sólo retiro; dirección no se envía; fiscal sólo visible en simulación. | Dirección estructurada, cobertura/tarifas administradas, facturación pública y validación CRM. |
| Pedidos/pagos | Claves deterministas y transacción REST. Checkout público sólo pending. Aprobación administrativa local separada. | Reservas, vencimiento, cancelación, origen configurable, recuperación y auditoría. |
| Ventas/stock | `paymentService.mjs`: venta y salida atómicas, snapshot validado; no fulfillment. `operationalWritePlans.mjs`: planes compartidos con vendedor/rápida/envíos. | Asociar canal/origen/fulfillment; proteger reservas también de otros canales. |
| Métricas | `saleFacts.js` considera simulaciones ventas activas. Filtros ya admiten `sourceChannel`. | Excluir simulaciones de hechos comerciales y financieros; panel propio del canal. |
| CRM | `customerLink.mjs` reutiliza hash de teléfono de customerDomain. Sólo vincula al aprobar; simulación actual actualiza lastPurchaseAt. | Registrar pedido separado de compra real y consentimiento separado. |
| Envíos | `shipping.mjs`, ShippingPage, ShipmentDetail: módulo completo en main; repository/uber/manual, asignación, permisos, QR revocable, incidencias, rutas. `createShippingSale` crea una venta nueva y no sirve para recibir una venta web ya registrada. | Adaptador que cree sólo fulfillment dentro de la transacción del pago; no volver a crear venta ni descontar stock. Retiro sin acceso repartidor. |
| Fiscal | Motor único WSAA/WSFE, lock de numeración, conciliación de resultados inciertos, persistencia, PDF/QR. `fiscalService.mjs` web sólo prepara plan, no solicita CAE. | Conservar gates; ligar datos fiscales al pedido. Probar homologación sólo con credenciales verificadas. No inventar autorizaciones. |
| Despliegue | `deploy/ecommerce/netlify.toml` apunta a Functions vacías, frontend pide endpoints relativos. | Proxy limitado a endpoints públicos del backend autorizado; sin copiar secretos al sitio público. |
| Seguridad | Firestore niega escrituras cliente a orders/payments/invoices/shipments. No existe channels. Protección idempotente comercial existente. | Reglas para configuración, reservas, datos públicos mínimos y rate limit de checkout. |

## Riesgos y compatibilidad

- La simulación local por sí sola no prueba aislamiento: exigir proyecto `app-integral-fm-pruebas` antes de confirmar simulaciones contra servicios reales.
- No usar direcciones o precios ficticios como configuración comercial. Local Lavalle debe resolverse leyendo el ID real; no se inventa ni se copia su inventario a pruebas.
- Una reserva no es una salida física. Las ventas presenciales y ajustes deben respetar unidades reservadas.
- Mantener `sourceChannel=ecommerce` para filtros históricos; añadir `channelId` y `stockOrigin*`. No generar inventario del canal.
- Envíos existentes: conservar `shippingSchemaVersion=1`, nombres internos y transiciones. Recibir ventas web con stock ya committed para impedir aprobación/descuento repetidos.
- Las cancelaciones logísticas existentes no reintegran inventario ni dinero automáticamente. Conservar esta política explícita; pedidos pendientes sí liberan reserva.
- CAE de homologación y producción son distintos; una simulación nunca debe autorizar producción. La autorización de hasta diez facturas requiere operaciones reales verificables; no se encontraron esas operaciones durante la auditoría inicial.

## Secuencia de implementación

1. Configuración channels con orígenes reales, tarifas y retiro.
2. Checkout estructurado y snapshot fiscal; reservas transaccionales con vencimiento.
3. Pago simulado aislado, única venta/salida y adaptador a shipments existente.
4. Administración de pedidos, origen, preparación, transporte y retiro; métricas.
5. Proxy público, reglas, pruebas automatizadas de concurrencia/recuperación y builds.
6. Chrome real al finalizar; registrar exactamente lo ejecutado. Homologación sólo si credenciales disponibles. Informe final con pendientes y evidencia.

## Restricciones

Local Lavalle real identificado en lectura de la aplicación autenticada (30/10): `locations/JkPsCWvIsOxRhtlwuRRj`. Una única tarjeta con ese nombre entre 26 ubicaciones. No se configuró el canal ni se modificó ese documento en producción; el ID se conserva sólo como referencia de configuración posterior. La app publicada muestra comprobantes productivos autorizados: no deben confundirse con emisiones de esta auditoría.

La consulta oficial de ARCA confirma el umbral general de identificación de Consumidor Final de ARS 10.000.000: https://www.arca.gob.ar/fe/emision-autorizacion/datos-comprobantes.asp. Los datos fiscales explícitos se validan y la clase se resuelve con el motor compartido.

Sin Payway, merge a main ni despliegue productivo. Sin mensajes a personas reales. Los tests deben conservar sus registros sintéticos en staging. Nunca guardar secretos ni datos personales en evidencia. El resultado se entrega para revisión en PR/preview, según AGENTS.md.
