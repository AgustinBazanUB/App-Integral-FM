import { can } from "../permissions.js";
import { isLocationActiveNow } from "../../modules/locations/domain/locations.js";
import { normalizePayment, PAYMENT_LABELS } from "../../modules/locations/domain/payments.js";

export const sellerProblem = (code, message) => `[${code}] ${message}`;

export function sellerErrorMessage(error) {
  const code = String(error?.code || error?.name || "unknown").replace(/^firestore\//, "");
  const messages = {
    "permission-denied": "Tu usuario no tiene permiso para esta acción, o las reglas de la aplicación la rechazaron. Pedile al administrador que revise tus permisos.",
    unauthenticated: "Tu sesión dejó de ser válida. Volvé a iniciar sesión para continuar.",
    unavailable: "No pudimos conectar con el servidor. Revisá internet y volvé a intentar.",
    "deadline-exceeded": "El servidor tardó demasiado. Revisá Mis ventas antes de volver a cargarla, para no anotarla dos veces.",
    aborted: "Otra operación cambió los datos mientras guardabas. Revisá la venta y volvé a intentar.",
    "resource-exhausted": "El servidor está recibiendo demasiadas operaciones. Esperá un momento y volvé a intentar.",
    "failed-precondition": "La configuración del servidor no permite completar esta acción. Pasanos este código para revisarla.",
    QuotaExceededError: "El almacenamiento de este dispositivo está lleno. No pudimos guardar la venta pendiente.",
    SecurityError: "El navegador bloqueó el almacenamiento local. Habilitalo para guardar ventas pendientes.",
    InvalidStateError: "El almacenamiento local no está disponible. Cerrá las otras pestañas de la aplicación y volvé a intentar.",
  };
  if (messages[code]) return sellerProblem(code, messages[code]);
  // Los errores de validación del negocio ya explican el motivo en castellano.
  if (error?.message && (code === "Error" || code === "sale/validation" || code.startsWith("seller/"))) {
    return sellerProblem(code === "Error" ? "VENTA-VALIDACION" : code, error.message);
  }
  return sellerProblem(code, "No pudimos completar la acción. Conservá este código y contanos qué estabas intentando hacer.");
}

export function sellerProductProblem(product) {
  const name = product?.productName || product?.name || "Este producto";
  if (!product || product.unavailable || product.active === false || product.deleted || product.productDeleted || product.masterActive === false) {
    return sellerProblem("PRODUCTO-NO-DISPONIBLE", `${name} ya no está habilitado en esta ubicación. Quitalo de la venta o pedí que lo habiliten.`);
  }
  if (!Number.isInteger(Number(product.price ?? product.unitPrice)) || Number(product.price ?? product.unitPrice) < 0) {
    return sellerProblem("PRODUCTO-PRECIO", `${name} tiene un precio inválido. Pedí que lo corrijan en Productos.`);
  }
  return "";
}

export function sellerSaleProblem({ profile, location, items, paymentMethod, payments, total, discounts = [], online, editing, stockStatus, stockError, pendingStatus, pendingError, ticketRequested }) {
  if (!can(profile, "quick-sales", editing ? "edit" : "create")) return sellerProblem("VENTA-PERMISO", `Tu usuario no tiene permiso para ${editing ? "editar" : "registrar"} ventas. Pedile al administrador que lo habilite.`);
  if (!location || !isLocationActiveNow(location)) return sellerProblem("VENTA-UBICACION", "Elegí una ubicación activa para registrar la venta.");
  if (stockStatus !== "ready") return stockError ? sellerErrorMessage(stockError) : sellerProblem("VENTA-CARGANDO", "Todavía estamos cargando los productos de esta ubicación. Esperá un momento.");
  if (!online && pendingStatus !== "ready") return pendingError ? sellerErrorMessage(pendingError) : sellerProblem("VENTA-PENDIENTES", "Todavía estamos revisando las ventas pendientes de este dispositivo. Esperá un momento.");
  if (!items.length) return sellerProblem("VENTA-VACIA", "Todavía no agregaste productos. Tocá uno para empezar la venta.");
  for (const item of items) {
    const problem = sellerProductProblem(item);
    if (problem) return problem;
    if (!Number.isInteger(Number(item.qty)) || Number(item.qty) <= 0) return sellerProblem("VENTA-CANTIDAD", `${item.name} tiene una cantidad inválida. Quitalo y volvé a agregarlo.`);
  }
  if (discounts.length && !can(profile, "quick-sales", "useDiscounts")) return sellerProblem("DESCUENTO-PERMISO", "Tu usuario no puede aplicar descuentos. Quitalos o pedí permiso al administrador.");
  if (discounts.some(discount => discount.source === "manual") && !can(profile, "quick-sales", "useManualDiscounts")) return sellerProblem("DESCUENTO-MANUAL-PERMISO", "Tu usuario no puede aplicar descuentos manuales. Quitalos o pedí permiso al administrador.");
  if (paymentMethod === "multiple" && !can(profile, "quick-sales", "useMultiplePayments")) return sellerProblem("PAGO-PERMISO", "Tu usuario no puede combinar pagos. Elegí un solo medio o pedí permiso al administrador.");
  try { normalizePayment(paymentMethod, PAYMENT_LABELS[paymentMethod], payments, total); }
  catch (error) { return sellerProblem(paymentMethod === "multiple" ? "PAGO-DESGLOSE" : "PAGO-FALTANTE", error.message); }
  if (ticketRequested && !can(profile, "quick-sales", "requestTicket")) return sellerProblem("TICKET-PERMISO", "Tu usuario no puede solicitar un ticket. Desmarcá Agregar ticket para continuar.");
  if (!online && editing) return sellerProblem("VENTA-EDICION-OFFLINE", "Necesitás conexión para editar una venta confirmada. El carrito sigue acá.");
  if (!online && !can(profile, "quick-sales", "useOfflineSales")) return sellerProblem("VENTA-OFFLINE-PERMISO", "No hay conexión y tu usuario no puede guardar ventas pendientes. Reconectate para continuar.");
  return "";
}
