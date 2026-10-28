export const SHIPPING_STATES = {
  solicitud_pendiente: "Solicitud pendiente", aprobado: "Por preparar", en_preparacion: "En preparación",
  listo_retirar: "Listo para retirar", retirado_origen: "Retirado del origen", hacia_repositorio: "Hacia repositorio",
  recibido_repositorio: "En repositorio", reparto_final: "En camino a domicilio", entregado: "Entregado",
  devuelto: "Devuelto", cancelado: "Cancelado", no_entregado: "No entregado", rechazado: "Solicitud rechazada",
};
export const TRANSPORTS = { uber: "Uber", repository: "Repositorio", manual: "Manual" };
export const CLOSED_SHIPPING_STATES = ["entregado", "devuelto", "cancelado", "no_entregado", "rechazado"];
export const PREPARATION_PROBLEMS = ["No hay stock suficiente", "No hay bolsas/cajas", "Producto dañado o faltante", "Otro"];
export const COURIER_PROBLEMS = ["Cliente ausente", "Dirección incorrecta", "No encuentra domicilio", "No funciona timbre/portero", "Problema de transporte", "Pedido dañado", "Otro"];
export const shippingError = (message, status = 409) => Object.assign(new Error(message), { code: "shipping/blocked", status, publicMessage: true });
export function cleanShippingDraft(draft = {}, administrative = false) {
  const displayAddress = String(draft.displayAddress || "").trim();
  const notes = String(draft.notes || "").trim();
  if (displayAddress.length < 6 || displayAddress.length > 800 || notes.length > 1500) throw shippingError("Ingresá una dirección completa y observaciones de hasta 1500 caracteres.", 400);
  const assignedPreparerIds = [...new Set(draft.assignedPreparerIds || [])];
  if (administrative && (!TRANSPORTS[draft.deliveryType] || !assignedPreparerIds.length || assignedPreparerIds.length > 12)) throw shippingError("Elegí transporte y entre uno y doce preparadores.", 400);
  return { displayAddress, notes, deliveryType: administrative ? draft.deliveryType : null, assignedPreparerIds: administrative ? assignedPreparerIds : [] };
}
export function shippingBucket(shipment) {
  if (shipment.status === "entregado") return "completed";
  if (CLOSED_SHIPPING_STATES.includes(shipment.status)) return "exceptions";
  return ["retirado_origen", "hacia_repositorio", "recibido_repositorio", "reparto_final"].includes(shipment.status) ? "transit" : "pending";
}
export function courierAction(shipment, leg = "direct") {
  if (shipment.incident || shipment.stockCommitState !== "committed" || CLOSED_SHIPPING_STATES.includes(shipment.status)) return null;
  if (shipment.deliveryType === "repository") {
    if (leg === "origin" && shipment.status === "listo_retirar") return { action: "pickup", label: "Confirmar retiro del local/depósito", next: "hacia_repositorio" };
    if (leg === "origin" && shipment.status === "hacia_repositorio") return { action: "repository_receive", label: "Confirmar llegada al repositorio", next: "recibido_repositorio" };
    if (leg === "final" && shipment.status === "recibido_repositorio") return { action: "repository_depart", label: "Confirmar salida del repositorio", next: "reparto_final" };
    if (leg === "final" && shipment.status === "reparto_final") return { action: "deliver", label: "Confirmar entregado", next: "entregado" };
  } else if (leg === "direct") {
    if (shipment.status === "listo_retirar") return { action: "pickup", label: "Confirmar retiro del local/depósito", next: "reparto_final" };
    if (shipment.status === "reparto_final") return { action: "deliver", label: "Confirmar entregado", next: "entregado" };
  }
  return null;
}
export function validCoordinates(point) {
  return Boolean(point && typeof point.lat === "number" && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90 && typeof point.lng === "number" && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180);
}
export function customerTrackingView(shipment) {
  const hasIncident = Boolean(shipment.incident);
  const labels = {
    solicitud_pendiente: "Solicitud recibida y pendiente de aprobación",
    aprobado: "Pedido recibido",
    en_preparacion: "Estamos preparando tu pedido",
    listo_retirar: "Listo para retirar en Flor Mía",
    hacia_repositorio: "En camino al repositorio",
    recibido_repositorio: "En el repositorio, esperando el siguiente tramo",
    reparto_final: "En camino a tu domicilio",
    entregado: "Tu pedido fue entregado",
  };
  return {
    code: shipment.publicCode,
    status: shipment.status,
    deliveryType: shipment.deliveryType,
    label: hasIncident ? "Flor Mía está revisando una incidencia del envío." : labels[shipment.status] || SHIPPING_STATES[shipment.status] || "En revisión",
    hasIncident,
    updatedAt: shipment.updatedAt,
    illustrationMessage: "La ilustración muestra las etapas confirmadas del envío; no representa una ubicación en tiempo real.",
  };
}
