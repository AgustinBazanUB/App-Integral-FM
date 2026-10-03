# Ventas manuales con stock registrado insuficiente

Implementado el 03/10/2026 sobre `57a1aafc297f807aed636b857c5d4d30ba1ed93c`.

## Auditoría inicial

El Panel Vendedor (`/vendedor`, `SellerPanel.jsx`) y Venta Rápida administrativa (`/gestion/quick-sales`, `QuickSalesPage.jsx`) ya compartían `sellerService.createSale`. Ambas pantallas limitaban la cantidad al stock disponible y el servicio rechazaba un faltante. El vendedor además truncaba a cero el saldo disponible. Las reglas de Firestore impedían los movimientos con saldos negativos. La edición de ventas y los validadores del inventario también rechazaban esos saldos.

Los datos migrados ya contenían cinco balances negativos del sistema anterior. No se corrigen ni se reemplazan automáticamente: representan una diferencia que debe conciliarse con la mercadería física.

## Regla acordada y flujo final

Para una **ubicación**, el vendedor y el Administrador pueden registrar mercadería física aunque el stock cargado sea insuficiente. Se mantiene el producto configurado y habilitado, la ubicación autorizada y los permisos existentes. No se habilitan productos ausentes o desactivados.

1. Agregar el producto y la cantidad. El carrito advierte “Stock registrado insuficiente”, muestra la cantidad disponible y el saldo previsto, y permite continuar.
2. Completar pagos, cliente y descuentos mediante los flujos existentes. Sus validaciones no cambian.
3. Confirmar. La transacción central vuelve a leer el stock real y descuenta la cantidad completa: `0 → -1 → -2`, sin truncar ni fabricar existencias.
4. Guardar la venta, el movimiento de stock y Actividad/Auditoría juntos. Cuando el saldo resulta negativo, `stockDiscrepancies` registra producto, cantidad, saldo anterior, saldo posterior y diferencia en la venta y en la actividad.
5. Avisar después de guardar. La venta sigue siendo una venta válida para Métricas, CRM y Finanzas. El stock negativo se muestra explícitamente en el Panel Vendedor.
6. Conciliar mediante carga de stock o ajuste físico autorizado. Una carga parcial puede dejar un saldo todavía negativo; el ajuste físico exige una cantidad contada no negativa. Ejemplo: `-3 + 1 = -2`, luego conteo físico `4 → saldo 4`.

La edición descuenta o devuelve sólo la diferencia de cantidades; la anulación devuelve sólo las unidades de esa venta, aunque el saldo siga negativo por otras ventas. Se mantienen los bloqueos existentes para ventas con comprobante fiscal asociado.

**Alcance:** las ventas administrativas desde depósito, las transferencias y Ecommerce conservan sus controles de existencia. La solicitud se refiere a mercadería física en ubicaciones; extenderla a depósitos requeriría otra decisión funcional.

## Integridad y Firestore

No hay colecciones nuevas, denormalizaciones de totales, queries históricas adicionales ni segunda lógica de ventas. El helper `saleStockDiscrepancies` se comparte entre las pantallas y el servicio. El aviso es contextual; no crea una segunda base de Alertas.

Los saldos negativos nuevos requieren una venta y un movimiento atómicos. Las reglas enlazan `lastSaleId`, `lastMovementId`, producto, usuario, ubicación, saldo anterior/posterior y fecha de servidor. Los índices `saleItemIndex` y `previousSaleItemIndex` vinculan la cantidad del movimiento con los ítems originales/finales de la venta. Un movimiento huérfano, un saldo negativo aislado o una cantidad distinta se rechazan. Los movimientos son inmutables; la fecha debe coincidir con la operación actual, evitando reutilizar un movimiento anterior.

La recuperación parcial requiere permiso de carga de stock y un movimiento positivo que coincida con el balance. El vendedor no obtiene permisos de ajuste. Un carrito de ocho productos sin stock se probó contra el emulador con las reglas reales; carritos más grandes siguen sujetos a los límites de acceso documental y tamaño de las transacciones de Firestore.

Venta Rápida conserva su identificador y fingerprint persistidos para recuperar reintentos tras recarga o confirmación incierta. Se agregó una operación en curso compartida por usuario/identificador para evitar dos transacciones simultáneas del mismo intento en el navegador. Un intento con contenido diferente no puede reutilizar ese identificador. El vendedor mantiene su protección de doble clic y la idempotencia del flujo pendiente/offline existente.

## Archivos afectados

- `src/gestion/services/sellerService.js`: creación, edición, reversión, auditoría y reintentos administrativos.
- `src/modules/locations/domain/saleStock.js` y `src/gestion/components/SaleStockWarning.jsx`: cálculo compartido y aviso reutilizable.
- `src/gestion/seller/SellerPanel.jsx`, `sellerDomain.js` y `src/styles/seller-panel.css`: controles de cantidad, estado negativo y aviso. Se corrigieron también props existentes de los diálogos de descuentos/confirmación para ajustarlas a sus interfaces reales, detectadas durante typecheck.
- `src/gestion/pages/QuickSalesPage.jsx`: faltante no bloqueante en ubicación; depósito conserva límites.
- `src/gestion/services/inventoryService.js` y `src/modules/inventory/domain/inventory.js`: lectura de balances negativos al cargar o corregir inventario de ubicación.
- `firestore.rules`: validación atómica de negativos y recuperación parcial.
- `tests/quick-sale-services.test.mjs`, `tests/operations-services.test.mjs` y `tests/firestore.quick-sales.rules.mjs`: regresión y casos nuevos.

## Validación

- Lint y typecheck focalizados: cero errores.
- Tests de aplicación: **508 aprobados**.
- Reglas reales en emulador aislado: **127 aprobadas**, incluyendo venta en cero/negativo, vendedor, Administrador, reintento, ocho productos, edición, anulación, recuperación de stock y rechazo de operaciones inconsistentes.
- Build de producción Netlify completo, con las **11 funciones existentes**, incluidas las cuatro entradas de ARCA.
- Navegación y confirmación básicas con componentes reales y datos sintéticos locales en ambos paneles. En móvil, el aviso permanece legible y Continuar habilitado; tras confirmar, el catálogo muestra `-1`. No se registraron ventas de prueba en producción.

## Puntos protegidos y riesgos

No se modificaron autenticación, endpoints, CAE, PDF, impresión, reintentos fiscales ni archivos del subsistema ARCA. El importe económico procede de la venta una sola vez; el comprobante posterior no agrega un ingreso. Los tests no emiten comprobantes reales.

La advertencia depende de que el operador verifique la mercadería física. El sistema conserva la diferencia, pero no puede determinar automáticamente el conteo físico correcto. La proyección del carrito puede variar si otros usuarios venden simultáneamente; el saldo definitivo se calcula dentro de la transacción. No se inventó un flujo automático de conciliación ni una nueva alerta persistida.

Las reglas deben publicarse junto con la aplicación: actualizar sólo Netlify dejaría las confirmaciones negativas bloqueadas en Firestore. Los componentes anteriores siguen siendo compatibles para ventas con stock suficiente.
