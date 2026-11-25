import test from "node:test";
import assert from "node:assert/strict";
import {
  memoryStore,
  admin,
  preparer,
  session,
  now,
} from "./helpers/shippingFixtures.mjs";
import {
  createEcommerceOrder,
  loadDeliveryQuoteCart,
  loadEcommerceCatalog,
} from "../netlify/functions/_lib/ecommerce/commerceService.mjs";
import { confirmEcommercePayment } from "../netlify/functions/_lib/ecommerce/paymentService.mjs";
import {
  configureWebChannel,
  manageWebOrder,
} from "../netlify/functions/_lib/ecommerce/orderManagement.mjs";
import {
  shippingOperation,
  createCourierSession,
} from "../netlify/functions/_lib/shipping.mjs";
import {
  channelShipping,
  normalizeBilling,
} from "../netlify/functions/_lib/ecommerce/channelService.mjs";
import { summarizeSales } from "../src/modules/locations/domain/saleFacts.js";
import { calculateMetrics } from "../src/modules/locations/domain/metrics.js";
import { prepareEcommerceInvoiceFiscal } from "../netlify/functions/_lib/ecommerce/fiscalService.mjs";
import {
  ensurePendingInvoice,
  syncInvoiceToSale,
} from "../netlify/functions/_lib/arca/invoicePersistence.mjs";
import { localFirebaseEmulator } from "../netlify/functions/_lib/firebaseEmulator.mjs";
import { adminListDocuments } from "../netlify/functions/_lib/firestoreAdminRest.mjs";
import { reservedStockQuantity } from "../src/shared/stockReservations.mjs";
import { buildOperationalSalePlan } from "../src/shared/operationalWritePlans.mjs";
import { buildStockTransferWrites } from "../src/shared/stockTransferWritePlans.mjs";
import { publicAddressOption, quoteSelectedDelivery } from "../netlify/functions/_lib/ecommerce/deliveryQuote.mjs";

const env = {
  NODE_ENV: "test",
  CONTEXT: "dev",
  ECOMMERCE_SIMULATED_PAYMENT_ENABLED: "true",
  ARCA_ENVIRONMENT: "homologation",
  ARCA_ISSUER_VAT_CONDITION: "responsable_inscripto",
  ARCA_POINT_OF_SALE: "3",
  ARCA_ISSUER_CUIT: "20123456786",
  SHIPPING_REPOSITORY_ADDRESS: "Repositorio ficticio 123",
};
const channel = {
  active: true,
  authorizedOrigins: [
    { type: "location", id: "valle" },
    { type: "warehouse", id: "infal" },
    { type: "location", id: "other" },
  ],
  defaultOrigin: { type: "location", id: "valle" },
  pickup: {
    enabled: true,
    locationId: "valle",
    name: "Local QA",
    address: "Calle ficticia 123",
  },
  delivery: {
    enabled: true,
    rates: [
      {
        id: "caba",
        name: "CABA QA",
        province: "CABA",
        postalCodes: ["1000"],
        amount: 500,
        arcaVatRate: 21,
      },
    ],
  },
};
function setup() {
  const db = memoryStore();
  for(const [path,data] of db.documents) db.documents.set(path,structuredClone(data));
  db.documents.set("channels/ecommerce", structuredClone(channel));
  db.documents.set("locations/other", { name: "Otro local QA", active: true });
  db.documents.get("products/oil").arcaVatRate = 21;
  db.documents.set("locationStock/other/items/oil", {
    productId: "oil",
    active: true,
    currentStock: 4,
    price: 1000,
  });
  const getDocument = async (path) =>
    db.documents.has(path)
      ? { data: structuredClone(db.documents.get(path)) }
      : null;
  const listDocuments = async (path) =>
    [...db.documents]
      .filter(
        ([key]) =>
          key.startsWith(path + "/") &&
          key.split("/").length === path.split("/").length + 1,
      )
      .map(([key, value]) => ({
        ...structuredClone(value),
        id: key.split("/").at(-1),
      }));
  const createDocument = async (collection, id, data) =>
    db
      .runTransaction((tx) =>
        tx.commitDocuments([
          { type: "create", path: `${collection}/${id}`, data },
        ]),
      )
      .then(() => getDocument(`${collection}/${id}`));
  const patchDocument = async (path, data) =>
    db
      .runTransaction((tx) =>
        tx.commitDocuments([{ type: "update", path, data }]),
      )
      .then(() => getDocument(path));
  return { ...db, getDocument, listDocuments, createDocument, patchDocument };
}
const request = (requestId = "web_order_0001", extra = {}) => ({
  requestId,
  accessToken: "a".repeat(48),
  items: [{ productId: "oil", quantity: 2 }],
  customer: {
    fullName: "Cliente QA",
    email: "qa@example.invalid",
    phone: "+54 9 11 2345-6789",
  },
  deliveryMethod: "delivery",
  shipping: {
    rateId: "caba",
    address: {
      street: "Calle de prueba",
      number: "123",
      city: "CABA",
      province: "CABA",
      postalCode: "1000",
    },
  },
  ...extra,
});
const checkout = (db, body = request()) =>
  db.runTransaction((tx) => createEcommerceOrder({ body, env, now, ...tx }));
