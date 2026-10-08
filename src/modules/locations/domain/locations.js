const pad = value => String(value).padStart(2, "0");

export function dateFromLocationValue(value, boundary = "start") {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value;
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date;
  }
  const text = String(value).trim();
  if (!text) return null;
  // Firestore REST serializes timestamps with an explicit offset. Preserve that
  // instant across browser and UTC server hosts before handling local inputs.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const date = new Date(text);
    return Number.isNaN(date.valueOf()) ? null : date;
  }
  const datetime = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (datetime) {
    const [, year, month, day, hour, minute] = datetime.map(Number);
    return new Date(year, month - 1, day, hour, minute, 0, 0);
  }
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, year, month, day] = dateOnly.map(Number);
    return boundary === "end"
      ? new Date(year, month - 1, day, 23, 59, 59, 999)
      : new Date(year, month - 1, day, 0, 0, 0, 0);
  }
  const date = new Date(text);
  return Number.isNaN(date.valueOf()) ? null : date;
}

export function locationSchedule(location = {}) {
  const startAt = dateFromLocationValue(location.scheduleStartAt || location.startDateTime || location.startDate, "start");
  const endAt = dateFromLocationValue(location.scheduleEndAt || location.endDateTime || location.endDate, "end");
  return {startAt, endAt, hasSchedule:Boolean(startAt || endAt || location.autoActivityManaged)};
}

export function locationActivity(location = {}, now = new Date()) {
  if (location.deleted === true) return {active:false, label:"Eliminada", reason:"deleted", className:"danger"};
  const {startAt, endAt, hasSchedule} = locationSchedule(location);
  const manualInactiveUntil = dateFromLocationValue(location.manualInactiveUntil || location.manualInactiveUntilDateTime, "end");
  const hasManualPause = Boolean(location.manualInactiveUntil || location.manualInactiveUntilDateTime || location.manualInactiveDays);
  const paused = manualInactiveUntil && manualInactiveUntil > now;
  if (paused) return {active:false, label:"Pausada", reason:"paused", className:"warning", startAt, endAt, manualInactiveUntil};
  const manuallyDisabled = location.active === false && !hasManualPause;
  if (manuallyDisabled) return {active:false, label:"Inactiva", reason:"manual", className:"", startAt, endAt, manualInactiveUntil};
  if (hasSchedule) {
    if (startAt && now < startAt) return {active:false, label:"Programada", reason:"future", className:"info", startAt, endAt, manualInactiveUntil};
    if (endAt && now > endAt) return {active:false, label:"Vencida", reason:"ended", className:"", startAt, endAt, manualInactiveUntil};
    return {active:true, label:"Activa", reason:"active", className:"ok", startAt, endAt, manualInactiveUntil};
  }
  if (location.active === false && hasManualPause && manualInactiveUntil && manualInactiveUntil <= now) return {active:true, label:"Activa", reason:"manual-expired", className:"ok", startAt, endAt, manualInactiveUntil};
  return location.active === true
    ? {active:true, label:"Activa", reason:"active", className:"ok", startAt, endAt, manualInactiveUntil}
    : {active:false, label:"Inactiva", reason:"manual", className:"", startAt, endAt, manualInactiveUntil};
}

export const isLocationActiveNow = (location, now = new Date()) => locationActivity(location, now).active;

export function toLocalDateTimeInput(value, boundary = "start") {
  const date = dateFromLocationValue(value, boundary);
  if (!date) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function localDateTimeToDate(value) {
  return dateFromLocationValue(value, "start");
}

export function localDatePart(value) {
  return String(value || "").slice(0, 10);
}

export function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + Number(days || 0));
  return result;
}

export const LOCATION_TYPES = Object.freeze({ store: "Local", fair: "Feria", event: "Evento" });
export const OPERATING_DAYS = Object.freeze(["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]);

export function normalizeOperatingCalendar(calendar = {}) {
  const weekdays = [...new Set(calendar.weekdays || [])].sort((a, b) => a - b);
  if (weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) throw new Error("Los días de atención deben estar entre lunes y domingo.");
  const openingTime = String(calendar.openingTime || "");
  const closingTime = String(calendar.closingTime || "");
  const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if ((openingTime && !clock.test(openingTime)) || (closingTime && !clock.test(closingTime)) || Boolean(openingTime) !== Boolean(closingTime)) throw new Error("Completá horarios válidos de apertura y cierre.");
  if (openingTime && openingTime === closingTime) throw new Error("Apertura y cierre deben ser distintos; para una jornada nocturna usá un cierre menor que la apertura.");
  const dates = [...new Set((calendar.dates || []).map((date) => String(date).trim()).filter(Boolean))].sort();
  if (dates.length > 120 || dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) throw new Error("Usá hasta 120 fechas reales con formato AAAA-MM-DD.");
  return { timeZone: "America/Argentina/Buenos_Aires", weekdays, openingTime, closingTime, overnight: Boolean(openingTime && closingTime < openingTime), dates };
}
