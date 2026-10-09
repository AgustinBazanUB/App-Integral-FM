import {
  adminCreateDocument,
  adminGetDocument,
  adminPatchDocument,
  adminRunTransaction,
} from "../firestoreAdminRest.mjs";
import { randomUUID } from "node:crypto";
import { fiscalRecovery, safeFiscalError } from "../../../../src/shared/fiscalRecovery.mjs";
import {
  BILLING_SOURCE_TYPES,
  invoiceIdFor,
  invoiceIdForEnvironment,
} from "./billing.mjs";
import { arcaEnvironment } from "./config.mjs";
import { ARCA_BILLING_VERSION } from "./billingVersion.mjs";

function nowIso(now = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString();
}

function salePathFor(sourceId) {
  return `sales/${sourceId}`;
}

function invoicePathFor(invoiceId) {
  return `invoices/${invoiceId}`;
}

function fiscalScope(env = process.env) {
  const environment = arcaEnvironment(env).id;
  const issuerCuit = String(env.ARCA_ISSUER_CUIT || "").replace(/\D/g, "") || null;
  const pointOfSale = Number(env.ARCA_POINT_OF_SALE || 0) || null;
  return { environment, issuerCuit, pointOfSale };
}

function compactCustomerSnapshot(sale = {}) {
  return {
    customerId: sale.customerId || null,
    name: sale.customerNameSnapshot || null,
    phone: sale.customerPhoneSnapshot || null,
    zone: sale.customerZoneSnapshot || null,
    dni: sale.customerDni || null,
  };
}

function compactPaymentSnapshot(sale = {}) {
  return {
    method: sale.paymentMethod || null,
    label: sale.paymentMethodLabel || null,
    payments: Array.isArray(sale.payments) ? sale.payments : [],
  };
}

function compactSaleItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    productId: String(item.productId || item.id || "").trim(),
    name: item.name || item.productName || "",
    abbreviation: item.abbreviation || "",
    qty: Number(item.qty || 0),
    unitPrice: Number(item.unitPrice ?? item.price ?? 0),
    subtotal: Number(item.subtotal ?? 0),
  }));
}

async function loadFiscalProducts(items, { getDocument, env }) {
  const defaultVatRateRaw = String(env?.ARCA_DEFAULT_PRODUCT_VAT_RATE ?? "").trim();
  const defaultVatRate = defaultVatRateRaw === "" ? null : Number(defaultVatRateRaw);
  if (defaultVatRate != null && ![0, 10.5, 21, 27].includes(defaultVatRate)) {
    const error = new Error("ARCA_DEFAULT_PRODUCT_VAT_RATE no es una alícuota soportada.");
    error.code = "arca-default-vat-rate-invalid";
    throw error;
  }
  const uniqueIds = [...new Set(items.map((item) => item.productId).filter(Boolean))];
  const products = [];
  for (const productId of uniqueIds) {
    const snapshot = await getDocument(`products/${productId}`, { env });
    const data = snapshot?.data || null;
    products.push({
      productId,
      exists: Boolean(snapshot),
      name: data?.name || items.find((item) => item.productId === productId)?.name || "",
      arcaVatRate: data?.arcaVatRate ?? defaultVatRate,
      arcaVatRateSource: data?.arcaVatRate != null ? "product" : defaultVatRate != null ? "environment-default" : null,
      active: data?.active !== false,
      deleted: data?.deleted === true,
    });
  }
  return products;
}

function fiscalReadiness(products = []) {
  const missingProducts = products.filter((product) => !product.exists).map((product) => product.productId);
  const missingVatRate = products
    .filter((product) => product.exists && product.arcaVatRate == null)
    .map((product) => product.productId);
  return {
    ready: missingProducts.length === 0 && missingVatRate.length === 0,
    missingProducts,
    missingVatRate,
  };
}

