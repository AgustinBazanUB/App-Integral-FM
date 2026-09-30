const PUBLIC_ERROR_CATALOG = Object.freeze({
  "arca-cuit-invalid": { category: "VALIDATION_ERROR", status: 400, message: "La CUIT ingresada es inválida." },
  "missing-cuit": { category: "VALIDATION_ERROR", status: 400, message: "Ingresá una CUIT." },
  "fiscal-sale-total-required": { category: "VALIDATION_ERROR", status: 400, message: "Falta el total de la venta para resolver Consumidor Final de forma segura." },
  "consumer-final-identification-required": { category: "VALIDATION_ERROR", status: 422, message: "Por el total de la venta se requiere identificar al receptor antes de continuar." },
  "fiscal-taxpayer-not-found": { category: "VALIDATION_ERROR", status: 404, message: "No se encontró un contribuyente para la CUIT ingresada." },
  "fiscal-taxpayer-inactive": { category: "VALIDATION_ERROR", status: 422, message: "El contribuyente no figura ACTIVO en el padrón consultado." },
  "fiscal-vat-condition-unresolved": { category: "VALIDATION_ERROR", status: 422, message: "No se pudo resolver de forma segura la condición IVA del receptor." },
  "fiscal-receiver-mode-invalid": { category: "VALIDATION_ERROR", status: 400, message: "El tipo de receptor fiscal no es válido." },
  "fiscal-concept-unsupported": { category: "VALIDATION_ERROR", status: 400, message: "El concepto fiscal solicitado no está soportado por este flujo." },
  "fiscal-taxpayer-lookup-unavailable": { category: "CONFIGURATION_ERROR", status: 500, message: "El adaptador de consulta fiscal no está disponible." },
  "arca-production-taxpayer-lookup-disabled": { category: "CONFIGURATION_ERROR", status: 409, message: "La consulta CUIT productiva no está habilitada." },
  "arca-config-missing": { category: "CONFIGURATION_ERROR", status: 409, message: "La configuración fiscal está incompleta." },
  "arca-environment-invalid": { category: "CONFIGURATION_ERROR", status: 409, message: "El entorno ARCA configurado no es válido." },
  "arca-point-of-sale-invalid": { category: "CONFIGURATION_ERROR", status: 409, message: "El punto de venta ARCA configurado no es válido." },
  "firebase-admin-config-missing": { category: "CONFIGURATION_ERROR", status: 409, message: "La configuración server-side de Firebase está incompleta." },
  "firebase-project-mismatch": { category: "CONFIGURATION_ERROR", status: 409, message: "La configuración de Firebase no corresponde al proyecto esperado." },
  "arca-credentials-missing": { category: "CREDENTIAL_ERROR", status: 409, message: "Las credenciales ARCA están incompletas." },
  "arca-certificate-invalid": { category: "CREDENTIAL_ERROR", status: 409, message: "El certificado ARCA configurado no es válido." },
  "arca-private-key-invalid": { category: "CREDENTIAL_ERROR", status: 409, message: "La clave privada ARCA configurada no es válida." },
  "arca-certificate-key-mismatch": { category: "CREDENTIAL_ERROR", status: 409, message: "El certificado y la clave privada ARCA no corresponden entre sí." },
  "arca-certificate-not-currently-valid": { category: "CREDENTIAL_ERROR", status: 409, message: "El certificado ARCA está fuera de vigencia." },
  "unauthenticated": { category: "PERMISSION_ERROR", status: 401, message: "Iniciá sesión para continuar." },
  "permission-denied": { category: "PERMISSION_ERROR", status: 403, message: "No tenés permisos para realizar esta operación." },
  "profile-unavailable": { category: "PERMISSION_ERROR", status: 403, message: "No hay un perfil activo habilitado para esta operación." },
  "firebase-admin-token-error": { category: "PERMISSION_ERROR", status: 503, message: "El backend no pudo autenticarse con Firebase Admin." },
  "firebase-admin-read-error": { category: "PERMISSION_ERROR", status: 503, message: "El backend no pudo acceder a los datos requeridos." },
  "arca-network-error": { category: "TEMPORARY_UPSTREAM_ERROR", status: 503, message: "ARCA no está disponible temporalmente. Reintentá más tarde." },
  "arca-soap-http-error": { category: "TEMPORARY_UPSTREAM_ERROR", status: 503, message: "ARCA no pudo completar la consulta en este momento." },
  "arca-production-invoice-prepare-disabled": { category: "CONFIGURATION_ERROR", status: 409, message: "La preparación productiva de facturas no está habilitada." },
  "arca-production-authorization-blocked": { category: "CONFIGURATION_ERROR", status: 409, message: "La emisión productiva de CAE no está habilitada." },
  "arca-production-auto-disabled": { category: "CONFIGURATION_ERROR", status: 409, message: "La autorización automática productiva no está habilitada." },
  "arca-production-auto-source-blocked": { category: "PERMISSION_ERROR", status: 409, message: "El origen de la venta no está habilitado para autorización automática." },
  "arca-production-cae-scope-missing": { category: "CONFIGURATION_ERROR", status: 409, message: "La autorización manual productiva requiere una venta objetivo explícita." },
  "arca-production-cae-target-mismatch": { category: "VALIDATION_ERROR", status: 409, message: "La venta no coincide con el alcance productivo autorizado." },
  "arca-issuer-vat-condition-missing": { category: "CONFIGURATION_ERROR", status: 409, message: "Falta configurar la condición IVA del emisor." },
  "arca-consumer-final-threshold-invalid": { category: "CONFIGURATION_ERROR", status: 409, message: "El umbral de identificación de Consumidor Final no es válido." },
  "arca-default-vat-rate-invalid": { category: "CONFIGURATION_ERROR", status: 409, message: "La alícuota IVA por defecto no es válida." },
  "arca-sale-not-found": { category: "VALIDATION_ERROR", status: 404, message: "La venta asociada no existe." },
  "arca-sale-not-active": { category: "VALIDATION_ERROR", status: 409, message: "La venta asociada no está activa." },
  "arca-invoice-not-found": { category: "VALIDATION_ERROR", status: 404, message: "La solicitud fiscal no existe." },
  "arca-invoice-not-requested": { category: "VALIDATION_ERROR", status: 409, message: "La venta no tiene una solicitud fiscal activa." },
  "arca-invoice-environment-mismatch": { category: "VALIDATION_ERROR", status: 409, message: "La solicitud fiscal pertenece a otro entorno ARCA." },
  "arca-fiscal-readiness-incomplete": { category: "VALIDATION_ERROR", status: 409, message: "La solicitud fiscal tiene datos fiscales incompletos." },
  "arca-pdf-invoice-not-authorized": { category: "VALIDATION_ERROR", status: 409, message: "La factura todavía no está autorizada." },
  "arca-pdf-invoice-not-verified": { category: "VALIDATION_ERROR", status: 409, message: "La factura debe verificarse contra ARCA antes de generar el PDF." },
  "arca-pdf-issuer-data-missing": { category: "CONFIGURATION_ERROR", status: 409, message: "Faltan datos visibles del emisor para generar el PDF fiscal." },
  "arca-document-source-missing": { category: "VALIDATION_ERROR", status: 400, message: "Falta identificar la factura o la venta de origen." },
  "missing-invoice-id": { category: "VALIDATION_ERROR", status: 400, message: "Falta identificar la solicitud fiscal." },
  "missing-source": { category: "VALIDATION_ERROR", status: 400, message: "Falta identificar el origen de la venta." },
  "invalid-mode": { category: "VALIDATION_ERROR", status: 400, message: "La operación fiscal solicitada no es válida." },
});