const approve = (db, order) =>
  db.runTransaction((tx) =>
    confirmEcommercePayment({
      orderId: order.id,
      idempotencyKey: order.requestId,
      provider: "simulation",
      status: "approved",
      reference: `simulation:${order.id}`,
      actor: { uid: admin.id, role: "admin" },
      env,
      now,
      ...tx,
    }),
  );
const manage = (db, order, body) =>
  manageWebOrder({
    body: {
      orderId: order.id,
      requestId: crypto.randomUUID(),
      reason: "Prueba sintética",
      ...body,
    },
    session: session(admin),
    env,
    now,
    runTransaction: db.runTransaction,
  });
const shipping = (db, order, mode, body = {}) =>
  shippingOperation({
    body: {
      shipmentId: order.shipmentId,
      requestId: crypto.randomUUID(),
      mode,
      ...body,
    },
    session: session(admin),
    env,
    now,
    runTransaction: db.runTransaction,
  });
const rows = (db, path) =>
  [...db.documents]
    .filter(
      ([key]) => key.startsWith(path + "/") && key.split("/").length === 2,
    )
    .map(([key, value]) => ({ ...value, id: key.split("/")[1] }));

test("canal web reserva sin salida, vincula CRM sin compra y publica disponibilidad de un origen", async () => {
  const db = setup(),
    { order } = await checkout(db);
  assert.equal(order.total, 2500);
  assert.equal(order.channelId, "ecommerce");
  assert.equal(order.stockOriginId, null);
  assert.equal(order.items[0].reservationAllocations, undefined);
  assert.equal(rows(db, "sales").length, 0);
  const stock = db.documents.get("locationStock/valle/items/oil");
  assert.equal(stock.currentStock, 10);
  assert.equal(reservedStockQuantity(stock, now), 2);
  const crm = rows(db, "customers")[0];
  assert.equal(crm.lastPurchaseAt, undefined);
  assert.equal(crm.lastOrderId, order.id);
  const catalog = await loadEcommerceCatalog({
    env,
    now,
    getDocument: db.getDocument,
    listDocuments: db.listDocuments,
  });
  assert.equal(catalog.config.deliveryEnabled, true);
  assert.equal(catalog.products[0].stock, null);
  assert.equal(catalog.products[0].stockState, "available");
  assert.equal(reservedStockQuantity(stock, now), 2);
  assert.equal(catalog.location.id, "valle");
});
test("reservas serializadas impiden dos compras del último producto y replay no reserva dos veces", async () => {
  const db = setup();
  db.documents.get("locationStock/valle/items/oil").currentStock = 2;
  // This scenario intentionally has exactly one physical source with stock.
  db.documents.get("warehouseStock/infal/items/oil").currentStock = 0;
  db.documents.get("locationStock/other/items/oil").currentStock = 0;
  const attempts = await Promise.allSettled([
    checkout(db, request("last_item_0001")),
    checkout(db, request("last_item_0002")),
  ]);
  assert.equal(attempts.filter((row) => row.status === "fulfilled").length, 1);
  const first = attempts.find((row) => row.status === "fulfilled").value.order;
  assert.equal((await checkout(db, request(first.requestId))).idempotent, true);
  assert.equal(
    reservedStockQuantity(
      db.documents.get("locationStock/valle/items/oil"),
      now,
    ),
    2,
  );
});
test("el total usa todos los orígenes activos y queda agotado aunque el stock físico siga reservado", async () => {
  const db = setup();
  db.documents.set("channels/ecommerce", {
    ...channel,
    stockScope: "all_active",
    authorizedOrigins: [],
    excludedOrigins: [{ type: "location", id: "other" }],
  });
  const shopPath = "locationStock/valle/items/oil";
  const warehousePath = "warehouseStock/infal/items/oil";
  const fairPath = "locationStock/feria/items/oil";
  Object.assign(db.documents.get(shopPath), { currentStock: 1, priceMode: "custom", priceOverride: 1900 });
  db.documents.get(warehousePath).currentStock = 1;
  db.documents.set("locations/future", { name: "Próximo evento QA", type: "event", active: true, scheduleStartAt: "2026-10-17T13:00:00Z" });
  db.documents.set("locationStock/future/items/oil", { currentStock: 100, active: true });
  db.documents.set("warehouses/closed", { name: "Depósito inactivo QA", active: false });
  db.documents.set("warehouseStock/closed/items/oil", { currentStock: 100, active: true });
  const purchase = request("all_stock_0001", { items: [{ productId: "oil", quantity: 3 }] });

  await assert.rejects(() => checkout(db, purchase), (error) => error.code === "ecommerce-stock-insufficient");
  db.documents.set("locations/feria", { name: "Feria activa QA", type: "fair", active: true });
  db.documents.set(fairPath, { currentStock: 1, active: true });
  const { order } = await checkout(db, purchase);
  assert.equal(order.total, 3500);
  assert.equal(order.items[0].stockAllocations, undefined);
  for (const path of [shopPath, warehousePath, fairPath]) {
    const stock = db.documents.get(path);
    assert.equal(stock.currentStock, 1);
    assert.equal(stock.reservedQuantity, 1);
    assert.equal(stock.ecommerceReservationsExpireAt.toISOString(), "2026-10-16T15:15:00.000Z");
  }
  const catalog = await loadEcommerceCatalog({ env, now, getDocument: db.getDocument, listDocuments: db.listDocuments });
  assert.equal(catalog.products[0].stockState, "out");
  assert.equal(catalog.products[0].stock, null);

  const [paid] = await Promise.all([approve(db, order), approve(db, order)]);
  const afterCheckoutExpiry = new Date(now.valueOf() + 2 * 3600000);
  for (const path of [shopPath, warehousePath, fairPath]) {
    assert.equal(db.documents.get(path).currentStock, 1);
    assert.equal(reservedStockQuantity(db.documents.get(path), afterCheckoutExpiry), 1);
  }
  const after = await loadEcommerceCatalog({ env, now: afterCheckoutExpiry, getDocument: db.getDocument, listDocuments: db.listDocuments });
  assert.equal(after.products[0].stockState, "out");
  assert.equal(db.documents.get("warehouses/closed").active, false);
  assert.equal(db.documents.get("locationStock/other/items/oil").currentStock, 4);
  assert.equal(rows(db, "sales").length, 1);
  assert.equal(rows(db, "shipments")[0].status, "solicitud_pendiente");
  await assert.rejects(() => shipping(db, paid.order, "approve", { originType: "location", originId: "valle" }), /unidades físicas suficientes/);
  assert.equal(rows(db, "stockMovements").length, 0);
});

