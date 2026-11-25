function expirationMillis(expiresAt) {
  return typeof expiresAt?.toMillis === "function"
    ? expiresAt.toMillis()
    : new Date(expiresAt).valueOf();
}

// A hold changes availability. Each backend mutation also compacts expired entries.
export function activeStockReservations(
  stock = {},
  now = new Date(),
  excludeOrderId = null,
) {
  return Object.fromEntries(
    Object.entries(stock?.ecommerceReservations || {}).filter(
      ([key, hold]) =>
        key !== excludeOrderId &&
        Number.isSafeInteger(hold?.quantity) &&
        hold.quantity > 0 &&
        expirationMillis(hold.expiresAt) > now,
    ),
  );
}
export function reservedStockQuantity(
  stock = {},
  now = new Date(),
  excludeOrderId = null,
) {
  return Object.values(
    activeStockReservations(stock, now, excludeOrderId),
  ).reduce((sum, hold) => sum + hold.quantity, 0);
}
export function availableStockAfterReservations(stock = {}, now = new Date(), excludeOrderId = null) {
  const quantity = Number(stock?.currentStock ?? 0);
  return Number.isSafeInteger(quantity)
    ? Math.max(0, quantity - reservedStockQuantity(stock, now, excludeOrderId))
    : 0;
}

export function reservationPatch(stock, orderId, hold, now) {
  const ecommerceReservations = activeStockReservations(stock, now, orderId);
  if (hold) ecommerceReservations[orderId] = hold;
  if (Object.keys(ecommerceReservations).length > 100)
    throw Object.assign(
      new Error("Demasiadas reservas pendientes para este producto."),
      { code: "ecommerce-reservation-limit", status: 429 },
    );
  const entries = Object.values(ecommerceReservations);
  const latestExpiry = Math.max(0, ...entries.map((entry) => expirationMillis(entry.expiresAt)));
  return {
    ecommerceReservations,
    reservedQuantity: entries.reduce((sum, entry) => sum + entry.quantity, 0),
    ecommerceReservationsExpireAt: latestExpiry ? new Date(latestExpiry) : null,
  };
}
