# Descuentos en efectivo de Venta Rápida

En el panel administrador, el total de una venta en efectivo con descuento se redondea hacia abajo al múltiplo de $1.000 anterior. Se aplica una sola vez después de los descuentos fijos y porcentuales: $15.300 → $15.000; $2.500 → $2.000; $100.001 → $100.000. Un total exacto de miles no cambia. Sin descuento, en tarjeta, transferencia o pagos combinados no se aplica.

El resumen, la escritura transaccional y las propuestas individuales o por lista de Olivia usan `calculateDiscountSummary`. El importe adicional se guarda como `cashRoundingDiscountTotal` y se incluye en `discountTotal`; los porcentajes y montos originales permanecen separados. La pantalla identifica el ajuste como “Incluye redondeo por efectivo” y el historial lo muestra como “Redondeo por efectivo”. Métricas, ingresos y cálculo fiscal utilizan el total efectivamente cobrado.

Las ventas administrativas nuevas conservan `cashRoundingEnabled` para recalcular correctamente al editar. Cambiar a transferencia elimina el ajuste, y volver a efectivo lo calcula sobre el subtotal y los descuentos originales; no se acumula en cada edición. Las ventas históricas no se reescriben. El Panel Vendedor y su cola offline conservan el cálculo anterior; la edición de una venta administrativa mantiene su regla.

Las pruebas cubren todos los restos de $0 a $999 por ejemplos de borde, descuentos manuales y configurados, porcentajes y montos, repetición sin duplicación, cambios de medio de pago, locales/depósitos, métricas/finanzas, importes fiscales y confirmaciones de Olivia. Las operaciones se prueban con adaptadores en memoria, sin ventas reales.