function requestedBySource(sourceType, sale = {}) {
  if (sourceType === "seller_sale") return sale.ticketRequested === true;
  if (sourceType === "admin_quick_sale") {
    return String(sale.invoiceStatus || "").toLowerCase() === "pending";
  }
  if (sourceType === "ecommerce") {
    const status = String(sale.paymentStatus || "").toLowerCase();
    const provider = String(sale.paymentProvider || "").toLowerCase();
    const trustedPayment = (
      (status === "simulated_approved" && provider === "simulation")
      || (status === "approved" && provider === "payway")
    );
    return sale.sourceType === "ecommerce"
      && trustedPayment
      && String(sale.invoiceStatus || "").toLowerCase() === "pending";
  }
  return false;
}

function saleMatchesDeclaredSource(sourceType, sale) {
  return Boolean(sale)
    && (!Object.hasOwn(sale, "sourceType") || sale.sourceType === sourceType)
    && (sale.sourceChannel !== "ecommerce" || sourceType === "ecommerce");
}

function assertDeclaredSaleSource(sourceType, sale) {
  if (sale && !saleMatchesDeclaredSource(sourceType, sale)) {
    const error = new Error("El origen fiscal solicitado no coincide con el origen declarado de la venta.");
    error.code = "arca-sale-source-mismatch";
    error.status = 409;
    throw error;
  }
}

function validateSaleForInvoice(sourceType, sourceId, sale, { existingInvoice = false } = {}) {
  assertDeclaredSaleSource(sourceType, sale);
  if (!BILLING_SOURCE_TYPES.includes(sourceType)) {
    const error = new Error("Origen de facturación inválido.");
    error.code = "arca-invalid-source";
    throw error;
  }
  if (!sale) {
    const error = new Error("La venta indicada no existe.");
    error.code = "arca-sale-not-found";
    error.status = 404;
    throw error;
  }
  if (sale.status !== "active") {
    const error = new Error("Sólo se puede preparar una factura para una venta activa.");
    error.code = "arca-sale-not-active";
    error.status = 409;
    throw error;
  }
  if (sourceType === "ecommerce") {
    const status = String(sale.paymentStatus || "").toLowerCase();
    const provider = String(sale.paymentProvider || "").toLowerCase();
    const validPayment = (
      (status === "simulated_approved" && provider === "simulation")
      || (status === "approved" && provider === "payway")
    );
    if (sale.sourceType !== "ecommerce" || !validPayment) {
      const error = new Error("La venta Ecommerce no tiene un pago aprobado válido para facturar.");
      error.code = "ecommerce-payment-not-approved";
      error.status = 409;
      throw error;
    }
  }
  if (!existingInvoice && !requestedBySource(sourceType, sale)) {
    const error = new Error("La venta no tiene una solicitud de facturación pendiente.");
    error.code = "arca-invoice-not-requested";
    error.status = 409;
    throw error;
  }
  if (!Array.isArray(sale.items) || !sale.items.length) {
    const error = new Error("La venta no contiene productos.");
    error.code = "arca-sale-empty";
    error.status = 409;
    throw error;
  }
  if (!sourceId) {
    const error = new Error("Falta el identificador de la venta.");
    error.code = "arca-missing-source-id";
    error.status = 400;
    throw error;
  }
}

export function canRequestInvoiceForSale({ sourceType, sale, session }) {
  if (!saleMatchesDeclaredSource(sourceType, sale)) return false;
  const profile = session?.profile || {};
  const role = String(profile.role || profile.roles?.[0] || "").trim().toLowerCase().replaceAll(" ", "_");
  const admin = role === "admin"
    || role === "general_admin"
    || profile.canAccessAdmin === true
    || profile.isAdmin === true
    || profile.roles?.includes?.("admin");

  if (admin) return true;
  if (sourceType === "seller_sale") return sale?.sellerId === session?.uid;
  return false;
}

