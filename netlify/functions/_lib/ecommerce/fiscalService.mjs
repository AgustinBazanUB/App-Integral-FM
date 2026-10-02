import { adminGetDocument, adminPatchDocument } from "../firestoreAdminRest.mjs";
import { arcaEnvironment } from "../arca/config.mjs";
import { assertValidCuit } from "../arca/cuit.mjs";
import { buildAuthorizationPlan } from "../arca/authorizationPlan.mjs";
import {
  ensurePendingInvoice,
  syncInvoiceToSale,
} from "../arca/invoicePersistence.mjs";
import { getTaxpayer } from "../arca/registry.mjs";
import {
  consumerFinalReceiver,
  inferReceiverVatCondition,
} from "../arca/receiver.mjs";
import { commerceError, normalizeEcommerceRequestId } from "./commerceDomain.mjs";

function isTrue(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function receiverForConsumerFinal() {
  const resolved = consumerFinalReceiver();
  return {
    vatConditionId: resolved.condition.id,
    documentType: 99,
    documentNumber: "0",
    anonymousConsumerFinal: true,
    concept: 1,
    source: "consumer_final_default",
  };
}

async function receiverForCuit(cuit, {
  env,
  getTaxpayerFn = getTaxpayer,
  inferReceiverFn = inferReceiverVatCondition,
} = {}) {
  const normalizedCuit = assertValidCuit(cuit, "CUIT del receptor");
  if (
    arcaEnvironment(env).id === "production"
    && !isTrue(env.ARCA_ALLOW_PRODUCTION_TAXPAYER_LOOKUP)
  ) {
    throw commerceError(
      "arca-production-taxpayer-lookup-disabled",
      "La consulta productiva de CUIT está bloqueada por configuración.",
      409,
    );
  }
  const taxpayer = await getTaxpayerFn(normalizedCuit, { env });
  const inferred = inferReceiverFn(taxpayer);
  if (!inferred?.resolved || !inferred.condition?.id) {
    throw commerceError(
      "ecommerce-receiver-vat-condition-unresolved",
      "No se pudo determinar de forma segura la condición IVA del CUIT ingresado.",
      409,
    );
  }
  return {
    vatConditionId: Number(inferred.condition.id),
    documentType: 80,
    documentNumber: normalizedCuit,
    anonymousConsumerFinal: false,
    concept: 1,
    source: "arca_taxpayer_lookup",
  };
}

export async function resolveEcommerceReceiver({ cuit = "" } = {}, options = {}) {
  const digits = String(cuit || "").replace(/\D/g, "");
  if (!digits) return receiverForConsumerFinal();
  return receiverForCuit(digits, options);
}

function assertProductionPrepareGate(env = process.env) {
  if (
    arcaEnvironment(env).id === "production"
    && !isTrue(env.ARCA_ALLOW_PRODUCTION_INVOICE_PREPARE)
  ) {
    throw commerceError(
      "arca-production-invoice-prepare-disabled",
      "La preparación de facturas productivas está bloqueada por configuración.",
      409,
    );
  }
}

function assertPaidEcommerceOperation({ order, payment, sale, idempotencyKey }) {
  if (!order || order.sourceType !== "ecommerce") {
    throw commerceError("ecommerce-order-not-found", "El pedido Ecommerce no existe.", 404);
  }
  if (!payment || payment.sourceType !== "ecommerce" || payment.orderId !== order.id) {
    throw commerceError("ecommerce-payment-invalid", "El pago Ecommerce asociado no es válido.", 409);
  }
  if (!sale || sale.sourceType !== "ecommerce" || sale.orderId !== order.id || sale.status !== "active") {
    throw commerceError("ecommerce-sale-invalid", "La venta Ecommerce asociada no es válida.", 409);
  }
  const stable = String(order.idempotencyKey || order.requestId || "");
  if (stable !== idempotencyKey || String(payment.idempotencyKey || "") !== idempotencyKey || String(sale.idempotencyKey || "") !== idempotencyKey) {
    throw commerceError("ecommerce-idempotency-conflict", "La operación fiscal no coincide con la clave de idempotencia.", 409);
  }
  const allowedPayment = (
    order.paymentStatus === "simulated_approved"
      ? order.paymentProvider === "simulation"
      : order.paymentStatus === "approved" && order.paymentProvider === "payway"
  );
  if (!allowedPayment || payment.status !== order.paymentStatus || sale.paymentStatus !== order.paymentStatus) {
    throw commerceError("ecommerce-payment-not-approved", "La venta no tiene un pago aprobado válido para facturar.", 409);
  }
  if (order.saleId !== sale.id || payment.saleId !== sale.id) {
    throw commerceError("ecommerce-sale-link-conflict", "La relación Order/Payment/Sale no es consistente.", 409);
  }
  if (!Number.isFinite(Number(sale.total)) || Number(sale.total) <= 0 || Number(sale.total) !== Number(order.total) || Number(payment.amount) !== Number(order.total)) {
    throw commerceError("ecommerce-total-invalid", "El total de la operación fiscal no es válido.", 409);
  }
  if (!Array.isArray(sale.items) || !sale.items.length) {
    throw commerceError("ecommerce-sale-empty", "La venta Ecommerce no contiene productos.", 409);
  }
}

export async function prepareEcommerceInvoiceFiscal({
  orderId,
  idempotencyKey,
  receiverCuit = "",
  requestedBy,
  requestedByName = null,
  env = process.env,
  now = new Date(),
  getDocument = adminGetDocument,
  patchDocument = adminPatchDocument,
  ensureInvoiceFn = ensurePendingInvoice,
  syncInvoiceFn = syncInvoiceToSale,
  getTaxpayerFn = getTaxpayer,
  inferReceiverFn = inferReceiverVatCondition,
  buildPlanFn = buildAuthorizationPlan,
  mockAuthorizeFn = null,
} = {}) {
  assertProductionPrepareGate(env);
  const stableKey = normalizeEcommerceRequestId(idempotencyKey);
  const safeOrderId = String(orderId || "").trim();
  const orderSnapshot = await getDocument(`orders/${safeOrderId}`, { env });
  const order = orderSnapshot?.data ? { id: safeOrderId, ...orderSnapshot.data } : null;
  const paymentId = String(order?.paymentId || "").trim();
  const saleId = String(order?.saleId || "").trim();
  const [paymentSnapshot, saleSnapshot] = await Promise.all([
    paymentId ? getDocument(`payments/${paymentId}`, { env }) : null,
    saleId ? getDocument(`sales/${saleId}`, { env }) : null,
  ]);
  const payment = paymentSnapshot?.data ? { id: paymentId, ...paymentSnapshot.data } : null;
  const sale = saleSnapshot?.data ? { id: saleId, ...saleSnapshot.data } : null;
  assertPaidEcommerceOperation({ order, payment, sale, idempotencyKey: stableKey });

  const receiver = await resolveEcommerceReceiver({ cuit: receiverCuit }, {
    env,
    getTaxpayerFn,
    inferReceiverFn,
  });

  const invoiceResult = await ensureInvoiceFn({
    sourceType: "ecommerce",
    sourceId: saleId,
    requestedBy,
    requestedByName,
    receiver,
    env,
    now,
    getDocument,
  });

  await syncInvoiceFn({
    invoiceId: invoiceResult.invoiceId,
    env,
    now,
    getDocument,
    patchDocument,
  });

  const issuerVatCondition = String(env.ARCA_ISSUER_VAT_CONDITION || "").trim();
  if (!issuerVatCondition) {
    throw commerceError(
      "arca-issuer-vat-condition-missing",
      "Falta configurar la condición IVA del emisor.",
      409,
    );
  }
  const threshold = Number(env.ARCA_CONSUMER_FINAL_ID_THRESHOLD || 10000000);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw commerceError(
      "arca-consumer-final-threshold-invalid",
      "El umbral de identificación de Consumidor Final no es válido.",
      409,
    );
  }

  const plan = buildPlanFn({
    invoice: invoiceResult.invoice,
    issuerVatCondition,
    receiverVatConditionId: receiver.vatConditionId,
    documentType: receiver.documentType,
    documentNumber: receiver.documentNumber,
    anonymousConsumerFinal: receiver.anonymousConsumerFinal,
    voucherDate: now,
    concept: receiver.concept,
    consumerFinalIdThreshold: threshold,
  });

  let mockAuthorization = null;
  if (typeof mockAuthorizeFn === "function") {
    if (String(env.NODE_ENV || "").trim().toLowerCase() !== "test") {
      throw commerceError(
        "ecommerce-mock-authorize-test-only",
        "La autorización fiscal mock sólo puede inyectarse durante tests.",
        403,
      );
    }
    mockAuthorization = await mockAuthorizeFn({
      invoiceId: invoiceResult.invoiceId,
      invoice: invoiceResult.invoice,
      receiver,
      plan,
    });
  }

  const updatedAt = now instanceof Date ? now : new Date(now);
  try {
    await patchDocument(`orders/${safeOrderId}`, {
      invoiceId: invoiceResult.invoiceId,
      invoiceStatus: invoiceResult.invoice?.status || "pending",
      fiscalEnvironment: invoiceResult.invoice?.fiscalEnvironment || arcaEnvironment(env).id,
      updatedAt,
    }, {
      env,
      currentUpdateTime: orderSnapshot.updateTime || null,
    });
  } catch (error) {
    if (error?.code !== "firebase-admin-precondition-failed") throw error;
    const raced = await getDocument(`orders/${safeOrderId}`, { env });
    if (raced?.data?.invoiceId !== invoiceResult.invoiceId) throw error;
  }

  return {
    invoiceId: invoiceResult.invoiceId,
    invoiceCreated: invoiceResult.created,
    invoiceStatus: invoiceResult.invoice?.status || "pending",
    fiscalEnvironment: invoiceResult.invoice?.fiscalEnvironment || arcaEnvironment(env).id,
    receiver,
    fiscal: {
      mode: mockAuthorization ? "mock-authorize-test" : "dry-run-no-cae",
      transport: "blocked",
      caeRequested: false,
      voucherType: plan.voucherType,
      voucherClass: plan.voucherClass,
      blockers: plan.blockers || [],
      total: plan.fiscal?.total ?? null,
      net: plan.fiscal?.net ?? null,
      vat: plan.fiscal?.vat ?? null,
      mockAuthorization,
    },
  };
}
