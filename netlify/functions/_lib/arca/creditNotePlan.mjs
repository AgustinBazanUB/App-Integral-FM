import { assertSaleMatchesFiscalTotal } from "./billing.mjs";

export function buildCreditNotePlan(invoice, voucherDate) {
  const original = invoice.associatedInvoice;
  const auth = original?.authorization;
  const detail = auth?.requestSnapshot;
  const fiscal = auth?.fiscal;
  if (
    !original?.id ||
    original.verification?.matched !== true ||
    !auth?.cae ||
    ![1, 6].includes(auth.voucherType) ||
    !auth.pointOfSale ||
    !auth.voucherNumber ||
    !detail ||
    !fiscal ||
    auth.pointOfSale !== invoice.pointOfSaleSnapshot ||
    original.issuerCuit !== invoice.issuerCuit
  ) {
    throw Object.assign(
      new Error(
        "La factura original debe estar autorizada, verificada y tener su detalle fiscal completo.",
      ),
      { code: "arca-credit-original-invalid", status: 409 },
    );
  }
  assertSaleMatchesFiscalTotal(invoice.saleSnapshot, fiscal);
  return {
    voucherType: auth.voucherType === 1 ? 3 : 8,
    voucherClass: auth.voucherType === 1 ? "A" : "B",
    voucherReason: "full-sale-cancellation",
    receiverVatConditionId: auth.receiverVatConditionId,
    receiverDocument: auth.receiverDocument,
    fiscal,
    detailBase: {
      ...detail,
      voucherDate,
      associatedVouchers: [
        {
          type: auth.voucherType,
          pointOfSale: auth.pointOfSale,
          number: auth.voucherNumber,
          cuit: original.issuerCuit,
          date: detail.voucherDate,
        },
      ],
    },
    blockers: [],
  };
}
