import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  authoritativeUnitPrice,
  normalizeCheckoutItems,
  prepareAuthoritativeCheckout,
} from "../netlify/functions/_lib/ecommerce/commerceDomain.mjs";
import {
  createEcommerceOrder,
  loadEcommerceCatalog,
} from "../netlify/functions/_lib/ecommerce/commerceService.mjs";

const baseEnv = {
  ECOMMERCE_LOCATION_ID: "loc-web",
  ECOMMERCE_PICKUP_ENABLED: "true",
  ECOMMERCE_LOCAL_TEST_MODE: "false",
  ECOMMERCE_ALLOW_SIMULATED_PAYMENTS: "false",
};

const product = {
  id: "product-1",
  name: "Aceite",
  abbreviation: "AOVE",
  categoryId: "olive_oil",
  categoryName: "Aceites",
  defaultPrice: 22000,
  arcaVatRate: 21,
  active: true,
  deleted: false,
};

const stock = {
  id: "product-1",
  productId: "product-1",
  currentStock: 5,
  priceMode: "default",
  active: true,
  deleted: false,
};

const customer = {
  fullName: "Cliente Demo",
  email: "cliente@example.com",
  phone: "11 5555 5555",
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function memoryAdapter(seed = {}) {
  const documents = new Map(
    Object.entries(seed).map(([path, data]) => [
      path,
      {
        path,
        data: clone(data),
        updateTime: data.__updateTime || "2026-10-01T12:00:00.000Z",
      },
    ]),
  );
  const commits = [];

  return {
    documents,
    commits,
    async getDocument(path) {
      return documents.get(path) || null;
    },
    async listDocuments(collectionPath) {
      const prefix = `${collectionPath}/`;
      return [...documents.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
        .map(([path, entry]) => ({
          id: path.slice(prefix.length),
          ...clone(entry.data),
          __updateTime: entry.updateTime,
        }));
    },
    async commitDocuments(operations) {
      commits.push(clone(operations));
      const next = new Map(documents);
      for (const operation of operations) {
        if (operation.type === "create") {
          if (next.has(operation.path)) {
            const error = new Error("exists");
            error.code = "firebase-admin-already-exists";
            throw error;
          }
          next.set(operation.path, {
            path: operation.path,
            data: clone(operation.data),
            updateTime: "2026-10-01T12:00:01.000Z",
          });
        } else if (operation.type === "update") {
          const current = next.get(operation.path);
          if (!current) throw new Error("missing update");
          if (operation.currentUpdateTime && operation.currentUpdateTime !== current.updateTime) {
            const error = new Error("precondition");
            error.code = "firebase-admin-precondition-failed";
            throw error;
          }
          next.set(operation.path, {
            path: operation.path,
            data: { ...current.data, ...clone(operation.data) },
            updateTime: "2026-10-01T12:00:01.000Z",
          });
        }
      }
      documents.clear();
      for (const [key, value] of next) documents.set(key, value);
      return { writeResults: operations.map(() => ({})) };
    },
  };
}

test("catálogo sin ubicación Ecommerce no inventa precio ni stock", async () => {
  const adapter = memoryAdapter({
    "products/product-1": product,
  });
  const catalog = await loadEcommerceCatalog({
    env: { ECOMMERCE_PICKUP_ENABLED: "false" },
    listDocuments: adapter.listDocuments,
    getDocument: adapter.getDocument,
  });

  assert.equal(catalog.ready, false);
  assert.deepEqual(catalog.pending, ["ECOMMERCE_LOCATION_ID"]);
  assert.equal(catalog.products[0].id, "product-1");
  assert.equal(catalog.products[0].price, null);
  assert.equal(catalog.products[0].stock, null);
  assert.equal(catalog.products[0].commercialReady, false);
});

test("catálogo usa products como maestro y locationStock para precio/stock efectivo", async () => {
  const adapter = memoryAdapter({
    "products/product-1": product,
    "locations/loc-web": { name: "Web", active: true, deleted: false },
    "locationStock/loc-web/items/product-1": {
      ...stock,
      priceMode: "custom",
      priceOverride: 19900,
    },
  });
  const catalog = await loadEcommerceCatalog({
    env: baseEnv,
    listDocuments: adapter.listDocuments,
    getDocument: adapter.getDocument,
  });
  assert.equal(catalog.ready, true);
  assert.equal(catalog.location.id, "loc-web");
  assert.equal(catalog.products[0].price, 19900);
  assert.equal(catalog.products[0].stock, 5);
  assert.equal(catalog.products[0].arcaVatRate, 21);
  assert.equal(catalog.products[0].commercialReady, true);
});

test("precio legacy local se conserva como autoritativo y no se reemplaza silenciosamente", () => {
  assert.equal(authoritativeUnitPrice(product, {
    ...stock,
    priceMode: undefined,
    price: 18000,
  }), 18000);
});

test("cantidades negativas, decimales y excesivas son rechazadas", () => {
  assert.throws(() => normalizeCheckoutItems([{ productId: "product-1", quantity: -1 }]), (error) => error.code === "ecommerce-quantity-invalid");
  assert.throws(() => normalizeCheckoutItems([{ productId: "product-1", quantity: 1.5 }]), (error) => error.code === "ecommerce-quantity-invalid");
  assert.throws(() => normalizeCheckoutItems([{ productId: "product-1", quantity: 100 }]), (error) => error.code === "ecommerce-quantity-excessive");
});

test("total se recalcula desde fuente autoritativa e ignora precio/total del cliente", () => {
  const result = prepareAuthoritativeCheckout({
    requestedItems: [{
      productId: "product-1",
      quantity: 2,
      unitPrice: 1,
      price: 1,
      subtotal: 2,
      total: 2,
    }],
    productsById: { "product-1": product },
    stocksById: { "product-1": stock },
    customer,
    shipping: { method: "pickup" },
    paymentMode: "pending",
    env: baseEnv,
  });

  assert.equal(result.items[0].unitPrice, 22000);
  assert.equal(result.items[0].subtotal, 44000);
  assert.equal(result.subtotal, 44000);
  assert.equal(result.total, 44000);
  assert.equal(result.discountTotal, 0);
});

test("producto inexistente, inactivo, eliminado o sin stock falla", () => {
  const common = {
    requestedItems: [{ productId: "product-1", quantity: 1 }],
    customer,
    shipping: { method: "pickup" },
    env: baseEnv,
  };
  assert.throws(
    () => prepareAuthoritativeCheckout({ ...common, productsById: {}, stocksById: { "product-1": stock } }),
    (error) => error.code === "ecommerce-product-not-found",
  );
  assert.throws(
    () => prepareAuthoritativeCheckout({
      ...common,
      productsById: { "product-1": { ...product, active: false } },
      stocksById: { "product-1": stock },
    }),
    (error) => error.code === "ecommerce-product-inactive",
  );
  assert.throws(
    () => prepareAuthoritativeCheckout({
      ...common,
      productsById: { "product-1": { ...product, deleted: true } },
      stocksById: { "product-1": stock },
    }),
    (error) => error.code === "ecommerce-product-deleted",
  );
  assert.throws(
    () => prepareAuthoritativeCheckout({
      ...common,
      requestedItems: [{ productId: "product-1", quantity: 6 }],
      productsById: { "product-1": product },
      stocksById: { "product-1": stock },
    }),
    (error) => error.code === "ecommerce-stock-insufficient",
  );
});

test("pedido pending persiste Order + Payment sin Sale, stock ni Invoice", async () => {
  const adapter = memoryAdapter({
    "products/product-1": product,
    "locations/loc-web": { name: "Web", active: true, deleted: false },
    "locationStock/loc-web/items/product-1": stock,
  });

  const result = await createEcommerceOrder({
    body: {
      requestId: "request_pending_001",
      items: [{ productId: "product-1", quantity: 2, price: 1 }],
      customer,
      deliveryMethod: "pickup",
      paymentMode: "pending",
      total: 1,
    },
    env: baseEnv,
    now: new Date("2026-10-01T12:00:00.000Z"),
    getDocument: adapter.getDocument,
    commitDocuments: adapter.commitDocuments,
  });

  assert.equal(result.created, true);
  assert.equal(result.order.sourceType, "ecommerce");
  assert.equal(result.order.paymentStatus, "pending");
  assert.equal(result.order.invoiceStatus, "not_requested");
  assert.equal(result.order.total, 44000);
  assert.equal(result.order.saleId, null);
  assert.equal(adapter.documents.has("orders/ecommerce_order_request_pending_001"), true);
  assert.equal(adapter.documents.has("payments/ecommerce_payment_request_pending_001"), true);
  assert.equal(adapter.documents.has("sales/ecommerce_sale_request_pending_001"), false);
  assert.equal(adapter.documents.get("locationStock/loc-web/items/product-1").data.currentStock, 5);
  assert.equal([...adapter.documents.keys()].some((path) => path.startsWith("invoices/")), false);
});

test("simulated_approved sólo en modo local crea Sale y descuenta stock atómicamente", async () => {
  const adapter = memoryAdapter({
    "products/product-1": product,
    "locations/loc-web": { name: "Web", active: true, deleted: false },
    "locationStock/loc-web/items/product-1": stock,
  });
  const env = {
    ...baseEnv,
    ECOMMERCE_LOCAL_TEST_MODE: "true",
    ECOMMERCE_ALLOW_SIMULATED_PAYMENTS: "true",
  };

  const result = await createEcommerceOrder({
    body: {
      requestId: "request_approved_001",
      items: [{ productId: "product-1", quantity: 2 }],
      customer,
      deliveryMethod: "pickup",
      paymentMode: "simulate_approved",
    },
    env,
    now: new Date("2026-10-01T12:00:00.000Z"),
    getDocument: adapter.getDocument,
    commitDocuments: adapter.commitDocuments,
  });

  assert.equal(result.order.paymentStatus, "simulated_approved");
  assert.equal(result.order.saleId, "ecommerce_sale_request_approved_001");
  assert.equal(adapter.documents.has("sales/ecommerce_sale_request_approved_001"), true);
  assert.equal(adapter.documents.get("locationStock/loc-web/items/product-1").data.currentStock, 3);
  assert.equal(
    adapter.documents.get("sales/ecommerce_sale_request_approved_001").data.invoiceStatus,
    "not_requested",
  );
  assert.equal([...adapter.documents.keys()].some((path) => path.startsWith("invoices/")), false);
});

test("requestId vuelve idempotente un retry de checkout", async () => {
  const adapter = memoryAdapter({
    "products/product-1": product,
    "locations/loc-web": { name: "Web", active: true, deleted: false },
    "locationStock/loc-web/items/product-1": stock,
  });
  const body = {
    requestId: "request_retry_001",
    items: [{ productId: "product-1", quantity: 1 }],
    customer,
    deliveryMethod: "pickup",
    paymentMode: "pending",
  };

  const first = await createEcommerceOrder({
    body,
    env: baseEnv,
    getDocument: adapter.getDocument,
    commitDocuments: adapter.commitDocuments,
  });
  const second = await createEcommerceOrder({
    body,
    env: baseEnv,
    getDocument: adapter.getDocument,
    commitDocuments: adapter.commitDocuments,
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.idempotent, true);
  assert.equal(second.order.id, first.order.id);
  assert.equal(adapter.commits.length, 1);
});

test("Ecommerce Etapa 5 no importa ni llama emisión ARCA", async () => {
  const files = await Promise.all([
    readFile(new URL("../netlify/functions/ecommerce-checkout.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/_lib/ecommerce/commerceService.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/services/ecommerceService.js", import.meta.url), "utf8"),
  ]);
  const source = files.join("\n");
  assert.doesNotMatch(source, /FECAESolicitar|requestCae|authorizeInvoice|arca-authorize|requestPendingArcaInvoice/);
  assert.doesNotMatch(source, /ARCA_AUTO_AUTHORIZE_PRODUCTION_SOURCES/);
});
