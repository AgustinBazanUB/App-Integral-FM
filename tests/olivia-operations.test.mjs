import test from "node:test";
import { prepareExtendedOperation, executeExtendedOperation } from "../netlify/functions/_lib/olivia/extendedOperations.mjs";
import { OLIVIA_CAPABILITIES, selectCapabilities } from "../src/shared/oliviaCapabilities.mjs";
import { validateSchema } from "../src/shared/oliviaContracts.mjs";
import assert from "node:assert/strict";
import {
  prepareOperation,
  executeOperation,
} from "../netlify/functions/_lib/olivia/operations.mjs";
import {
  buildOperationalSalePlan,
  buildLocationStockLinePlan,
} from "../src/shared/operationalWritePlans.mjs";

const now = new Date("2026-10-04T15:00:00.000Z");
const clone = (value) => structuredClone(value);
function fixture(role = "seller") {
  const profile = {
    active: true,
    role,
    name: "Vendedora",
    allowedLocationIds: ["local_a"],
  };
  const documents = new Map(
    Object.entries({
      "users/user_a": profile,
      "locations/local_a": {
        name: "Local A",
        codePrefix: "LA",
        active: true,
        assignedSellerIds: ["user_a"],
        enabledDiscountIds: ["promo_a"],
      },
      "locations/local_b": { name: "Local B", active: true },
      "products/product_a": {
        name: "Aceite",
        abbreviation: "ACE",
        defaultPrice: 1500,
        active: true,
        categoryId: "oil",
      },
      "products/product_b": {
        name: "Mermelada",
        defaultPrice: 700,
        active: true,
      },
      "locationStock/local_a/items/product_a": {
        productId: "product_a",
        productName: "Aceite",
        currentStock: 4,
        initialStock: 4,
        priceMode: "default",
        active: true,
      },
      "discounts/promo_a": {
        name: "10% local",
        active: true,
        type: "percent",
        value: 10,
      },
      "discounts/promo_b": {
        name: "Otra promoción",
        active: true,
        type: "percent",
        value: 50,
      },
    }),
  );
  return {
    documents,
    session: { uid: "user_a", profile: clone(profile) },
    store: {
      get: async (path) =>
        documents.has(path)
          ? {
              ...clone(documents.get(path)),
              id: path.split("/").at(-1),
              __updateTime: "2026-10-04T10:00:00Z",
            }
          : null,
    },
    transaction: {
      getDocument: async (path) =>
        documents.has(path)
          ? {
              data: clone(documents.get(path)),
              updateTime: "2026-10-04T10:00:00Z",
            }
          : null,
    },
  };
}
const argsFor = (extra) => ({
  locationId: "local_a",
  items: [{ productId: "product_a", qty: 2 }],
  paymentMethod: "cash",
  payments: [],
  ticketRequested: false,
  customerDecision: "none",
  customer: null,
  promotionDecision: "none",
  discounts: [],
  ...extra,
});
const prepare = (f, args = argsFor(), toolName = "prepare_sale") =>
  prepareOperation({ session: f.session, store: f.store, args, toolName, now });
const execute = (f, prepared) =>
  executeOperation({
    session: f.session,
    transaction: f.transaction,
    prepared,
    now,
    correlation: {
      confirmationId: "confirm_a",
      conversationId: "conversation_a",
      requestId: "request_a",
    },
  });

test("sale preparation requires explicit customer, promotion and fiscal decisions", async () => {
  const f = fixture();
  const result = await prepare(f, {
    locationId: "local_a",
    items: [{ productId: "product_a", qty: 1 }],
    paymentMethod: "cash",
  });
  assert.equal(result.state, "DATOS_INCOMPLETOS");
  assert.deepEqual(result.missing, [
    "ticketRequested",
    "customerDecision",
    "promotionDecision",
  ]);
  assert.equal(result.snapshotFingerprint, undefined);
});

