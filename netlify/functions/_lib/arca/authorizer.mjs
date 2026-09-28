import { adminGetDocument } from "../firestoreAdminRest.mjs";
import { buildAuthorizationPlan } from "./authorizationPlan.mjs";
import {
  claimPendingInvoice,
  markInvoiceAuthorized,
  markInvoiceError,
  markInvoiceReconciling,
  markInvoiceRejected,
  markInvoiceVerified,
  persistAuthorizationPlan,
  returnInvoiceToPending,
} from "./invoicePersistence.mjs";
import {
  acquireSequenceLock,
  releaseSequenceLock,
} from "./sequenceLock.mjs";
import {
  consultVoucher,
  getLastAuthorized,
  requestCae,
} from "./wsfe.mjs";
import { loadArcaPublicConfig } from "./config.mjs";

function invoicePath(invoiceId) {
  return `invoices/${invoiceId}`;
}

function isNetworkUncertain(error) {
  return ["arca-network-error", "arca-timeout"].includes(error?.code);
}

function compactError(error) {
  return {
    code: error?.code || "arca-authorization-error",
    message: String(error?.message || "Falló la autorización fiscal.").slice(0, 500),
  };
}

function arcaMessages(list = []) {
  return (Array.isArray(list) ? list : []).map((item) => ({
    code: Number(item?.code || 0),
    message: String(item?.message || "").slice(0, 500),
  }));
}

async function reconcilePlannedVoucher({
  invoiceId,
  plannedDocument,
  env,
  consultVoucherFn,
  markAuthorizedFn,
  markReconcilingFn,
}) {
  const authorization = plannedDocument.data?.authorization || {};
  const voucherType = Number(authorization.voucherType || 0);
  const pointOfSale = Number(authorization.pointOfSale || 0);
  const voucherNumber = Number(authorization.voucherNumber || 0);

  if (!voucherType || !pointOfSale || !voucherNumber) {
    return markReconcilingFn({
      invoiceId,
      expectedUpdateTime: plannedDocument.updateTime,
      errorCode: "arca-reconciliation-plan-incomplete",
      errorMessage: "No hay datos suficientes para reconciliar el comprobante.",
      env,
    });
  }

  try {
    const consulted = await consultVoucherFn({
      voucherType,
      pointOfSale,
      voucherNumber,
      env,
    });

    if (consulted?.cae) {
      return markAuthorizedFn({
        invoiceId,
        expectedUpdateTime: plannedDocument.updateTime,
        baseAuthorization: authorization,
        cae: consulted.cae,
        caeExpiration: consulted.caeExpiration,
        result: consulted.result || "A",
        observations: [],
        env,
      });
    }

    return markReconcilingFn({
      invoiceId,
      expectedUpdateTime: plannedDocument.updateTime,
      errorCode: "arca-reconciliation-not-confirmed",
      errorMessage: "ARCA todavía no confirmó el comprobante planificado. No se reenviará automáticamente.",
      env,
    });
  } catch (error) {
    return markReconcilingFn({
      invoiceId,
      expectedUpdateTime: plannedDocument.updateTime,
      errorCode: error?.code || "arca-reconciliation-error",
      errorMessage: error?.message || "No se pudo reconciliar la respuesta incierta de ARCA.",
      env,
    });
  }
}