export async function ensurePendingInvoice({
  sourceType,
  sourceId,
  requestedBy,
  requestedByName = null,
  receiver = null,
  env = process.env,
  now = new Date(),
  getDocument = adminGetDocument,
  createDocument = adminCreateDocument,
  runTransaction = adminRunTransaction,
} = {}) {
  if (getDocument === adminGetDocument && createDocument === adminCreateDocument) {
    return runTransaction(async (transaction) => ensurePendingInvoice({ sourceType, sourceId, requestedBy, requestedByName, receiver, env, now,
      getDocument: transaction.getDocument,
      createDocument: async (collection, id, data) => {
        await transaction.commitDocuments([{ type: "create", path: `${collection}/${id}`, data }]);
        return adminGetDocument(`${collection}/${id}`, { env });
      },
    }), { env });
  }
  const scope = fiscalScope(env);
  const invoiceId = invoiceIdForEnvironment(scope.environment, sourceType, sourceId);
  const sourceSale = await getDocument(salePathFor(sourceId), { env });
  assertDeclaredSaleSource(sourceType, sourceSale?.data);
  const assertInvoiceAssociation = async (candidateId, candidate) => {
    const currentSale = await getDocument(salePathFor(sourceId), { env });
    assertDeclaredSaleSource(sourceType, currentSale?.data);
    if (sourceType === "ecommerce") validateSaleForInvoice(sourceType, sourceId, currentSale?.data || null, { existingInvoice: Boolean(candidate) });
    const sale = currentSale?.data || {};
    const links = [{id:sale.fiscalInvoiceId, environment:sale.fiscalEnvironment}, {id:sale.fiscalInvoice?.id, environment:sale.fiscalInvoice?.environment}];
    if (links.some((link) => link.id && link.id !== candidateId && (!link.environment || link.environment === scope.environment)) || (candidate && (candidate.sourceType !== sourceType || candidate.sourceId !== sourceId || (candidate.fiscalEnvironment && candidate.fiscalEnvironment !== scope.environment)))) {
      const error = new Error("La asociación fiscal de la venta no coincide.");
      error.code = "arca-sale-invoice-conflict";
      error.status = 409;
      throw error;
    }
  };
  const existing = await getDocument(invoicePathFor(invoiceId), { env });
  if (existing) {
    await assertInvoiceAssociation(invoiceId, existing.data);
    return {
      created: false,
      invoiceId,
      invoice: existing.data,
      updateTime: existing.updateTime || null,
    };
  }

  if (scope.environment === "homologation") {
    const legacyInvoiceId = invoiceIdFor(sourceType, sourceId);
    const legacy = await getDocument(invoicePathFor(legacyInvoiceId), { env });
    if (legacy && (!legacy.data?.fiscalEnvironment || legacy.data.fiscalEnvironment === "homologation")) {
      await assertInvoiceAssociation(legacyInvoiceId, legacy.data);
      return {
        created: false,
        invoiceId: legacyInvoiceId,
        invoice: legacy.data,
        updateTime: legacy.updateTime || null,
        legacy: true,
      };
    }
  }

  const saleSnapshot = await getDocument(salePathFor(sourceId), { env });
  const sale = saleSnapshot?.data || null;
  validateSaleForInvoice(sourceType, sourceId, sale);
  await assertInvoiceAssociation(invoiceId, null);

  const items = compactSaleItems(sale.items);
  // Paid Ecommerce Sales already contain the authoritative VAT snapshot.
  const fiscalProducts = sourceType === "ecommerce"
    ? sale.items.map((item) => ({productId:item.productId, exists:true, name:item.name || "", arcaVatRate:item.arcaVatRate, arcaVatRateSource:"paid-sale", active:true, deleted:false}))
    : await loadFiscalProducts(items, { getDocument, env });
  const readiness = fiscalReadiness(fiscalProducts);
  const timestamp = nowIso(now);

  const payload = {
    schemaVersion: 2,
    billingVersion: ARCA_BILLING_VERSION,
    fiscalEnvironment: scope.environment,
    issuerCuit: scope.issuerCuit,
    pointOfSaleSnapshot: scope.pointOfSale,
    sourceType,
    sourceId,
    status: "pending",
    requestedAt: timestamp,
    requestedBy: requestedBy || null,
    requestedByName: requestedByName || null,
    createdAt: timestamp,
    updatedAt: timestamp,
    fiscalReadiness: readiness,
    saleSnapshot: {
      saleCode: sale.saleCode || null,
      locationId: sale.locationId || null,
      locationName: sale.locationName || null,
      sellerId: sale.sellerId || null,
      sellerName: sale.sellerName || null,
      sourceChannel: sale.sourceChannel || null,
      saleCreatedAt: sale.createdAt || null,
      subtotal: Number(sale.subtotal || 0),
      discountTotal: Number(sale.discountTotal || 0),
      totalBeforeDiscounts: Number(sale.totalBeforeDiscounts ?? sale.subtotal ?? 0),
      total: Number(sale.total || 0),
      totalItems: Number(sale.totalItems || 0),
      items,
      discounts: Array.isArray(sale.discounts) ? sale.discounts : [],
      payment: compactPaymentSnapshot(sale),
      customer: compactCustomerSnapshot(sale),
    },
    productFiscalSnapshot: fiscalProducts,
    receiverSnapshot: receiver ? {
      ...(receiver.name ? { name: String(receiver.name).trim().slice(0, 200) } : {}),
      vatConditionId: Number(receiver.vatConditionId || 0) || null,
      documentType: Number(receiver.documentType || 0) || null,
      documentNumber: String(receiver.documentNumber || "").replace(/\D/g, "") || null,
      anonymousConsumerFinal: receiver.anonymousConsumerFinal === true,
      concept: Number(receiver.concept || 1),
    } : null,
    authorization: {
      pointOfSale: null,
      voucherType: null,
      voucherNumber: null,
      cae: null,
      caeExpiration: null,
      result: null,
      lastAttemptAt: null,
      authorizedAt: null,
    },
    error: null,
  };

  try {
    const created = await createDocument("invoices", invoiceId, payload, { env });
    return {
      created: true,
      invoiceId,
      invoice: created.data,
      updateTime: created.updateTime || null,
    };
  } catch (error) {
    if (error?.code !== "firebase-admin-already-exists") throw error;
    const raced = await getDocument(invoicePathFor(invoiceId), { env });
    if (!raced) throw error;
    await assertInvoiceAssociation(invoiceId, raced.data);
    return {
      created: false,
      invoiceId,
      invoice: raced.data,
      updateTime: raced.updateTime || null,
    };
  }
}


