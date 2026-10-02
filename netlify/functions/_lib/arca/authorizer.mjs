import { adminGetDocument } from "../firestoreAdminRest.mjs";
import { classifyFiscalFailure, fiscalRecovery, safeFiscalError } from "../../../../src/shared/fiscalRecovery.mjs";
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
import {
  arcaEnvironment,
  loadArcaPublicConfig,
  productionAutoAuthorizeSources,
} from "./config.mjs";

function invoicePath(invoiceId) {
  return `invoices/${invoiceId}`;
}

function invoiceEnvironment(invoice = {}) {
  return String(invoice.fiscalEnvironment || "homologation").trim().toLowerCase();
}

function assertInvoiceEnvironment(invoice, env = process.env) {
  const runtimeEnvironment = arcaEnvironment(env).id;
  const storedEnvironment = invoiceEnvironment(invoice);
  if (storedEnvironment !== runtimeEnvironment) {
    const error = new Error(
      `La solicitud fiscal pertenece a ${storedEnvironment} y no puede operarse desde ${runtimeEnvironment}.`
    );
    error.code = "arca-invoice-environment-mismatch";
    error.status = 409;
    error.invoiceEnvironment = storedEnvironment;
    error.runtimeEnvironment = runtimeEnvironment;
    throw error;
  }
  return storedEnvironment;
}

function compactError(error) {
  return safeFiscalError(error);
}

