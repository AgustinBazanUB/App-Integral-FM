const pick = (record, fields) => Object.fromEntries(fields.filter(key => record?.[key] !== undefined).map(key => [key, record[key]]));

// Business data only: preserve what happened without copying provider payloads,
// credentials, fiscal authorizations or the mutable sale document wholesale.
export function saleActivitySnapshot(sale = {}) {
  return {
    ...pick(sale, ["saleCode", "status", "sourceChannel", "sourceType", "locationName", "stockOriginType", "stockOriginName", "warehouseName", "sellerName", "subtotal", "totalBeforeDiscounts", "discountTotal", "cashRoundingDiscountTotal", "total", "totalItems", "paymentMethod", "paymentMethodLabel", "ticketRequested", "ticketStatus", "invoiceStatus", "deliveryMethod", "cancelReason"]),
    items: (sale.items || []).map(item => pick(item, ["productId", "name", "productName", "abbreviation", "qty", "quantity", "unitPrice", "price", "subtotal"])),
    discounts: (sale.discounts || []).map(discount => pick(discount, ["name", "type", "value", "amount", "discountAmount", "source"])),
    payments: (sale.payments || []).map(payment => pick(payment, ["method", "label", "amount"])),
  };
}
