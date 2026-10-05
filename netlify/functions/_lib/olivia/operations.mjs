import { createHash } from "node:crypto";
import { OLIVIA_CAPABILITIES } from "../../../../src/shared/oliviaCapabilities.mjs";
import { executeExtendedOperation } from "./extendedOperations.mjs";
import {
  can,
  canAccessAdministration,
  effectiveSellerLocations,
} from "../../../../src/gestion/permissions.js";
import {
  buildCustomerDraft,
  customerDocumentId,
} from "../../../../src/gestion/customers/customerDomain.js";
import { effectiveLocationPrice } from "../../../../src/modules/inventory/domain/inventory.js";
import { isLocationActiveNow } from "../../../../src/modules/locations/domain/locations.js";
import { isDiscountAvailable } from "../../../../src/modules/locations/domain/dashboard.js";
import { calculateDiscountSummary } from "../../../../src/modules/locations/domain/discounts.js";
import {
  normalizePayment,
  PAYMENT_LABELS,
} from "../../../../src/modules/locations/domain/payments.js";
import {
  ARGENTINA_TIME_ZONE,
  argentinaDateKey,
} from "../../../../src/modules/locations/domain/time.js";
import {
  buildOperationalSalePlan,
  buildLocationStockLinePlan,
  cleanOperationalSaleItems,
  customerSaleWrite,
  resolveOperationalCustomer,
} from "../../../../src/shared/operationalWritePlans.mjs";

const operationError = (message, code = "operation-invalid", status = 422) =>
  Object.assign(new Error(message), { code, status });
const validId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const positiveQuantity = (value) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const identity = (session) => session.uid || session.profile?.id;
const profileFor = (session) => ({ ...session.profile, id: identity(session) });
const incomplete = (missing, summary) => ({
  state: "DATOS_INCOMPLETOS",
  missing,
  summary,
});
const stableValue = (value) =>
  value instanceof Date
    ? value.toISOString()
    : Array.isArray(value)
      ? value.map(stableValue)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .filter((key) => !key.startsWith("__"))
              .sort()
              .map((key) => [key, stableValue(value[key])]),
          )
        : value;
const fingerprint = (value) =>
  createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
const read = async (store, path) => {
  const value = await store.get(path);
  return value ? { ...value, id: path.split("/").at(-1) } : null;
};
const requireActive = (profile) => {
  if (!profile?.id || profile.active !== true)
    throw operationError("La sesión no está activa.", "permission-denied", 403);
};

