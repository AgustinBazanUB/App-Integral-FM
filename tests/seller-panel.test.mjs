import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  completeRemainingPayment,
  normalizePayment,
  paymentAllocationSummary,
} from "../src/modules/locations/domain/payments.js";
import {
  canAccessAdminPanel,
  canAccessSellerPanel,
  effectiveSellerLocationIds,
  isPureSeller,
} from "../src/gestion/permissions.js";
import {
  cartQuantity,
  cartSubtotal,
  groupSellerProducts,
  keyMatchesEvent,
  pendingReservedQuantities,
  visibleSellerProducts,
} from "../src/gestion/seller/sellerDomain.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const now = new Date("2026-08-06T15:00:00-03:00");

const seller = {
  id: "seller-1",
  name: "Vendedor",
  role: "seller",
  active: true,
  allowedLocationIds: ["loc-1"],
};
const admin = {
  id: "admin-1",
  name: "Administrador",
  role: "admin",
  active: true,
};
const limitedAdmin = {
  id: "manager-1",
  name: "Encargado",
  role: "location_manager",
  active: true,
  allowedLocationIds: ["loc-1"],
};
const locations = [
  { id: "loc-1", name: "Local", active: true, deleted: false },
  { id: "loc-2", name: "Feria", active: true, deleted: false },
  { id: "loc-3", name: "Pausada", active: false, deleted: false },
  { id: "loc-4", name: "Eliminada", active: true, deleted: true },
];

test("un vendedor puro accede al Panel Vendedor y no al administrativo", () => {
  assert.equal(canAccessSellerPanel(seller), true);
  assert.equal(canAccessAdminPanel(seller), false);
  assert.equal(isPureSeller(seller), true);
});

test("el administrador conserva ambos paneles", () => {
  assert.equal(canAccessSellerPanel(admin), true);
  assert.equal(canAccessAdminPanel(admin), true);
  assert.equal(isPureSeller(admin), false);
});

test("las ubicaciones efectivas respetan permisos, actividad y baja lógica", () => {
  assert.deepEqual(effectiveSellerLocationIds(seller, locations, now), ["loc-1"]);
  assert.deepEqual(effectiveSellerLocationIds(limitedAdmin, locations, now), ["loc-1"]);
  assert.deepEqual(effectiveSellerLocationIds(admin, locations, now), ["loc-2", "loc-1"]);
});

test("productos visibles y categorías reutilizan los datos locales de la ubicación", () => {
  const stock = [
    { id: "p1", productName: "Aceite", categoryId: "c1", active: true, deleted: false },
    { id: "p2", productName: "Aceitunas", categoryId: "", active: true, deleted: false },
    { id: "p3", productName: "Baja", categoryId: "c1", active: false, deleted: false },
  ];
  const categories = [{ id: "c1", name: "Aceites", active: true, sortOrder: 1 }];
  assert.deepEqual(visibleSellerProducts(stock).map((item) => item.id), ["p1", "p2"]);
  const groups = groupSellerProducts(stock, categories);
  assert.deepEqual(groups.map((group) => [group.name, group.items.map((item) => item.id)]), [
    ["Aceites", ["p1"]],
    ["Sin categoría", ["p2"]],
  ]);
});

test("el carrito calcula cantidades y subtotal", () => {
  const cart = {
    p1: { qty: 2, price: 1200 },
    p2: { qty: 3, price: 500 },
  };
  assert.equal(cartQuantity(cart), 5);
  assert.equal(cartSubtotal(cart), 3900);
});

test("las ventas pendientes reservan stock local sin afirmarse confirmadas", () => {
  const reserved = pendingReservedQuantities([
    { locationId: "loc-1", status: "pending", items: [{ productId: "p1", qty: 2 }] },
    { locationId: "loc-1", status: "sync_error", items: [{ productId: "p1", qty: 1 }] },
    { locationId: "loc-1", status: "synced", items: [{ productId: "p1", qty: 10 }] },
    { locationId: "loc-2", status: "pending", items: [{ productId: "p1", qty: 8 }] },
  ], "loc-1");
  assert.deepEqual(reserved, { p1: 3 });
});

