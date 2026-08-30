import test from "node:test";
import assert from "node:assert/strict";
import {
  PRICE_MODES,
  effectiveLocationPrice,
  mergeLocationInventoryItem,
  mergeWarehouseInventoryItem,
  nextStockAfterAddition,
  summarizeTransfer,
  validateTransferLine,
} from "../src/modules/inventory/domain/inventory.js";

test("el precio predeterminado se resuelve siempre desde el producto maestro", () => {
  const stock = { productId: "coratina", priceMode: PRICE_MODES.DEFAULT, currentStock: 20 };
  assert.equal(effectiveLocationPrice({ id: "coratina", defaultPrice: 22000 }, stock), 22000);
  assert.equal(effectiveLocationPrice({ id: "coratina", defaultPrice: 23000 }, stock), 23000);
});

test("el precio especial de una ubicación no cambia cuando cambia el maestro", () => {
  const stock = {
    productId: "coratina",
    priceMode: PRICE_MODES.CUSTOM,
    priceOverride: 25000,
    currentStock: 20,
  };
  assert.equal(effectiveLocationPrice({ id: "coratina", defaultPrice: 22000 }, stock), 25000);
  assert.equal(effectiveLocationPrice({ id: "coratina", defaultPrice: 23000 }, stock), 25000);
});

test("un precio legacy se conserva como precio local para evitar cambios silenciosos", () => {
  const merged = mergeLocationInventoryItem(
    { id: "coratina", name: "Coratina", defaultPrice: 23000 },
    { productId: "coratina", price: 22000, currentStock: 5 },
  );
  assert.equal(merged.effectivePrice, 22000);
  assert.equal(merged.usesDefaultPrice, false);
  assert.equal(merged.legacyPrice, true);
});

test("un depósito nunca expone campos de precio aunque un registro legacy los tenga", () => {
  const merged = mergeWarehouseInventoryItem(
    { id: "coratina", name: "Coratina", defaultPrice: 23000 },
    {
      productId: "coratina",
      currentStock: 8,
      price: 999,
      priceMode: "custom",
      priceOverride: 999,
      masterDefaultPrice: 23000,
    },
  );
  assert.equal(merged.currentStock, 8);
  assert.equal(merged.defaultPrice, 23000);
  assert.equal("price" in merged, false);
  assert.equal("priceMode" in merged, false);
  assert.equal("priceOverride" in merged, false);
});

test("agregar stock suma unidades y rechaza valores inválidos", () => {
  assert.equal(nextStockAfterAddition(20, 12), 32);
  assert.throws(() => nextStockAfterAddition(20, 0), /mayor a cero/);
  assert.throws(() => nextStockAfterAddition(20, -1), /mayor a cero/);
  assert.throws(() => nextStockAfterAddition(20, 1.5), /número entero/);
});

test("una transferencia valida disponibilidad y nunca acepta cantidades negativas o superiores al stock", () => {
  assert.equal(validateTransferLine({ productName: "Coratina", quantity: 8 }, 12), 8);
  assert.throws(
    () => validateTransferLine({ productName: "Coratina", quantity: 13 }, 12),
    /Hay 12 unidades disponibles/,
  );
  assert.throws(() => validateTransferLine({ productName: "Coratina", quantity: -1 }, 12));
  assert.throws(() => validateTransferLine({ productName: "Coratina", quantity: 0 }, 12));
});

test("el resumen de transferencia admite varios productos en una sola operación", () => {
  assert.deepEqual(
    summarizeTransfer([
      { productId: "coratina", quantity: 12 },
      { productId: "arbequina", quantity: 8 },
      { productId: "arbosana", quantity: 5 },
      { productId: "pistachos", quantity: 10 },
      { productId: "sin-mover", quantity: 0 },
    ]),
    { productCount: 4, totalQuantity: 35 },
  );
});