test("Gestión elige local o depósito aun con todo el stock reservado y no lo descuenta dos veces", async () => {
  const db = setup();
  const shop = "locationStock/valle/items/oil";
  const depot = "warehouseStock/infal/items/oil";
  db.documents.get(shop).currentStock = 2;
  db.documents.get(depot).currentStock = 2;
  db.documents.get("locationStock/other/items/oil").currentStock = 0;
  const { order: pending } = await checkout(db, request("reservado_primero"));
  const { order: second } = await checkout(db, request("reservado_segundo"));
  const { order: paid } = await approve(db, second);
  assert.equal(db.documents.get(depot).ecommerceReservations[second.id].quantity, 2);
  await assert.rejects(() => checkout(db, request("tercero_sin_stock")), { code: "ecommerce-stock-insufficient" });

  await shipping(db, paid, "approve", { originType: "location", originId: "valle" });
  assert.equal(db.documents.get(shop).currentStock, 0);
  assert.equal(db.documents.get(depot).currentStock, 2);
  assert.equal(db.documents.get(depot).ecommerceReservations[pending.id].quantity, 2);
  assert.equal(db.documents.get("orders/" + pending.id).items[0].reservationAllocations[0].id, "infal");
  assert.equal(rows(db, "stockMovements")[0].inventoryId, "valle");
  assert.equal(db.documents.get("orders/" + second.id).reservationStatus, "consumed");
  assert.equal(db.documents.get("shipments/" + paid.shipmentId).itemsSnapshot[0].stockAllocations[0].id, "valle");

  const { order: firstPaid } = await approve(db, pending);
  const catalog = await loadEcommerceCatalog({ env, now, getDocument: db.getDocument, listDocuments: db.listDocuments });
  assert.equal(catalog.products[0].stockState, "out");
  await shipping(db, firstPaid, "approve", { originType: "warehouse", originId: "infal" });
  assert.equal(db.documents.get(depot).currentStock, 0);
  assert.equal(db.documents.get(depot).reservedQuantity, 0);
  assert.equal(rows(db, "stockMovements").length, 2);
  assert.equal(rows(db, "sales").length, 2);
  assert.equal(db.documents.get("sales/" + firstPaid.saleId).stockOriginId, "infal");
});

