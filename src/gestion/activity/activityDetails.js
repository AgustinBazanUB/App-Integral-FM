import { formatMoney } from "../formatters.js";

const labels = {
  name: "Nombre", title: "Título", productName: "Producto", abbreviation: "Abreviatura", categoryName: "Categoría", description: "Descripción", notes: "Notas", note: "Observaciones", reason: "Motivo", cancelReason: "Motivo de anulación", status: "Estado", active: "Activo", deleted: "Dado de baja",
  saleCode: "Número de venta", sourceChannel: "Canal", sourceType: "Origen de la operación", locationName: "Ubicación", warehouseName: "Depósito", stockOriginName: "Origen del stock", originName: "Desde", destinationName: "Hasta", carrierName: "Transportista", deliveryMethod: "Entrega", sellerName: "Vendedor",
  amount: "Importe", total: "Total", subtotal: "Subtotal", totalBeforeDiscounts: "Total antes de descuentos", discountTotal: "Descuentos", cashRoundingDiscountTotal: "Redondeo por efectivo", defaultPrice: "Precio general", price: "Precio", priceOverride: "Precio especial", unitPrice: "Precio unitario", useDefaultPrice: "Usa precio general",
  qty: "Cantidad", quantity: "Cantidad", requestedQty: "Cantidad solicitada", previousStock: "Stock anterior", newStock: "Stock resultante", currentStock: "Stock actual", initialStock: "Stock inicial", originStock: "Stock en origen", destinationStock: "Stock en destino", preparedQuantity: "Cantidad preparada", receivedQuantity: "Cantidad recibida", missingQuantity: "Cantidad faltante", lostQuantity: "Cantidad perdida", itemCount: "Productos", totalItems: "Unidades", totalUnits: "Unidades ingresadas", createdProducts: "Productos creados", createdCategories: "Categorías creadas", yellowAlertQty: "Alerta amarilla", redAlertQty: "Alerta roja",
  paymentMethod: "Forma de pago", paymentMethodLabel: "Forma de pago", customerNameSnapshot: "Cliente", customerPhoneSnapshot: "Teléfono del cliente", customerZoneSnapshot: "Zona del cliente", phone: "Teléfono", zoneName: "Zona", customZone: "Zona", ticketRequested: "Ticket solicitado", ticketStatus: "Estado del ticket", invoiceStatus: "Estado de factura", codePrefix: "Prefijo de ventas", type: "Tipo", priceMode: "Tipo de precio", mode: "Tipo de carga", changedFields: "Campos modificados", enabledDiscountIds: "Descuentos habilitados", assignedSellerIds: "Vendedores asignados", destinationUseDefaultPrice: "Usa precio general", origin: "Origen", audience: "Destinatarios", result: "Resultado", operationType: "Operación", operatingCalendar: "Calendario de atención", previousCalendar: "Calendario anterior", scheduleStartAt: "Inicio programado", scheduleEndAt: "Fin programado",
};
const moneyFields = new Set(["amount", "total", "subtotal", "totalBeforeDiscounts", "discountTotal", "cashRoundingDiscountTotal", "defaultPrice", "price", "priceOverride", "unitPrice"]);
const values = { completed: "Completada", active: "Activa", cancelled: "Anulada", archived: "Archivada", pending: "Pendiente", new: "Nueva", error: "Error", failed: "Falló", not_requested: "No solicitado", cash: "Efectivo", credit: "Crédito", debit: "Débito", alias: "Transferencia / alias", multiple: "Pagos combinados", in_person: "Contacto personal", whatsapp: "WhatsApp", instagram: "Instagram", phone: "Llamada", pickup: "Retiro", delivery: "Envío", admin_quick_sale: "Venta rápida administrativa", ecommerce: "Tienda online", default: "General", custom: "Especial", add: "Ingreso de mercadería", initial: "Stock inicial", adjust: "Ajuste de inventario", location: "Ubicación", warehouse: "Depósito" };
export const activityValueLabel = value => values[value] || String(value ?? "—");
export function activityFieldValue(key, value) {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (moneyFields.has(key) && Number.isFinite(Number(value))) return formatMoney(Number(value));
  if (value?.toDate) return value.toDate().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
  if (Array.isArray(value)) return value.map(item => key === "weekdays" ? ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"][Number(item) - 1] || "Día" : typeof item === "object" ? "Registro" : labels[item] || activityValueLabel(item)).join(" · ") || "Ninguno";
  if (typeof value === "object") {
    // Calendars and recorded business changes are readable without rendering
    // arbitrary nested objects (which may contain configuration secrets).
    const calendarLabels = { weekdays: "Días", dates: "Fechas", closedDates: "Cierres", startDate: "Desde", endDate: "Hasta", open: "Abierto", start: "Desde", end: "Hasta", openingTime: "Apertura", closingTime: "Cierre", overnight: "Continúa al día siguiente" };
    return Object.entries(value).filter(([field]) => Object.hasOwn(calendarLabels, field)).map(([field, v]) => `${calendarLabels[field]}: ${activityFieldValue(field, v)}`).join(" · ") || "Registrado";
  }
  return activityValueLabel(value);
}
export function activityFieldRows(record = {}) {
  if (!record || typeof record !== "object") return [];
  return Object.entries(labels).filter(([key]) => Object.hasOwn(record, key) && record[key] !== undefined && !(key === "paymentMethod" && record.paymentMethodLabel)).map(([key, label]) => ({ key, label, value: activityFieldValue(key, record[key]) }));
}
export function activityChangeRows(before, after, itemNames = {}) {
  // Olivia's batch result keeps immutable stock rows under lines/stocks.
  if (Array.isArray(before) && (Array.isArray(after?.lines) || Array.isArray(after?.stocks))) after = (after.lines || after.stocks).map(row => ({ productId: row.productId, currentStock: row.newStock ?? row.currentStock }));
  const namedRows = record => Array.isArray(record) ? record.flatMap((item, index) => activityFieldRows(item).map(row => ({ ...row, key: `${item.productId || index}:${row.key}`, label: `${item.productName || item.name || itemNames[item.productId] || `Producto ${index + 1}`} · ${row.label}` }))) : [...activityFieldRows(record || {}), ...(Array.isArray(record?.items) ? namedRows(record.items) : [])];
  const left = new Map(namedRows(before).map(row => [row.key, row])), right = new Map(namedRows(after).map(row => [row.key, row]));
  const completeItems = Array.isArray(before) && Array.isArray(after) || Array.isArray(before?.items) && Array.isArray(after?.items);
  return [...new Set([...left.keys(), ...right.keys()])].filter(key => (right.has(key) || completeItems && (Array.isArray(before) || key.includes(":"))) && left.get(key)?.value !== right.get(key)?.value).map(key => ({ key, label: right.get(key)?.label || left.get(key)?.label, before: left.get(key)?.value || "—", after: right.get(key)?.value || "—" }));
}
export function activityStockMovements(record, movements = []) {
  if (movements.length) return movements;
  return Array.isArray(record?.lines) ? record.lines.map(row => ({ id: row.productId, productName: row.name || row.productName || "Producto", qty: row.quantity, previousStock: row.previousStock, newStock: row.newStock })) : [];
}
export function activityUserOptions(directory = [], activities = [], profile = {}) {
  const map = new Map();
  for (const activity of activities) if (activity.userId) map.set(activity.userId, { id: activity.userId, name: activity.userName || "Usuario" });
  if (profile.id) map.set(profile.id, { ...profile });
  for (const user of directory) if (user.id) map.set(user.id, user);
  const counts = new Map();
  for (const user of map.values()) { const name = String(user.name || user.email || "Usuario").trim(); counts.set(name.toLocaleLowerCase("es"), (counts.get(name.toLocaleLowerCase("es")) || 0) + 1); }
  return [...map.values()].map(user => {
    const name = String(user.name || user.email || "Usuario").trim(), duplicate = counts.get(name.toLocaleLowerCase("es")) > 1;
    return { ...user, label: `${name}${duplicate ? ` · ${user.email || user.id}` : ""}${user.deleted ? " · dado de baja" : user.active === false ? " · inactivo" : ""}` };
  }).sort((a, b) => a.label.localeCompare(b.label, "es"));
}
