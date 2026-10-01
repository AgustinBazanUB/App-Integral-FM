const CATALOG = Object.freeze({
  "ecommerce-location-not-configured": { status: 409, message: "La ubicación de stock Ecommerce está PENDIENTE DE DEFINIR." },
  "ecommerce-location-unavailable": { status: 409, message: "La ubicación Ecommerce no está disponible." },
  "ecommerce-request-id-invalid": { status: 400, message: "No se pudo identificar de forma segura el intento de compra." },
  "ecommerce-cart-empty": { status: 400, message: "El carrito está vacío." },
  "ecommerce-product-id-invalid": { status: 400, message: "Uno de los productos no es válido." },
  "ecommerce-product-not-found": { status: 409, message: "Uno de los productos ya no existe." },
  "ecommerce-product-inactive": { status: 409, message: "Uno de los productos está inactivo." },
  "ecommerce-product-deleted": { status: 409, message: "Uno de los productos fue eliminado." },
  "ecommerce-stock-not-configured": { status: 409, message: "Uno de los productos no tiene stock Ecommerce configurado." },
  "ecommerce-stock-inactive": { status: 409, message: "Uno de los productos no está habilitado para Ecommerce." },
  "ecommerce-stock-product-mismatch": { status: 409, message: "La configuración de stock no coincide con el producto." },
  "ecommerce-stock-invalid": { status: 409, message: "El stock comercial tiene un valor inválido." },
  "ecommerce-stock-insufficient": { status: 409, message: "No hay stock suficiente para completar la operación." },
  "ecommerce-price-not-configured": { status: 409, message: "Uno de los productos no tiene un precio comercial válido." },
  "ecommerce-vat-not-configured": { status: 409, message: "Uno de los productos todavía no tiene IVA configurado." },
  "ecommerce-quantity-invalid": { status: 400, message: "Las cantidades deben ser enteras y mayores a cero." },
  "ecommerce-quantity-excessive": { status: 400, message: "La cantidad solicitada supera el máximo permitido por línea." },
  "ecommerce-customer-name-required": { status: 400, message: "Ingresá tu nombre y apellido." },
  "ecommerce-customer-email-invalid": { status: 400, message: "Ingresá un email válido." },
  "ecommerce-customer-phone-invalid": { status: 400, message: "Ingresá un teléfono válido." },
  "ecommerce-pickup-not-configured": { status: 409, message: "El retiro todavía no está habilitado comercialmente." },
  "ecommerce-delivery-not-configured": { status: 409, message: "El costo y las reglas de envío están PENDIENTE DE DEFINIR." },
  "ecommerce-shipping-method-invalid": { status: 400, message: "La forma de entrega no es válida." },
  "ecommerce-simulated-payment-disabled": { status: 409, message: "La simulación de pago no está habilitada." },
  "ecommerce-payment-mode-invalid": { status: 400, message: "El modo de pago solicitado no es válido." },
  "ecommerce-order-conflict": { status: 409, message: "El pedido cambió durante la operación. Volvé a intentarlo." },
  "firebase-admin-config-missing": { status: 503, message: "El backend comercial no está configurado todavía." },
  "firebase-admin-token-error": { status: 503, message: "El backend comercial no pudo autenticarse." },
  "firebase-admin-read-error": { status: 503, message: "No se pudo consultar el catálogo comercial." },
  "firebase-admin-commit-error": { status: 503, message: "No se pudo guardar la operación comercial." },
  "firebase-admin-precondition-failed": { status: 409, message: "El stock cambió durante la operación. Volvé a intentarlo." },
});

export function publicEcommerceError(error) {
  const code = String(error?.code || "").match(/^[A-Za-z0-9._-]{1,120}$/)?.[0] || "ecommerce-error";
  const known = CATALOG[code];
  if (known) return { code, status: known.status, message: known.message };
  const status = Number(error?.status);
  return {
    code,
    status: Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500,
    message: "No se pudo completar la operación Ecommerce.",
  };
}
