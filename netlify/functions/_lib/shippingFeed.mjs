// Authenticated read fallback while a preview's Firestore rules/indexes are
// awaiting release. It uses the same role/assignment boundaries as the module.
import { firebaseAdminAccessToken, adminRunTransaction } from "./firestoreAdminRest.mjs";
import { publicFirebaseProjectId } from "./firebaseAuth.mjs";
import { can } from "../../../src/gestion/permissions.js";
import { shippingError } from "../../../src/shared/shippingDomain.mjs";

const value = field => {
  if ("arrayValue" in field) return (field.arrayValue.values || []).map(value);
  if ("mapValue" in field) return fields(field.mapValue.fields || {});
  if ("integerValue" in field) return Number(field.integerValue);
  if ("nullValue" in field) return null;
  return field.stringValue ?? field.booleanValue ?? field.doubleValue ?? field.timestampValue;
};
const fields = data => Object.fromEntries(Object.entries(data).map(([key, child]) => [key, value(child)]));
export async function queryShippingFeedRows(kind, { env = process.env, fetchImpl = fetch } = {}) {
  const token = await firebaseAdminAccessToken({ env, fetchImpl });
  const alerts = kind === "notifications";
  const response = await fetchImpl(`https://firestore.googleapis.com/v1/projects/${publicFirebaseProjectId()}/databases/(default)/documents:runQuery`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: alerts ? "alerts" : "shipments" }], where: { fieldFilter: { field: { fieldPath: alerts ? "source" : "shippingSchemaVersion" }, op: "EQUAL", value: alerts ? { stringValue: "shipping" } : { integerValue: "1" } } }, limit: 1001 } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw shippingError("No se pudo consultar el tablero de envíos.", 503);
  const rows = (await response.json()).filter(row => row.document?.name).map(row => ({ ...fields(row.document.fields || {}), id: row.document.name.split("/").at(-1) }));
  if (rows.length > 1000) throw shippingError("El tablero requiere paginación antes de mostrar más de mil registros.", 409);
  return rows;
}
export async function shippingFeed({ session, kind = "shipments", assigned = false, queryRows = queryShippingFeedRows }) {
  const profile = session?.profile;
  if (!profile?.active || !session.uid || profile.id !== session.uid) throw shippingError("No tenés permiso para esta consulta.", 403);
  const rows = await queryRows(kind);
  if (kind === "notifications") return rows.filter(row => row.source === "shipping" && row.responsibleId === session.uid && row.active === true).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 60);
  return rows.filter(row => row.shippingSchemaVersion === 1 && (assigned ? row.assignedPreparerIds?.includes(session.uid) : can(profile, "shipping", "view") || row.createdBy === session.uid)).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 250);
}
export async function markShippingNotificationRead({ session, alertId, runTransaction = adminRunTransaction, now = new Date() }) {
  if (!session?.uid || !/^[A-Za-z0-9_-]{1,200}$/.test(alertId || "")) throw shippingError("Aviso inválido.", 403);
  return runTransaction(async transaction => {
    const profile = (await transaction.getDocument(`users/${session.uid}`))?.data;
    const row = (await transaction.getDocument(`alerts/${alertId}`))?.data;
    if (!profile?.active || row?.source !== "shipping" || row.responsibleId !== session.uid) throw shippingError("No tenés permiso para ese aviso.", 403);
    await transaction.commitDocuments([{ type: "update", path: `alerts/${alertId}`, data: { read: true, readAt: now } }]);
    return { id: alertId };
  });
}