test("Venta Rápida, vendedor y transferencias respetan la última unidad web con timestamps de Firestore", () => {
  const expiresAt = { toMillis: () => +now + 60000 };
  const stock = {
    currentStock: 1, active: true, ecommerceReservations: { order: { quantity: 1, expiresAt } },
  };
  const product = { id: "oil", name: "Aceite QA", defaultPrice: 1000 };
  const item = { productId: product.id, name: product.name, qty: 1 };
  const plan = {
    profile: admin, location: { id: "valle", name: "Local QA" }, items: [item],
    stocks: [stock], saleId: "sale-qa", movementIds: ["movement-qa"],
    dateKey: "2026-10-16", prefix: "QA", stamp: now,
  };
  assert.throws(() => buildOperationalSalePlan({ ...plan, quickSaleProducts: [product] }), /reservadas para pedidos web/);
  assert.throws(() => buildOperationalSalePlan(plan), /reservadas para pedidos web/);
  assert.throws(() => buildStockTransferWrites({
    prepared: [{ originStock: stock, quantity: 1, product }],
    origin: { id: "valle", name: "Local QA" }, destination: { id: "infal", name: "Depósito QA" },
    profile: admin, transferId: "transfer-qa", stamp: now,
  }), /reservadas para pedidos web/);
  assert.equal(reservedStockQuantity(stock, new Date(+now + 60001)), 0);
});

