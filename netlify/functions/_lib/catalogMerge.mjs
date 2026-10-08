import { createHash } from "node:crypto";
import { normalizedRole } from "../../../src/gestion/permissions.js";

const fail = (code, message, status = 409) => { throw Object.assign(new Error(message), { code, status }); };
const safeId = value => { if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(value || ""))) fail("PRODUCTO-ID", "Elegí los dos productos del catálogo.", 422); return value; };
const unavailable = row => !row || row.active === false || row.deleted === true || row.mergedIntoProductId;
const quantity = value => { const number = Number(value ?? 0); if (!Number.isSafeInteger(number) || number < 0) fail("STOCK-NO-VALIDO", "Hay un stock negativo o inválido. Corregilo antes de unificar los productos."); return number; };
const hasProduct = (row, id) => (row.items || row.lines || []).some(item => (item.productId || item.id) === id);
const publicPlan = plan => ({ source: plan.source, target: plan.target, inventories: plan.inventories.map(row => ({ type: row.type, id: row.id, name: row.name, quantity: row.quantity, targetBefore: row.targetBefore, targetAfter: row.targetBefore + row.quantity })), totalUnits: plan.totalUnits, fingerprint: plan.fingerprint });

export async function mergeCatalogProduct({ store, uid, sourceId, targetId, action, expectedFingerprint, now = new Date() }) {
  safeId(sourceId); safeId(targetId);
  if (sourceId === targetId) fail("PRODUCTO-IGUAL", "Elegí un producto de destino distinto.", 422);
  if (!["preview", "merge"].includes(action)) fail("ACCION-NO-VALIDA", "La operación no es válida.", 422);
  const operationId = `product_merge_${createHash("sha256").update(`${sourceId}|${targetId}`).digest("hex").slice(0,32)}`;
  return store.transaction(async tx => {
    const profile = (await tx.getDocument(`users/${uid}`))?.data;
    if (!profile || profile.active !== true || !["admin", "general_admin"].includes(normalizedRole(profile))) fail("PERMISO-CATALOGO", "Sólo un administrador puede unificar productos.", 403);
    const done = (await tx.getDocument(`inventoryOperations/${operationId}`))?.data;
    if (done) return { ...done.result, alreadyMerged: true };
    const source = (await tx.getDocument(`products/${sourceId}`))?.data;
    const target = (await tx.getDocument(`products/${targetId}`))?.data;
    if (unavailable(source) || unavailable(target)) fail("PRODUCTO-NO-DISPONIBLE", "Uno de los productos está archivado o ya fue unificado.");
    if (!source.categoryId || source.categoryId !== target.categoryId) fail("CATEGORIA-DISTINTA", "Los productos deben pertenecer a la misma categoría.");
    // Refuse to strand a cancellation, reserved order or transfer on the old ID.
    // Collection reads and stock reads belong to the same serializable transaction.
    const [sales, transfers, orders, locations, warehouses] = await Promise.all(["sales", "stockTransfers", "orders", "locations", "warehouses"].map(path => tx.listDocuments(path, { maxDocuments: 5000 })));
    if (sales.some(row => row.status !== "cancelled" && hasProduct(row, sourceId))) fail("PRODUCTO-CON-VENTAS", "El producto tiene ventas que todavía pueden anularse. Necesita una revisión de esas ventas antes de unificarlo; no se movió stock.");
    if (transfers.some(row => !["completed", "cancelled", "received"].includes(row.status) && hasProduct(row, sourceId))) fail("PRODUCTO-EN-TRASLADO", "Hay un traslado pendiente de este producto. Terminá el traslado antes de unificarlo.");
    if (orders.some(row => !["cancelled", "fulfilled", "delivered", "completed", "expired"].includes(row.status) && hasProduct(row, sourceId))) fail("PRODUCTO-CON-PEDIDO", "Hay un pedido pendiente de este producto. Resolvelo antes de unificarlo.");
    if (locations.length + warehouses.length > 80) fail("INVENTARIOS-LIMITE", "Hay demasiados inventarios para unificarlos en una sola operación.");
    const inventories = [];
    for (const [type, owners] of [["location", locations], ["warehouse", warehouses]]) {
      for (const owner of owners) {
        const base = `${type === "location" ? "locationStock" : "warehouseStock"}/${safeId(owner.id)}/items`;
        const sourceStock = (await tx.getDocument(`${base}/${sourceId}`))?.data;
        if (!sourceStock) continue;
        const targetStock = (await tx.getDocument(`${base}/${targetId}`))?.data;
        if (sourceStock.productId !== sourceId || (targetStock && targetStock.productId !== targetId)) fail("STOCK-PRODUCTO", "Hay un registro de stock asociado a otro producto. Revisalo antes de unificar.");
        const amount = quantity(sourceStock.currentStock);
        if (amount && (sourceStock.deleted === true || owner.deleted === true)) fail("STOCK-ARCHIVADO", "Hay stock en un registro archivado. Revisalo antes de unificar el producto.");
        if (targetStock && (targetStock.deleted === true || targetStock.active === false) && amount) fail("DESTINO-DESACTIVADO", `Activá ${target.name} en ${owner.name} antes de moverle stock.`);
        if (Number(sourceStock.reservedStock || sourceStock.reservedQuantity || 0) > 0) fail("STOCK-RESERVADO", "El producto tiene stock reservado. Resolvé la reserva antes de unificarlo.");
        const targetBefore = quantity(targetStock?.currentStock);
        quantity(targetBefore + amount);
        inventories.push({ type, id: owner.id, name: owner.name || owner.id, base, sourceStock, targetStock, quantity: amount, targetBefore });
      }
    }
    const plan = { source: { id: sourceId, name: source.name, abbreviation: source.abbreviation }, target: { id: targetId, name: target.name, abbreviation: target.abbreviation }, inventories, totalUnits: inventories.reduce((total, row) => total + row.quantity, 0) };
    plan.fingerprint = createHash("sha256").update(JSON.stringify({ source, target, inventories })).digest("hex");
    const result = publicPlan(plan);
    if (action === "preview") return result;
    if (expectedFingerprint !== plan.fingerprint) fail("STOCK-CAMBIO", "Cambió el catálogo o el stock desde la revisión. Volvé a revisar las cantidades antes de confirmar.");
    const writes = [];
    const userName = profile.name || profile.email || "Administrador";
    for (const row of inventories) {
      const sourceMovement = `${operationId}_${row.type}_${row.id}_out`, targetMovement = `${operationId}_${row.type}_${row.id}_in`;
      writes.push({ type: "update", path: `${row.base}/${sourceId}`, data: { currentStock: 0, active: false, mergedIntoProductId: targetId, lastMovementId: sourceMovement, updatedBy: uid, updatedAt: now } });
      if (row.quantity) {
        const data = { currentStock: row.targetBefore + row.quantity, updatedBy: uid, updatedAt: now, lastMovementId: targetMovement };
        if (!row.targetStock) Object.assign(data, { productId: targetId, productName: target.name, abbreviation: target.abbreviation || "", categoryId: target.categoryId, categoryName: target.categoryName || "", initialStock: row.quantity, active: true, deleted: false, createdAt: now, createdBy: uid, ...(row.type === "location" ? { priceMode: "default", priceOverride: null, masterDefaultPrice: target.defaultPrice || 0, yellowAlertQty: target.yellowAlertQty || 0, redAlertQty: target.redAlertQty || 0 } : {}) });
        writes.push({ type: row.targetStock ? "update" : "create", path: `${row.base}/${targetId}`, data });
      }
      for (const [id, productId, productName, before, after] of [[sourceMovement, sourceId, source.name, row.quantity, 0], ...(row.quantity ? [[targetMovement, targetId, target.name, row.targetBefore, row.targetBefore + row.quantity]] : [])]) writes.push({ type: "create", path: `stockMovements/${id}`, data: { operationId, inventoryType: row.type, inventoryId: row.id, ...(row.type === "location" ? { locationId: row.id, locationName: row.name } : { warehouseId: row.id, warehouseName: row.name }), productId, productName, type: "adjustment", qty: after - before, previousStock: before, newStock: after, reason: `Unificación de ${source.name} en ${target.name}`, userId: uid, userName, createdAt: now } });
    }
    writes.push({ type: "update", path: `products/${sourceId}`, data: { active: false, mergedIntoProductId: targetId, mergedAt: now, updatedBy: uid, updatedAt: now } });
    writes.push({ type: "create", path: `inventoryOperations/${operationId}`, data: { operationType: "product_merge", result: { ...result, operationId }, sourceBefore: source, inventoriesBefore: inventories, userId: uid, userName, status: "completed", createdAt: now } });
    writes.push({ type: "create", path: `auditLogs/${operationId}`, data: { action: "product.merged", title: "Producto unificado", description: `${source.name} → ${target.name} · ${result.totalUnits} unidades`, moduleId: "products", entityType: "product", entityId: targetId, userId: uid, userName, status: "completed", detailSnapshot: { schemaVersion: 1, kind: "product_merge", source: plan.source, target: plan.target, inventories: result.inventories }, createdAt: now } });
    await tx.commitDocuments(writes);
    return { ...result, operationId };
  });
}