test("sale price is authoritative and untrusted submitted prices are ignored", async () => {
  const f = fixture();
  const prepared = await prepare(
    f,
    argsFor({
      items: [{ productId: "product_a", qty: 2, unitPrice: 1, name: "otro" }],
    }),
  );
  assert.match(prepared.summary, /Aceite/);
  const { writes, result } = await execute(f, prepared);
  const sale = writes.find((write) => write.path.startsWith("sales/"));
  assert.equal(sale.data.total, 3000);
  assert.equal(sale.data.items[0].unitPrice, 1500);
  assert.equal(sale.data.items[0].name, "Aceite");
  assert.equal(result.state, "COMPLETADA");
});

test("seller sale produces counter, stock, immutable movement, sale and audit in one plan", async () => {
  const f = fixture();
  const prepared = await prepare(f);
  const { writes } = await execute(f, prepared);
  assert.equal(writes.length, 5);
  const stock = writes.find((write) => write.path.startsWith("locationStock/"));
  const movement = writes.find((write) =>
    write.path.startsWith("stockMovements/"),
  );
  const sale = writes.find((write) => write.path.startsWith("sales/"));
  const audit = writes.find((write) => write.path.startsWith("auditLogs/"));
  assert.equal(stock.data.currentStock, 2);
  assert.equal(movement.data.qty, -2);
  assert.equal(movement.data.saleId, stock.data.lastSaleId);
  assert.equal(sale.type, "create");
  assert.equal(audit.type, "create");
  assert.equal(audit.data.origin, "Asistente IA / Olivia");
  assert.equal(audit.data.confirmationId, "confirm_a");
  assert.equal(stock.currentUpdateTime, "2026-10-04T10:00:00Z");
  assert.ok(sale.data.createdAt instanceof Date);
});

test("changed stock or price rejects confirmation before producing writes", async () => {
  for (const target of ["stock", "price"]) {
    const f = fixture();
    const prepared = await prepare(f);
    if (target === "stock")
      f.documents.get("locationStock/local_a/items/product_a").currentStock = 3;
    else f.documents.get("products/product_a").defaultPrice = 2000;
    await assert.rejects(execute(f, prepared), { code: "context-changed" });
  }
});

test("fresh disabled or reassigned profile cannot consume a previous proposal", async () => {
  for (const change of ["disable", "reassign"]) {
    const f = fixture();
    const prepared = await prepare(f);
    if (change === "disable") f.documents.get("users/user_a").active = false;
    else {
      f.documents.get("users/user_a").allowedLocationIds = [];
      f.documents.get("locations/local_a").assignedSellerIds = [];
    }
    await assert.rejects(execute(f, prepared), { code: "permission-denied" });
  }
});

test("a seller cannot propose sales at an unassigned location", async () => {
  await assert.rejects(prepare(fixture(), argsFor({ locationId: "local_b" })), {
    code: "permission-denied",
  });
});

test("intentional negative physical stock is disclosed and audited using the manual core", async () => {
  const f = fixture();
  const prepared = await prepare(
    f,
    argsFor({ items: [{ productId: "product_a", qty: 5 }] }),
  );
  assert.match(prepared.summary, /stock negativo/);
  const { writes } = await execute(f, prepared);
  const sale = writes.find((write) => write.path.startsWith("sales/"));
  assert.equal(sale.data.stockDiscrepancies[0].newStock, -1);
  assert.equal(
    writes.find((write) => write.path.startsWith("locationStock/")).data
      .currentStock,
    -1,
  );
  assert.equal(
    writes.find((write) => write.path.startsWith("auditLogs/")).data
      .stockDiscrepancies[0].missingQuantity,
    1,
  );
});

test("fiscal ticket request routes to existing manual ARCA without a confirmation", async () => {
  const result = await prepare(fixture(), argsFor({ ticketRequested: true }));
  assert.equal(result.state, "RECHAZADA");
  assert.equal(result.manualRoute, "/vendedor");
  assert.equal(result.snapshotFingerprint, undefined);
});

test("saved discounts preserve assignment and multiple payments require exact sums", async () => {
  const f = fixture();
  await assert.rejects(
    prepare(
      f,
      argsFor({
        promotionDecision: "apply",
        discounts: [{ discountId: "promo_b" }],
      }),
    ),
    { code: "context-changed" },
  );
  const args = argsFor({
    promotionDecision: "apply",
    discounts: [{ discountId: "promo_a" }],
    paymentMethod: "multiple",
    payments: [
      { method: "cash", amount: 1000 },
      { method: "alias", amount: 1700 },
    ],
  });
  const prepared = await prepare(f, args);
  const { writes } = await execute(f, prepared);
  assert.equal(
    writes.find((write) => write.path.startsWith("sales/")).data.total,
    2700,
  );
  args.payments[1].amount = 1701;
  await assert.rejects(prepare(f, args), /Te pasaste/);
});