test("pago concurrente registra una venta y origen concurrente imputa una sola salida", async () => {
  const db = setup(),
    { order } = await checkout(db);
  const [paid] = await Promise.all([approve(db, order), approve(db, order)]);
  assert.equal(rows(db, "sales").length, 1);
  assert.equal(rows(db, "stockMovements").length, 0);
  const choice = { originType: "location", originId: "valle", requestId: "origin_confirm_qa" };
  await Promise.all([shipping(db, paid.order, "approve", choice), shipping(db, paid.order, "approve", choice)]);
  assert.equal(rows(db, "stockMovements").length, 1);
  assert.equal(rows(db, "shipments")[0].stockOriginId, "valle");
  assert.equal(rows(db, "sales")[0].stockOriginId, "valle");
  assert.equal(rows(db, "shipments").length, 1);
  assert.equal(
    db.documents.get("locationStock/valle/items/oil").currentStock,
    8,
  );
  assert.equal(
    reservedStockQuantity(
      db.documents.get("locationStock/valle/items/oil"),
      now,
    ),
    0,
  );
  assert.equal(summarizeSales(rows(db, "sales")).total, 0);
  assert.equal(rows(db, "shipments")[0].deliveryType, "repository");
  assert.equal(rows(db, "shipments")[0].assignedPreparerIds.length, 0);
  assert.ok(rows(db, "alerts").length > 0);
});
test("un pedido anterior conserva la reasignación de su reserva y del stock ya descontado", async () => {
  const db = setup(),
    { order } = await checkout(db);
  const legacy = db.documents.get("orders/" + order.id);
  delete legacy.stockCommitMode;
  delete legacy.pricingOrigin;
  Object.assign(legacy, { stockOriginType: "location", stockOriginId: "valle", stockOriginName: "Local QA",
    locationId: "valle", locationName: "Local QA" });
  legacy.items = legacy.items.map(({ reservationAllocations, ...item }) => ({ ...item, stockAllocations: reservationAllocations }));
  delete db.documents.get("locationStock/valle/items/oil").ecommerceReservations[order.id].pooled;
  await manage(db, order, {
    mode: "origin",
    origin: { type: "warehouse", id: "infal" },
  });
  assert.equal(
    reservedStockQuantity(
      db.documents.get("locationStock/valle/items/oil"),
      now,
    ),
    0,
  );
  assert.equal(
    reservedStockQuantity(
      db.documents.get("warehouseStock/infal/items/oil"),
      now,
    ),
    2,
  );
  await approve(db, order);
  assert.equal(
    db.documents.get("warehouseStock/infal/items/oil").currentStock,
    18,
  );
  const sale = rows(db, "sales")[0];
  await manage(db, order, {
    mode: "origin",
    origin: { type: "location", id: "other" },
  });
  assert.equal(
    db.documents.get("warehouseStock/infal/items/oil").currentStock,
    20,
  );
  assert.equal(
    db.documents.get("locationStock/other/items/oil").currentStock,
    2,
  );
  assert.equal(rows(db, "sales")[0].stockOriginId, sale.stockOriginId);
  assert.equal(rows(db, "stockMovements").length, 3);
  assert.equal(db.documents.get(`orders/${order.id}`).originHistory.length, 2);
});
test("origen insuficiente, reserva vencida y cancelación son coherentes", async () => {
  const db = setup(),
    { order } = await checkout(db);
  db.documents.get("locationStock/other/items/oil").currentStock = 1;
  await assert.rejects(() =>
    manage(db, order, {
      mode: "origin",
      origin: { type: "location", id: "other" },
    }),
  );
  await assert.rejects(
    () =>
      db.runTransaction((tx) =>
        confirmEcommercePayment({
          orderId: order.id,
          idempotencyKey: order.requestId,
          provider: "simulation",
          status: "approved",
          reference: "expired",
          actor: { uid: admin.id, role: "admin" },
          env,
          now: new Date(now.valueOf() + 16 * 60000),
          ...tx,
        }),
      ),
    (e) => e.code === "ecommerce-reservation-expired",
  );
  await manage(db, order, { mode: "cancel" });
  assert.equal(
    reservedStockQuantity(
      db.documents.get("locationStock/valle/items/oil"),
      now,
    ),
    0,
  );
  await assert.rejects(() => approve(db, order));
  assert.equal(rows(db, "sales").length, 0);
});
for (const transport of ["repository", "uber", "manual"])
  test(`logística ${transport}: reutiliza asignación, preparación y credenciales; sin segunda venta`, async () => {
    const db = setup(),
      { order } = await checkout(db);
    await approve(db, order);
    const stored = db.documents.get(`orders/${order.id}`);
    Object.assign(order, stored);
    await shipping(db, order, "approve", { originType: "location", originId: "valle" });
    await shipping(db, order, "assign", {
      assignedPreparerIds: [admin.id],
      reason: "Asignación QA",
    });
    await shipping(db, order, "transport", {
      deliveryType: transport,
      reason: "Transporte QA",
    });
    await shipping(db, order, "start_preparing");
    await shipping(db, order, "ready");
    const legs =
      transport === "repository"
        ? [
            ["origin", ["pickup", "repository_receive"]],
            ["final", ["repository_depart", "deliver"]],
          ]
        : [["direct", ["pickup", "deliver"]]];
    for (const [leg, actions] of legs) {
      const token =
        crypto.randomUUID().replaceAll("-", "") +
        crypto.randomUUID().replaceAll("-", "");
      await shipping(db, order, "issue_access", {
        kind: "courier",
        leg,
        newToken: token,
      });
      for (const action of actions)
        await shippingOperation({
          body: {
            token,
            mode: "courier_action",
            action,
            requestId: crypto.randomUUID(),
          },
          env,
          now,
          runTransaction: db.runTransaction,
        });
    }
    assert.equal(
      db.documents.get(`shipments/${order.shipmentId}`).status,
      "entregado",
    );
    assert.equal(db.documents.get(`orders/${order.id}`).status, "completed");
    assert.equal(rows(db, "sales").length, 1);
    assert.equal(rows(db, "stockMovements").length, 1);
  });
