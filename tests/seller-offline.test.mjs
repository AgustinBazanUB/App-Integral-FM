import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { indexedDB } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;
globalThis.window = { indexedDB };
const bundle = await build({
  entryPoints: ["src/gestion/seller/offlineSales.js"],
  bundle: true, write: false, platform: "node", format: "esm",
});
let moduleSequence = 0;
const loadOffline = () => import(`data:text/javascript;base64,${Buffer.from(
  bundle.outputFiles[0].text + `\n// reload ${++moduleSequence}`,
).toString("base64")}`);
const sale = (id, extra = {}) => ({
  localId: id, locationId: "loc1", locationName: "Local", sellerId: "seller",
  sellerName: "Vendedor", items: [{ productId: "oil", name: "Aceite", qty: 1, unitPrice: 2500 }],
  total: 2500, paymentMethod: "cash", paymentMethodLabel: "Efectivo", ...extra,
});

for (const vatConditionId of [5, 1, 6, 4]) {
  test(`IVA ${vatConditionId}: receptor persiste al cerrar/reabrir IndexedDB y reintentar`, async () => {
    const localId = `receiver_${vatConditionId}`;
    const receiver = {
      vatConditionId, documentType: vatConditionId === 5 ? 99 : 80,
      documentNumber: vatConditionId === 5 ? "0" : "20123456786",
      anonymousConsumerFinal: vatConditionId === 5, concept: 1,
    };
    const first = await loadOffline();
    await first.saveSellerPendingSale(sale(localId, { ticketRequested: true, invoiceReceiver: receiver }));
    (await first.openSellerOfflineDb()).close();
    const reopened = await loadOffline();
    const readPending = async () => (await reopened.listSellerPendingSales("seller")).find(s => s.localId === localId);
    assert.deepEqual((await readPending()).invoiceReceiver, receiver);
    await reopened.markSellerPendingError(localId, "Sin conexión");
    const retry = await readPending();
    assert.equal(retry.retryCount, 1);
    assert.equal(retry.status, "sync_error");
    assert.deepEqual(retry.invoiceReceiver, receiver);
    await reopened.saveSellerPendingSale(retry);
    assert.deepEqual((await readPending()).invoiceReceiver, receiver);
    await reopened.markSellerPendingSynced(localId, "remote-sale");
    assert.equal(await readPending(), undefined);
    await reopened.deleteSellerPendingSale(localId);
    (await reopened.openSellerOfflineDb()).close();
  });
}

test("Consumidor Final identificado conserva DNI", async () => {
  const offline = await loadOffline();
  const receiver = { vatConditionId: 5, documentType: 96, documentNumber: "30123456", anonymousConsumerFinal: false, concept: 1 };
  await offline.saveSellerPendingSale(sale("dni", { ticketRequested: true, invoiceReceiver: receiver }));
  assert.deepEqual((await offline.listSellerPendingSales("seller")).find(s => s.localId === "dni").invoiceReceiver, receiver);
  (await offline.openSellerOfflineDb()).close();
});

test("pendientes antiguos sin receptor y ventas sin factura siguen guardándose", async () => {
  const offline = await loadOffline();
  const legacy = await offline.saveSellerPendingSale(sale("legacy", { ticketRequested: true }));
  assert.equal(legacy.invoiceReceiver, null);
  assert.equal(legacy.ticketStatus, "pending");
  const unbilled = await offline.saveSellerPendingSale(sale("unbilled", { invoiceReceiver: { invalid: true } }));
  assert.equal(unbilled.invoiceReceiver, null);
  assert.equal(unbilled.ticketStatus, "not_requested");
  (await offline.openSellerOfflineDb()).close();
});

test("receptor inválido no se escribe en IndexedDB", async () => {
  const offline = await loadOffline();
  for (const [index, receiver] of [
    { vatConditionId: 1, documentType: 80, documentNumber: "1234", concept: 1 },
    { vatConditionId: 6, documentType: 99, documentNumber: "20123456786", concept: 1 },
    { vatConditionId: 5, documentType: 99, documentNumber: "0", anonymousConsumerFinal: false, concept: 1 },
  ].entries()) {
    const localId = `invalid_${index}`;
    await assert.rejects(offline.saveSellerPendingSale(sale(localId, { ticketRequested: true, invoiceReceiver: receiver })), /datos fiscales/);
    assert.equal((await offline.listSellerPendingSales("seller")).some(s => s.localId === localId), false);
  }
  (await offline.openSellerOfflineDb()).close();
});
