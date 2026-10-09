import test from "node:test";
import assert from "node:assert/strict";

import {
  buildArcaQrPayload,
  qrMatrix,
  QR_SIZE,
  QR_VERSION,
} from "../netlify/functions/_lib/arca/invoiceQr.mjs";
import {
  buildInvoicePdf,
  inspectInvoicePdfReadiness,
} from "../netlify/functions/_lib/arca/invoicePdf.mjs";
import { syncInvoiceToSale } from "../netlify/functions/_lib/arca/invoicePersistence.mjs";

const issuerEnv = {
  ARCA_ISSUER_CUIT: "20123456786",
  ARCA_ISSUER_LEGAL_NAME: "Flor Mia",
  ARCA_ISSUER_FISCAL_ADDRESS: "Domicilio fiscal de prueba",
  ARCA_ISSUER_COMMERCIAL_ADDRESS: "Domicilio comercial de prueba",
  ARCA_ISSUER_GROSS_INCOME: "123456789",
  ARCA_ISSUER_ACTIVITY_START: "01/01/2020",
  ARCA_ISSUER_VAT_CONDITION: "responsable_inscripto",
};

const invoice = {
  status: "authorized",
  fiscalEnvironment: "production",
  issuerCuit: "20123456786",
  sourceType: "admin_quick_sale",
  sourceId: "sale-1",
  createdAt: "2026-09-29T12:00:00.000Z",
  receiverSnapshot: { vatConditionId: 5, documentType: 99, documentNumber: "0", anonymousConsumerFinal: true },
  saleSnapshot: {
    saleCode: "FM-FMLV-20260929-0002",
    saleCreatedAt: "2026-09-29T12:00:00.000Z",
    subtotal: 1000,
    discountTotal: 0,
    total: 1000,
    customer: { name: null },
    items: [{ productId: "product-1", name: "Aceite de oliva virgen extra 500 ml", qty: 1, unitPrice: 1000, subtotal: 1000 }],
  },
  authorization: {
    voucherClass: "B",
    pointOfSale: 8,
    voucherType: 6,
    voucherNumber: 320,
    receiverVatConditionId: 5,
    receiverDocument: { documentType: 99, documentNumber: "0" },
    fiscal: { net: 826.45, vat: 173.55, total: 1000 },
    cae: "12345678901234",
    caeExpiration: "20261009",
    authorizedAt: "2026-09-29T12:01:00.000Z",
  },
  verification: { checkedAt: "2026-09-29T12:01:05.000Z", matched: true },
};

test("QR fiscal genera payload y matriz", () => {
  const qr = buildArcaQrPayload({
    issueDate: "2026-09-29",
    issuerCuit: invoice.issuerCuit,
    pointOfSale: 8,
    voucherType: 6,
    voucherNumber: 320,
    total: 1000,
    receiverDocumentType: 99,
    receiverDocumentNumber: "0",
    cae: "12345678901234",
  });
  assert.match(qr.url, /^https:\/\/www\.arca\.gob\.ar\/fe\/qr\/\?p=/);
  const matrix = qrMatrix(qr.url);
  assert.equal(QR_VERSION, 11);
  assert.equal(QR_SIZE, 61);
  assert.equal(matrix.length, 61);
  assert.ok(matrix.flat().some(Boolean));
});

test("PDF identificado conserva el nombre fiscal y rotula CUIL correctamente", () => {
  const identified = { ...invoice,
    receiverSnapshot: { name: "Cliente identificado", vatConditionId: 5, documentType: 86, documentNumber: "20123456786", anonymousConsumerFinal: false },
    authorization: { ...invoice.authorization, receiverDocument: { documentType: 86, documentNumber: "20123456786" } },
  };
  const result = buildInvoicePdf({ invoice: identified, env: issuerEnv });
  const pdf = result.pdf.toString("latin1");
  assert.match(pdf, /Cliente identificado/);
  assert.match(pdf, /CUIL/);
  assert.match(pdf, /20123456786/);
});

