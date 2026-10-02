import test from "node:test";
import assert from "node:assert/strict";

import {
  canRequestInvoiceForSale,
  claimPendingInvoice,
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
    async patchDocument(path, data, { currentUpdateTime } = {}) {
      const current = documents.get(path);
      if (!current || (currentUpdateTime && current.updateTime !== currentUpdateTime)) {
        const error = new Error("precondition");
        error.code = "firebase-admin-precondition-failed";
        error.status = 412;
        throw error;
      }
      const next = {
        path,
        data: { ...current.data, ...structuredClone(data) },
        updateTime: "2026-09-28T12:00:02.000Z",
      };
      documents.set(path, next);
      return next;
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
  assert.equal(first.invoiceId, "invoice_homologation_seller_sale_sale-1");
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


test("claim exclusivo cambia pending a authorizing una sola vez", async () => {
  const store = memoryStore({
    "invoices/invoice_seller_sale_sale-1": {
      sourceType: "seller_sale",
      sourceId: "sale-1",
      status: "pending",
      authorization: {
        pointOfSale: null,
        voucherType: null,
        voucherNumber: null,
      },
    },
  });

  const first = await claimPendingInvoice({
    invoiceId: "invoice_seller_sale_sale-1",
    claimedBy: "worker-1",
    now: new Date("2026-09-28T13:00:00.000Z"),
    getDocument: store.getDocument,
    patchDocument: store.patchDocument,
  });

  const second = await claimPendingInvoice({
    invoiceId: "invoice_seller_sale_sale-1",
    claimedBy: "worker-2",
    now: new Date("2026-09-28T13:00:01.000Z"),
    getDocument: store.getDocument,
    patchDocument: store.patchDocument,
  });

  assert.equal(first.claimed, true);
  assert.equal(first.invoice.status, "authorizing");
  assert.equal(first.invoice.authorization.claimedBy, "worker-1");
  assert.equal(second.claimed, false);
  assert.equal(second.reason, "status-authorizing");
});

test("claim pierde limpiamente ante una precondición concurrente", async () => {
  const store = memoryStore({
    "invoices/invoice_seller_sale_sale-2": {
      sourceType: "seller_sale",
      sourceId: "sale-2",
      status: "pending",
      authorization: {},
    },
  });

  const racingPatch = async (path, data, options) => {
    const current = store.documents.get(path);
    store.documents.set(path, {
      ...current,
      data: { ...current.data, status: "authorizing" },
      updateTime: "2026-09-28T13:05:01.000Z",
    });
    return store.patchDocument(path, data, options);
  };

  const result = await claimPendingInvoice({
    invoiceId: "invoice_seller_sale_sale-2",
    claimedBy: "worker-loser",
    getDocument: store.getDocument,
    patchDocument: racingPatch,
  });

  assert.equal(result.claimed, false);
  assert.equal(result.reason, "concurrent-claim");
  assert.equal(result.invoice.status, "authorizing");
});


test("misma venta puede tener solicitudes separadas por entorno fiscal", async () => {
  const store = memoryStore({
    "sales/sale-env": sale,
    "products/product-1": {
      name: "Producto",
      arcaVatRate: 21,
      active: true,
      deleted: false,
    },
  });

  const homo = await ensurePendingInvoice({
    sourceType: "seller_sale",
    sourceId: "sale-env",
    requestedBy: "seller-1",
    env: {
      ARCA_ENVIRONMENT: "homologation",
      ARCA_POINT_OF_SALE: "3",
    },
    getDocument: store.getDocument,
    createDocument: store.createDocument,
  });

  const prod = await ensurePendingInvoice({
    sourceType: "seller_sale",
    sourceId: "sale-env",
    requestedBy: "seller-1",
    env: {
      ARCA_ENVIRONMENT: "production",
      ARCA_POINT_OF_SALE: "8",
    },
    getDocument: store.getDocument,
    createDocument: store.createDocument,
  });

  assert.equal(homo.invoiceId, "invoice_homologation_seller_sale_sale-env");
  assert.equal(prod.invoiceId, "invoice_production_seller_sale_sale-env");
  assert.equal(homo.invoice.fiscalEnvironment, "homologation");
  assert.equal(prod.invoice.fiscalEnvironment, "production");
  assert.equal(homo.invoice.pointOfSaleSnapshot, 3);
  assert.equal(prod.invoice.pointOfSaleSnapshot, 8);
});

test("homologación reutiliza factura legacy, producción no la adopta", async () => {
  const store = memoryStore({
    "sales/sale-legacy": sale,
    "products/product-1": { name: "Producto", arcaVatRate: 21 },
    "invoices/invoice_seller_sale_sale-legacy": {
      sourceType: "seller_sale",
      sourceId: "sale-legacy",
      status: "authorized",
    },
  });

  const homo = await ensurePendingInvoice({
    sourceType: "seller_sale",
    sourceId: "sale-legacy",
    requestedBy: "seller-1",
    env: { ARCA_ENVIRONMENT: "homologation" },
    getDocument: store.getDocument,
    createDocument: store.createDocument,
  });

  const prod = await ensurePendingInvoice({
    sourceType: "seller_sale",
    sourceId: "sale-legacy",
    requestedBy: "seller-1",
    env: { ARCA_ENVIRONMENT: "production" },
    getDocument: store.getDocument,
    createDocument: store.createDocument,
  });

  assert.equal(homo.invoiceId, "invoice_seller_sale_sale-legacy");
  assert.equal(homo.legacy, true);
  assert.equal(prod.invoiceId, "invoice_production_seller_sale_sale-legacy");
  assert.equal(prod.created, true);
});


test("Venta Rápida desde depósito conserva entrada fiscal existente sin ubicación ficticia ni ingreso adicional", async () => {
  const warehouseSale = { ...sale, sourceType: "admin_quick_sale", sourceChannel: "whatsapp", invoiceStatus: "pending", locationId: null, locationName: null, stockOriginType: "warehouse", stockOriginId: "central", stockOriginName: "Depósito central", warehouseId: "central" };
  const store = memoryStore({ "sales/warehouse-sale": warehouseSale, "products/product-1": { name: "Producto", arcaVatRate: 21, active: true } });
  const args = { sourceType: "admin_quick_sale", sourceId: "warehouse-sale", requestedBy: "admin", getDocument: store.getDocument, createDocument: store.createDocument };
  const first = await ensurePendingInvoice(args);
  const retry = await ensurePendingInvoice(args);
  assert.equal(first.invoiceId, retry.invoiceId);
  assert.equal(first.invoice.saleSnapshot.locationId, null);
  assert.equal(first.invoice.saleSnapshot.total, warehouseSale.total);
  assert.equal(store.documents.get("sales/warehouse-sale").data.total, warehouseSale.total);
  assert.equal([...store.documents.keys()].filter(key => key.startsWith("financialEntries/")).length, 0);
  assert.equal([...store.documents.keys()].filter(key => key.startsWith("invoices/")).length, 1);
});
