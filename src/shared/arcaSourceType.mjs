export function arcaSourceTypeForSale(sale = {}) {
  if (["admin_quick_sale", "seller_sale", "ecommerce"].includes(sale.sourceType)) return sale.sourceType;
  if (sale.fiscalInvoice?.sourceType) return sale.fiscalInvoice.sourceType;
  if (sale.ticketRequested === true || "ticketStatus" in sale) return "seller_sale";
  return "admin_quick_sale";
}
