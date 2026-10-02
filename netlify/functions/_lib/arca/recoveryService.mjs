import { adminGetDocument } from "../firestoreAdminRest.mjs";
import { reconcileInvoice, recoverPreCaeInvoice, authorizeInvoice } from "./authorizer.mjs";
import { syncInvoiceToSale } from "./invoicePersistence.mjs";

// Reviewing never issues a CAE. A later explicit authorization still passes
// through the same environment, scope, backoff, claim and sequence gates.
export async function reviewFiscalInvoice({ invoiceId, receiver = null, env = process.env,
  getDocument = adminGetDocument, reconcileFn = reconcileInvoice,
  recoverFn = recoverPreCaeInvoice, dryRunFn = authorizeInvoice,
  syncFn = syncInvoiceToSale } = {}) {
  const current = await getDocument(`invoices/${invoiceId}`, { env });
  if (!current) { const error = new Error("La solicitud fiscal no existe."); error.code = "arca-invoice-not-found"; error.status = 404; throw error; }
  let result;
  if (["authorized", "rejected"].includes(current.data.status)) {
    result = { status: current.data.status, terminal: true, invoice: current.data };
  } else if (current.data.status === "reconciling" || current.data.authorization?.voucherNumber) {
    result = await reconcileFn({ invoiceId, env });
  } else if (current.data.status === "authorizing") {
    result = await recoverFn({ invoiceId, env });
  } else {
    result = await dryRunFn({ invoiceId, receiver, env, issuerVatCondition: env.ARCA_ISSUER_VAT_CONDITION,
      allowCaeRequest: false });
  }
  await syncFn({ invoiceId, env });
  return { ...result, caeRequested: false };
}