async function saleContext({ session, args, store, now }) {
  const profile = profileFor(session);
  requireActive(profile);
  if (!can(profile, "quick-sales", "create"))
    throw operationError(
      "No tenés permiso para registrar ventas.",
      "permission-denied",
      403,
    );
  const location = await read(store, `locations/${args.locationId}`);
  if (!location || !effectiveSellerLocations(profile, [location], now).length)
    throw operationError(
      "No tenés permiso para vender desde esta ubicación activa.",
      "permission-denied",
      403,
    );
  const products = [],
    stocks = [],
    saleItems = [];
  for (const line of args.items) {
    const product = await read(store, `products/${line.productId}`);
    const stock = await read(
      store,
      `locationStock/${location.id}/items/${line.productId}`,
    );
    if (
      !product ||
      product.active === false ||
      product.deleted === true ||
      !stock ||
      stock.active === false ||
      stock.deleted === true ||
      stock.productDeleted === true
    )
      throw operationError(
        "Uno de los productos ya no está habilitado en la ubicación.",
        "context-unavailable",
        409,
      );
    const unitPrice = effectiveLocationPrice(product, stock);
    if (!Number.isSafeInteger(unitPrice) || unitPrice < 0)
      throw operationError("El precio configurado del producto no es válido.");
    products.push(product);
    stocks.push(stock);
    saleItems.push({
      productId: product.id,
      name: product.name || stock.productName,
      abbreviation: product.abbreviation || stock.abbreviation || "",
      categoryId: product.categoryId || null,
      unitPrice,
      qty: line.qty,
    });
  }
  const items = cleanOperationalSaleItems(saleItems);
  const discounts = [],
    discountDocuments = [];
  if (args.discounts.length && !can(profile, "quick-sales", "useDiscounts"))
    throw operationError(
      "No tenés permiso para aplicar descuentos.",
      "permission-denied",
      403,
    );
  const savedIds = new Set();
  for (const requested of args.discounts) {
    if (requested.source === "manual" || requested.discountId === "manual") {
      if (!can(profile, "quick-sales", "useManualDiscounts"))
        throw operationError(
          "No tenés permiso para aplicar descuentos manuales.",
          "permission-denied",
          403,
        );
      if (
        !["fixed", "percent"].includes(requested.type) ||
        !positiveQuantity(requested.value) ||
        (requested.type === "percent" && requested.value > 100)
      )
        throw operationError("El descuento manual no es válido.");
      discounts.push({
        discountId: "manual",
        name: String(requested.name || "Descuento manual")
          .trim()
          .slice(0, 160),
        type: requested.type,
        value: requested.value,
        source: "manual",
      });
    } else {
      if (!validId(requested.discountId))
        throw operationError(
          "Falta el identificador del descuento configurado.",
        );
      if (savedIds.has(requested.discountId)) continue;
      savedIds.add(requested.discountId);
      const discount = await read(store, `discounts/${requested.discountId}`);
      if (
        !discount ||
        !isDiscountAvailable(discount, location, now, { profile, items })
      )
        throw operationError(
          "El descuento configurado ya no está disponible para esta venta.",
          "context-changed",
          409,
        );
      discountDocuments.push(discount);
      discounts.push({
        discountId: discount.id,
        name: discount.name,
        type: discount.type,
        value: discount.value,
        source: "saved",
      });
    }
  }
  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  const discountSummary = calculateDiscountSummary(discounts, subtotal);
  if (
    args.paymentMethod === "multiple" &&
    !can(profile, "quick-sales", "useMultiplePayments")
  )
    throw operationError(
      "No tenés permiso para combinar pagos.",
      "permission-denied",
      403,
    );
  const payment = normalizePayment(
    args.paymentMethod,
    PAYMENT_LABELS[args.paymentMethod],
    args.payments,
    discountSummary.total,
  );
  let preparedCustomer = null,
    customerExisting = null,
    customer = null;
  if (args.customerDecision === "associate") {
    const draft = buildCustomerDraft(args.customer);
    preparedCustomer = {
      ...draft,
      id: await customerDocumentId(draft.phoneNormalized),
    };
    customerExisting = await read(store, `customers/${preparedCustomer.id}`);
    customer = resolveOperationalCustomer(customerExisting, preparedCustomer);
  }
  return {
    profile,
    location,
    products,
    stocks,
    items,
    discountSummary,
    discountDocuments,
    payment,
    preparedCustomer,
    customerExisting,
    customer,
    day: argentinaDateKey(now),
  };
}

async function stockContext({ session, args, store, now }) {
  const profile = profileFor(session);
  requireActive(profile);
  if (
    !canAccessAdministration(profile) ||
    !can(profile, "locations", "loadStock")
  )
    throw operationError(
      "La carga asistida de stock requiere un administrador con permiso de carga.",
      "permission-denied",
      403,
    );
  const location = await read(store, `locations/${args.locationId}`),
    product = await read(store, `products/${args.productId}`),
    stock = await read(
      store,
      `locationStock/${args.locationId}/items/${args.productId}`,
    );
  if (!location || !isLocationActiveNow(location, now))
    throw operationError(
      "La ubicación no está habilitada para cargar stock.",
      "context-unavailable",
      409,
    );
  if (!product || product.active === false || product.deleted === true)
    throw operationError(
      "El producto ya no está disponible.",
      "context-unavailable",
      409,
    );
  if (
    stock &&
    (stock.deleted === true ||
      stock.productDeleted === true ||
      stock.active === false)
  )
    throw operationError(
      "El producto local está desactivado. Habilitalo desde la gestión manual antes de cargar stock.",
      "context-unavailable",
      409,
    );
  const plan = buildLocationStockLinePlan({
    product,
    existing: stock || {},
    mode: "add",
    requested: args.quantity,
    entry: { reason: args.reason },
    operationId: "preview",
    location,
    profile,
    stamp: now,
  });
  return { profile, location, product, stock, plan };
}