test("retiro por cliente usa código y empleado autorizado; no admite repartidor", async () => {
  const db = setup(),
    { order } = await checkout(
      db,
      request("pickup_order_001", { deliveryMethod: "pickup", shipping: {} }),
    );
  await approve(db, order);
  Object.assign(order, db.documents.get(`orders/${order.id}`));
  await assert.rejects(() =>
    shipping(db, order, "issue_access", {
      kind: "courier",
      newToken: "a".repeat(50),
    }),
  );
  await assert.rejects(() =>
    createCourierSession({
      body: {
        shipmentIds: [order.shipmentId],
        leg: "direct",
        sessionId: "courier_qa",
        requestId: "courier_qa",
        newToken: "a".repeat(50),
      },
      session: session(admin),
      env,
      now,
      runTransaction: db.runTransaction,
    }),
  );
  await shipping(db, order, "approve", { originType: "location", originId: "valle" });
  await shipping(db, order, "assign", {
    assignedPreparerIds: [admin.id],
    reason: "Asignación QA",
  });
  await shipping(db, order, "ready");
  await assert.rejects(() =>
    shipping(db, order, "pickup_complete", { pickupCode: "WRONG" }),
  );
  await shipping(db, order, "pickup_complete", {
    pickupCode: order.pickupCode,
  });
  assert.equal(
    db.documents.get(`shipments/${order.shipmentId}`).deliveredBy,
    admin.id,
  );
});
test("envío fiscal incluye servicio con IVA en el motor existente y no añade movimiento físico", async () => {
  const db = setup(),
    { order } = await checkout(db);
  await approve(db, order);
  const result = await prepareEcommerceInvoiceFiscal({
    orderId: order.id,
    idempotencyKey: order.requestId,
    requestedBy: admin.id,
    env,
    now,
    getDocument: db.getDocument,
    patchDocument: db.patchDocument,
    ensureInvoiceFn: (args) =>
      ensurePendingInvoice({ ...args, createDocument: db.createDocument }),
    syncInvoiceFn: syncInvoiceToSale,
  });
  assert.equal(result.fiscal.total, 2500);
  assert.equal(result.fiscal.caeRequested, false);
  assert.equal(rows(db, "invoices")[0].saleSnapshot.items.length, 2);
  assert.equal(rows(db, "stockMovements").length, 0);
  assert.equal(
    db.documents.get(
      `shipments/${db.documents.get(`orders/${order.id}`).shipmentId}`,
    ).invoiceId,
    result.invoiceId,
  );
  await assert.rejects(
    () =>
      ensurePendingInvoice({
        sourceType: "ecommerce",
        sourceId: rows(db, "sales")[0].id,
        env: { ...env, ARCA_ENVIRONMENT: "production" },
        getDocument: db.getDocument,
        createDocument: db.createDocument,
      }),
    (e) => e.code === "ecommerce-simulation-production-fiscal-denied",
  );
});
test("la cotización firmada fija el domicilio y llega al envío con notas separadas", async () => {
  const db = setup();
  const signedEnv = { ...env, ECOMMERCE_DELIVERY_TOKEN_KEY: "q".repeat(43) };
  const configured = db.documents.get("channels/ecommerce");
  configured.delivery.rates[0].zone = "caba";
  const draft = request("web_order_direccion");
  const destination = {
    street: "Calle de prueba", number: "123", city: "Ciudad Autónoma de Buenos Aires",
    municipality: "", province: "CABA", postalCode: "1428", provider: "usig", neighborhood: "Belgrano",
  };
  const { selectionToken } = publicAddressOption(destination, { env: signedEnv, now });
  const cart = await loadDeliveryQuoteCart(draft.items, {
    env: signedEnv, now, getDocument: db.getDocument, listDocuments: db.listDocuments,
  });
  const result = await quoteSelectedDelivery({
    selectionToken, ...cart, env: signedEnv, now, confirm: async () => destination,
  });
  const create = (body, date = now) => db.runTransaction((tx) => createEcommerceOrder({ body, env: signedEnv, now: date, ...tx }));
  await assert.rejects(() => create(draft), { code: "ecommerce-delivery-quote-required" });
  const body = {
    ...draft,
    shipping: {
      quoteToken: result.quote.quoteToken,
      address: { street: "Calle manipulada", postalCode: "9999", floor: "3", apartment: "A", instructions: "Tocar el timbre.", receiverName: "Receptor QA" },
      notes: "Pedido de prueba.",
    },
  };
  await assert.rejects(() => create(body, new Date(now.getTime() + 11 * 60000)), { code: "ecommerce-delivery-quote-stale" });
  await assert.rejects(() => create({ ...body, items: [{ productId: "oil", quantity: 1 }] }), { code: "ecommerce-delivery-quote-stale" });
  const { order } = await create(body);
  assert.equal(order.shipping.address.postalCode, "1428");
  assert.equal(order.shipping.address.street, destination.street);
  assert.equal(order.shippingAmount, 500);
  assert.equal(order.total, 2500);
  assert.equal((await create(body, new Date(now.getTime() + 11 * 60000))).idempotent, true);
  await approve(db, order);
  const shipment = rows(db, "shipments")[0];
  assert.match(shipment.destination.displayAddress, /piso 3, depto\. A/);
  assert.equal(shipment.destination.notes, "Indicaciones para el repartidor: Tocar el timbre. · Notas del pedido: Pedido de prueba. · Recibe: Receptor QA");
  assert.deepEqual(shipment.ecommerceDeliveryRate, { name: "CABA", carrier: "local", amount: 500 });
});