test("associated customer uses deterministic key and existing enrichment semantics", async () => {
  const f = fixture();
  const prepared = await prepare(
    f,
    argsFor({
      customerDecision: "associate",
      customer: { phone: "11 1234 5678", name: "Ana", customZone: "Centro" },
    }),
  );
  const { writes } = await execute(f, prepared);
  const customer = writes.find((write) => write.path.startsWith("customers/"));
  const sale = writes.find((write) => write.path.startsWith("sales/"));
  assert.match(customer.path, /^customers\/customer_[a-f0-9]{40}$/);
  assert.equal(customer.data.phoneNormalized, "1112345678");
  assert.equal(customer.data.name, "Ana");
  assert.equal(sale.data.customerNameSnapshot, "Ana");
  assert.equal(customer.data.lastSaleId, sale.path.slice(6));
});

test("stock loading is admin-only and validates positive quantity", async () => {
  const args = {
    locationId: "local_a",
    productId: "product_a",
    quantity: 3,
    reason: "Ingreso confirmado",
  };
  await assert.rejects(prepare(fixture(), args, "prepare_stock_load"), {
    code: "permission-denied",
  });
  const f = fixture("admin");
  await assert.rejects(
    prepare(f, { ...args, quantity: -1 }, "prepare_stock_load"),
    /entero positivo/,
  );
  const prepared = await prepare(f, args, "prepare_stock_load");
  const { writes, result } = await execute(f, prepared);
  assert.equal(writes.length, 5);
  assert.equal(
    writes.find((write) => write.path.startsWith("locationStock/")).data
      .currentStock,
    7,
  );
  assert.equal(
    writes.find((write) => write.path.startsWith("stockMovements/")).data.qty,
    3,
  );
  assert.match(result.message, /Stock actual: 7/);
});

test("stock loading without a reason prepares and executes with the standard movement description", async () => {
  for (const reason of [undefined, null, "", "   "]) {
    const f = fixture("admin");
    const args = { locationId: "local_a", productId: "product_a", quantity: 3 };
    if (reason !== undefined) args.reason = reason;
    const prepared = await prepare(f, args, "prepare_stock_load");
    assert.equal(prepared.canonicalArgs.reason, "");
    assert.match(prepared.summary, /Stock: 4 → 7/);
    assert.doesNotMatch(prepared.summary, /Motivo:|undefined|null/);
    const { writes } = await execute(f, prepared);
    assert.equal(writes.find((write) => write.path.startsWith("locationStock/")).data.currentStock, 7);
    assert.equal(writes.find((write) => write.path.startsWith("stockMovements/")).data.reason, "Ingreso de mercadería");
    assert.equal(f.documents.get("locationStock/local_a/items/product_a").currentStock, 4);
  }
});

test("stock loading creates only the local relationship for a new configured product", async () => {
  const f = fixture("admin");
  const prepared = await prepare(
    f,
    {
      locationId: "local_a",
      productId: "product_b",
      quantity: 2,
      reason: "Reposición",
    },
    "prepare_stock_load",
  );
  const { writes } = await execute(f, prepared);
  const stock = writes.find((write) => write.path.startsWith("locationStock/"));
  assert.equal(stock.type, "create");
  assert.equal(stock.data.currentStock, 2);
  assert.equal(stock.data.priceMode, "default");
  assert.equal(
    writes.some((write) => write.path.startsWith("products/")),
    false,
  );
});

