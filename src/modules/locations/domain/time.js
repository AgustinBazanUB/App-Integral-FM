export const ARGENTINA_TIME_ZONE = "America/Argentina/Buenos_Aires";

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ARGENTINA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const hourFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: ARGENTINA_TIME_ZONE,
  hour: "2-digit",
  hourCycle: "h23",
});
const pad = (value) => String(value).padStart(2, "0");
const validFormats = new Set(["year", "month", "week", "day"]);

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

export function argentinaHour(value = new Date()) {
  return Number(hourFormatter.format(value instanceof Date ? value : new Date(value)));
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
  const todayParts = argentinaParts(now);
  const today = argentinaStartOfDay(todayParts.year, todayParts.month, todayParts.day);
  const start = addArgentinaDays(today, -6);
  const end = addArgentinaDays(today, 1);
  return { start, end };
}

function asArgentinaDate(value = new Date()) {
  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) throw new Error("Seleccioná una fecha válida.");
    return value;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return argentinaDateFromKey(value);
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("Seleccioná una fecha válida.");
  return date;
}

function assertPeriodFormat(format) {
  if (!validFormats.has(format)) throw new Error("Elegí un formato temporal válido.");
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
}

export function argentinaStartOfWeek(value = new Date()) {
  const date = asArgentinaDate(value);
  const parts = argentinaParts(date);
  const dayStart = argentinaStartOfDay(parts.year, parts.month, parts.day);
  const mondayOffset = (dayStart.getUTCDay() + 6) % 7;
  return addArgentinaDays(dayStart, -mondayOffset);
}

export function argentinaPeriodRange(format, reference = new Date()) {
  assertPeriodFormat(format);
  const date = asArgentinaDate(reference);
  const { year, month, day } = argentinaParts(date);
  let start;
  let end;
  if (format === "year") {
    start = argentinaStartOfDay(year, 1, 1);
    end = argentinaStartOfDay(year + 1, 1, 1);
  } else if (format === "month") {
    ({ start, end } = argentinaMonthRange(`${year}-${pad(month)}`));
  } else if (format === "week") {
    start = argentinaStartOfWeek(date);
    end = addArgentinaDays(start, 7);
  } else {
    start = argentinaStartOfDay(year, month, day);
    end = addArgentinaDays(start, 1);
  }
  return {
    format,
    referenceKey: argentinaDateKey(date),
    start,
    end,
  };
}

export function shiftArgentinaPeriodReference(format, reference, amount) {
  assertPeriodFormat(format);
  const date = asArgentinaDate(reference);
  const { year, month, day } = argentinaParts(date);
  const delta = Number(amount || 0);
  if (format === "day" || format === "week") {
    return argentinaDateKey(addArgentinaDays(date, delta * (format === "week" ? 7 : 1)));
  }
  if (format === "year") {
    const nextYear = year + delta;
    return argentinaDateKey(argentinaStartOfDay(nextYear, month, Math.min(day, daysInMonth(nextYear, month))));
  }
  const absoluteMonth = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(absoluteMonth / 12);
  const nextMonth = ((absoluteMonth % 12) + 12) % 12 + 1;
  return argentinaDateKey(argentinaStartOfDay(nextYear, nextMonth, Math.min(day, daysInMonth(nextYear, nextMonth))));
}

const capitalize = (value) => value.charAt(0).toUpperCase() + value.slice(1);
const fullDateLabel = (value) => new Intl.DateTimeFormat("es-AR", {
  timeZone: ARGENTINA_TIME_ZONE,
  day: "numeric",
  month: "long",
  year: "numeric",
}).format(value);

export function argentinaPeriodLabel(format, reference = new Date()) {
  const range = argentinaPeriodRange(format, reference);
  if (format === "year") return String(argentinaParts(range.start).year);
  if (format === "month") return argentinaMonthLabel(argentinaMonthKey(range.start));
  if (format === "day") return capitalize(fullDateLabel(range.start));
  const lastDay = addArgentinaDays(range.end, -1);
  const startParts = argentinaParts(range.start);
  const endParts = argentinaParts(lastDay);
  const monthName = (date) => new Intl.DateTimeFormat("es-AR", {
    timeZone: ARGENTINA_TIME_ZONE,
    month: "long",
  }).format(date);
  if (startParts.year === endParts.year && startParts.month === endParts.month) {
    return `${startParts.day} al ${endParts.day} de ${monthName(lastDay)} de ${endParts.year}`;
  }
  if (startParts.year === endParts.year) {
    return `${startParts.day} de ${monthName(range.start)} al ${endParts.day} de ${monthName(lastDay)} de ${endParts.year}`;
  }
  return `${fullDateLabel(range.start)} al ${fullDateLabel(lastDay)}`;
}

export function isArgentinaPeriodFuture(format, reference, now = new Date()) {
  const range = argentinaPeriodRange(format, reference);
  const todayParts = argentinaParts(now);
  const today = argentinaStartOfDay(todayParts.year, todayParts.month, todayParts.day);
  return range.start > today;
}

export function canAdvanceArgentinaPeriod(format, reference, now = new Date()) {
  const nextReference = shiftArgentinaPeriodReference(format, reference, 1);
  return !isArgentinaPeriodFuture(format, nextReference, now);
}
