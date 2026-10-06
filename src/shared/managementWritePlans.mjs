import { LOCATION_TYPES, normalizeOperatingCalendar } from "../modules/locations/domain/locations.js";
import { moduleById } from "../gestion/modules.js";
export function buildLocationPayload({ values, previous, profile, stamp, startAt = null, endAt = null }) {
  const name = String(values.name || "").trim(), prefix = String(values.codePrefix || "").trim().toUpperCase();
  if (!name || !/^[A-Z0-9]{1,8}$/.test(prefix)) throw new Error("Completá un nombre y un prefijo de hasta 8 letras o números.");
  if (!Object.hasOwn(LOCATION_TYPES, values.type) && previous?.type !== values.type) throw new Error("Elegí Local, Feria o Evento.");
  if (startAt && endAt && startAt >= endAt) throw new Error("La fecha final debe ser posterior a la inicial.");
  return { name, type: values.type, codePrefix: prefix, operatingCalendar: normalizeOperatingCalendar(values.operatingCalendar ?? previous?.operatingCalendar),
    dniMode: values.dniMode || previous?.dniMode || "optional", active: values.active !== false,
    scheduleStartAt: startAt, scheduleEndAt: endAt, startDateTime: values.scheduleStartAt || "", endDateTime: values.scheduleEndAt || "",
    updatedBy: profile.id, updatedByName: profile.name || profile.email || "Usuario", updatedAt: stamp,
    ...(!previous ? { deleted: false, createdAt: stamp, createdBy: profile.id, assignedSellerIds: [], enabledDiscountIds: [] } : {}) };
}
export function buildModuleRecordPayload(moduleId, values, profile, stamp) {
  if (!moduleById[moduleId]?.collection) throw new Error("El módulo no tiene una colección configurada.");
  if (!String(values.name || "").trim()) throw new Error("Completá el campo principal.");
  return { ...values, name: String(values.name).trim(), notes: String(values.notes || "").trim(), moduleId, active: true, deleted: false,
    createdBy: profile.id, createdByName: profile.name || profile.email || "Usuario", createdAt: stamp, updatedAt: stamp };
}
