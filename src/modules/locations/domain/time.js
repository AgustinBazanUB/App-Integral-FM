export const ARGENTINA_TIME_ZONE = "America/Argentina/Buenos_Aires";

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ARGENTINA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const pad = (value) => String(value).padStart(2, "0");

export function argentinaParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return { year: parts.year, month: parts.month, day: parts.day };
}

export function argentinaDateKey(value = new Date()) {
  const { year, month, day } = argentinaParts(value);
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function argentinaMonthKey(value = new Date()) {
  const { year, month } = argentinaParts(value);
  return `${year}-${pad(month)}`;
}

export function argentinaStartOfDay(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, 3, 0, 0, 0));
}

export function argentinaDateFromKey(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) throw new Error("Seleccioná una fecha válida.");
  const date = argentinaStartOfDay(year, month, day);
  const parts = argentinaParts(date);
  if (parts.year !== year || parts.month !== month || parts.day !== day) {
    throw new Error("Seleccioná una fecha válida.");
  }
  return date;
}

export function addArgentinaDays(value, amount) {
  const { year, month, day } = argentinaParts(value);
  return argentinaStartOfDay(year, month, day + Number(amount || 0));
}

export function argentinaMonthRange(monthKey) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Seleccioná un mes válido.");
  }
  return {
    start: argentinaStartOfDay(year, month, 1),
    end: argentinaStartOfDay(year, month + 1, 1),
    year,
    month,
  };
}

export function shiftMonthKey(monthKey, amount) {
  const { year, month } = argentinaMonthRange(monthKey);
  const shifted = new Date(Date.UTC(year, month - 1 + Number(amount || 0), 15, 12));
  return argentinaMonthKey(shifted);
}

export function argentinaMonthLabel(monthKey) {
  const { start } = argentinaMonthRange(monthKey);
  const label = new Intl.DateTimeFormat("es-AR", {
    timeZone: ARGENTINA_TIME_ZONE,
    month: "long",
    year: "numeric",
  }).format(start);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function lastSevenArgentinaDays(now = new Date()) {
  const today = argentinaStartOfDay(
    argentinaParts(now).year,
    argentinaParts(now).month,
    argentinaParts(now).day,
  );
  const start = addArgentinaDays(today, -6);
  const end = addArgentinaDays(today, 1);
  return { start, end };
}
