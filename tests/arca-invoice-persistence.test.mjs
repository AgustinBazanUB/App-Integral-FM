import test from "node:test";
import assert from "node:assert/strict";

import {
  canRequestInvoiceForSale,
  ensurePendingInvoice,
} from "../netlify/functions/_lib/arca/invoicePersistence.mjs";

function memoryStore(seed = {}) {
  const documents = new Map(Object.entries(seed).map(([path, data]) => [
    path,
    { path, data: structuredClone(data), updateTime: "2026-09-28T12:00:00.000Z" },
  ]));

  return {
    documents,
    async getDocument(path) {
      return documents.get(path) || null;
    },
    async createDocument(collectionPath, documentId, data) {
      const path = `${collectionPath}/${documentId}`;
      if (documents.has(path)) {
        const error = new Error("El documento ya existe.");
        error.code = "firebase-admin-already-exists";
        error.status = 409;
        throw error;
      }
      const document = {
        path,
        data: structuredClone(data),
        updateTime: "2026-09-28T12:00:01.000Z",
      };
      documents.set(path, document);
      return document;
    },
  };
}

const sale = {
  saleCode: "FM-LOC-20260928-0001",
  status: "active",
  sellerId: "seller-1",
  sellerName: "Vendedor",
  locationId: "loc-1",
  locationName: "Local",
  sourceChannel: "in_person",
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
  discounts: [],
};

test("crea una sola solicitud pending y reutiliza el ID determinístico", async () => {
  const store = memoryStore({
    "sales/sale-1": sale,
    "products/product-1": {
      name: "Producto",
      arcaVatRate: 21,
      active: true,
      deleted: false,
    },
  });

  const first = await ensurePendingInvoice({
    sourceType: "seller_sale",
    sourceId: "sale-1",
    requestedBy: "seller-1",
    now: new Date("2026-09-28T12:30:00.000Z"),
    getDocument: store.getDocument,
    createDocument: store.createDocument,
  });

  const second = await ensurePendingInvoice({
    sourceType: "seller_sale",
    sourceId: "sale-1",
    requestedBy: "seller-1",
    now: new Date("2026-09-28T12:31:00.000Z"),
    getDocument: store.getDocument,
    createDocument: store.createDocument,
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.invoiceId, "invoice_seller_sale_sale-1");
  assert.equal(second.invoiceId, first.invoiceId);
  assert.equal(store.documents.size, 3);
  assert.equal(first.invoice.status, "pending");
  assert.equal(first.invoice.fiscalReadiness.ready, true);
  assert.equal(first.invoice.productFiscalSnapshot[0].arcaVatRate, 21);
});

test("snapshot fiscal queda marcado incompleto sin alícuota configurada", async () => {
  const store = memoryStore({
    "sales/sale-2": sale,
    "products/product-1": {
      name: "Producto",
      arcaVatRate: null,
      active: true,
      deleted: false,
    },
  });

  const result = await ensurePendingInvoice({
    sourceType: "seller_sale",
    sourceId: "sale-2",
    requestedBy: "seller-1",
    getDocument: store.getDocument,
    createDocument: store.createDocument,
  });

  assert.equal(result.invoice.fiscalReadiness.ready, false);
  assert.deepEqual(result.invoice.fiscalReadiness.missingVatRate, ["product-1"]);
});

test("no crea solicitud para una venta que no pidió factura", async () => {
  const store = memoryStore({
    "sales/sale-3": { ...sale, ticketRequested: false },
    "products/product-1": { name: "Producto", arcaVatRate: 21 },
  });

  await assert.rejects(
    ensurePendingInvoice({
      sourceType: "seller_sale",
      sourceId: "sale-3",
      requestedBy: "seller-1",
      getDocument: store.getDocument,
      createDocument: store.createDocument,
    }),
    (error) => error?.code === "arca-invoice-not-requested",
  );
});

test("una venta rápida administrativa usa invoiceStatus pending como solicitud", async () => {
  const store = memoryStore({
    "sales/admin-sale-1": {
      ...sale,
      ticketRequested: false,
      invoiceStatus: "pending",
    },
    "products/product-1": { name: "Producto", arcaVatRate: 21 },
  });

  const result = await ensurePendingInvoice({
    sourceType: "admin_quick_sale",
    sourceId: "admin-sale-1",
    requestedBy: "admin-1",
    getDocument: store.getDocument,
    createDocument: store.createDocument,
  });

  assert.equal(result.created, true);
  assert.equal(result.invoice.sourceType, "admin_quick_sale");
});

test("vendedor sólo puede pedir factura de su propia venta; administración puede hacerlo", () => {
  assert.equal(canRequestInvoiceForSale({
    sourceType: "seller_sale",
    sale,
    session: { uid: "seller-1", profile: { role: "seller" } },
  }), true);

  assert.equal(canRequestInvoiceForSale({
    sourceType: "seller_sale",
    sale,
    session: { uid: "seller-2", profile: { role: "seller" } },
  }), false);

  assert.equal(canRequestInvoiceForSale({
    sourceType: "admin_quick_sale",
    sale,
    session: { uid: "admin-1", profile: { role: "admin" } },
  }), true);
});
