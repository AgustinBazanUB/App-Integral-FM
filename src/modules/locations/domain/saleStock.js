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

export function stockConfirmationMatches(confirmed, discrepancies) {
  if (!Array.isArray(confirmed) || confirmed.length !== discrepancies.length) return false;
  return discrepancies.every(expected => confirmed.some(item =>
    item?.productId === expected.productId && item.quantity === expected.quantity &&
    item.previousStock === expected.previousStock && item.newStock === expected.newStock));
}

export function globalStockByProduct(inventories) {
  const totals = new Map();
  for (const items of inventories) {
    for (const item of items) {
      if (item.deleted === true || item.productDeleted === true) continue;
      const id = item.id;
      const quantity = Number(item.currentStock ?? 0);
      if (!Number.isSafeInteger(quantity)) throw new Error("Hay un saldo de inventario inválido.");
      totals.set(id, (totals.get(id) || 0) + quantity);
    }
  }
  return totals;
}
