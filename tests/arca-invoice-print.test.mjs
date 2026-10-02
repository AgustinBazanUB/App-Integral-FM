import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  arcaInvoicePrintStatus,
  isArcaInvoicePrintable,
} from "../src/gestion/services/arcaInvoicePrint.js";

const authorizedInvoice = {
  status: "authorized",
  verification: { matched: true },
  pdf: { ready: true, issuerDataReady: true },
};

test("la impresión sólo está disponible para una factura autorizada, verificada y con PDF listo", () => {
  assert.equal(isArcaInvoicePrintable(authorizedInvoice), true);
  assert.equal(isArcaInvoicePrintable({ ...authorizedInvoice, status: "pending" }), false);
  assert.equal(isArcaInvoicePrintable({ ...authorizedInvoice, verification: { matched: false } }), false);
  assert.equal(isArcaInvoicePrintable({ ...authorizedInvoice, pdf: { ready: false, issuerDataReady: false } }), false);
  assert.equal(isArcaInvoicePrintable(null), false);
});

test("el estado de impresión explica qué condición fiscal falta", () => {
  assert.match(arcaInvoicePrintStatus({ status: "pending" }), /pendiente de autorización/);
  assert.match(arcaInvoicePrintStatus({ ...authorizedInvoice, verification: { matched: false } }), /verificación fiscal/);
  assert.match(arcaInvoicePrintStatus({ ...authorizedInvoice, pdf: { ready: false, issuerDataReady: false } }), /datos del emisor/);
});

test("Venta Rápida y Panel Vendedor exponen la acción asociada a su factura", async () => {
  const quickSales = await readFile(new URL("../src/gestion/pages/QuickSalesPage.jsx", import.meta.url), "utf8");
  const sellerPanel = await readFile(new URL("../src/gestion/seller/SellerPanel.jsx", import.meta.url), "utf8");
  const printAction = await readFile(new URL("../src/gestion/components/ArcaInvoicePrintAction.jsx", import.meta.url), "utf8");

  assert.match(quickSales, /<ArcaInvoicePrintAction \{\.\.\.registeredInvoice\} \/>/);
  assert.match(sellerPanel, /sourceType="seller_sale"[\s\S]*?invoiceId=\{receipt\.fiscalInvoiceId\}/);
  assert.match(sellerPanel, /<ArcaInvoicePrintAction[\s\S]*?invoice=\{fiscalDetail\.invoice\}/);
  assert.match(printAction, /fetchArcaInvoicePdf/);
  assert.match(printAction, /disposition: "inline"/);
});
