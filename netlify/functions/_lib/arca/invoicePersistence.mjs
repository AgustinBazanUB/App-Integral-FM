import { invoiceIdFor } from "./billing.mjs";
import {
  adminCreateDocument,
  adminGetDocument,
} from "../firestoreAdminRest.mjs";

const SUPPORTED_SOURCE_TYPES = Object.freeze(["seller_sale", "admin_quick_sale"]);
const QUICK_SALES_ROLES = new Set([
  "admin",
  "general_admin",
  "operational_admin",
  "seller",
  "location_manager",
]);

function fail(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function normalizedRole(profile = {}) {
  if (
    profile.role === "admin" ||
    profile.canAccessAdmin === true ||
    profile.isAdmin === true ||
    profile.roles?.includes?.("admin")
  ) return "admin";
  const value = String(profile.role || profile.roles?.[0] || "seller")
    .trim()
    .toLowerCase()
    .replaceAll(" ", "_");
  const aliases = {
    administrator: "admin",
    administrador: "admin",
    administrador_general: "general_admin",
  };
  return aliases[value] || value;
}

function canRequestTicket(profile = {}) {
  if (profile.active !== true) return false;
  const denied = new Set(profile.permissionDeny?.["quick-sales"] || []);
  if (denied.has("requestTicket")) return false;

  const permissions = profile.permissions?.["quick-sales"];
  let explicitlyAllowed = null;
  if (Array.isArray(permissions)) {
    explicitlyAllowed = permissions.includes("requestTicket") || permissions.includes("admin");
  } else if (permissions && typeof permissions === "object") {
    explicitlyAllowed = permissions.requestTicket === true || permissions.admin === true;
  }

  const roleAllows = QUICK_SALES_ROLES.has(normalizedRole(profile));
  const allowedActions = profile.permissionAllow?.["quick-sales"] || [];
  const extraAllow = allowedActions.includes("requestTicket") || allowedActions.includes("admin");
  return (explicitlyAllowed ?? roleAllows) || extraAllow;
}

function isAdmin(profile = {}) {
  return ["admin", "general_admin"].includes(normalizedRole(profile));
}

function assertCanAccessSource(session, sellerId) {
  if (!canRequestTicket(session.profile)) {
    fail("permission-denied", "Tu perfil no puede solicitar facturación.", 403);
  }
  if (!isAdmin(session.profile) && String(sellerId || "") !== session.uid) {
    fail("permission-denied", "No podés solicitar facturación para una venta ajena.", 403);
  }
}

function safeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    fail("arca-invoice-source-invalid", `La venta tiene un ${label} inválido.`, 409);
  }
  return Number(number.toFixed(2));
}

function snapshotItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) {
    fail("arca-invoice-source-invalid", "La venta no tiene un detalle válido para facturar.", 409);
  }
  return items.map((item) => {
    if (!item || typeof item !== "object") {
      fail("arca-invoice-source-invalid", "La venta tiene un ítem inválido.", 409);
    }
    const quantity = Number(item?.qty);
    if (!Number.isInteger(quantity) || quantity < 1) {
      fail("arca-invoice-source-invalid", "La venta tiene una cantidad inválida.", 409);
    }
    const unitPrice = safeNumber(item.unitPrice ?? item.price, "precio");
    const subtotal = safeNumber(item.subtotal ?? unitPrice * quantity, "subtotal");
    const productId = String(item.productId || item.id || "").trim();
    if (!productId || productId.length > 180) {
      fail("arca-invoice-source-invalid", "La venta tiene un producto inválido.", 409);
    }
    return {
      productId,
      description: String(item.name || item.productName || "Producto").trim().slice(0, 200),
      quantity,
      unitPrice,
      subtotal,
    };
  });
}

