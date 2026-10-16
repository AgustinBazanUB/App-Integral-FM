export const SHIPPING_STATES = {
  solicitud_pendiente: "Solicitud pendiente", aprobado: "Por preparar", en_preparacion: "En preparación",
  listo_retirar: "Listo para retirar", retirado_origen: "Retirado del origen", hacia_repositorio: "Hacia repositorio",
  recibido_repositorio: "Recibido en repositorio", reparto_final: "En reparto", entregado: "Entregado",
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
export function validatePoint(point, now = new Date(), maxAgeMs = 120000) {
  const age = now.valueOf() - new Date(point?.observedAt).valueOf();
  return Boolean(point && typeof point.lat === "number" && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90 && typeof point.lng === "number" && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180 && typeof point.accuracy === "number" && Number.isFinite(point.accuracy) && point.accuracy > 0 && point.accuracy <= 10000 && Number.isFinite(age) && age >= -10000 && age <= maxAgeMs);
}
export function distanceMeters(a, b) {
  const rad = x => x * Math.PI / 180;
  const dlat = rad(b.lat - a.lat), dlng = rad(b.lng - a.lng);
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dlng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function deliveryProof(shipment, grant, now, config = {}) {
  const exception = shipment.deliveryException;
  if (exception && exception.approvedBy !== grant.actorId && exception.grantHash === grant.hash && exception.destinationRevision === (shipment.destinationRevision || 0) && new Date(exception.expiresAt) > now) return { method: "supervised_exception", ...exception };
  if (!config.radiusMeters || !config.maxAccuracyMeters || !config.maxAgeMs) throw shippingError("La geocerca no está configurada. Solicitá una excepción supervisada.");
  const point = shipment.lastPosition;
  if (!shipment.destination?.verified || !validatePoint({ ...shipment.destination, accuracy: 1, observedAt: now.toISOString() }, now) || !validatePoint(point, now, config.maxAgeMs) || point.accuracy > config.maxAccuracyMeters || point.grantHash !== grant.hash) throw shippingError("Falta un destino verificado o una ubicación reciente y precisa. Solicitá una excepción supervisada.");
  const distance = distanceMeters(point, shipment.destination);
  if (distance > config.radiusMeters + Math.min(point.accuracy, config.maxAccuracyMeters)) throw shippingError("Estás fuera del área de entrega. Solicitá una excepción supervisada.");
  return { method: "geofence", distanceMeters: Math.round(distance), accuracy: point.accuracy, observedAt: point.observedAt };
}
export function customerTrackingView(shipment, now = new Date(), maxAgeMs = 120000) {
  const final = shipment.status === "reparto_final";
  if (shipment.deliveryType === "repository" && ["aprobado", "en_preparacion", "listo_retirar", "hacia_repositorio", "recibido_repositorio"].includes(shipment.status)) return { code: shipment.publicCode, status: "preparing", label: "Preparando tu pedido", updatedAt: shipment.updatedAt, position: null, locationMessage: "El seguimiento se activa cuando comienza el reparto final." };
  return { code: shipment.publicCode, status: shipment.status, label: SHIPPING_STATES[shipment.status] || "En revisión", updatedAt: shipment.updatedAt, position: final && validatePoint(shipment.lastPosition, now, maxAgeMs) ? { lat: shipment.lastPosition.lat, lng: shipment.lastPosition.lng, accuracy: shipment.lastPosition.accuracy, observedAt: shipment.lastPosition.observedAt } : null, locationMessage: final ? "La ubicación se comparte mientras el repartidor mantiene esta página abierta y autoriza GPS." : "El seguimiento del recorrido está disponible únicamente durante el reparto final." };
}
