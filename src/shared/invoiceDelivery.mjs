export function normalizeInvoiceEmail(value) {
  const email = String(value || "").trim();
  // A single mailbox only: no header injection, display names or extra recipients.
  if (email.length > 254 || !/^[a-zA-Z0-9.!#$%&'*+\-/=?^_`{|}~]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(email)) {
    throw Object.assign(new Error("Ingresá un único correo válido del cliente."), {
      code: "arca-email-recipient-invalid", status: 400,
    });
  }
  return email;
}

export function invoiceDeliveryLabel(invoice = {}) {
  const fiscal = invoice.authorization || {};
  const point = String(fiscal.pointOfSale || 0).padStart(5, "0");
  const number = String(fiscal.voucherNumber || 0).padStart(8, "0");
  return `Factura ${fiscal.voucherClass || ""} ${point}-${number}`.replace(/\s+/g, " ").trim();
}