export async function authorizeInvoice({
  invoiceId,
  issuerVatCondition,
  receiver,
  allowCaeRequest = false,
  env = process.env,
  now = new Date(),
  getDocument = adminGetDocument,
  claimInvoiceFn = claimPendingInvoice,
  acquireLockFn = acquireSequenceLock,
  releaseLockFn = releaseSequenceLock,
  persistPlanFn = persistAuthorizationPlan,
  markAuthorizedFn = markInvoiceAuthorized,
  markRejectedFn = markInvoiceRejected,
  markReconcilingFn = markInvoiceReconciling,
  markErrorFn = markInvoiceError,
  returnPendingFn = returnInvoiceToPending,
  getLastAuthorizedFn = getLastAuthorized,
  requestCaeFn = requestCae,
  consultVoucherFn = consultVoucher,
} = {}) {
  if (!invoiceId) {
    const error = new Error("Falta identificar la solicitud fiscal.");
    error.code = "arca-invoice-id-missing";
    error.status = 400;
    throw error;
  }

  const current = await getDocument(invoicePath(invoiceId), { env });
  if (!current) {
    const error = new Error("La solicitud fiscal no existe.");
    error.code = "arca-invoice-not-found";
    error.status = 404;
    throw error;
  }

  if (current.data?.status === "authorized") {
    return {
      status: "authorized",
      alreadyAuthorized: true,
      invoice: current.data,
    };
  }

  if (current.data?.status === "reconciling") {
    return {
      status: "reconciling",
      needsReconciliation: true,
      invoice: current.data,
    };
  }

  if (current.data?.status !== "pending") {
    return {
      status: current.data?.status || "unknown",
      blocked: true,
      reason: "invoice-not-pending",
      invoice: current.data,
    };
  }

  const savedReceiver = current.data?.receiverSnapshot || {};
  const effectiveReceiver = {
    vatConditionId: receiver?.vatConditionId || savedReceiver.vatConditionId,
    documentType: receiver?.documentType || savedReceiver.documentType,
    documentNumber: receiver?.documentNumber || savedReceiver.documentNumber,
    anonymousConsumerFinal: receiver?.anonymousConsumerFinal === true
      || (receiver?.anonymousConsumerFinal == null && savedReceiver.anonymousConsumerFinal === true),
    concept: receiver?.concept || savedReceiver.concept || 1,
  };
  const thresholdRaw = String(env.ARCA_CONSUMER_FINAL_ID_THRESHOLD || "10000000").trim();
  const threshold = Number(thresholdRaw);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    const error = new Error("ARCA_CONSUMER_FINAL_ID_THRESHOLD debe ser un importe válido.");
    error.code = "arca-consumer-final-threshold-invalid";
    throw error;
  }

  const plan = buildAuthorizationPlan({
    invoice: current.data,
    issuerVatCondition,
    receiverVatConditionId: effectiveReceiver.vatConditionId,
    documentType: effectiveReceiver.documentType,
    documentNumber: effectiveReceiver.documentNumber,
    anonymousConsumerFinal: effectiveReceiver.anonymousConsumerFinal,
    voucherDate: now,
    concept: effectiveReceiver.concept,
    consumerFinalIdThreshold: threshold,
  });

  if (plan.blockers.length) {
    return {
      status: "pending",
      blocked: true,
      blockers: plan.blockers,
      plan,
    };
  }

  if (!allowCaeRequest) {
    return {
      status: "pending",
      dryRun: true,
      plan,
    };
  }

  const config = loadArcaPublicConfig(env);
  if (config.environment !== "homologation") {
    const error = new Error("La autorización automática está bloqueada fuera de homologación.");
    error.code = "arca-production-authorization-blocked";
    error.status = 409;
    throw error;
  }

  const claim = await claimInvoiceFn({
    invoiceId,
    claimedBy: receiver?.requestedBy || "arca-authorizer",
    env,
    now,
  });

  if (!claim.claimed) {
    return {
      status: claim.invoice?.status || "unknown",
      claimed: false,
      reason: claim.reason,
      invoice: claim.invoice,
    };
  }

  let lock = null;
  let plannedDocument = null;

  try {
    lock = await acquireLockFn({
      pointOfSale: config.pointOfSale,
      voucherType: plan.voucherType,
      holder: claim.attemptId,
      leaseMs: 120000,
      env,
      now,
    });

    if (!lock.acquired) {
      const returned = await returnPendingFn({
        invoiceId,
        expectedUpdateTime: claim.updateTime,
        errorCode: "arca-sequence-busy",
        errorMessage: "Otra factura está usando la secuencia fiscal. Reintentá en unos segundos.",
        env,
        now,
      });
      return {
        status: returned.data?.status || "pending",
        claimed: true,
        lockAcquired: false,
        reason: lock.reason,
      };
    }

    let last;
    try {
      last = await getLastAuthorizedFn({
        voucherType: plan.voucherType,
        pointOfSale: config.pointOfSale,
        env,
      });
    } catch (error) {
      const compact = compactError(error);
      const returned = await returnPendingFn({
        invoiceId,
        expectedUpdateTime: claim.updateTime,
        errorCode: compact.code,
        errorMessage: `No se pudo consultar el último comprobante autorizado antes de pedir CAE: ${compact.message}`,
        env,
        now,
      });
      return {
        status: returned.data?.status || "pending",
        retryable: true,
        phase: "last-authorized",
        error: compact,
      };
    }

    if (last.errors?.length) {
      const returned = await returnPendingFn({
        invoiceId,
        expectedUpdateTime: claim.updateTime,
        errorCode: "arca-last-authorized-error",
        errorMessage: last.errors.map((item) => item.message).join(" · "),
        env,
        now,
      });
      return {
        status: returned.data?.status || "pending",
        reason: "last-authorized-error",
        errors: arcaMessages(last.errors),
      };
    }

    const voucherNumber = Number(last.number || 0) + 1;
    plannedDocument = await persistPlanFn({
      invoiceId,
      expectedUpdateTime: claim.updateTime,
      pointOfSale: config.pointOfSale,
      voucherType: plan.voucherType,
      voucherNumber,
      voucherClass: plan.voucherClass,
      receiverVatConditionId: plan.receiverVatConditionId,
      receiverDocument: plan.receiverDocument,
      fiscal: plan.fiscal,
      attemptId: claim.attemptId,
      env,
      now,
    });

    let caeResponse;
    try {
      caeResponse = await requestCaeFn({
        voucherType: plan.voucherType,
        pointOfSale: config.pointOfSale,
        details: [{
          ...plan.detailBase,
          voucherFrom: voucherNumber,
          voucherTo: voucherNumber,
        }],
        env,
      });
    } catch (error) {
      if (isNetworkUncertain(error)) {
        const reconciled = await reconcilePlannedVoucher({
          invoiceId,
          plannedDocument,
          env,
          consultVoucherFn,
          markAuthorizedFn,
          markReconcilingFn,
        });
        return {
          status: reconciled.data?.status || "reconciling",
          uncertain: true,
          reconciled: reconciled.data?.status === "authorized",
        };
      }

      const compact = compactError(error);
      const failed = await markErrorFn({
        invoiceId,
        expectedUpdateTime: plannedDocument.updateTime,
        errorCode: compact.code,
        errorMessage: compact.message,
        env,
        now,
      });
      return {
        status: failed.data?.status || "error",
        error: compact,
      };
    }

    if (caeResponse?.result === "A" && caeResponse?.cae) {
      const authorized = await markAuthorizedFn({
        invoiceId,
        expectedUpdateTime: plannedDocument.updateTime,
        baseAuthorization: plannedDocument.data?.authorization || {},
        cae: caeResponse.cae,
        caeExpiration: caeResponse.caeExpiration,
        result: caeResponse.result,
        observations: arcaMessages(caeResponse.observations),
        env,
        now,
      });
      return {
        status: "authorized",
        invoice: authorized.data,
      };
    }

    const rejected = await markRejectedFn({
      invoiceId,
      expectedUpdateTime: plannedDocument.updateTime,
      baseAuthorization: plannedDocument.data?.authorization || {},
      result: caeResponse?.result || "R",
      observations: arcaMessages(caeResponse?.observations),
      errors: arcaMessages(caeResponse?.errors),
      env,
      now,
    });
    return {
      status: rejected.data?.status || "rejected",
      invoice: rejected.data,
    };
  } finally {
    if (lock?.acquired) {
      await releaseLockFn({
        pointOfSale: config.pointOfSale,
        voucherType: plan.voucherType,
        holder: claim.attemptId,
        expectedUpdateTime: lock.updateTime,
        env,
        now: new Date(),
      }).catch(() => {});
    }
  }
}

