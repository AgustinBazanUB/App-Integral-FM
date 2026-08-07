import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateDiscountSummary } from "../src/modules/locations/domain/discounts.js";
import {
  normalizePayment,
  paymentAllocationSummary,
} from "../src/modules/locations/domain/payments.js";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("los descuentos fijos se aplican antes que los porcentajes", () => {
  const summary = calculateDiscountSummary([
    { discountId: "percent", name: "10 %", type: "percent", value: 10, source: "saved" },
    { discountId: "fixed", name: "$10.000", type: "fixed", value: 10000, source: "saved" },
  ], 100000);
  assert.equal(summary.fixedDiscountTotal, 10000);
  assert.equal(summary.percentageDiscountTotal, 9000);
  assert.equal(summary.discountTotal, 19000);
  assert.equal(summary.total, 81000);
});

test("los descuentos nunca reducen el total por debajo de cero", () => {
  const summary = calculateDiscountSummary([
    { discountId: "manual", name: "Manual", type: "fixed", value: 999999, source: "manual" },
    { discountId: "percent", name: "100 %", type: "percent", value: 100, source: "saved" },
  ], 1000);
  assert.equal(summary.total, 0);
});

test("+2 pagos exige al menos dos medios y suma exacta", () => {
  const valid = [
    { method: "cash", amount: 30000 },
    { method: "debit", amount: 50000 },
    { method: "alias", amount: 20000 },
  ];
  assert.deepEqual(paymentAllocationSummary(valid, 100000), {
    invalid: false,
    loaded: 100000,
    difference: 0,
    positiveCount: 3,
    total: 100000,
  });
  assert.equal(normalizePayment("multiple", "+2 pagos", valid, 100000).payments.length, 3);
  assert.throws(
    () => normalizePayment("multiple", "+2 pagos", [{ method: "cash", amount: 99999 }], 100000),
    /al menos 2 formas de pago/,
  );
});

test("la botonera conserva el atajo de solicitud de ticket sin emisión fiscal", async () => {
  const domain = await source("src/gestion/seller/sellerDomain.js");
  const panel = await source("src/gestion/seller/SellerPanel.jsx");
  assert.match(domain, /id:\s*"generateTicket"[\s\S]*action:\s*"ticket"/);
  assert.match(panel, /shortcut\.action === "ticket"/);
  assert.match(panel, /setTicketRequested\(\(current\) => !current\)/);
  assert.match(panel, /No se emite ningún comprobante fiscal/);
});

test("la venta persiste ticket pendiente y valida stock dentro de una transacción", async () => {
  const service = await source("src/gestion/services/sellerService.js");
  assert.match(service, /runTransaction\(db, async \(transaction\)/);
  assert.match(service, /if \(previousStock < item\.qty\) throw insufficientStockError/);
  assert.match(service, /ticketStatus = ticketRequested \? "pending" : "not_requested"/);
  assert.match(service, /transaction\.set\(refs\.saleRef/);
  assert.match(service, /transaction\.set\(refs\.movementRefs\[index\]/);
});

test("Ventas de ubicación usa el mismo documento sales y paginación", async () => {
  const service = await source("src/gestion/services/locationSalesService.js");
  const page = await source("src/gestion/pages/LocationDetailPage.jsx");
  assert.match(page, /\{ id: "sales", label: "Ventas" \}/);
  assert.match(page, /<LocationSalesPanel profile=\{profile\} location=\{location\}/);
  assert.match(service, /collection\(db, "sales"\)/);
  assert.match(service, /where\("locationId", "==", locationId\)/);
  assert.match(service, /orderBy\("createdAt", "desc"\)/);
  assert.match(service, /startAfter\(cursor\)/);
  assert.match(service, /limit\(safePageSize\)/);
});

test("la anulación administrativa comparte motivo opcional y devolución de stock", async () => {
  const panel = await source("src/gestion/components/LocationSalesPanel.jsx");
  const service = await source("src/gestion/services/sellerService.js");
  assert.match(panel, /const closeCancelDialog = useCallback/);
  assert.match(panel, /Motivo de anulación \(opcional\)/);
  assert.doesNotMatch(panel, /disabled=\{cancelReason\.trim\(\)\.length/);
  assert.match(service, /const safeReason = String\(reason \|\| ""\)\.trim\(\) \|\| null/);
  assert.match(service, /const newStock = previousStock \+ Number\(item\.qty \|\| 0\)/);
  assert.match(service, /type: "sale_cancel"/);
  assert.match(service, /action: "sale\.cancelled"/);
});

test("stock compacto y navegación mobile conservan contraste y objetivos táctiles", async () => {
  const page = await source("src/gestion/pages/LocationDetailPage.jsx");
  const baseStyles = await source("src/styles/seller-stage2.css");
  const finalStyles = await source("src/styles/seller-stage2-production.css");
  const main = await source("src/main.jsx");
  assert.match(page, /className="fm-stock-reason-input"/);
  assert.doesNotMatch(page, /fm-stock-reason-input[\s\S]{0,80}<textarea/);
  assert.match(baseStyles, /\.fm-stock-mode-row[\s\S]*grid-template-columns/);
  assert.match(finalStyles, /#f7f1e8/i);
  assert.match(finalStyles, /#2f2924/i);
  assert.match(finalStyles, /width:\s*44px/);
  assert.match(finalStyles, /@media \(max-width: 390px\)/);
  assert.match(finalStyles, /@media \(max-width: 320px\)/);
  assert.match(main, /seller-stage2-production\.css/);
});

test("Firestore mantiene índice de ventas por ubicación y fecha", async () => {
  const indexes = JSON.parse(await source("firestore.indexes.json"));
  const found = indexes.indexes.some((index) =>
    index.collectionGroup === "sales" &&
    index.fields?.[0]?.fieldPath === "locationId" &&
    index.fields?.[1]?.fieldPath === "createdAt" &&
    index.fields?.[1]?.order === "DESCENDING",
  );
  assert.equal(found, true);
});
