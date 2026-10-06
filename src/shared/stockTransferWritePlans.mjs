import { INVENTORY_TYPES, PRICE_MODES, wholeInventoryQuantity } from "../modules/inventory/domain/inventory.js";
const userName = (profile) => profile.name || profile.email || "Usuario";
// Shared deterministic plan: manual UI and Olivia commit the same domain effects.
export function buildStockTransferWrites({ prepared, origin, destination, profile, carrierName = "", transferId: safeId, stamp, correlation = {} }) {
  const writes = [];
  const pathOf = (ref) => typeof ref === "string" ? ref : ref.path;
  const update = (ref, data) => writes.push({ type: "update", path: pathOf(ref), data });
  const set = (ref, data) => writes.push({ type: "create", path: pathOf(ref), data });
  const transferRef = `stockTransfers/${safeId}`, auditRef = `auditLogs/${safeId}`;
    const originName = origin.name;
    const destinationName = destination.name;
    prepared.forEach((item) => {
      const originPrevious = Number(item.originStock.currentStock || 0);
      const originNew = originPrevious - item.quantity;
      const destinationPrevious = Number(item.destinationStock?.currentStock || 0);
      const destinationNew = destinationPrevious + item.receivedQuantity;
      const outMovementRef = { id: `${safeId}_${item.productId}_out`, path: `stockMovements/${safeId}_${item.productId}_out` };
      const inMovementRef = { id: `${safeId}_${item.productId}_in`, path: `stockMovements/${safeId}_${item.productId}_in` };

      update(item.originStockRef, {
        currentStock: originNew,
        lastMovementId: outMovementRef.id,
        updatedAt: stamp,
        updatedBy: profile.id,
      });

      if (item.destinationStock) {
        // Si ya existía en el destino se modifica únicamente el stock: precio,
        // alertas y demás configuración local quedan exactamente como estaban.
        update(item.destinationStockRef, {
          currentStock: destinationNew,
          lastMovementId: inMovementRef.id,
          updatedAt: stamp,
          updatedBy: profile.id,
        });
      } else if (destination.type === INVENTORY_TYPES.LOCATION) {
        const wantsCustomPrice = item.line.destinationUseDefaultPrice === false;
        const priceOverride = wantsCustomPrice
          ? wholeInventoryQuantity(item.line.destinationPriceOverride, `El precio especial de ${item.product.name}`)
          : null;
        set(item.destinationStockRef, {
          productId: item.productId,
          productName: item.product.name,
          abbreviation: item.product.abbreviation || "",
          categoryId: item.product.categoryId || "",
          categoryName: item.product.categoryName || "Sin categoría",
          imageUrl: item.product.imageUrl || "",
          thumbUrl: item.product.thumbUrl || "",
          priceMode: wantsCustomPrice ? PRICE_MODES.CUSTOM : PRICE_MODES.DEFAULT,
          priceOverride,
          price: wantsCustomPrice ? priceOverride : Number(item.product.defaultPrice || 0),
          masterDefaultPrice: Number(item.product.defaultPrice || 0),
          initialStock: item.receivedQuantity,
          currentStock: item.receivedQuantity,
          yellowAlertQty: 0,
          redAlertQty: 0,
          active: true,
          deleted: false,
          productDeleted: false,
          assignedAt: stamp,
          assignedBy: profile.id,
          updatedAt: stamp,
          updatedBy: profile.id,
          lastMovementId: inMovementRef.id,
        });
      } else {
        set(item.destinationStockRef, {
          productId: item.productId,
          productName: item.product.name,
          abbreviation: item.product.abbreviation || "",
          categoryId: item.product.categoryId || "",
          categoryName: item.product.categoryName || "Sin categoría",
          imageUrl: item.product.imageUrl || "",
          thumbUrl: item.product.thumbUrl || "",
          initialStock: item.receivedQuantity,
          currentStock: item.receivedQuantity,
          active: true,
          deleted: false,
          productDeleted: false,
          assignedAt: stamp,
          assignedBy: profile.id,
          updatedAt: stamp,
          updatedBy: profile.id,
          lastMovementId: inMovementRef.id,
        });
      }

      set(outMovementRef, {
        operationId: safeId,
        transferId: safeId,
        inventoryType: origin.type,
        inventoryId: origin.id,
        ...(origin.type === INVENTORY_TYPES.LOCATION ? { locationId: origin.id, locationName: originName } : { warehouseId: origin.id, warehouseName: originName }),
        productId: item.productId,
        productName: item.product.name,
        type: "transfer_out",
        qty: -item.quantity,
        requestedQty: item.quantity,
        preparedQty: item.preparedQuantity, receivedQty: item.receivedQuantity,
        missingQty: item.missingQuantity, lostQty: item.lostQuantity,
        previousStock: originPrevious,
        newStock: originNew,
        reason: `Transferencia a ${destinationName}: previstas ${item.quantity}, preparadas ${item.preparedQuantity}, recibidas ${item.receivedQuantity}${destination.note ? ` · ${destination.note}` : ""}`,
        originType: origin.type,
        originId: origin.id,
        originName,
        destinationType: destination.type,
        destinationId: destination.id,
        destinationName,
        userId: profile.id,
        userName: userName(profile),
        saleId: "",
        createdAt: stamp,
      });
      set(inMovementRef, {
        operationId: safeId,
        transferId: safeId,
        inventoryType: destination.type,
        inventoryId: destination.id,
        ...(destination.type === INVENTORY_TYPES.LOCATION
          ? { locationId: destination.id, locationName: destinationName }
          : { warehouseId: destination.id, warehouseName: destinationName }),
        productId: item.productId,
        productName: item.product.name,
        type: "transfer_in",
        qty: item.receivedQuantity,
        requestedQty: item.quantity,
        preparedQty: item.preparedQuantity, receivedQty: item.receivedQuantity,
        missingQty: item.missingQuantity, lostQty: item.lostQuantity,
        previousStock: destinationPrevious,
        newStock: destinationNew,
        reason: `Transferencia desde ${originName}: recibidas ${item.receivedQuantity} de ${item.quantity}${destination.note ? ` · ${destination.note}` : ""}`,
        originType: origin.type,
        originId: origin.id,
        originName,
        destinationType: destination.type,
        destinationId: destination.id,
        destinationName,
        userId: profile.id,
        userName: userName(profile),
        saleId: "",
        createdAt: stamp,
      });
    });

    const totalQuantity = prepared.reduce((sum, item) => sum + item.quantity, 0);
    const payload = {
      createdBy: profile.id,
      createdByName: userName(profile),
      createdAt: stamp,
      updatedAt: stamp,
      status: "completed",
      sourceType: origin.type,
      sourceId: origin.id,
      sourceName: originName,
      destinationType: destination.type,
      destinationId: destination.id,
      destinationName,
      itemCount: prepared.length,
      totalQuantity,
      preparedQuantity: prepared.reduce((sum, item) => sum + item.preparedQuantity, 0),
      receivedQuantity: prepared.reduce((sum, item) => sum + item.receivedQuantity, 0),
      missingQuantity: prepared.reduce((sum, item) => sum + item.missingQuantity, 0),
      lostQuantity: prepared.reduce((sum, item) => sum + item.lostQuantity, 0),
      preparedBy: profile.id, preparedByName: userName(profile),
      receivedBy: profile.id, receivedByName: userName(profile), receivedAt: stamp,
      carrierName: String(carrierName || userName(profile)).trim(),
      items: prepared.map((item) => ({
        productId: item.productId,
        productName: item.product.name,
        quantity: item.quantity, preparedQuantity: item.preparedQuantity, receivedQuantity: item.receivedQuantity, missingQuantity: item.missingQuantity, lostQuantity: item.lostQuantity,
      })),
      note: String(destination.note || "").trim(),
    };
    set(transferRef, { ...payload, ...correlation });
    set(auditRef, {
      ...correlation, action: "stock.transfer",
      title: "Transferencia de stock",
      description: `${originName} → ${destinationName} · ${prepared.length} producto${prepared.length === 1 ? "" : "s"}`,
      moduleId: "warehouse",
      entityType: "stockTransfer",
      entityId: safeId,
      sourceType: origin.type, sourceId: origin.id,
      ...(origin.type === INVENTORY_TYPES.LOCATION ? { locationId: origin.id, locationName: originName } : { warehouseId: origin.id, warehouseName: originName, sourceWarehouseId: origin.id }),
      receivedQuantity: payload.receivedQuantity, missingQuantity: payload.missingQuantity, lostQuantity: payload.lostQuantity, carrierName: payload.carrierName,
      destinationType: destination.type,
      destinationId: destination.id,
      userId: profile.id,
      userName: userName(profile),
      status: "completed",
      before: prepared.map((item) => ({ productId: item.productId, originStock: Number(item.originStock.currentStock || 0), destinationStock: Number(item.destinationStock?.currentStock || 0) })),
      after: prepared.map((item) => ({ productId: item.productId, originStock: Number(item.originStock.currentStock || 0) - item.quantity, destinationStock: Number(item.destinationStock?.currentStock || 0) + item.receivedQuantity })),
      createdAt: stamp,
    });
    return { result: { id: safeId, ...payload }, writes };
}
