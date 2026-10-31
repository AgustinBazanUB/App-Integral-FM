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
  assert.equal(order.stockOriginId, "valle");
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
  assert.equal(catalog.products[0].stock, 8);
  assert.equal(catalog.location.id, "valle");
});
test("reservas serializadas impiden dos compras del último producto y replay no reserva dos veces", async () => {
  const db = setup();
  db.documents.get("locationStock/valle/items/oil").currentStock = 2;
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
test("confirmaciones concurrentes generan una venta, una salida y una tarea logística; simulación sin ingresos", async () => {
  const db = setup(),
    { order } = await checkout(db);
  await Promise.all([approve(db, order), approve(db, order)]);
  assert.equal(rows(db, "sales").length, 1);
  assert.equal(rows(db, "stockMovements").length, 1);
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
test("trasladar reserva a depósito y reasignar stock pagado conserva venta histórica y movimientos compensatorios", async () => {
  const db = setup(),
    { order } = await checkout(db);
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
  assert.equal(rows(db, "stockMovements").length, 1);
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