test("datos inválidos, tarifa manipulada y emulador hacia producción se rechazan", () => {
  assert.throws(() =>
    channelShipping({ method: "delivery", address: { street: "A" } }, channel),
  );
  assert.throws(() => normalizeBilling({ mode: "fiscal", cuit: "123" }));
  assert.throws(() =>
    localFirebaseEmulator("firestore", {
      FM_LOCAL_EMULATORS: "true",
      CONTEXT: "production",
      FIREBASE_PROJECT_ID: "app-integral-fm",
    }),
  );
});

test("regresión Chrome: sincronización fiscal lee Order y Shipment antes de un único commit", async () => {
  const documents = new Map([
    [
      "invoices/invoice_qa",
      {
        sourceType: "ecommerce",
        sourceId: "sale_qa",
        status: "pending",
        fiscalEnvironment: "homologation",
      },
    ],
    ["sales/sale_qa", { sourceType: "ecommerce", orderId: "order_qa" }],
    ["orders/order_qa", { saleId: "sale_qa", shipmentId: "shipment_qa" }],
    ["shipments/shipment_qa", { saleId: "sale_qa" }],
  ]);
  let commits = 0,
    written = false;
  await syncInvoiceToSale({
    invoiceId: "invoice_qa",
    runTransaction: async (work) =>
      work({
        getDocument: async (path) => {
          assert.equal(written, false, "No puede leerse después del commit");
          return { data: documents.get(path), updateTime: "revision" };
        },
        commitDocuments: async (operations) => {
          written = true;
          commits++;
          for (const op of operations)
            documents.set(op.path, { ...documents.get(op.path), ...op.data });
        },
      }),
  });
  assert.equal(commits, 1);
  assert.equal(documents.get("orders/order_qa").invoiceId, "invoice_qa");
  assert.equal(documents.get("shipments/shipment_qa").invoiceStatus, "pending");
});
test("regresión Chrome: notificaciones usan runQuery transaccional acotado y con timeout", async () => {
  const localEnv = {
    FM_LOCAL_EMULATORS: "true",
    CONTEXT: "dev",
    FIREBASE_PROJECT_ID: "app-integral-fm-pruebas",
    VITE_PREVIEW_FIREBASE_PROJECT_ID: "app-integral-fm-pruebas",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8186",
  };
  let called = false;
  const users = await adminListDocuments("users", {
    env: localEnv,
    transaction: "transaction-qa",
    maxDocuments: 180,
    fetchImpl: async (url, options) => {
      called = true;
      assert.match(url, /:runQuery$/);
      const body = JSON.parse(options.body);
      assert.equal(body.transaction, "transaction-qa");
      assert.equal(body.structuredQuery.limit, 181);
      assert.ok(options.signal);
      return new Response(
        JSON.stringify([
          {
            document: {
              name: "projects/qa/databases/(default)/documents/users/admin",
              fields: { name: { stringValue: "QA" } },
            },
          },
        ]),
        { status: 200 },
      );
    },
  });
  assert.equal(called, true);
  assert.equal(users[0].id, "admin");
});

