import { authorizeInvoice, reconcileInvoice, verifyAuthorizedInvoice } from "../arca/authorizer.mjs";
import { arcaSafeStatus } from "../arca/config.mjs";
import { syncInvoiceToSale } from "../arca/invoicePersistence.mjs";
import { adminGetDocument } from "../firestoreAdminRest.mjs";
import { normalizeBilling } from "./channelService.mjs";
import { commerceError } from "./commerceDomain.mjs";
import {
  assertRequestedInvoiceClass,
  prepareEcommerceInvoiceFiscal,
  resolveEcommerceReceiver,
} from "./fiscalService.mjs";
import { paywayConfig } from "./paywayGateway.mjs";

function assertHomologationReady(env, { requireCae = false } = {}) {
  const status = arcaSafeStatus(env);
  if (!status.issuerConfigured || !status.pointOfSaleConfigured ||
      !status.issuerVatConditionConfigured || !status.credentialsReady ||
      (requireCae && !status.caeHomologationEnabled)) {
    throw commerceError("ecommerce-arca-homologation-unavailable", "La configuración de ARCA homologación está incompleta.", 503);
  }
}

export async function validatePaywayInvoiceA(rawBilling, {
  env = process.env,
  checkReadiness = assertHomologationReady,
  resolveReceiver = resolveEcommerceReceiver,
} = {}) {
  if (rawBilling?.mode !== "fiscal" || rawBilling.requestedClass !== "A") return;
  paywayConfig(env);
  const billing = normalizeBilling(rawBilling);
  checkReadiness(env);
  const receiver = await resolveReceiver({ cuit: billing.cuit }, { env });
  assertRequestedInvoiceClass(billing, receiver, env);
}

export async function requestPaywayInvoice({
  orderId,
  order,
  env = process.env,
  checkReadiness = assertHomologationReady,
  getDocument = adminGetDocument,
  prepare = prepareEcommerceInvoiceFiscal,
  authorize = authorizeInvoice,
  reconcile = reconcileInvoice,
  verify = verifyAuthorizedInvoice,
  sync = syncInvoiceToSale,
} = {}) {
  paywayConfig(env);
  if (order?.sourceType !== "ecommerce" || order.paymentProvider !== "payway" ||
      order.paymentEnvironment !== "sandbox" || order.paymentStatus !== "approved" || !order.saleId) {
    throw commerceError("ecommerce-payment-not-approved", "El pedido todavía no tiene un pago aprobado.", 409);
  }
  checkReadiness(env, { requireCae: true });

  let invoiceId = order.invoiceId;
  let invoice = invoiceId ? (await getDocument(`invoices/${invoiceId}`, { env }))?.data : null;
  if (invoice && (invoice.fiscalEnvironment !== "homologation" ||
      invoice.sourceType !== "ecommerce" || invoice.sourceId !== order.saleId)) {
    throw commerceError("ecommerce-sale-invoice-conflict", "La factura no corresponde al pedido.", 409);
  }
  if (!invoice) {
    const prepared = await prepare({
      orderId,
      idempotencyKey: order.idempotencyKey,
      requestedByName: "Tienda Flor Mía",
      env,
    });
    invoiceId = prepared.invoiceId;
    invoice = (await getDocument(`invoices/${invoiceId}`, { env }))?.data;
  }
  const actions = { invoiceId, env };
  let invoiceStatus = invoice?.status || "pending";
  if (invoiceStatus === "authorized" && invoice.verification?.matched === true) {
    if (order.invoiceStatus !== "authorized") await sync(actions);
    return { invoiceStatus, documentAvailable: true };
  }
  if (invoiceStatus === "reconciling") {
    invoiceStatus = (await reconcile(actions)).status;
  } else if (invoiceStatus === "pending") {
    const result = await authorize({
      ...actions,
      issuerVatCondition: env.ARCA_ISSUER_VAT_CONDITION,
      allowCaeRequest: true,
    });
    invoiceStatus = result.status;
  }
  let documentAvailable = false;
  if (invoiceStatus === "authorized") {
    documentAvailable = (await verify(actions)).matched === true;
  }
  await sync(actions);
  return { invoiceStatus, documentAvailable };
}
