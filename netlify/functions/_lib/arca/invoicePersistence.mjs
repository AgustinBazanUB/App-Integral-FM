import {
  adminCreateDocument,
  adminGetDocument,
  adminPatchDocument,
} from "../firestoreAdminRest.mjs";
import {
  BILLING_SOURCE_TYPES,
  invoiceIdFor,
} from "./billing.mjs";
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
  const uniqueIds = [...new Set(items.map((item) => item.productId).filter(Boolean))];
  const products = [];
  for (const productId of uniqueIds) {
    const snapshot = await getDocument(`products/${productId}`, { env });
    const data = snapshot?.data || null;
    products.push({
      productId,
      exists: Boolean(snapshot),
      name: data?.name || items.find((item) => item.productId === productId)?.name || "",
      arcaVatRate: data?.arcaVatRate ?? null,
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
  return false;
}

function validateSaleForInvoice(sourceType, sourceId, sale) {
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
  if (!requestedBySource(sourceType, sale)) {
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
  env = process.env,
  now = new Date(),
  getDocument = adminGetDocument,
  createDocument = adminCreateDocument,
} = {}) {
  const invoiceId = invoiceIdFor(sourceType, sourceId);
  const existing = await getDocument(invoicePathFor(invoiceId), { env });
  if (existing) {
    return {
      created: false,
      invoiceId,
      invoice: existing.data,
      updateTime: existing.updateTime || null,
    };
  }

  const saleSnapshot = await getDocument(salePathFor(sourceId), { env });
  const sale = saleSnapshot?.data || null;
  validateSaleForInvoice(sourceType, sourceId, sale);

  const items = compactSaleItems(sale.items);
  const fiscalProducts = await loadFiscalProducts(items, { getDocument, env });
  const readiness = fiscalReadiness(fiscalProducts);
  const timestamp = nowIso(now);

  const payload = {
    schemaVersion: 1,
    billingVersion: ARCA_BILLING_VERSION,
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
  const attemptId = `attempt_${timestamp.replace(/[^0-9]/g, "").slice(0, 17)}_${String(claimedBy || "system").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}`;

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
      code: String(errorCode || "arca-authorization-error").slice(0, 120),
      message: String(errorMessage || "Falló la autorización fiscal.").slice(0, 500),
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
  env = process.env,
  now = new Date(),
  patchDocument = adminPatchDocument,
} = {}) {
  const timestamp = nowIso(now);
  return patchDocument(invoicePathFor(invoiceId), {
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
      cae: null,
      caeExpiration: null,
      result: null,
      authorizedAt: null,
    },
    error: null,
  }, {
    env,
    currentUpdateTime: expectedUpdateTime,
  });
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
  env = process.env,
  now = new Date(),
  patchDocument = adminPatchDocument,
} = {}) {
  const timestamp = nowIso(now);
  return patchDocument(invoicePathFor(invoiceId), {
    status: "reconciling",
    updatedAt: timestamp,
    error: {
      code: String(errorCode || "arca-uncertain-response").slice(0, 120),
      message: String(errorMessage || "La respuesta de ARCA es incierta y debe reconciliarse antes de reintentar.").slice(0, 500),
      at: timestamp,
    },
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
  env = process.env,
  now = new Date(),
  patchDocument = adminPatchDocument,
} = {}) {
  const timestamp = nowIso(now);
  return patchDocument(invoicePathFor(invoiceId), {
    status: "pending",
    updatedAt: timestamp,
    error: {
      code: String(errorCode).slice(0, 120),
      message: String(errorMessage).slice(0, 500),
      at: timestamp,
      retryable: true,
    },
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
      code: String(errorCode).slice(0, 120),
      message: String(errorMessage).slice(0, 500),
      at: timestamp,
      retryable: false,
    },
  }, {
    env,
    currentUpdateTime: expectedUpdateTime,
  });
}