export async function claimPendingInvoice({
  invoiceId,
  claimedBy = null,
  env = process.env,
  now = new Date(),
  getDocument = adminGetDocument,
  patchDocument = adminPatchDocument,
} = {}) {
  const current = await getDocument(invoicePathFor(invoiceId), { env });
  if (!current) {
    const error = new Error("La solicitud fiscal no existe.");
    error.code = "arca-invoice-not-found";
    error.status = 404;
    throw error;
  }

  const status = String(current.data?.status || "");
  if (status !== "pending") {
    return {
      claimed: false,
      invoiceId,
      invoice: current.data,
      updateTime: current.updateTime || null,
      reason: `status-${status || "unknown"}`,
    };
  }

  const timestamp = nowIso(now);
  const attemptId = `attempt_${randomUUID()}`;

  try {
    const updated = await patchDocument(invoicePathFor(invoiceId), {
      status: "authorizing",
      updatedAt: timestamp,
      authorization: {
        ...(current.data.authorization || {}),
        attemptId,
        attemptStartedAt: timestamp,
        claimedBy: claimedBy || null,
      },
      error: null,
      recovery: { ...(current.data.recovery || {}), attemptCount: Number(current.data.recovery?.attemptCount || 0) + 1, retryable: false, nextRetryAt: null },
    }, {
      env,
      currentUpdateTime: current.updateTime,
    });

    return {
      claimed: true,
      invoiceId,
      invoice: updated.data,
      updateTime: updated.updateTime || null,
      attemptId,
      reason: "claimed",
    };
  } catch (error) {
    if (error?.code !== "firebase-admin-precondition-failed") throw error;
    const raced = await getDocument(invoicePathFor(invoiceId), { env });
    return {
      claimed: false,
      invoiceId,
      invoice: raced?.data || null,
      updateTime: raced?.updateTime || null,
      reason: "concurrent-claim",
    };
  }
}

export async function releaseInvoiceClaim({
  invoiceId,
  expectedUpdateTime,
  errorCode,
  errorMessage,
  env = process.env,
  now = new Date(),
  patchDocument = adminPatchDocument,
} = {}) {
  const timestamp = nowIso(now);
  return patchDocument(invoicePathFor(invoiceId), {
    status: "error",
    updatedAt: timestamp,
    error: {
      ...safeFiscalError({ code: errorCode }),
      at: timestamp,
    },
  }, {
    env,
    currentUpdateTime: expectedUpdateTime,
  });
}


