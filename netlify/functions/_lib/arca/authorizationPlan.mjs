import { buildFiscalAmounts, assertSaleMatchesFiscalTotal } from "./billing.mjs";

export const ARCA_VOUCHER_TYPES = Object.freeze({
  FACTURA_A: 1,
  FACTURA_B: 6,
});

const RECEIVER_CLASS_A = new Set([1, 6, 13, 16]);
const RECEIVER_CLASS_B = new Set([4, 5, 7, 15]);

function digits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizedIssuerVatCondition(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function resolveVoucherType({
  issuerVatCondition,
  receiverVatConditionId,
} = {}) {
  const issuer = normalizedIssuerVatCondition(issuerVatCondition);
  if (issuer !== "responsable_inscripto") {
    const error = new Error("La condición IVA del emisor no está soportada para autorización automática.");
    error.code = "arca-issuer-vat-condition-unsupported";
    throw error;
  }

  const receiverId = Number(receiverVatConditionId);
  if (RECEIVER_CLASS_A.has(receiverId)) {
    return {
      voucherType: ARCA_VOUCHER_TYPES.FACTURA_A,
      voucherClass: "A",
      reason: "responsable-inscripto-to-registered-or-monotributo",
    };
  }
  if (RECEIVER_CLASS_B.has(receiverId)) {
    return {
      voucherType: ARCA_VOUCHER_TYPES.FACTURA_B,
      voucherClass: "B",
      reason: "responsable-inscripto-to-consumer-or-nonregistered",
    };
  }

  const error = new Error("La condición IVA del receptor requiere revisión manual.");
  error.code = "arca-receiver-vat-condition-unsupported";
  error.receiverVatConditionId = receiverId;
  throw error;
}

function resolveReceiverDocument({
  voucherClass,
  receiverVatConditionId,
  documentType,
  documentNumber,
  anonymousConsumerFinal = false,
  total = 0,
  consumerFinalIdThreshold = 10000000,
} = {}) {
  const docType = Number(documentType || 0);
  const docNumber = digits(documentNumber);

  if (voucherClass === "A") {
    if (docType !== 80 || docNumber.length !== 11) {
      const error = new Error("Factura A requiere CUIT del receptor.");
      error.code = "arca-receiver-cuit-required";
      throw error;
    }
    return { documentType: 80, documentNumber: docNumber };
  }

  if (anonymousConsumerFinal) {
    if (Number(receiverVatConditionId) !== 5) {
      const error = new Error("Sólo un Consumidor Final puede tratarse como receptor anónimo.");
      error.code = "arca-anonymous-receiver-invalid";
      throw error;
    }
    return {
      documentType: 99,
      documentNumber: "0",
      requiresIdentification: Number(total || 0) >= Number(consumerFinalIdThreshold || 10000000),
    };
  }

  if (!docType || !docNumber) {
    const error = new Error("Falta el documento fiscal del receptor.");
    error.code = "arca-receiver-document-required";
    throw error;
  }

  return { documentType: docType, documentNumber: docNumber };
}

function vatRateMap(productFiscalSnapshot = []) {
  return Object.fromEntries(
    (Array.isArray(productFiscalSnapshot) ? productFiscalSnapshot : [])
      .filter((item) => item?.productId)
      .map((item) => [item.productId, item.arcaVatRate]),
  );
}

function dateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.valueOf())) throw new Error("Fecha fiscal inválida.");
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("");
}

export function buildAuthorizationPlan({
  invoice,
  issuerVatCondition,
  receiverVatConditionId,
  documentType,
  documentNumber,
  anonymousConsumerFinal = false,
  voucherDate = new Date(),
  concept = 1,
  consumerFinalIdThreshold = 10000000,
} = {}) {
  if (!invoice || !["pending", "authorizing"].includes(invoice.status)) {
    const error = new Error("La solicitud fiscal no está disponible para preparar autorización.");
    error.code = "arca-invoice-not-preparable";
    throw error;
  }

  if (invoice.fiscalReadiness?.ready !== true) {
    const error = new Error("La solicitud fiscal todavía tiene datos de producto incompletos.");
    error.code = "arca-fiscal-readiness-incomplete";
    throw error;
  }

  const { voucherType, voucherClass, reason } = resolveVoucherType({
    issuerVatCondition,
    receiverVatConditionId,
  });

  const sale = invoice.saleSnapshot || {};
  const receiverDocument = resolveReceiverDocument({
    voucherClass,
    receiverVatConditionId,
    documentType,
    documentNumber,
    anonymousConsumerFinal,
    total: sale.total,
    consumerFinalIdThreshold,
  });
  const fiscal = buildFiscalAmounts({
    items: sale.items || [],
    discountTotal: Number(sale.discountTotal || 0),
    vatRateByProduct: vatRateMap(invoice.productFiscalSnapshot),
  });
  assertSaleMatchesFiscalTotal(sale, fiscal);

  return {
    voucherType,
    voucherClass,
    voucherReason: reason,
    receiverVatConditionId: Number(receiverVatConditionId),
    receiverDocument,
    detailBase: {
      concept: Number(concept || 1),
      docType: receiverDocument.documentType,
      docNumber: receiverDocument.documentNumber,
      voucherDate: dateKey(voucherDate),
      total: fiscal.total,
      nonTaxed: fiscal.nonTaxed,
      net: fiscal.net,
      exempt: fiscal.exempt,
      tributes: fiscal.tributes,
      vat: fiscal.vat,
      vatBreakdown: fiscal.vatBreakdown,
      receiverVatConditionId: Number(receiverVatConditionId),
      currencyId: "PES",
      currencyQuote: 1,
    },
    fiscal,
    blockers: receiverDocument.requiresIdentification
      ? ["consumer-final-identification-required"]
      : [],
  };
}
