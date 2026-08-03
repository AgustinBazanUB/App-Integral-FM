export const formatMoney = (value) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);

export function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

export const formatDateTime = (value) => {
  const date = toDate(value);
  return date
    ? new Intl.DateTimeFormat("es-AR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Argentina/Buenos_Aires",
      }).format(date)
    : "Pendiente";
};

export const formatDate = (value) => {
  const date = toDate(value);
  return date
    ? new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeZone: "America/Argentina/Buenos_Aires" }).format(date)
    : "Pendiente";
};

export const humanizeStatus = (status = "pending") =>
  String(status)
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());

export const statusTone = (status = "") => {
  if (["active", "completed", "delivered", "resolved", "received"].includes(status)) {
    return "success";
  }
  if (["cancelled", "error", "failed", "critical", "overdue"].includes(status)) {
    return "error";
  }
  if (["pending", "preparing", "draft", "warning", "medium"].includes(status)) {
    return "warning";
  }
  return "neutral";
};