export async function persistAuthorizationPlan({
  invoiceId,
  expectedUpdateTime,
  pointOfSale,
  voucherType,
  voucherNumber,
  voucherClass,
  receiverVatConditionId,
  receiverDocument,
  fiscal,
  attemptId,
  sequenceLock,
  requestSnapshot,
  receiverSnapshot,
  env = process.env,
  now = new Date(),
  patchDocument = adminPatchDocument,
  runTransaction = adminRunTransaction,
  getDocument = adminGetDocument,
} = {}) {
  const timestamp = nowIso(now);
  const payload = {
    status: "authorizing",
    updatedAt: timestamp,
    authorization: {
      pointOfSale: Number(pointOfSale),
      voucherType: Number(voucherType),
      voucherClass: String(voucherClass || ""),
      voucherNumber: Number(voucherNumber),
      receiverVatConditionId: Number(receiverVatConditionId),
      receiverDocument: receiverDocument || null,
      fiscal: fiscal || null,
      attemptId: attemptId || null,
      plannedAt: timestamp,
      lastAttemptAt: timestamp,
      attemptStartedAt: timestamp,
      requestSnapshot: requestSnapshot || null,
      cae: null,
      caeExpiration: null,
      result: null,
      authorizedAt: null,
    },
    error: null,
  };
  if (!sequenceLock?.path || !sequenceLock.updateTime) {
    const error = new Error("Falta el lock fiscal para reservar el comprobante.");
    error.code = "arca-sequence-lock-invalid";
    throw error;
  }
  await runTransaction(async (transaction) => {
    const current = await transaction.getDocument(invoicePathFor(invoiceId));
    const lock = await transaction.getDocument(sequenceLock.path);
    payload.authorization.attemptCount = Number(current?.data?.recovery?.attemptCount || 0);
    if (receiverSnapshot) payload.receiverSnapshot = { ...(current?.data?.receiverSnapshot || {}), ...receiverSnapshot };
    if (current?.updateTime !== expectedUpdateTime || lock?.updateTime !== sequenceLock.updateTime
      || current?.data?.status !== "authorizing" || current.data.authorization?.attemptId !== attemptId
      || lock?.data?.holder !== attemptId || lock.data.reservation?.invoiceId
      || !Number.isFinite(Date.parse(lock.data.leaseExpiresAt || "")) || Date.parse(lock.data.leaseExpiresAt) <= Date.now()) {
      const error = new Error("El intento fiscal perdió su exclusión antes del envío.");
      error.code = "firebase-admin-precondition-failed";
      throw error;
    }
    await transaction.commitDocuments([
      { type: "update", path: invoicePathFor(invoiceId), data: payload, currentUpdateTime: expectedUpdateTime },
      { type: "update", path: sequenceLock.path, currentUpdateTime: sequenceLock.updateTime,
        data: { reservation: { invoiceId, attemptId, voucherNumber: Number(voucherNumber), plannedAt: timestamp }, updatedAt: timestamp } },
    ]);
  }, { env });
  return getDocument(invoicePathFor(invoiceId), { env });
}

export async function markInvoiceAuthorized({
  invoiceId,
  expectedUpdateTime,
  baseAuthorization = {},
  cae,
  caeExpiration,
  result = "A",
  observations = [],
  env = process.env,
  now = new Date(),
  patchDocument = adminPatchDocument,
} = {}) {
  const timestamp = nowIso(now);
  return patchDocument(invoicePathFor(invoiceId), {
    status: "authorized",
    updatedAt: timestamp,
    authorization: {
      ...(baseAuthorization || {}),
      cae: String(cae || ""),
      caeExpiration: String(caeExpiration || ""),
      result: String(result || "A"),
      observations: Array.isArray(observations) ? observations : [],
      authorizedAt: timestamp,
      lastAttemptAt: timestamp,
    },
    error: null,
    recovery: fiscalRecovery({ classification: "AUTHORIZED", attemptCount: Number(baseAuthorization.attemptCount || 0), now }),
  }, {
    env,
    currentUpdateTime: expectedUpdateTime,
  });
}

