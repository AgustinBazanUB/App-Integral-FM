// Existing manual channels. Administration of this catalog remains a functional pending item.
export const SALES_CHANNELS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "phone", label: "Llamada" },
  { value: "in_person", label: "Contacto personal" },
];

export const saleChannelLabel = (value) => SALES_CHANNELS.find(option => option.value === value)?.label
  || ({ ecommerce: "Página web / E-commerce", manual: "Manual (histórico)" }[value]) || value || "Sin canal informado";

export function saleChannelId(sale = {}) {
  if ([sale.sourceChannel, sale.channelId, sale.sourceType].includes("ecommerce")) return "ecommerce";
  return sale.sourceChannel || "__unknown";
}

export function metricsChannelOptions(sales = []) {
  const ids = new Set(["ecommerce", ...SALES_CHANNELS.map(option => option.value), ...sales.map(saleChannelId)]);
  return [...ids].map(id => ({ id, name: saleChannelLabel(id === "__unknown" ? "" : id) }));
}
