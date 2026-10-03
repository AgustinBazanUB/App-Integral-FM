import test from "node:test";
import assert from "node:assert/strict";

import { ensurePendingInvoice } from "../netlify/functions/_lib/arca/invoicePersistence.mjs";

function store(seed) {
  const documents = new Map(Object.entries(seed).map(([path, data]) => [
    path,
    { path, data: structuredClone(data), updateTime: "u0" },
  ]));
  return {
    async getDocument(path) {
      return documents.get(path) || null;
    },
    async createDocument(collectionPath, documentId, data) {
      const path = `${collectionPath}/${documentId}`;
      const document = { path, data: structuredClone(data), updateTime: "u1" };
      documents.set(path, document);
      return document;
    },
  };
}

test("fallback IVA 21 configurable completa snapshot y conserva receptor", async () => {
  const db = store({
    "sales/sale-policy": {
      saleCode: "FM-TEST-1",
      status: "active",
      sellerId: "seller-1",
      ticketRequested: true,
      subtotal: 1210,
      discountTotal: 0,
      totalBeforeDiscounts: 1210,
      total: 1210,
      totalItems: 1,
      items: [{
        productId: "product-1",
        name: "Producto",
        qty: 1,
        unitPrice: 1210,
        subtotal: 1210,
      }],
    },
    "products/product-1": {
      name: "Producto",
      arcaVatRate: null,
      active: true,
      deleted: false,
    },
  });

  const result = await ensurePendingInvoice({
    sourceType: "seller_sale",
    sourceId: "sale-policy",
    requestedBy: "seller-1",
    receiver: {
      vatConditionId: 5,
      documentType: 99,
      documentNumber: "0",
      anonymousConsumerFinal: true,
      concept: 1,
    },
    env: { ARCA_DEFAULT_PRODUCT_VAT_RATE: "21" },
    getDocument: db.getDocument,
    createDocument: db.createDocument,
  });

  assert.equal(result.invoice.fiscalReadiness.ready, true);
  assert.equal(result.invoice.productFiscalSnapshot[0].arcaVatRate, 21);
  assert.equal(result.invoice.productFiscalSnapshot[0].arcaVatRateSource, "environment-default");
  assert.equal(result.invoice.receiverSnapshot.vatConditionId, 5);
  assert.equal(result.invoice.receiverSnapshot.documentType, 99);
  assert.equal(result.invoice.receiverSnapshot.anonymousConsumerFinal, true);
});