function safeCode(value) {
  const code = String(value || "").trim();
  return /^[A-Za-z0-9._-]{1,120}$/.test(code) ? code : "arca-request-error";
}
function fallbackCategory(status) {
  if (status === 401 || status === 403) return "PERMISSION_ERROR";
  if (status >= 500) return "TEMPORARY_UPSTREAM_ERROR";
  if (status >= 400) return "VALIDATION_ERROR";
  return "TEMPORARY_UPSTREAM_ERROR";
}
function fallbackMessage(category) {
  if (category === "PERMISSION_ERROR") return "No tenés permisos para realizar esta operación.";
  if (category === "VALIDATION_ERROR") return "Los datos enviados no pudieron validarse.";
  if (category === "CONFIGURATION_ERROR") return "La configuración fiscal está incompleta.";
  if (category === "CREDENTIAL_ERROR") return "Las credenciales fiscales requieren revisión.";
  return "No se pudo completar la consulta fiscal en este momento.";
}
export function toPublicArcaError(error = {}) {
  const code = safeCode(error?.code);
  const known = PUBLIC_ERROR_CATALOG[code] || null;
  const rawStatus = Number(error?.status || 0);
  const inferredStatus = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599
    ? rawStatus
    : known?.status || 500;
  const category = known?.category || fallbackCategory(inferredStatus);
  return {
    code,
    category,
    status: known?.status || inferredStatus,
    message: known?.message || fallbackMessage(category),
  };
}
