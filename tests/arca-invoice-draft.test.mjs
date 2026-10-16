import test from "node:test";
import assert from "node:assert/strict";
import { validateInvoiceDraft } from "../netlify/functions/_lib/arca/invoiceDraft.mjs";
const env = {
  ARCA_ENVIRONMENT: "production",
  ARCA_ALLOW_PRODUCTION_INVOICE_PREPARE: "true",
  ARCA_ALLOW_PRODUCTION_CAE: "true",
  ARCA_AUTO_AUTHORIZE_PRODUCTION: "true",
  ARCA_AUTO_AUTHORIZE_PRODUCTION_SOURCES: "admin_quick_sale,seller_sale",
  ARCA_ISSUER_VAT_CONDITION: "responsable_inscripto",
  ARCA_DEFAULT_PRODUCT_VAT_RATE: "21",
  ARCA_CONSUMER_FINAL_ID_THRESHOLD: "100000",
};
const receiver = {
  vatConditionId: 5,
  documentType: 99,
  documentNumber: "0",
  anonymousConsumerFinal: true,
};
const draft = {
  sourceType: "seller_sale",
  items: [{ productId: "salt", qty: 1, unitPrice: 5000 }],
  discountTotal: 4900,
  total: 100,
  receiver,
  env,
  getDocument: async () => ({ data: {} }),
};
test("CF sin documento permite total con descuento y factura B", async () => {
  const result = await validateInvoiceDraft(draft);
  assert.equal(result.ready, true);
  assert.equal(result.voucherClass, "B");
});
test("RI se resuelve en servidor; la selección del navegador no determina la factura", async () => {
  const result = await validateInvoiceDraft({
    ...draft,
    receiver: {
      vatConditionId: 5,
      documentType: 80,
      documentNumber: "20123456786",
    },
    lookupReceiver: async () => ({
      receiver: {
        vatConditionId: 1,
        documentType: 80,
        documentNumber: "20123456786",
      },
    }),
  });
  assert.equal(result.voucherClass, "A");
  assert.equal(result.receiver.vatConditionId, 1);
});
test("Datos fiscales faltantes, gates apagados y CF sobre umbral bloquean antes de la venta", async () => {
  await assert.rejects(
    validateInvoiceDraft({ ...draft, getDocument: async () => null }),
    { code: "arca-fiscal-readiness-incomplete" },
  );
  await assert.rejects(
    validateInvoiceDraft({
      ...draft,
      env: { ...env, ARCA_AUTO_AUTHORIZE_PRODUCTION: "false" },
    }),
    { code: "arca-auto-invoice-unavailable" },
  );
  await assert.rejects(
    validateInvoiceDraft({
      ...draft,
      discountTotal: 0,
      total: 5000,
      env: { ...env, ARCA_CONSUMER_FINAL_ID_THRESHOLD: "1000" },
    }),
    { code: "arca-consumer-final-identification-required" },
  );
});
