// A hold changes availability, never physical stock. Expiry is checked on read;
// each backend mutation also compacts expired entries (Spark needs no TTL job).
export function activeStockReservations(
  stock = {},
  now = new Date(),
  excludeOrderId = null,
) {
  return Object.fromEntries(
    Object.entries(stock.ecommerceReservations || {}).filter(
      ([key, hold]) =>
        key !== excludeOrderId &&
        Number.isSafeInteger(hold?.quantity) &&
        hold.quantity > 0 &&
        new Date(hold.expiresAt) > now,
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
export function reservationPatch(stock, orderId, hold, now) {
  const ecommerceReservations = activeStockReservations(stock, now, orderId);
  if (hold) ecommerceReservations[orderId] = hold;
  if (Object.keys(ecommerceReservations).length > 100)
    throw Object.assign(
      new Error("Demasiadas reservas pendientes para este producto."),
      { code: "ecommerce-reservation-limit", status: 429 },
    );
  return {
    ecommerceReservations,
    reservedQuantity: Object.values(ecommerceReservations).reduce(
      (sum, entry) => sum + entry.quantity,
      0,
    ),
  };
}
