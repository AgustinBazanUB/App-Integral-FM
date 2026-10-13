// Current physical balances, never reconstructed from a sales date range.
export function summarizeRemainingStock(origins = [], filters = {}) {
  const products = new Map();
  const productIds = new Set([...(filters.productIds || []), ...(filters.categoryProductIds || [])]);
  const categoryIds = new Set(filters.categoryIds || []);
  for (const origin of origins) {
    for (const item of origin.items || []) {
      if (item.deleted === true) continue;
      const id = item.productId || item.id;
      if (!id) continue;
      if ((productIds.size || categoryIds.size) && !productIds.has(id) && !categoryIds.has(item.categoryId)) continue;
      const quantity = Number(item.currentStock ?? 0);
      if (!Number.isFinite(quantity)) throw new Error("Un saldo de inventario no es válido.");
      if (!products.has(id)) products.set(id, { key: id, name: item.productName || item.name || "Producto", abbreviation: item.abbreviation || "", quantity: 0, origins: [] });
      const row = products.get(id);
      row.quantity += quantity;
      row.origins.push({ type: origin.type, id: origin.id, name: origin.name, quantity });
    }
  }
  return [...products.values()].sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name, "es"));
}
