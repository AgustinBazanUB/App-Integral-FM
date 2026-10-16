import test from "node:test";
import assert from "node:assert/strict";
import { completePendingInvoice } from "../netlify/functions/_lib/arca/invoicePersistence.mjs";
const env = {
  ARCA_ISSUER_VAT_CONDITION: "responsable_inscripto",
  ARCA_CONSUMER_FINAL_ID_THRESHOLD: "100000",
  ARCA_DEFAULT_PRODUCT_VAT_RATE: "21",
};
const receiver = {
  vatConditionId: 5,
  documentType: 99,
  documentNumber: "0",
  anonymousConsumerFinal: true,
  concept: 1,
};
function setup(overrides = {}) {
  let invoice = {
      status: "pending",
      receiverSnapshot: null,
      authorization: {},
      fiscalReadiness: { ready: false },
      saleSnapshot: {
        total: 1210,
        discountTotal: 0,
        items: [{ productId: "p", qty: 1, unitPrice: 1210, subtotal: 1210 }],
      },
      ...overrides,
    },
    writes = 0;
  const options = {
    invoiceId: "legacy",
    receiver,
    env,
    runTransaction: async (work) =>
      work({
        getDocument: async (path) =>
          path === "invoices/legacy"
            ? { data: structuredClone(invoice), updateTime: "v1" }
            : { data: { arcaVatRate: 21 } },
        commitDocuments: async (operations) => {
          assert.equal(operations.length, 1);
          assert.equal(operations[0].path, "invoices/legacy");
          invoice = { ...invoice, ...operations[0].data };
          writes++;
        },
      }),
  };
  return {
    complete: () => completePendingInvoice(options),
    invoice: () => invoice,
    writes: () => writes,
  };
}
test("Solicitud vieja sin receptor completa CF e IVA en el mismo invoice ID", async () => {
  const h = setup();
  await h.complete();
  await h.complete();
  assert.equal(h.invoice().receiverSnapshot.documentType, 99);
  assert.equal(h.invoice().fiscalReadiness.ready, true);
  assert.equal(h.invoice().productFiscalSnapshot[0].arcaVatRate, 21);
  assert.equal(h.writes(), 1);
});
test("Receptor completo existente se conserva al completar datos fiscales", async () => {
  const original = {
    vatConditionId: 1,
    documentType: 80,
    documentNumber: "20123456786",
    concept: 1,
  };
  const h = setup({ receiverSnapshot: original });
  await h.complete();
  assert.deepEqual(h.invoice().receiverSnapshot, original);
});
test("CAE o numeración reservada impiden modificar receptor y snapshot", async () => {
  for (const overrides of [
    { status: "authorized" },
    { status: "authorizing" },
    { authorization: { voucherNumber: 12 } },
    { authorization: { cae: "12345678901234" } },
  ]) {
    const h = setup(overrides);
    const before = structuredClone(h.invoice());
    await h.complete();
    assert.deepEqual(h.invoice(), before);
    assert.equal(h.writes(), 0);
  }
});