test("la botonera distingue tecla, código y ubicación física", () => {
  const product = { buttonKey: "1", buttonCode: "Numpad1", buttonLocation: 3 };
  assert.equal(keyMatchesEvent(product, { key: "1", code: "Numpad1", location: 3 }), true);
  assert.equal(keyMatchesEvent(product, { key: "1", code: "Digit1", location: 0 }), false);
});

test("+2 pagos exige montos no negativos y suma exacta", () => {
  const entries = [
    { method: "cash", amount: 4000 },
    { method: "debit", amount: 0 },
    { method: "credit", amount: 0 },
    { method: "alias", amount: 0 },
  ];
  const completed = completeRemainingPayment(entries, "debit", 10000);
  const summary = paymentAllocationSummary(completed, 10000);
  assert.equal(summary.difference, 0);
  assert.equal(summary.positiveCount, 2);
  assert.deepEqual(
    normalizePayment("multiple", "+2 pagos", completed, 10000).payments,
    [
      { method: "cash", label: "Pago eft", amount: 4000 },
      { method: "debit", label: "Pago debito", amount: 6000 },
    ],
  );
  assert.throws(
    () => normalizePayment("multiple", "+2 pagos", [{ method: "cash", amount: -1 }, { method: "debit", amount: 10001 }], 10000),
    /mayor o igual a cero/,
  );
});

test("la ruta y el cambio entre paneles conservan la misma sesión", async () => {
  const app = await read("../src/gestion/ManagementApp.jsx");
  const shell = await read("../src/gestion/ManagementShell.jsx");
  const sellerPanel = await read("../src/gestion/seller/SellerPanel.jsx");
  assert.match(app, /isPureSeller\(profile\).*navigate\("\/vendedor"/s);
  assert.match(app, /<SellerPanel \/>/);
  assert.match(shell, />Ver Panel Vendedor</);
  assert.match(sellerPanel, />Volver al Panel Administrador</);
  assert.doesNotMatch(shell, /signInWithEmailAndPassword/);
});

test("los servicios usan una transacción y validan stock real", async () => {
  const service = await read("../src/gestion/services/sellerService.js");
  assert.match(service, /runTransaction\(db/);
  assert.match(service, /previousStock < item\.qty/);
  assert.match(service, /lastMovementId/);
  assert.match(service, /offlineLocalId/);
  assert.match(service, /sale\.cancelled/);
  assert.match(service, /sale\.updated/);
});

test("la cola offline usa IndexedDB e identificadores idempotentes", async () => {
  const offline = await read("../src/gestion/seller/offlineSales.js");
  const service = await read("../src/gestion/services/sellerService.js");
  assert.match(offline, /indexedDB\.open/);
  assert.match(offline, /keyPath: "localId"/);
  assert.match(service, /offline_\$\{seller\.id\}_\$\{localId\}/);
  assert.match(service, /alreadySynced: true/);
});

test("la interfaz ofrece las vistas operativas y controles táctiles", async () => {
  const panel = await read("../src/gestion/seller/SellerPanel.jsx");
  const css = await read("../src/styles/seller-panel.css");
  for (const text of [
    "Nueva venta",
    "Mis ventas",
    "Pendientes",
    "Stock",
    "Precios",
    "Ayuda",
    "Vaciar carrito",
    "+2 pagos",
    "Confirmar venta",
  ]) assert.match(panel, new RegExp(text.replace(/[+]/g, "\\+")));
  assert.match(css, /@media \(max-width: 768px\)/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /min-height: 44px/);
  assert.doesNotMatch(css, /width:\s*100vw/);
});

test("las reglas vinculan stock con venta y movimiento de la misma transacción", async () => {
  const rules = await read("../firestore.rules");
  assert.match(rules, /validSellerStockMutation/);
  assert.match(rules, /getAfter\(\/databases\/\$\(database\)\/documents\/stockMovements/);
  assert.match(rules, /movement\.previousStock == resource\.data\.currentStock/);
  assert.match(rules, /movement\.newStock == request\.resource\.data\.currentStock/);
});
