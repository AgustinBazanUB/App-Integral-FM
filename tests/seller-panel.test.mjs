import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { calculateDiscountSummary } from "../src/modules/locations/domain/discounts.js";
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

test("los descuentos fijos se aplican antes que todos los porcentajes", () => {
  const summary = calculateDiscountSummary([
    { id: "percent", name: "Efectivo", type: "percent", value: 10 },
    { id: "fixed", name: "Promo", type: "fixed", value: 10000 },
  ], 100000);
  assert.equal(summary.fixedDiscountTotal, 10000);
  assert.equal(summary.percentageDiscountTotal, 9000);
  assert.equal(summary.discountTotal, 19000);
  assert.equal(summary.total, 81000);
  assert.deepEqual(summary.discounts.map((discount) => discount.type), ["fixed", "percent"]);
});

test("varios porcentajes mantienen la aplicación sucesiva sobre el saldo", () => {
  const summary = calculateDiscountSummary([
    { id: "fixed", name: "Fijo", type: "fixed", value: 10000 },
    { id: "p1", name: "P1", type: "percent", value: 10 },
    { id: "p2", name: "P2", type: "percent", value: 20 },
  ], 100000);
  assert.equal(summary.discounts[1].amountApplied, 9000);
  assert.equal(summary.discounts[2].amountApplied, 16200);
  assert.equal(summary.total, 64800);
});

test("los descuentos nunca reducen el total por debajo de cero", () => {
  const summary = calculateDiscountSummary([
    { id: "fixed", name: "Fijo", type: "fixed", value: 200000 },
    { id: "percent", name: "Porcentaje", type: "percent", value: 50 },
  ], 100000);
  assert.equal(summary.total, 0);
  assert.equal(summary.discountTotal, 100000);
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

test("la interfaz compacta descuentos y prepara ticket sin simular ARCA", async () => {
  const panel = await read("../src/gestion/seller/SellerPanel.jsx");
  const dialog = await read("../src/gestion/seller/DiscountDialog.jsx");
  const service = await read("../src/gestion/services/sellerService.js");
  assert.match(panel, />Agregar descuento</);
  assert.match(panel, />Agregar ticket</);
  assert.match(panel, />Continuar</);
  assert.match(panel, /ticketRequested/);
  assert.match(dialog, />Descuentos disponibles</);
  assert.match(dialog, />Descuento manual</);
  assert.match(dialog, />Monto fijo</);
  assert.match(dialog, />Porcentaje</);
  assert.match(service, /ticketStatus/);
  assert.match(service, /"pending"/);
  assert.doesNotMatch(`${panel}\n${service}`, /CAE ficticio|fiscalReceiptNumber:\s*"FM-|arca.*password/i);
});

test("la venta guarda creador, fecha local, descuentos desglosados y ticket", async () => {
  const service = await read("../src/gestion/services/sellerService.js");
  for (const field of [
    "createdBy",
    "createdByName",
    "saleDate",
    "saleTime",
    "fixedDiscountTotal",
    "percentageDiscountTotal",
    "discountTotal",
    "ticketRequested",
    "ticketStatus",
  ]) assert.match(service, new RegExp(field));
  assert.match(service, /runTransaction\(db/);
  assert.match(service, /previousStock < item\.qty/);
  assert.match(service, /lastMovementId/);
  assert.match(service, /sale\.cancelled/);
  assert.match(service, /sale\.updated/);
});

test("la cola offline conserva descuentos, ticket e idempotencia", async () => {
  const offline = await read("../src/gestion/seller/offlineSales.js");
  const service = await read("../src/gestion/services/sellerService.js");
  assert.match(offline, /indexedDB\.open/);
  assert.match(offline, /keyPath: "localId"/);
  assert.match(offline, /fixedDiscountTotal/);
  assert.match(offline, /ticketRequested/);
  assert.match(service, /offline_\$\{seller\.id\}_\$\{localId\}/);
  assert.match(service, /alreadySynced: true/);
});

test("Ubicaciones incorpora Ventas y consulta una sola colección paginada", async () => {
  const page = await read("../src/gestion/pages/LocationDetailPage.jsx");
  const component = await read("../src/gestion/components/LocationSalesPanel.jsx");
  const service = await read("../src/gestion/services/locationSalesService.js");
  assert.match(page, /id: "sales", label: "Ventas"/);
  assert.match(page, /<LocationSalesPanel/);
  assert.match(service, /collection\(db, "sales"\)/);
  assert.match(service, /where\("locationId", "==", locationId\)/);
  assert.match(service, /orderBy\("createdAt", "desc"\)/);
  assert.match(service, /startAfter\(cursor\)/);
  assert.doesNotMatch(service, /locationSales|salesByLocation/);
  for (const label of ["Fecha", "Vendedor", "Estado", "Forma de pago", "Productos", "Descuentos", "Pagos", "Ticket", "Auditoría"]) {
    assert.match(component, new RegExp(label));
  }
});

test("stock, navegación y venta actual tienen reglas responsive compactas", async () => {
  const page = await read("../src/gestion/pages/LocationDetailPage.jsx");
  const css = await read("../src/styles/seller-stage2.css");
  assert.match(page, /fm-stock-mode-row/);
  assert.match(page, /fm-stock-reason-input/);
  assert.match(css, /grid-template-columns: minmax\(220px/);
  assert.match(css, /#f7f1e8/i);
  assert.match(css, /#2f2924/i);
  assert.match(css, /#b88a2d/i);
  assert.match(css, /@media \(max-width: 768px\)/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /@media \(max-width: 360px\)/);
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
