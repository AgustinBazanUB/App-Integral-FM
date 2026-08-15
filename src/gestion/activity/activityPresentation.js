
const definitions = {
  "sale.created": { label: "Venta registrada", icon: "ReceiptText", tone: "gold", group: "Ventas" },
  "sale.updated": { label: "Venta editada", icon: "FileText", tone: "gold", group: "Ventas" },
  "sale.cancelled": { label: "Venta anulada", icon: "RotateCcw", tone: "error", group: "Ventas" },
  "stock.initial": { label: "Stock inicial", icon: "Boxes", tone: "olive", group: "Stock" },
  "stock.initial_adjustment": { label: "Stock inicial ajustado", icon: "SlidersHorizontal", tone: "olive", group: "Stock" },
  "stock.add": { label: "Mercadería agregada", icon: "PackagePlus", tone: "olive", group: "Stock" },
  "stock.adjust": { label: "Inventario ajustado", icon: "SlidersHorizontal", tone: "olive", group: "Stock" },
  "stock.adjustment": { label: "Inventario ajustado", icon: "SlidersHorizontal", tone: "olive", group: "Stock" },
  "stock.stock_delete": { label: "Stock desactivado", icon: "AlertTriangle", tone: "error", group: "Stock" },
  "stock.updated": { label: "Stock actualizado", icon: "Boxes", tone: "olive", group: "Stock" },
  "location.created": { label: "Ubicación creada", icon: "MapPinned", tone: "info", group: "Ubicaciones" },
  "location.updated": { label: "Ubicación editada", icon: "Settings2", tone: "info", group: "Ubicaciones" },
  "location.paused": { label: "Ubicación pausada", icon: "Pause", tone: "warning", group: "Ubicaciones" },
  "location.activated": { label: "Ubicación activada", icon: "MapPin", tone: "olive", group: "Ubicaciones" },
  "location.deleted": { label: "Ubicación dada de baja", icon: "X", tone: "error", group: "Ubicaciones" },
  "location.restored": { label: "Ubicación restaurada", icon: "RotateCcw", tone: "olive", group: "Ubicaciones" },
  "location.sellersUpdated": { label: "Vendedores actualizados", icon: "UserPlus", tone: "info", group: "Ubicaciones" },
  "location.discountsUpdated": { label: "Descuentos actualizados", icon: "Percent", tone: "gold", group: "Descuentos" },
  "locationProduct.configured": { label: "Producto configurado", icon: "PackageCheck", tone: "olive", group: "Productos" },
  "product.createdFromLocation": { label: "Producto creado desde ubicación", icon: "PackagePlus", tone: "olive", group: "Productos" },
  "product.updatedFromLocation": { label: "Producto maestro actualizado", icon: "PackageCheck", tone: "olive", group: "Productos" },
  "customer.created": { label: "Cliente creado", icon: "UserPlus", tone: "info", group: "Clientes" },
  "customer.updated": { label: "Cliente actualizado", icon: "UserRoundCheck", tone: "info", group: "Clientes" },
};

export const ACTIVITY_DEFINITIONS = Object.freeze(definitions);

const prefixFallbacks = [
  ["sale.", { icon: "ReceiptText", tone: "gold", group: "Ventas" }],
  ["stock.", { icon: "Boxes", tone: "olive", group: "Stock" }],
  ["location.", { icon: "MapPin", tone: "info", group: "Ubicaciones" }],
  ["locationProduct.", { icon: "PackageCheck", tone: "olive", group: "Productos" }],
  ["product.", { icon: "PackageCheck", tone: "olive", group: "Productos" }],
  ["customer.", { icon: "UserRound", tone: "info", group: "Clientes" }],
  ["discount.", { icon: "Percent", tone: "gold", group: "Descuentos" }],
];

function readableUnknown(action) {
  return String(action || "Actividad")
    .replace(/[._-]+/g, " ")
    .replace(/^./, (character) => character.toLocaleUpperCase("es-AR"));
}

export function getActivityPresentation(activityOrAction) {
  const activity = typeof activityOrAction === "string" ? { action: activityOrAction } : (activityOrAction || {});
  const action = activity.action || "system.updated";
  const exact = definitions[action];
  if (exact) return { action, ...exact };
  const fallback = prefixFallbacks.find(([prefix]) => action.startsWith(prefix))?.[1];
  return {
    action,
    label: activity.title || readableUnknown(action),
    icon: fallback?.icon || "Activity",
    tone: activity.status === "cancelled" ? "error" : (fallback?.tone || "neutral"),
    group: fallback?.group || "Otros",
  };
}

export function getActivityTypeGroups(items = []) {
  const map = new Map(Object.entries(definitions));
  for (const item of items || []) {
    if (!item?.action || map.has(item.action)) continue;
    const presentation = getActivityPresentation(item);
    map.set(item.action, presentation);
  }
  const grouped = new Map();
  for (const [action, definition] of map) {
    const group = definition.group || "Otros";
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push({ value: action, label: definition.label || readableUnknown(action) });
  }
  return [...grouped.entries()]
    .map(([label, options]) => ({
      label,
      options: options.sort((a, b) => a.label.localeCompare(b.label, "es")),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
}
