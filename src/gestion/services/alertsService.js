import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { moduleById } from "../modules";
import { can, normalizedRole } from "../permissions";
import { prioritizeAlerts } from "../../modules/alerts/domain/alerts.js";
import { db } from "./firebase";
import { primeRuntimeCache, withRuntimeCache } from "./runtimeCache";

export function subscribeActiveAlerts(profile, notify) {
  if (!can(profile, "alerts", "view")) return () => {};
  const admin = ["admin", "general_admin"].includes(normalizedRole(profile));
  const constraints = [where("active", "==", true)];
  if (!admin) constraints.push(where("responsibleId", "==", profile.id));
  return onSnapshot(query(collection(db, moduleById.alerts.collection), ...constraints), snapshot => {
    primeRuntimeCache(`active-alerts:${profile.id}:${admin}`, prioritizeAlerts(snapshot.docs.map(item => ({ ...item.data(), id: item.id }))), 30_000);
    notify();
  }, () => { /* The authorized initial load remains the fallback on connection loss. */ });
}

export function listActiveAlerts(profile) {
  if (!can(profile, "alerts", "view")) return Promise.resolve([]);
  const admin = ["admin", "general_admin"].includes(normalizedRole(profile));
  return withRuntimeCache(`active-alerts:${profile.id}:${admin}`, async () => {
    const constraints = [where("active", "==", true)];
    // Firestore exige responsable explícito para lectores que no son administradores.
    if (!admin) constraints.push(where("responsibleId", "==", profile.id));
    const snapshot = await getDocs(query(collection(db, moduleById.alerts.collection), ...constraints));
    // No limitar antes de ordenar: una crítica antigua debe superar a un aviso reciente.
    return prioritizeAlerts(snapshot.docs.map((item) => ({ ...item.data(), id: item.id })));
  }, 30_000);
}