export async function reconcileInvoice({
  invoiceId,
  env = process.env,
  getDocument = adminGetDocument,
  consultVoucherFn = consultVoucher,
  markAuthorizedFn = markInvoiceAuthorized,
  markReconcilingFn = markInvoiceReconciling,
} = {}) {
  const current = await getDocument(invoicePath(invoiceId), { env });
  if (!current) {
    const error = new Error("La solicitud fiscal no existe.");
    error.code = "arca-invoice-not-found";
    error.status = 404;
    throw error;
  }
  if (current.data?.status === "authorized") {
    return { status: "authorized", alreadyAuthorized: true, invoice: current.data };
  }
  if (current.data?.status !== "reconciling") {
    return {
      status: current.data?.status || "unknown",
      blocked: true,
      reason: "invoice-not-reconciling",
    };
  }

  const result = await reconcilePlannedVoucher({
    invoiceId,
    plannedDocument: current,
    env,
    consultVoucherFn,
    markAuthorizedFn,
    markReconcilingFn,
  });

  return {
    status: result.data?.status || "reconciling",
    invoice: result.data,
  };
}


export async function recoverPreCaeInvoice({
  invoiceId,
  env = process.env,
  getDocument = adminGetDocument,
  returnPendingFn = returnInvoiceToPending,
  now = new Date(),
} = {}) {
  if (!invoiceId) {
    const error = new Error("Falta identificar la solicitud fiscal.");
    error.code = "arca-invoice-id-missing";
    error.status = 400;
    throw error;
  }

  const current = await getDocument(invoicePath(invoiceId), { env });
  if (!current) {
    const error = new Error("La solicitud fiscal no existe.");
    error.code = "arca-invoice-not-found";
    error.status = 404;
    throw error;
  }

  const authorization = current.data?.authorization || {};
  if (current.data?.status !== "authorizing") {
    return {
      status: current.data?.status || "unknown",
      recovered: false,
      reason: "invoice-not-authorizing",
      invoice: current.data,
    };
  }

  if (authorization.voucherNumber || authorization.cae || authorization.plannedAt) {
    return {
      status: "authorizing",
      recovered: false,
      reason: "pre-cae-recovery-not-safe",
      invoice: current.data,
    };
  }

  const returned = await returnPendingFn({
    invoiceId,
    expectedUpdateTime: current.updateTime,
    errorCode: "arca-pre-cae-recovered",
    errorMessage: "Se recuperó un intento interrumpido antes de reservar número y antes de solicitar CAE. Puede reintentarse cuando ARCA esté disponible.",
    env,
    now,
  });

  return {
    status: returned.data?.status || "pending",
    recovered: true,
    invoice: returned.data,
  };
}