function canonicalSaleArgs(args = {}) {
  const missing = [];
  if (!validId(args.locationId)) missing.push("locationId");
  if (!Array.isArray(args.items) || !args.items.length) missing.push("items");
  if (!PAYMENT_LABELS[args.paymentMethod]) missing.push("paymentMethod");
  if (typeof args.ticketRequested !== "boolean")
    missing.push("ticketRequested");
  if (!["none", "associate"].includes(args.customerDecision))
    missing.push("customerDecision");
  if (!["none", "apply"].includes(args.promotionDecision))
    missing.push("promotionDecision");
  if (args.customerDecision === "associate" && !args.customer?.phone)
    missing.push("customer.phone");
  if (
    args.promotionDecision === "apply" &&
    (!Array.isArray(args.discounts) || !args.discounts.length)
  )
    missing.push("discounts");
  if (
    args.paymentMethod === "multiple" &&
    (!Array.isArray(args.payments) || args.payments.length < 2)
  )
    missing.push("payments");
  if (missing.length)
    return incomplete(
      missing,
      "Necesito completar ubicación, productos, pago y las decisiones sobre cliente, descuentos y ticket antes de preparar la venta.",
    );
  if (
    args.items.length > 40 ||
    args.items.some(
      (item) => !validId(item?.productId) || !positiveQuantity(item?.qty),
    ) ||
    new Set(args.items.map((item) => item.productId)).size !== args.items.length
  )
    throw operationError(
      "Ingresá hasta 40 productos únicos con cantidades enteras positivas.",
    );
  if (args.customerDecision === "none" && args.customer != null)
    throw operationError(
      "La decisión sobre el cliente no coincide con los datos enviados.",
    );
  if (args.promotionDecision === "none" && args.discounts?.length)
    throw operationError(
      "La decisión sobre promociones no coincide con los descuentos enviados.",
    );
  if (
    args.discounts &&
    (!Array.isArray(args.discounts) || args.discounts.length > 12)
  )
    throw operationError("La lista de descuentos no es válida.");
  if (args.ticketRequested)
    return {
      state: "RECHAZADA",
      missing: [],
      summary:
        "La emisión de ticket fiscal requiere completar la venta en el Panel Vendedor y utilizar su integración ARCA. Abrí el panel para revisar los datos fiscales.",
      manualRoute: "/vendedor",
    };
  return {
    locationId: args.locationId,
    items: args.items.map(({ productId, qty }) => ({ productId, qty })),
    paymentMethod: args.paymentMethod,
    payments:
      args.paymentMethod === "multiple"
        ? args.payments.map(({ method, amount }) => ({ method, amount }))
        : [],
    ticketRequested: false,
    customerDecision: args.customerDecision,
    customer:
      args.customerDecision === "associate"
        ? buildCustomerDraft(args.customer)
        : null,
    promotionDecision: args.promotionDecision,
    discounts:
      args.promotionDecision === "apply"
        ? args.discounts.map((d) => ({
            discountId: d.discountId || null,
            type: d.type || null,
            value: d.value ?? null,
            source: d.source || "saved",
            name: d.name || null,
          }))
        : [],
  };
}

/** Resolve an explicit user intent against current authorized business data.
 * The returned fingerprint binds the confirmation to the reviewed prices,
 * stock, location, customer and permissions; no writes occur here.
 */