function assertSaleCanBePersisted(sourceType, sale) {
  if (sale.status !== "active") {
    fail("arca-invoice-sale-inactive", "Sólo se puede guardar una solicitud para una venta activa.", 409);
  }
  if (sale.createdOffline === true && !sale.syncedAt) {
    fail("arca-invoice-sale-not-synced", "La venta pendiente todavía no se sincronizó.", 409);
  }
  const requested = sourceType === "seller_sale"
    ? sale.ticketRequested === true && !["cancelled", "canceled", "not_requested"].includes(String(sale.ticketStatus || "pending"))
    : sale.invoiceRequested === true || sale.invoiceStatus === "pending";
  if (!requested) {
    fail("arca-invoice-not-requested", "La venta no tiene una solicitud de factura pendiente.", 409);
  }
}

function publicInvoice(document, created) {
  const data = document?.data || {};
  return {
    id: document?.path?.split("/").at(-1) || data.id || null,
    status: data.status || "pending",
    sourceType: data.sourceType,
    sourceId: data.sourceId,
    amount: data.amount,
    environment: data.environment || null,
    createdAt: data.createdAt || null,
    created,
  };
}

function assertInvoiceMatches(document, sourceType, sourceId) {
  if (document?.data?.sourceType !== sourceType || document?.data?.sourceId !== sourceId) {
    fail("arca-invoice-idempotency-conflict", "El identificador de facturación ya está asociado a otro origen.", 409);
  }
}

export async function persistInvoiceIntent({
  sourceType,
  sourceId,
  session,
  env = process.env,
} = {}) {
  if (!SUPPORTED_SOURCE_TYPES.includes(sourceType)) {
    fail("arca-invoice-source-unsupported", "Este tipo de operación todavía no admite facturación.", 409);
  }

  let invoiceId;
  try {
    invoiceId = invoiceIdFor(sourceType, sourceId);
  } catch {
    fail("arca-invoice-source-invalid", "El identificador de la venta no es válido.", 400);
  }
  const normalizedSourceId = String(sourceId).trim();
  const invoicePath = `invoices/${invoiceId}`;
  const existing = await adminGetDocument(invoicePath, { env });
  if (existing) {
    assertInvoiceMatches(existing, sourceType, normalizedSourceId);
    assertCanAccessSource(session, existing.data.sellerId);
    return publicInvoice(existing, false);
  }

  const sale = await adminGetDocument(`sales/${normalizedSourceId}`, { env });
  if (!sale) fail("arca-invoice-sale-not-found", "No se encontró la venta solicitada.", 404);
  assertCanAccessSource(session, sale.data.sellerId);
  assertSaleCanBePersisted(sourceType, sale.data);

  const amount = safeNumber(sale.data.total, "total");
  const items = snapshotItems(sale.data.items);
  const now = new Date();
  const environment = String(env.ARCA_ENVIRONMENT || "homologation").trim().toLowerCase();
  const record = {
    schemaVersion: 1,
    idempotencyKey: invoiceId,
    sourceType,
    sourceId: normalizedSourceId,
    sourceCollection: "sales",
    saleCode: String(sale.data.saleCode || "").trim().slice(0, 80) || null,
    sellerId: String(sale.data.sellerId || ""),
    locationId: String(sale.data.locationId || ""),
    requestedBy: session.uid,
    environment: ["homologation", "production"].includes(environment) ? environment : null,
    status: "pending",
    processingStage: "intent-persisted",
    authorizationStarted: false,
    amount,
    currencyId: "PES",
    discountTotal: safeNumber(sale.data.discountTotal || 0, "descuento"),
    items,
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    voucherType: null,
    voucherNumber: null,
    cae: null,
    caeExpiration: null,
  };

  try {
    const created = await adminCreateDocument("invoices", invoiceId, record, { env });
    return publicInvoice(created, true);
  } catch (error) {
    if (error?.code !== "firebase-admin-already-exists") throw error;
    const concurrent = await adminGetDocument(invoicePath, { env });
    if (!concurrent) {
      fail("arca-invoice-idempotency-read-failed", "La solicitud ya existe, pero no pudimos recuperar su estado.", 503);
    }
    assertInvoiceMatches(concurrent, sourceType, normalizedSourceId);
    assertCanAccessSource(session, concurrent.data.sellerId);
    return publicInvoice(concurrent, false);
  }
}
