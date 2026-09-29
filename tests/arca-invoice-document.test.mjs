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

const issuerEnv = {
  ARCA_ISSUER_CUIT: "20123456786",
  ARCA_ISSUER_LEGAL_NAME: "Flor Mia",
  ARCA_ISSUER_FISCAL_ADDRESS: "Domicilio fiscal de prueba",
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
  assert.match(result.pdf.toString("latin1"), /CAE: 12345678901234/);
});
