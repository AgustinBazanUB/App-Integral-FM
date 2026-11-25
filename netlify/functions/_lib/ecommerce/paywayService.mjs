import { createHash, timingSafeEqual } from "node:crypto";
import { adminRunTransaction, adminGetDocument } from "../firestoreAdminRest.mjs";
import { checkoutEditPath, commerceError } from "./commerceDomain.mjs";
import { confirmEcommercePayment } from "./paymentService.mjs";
import { paywayConfig, paywayAmount, createPaywayGateway, verifiedPaywayReceipt, paywayRetailRisk } from "./paywayGateway.mjs";
import { canAccessAdministration } from "../../../../src/gestion/permissions.js";
import { loadWebChannel, orderReservationAllocations, originKey, originStockPath, resolveChannelOrigin, webStockAvailability } from "./channelService.mjs";
import { reservationPatch } from "../../../../src/shared/stockReservations.mjs";

function denied() { return commerceError("ecommerce-order-access-denied", "El acceso privado al pedido no es válido.", 403); }

function privateAccessHash({ orderId, accessToken }) {
  if (typeof orderId !== "string" || typeof accessToken !== "string"
      || !/^ecommerce_order_[A-Za-z0-9_-]{8,96}$/.test(orderId) || !/^[A-Za-z0-9_-]{32,128}$/.test(accessToken)) throw denied();
  return createHash("sha256").update(accessToken).digest("hex");
}

export function assertPaywayOrderAccess(order, body) {
  const digest = privateAccessHash(body);
  if (!order || order.sourceType !== "ecommerce" || !order.accessHash || order.accessHash.length !== digest.length
      || !timingSafeEqual(Buffer.from(digest), Buffer.from(order.accessHash))) throw denied();
}
function publicResult(order, gateway, extra = {}) {
  return { order: { id: order.id, total: order.total, subtotal: order.subtotal, shippingAmount: order.shippingAmount,
    discountTotal: order.discountTotal, status: order.status, paymentStatus: order.paymentStatus, saleId: order.saleId || null,
    shipmentId: order.shipmentId || null, invoiceStatus: order.invoiceStatus,
    deliveryAddress: order.shipping?.address ? {
      street: order.shipping.address.street,
      number: order.shipping.address.number,
      city: order.shipping.address.city,
      province: order.shipping.address.province,
      postalCode: order.shipping.address.postalCode,
    } : null },
    gateway: { environment: "sandbox", state: gateway?.state || "ready", status: gateway?.receipt?.status || "pending",
      reference: gateway?.receipt?.providerId || null, operationId: gateway?.operationId || null }, ...extra };
}

async function releaseCheckoutForEditing(body, { env, now, runTransaction }) {
  const { orderId } = body;
  const accessHash = privateAccessHash(body);
  const orderPath = "orders/" + orderId;
  return runTransaction(async (tx) => {
    const order = (await tx.getDocument(orderPath))?.data;
    if (!order) {
      // A checkout POST may still be arriving after the browser lost its response.
      const path = checkoutEditPath(orderId);
      const previous = (await tx.getDocument(path))?.data;
      if (previous && previous.accessHash !== accessHash) throw denied();
      if (!previous) await tx.commitDocuments([{ type: "create", path, data: { accessHash, abandonedAt: now } }]);
      return { editable: true };
    }

    assertPaywayOrderAccess(order, body);
    const paymentPath = "payments/" + order.paymentId;
    const payment = (await tx.getDocument(paymentPath))?.data;
    if (!payment || payment.orderId !== orderId)
      throw commerceError("ecommerce-payment-invalid", "El pago y el pedido no coinciden.", 409);
    const approved = ["approved", "simulated_approved"];
    const finalFailure = ["rejected", "cancelled"];
    if (order.saleId || order.status === "confirmed" || approved.includes(payment.status) || approved.includes(order.paymentStatus))
      throw commerceError("ecommerce-checkout-already-paid", "El pedido ya está pagado.", 409);
    if (payment.gateway && !finalFailure.includes(payment.gateway.receipt?.status))
      throw commerceError("ecommerce-checkout-payment-unresolved", "Consultá el resultado del pago antes de editar.", 409);
    if (["cancelled", "expired", "payment_rejected", "payment_cancelled"].includes(order.status) && order.reservationStatus !== "active")
      return { editable: true };
    if (order.status !== "pending_payment")
      throw commerceError("ecommerce-order-conflict", "El pedido ya no admite cambios.", 409);

    const operations = [];
    for (const item of order.items) {
      const reserved = orderReservationAllocations(order, item);
      const allocations = reserved.length ? reserved : [{
        type: order.stockOriginType || "location",
        id: order.stockOriginId || order.locationId,
      }];
      for (const allocation of allocations) {
        const path = originStockPath(allocation, item.productId);
        const stock = (await tx.getDocument(path))?.data;
        if (stock?.ecommerceReservations?.[orderId]) operations.push({
          type: "update", path, data: reservationPatch(stock, orderId, null, now),
        });
      }
    }

    await tx.commitDocuments([
      ...operations,
      { type: "update", path: paymentPath, data: { status: "cancelled", updatedAt: now } },
      { type: "update", path: orderPath, data: {
        status: "cancelled", paymentStatus: "cancelled", reservationStatus: "released",
        cancelledForEditing: true, updatedAt: now,
      } },
    ]);
    return { editable: true };
  }, { env });
}

