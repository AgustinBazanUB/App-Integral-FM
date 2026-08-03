export function calculateStockAfterSale(previousStock, quantity, productName = "el producto") {
  const current = Number(previousStock);
  const qty = Number(quantity);
  if (!Number.isInteger(current) || current < 0) {
    throw new Error(`El stock actual de ${productName} no es válido.`);
  }
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error(`La cantidad de ${productName} debe ser un entero mayor a cero.`);
  }
  const next = current - qty;
  if (next < 0) {
    throw new Error(
      `No hay stock suficiente de ${productName}. Disponible: ${current}.`,
    );
  }
  return next;
}
