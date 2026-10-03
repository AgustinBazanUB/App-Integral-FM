import { collection, doc, getDoc, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";
import { normalizedRole } from "../permissions";
import { validateHolidays } from "../../modules/locations/domain/operatingMetrics";
export async function getOperatingHolidays() {
  const result = await getDoc(doc(db, "settings", "operatingHolidays"));
  return result.data()?.years || {};
}
export async function saveOperatingHolidays(profile, year, dates) {
  if (!["admin", "general_admin"].includes(normalizedRole(profile))) throw new Error("Sólo Administración puede configurar feriados.");
  const values = validateHolidays(year, dates);
  const reference = doc(db, "settings", "operatingHolidays"), audit = doc(collection(db, "auditLogs"));
  await runTransaction(db, async transaction => {
    const previous = await transaction.get(reference);
    transaction.set(reference, { years: { ...(previous.data()?.years || {}), [year]: values }, updatedBy: profile.id, updatedAt: serverTimestamp() });
    transaction.set(audit, { moduleId: "metrics", action: "metrics.holidays.configured", entityId: String(year), userId: profile.id, description: "Calendario de feriados configurado", dates: values, createdAt: serverTimestamp() });
  });
}
