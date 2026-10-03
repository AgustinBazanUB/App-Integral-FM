export const MAX_FISCAL_ATTEMPTS = 3;
const temporaryCodes = new Set(["arca-network-error", "arca-timeout", "arca-sequence-busy", "arca-last-authorized-error", "arca-pre-cae-recovered"]);

// Only failures before transport can be retried. An unknown outcome after a
// reserved number must be consulted, even when the error looks temporary.
export function classifyFiscalFailure(error = {}, { submitted = false } = {}) {
  if (submitted) return "UNCERTAIN";
  return temporaryCodes.has(error.code) || Number(error.status) >= 500 ? "TEMPORARY" : "VALIDATION";
}

export function fiscalRecovery({ classification, code, attemptCount = 0, now = new Date() }) {
  const retryable = classification === "TEMPORARY" && attemptCount < MAX_FISCAL_ATTEMPTS;
  const messages = {
    VALIDATION: "Los datos o la configuración fiscal requieren corrección. No se reintentará automáticamente.",
    REJECTED: "ARCA rechazó el comprobante. Revisá los datos antes de una nueva operación fiscal.",
    TEMPORARY: retryable ? "El servicio fiscal no estuvo disponible antes del envío. La venta y el pago permanecen registrados." : "Se alcanzó el límite de intentos fiscales. Requiere revisión administrativa.",
    UNCERTAIN: "El resultado fiscal es incierto. Primero se consultará el comprobante; no se reenviará la solicitud de CAE.",
    AUTHORIZED: "Factura autorizada. La autorización es definitiva y no se volverá a emitir.",
  };
  return {
    classification, attemptCount, retryable,
    nextRetryAt: retryable ? new Date(new Date(now).getTime() + (attemptCount <= 1 ? 60000 : 300000)).toISOString() : null,
    lastError: classification === "AUTHORIZED" ? null : { code: safeFiscalCode(code), message: messages[classification], at: new Date(now).toISOString() },
  };
}

export function safeFiscalCode(code) {
  return /^(?:arca|firebase|ecommerce|auth)-[a-z0-9-]{1,100}$/.test(String(code || "")) ? code : "arca-operation-failed";
}

export function safeFiscalError(error = {}) {
  const classification = classifyFiscalFailure(error);
  return { code: safeFiscalCode(error.code), message: fiscalRecovery({ classification, code: error.code }).lastError.message };
}

export function fiscalPresentation(invoice = {}) {
  const recovery = invoice.recovery || {};
  const labels = { VALIDATION: "Datos fiscales inválidos", REJECTED: "Factura rechazada", TEMPORARY: "Error temporal", UNCERTAIN: "Resultado incierto: consultar ARCA", AUTHORIZED: "Factura autorizada" };
  const classification = invoice.status === "authorized" ? "AUTHORIZED" : invoice.status === "rejected" ? "REJECTED" : ["reconciling", "authorizing"].includes(invoice.status) && invoice.authorization?.voucherNumber ? "UNCERTAIN" : recovery.classification;
  return {
    label: labels[classification] || (invoice.status === "authorizing" ? "Autorización en curso" : invoice.status === "error" ? "Requiere revisión fiscal" : "Factura pendiente"),
    message: recovery.lastError?.message || "",
    classification: classification || null,
    retryable: recovery.retryable === true && classification === "TEMPORARY",
    nextRetryAt: recovery.nextRetryAt || null,
    needsReconciliation: classification === "UNCERTAIN",
  };
}