export async function processPaywayPayment({ body, env = process.env, now = new Date(), runTransaction = adminRunTransaction,
  getDocument = adminGetDocument, gateway, confirm = confirmEcommercePayment, adminActor = null, clientIp = "" } = {}) {
  const config = paywayConfig(env);
  if (!body || !["pay", "reconcile", "edit"].includes(body.mode)) throw commerceError("payway-request-invalid", "Operación Payway inválida.", 400);
  // Allowlist the complete public request: PAN/CVV and client totals never enter SDK payloads or storage.
  if (Object.keys(body).some(key => !["mode", "orderId", "accessToken", "token", "bin", "paymentMethodId", "payerAddress", "fingerprint"].includes(key)))
    throw commerceError("payway-request-invalid", "La solicitud sólo admite un token de pago.", 400);
  if (body.mode === "edit") return releaseCheckoutForEditing(body, { env, now, runTransaction });
  if (!/^ecommerce_order_[A-Za-z0-9_-]{8,96}$/.test(body.orderId || "")) throw denied();
  let charge = false;
  const claimed = await runTransaction(async (tx) => {
    const snapshot = await tx.getDocument(`orders/${body.orderId}`);
    const order = snapshot?.data;
    if (adminActor && body.mode === "reconcile") {
      const profile = (await tx.getDocument(`users/${adminActor.uid}`))?.data;
      if (!profile?.active || !canAccessAdministration(profile) || order?.sourceType !== "ecommerce") throw denied();
    } else assertPaywayOrderAccess(order, body);
    const payment = (await tx.getDocument(`payments/${order.paymentId}`))?.data;
    if (!payment || payment.orderId !== body.orderId || payment.amount !== order.total || payment.currency !== "ARS")
      throw commerceError("ecommerce-payment-amount-conflict", "El pago y el pedido no coinciden.", 409);
    let attempt = payment.gateway || null;
    if (attempt && attempt.siteId !== config.siteId) throw commerceError("payway-response-mismatch", "El sitio Payway cambió. Conciliá la operación anterior.", 409);
    if (!attempt && body.mode === "pay") {
      if (order.status !== "pending_payment" || order.paymentStatus !== "pending" || !order.channelId
          || order.reservationStatus !== "active" || new Date(order.reservationExpiresAt) <= now)
        throw commerceError("ecommerce-reservation-expired", "El pedido no tiene una reserva vigente para pagar.", 409);
      if (!/^[A-Za-z0-9_-]{16,200}$/.test(body.token || "")) throw commerceError("payway-token-invalid", "Volvé a completar los datos de tarjeta.", 400);
      if (!/^\d{6,8}$/.test(body.bin || "")) throw commerceError("payway-token-invalid", "El token no incluye un BIN válido.", 400);
      const paymentMethodId = body.paymentMethodId ?? 104;
      if (![104, 1].includes(paymentMethodId)) throw commerceError("payway-request-invalid", "El medio de pago no está habilitado en sandbox.", 400);
      const risk = paywayRetailRisk(order, { payerAddress: body.payerAddress, fingerprint: body.fingerprint, clientIp });
      // Check every held physical allocation again before a provider call. Extend
      // the same holds while a result is uncertain; cancellation is blocked too.
      const holdUntil = new Date(now.valueOf() + 24 * 60 * 60 * 1000);
      const channel = await loadWebChannel({ env, getDocument: tx.getDocument });
      if (!channel) throw commerceError("ecommerce-channel-inactive", "El canal web no está habilitado.", 409);
      const origins = new Set();
      const stocks = new Map();
      for (const item of order.items) {
        const reservations = orderReservationAllocations(order, item);
        if (!reservations.length) throw commerceError("ecommerce-reservation-invalid", "Falta la reserva de stock.", 409);
        for (const allocation of reservations) {
          const key = originKey(allocation);
          if (!origins.has(key)) {
            await resolveChannelOrigin(channel, allocation, { env, getDocument: tx.getDocument, now });
            origins.add(key);
          }
          const path = originStockPath(allocation, item.productId);
          if (stocks.has(path))
            throw commerceError("ecommerce-reservation-invalid", "La reserva contiene una asignación repetida.", 409);
          stocks.set(path, await tx.getDocument(path));
          const stock = stocks.get(path)?.data;
          const hold = stock?.ecommerceReservations?.[body.orderId];
          if (!hold || !Number.isSafeInteger(allocation.quantity) || allocation.quantity <= 0 || hold.quantity !== allocation.quantity
              || new Date(hold.expiresAt) <= now || webStockAvailability(stock, now, body.orderId) < allocation.quantity)
            throw commerceError("ecommerce-reservation-invalid", "La reserva de stock ya no está disponible.", 409);
        }
      }
      attempt = { state: "submitted", environment: "sandbox", siteId: config.siteId,
        operationId: `fm_${createHash("sha256").update(body.orderId).digest("hex").slice(0,32)}`,
        amount: paywayAmount(order.total), currency: "ARS", paymentMethodId, submittedAt: now, reconciliationCount: 0 };
      const operations = [...stocks].map(([path, stock]) => ({
        type: "update",
        path,
        data: reservationPatch(stock.data, body.orderId, {
          ...stock.data.ecommerceReservations[body.orderId],
          expiresAt: holdUntil,
        }, now),
      }));
      operations.push({ type: "update", path: `payments/${order.paymentId}`, data: { gateway: attempt, paymentEnvironment: "sandbox", testData: true, updatedAt: now } },
        { type: "update", path: `orders/${body.orderId}`, data: { reservationExpiresAt: holdUntil, paymentEnvironment: "sandbox", testData: true, updatedAt: now } });
      await tx.commitDocuments(operations);
      return { order: { ...order, id: body.orderId, reservationExpiresAt: holdUntil }, attempt, risk, charge: true };
    }
    return { order: { ...order, id: body.orderId }, attempt, charge: false };
  }, { env });
  charge = claimed.charge;
  let { order, attempt } = claimed;
  if (!attempt) return publicResult(order, { state: order.status !== "pending_payment" || new Date(order.reservationExpiresAt) <= now ? "expired" : "ready" });
  if (order.saleId || ["rejected", "cancelled"].includes(order.paymentStatus)) return publicResult(order, attempt);
  if (!attempt.receipt || attempt.receipt.status === "pending") {
    // A parallel second click does not race a query against a still-running POST.
    if (!charge && now.valueOf() - new Date(attempt.submittedAt).valueOf() < 15000) return publicResult(order, attempt);
    try {
      gateway ||= createPaywayGateway(env);
      let response;
      if (charge) response = await gateway.charge({ site_transaction_id: attempt.operationId, token: body.token,
        payment_method_id: attempt.paymentMethodId, bin: body.bin, amount: attempt.amount, currency: "ARS", installments: 1,
        customer: { id: order.idempotencyKey, email: order.customer.email, ip_address: clientIp }, fraud_detection: claimed.risk,
        payment_type: "single", sub_payments: [] });
      else {
        const matches = await gateway.find(attempt.operationId);
        if (matches.length !== 1) throw commerceError("payway-uncertain", "La operación continúa en verificación.", 503);
        response = await gateway.info(matches[0].id);
      }
      const receipt = verifiedPaywayReceipt(response, { ...attempt, siteId: config.siteId });
      attempt = await saveAttempt({ receipt, state: receipt.status === "pending" ? "pending" : "verified", errorCode: null });
    } catch (error) {
      attempt = await saveAttempt({ state: "uncertain", errorCode: error?.code === "payway-response-mismatch" ? error.code : "payway-uncertain" });
      return publicResult(order, attempt);
    }
  }
  if (attempt.receipt?.status !== "pending") {
    try {
      const result = await confirm({ orderId: order.id, idempotencyKey: order.idempotencyKey, provider: "payway",
        status: attempt.receipt.status, reference: attempt.receipt.providerId, env });
      order = result.order;
      attempt = await saveAttempt({ state: "completed", errorCode: null });
    } catch {
      // Approval remains durable even if stock, pricing, logistics, or commit fail.
      attempt = await saveAttempt({ state: "recovery_required", errorCode: "payway-commercial-recovery" });
    }
  }
  return publicResult(order, attempt);

  async function saveAttempt(patch) {
    return runTransaction(async (tx) => {
      const payment = (await tx.getDocument(`payments/${order.paymentId}`))?.data;
      const previous = payment?.gateway;
      if (!previous || previous.operationId !== attempt.operationId) throw commerceError("payway-response-mismatch", "La operación cambió.", 409);
      // A delayed timeout/query must never overwrite an authenticated approval.
      if (previous.receipt?.status === "approved" && ((patch.receipt && patch.receipt.status !== "approved") || patch.state === "uncertain")) return previous;
      if (previous.state === "completed") return previous;
      const next = { ...previous, ...patch, updatedAt: new Date(), reconciliationCount: (previous.reconciliationCount || 0) + (charge ? 0 : 1) };
      await tx.commitDocuments([
        { type: "update", path: `payments/${order.paymentId}`, data: { gateway: next, updatedAt: new Date() } },
        { type: "update", path: `orders/${order.id}`, data: { paywayState: next.state, paywayReference: next.receipt?.providerId || null,
          paywayProviderStatus: next.receipt?.providerStatus || null,
          paymentIncident: next.state === "recovery_required" ? { code: "payway-commercial-recovery", providerApproved: next.receipt?.status === "approved", updatedAt: new Date() } : null,
          updatedAt: new Date() } },
      ]);
      return next;
    }, { env });
  }
}