export async function prepareOperation({
  session,
  args = {},
  toolName,
  store,
  now = new Date(),
}) {
  if (toolName === "prepare_sale") {
    const canonicalArgs = canonicalSaleArgs(args);
    if (canonicalArgs.state) return canonicalArgs;
    const context = await saleContext({
      session,
      args: canonicalArgs,
      store,
      now,
    });
    const stockWarnings = context.items.filter(
      (item, index) =>
        item.qty > Number(context.stocks[index].currentStock || 0),
    );
    const money = new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 0,
    });
    const summary = `Registrar venta en ${context.location.name}: ${context.items.map((item) => `${item.qty} × ${item.name} a ${money.format(item.unitPrice)}`).join("; ")}. Total ${money.format(context.discountSummary.total)}. Pago: ${PAYMENT_LABELS[canonicalArgs.paymentMethod]}${canonicalArgs.payments.length ? ` (${canonicalArgs.payments.map((part) => `${PAYMENT_LABELS[part.method]} ${money.format(part.amount)}`).join(" + ")})` : ""}. ${context.discountSummary.discounts.length ? `Descuentos: ${context.discountSummary.discounts.map((d) => `${d.name} (${d.type === "percent" ? `${d.value}%` : money.format(d.value)})`).join(", ")}.` : "Sin descuentos."} ${context.customer ? `Cliente: ${context.customer.name || "sin nombre"} (${context.customer.phone}).` : "Sin asociar cliente."} Sin ticket fiscal.${
      stockWarnings.length
        ? ` Atención: queda stock negativo en ${stockWarnings
            .map((item) => {
              const stock = Number(
                context.stocks[context.items.indexOf(item)].currentStock || 0,
              );
              return `${item.name}: stock registrado ${stock}, venta ${item.qty}, saldo ${stock - item.qty}, faltan ${item.qty - stock} unidades`;
            })
            .join(", ")}; el faltante queda auditado para conciliar.`
        : ""
    }`;
    return {
      toolName,
      summary,
      canonicalArgs,
      snapshotFingerprint: fingerprint(context),
    };
  }
  if (toolName === "prepare_stock_load") {
    const missing = [];
    if (!validId(args.locationId)) missing.push("locationId");
    if (!validId(args.productId)) missing.push("productId");
    if (args.quantity == null) missing.push("quantity");
    if (!String(args.reason || "").trim()) missing.push("reason");
    if (missing.length)
      return incomplete(
        missing,
        "Necesito la ubicación, el producto, la cantidad a ingresar y el motivo de la carga.",
      );
    if (!positiveQuantity(args.quantity))
      throw operationError("La cantidad a cargar debe ser un entero positivo.");
    const canonicalArgs = {
      locationId: args.locationId,
      productId: args.productId,
      quantity: args.quantity,
      reason: String(args.reason).trim().slice(0, 500),
    };
    const context = await stockContext({
      session,
      args: canonicalArgs,
      store,
      now,
    });
    return {
      toolName,
      summary: `Agregar ${canonicalArgs.quantity} unidades de ${context.product.name} en ${context.location.name}. Stock: ${context.plan.previousStock} → ${context.plan.currentStock}. Motivo: ${canonicalArgs.reason}.`,
      canonicalArgs,
      snapshotFingerprint: fingerprint({ ...context, plan: undefined }),
    };
  }
  throw operationError("La operación solicitada no está habilitada.");
}

/** Build the complete atomic write set after server-owned confirmation.
 * Reads use the Firestore transaction snapshot and adapters commit the returned
 * writes together with the consumed confirmation. This never calls a model.
 */