function arcaMessages(list = []) {
  return (Array.isArray(list) ? list : []).map((item) => ({
    code: Number(item?.code || 0),
    message: `ARCA informó el código ${Number(item?.code || 0)}.`,
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
      attemptCount: Number(plannedDocument.data?.recovery?.attemptCount || 0),
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

    if (voucherMatchesAuthorization(consulted, authorization)) {
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
      attemptCount: Number(plannedDocument.data?.recovery?.attemptCount || 0),
      env,
    });
  } catch (error) {
    return markReconcilingFn({
      invoiceId,
      expectedUpdateTime: plannedDocument.updateTime,
      errorCode: error?.code || "arca-reconciliation-error",
      errorMessage: error?.message || "No se pudo reconciliar la respuesta incierta de ARCA.",
      attemptCount: Number(plannedDocument.data?.recovery?.attemptCount || 0),
      env,
    });
  }
}

export function voucherMatchesAuthorization(consulted = {}, authorization = {}) {
  const request = authorization.requestSnapshot;
  // Legacy plans without the submitted identity cannot be auto-associated.
  return Boolean(request && consulted.result === "A" && /^\d{14}$/.test(String(consulted.cae || ""))
    && /^\d{8}$/.test(String(consulted.caeExpiration || "")) && !consulted.errors?.length
    && consulted.pointOfSale === authorization.pointOfSale && consulted.voucherType === authorization.voucherType
    && consulted.voucherNumber === authorization.voucherNumber && consulted.voucherTo === authorization.voucherNumber
    && consulted.docType === request.docType && String(consulted.docNumber) === String(request.docNumber)
    && consulted.voucherDate === request.voucherDate && consulted.currencyId === request.currencyId
    && Number(consulted.currencyQuote) === Number(request.currencyQuote)
    && ["total", "net", "vat", "nonTaxed", "exempt", "tributes"].every((key) =>
      Number.isFinite(consulted[key]) && Math.round(consulted[key] * 100) === Math.round(Number(request[key] || 0) * 100)));
}

export async function authorizeInvoice({
  invoiceId,
  issuerVatCondition,
  receiver,
  allowCaeRequest = false,
  automaticRequest = false,
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

  assertInvoiceEnvironment(current.data, env);

  if (current.data?.status === "authorized") {
    return {
      status: "authorized",
      alreadyAuthorized: true,
      invoice: current.data,
    };
  }

  if (current.data?.status === "reconciling" || (current.data?.status !== "authorized" && current.data?.status !== "rejected" && current.data?.authorization?.voucherNumber)) {
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
  if (receiver && Object.keys(savedReceiver).length && ["vatConditionId", "documentType", "documentNumber", "anonymousConsumerFinal", "concept"].some((key) => receiver[key] != null && String(receiver[key]) !== String(savedReceiver[key]))) {
    const error = new Error("El receptor no coincide con el snapshot fiscal.");
    error.code = "arca-receiver-conflict"; error.status = 409; throw error;
  }
  const effectiveReceiver = {
    vatConditionId: receiver?.vatConditionId || savedReceiver.vatConditionId,
    documentType: receiver?.documentType || savedReceiver.documentType,
    documentNumber: receiver?.documentNumber || savedReceiver.documentNumber,
    anonymousConsumerFinal: receiver?.anonymousConsumerFinal === true
      || (receiver?.anonymousConsumerFinal == null && savedReceiver.anonymousConsumerFinal === true),
    concept: receiver?.concept || savedReceiver.concept || 1,
  };
  const thresholdRaw = String(env.ARCA_CONSUMER_FINAL_ID_THRESHOLD || "").trim();
  const threshold = Number(thresholdRaw);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    const error = new Error("ARCA_CONSUMER_FINAL_ID_THRESHOLD debe ser un importe válido.");
    error.code = "arca-consumer-final-threshold-invalid";
    throw error;
  }

  let plan;
  try { plan = buildAuthorizationPlan({
    invoice: current.data,
    issuerVatCondition,
    receiverVatConditionId: effectiveReceiver.vatConditionId,
    documentType: effectiveReceiver.documentType,
    documentNumber: effectiveReceiver.documentNumber,
    anonymousConsumerFinal: effectiveReceiver.anonymousConsumerFinal,
    voucherDate: now,
    concept: effectiveReceiver.concept,
    consumerFinalIdThreshold: threshold,
  }); } catch (error) {
    return { status: "pending", blocked: true, classification: "VALIDATION", error: compactError(error) };
  }

  if (plan.blockers.length) {
    return {
      status: "pending",
      blocked: true,
      blockers: plan.blockers,
      plan,
      classification: "VALIDATION",
    };
  }

  if (!allowCaeRequest) {
    return {
      status: "pending",
      dryRun: true,
      plan,
    };
  }

  const recovery = current.data.recovery || {};
  if (recovery.classification === "TEMPORARY" && (!recovery.retryable || Date.parse(recovery.nextRetryAt || "") > now.getTime())) {
    return { status: "pending", blocked: true, reason: "retry-not-due-or-exhausted", recovery };
  }

  const config = loadArcaPublicConfig(env);
  if (config.environment === "production") {
    const productionCaeEnabled = String(env.ARCA_ALLOW_PRODUCTION_CAE || "")
      .trim()
      .toLowerCase() === "true";
    const automaticProduction = String(env.ARCA_AUTO_AUTHORIZE_PRODUCTION || "")
      .trim()
      .toLowerCase() === "true";
    const automaticSources = productionAutoAuthorizeSources(env);
    const targetSaleCode = String(env.ARCA_PRODUCTION_CAE_SALE_CODE || "").trim();
    const invoiceSaleCode = String(current.data?.saleSnapshot?.saleCode || "").trim();
    const invoiceSourceType = String(current.data?.sourceType || "").trim().toLowerCase();

    if (!productionCaeEnabled) {
      const error = new Error("La autorización de CAE productivo está bloqueada por configuración.");
      error.code = "arca-production-authorization-blocked";
      error.status = 409;
      throw error;
    }

    if (targetSaleCode) {
      if (!invoiceSaleCode || invoiceSaleCode !== targetSaleCode) {
        const error = new Error("La solicitud fiscal no coincide con la venta productiva habilitada para CAE.");
        error.code = "arca-production-cae-target-mismatch";
        error.status = 409;
        throw error;
      }
    } else if (automaticRequest === true) {
      if (!automaticProduction) {
        const error = new Error("La autorización automática productiva está deshabilitada.");
        error.code = "arca-production-auto-disabled";
        error.status = 409;
        throw error;
      }
      if (!automaticSources.includes(invoiceSourceType)) {
        const error = new Error("El origen de esta venta no está habilitado para autorización automática productiva.");
        error.code = "arca-production-auto-source-blocked";
        error.status = 409;
        throw error;
      }
    } else {
      const error = new Error("La autorización manual productiva exige una venta objetivo exacta.");
      error.code = "arca-production-cae-scope-missing";
      error.status = 409;
      throw error;
    }
  } else if (config.environment !== "homologation") {
    const error = new Error("Entorno fiscal no autorizado para emisión.");
    error.code = "arca-authorization-environment-blocked";
    error.status = 409;
    throw error;
  }
  if (config.environment === "homologation" && String(env.ARCA_ALLOW_CAE_HOMOLOGATION || "").toLowerCase() !== "true") {
    const error = new Error("La emisión de homologación está deshabilitada.");
    error.code = "arca-cae-disabled"; error.status = 409; throw error;
  }
  if ((current.data.issuerCuit && String(current.data.issuerCuit) !== config.issuerCuit)
    || (current.data.pointOfSaleSnapshot && Number(current.data.pointOfSaleSnapshot) !== config.pointOfSale)) {
    const error = new Error("El emisor o punto de venta no coincide con el snapshot fiscal.");
    error.code = "arca-invoice-scope-mismatch"; error.status = 409; throw error;
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
  let resolved = false;
  const attemptCount = Number(claim.invoice?.recovery?.attemptCount || recovery.attemptCount + 1 || 1);

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
        attemptCount,
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
      const classification = classifyFiscalFailure(error);
      if (classification !== "TEMPORARY") {
        const failed = await markErrorFn({ invoiceId, expectedUpdateTime: claim.updateTime, errorCode: compact.code, env, now });
        return { status: failed.data?.status || "error", classification, error: compact };
      }
      const returned = await returnPendingFn({
        invoiceId,
        expectedUpdateTime: claim.updateTime,
        errorCode: compact.code,
        errorMessage: `No se pudo consultar el último comprobante autorizado antes de pedir CAE: ${compact.message}`,
        env,
        now,
        attemptCount,
      });
      return {
        status: returned.data?.status || "pending",
        retryable: attemptCount < 3,
        phase: "last-authorized",
        error: compact,
      };
    }

    if (last.errors?.length) {
      const returned = await markErrorFn({
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
        classification: "VALIDATION",
      };
    }

    const voucherNumber = Number(last.number || 0) + 1;
    if (!Number.isSafeInteger(last.number) || last.number < 0) {
      const error = new Error("La respuesta de numeración fiscal no es válida.");
      error.code = "arca-last-authorized-invalid"; error.status = 409; throw error;
    }
    plannedDocument = await persistPlanFn({
      invoiceId,
      expectedUpdateTime: claim.updateTime,
      pointOfSale: config.pointOfSale,
      voucherType: plan.voucherType,
      voucherNumber,
      voucherClass: plan.voucherClass,
      receiverVatConditionId: plan.receiverVatConditionId,
      receiverDocument: plan.receiverDocument,
      receiverSnapshot: { vatConditionId: plan.receiverVatConditionId, documentType: plan.receiverDocument.documentType,
        documentNumber: plan.receiverDocument.documentNumber, anonymousConsumerFinal: effectiveReceiver.anonymousConsumerFinal === true, concept: Number(effectiveReceiver.concept || 1) },
      fiscal: plan.fiscal,
      attemptId: claim.attemptId,
      sequenceLock: lock,
      requestSnapshot: plan.detailBase,
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
      {
        const reconciled = await reconcilePlannedVoucher({
          invoiceId,
          plannedDocument,
          env,
          consultVoucherFn,
          markAuthorizedFn,
          markReconcilingFn,
        });
        resolved = reconciled.data?.status === "authorized";
        return {
          status: reconciled.data?.status || "reconciling",
          uncertain: true,
          reconciled: reconciled.data?.status === "authorized",
        };
      }

    }

    if (caeResponse?.result === "A" && /^\d{14}$/.test(String(caeResponse?.cae || "")) && /^\d{8}$/.test(String(caeResponse?.caeExpiration || "")) && !caeResponse.errors?.length
      && (caeResponse.voucherFrom == null || caeResponse.voucherFrom === voucherNumber)
      && (caeResponse.voucherTo == null || caeResponse.voucherTo === voucherNumber)) {
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
      resolved = true;
      return {
        status: "authorized",
        invoice: authorized.data,
      };
    }

    if (caeResponse?.result !== "R" || caeResponse?.cae) {
      const reconciled = await reconcilePlannedVoucher({ invoiceId, plannedDocument, env, consultVoucherFn, markAuthorizedFn, markReconcilingFn });
      resolved = reconciled.data?.status === "authorized";
      return { status: reconciled.data?.status || "reconciling", uncertain: true, reconciled: resolved };
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
    resolved = true;
    return {
      status: rejected.data?.status || "rejected",
      invoice: rejected.data,
    };
  } catch (error) {
    // Includes failures persisting an accepted response. Never downgrade an
    // accepted/uncertain operation into a fresh pending authorization.
    const latest = await getDocument(invoicePath(invoiceId), { env });
    if (latest?.data?.status === "authorized" || latest?.data?.status === "rejected") {
      resolved = true;
      return { status: latest.data.status, invoice: latest.data };
    }
    if (latest?.data?.authorization?.attemptId !== claim.attemptId || latest?.data?.status === "pending") {
      return { status: latest?.data?.status || "unknown", blocked: true, reason: "attempt-superseded", invoice: latest?.data || null };
    }
    if (latest?.data?.authorization?.voucherNumber) {
      const reconciled = await reconcilePlannedVoucher({ invoiceId, plannedDocument: latest, env, consultVoucherFn, markAuthorizedFn, markReconcilingFn });
      resolved = reconciled.data?.status === "authorized";
      return { status: reconciled.data?.status || "reconciling", uncertain: true };
    }
    const classification = classifyFiscalFailure(error);
    const persisted = classification === "TEMPORARY"
      ? await returnPendingFn({ invoiceId, expectedUpdateTime: latest.updateTime, errorCode: error.code, attemptCount, env, now })
      : await markErrorFn({ invoiceId, expectedUpdateTime: latest.updateTime, errorCode: error.code, env, now });
    return { status: persisted.data?.status || "error", classification, error: compactError(error) };
  } finally {
    if (lock?.acquired) {
      await releaseLockFn({
        pointOfSale: config.pointOfSale,
        voucherType: plan.voucherType,
        holder: claim.attemptId,
        resolvedInvoiceId: resolved ? invoiceId : null,
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
  releaseLockFn = releaseSequenceLock,
} = {}) {
  const current = await getDocument(invoicePath(invoiceId), { env });
  if (!current) {
    const error = new Error("La solicitud fiscal no existe.");
    error.code = "arca-invoice-not-found";
    error.status = 404;
    throw error;
  }
  assertInvoiceEnvironment(current.data, env);
  if (current.data?.status === "authorized") {
    return { status: "authorized", alreadyAuthorized: true, invoice: current.data };
  }
  if (current.data?.status === "rejected") {
    return { status: "rejected", blocked: true, reason: "invoice-rejected", invoice: current.data };
  }
  if (current.data?.status !== "reconciling" && !current.data?.authorization?.voucherNumber) {
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

  if (result.data?.status === "authorized") {
    const authorization = result.data.authorization || {};
    await releaseLockFn({ pointOfSale: authorization.pointOfSale, voucherType: authorization.voucherType,
      holder: authorization.attemptId, resolvedInvoiceId: invoiceId, env }).catch(() => {});
  }

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

  assertInvoiceEnvironment(current.data, env);

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

  if (Date.parse(authorization.attemptStartedAt || "") + 120000 > now.getTime()) {
    return { status: "authorizing", recovered: false, reason: "attempt-still-active", invoice: current.data };
  }

  const returned = await returnPendingFn({
    invoiceId,
    expectedUpdateTime: current.updateTime,
    errorCode: "arca-pre-cae-recovered",
    errorMessage: "Se recuperó un intento interrumpido antes de reservar número y antes de solicitar CAE. Puede reintentarse cuando ARCA esté disponible.",
    env,
    now,
    attemptCount: Number(current.data.recovery?.attemptCount || 0),
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

  assertInvoiceEnvironment(current.data, env);

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
    && (!expectedExpiration || consultedExpiration === expectedExpiration)
    && (!authorization.requestSnapshot || voucherMatchesAuthorization(consulted, authorization))
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
