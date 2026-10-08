import test from "node:test";
import assert from "node:assert/strict";
import { saleActivitySnapshot } from "../src/shared/activitySnapshots.mjs";
import { activityChangeRows, activityFieldRows, activityStockMovements, activityUserOptions } from "../src/gestion/activity/activityDetails.js";

test("sale audit snapshots keep products, amounts and split payments without credentials or customer contact data", () => {
  const sale = { saleCode: "FM-1", total: 15000, cashRoundingDiscountTotal: 300, paymentMethod: "multiple", customerPhoneSnapshot: "PRIVATE", authorization: { token: "PRIVATE" }, items: [{ productId: "jam", name: "Mermelada", qty: 2, unitPrice: 8000, subtotal: 16000, secret: "PRIVATE" }], payments: [{ method: "cash", amount: 10000, providerPayload: "PRIVATE" }, { method: "alias", amount: 5000 }] };
  const snapshot = saleActivitySnapshot(sale);
  sale.items[0].qty = 99; sale.payments[0].amount = 99;
  assert.equal(snapshot.items[0].qty, 2); assert.equal(snapshot.payments[0].amount, 10000);
  assert.equal(snapshot.total, 15000); assert.equal(snapshot.cashRoundingDiscountTotal, 300);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE|authorization|secret|providerPayload|customerPhone/);
});
test("users without activity remain selectable and duplicated names identify their exact accounts", () => {
  const directory = [{ id: "a", name: "Agustin", email: "first@example.com", active: true }, { id: "b", name: "Agustin", email: "agsreserva@gmail.com", active: true }, { id: "idle", name: "Sin registros", active: false }];
  const options = activityUserOptions(directory, [{ userId: "system", userName: "Olivia" }], { id: "b", name: "Agustin" });
  assert.equal(options.length, 4); assert.equal(options.find(user => user.id === "b").label, "Agustin · agsreserva@gmail.com");
  assert.match(options.find(user => user.id === "idle").label, /inactivo/);
  assert.equal(activityUserOptions(directory, []).length, 3);
});
test("recorded stock and sale changes explain quantities, prices, added and removed products", () => {
  const rows = activityChangeRows({ total: 8000, items: [{ productId: "jam", name: "Mermelada", qty: 1, unitPrice: 8000 }] }, { total: 20000, items: [{ productId: "jam", name: "Mermelada", qty: 2, unitPrice: 10000 }] });
  assert.equal(rows.find(row => row.key === "jam:qty").before, "1"); assert.equal(rows.find(row => row.key === "jam:qty").after, "2");
  assert.match(rows.find(row => row.key === "jam:unitPrice").after, /10.000/);
  const stock = activityChangeRows([{ productId: "jam", originStock: 10 }], [{ productId: "jam", originStock: 7 }], { jam: "Mermelada" });
  assert.equal(stock[0].label, "Mermelada · Stock en origen");
});
test("technical and nested configuration secrets never become visible activity fields", () => {
  const rows = activityFieldRows({ name: "Configuración", apiKey: "PRIVATE", access_token: "PRIVATE", operatingCalendar: { weekdays: [1, 2], openingTime: "09:00", closingTime: "18:00", apiKey: "PRIVATE" } });
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE|apiKey|access_token/);
  assert.match(rows.find(row => row.key === "operatingCalendar").value, /Lunes · Martes · Apertura: 09:00 · Cierre: 18:00/);
  assert.equal(activityFieldRows(null).length, 0);
});
test("Olivia list loads display immutable product names, received units and stock changes", () => {
  const result = { lines: [{ productId: "jam", name: "Mermelada", quantity: 10, previousStock: 3, newStock: 13 }] };
  assert.deepEqual(activityStockMovements(result), [{ id: "jam", productName: "Mermelada", qty: 10, previousStock: 3, newStock: 13 }]);
  const changes = activityChangeRows([{ productId: "jam", currentStock: 3 }], result, { jam: "Mermelada" });
  assert.deepEqual(changes, [{ key: "jam:currentStock", label: "Mermelada · Stock actual", before: "3", after: "13" }]);
  assert.deepEqual(activityChangeRows({ price: 19000, active: true }, { active: true }), []);
  assert.equal(activityChangeRows({ items: [{ productId: "jam", qty: 2 }] }, { items: [] })[0].after, "—");
});