test("shared sale plan preserves administrative, offline and warehouse behavior", () => {
  const base = {
    profile: { id: "user_a", name: "Admin" },
    location: { id: "local_a", name: "A" },
    items: [
      {
        productId: "product_a",
        name: "Aceite",
        unitPrice: 1500,
        qty: 2,
        subtotal: 3000,
      },
    ],
    stocks: [{ currentStock: 4, active: true }],
    counter: { lastNumber: 3 },
    saleId: "sale_a",
    movementIds: ["movement_a"],
    dateKey: "20261004",
    prefix: "LA",
    stamp: now,
    localFields: { saleDate: "2026-10-04", saleTime: "12:00:00" },
    discountSummary: {
      discounts: [],
      fixedDiscountTotal: 0,
      percentageDiscountTotal: 0,
      discountTotal: 0,
      totalBeforeDiscounts: 3000,
      total: 3000,
    },
    payment: { paymentMethod: "cash", paymentMethodLabel: "Pago eft" },
  };
  const admin = buildOperationalSalePlan({
    ...base,
    administrative: true,
    requestId: "req_a",
    requestFingerprint: "same",
    channel: "whatsapp",
    priceOverrides: [{ productId: "product_a", unitPrice: 1500 }],
    invoiceRequested: true,
  });
  assert.equal(admin.saleData.sourceType, "admin_quick_sale");
  assert.equal(admin.saleData.sourceChannel, "whatsapp");
  assert.equal(admin.saleData.invoiceStatus, "pending");
  assert.equal(admin.saleData.requestFingerprint, "same");
  const offline = buildOperationalSalePlan({
    ...base,
    offlineSale: { localId: "local_a", createdLocallyAt: now },
  });
  assert.equal(offline.saleData.createdOffline, true);
  assert.equal(offline.saleData.offlineLocalId, "local_a");
  assert.throws(
    () =>
      buildOperationalSalePlan({
        ...base,
        stockType: "warehouse",
        stocks: [{ currentStock: 1 }],
      }),
    { code: "seller/insufficient-stock" },
  );
});

test("shared stock plan preserves legacy custom price and alert thresholds", () => {
  const plan = buildLocationStockLinePlan({
    product: { id: "p", name: "P", defaultPrice: 999 },
    existing: {
      currentStock: 5,
      initialStock: 2,
      price: 123,
      yellowAlertQty: 4,
      redAlertQty: 1,
    },
    mode: "add",
    requested: 3,
    operationId: "op",
    location: { id: "loc", name: "Local" },
    profile: { id: "admin" },
    stamp: now,
  });
  assert.equal(plan.stockData.price, 123);
  assert.equal(plan.stockData.initialStock, 2);
  assert.equal(plan.stockData.yellowAlertQty, 4);
  assert.equal(plan.movementData.qty, 3);
  assert.equal(plan.movementData.type, "add");
});