test("PDF fiscal exige datos del emisor y factura verificada", () => {
  const readiness = inspectInvoicePdfReadiness({ ARCA_ISSUER_VAT_CONDITION: "responsable_inscripto" });
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missing.includes("legalName"));

  assert.throws(
    () => buildInvoicePdf({ invoice: { ...invoice, verification: { matched: false } }, env: issuerEnv }),
    (error) => error?.code === "arca-pdf-invoice-not-verified",
  );

  const result = buildInvoicePdf({ invoice, env: issuerEnv });
  assert.equal(result.filename, "Factura_B_00008-00000320.pdf");
  assert.equal(result.pdf.subarray(0, 8).toString("latin1"), "%PDF-1.4");
  assert.match(result.pdf.toString("latin1"), /CAE N°: 12345678901234/);
  assert.match(result.pdf.toString("latin1"), /Régimen de Transparencia Fiscal al Consumidor/);
  assert.match(result.pdf.toString("latin1"), /IVA Contenido:/);
  assert.match(result.pdf.toString("latin1"), /A CONSUMIDOR FINAL/);
  assert.match(result.pdf.toString("latin1"), /Dirección fiscal:/);
  assert.match(result.pdf.toString("latin1"), /Dirección comercial:/);
  assert.match(result.pdf.toString("latin1"), /Código 06/);
  assert.match(result.pdf.toString("latin1"), /PV: 00008 - N° 00000320/);
  assert.match(result.pdf.toString("latin1"), /30 694 535 116 re S/);
  assert.match(result.pdf.toString("latin1"), /30 55 535 105 re S/);
});

test("PDF detalla el producto, su IVA y el descuento de la venta autorizada", () => {
  const detailedInvoice = structuredClone(invoice);
  detailedInvoice.saleSnapshot.subtotal = 10000;
  detailedInvoice.saleSnapshot.discountTotal = 9000;
  detailedInvoice.saleSnapshot.items = [{
    productId: "product-1",
    name: "Almendras Tostadas y Saladas 200g",
    qty: 1,
    unitPrice: 10000,
    subtotal: 10000,
  }];
  detailedInvoice.saleSnapshot.discounts = [{ name: "Promo 3 AOVE", amountApplied: 9000 }];
  detailedInvoice.productFiscalSnapshot = [{ productId: "product-1", arcaVatRate: 21 }];

  const content = buildInvoicePdf({ invoice: detailedInvoice, env: issuerEnv }).pdf.toString("latin1");
  assert.match(content, /Almendras Tostadas y Saladas 200g/);
  assert.match(content, /IVA 21%/);
  assert.match(content, /Descuento: Promo 3 AOVE/);
  assert.match(content, /10\.000,00/);
  assert.match(content, /9\.000,00/);
  assert.match(content, /1\.000,00/);
});


test("syncInvoiceToSale persiste el vínculo fiscal en la venta", async () => {
  const documents = new Map([
    ["invoices/invoice-production", { data: invoice, updateTime: "u1" }],
    ["sales/sale-1", { data: { saleCode: "FM-FMLV-20260929-0002" }, updateTime: "s1" }],
  ]);
  let patched = null;
  const getDocument = async (path) => documents.get(path) || null;
  const patchDocument = async (path, data) => {
    patched = { path, data };
    const current = documents.get(path);
    documents.set(path, {
      data: { ...(current?.data || {}), ...structuredClone(data) },
      updateTime: "s2",
    });
    return documents.get(path);
  };

  const result = await syncInvoiceToSale({
    invoiceId: "invoice-production",
    now: new Date("2026-09-29T13:00:00.000Z"),
    getDocument,
    patchDocument,
  });

  assert.equal(result.sourceId, "sale-1");
  assert.equal(patched.path, "sales/sale-1");
  assert.equal(patched.data.fiscalInvoiceId, "invoice-production");
  assert.equal(patched.data.invoiceStatus, "authorized");
  assert.equal(patched.data.fiscalInvoice.voucherClass, "B");
  assert.equal(patched.data.fiscalInvoice.voucherNumber, 320);
  assert.equal(patched.data.fiscalInvoice.verificationMatched, true);
});