export async function markInvoiceRejected({
  invoiceId,
  expectedUpdateTime,
  baseAuthorization = {},
  result = "R",
  observations = [],
  errors = [],
  env = process.env,
  now = new Date(),
  patchDocument = adminPatchDocument,
} = {}) {
  const timestamp = nowIso(now);
  return patchDocument(invoicePathFor(invoiceId), {
    status: "rejected",
    updatedAt: timestamp,
    authorization: {
      ...(baseAuthorization || {}),
      result: String(result || "R"),
      observations: Array.isArray(observations) ? observations : [],
      lastAttemptAt: timestamp,
    },
    error: {
      code: "arca-rejected",
      message: "ARCA rechazó la solicitud de autorización.",
      details: Array.isArray(errors) ? errors : [],
      at: timestamp,
    },
    recovery: fiscalRecovery({ classification: "REJECTED", code: "arca-rejected", attemptCount: Number(baseAuthorization.attemptCount || 0), now }),
  }, {
    env,
    currentUpdateTime: expectedUpdateTime,
  });
}

export async function markInvoiceReconciling({
  invoiceId,
  expectedUpdateTime,
  errorCode,
  errorMessage,
  attemptCount = 0,
  env = process.env,
  now = new Date(),
  patchDocument = adminPatchDocument,
} = {}) {
  const timestamp = nowIso(now);
  return patchDocument(invoicePathFor(invoiceId), {
    status: "reconciling",
    updatedAt: timestamp,
    error: {
      ...safeFiscalError({ code: errorCode }),
      message: fiscalRecovery({ classification: "UNCERTAIN", code: errorCode, now }).lastError.message,
      at: timestamp,
    },
    recovery: fiscalRecovery({ classification: "UNCERTAIN", code: errorCode, attemptCount, now }),
  }, {
    env,
    currentUpdateTime: expectedUpdateTime,
  });
}


export async function returnInvoiceToPending({
  invoiceId,
  expectedUpdateTime,
  errorCode = "arca-retry-later",
  errorMessage = "La autorización fiscal debe reintentarse.",
  attemptCount = 0,
  env = process.env,
  now = new Date(),
  patchDocument = adminPatchDocument,
} = {}) {
  const timestamp = nowIso(now);
  return patchDocument(invoicePathFor(invoiceId), {
    status: "pending",
    updatedAt: timestamp,
    error: {
      ...safeFiscalError({ code: errorCode }),
      at: timestamp,
      retryable: attemptCount < 3,
    },
    recovery: fiscalRecovery({ classification: "TEMPORARY", code: errorCode, attemptCount, now }),
  }, {
    env,
    currentUpdateTime: expectedUpdateTime,
  });
}

export async function markInvoiceError({
  invoiceId,
  expectedUpdateTime,
  errorCode = "arca-authorization-error",
  errorMessage = "Falló la autorización fiscal.",
  env = process.env,
  now = new Date(),
  patchDocument = adminPatchDocument,
} = {}) {
  const timestamp = nowIso(now);
  return patchDocument(invoicePathFor(invoiceId), {
    status: "error",
    updatedAt: timestamp,
    error: {
      ...safeFiscalError({ code: errorCode }),
      at: timestamp,
      retryable: false,
    },
    recovery: fiscalRecovery({ classification: "VALIDATION", code: errorCode, now }),
  }, {
    env,
    currentUpdateTime: expectedUpdateTime,
  });
}


export async function markInvoiceVerified({
  invoiceId,
  expectedUpdateTime,
  matched,
  result,
  cae,
  caeExpiration,
  pointOfSale,
  voucherType,
  voucherNumber,
  errors = [],
  events = [],
  env = process.env,
  now = new Date(),
  patchDocument = adminPatchDocument,
} = {}) {
  const timestamp = nowIso(now);
  return patchDocument(invoicePathFor(invoiceId), {
    updatedAt: timestamp,
    verification: {
      checkedAt: timestamp,
      matched: matched === true,
      result: result || null,
      cae: cae ? String(cae) : null,
      caeExpiration: caeExpiration ? String(caeExpiration) : null,
      pointOfSale: Number(pointOfSale || 0) || null,
      voucherType: Number(voucherType || 0) || null,
      voucherNumber: Number(voucherNumber || 0) || null,
      errors: Array.isArray(errors) ? errors : [],
      events: Array.isArray(events) ? events : [],
    },
  }, {
    env,
    currentUpdateTime: expectedUpdateTime,
  });
}


