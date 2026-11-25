import { createHash, timingSafeEqual } from "node:crypto";
import { reservationPatch } from "../../../../src/shared/stockReservations.mjs";
import { checkoutEditPath, commerceError, normalizeEcommerceRequestId } from "./commerceDomain.mjs";
import { originStockPath } from "./channelService.mjs";

export const CHECKOUT_RESERVATION_MS = 10 * 60 * 1000;

export function checkoutReservationPath(orderId) {
  return "ecommerceOperations/checkout_hold_" + orderId;
}

export function checkoutCartFingerprint(items) {
  return JSON.stringify([...items].sort((left, right) => left.productId.localeCompare(right.productId)));
}

export function checkoutCredentials({ requestId, accessToken } = {}) {
  const orderId = "ecommerce_order_" + normalizeEcommerceRequestId(requestId);
  if (typeof accessToken !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(accessToken)) {
    throw commerceError("ecommerce-access-token-required", "No se pudo identificar la reserva del carrito.", 400);
  }
  return { orderId, accessHash: createHash("sha256").update(accessToken).digest("hex") };
}

export function verifyCheckoutReservation(reservation, accessHash, requestedItems, now) {
  assertReservationOwner(reservation, accessHash);
  if (reservation?.state !== "active" || !(new Date(reservation.expiresAt) > now)) {
    throw commerceError("ecommerce-reservation-expired", "Venció la reserva. Volvé a reservar el carrito.", 409);
  }
  if (reservation.cartFingerprint !== checkoutCartFingerprint(requestedItems)) {
    throw commerceError("ecommerce-reservation-cart-changed", "El carrito cambió. Reservá la selección actual.", 409);
  }
  return reservation;
}

function assertReservationOwner(reservation, accessHash) {
  if (reservation && (!reservation.accessHash || reservation.accessHash.length !== accessHash?.length ||
      !timingSafeEqual(Buffer.from(reservation.accessHash), Buffer.from(accessHash)))) {
    throw commerceError("ecommerce-order-access-denied", "El acceso a la reserva no es válido.", 403);
  }
}

// Used by both checkout renewal and a recovery after an interrupted order POST.
export async function releaseUnconvertedCheckout(transaction, { orderId, accessHash, now }) {
  const path = checkoutReservationPath(orderId);
  const reservation = (await transaction.getDocument(path))?.data;
  assertReservationOwner(reservation, accessHash);
  if (reservation?.state === "released") return;
  if (reservation?.state === "converted") {
    throw commerceError("ecommerce-order-conflict", "La reserva ya está vinculada a un pedido.", 409);
  }
  if (!reservation) {
    const editPath = checkoutEditPath(orderId);
    const previous = (await transaction.getDocument(editPath))?.data;
    assertReservationOwner(previous, accessHash);
    if (!previous) await transaction.commitDocuments([{ type: "create", path: editPath, data: { accessHash, abandonedAt: now } }]);
    return;
  }
  const operations = [];
  for (const item of reservation.items) {
    for (const origin of item.reservationAllocations) {
      const stockPath = originStockPath(origin, item.productId);
      const stock = (await transaction.getDocument(stockPath))?.data;
      if (stock?.ecommerceReservations?.[orderId]) {
        operations.push({ type: "update", path: stockPath, data: reservationPatch(stock, orderId, null, now) });
      }
    }
  }
  operations.push({ type: "update", path, data: { state: "released", releasedAt: now } });
  await transaction.commitDocuments(operations);
}
