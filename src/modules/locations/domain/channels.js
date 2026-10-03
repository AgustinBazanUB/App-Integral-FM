// Existing manual channels. Administration of this catalog remains a functional pending item.
export const SALES_CHANNELS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "phone", label: "Llamada" },
  { value: "in_person", label: "Contacto personal" },
];

export const saleChannelLabel = (value) => SALES_CHANNELS.find(option => option.value === value)?.label
  || ({ ecommerce: "Ecommerce", manual: "Manual (histórico)" }[value]) || value || "Sin canal informado";