const batchRow = (extra = {}) => {
  const { locationId, ...sale } = argsFor();
  return { reference: "Pedido 1", stockOrigin: { type: "location", id: locationId }, channel: "in_person", ...sale, ...extra };
};
const prepareBatch = (f, sales) => prepareExtendedOperation({ session: f.session, store: f.store, args: { sales }, toolName: "prepare_batch_sales", now });
test("batch sale prepares without writes and shares counters and cumulative stock atomically", async () => {
  const f = fixture(), before = clone([...f.documents]);
  const prepared = await prepareBatch(f, [batchRow({ items: [{ productId: "product_a", qty: 1 }] }), batchRow()]);
  assert.deepEqual([...f.documents], before);
  assert.match(prepared.summary, /Registrar 2 ventas/);
  const result = await execute(f, prepared);
  const stocks = result.writes.filter(write => write.path.includes("locationStock/"));
  assert.equal(stocks.length, 1); assert.equal(stocks[0].data.currentStock, 1);
  const movements = result.writes.filter(write => write.path.startsWith("stockMovements/"));
  assert.deepEqual(movements.map(write => [write.data.previousStock, write.data.newStock]), [[4, 3], [3, 1]]);
  const sales = result.writes.filter(write => write.path.startsWith("sales/"));
  assert.deepEqual(sales.map(write => write.data.saleCode), ["FM-LA-20261004-0001", "FM-LA-20261004-0002"]);
  assert.equal(result.writes.filter(write => write.path.startsWith("counters/")).length, 1);
  assert.equal(result.writes.find(write => write.path.startsWith("counters/")).data.lastNumber, 2);
  assert.match(result.result.message, /Se registraron 2 ventas/);
});
test("batch sales require each origin, channel and commercial decisions without inventing defaults", async () => {
  const f = fixture();
  const prepared = await prepareBatch(f, [batchRow(), batchRow({ channel: null, paymentMethod: null, customerDecision: null, stockOrigin: { type: null, id: null } })]);
  assert.equal(prepared.state, "DATOS_INCOMPLETOS");
  assert.ok(prepared.missing.includes("sales.1.channel"));
  assert.match(prepared.summary, /venta 2: forma de pago/);
  assert.equal(prepared.writes, undefined);
});
test("seller batches cannot use another location, remote channels or warehouse stock", async () => {
  const f = fixture();
  for (const row of [batchRow({ stockOrigin: { type: "location", id: "local_b" } }), batchRow({ channel: "whatsapp" }), batchRow({ stockOrigin: { type: "warehouse", id: "warehouse_a" } })])
    await assert.rejects(prepareBatch(f, [batchRow(), row]), { code: "permission-denied" });
  assert.equal([...f.documents.keys()].some(path => path.startsWith("sales/")), false);
});
test("administrative batches preserve warehouse source, live prices and separate commercial channels", async () => {
  const f = fixture("admin");
  f.documents.set("warehouses/warehouse_a", { name: "Depósito", active: true });
  f.documents.set("warehouseStock/warehouse_a/items/product_a", { currentStock: 3, active: true });
  const prepared = await prepareBatch(f, [batchRow({ channel: "instagram" }), batchRow({ channel: "whatsapp", stockOrigin: { type: "warehouse", id: "warehouse_a" } })]);
  const result = await execute(f, prepared), sales = result.writes.filter(write => write.path.startsWith("sales/"));
  assert.deepEqual(sales.map(write => write.data.sourceChannel), ["instagram", "whatsapp"]);
  assert.equal(sales[1].data.stockOriginType, "warehouse");
  assert.equal(sales[1].data.warehouseId, "warehouse_a");
  assert.equal(sales[1].data.items[0].unitPrice, 1500);
  assert.equal(sales[1].data.sourceType, "admin_quick_sale");
  assert.equal(result.writes.find(write => write.path.includes("warehouseStock/")).data.currentStock, 1);
});
test("insufficient combined warehouse stock rejects the whole batch without partial writes", async () => {
  const f = fixture("admin");
  f.documents.set("warehouses/warehouse_a", { name: "Depósito", active: true });
  f.documents.set("warehouseStock/warehouse_a/items/product_a", { currentStock: 3, active: true });
  const row = batchRow({ stockOrigin: { type: "warehouse", id: "warehouse_a" } }), before = clone([...f.documents]);
  await assert.rejects(prepareBatch(f, [row, row]), { code: "seller/insufficient-stock" });
  assert.deepEqual([...f.documents], before);
});
test("batch confirmation rechecks stock, counter and permissions before publishing any writes", async () => {
  for (const mutate of [f => f.documents.get("locationStock/local_a/items/product_a").currentStock = 99, f => f.documents.set("counters/LA_20261004", { lastNumber: 9 }), f => f.documents.get("users/user_a").permissionDeny = { "quick-sales": ["create"] }]) {
    const f = fixture(), prepared = await prepareBatch(f, [batchRow()]);
    mutate(f);
    await assert.rejects(execute(f, prepared), error => ["context-changed", "permission-denied"].includes(error.code));
    assert.equal([...f.documents.keys()].some(path => path.startsWith("sales/")), false);
  }
});
test("batch schema is discoverable for sellers and enforces list bounds and fiscal review", async () => {
  const f = fixture();
  assert.ok(selectCapabilities(f.session, "anotá estas ventas", { module: "seller" }).includes("prepare_batch_sales"));
  const schema = OLIVIA_CAPABILITIES.prepare_batch_sales.parameters;
  validateSchema({ sales: [batchRow()] }, schema);
  assert.throws(() => validateSchema({ sales: Array.from({ length: 21 }, () => batchRow()) }, schema));
  assert.throws(() => validateSchema({ sales: [batchRow({ channel: "fake" })] }, schema));
  const fiscal = await prepareBatch(f, [batchRow({ ticketRequested: true })]);
  assert.equal(fiscal.state, "RECHAZADA"); assert.equal(fiscal.writes, undefined);
});