test("configuración del canal es idempotente y rechaza reutilizar la clave con otros datos", async () => {
  const db=setup(), body={mode:"configure",requestId:"channel_config_001",channel};
  const configure=next=>configureWebChannel({body:next,session:session(admin),env,now,runTransaction:db.runTransaction});
  const first=await configure(body), replay=await configure(body);
  assert.equal(first.id,replay.id);assert.equal(rows(db,"auditLogs").length,1);
  await assert.rejects(()=>configure({...body,channel:{...channel,defaultTransport:"manual"}}));
});

test("revocación del administrador dentro de la transacción bloquea pago y conserva stock", async () => {
  const db=setup(),{order}=await checkout(db);db.documents.get(`users/${admin.id}`).active=false;
  await assert.rejects(()=>approve(db,order),error=>error.code === "ecommerce-simulation-admin-required");
  assert.equal(rows(db,"sales").length,0);assert.equal(db.documents.get("locationStock/valle/items/oil").currentStock,10);
});

test("métricas excluyen simulaciones también de cancelaciones y suman una sola venta por canal y origen", () => {
  const sale={id:"real",status:"active",sourceChannel:"ecommerce",stockOriginType:"location",stockOriginId:"valle",locationId:"valle",total:1000,createdAt:now,items:[{productId:"oil",name:"QA",qty:1,unitPrice:1000}],payments:[]};
  const metrics=calculateMetrics([sale,sale,{...sale,id:"simulation",paymentProvider:"simulation",paymentStatus:"simulated_approved"}],{period:"day",start:new Date("2026-10-16T00:00:00Z"),end:new Date("2026-10-17T00:00:00Z")});
  assert.equal(metrics.salesCount,1);assert.equal(metrics.total,1000);assert.equal(metrics.cancelled.length,0);assert.equal(metrics.byChannel[0].total,1000);assert.equal(metrics.byStockOrigin[0].total,1000);
});

test("facturación del canal conserva nombre, domicilio y CUIT históricos e ignora reemplazos del cliente",async()=>{
  const db=setup(), billing={mode:"fiscal",cuit:"20123456786",name:"Razón social sintética QA",address:"Domicilio fiscal ficticio 123"};
  assert.throws(()=>normalizeBilling({mode:"fiscal",cuit:billing.cuit}));
  const {order}=await checkout(db,request("fiscal_channel_01",{billing}));await approve(db,order);let lookedUp;
  const result=await prepareEcommerceInvoiceFiscal({orderId:order.id,idempotencyKey:order.requestId,receiverCuit:"20329642330",requestedBy:admin.id,env,now,getDocument:db.getDocument,patchDocument:db.patchDocument,ensureInvoiceFn:args=>ensurePendingInvoice({...args,createDocument:db.createDocument}),syncInvoiceFn:syncInvoiceToSale,getTaxpayerFn:async cuit=>{lookedUp=cuit;return {};},inferReceiverFn:()=>({resolved:true,condition:{id:1}})});
  assert.equal(lookedUp,billing.cuit);assert.equal(result.fiscal.voucherClass,"A");const receiver=rows(db,"invoices")[0].receiverSnapshot;assert.equal(receiver.name,billing.name);assert.equal(receiver.address,billing.address);assert.equal(receiver.documentNumber,billing.cuit);
});

test("NODE_ENV=test nunca habilita simulación con transporte Firestore real hacia producción",async()=>{
  await assert.rejects(()=>confirmEcommercePayment({orderId:"ecommerce_order_production_guard",idempotencyKey:"production_guard",provider:"simulation",status:"approved",reference:"guard",actor:{role:"admin"},env:{NODE_ENV:"test",CONTEXT:"dev",ECOMMERCE_SIMULATED_PAYMENT_ENABLED:"true",FIREBASE_PROJECT_ID:"app-integral-fm",ARCA_ENVIRONMENT:"homologation"}}),error=>error.code === "ecommerce-simulation-isolation-required");
});