export async function verifyAuthorizedInvoice({
  invoiceId,
  env = process.env,
  getDocument = adminGetDocument,
  consultVoucherFn = consultVoucher,
  markVerifiedFn = markInvoiceVerified,
  now = new Date(),
} = {}) {
  if (!invoiceId) {
    const error = new Error("Falta identificar la solicitud fiscal.");
    error.code = "arca-invoice-id-missing";
    error.status = 400;
    throw error;
  }

  const current = await getDocument(invoicePath(invoiceId), { env });
  if (!current) {
    const error = new Error("La solicitud fiscal no existe.");
    error.code = "arca-invoice-not-found";
    error.status = 404;
    throw error;
  }

  if (current.data?.status !== "authorized") {
    return {
      verified: false,
      matched: false,
      status: current.data?.status || "unknown",
      reason: "invoice-not-authorized",
      invoice: current.data,
    };
  }

  const authorization = current.data?.authorization || {};
  const pointOfSale = Number(authorization.pointOfSale || 0);
  const voucherType = Number(authorization.voucherType || 0);
  const voucherNumber = Number(authorization.voucherNumber || 0);
  const expectedCae = String(authorization.cae || "");
  const expectedExpiration = String(authorization.caeExpiration || "");

  if (!pointOfSale || !voucherType || !voucherNumber || !expectedCae) {
    const error = new Error("La factura autorizada no tiene todos los datos necesarios para verificarla.");
    error.code = "arca-authorized-invoice-incomplete";
    error.status = 409;
    throw error;
  }

  const consulted = await consultVoucherFn({
    voucherType,
    pointOfSale,
    voucherNumber,
    env,
  });

  const compactErrors = arcaMessages(consulted?.errors);
  const compactEvents = arcaMessages(consulted?.events);
  const consultedCae = String(consulted?.cae || "");
  const consultedExpiration = String(consulted?.caeExpiration || "");
  const consultedNumber = Number(consulted?.voucherNumber || 0);

  const matched = (
    compactErrors.length === 0
    && consulted?.result === "A"
    && consultedCae === expectedCae
    && consultedNumber === voucherNumber
    && (!expectedExpiration || !consultedExpiration || consultedExpiration === expectedExpiration)
  );

  const persisted = await markVerifiedFn({
    invoiceId,
    expectedUpdateTime: current.updateTime,
    matched,
    result: consulted?.result || null,
    cae: consultedCae || null,
    caeExpiration: consultedExpiration || null,
    pointOfSale,
    voucherType,
    voucherNumber: consultedNumber || voucherNumber,
    errors: compactErrors,
    events: compactEvents,
    env,
    now,
  });

  return {
    verified: true,
    matched,
    status: persisted.data?.status || "authorized",
    verification: persisted.data?.verification || null,
    expected: {
      pointOfSale,
      voucherType,
      voucherNumber,
      cae: expectedCae,
      caeExpiration: expectedExpiration || null,
    },
  };
}
