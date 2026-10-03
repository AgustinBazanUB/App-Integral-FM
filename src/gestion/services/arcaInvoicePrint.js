export function isArcaInvoicePrintable(invoice) {
  return invoice?.status === "authorized"
    && invoice?.verification?.matched === true
    && invoice?.pdf?.ready === true;
}

export function arcaInvoicePrintStatus(invoice) {
  if (!invoice) {
    return "No encontramos una solicitud de factura asociada a esta venta.";
  }
  if (invoice.status !== "authorized") {
    return "La factura está pendiente de autorización. Vas a poder imprimirla cuando esté autorizada y verificada.";
  }
  if (invoice.verification?.matched !== true) {
    return "La factura todavía no tiene una verificación fiscal coincidente; la impresión permanece bloqueada.";
  }
  if (invoice.pdf?.issuerDataReady === false || invoice.pdf?.ready !== true) {
    return "La factura está verificada, pero faltan datos del emisor para preparar el PDF.";
  }
  return "La factura está autorizada y verificada. Podés abrir el PDF para imprimirla.";
}
