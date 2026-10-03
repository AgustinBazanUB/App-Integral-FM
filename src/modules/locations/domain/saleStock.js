// Una venta presencial puede registrar mercadería física no cargada en inventario.
// El saldo real se descuenta sin truncarlo; el faltante queda visible para conciliar.
export function saleStockDiscrepancies(items = [], stockForItem = item => item.stock ?? item.currentStock ?? 0) {
  return items.map(item => {
    const previousStock = Number(stockForItem(item));
    const quantity = Number(item.qty || 0);
    return {
      productId: item.productId || item.id,
      name: item.name || item.productName || "Producto",
      previousStock,
      quantity,
      newStock: previousStock - quantity,
      missingQuantity: Math.max(0, quantity - previousStock),
    };
  }).filter(item => item.quantity > 0 && item.newStock < 0);
}