export async function executeOperation({
  session,
  prepared,
  transaction,
  now = new Date(),
  correlation,
}) {
  if (OLIVIA_CAPABILITIES[prepared.toolName]) return executeExtendedOperation({ session, prepared, transaction, now, correlation });
  const uid = identity(session);
  const profileDocument = await transaction.getDocument(`users/${uid}`);
  const freshSession = {
    ...session,
    uid,
    profile: { ...(profileDocument?.data || {}), id: uid },
  };
  requireActive(freshSession.profile);
  const documents = new Map();
  const store = {
    get: async (path) => {
      if (!documents.has(path))
        documents.set(path, await transaction.getDocument(path));
      return documents.get(path)?.data || null;
    },
  };
  const current = await prepareOperation({
    session: freshSession,
    args: prepared.canonicalArgs,
    toolName: prepared.toolName,
    store,
    now,
  });
  if (
    current.state ||
    current.snapshotFingerprint !== prepared.snapshotFingerprint
  )
    throw operationError(
      "Cambió el precio, stock, ubicación, cliente o tus permisos. Prepará una nueva propuesta antes de confirmar.",
      "context-changed",
      409,
    );
  if (!validId(correlation?.confirmationId))
    throw operationError("Falta el identificador de confirmación.");
  const marker = { ...correlation, origin: "Asistente IA / Olivia" };
  const writes = [];
  const write = (path, data, forceCreate = false) => {
    const previous = documents.get(path);
    writes.push({
      type: forceCreate || !previous ? "create" : "update",
      path,
      data,
      ...(previous?.updateTime
        ? { currentUpdateTime: previous.updateTime }
        : {}),
    });
  };
  if (prepared.toolName === "prepare_sale") {
    const context = await saleContext({
      session: freshSession,
      args: current.canonicalArgs,
      store,
      now,
    });
    const saleId = `olivia_sale_${correlation.confirmationId}`,
      counterPrefix = String(context.location.codePrefix || "LOC")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 8),
      dateKey = context.day.replaceAll("-", "");
    const counterPath = `counters/${counterPrefix}_${dateKey}`,
      counter = await store.get(counterPath);
    const movementIds = context.items.map((_, index) => `${saleId}_${index}`);
    const plan = buildOperationalSalePlan({
      profile: context.profile,
      location: context.location,
      items: context.items,
      stocks: context.stocks,
      counter: counter || {},
      saleId,
      movementIds,
      dateKey,
      prefix: counterPrefix,
      stamp: now,
      localFields: {
        saleDate: context.day,
        saleTime: new Intl.DateTimeFormat("es-AR", {
          timeZone: ARGENTINA_TIME_ZONE,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(now),
      },
      discountSummary: context.discountSummary,
      payment: context.payment,
      customer: context.customer,
    });
    write(counterPath, plan.counterData);
    plan.stockWrites.forEach((line, index) => {
      write(
        `locationStock/${context.location.id}/items/${line.productId}`,
        line.stockData,
      );
      write(
        `stockMovements/${movementIds[index]}`,
        { ...line.movementData, ...marker },
        true,
      );
    });
    if (context.customer)
      write(
        `customers/${context.customer.id}`,
        customerSaleWrite({
          existing: context.customerExisting,
          customer: context.customer,
          profile: context.profile,
          saleId,
          stamp: now,
        }),
      );
    write(
      `sales/${saleId}`,
      {
        ...plan.saleData,
        assistantOrigin: marker.origin,
        assistantCorrelation: marker,
      },
      true,
    );
    write(`auditLogs/${saleId}`, { ...plan.auditData, ...marker, before: plan.stockWrites.map((line) => ({ productId: line.productId, currentStock: line.movementData.previousStock })), after: { saleId, total: plan.result.total, stocks: plan.stockWrites.map((line) => ({ productId: line.productId, currentStock: line.stockData.currentStock })) } }, true);
    return {
      result: {
        ...plan.result,
        state: "COMPLETADA",
        message: `Venta ${plan.result.saleCode} registrada por ${plan.result.total} pesos.`,
        route: "/vendedor",
      },
      writes,
    };
  }
  const context = await stockContext({
    session: freshSession,
    args: current.canonicalArgs,
    store,
    now,
  });
  const operationId = `olivia_stock_${correlation.confirmationId}`;
  const plan = buildLocationStockLinePlan({
    product: context.product,
    existing: context.stock || {},
    mode: "add",
    requested: current.canonicalArgs.quantity,
    entry: { reason: current.canonicalArgs.reason },
    operationId,
    location: context.location,
    profile: context.profile,
    stamp: now,
  });
  write(
    `locationStock/${context.location.id}/items/${context.product.id}`,
    plan.stockData,
  );
  write(
    `stockMovements/${plan.movementId}`,
    { ...plan.movementData, ...marker },
    true,
  );
  write(`locations/${context.location.id}`, {
    stockConfiguredAt: now,
    updatedAt: now,
    updatedBy: uid,
  });
  const result = {
    operationId,
    locationId: context.location.id,
    mode: "add",
    itemCount: 1,
    userId: uid,
    createdAt: now,
    status: "completed",
  };
  write(`stockOperations/${operationId}`, { ...result, ...marker }, true);
  write(
    `auditLogs/${operationId}`,
    {
      action: "stock.add",
      title: "Mercadería agregada",
      description: `1 producto · ${context.location.name}`,
      moduleId: "locations",
      entityType: "stockOperation",
      entityId: operationId,
      locationId: context.location.id,
      locationName: context.location.name,
      status: "completed",
      userId: uid,
      userName: context.profile.name || context.profile.email || "Usuario",
      createdAt: now,
      before: { currentStock: plan.movementData.previousStock },
      after: { currentStock: plan.stockData.currentStock },
      ...marker,
    },
    true,
  );
  return {
    result: {
      ...result,
      state: "COMPLETADA",
      message: `Se agregaron ${current.canonicalArgs.quantity} unidades de ${context.product.name}. Stock actual: ${plan.currentStock}.`,
      route: `/gestion/locations/${context.location.id}`,
    },
    writes,
  };
}
