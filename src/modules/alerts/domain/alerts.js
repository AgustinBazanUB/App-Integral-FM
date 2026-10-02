const closedStatuses = new Set(["resolved", "closed", "completed", "cancelled", "canceled", "dismissed", "deleted"]);
const criticalValues = new Set(["critical", "red", "error", "high", "roja", "critica", "crítica"]);
const warningValues = new Set(["warning", "yellow", "preventive", "medium", "amarilla", "preventiva"]);

/** @typedef {Date | string | number | {toDate: () => Date}} AlertDate */
/** @typedef {{id?: string, active?: boolean, deleted?: boolean, status?: string, severity?: string, priority?: string, color?: string, updatedAt?: AlertDate, createdAt?: AlertDate, locationId?: string, productId?: string, type?: string, entityType?: string}} Alert */

/** @param {Alert} alert */
export function isActiveAlert(alert = {}) {
  return alert.active !== false && alert.deleted !== true && !closedStatuses.has(String(alert.status || "").toLowerCase());
}

/** @param {Alert} alert */
export function alertPresentation(alert = {}) {
  const values = [alert.severity, alert.priority, alert.color, alert.status].map((value) => String(value || "").toLowerCase());
  if (values.some((value) => criticalValues.has(value))) return { rank: 0, tone: "error", label: "Crítica" };
  if (values.some((value) => warningValues.has(value))) return { rank: 1, tone: "warning", label: "Preventiva" };
  return { rank: 2, tone: "info", label: "Aviso" };
}

/** @param {Alert} alert */
const updatedTime = (alert) => {
  const value = alert.updatedAt || alert.createdAt || 0;
  const date = typeof value === "object" && "toDate" in value ? value.toDate() : new Date(value);
  return date.valueOf() || 0;
};

/** @param {Alert[]} alerts */
export function prioritizeAlerts(alerts = []) {
  return alerts.filter(isActiveAlert).slice().sort((a, b) =>
    alertPresentation(a).rank - alertPresentation(b).rank || updatedTime(b) - updatedTime(a) || String(a.id).localeCompare(String(b.id)),
  );
}

// Sólo usamos relaciones conocidas y rutas internas. Sin origen, se abre Alertas.
/** @param {Alert} alert @param {string[]} allowedLocationIds */
export function alertContextPath(alert, allowedLocationIds = [], canViewLocations = false, canViewStock = true) {
  if (canViewLocations && alert.locationId && allowedLocationIds.includes(alert.locationId)) {
    const stockContext = alert.productId || [alert.type, alert.entityType].some((value) => String(value || "").toLowerCase().includes("stock"));
    if (stockContext && !canViewStock) return "/gestion/alerts";
    return `/gestion/locations/${encodeURIComponent(alert.locationId)}${stockContext ? "/stock" : ""}`;
  }
  return "/gestion/alerts";
}