export async function syncInvoiceToSale({
  invoiceId,
  env = process.env,
  now = new Date(),
  getDocument = adminGetDocument,
  patchDocument = adminPatchDocument,
  runTransaction = adminRunTransaction,
} = {}) {
  if (getDocument === adminGetDocument && patchDocument === adminPatchDocument) {
    return runTransaction(async (transaction) => syncInvoiceToSale({ invoiceId, env, now,
      getDocument: transaction.getDocument,
      patchDocument: async (path, data, options) => transaction.commitDocuments([{ type: "update", path, data, currentUpdateTime: options.currentUpdateTime }]),
    }), { env });
  }
  if (!invoiceId) {
    const error = new Error("Falta identificar la solicitud fiscal.");
    error.code = "arca-invoice-id-missing";
    error.status = 400;
    throw error;
  }

  const invoiceDocument = await getDocument(invoicePathFor(invoiceId), { env });
  if (!invoiceDocument?.data) {
    const error = new Error("La solicitud fiscal no existe.");
    error.code = "arca-invoice-not-found";
    error.status = 404;
    throw error;
  }

  const invoice = invoiceDocument.data;
  const sourceId = String(invoice.sourceId || "").trim();
  if (!sourceId) {
    const error = new Error("La solicitud fiscal no tiene una venta de origen asociada.");
    error.code = "arca-invoice-source-missing";
    error.status = 409;
    throw error;
  }

  const saleDocument = await getDocument(salePathFor(sourceId), { env });
  if (!saleDocument?.data) {
    const error = new Error("La venta asociada a la factura ya no existe.");
    error.code = "arca-sale-not-found";
    error.status = 404;
    throw error;
  }

  const authorization = invoice.authorization || {};
  const existingId = saleDocument.data.fiscalInvoiceId || saleDocument.data.fiscalInvoice?.id;
  if (existingId && existingId !== invoiceId && saleDocument.data.fiscalEnvironment === invoice.fiscalEnvironment) {
    const error = new Error("La venta ya está vinculada a otro comprobante fiscal.");
    error.code = "arca-invoice-association-conflict"; error.status = 409; throw error;
  }
  assertDeclaredSaleSource(invoice.sourceType, saleDocument.data);
  const verification = invoice.verification || {};
  const timestamp = nowIso(now);
  const fiscalInvoice = {
    id: invoiceId,
    environment: invoice.fiscalEnvironment || "homologation",
    sourceType: invoice.sourceType || null,
    status: invoice.status || "pending",
    voucherClass: authorization.voucherClass || null,
    pointOfSale: Number(authorization.pointOfSale || invoice.pointOfSaleSnapshot || 0) || null,
    voucherType: Number(authorization.voucherType || 0) || null,
    voucherNumber: Number(authorization.voucherNumber || 0) || null,
    cae: authorization.cae ? String(authorization.cae) : null,
    caeExpiration: authorization.caeExpiration ? String(authorization.caeExpiration) : null,
    authorizedAt: authorization.authorizedAt || null,
    verificationMatched: verification.checkedAt ? verification.matched === true : null,
    verificationCheckedAt: verification.checkedAt || null,
    updatedAt: timestamp,
    recovery: invoice.recovery || null,
  };

  await patchDocument(salePathFor(sourceId), {
    fiscalInvoiceId: invoiceId,
    fiscalEnvironment: fiscalInvoice.environment,
    invoiceStatus: fiscalInvoice.status,
    fiscalInvoice,
    fiscalUpdatedAt: timestamp,
  }, {
    env,
    requireExists: true,
    currentUpdateTime: saleDocument.updateTime,
  });

  return {
    invoiceId,
    sourceId,
    fiscalInvoice,
  };
}
