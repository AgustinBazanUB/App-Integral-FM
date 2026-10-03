import { decodeFields, documentId, documentPath, encodeFields, fingerprint, DESTINATION_PROJECT } from "./domain.mjs";

// Administrative archival requested by the owner. It does not cancel fiscal documents.
export function buildCleanupPlan(destination, authorizedIds, { operationId, now = new Date().toISOString() }) {
  if (!/^[a-zA-Z0-9_-]+$/.test(operationId)) throw new Error("ID de operación inválido");
  if (destination.project !== DESTINATION_PROJECT || authorizedIds.length !== 13 || new Set(authorizedIds).size !== 13) throw new Error("La limpieza debe identificar exactamente las 13 ventas autorizadas");
  const docs = new Map(Object.values(destination.collections).flat().filter(doc => doc.fields).map(doc => [documentPath(doc), doc]));
  const movements = destination.collections.stockMovements.map(doc => ({ id: documentId(doc), ...decodeFields(doc.fields) }));
  const operations = [], returns = new Map();
  const stats = { archived: 0, alreadyArchived: 0, returnedUnits: 0, fiscalLinksPreserved: 0, resetByEarlierSnapshot: 0 };
  for (const id of authorizedIds) {
    const original = docs.get(`sales/${id}`);
    if (!original) throw new Error("Falta una de las ventas autorizadas; no se amplía la selección");
    const sale = decodeFields(original.fields);
    if (sale.deleted === true) { stats.alreadyArchived++; continue; }
    stats.archived++;
    if (sale.fiscalInvoiceId || sale.fiscalInvoice) stats.fiscalLinksPreserved++;
    const reason = "Baja de las 13 ventas propias solicitada por el Administrador antes de importar el histórico";
    const fields = encodeFields({ deleted: true, deletedAt: new Date(now), deletedBy: "legacy-data-migration", deletedByName: "Solicitud del Administrador", deletionReason: reason, cleanupOperationId: operationId });
    // A field mask keeps totals, timestamps, status and all invoice references intact.
    operations.push({ path: `sales/${id}`, fields, updateMask: Object.keys(fields), precondition: { updateTime: original.updateTime } });
    if (sale.status === "active") for (const item of sale.items || []) {
      const key = `locationStock/${sale.locationId}/items/${item.productId}`;
      const seeds = movements.filter(movement => ["legacy_migration_snapshot", "legacy_sync_snapshot"].includes(movement.type) &&
        movement.productId === item.productId && (movement.inventoryId || movement.locationId) === sale.locationId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const seed = seeds[0];
      const sold = movements.filter(movement => movement.saleId === id && movement.productId === item.productId && movement.type === "sale");
      if (!seed || !sold.length) throw new Error("No se puede comprobar el impacto de stock de una venta seleccionada");
      if (!sold.some(movement => new Date(movement.createdAt) > new Date(seed.createdAt))) { stats.resetByEarlierSnapshot++; continue; }
      if (movements.some(movement => movement.saleId === id && movement.productId === item.productId && movement.type === "sale_cancel")) throw new Error("La venta activa ya tiene devolución; requiere revisión");
      if (!Number.isInteger(item.qty) || item.qty <= 0) throw new Error("Cantidad inválida en una venta seleccionada");
      if (!docs.has(key)) throw new Error("Falta el saldo de stock que hay que devolver");
      const later = movements.filter(movement => movement.productId === item.productId && (movement.inventoryId || movement.locationId) === sale.locationId &&
        new Date(movement.createdAt) > new Date(seed.createdAt));
      if (!Number.isInteger(seed.newStock) || later.some(movement => !Number.isInteger(movement.qty)) ||
        seed.newStock + later.reduce((sum, movement) => sum + movement.qty, 0) !== decodeFields(docs.get(key).fields).currentStock) {
        throw new Error("El saldo no concuerda con el snapshot y los movimientos; no se devuelve stock");
      }
      const stock = returns.get(key) || { quantity: 0, items: [] };
      stock.quantity += item.qty;
      stock.items.push({ sale, saleId: id, item });
      returns.set(key, stock);
      stats.returnedUnits += item.qty;
    }
    const auditPath = `auditLogs/${operationId}_${id}`;
    operations.push({ path: auditPath, fields: encodeFields({ action: "sale.deleted", title: "Venta propia archivada por solicitud administrativa", moduleId: "quick-sales", entityType: "sale", entityId: id,
      userId: "legacy-data-migration", userName: "Solicitud del Administrador", description: reason, amount: sale.total,
      locationId: sale.locationId, status: "completed", fiscalLinkPreserved: Boolean(sale.fiscalInvoiceId || sale.fiscalInvoice), createdAt: new Date(now) }), precondition: { exists: false } });
  }
  for (const [key, returned] of returns) {
    const original = docs.get(key), stock = decodeFields(original.fields);
    let balance = stock.currentStock;
    for (const { sale, saleId, item } of returned.items) {
      const movementId = `cleanup_${fingerprint(`${operationId}|${saleId}|${item.productId}`).slice(0,32)}`;
      operations.push({ path: `stockMovements/${movementId}`, fields: encodeFields({ type: "sale_cancel", locationId: sale.locationId, locationName: sale.locationName,
        productId: item.productId, productName: item.name, qty: item.qty, previousStock: balance, newStock: balance + item.qty,
        reason: "Devolución por baja administrativa de venta propia; sin cambio fiscal", saleId, userId: "legacy-data-migration", userName: "Solicitud del Administrador", operationId, createdAt: new Date(now) }), precondition: { exists: false } });
      balance += item.qty;
    }
    const fields = encodeFields({ currentStock: balance, updatedAt: new Date(now), cleanupOperationId: operationId });
    operations.push({ path: key, fields, updateMask: Object.keys(fields), precondition: { updateTime: original.updateTime } });
  }
  if (operations.length > 500) throw new Error("La limpieza excede una transacción atómica");
  return { operationId, createdAt: now, authorizedIds, stats, groups: operations.length ? [{ id: operationId, operations }] : [], conflicts: [] };
}
