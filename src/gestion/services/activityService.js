import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "./firebase";
import { can, canAccessAdministration } from "../permissions";

export async function listActivityUsers(profile) {
  if (!canAccessAdministration(profile)) return [];
  const snapshot = await getDocs(collection(db, "users"));
  return snapshot.docs.map(row => { const user = row.data(); return { id: row.id, name: user.name || user.email || "Usuario", email: user.email || "", active: user.active, deleted: user.deleted === true }; });
}
const validId = id => typeof id === "string" && id.length > 0 && id.length <= 512 && !id.includes("/");
const entityCollections = { sale: "sales", product: "products", productCategory: "productCategories", customer: "customers", location: "locations", warehouse: "warehouses", stockTransfer: "stockTransfers", inventoryOperation: "inventoryOperations", stockOperation: "stockOperations", whatsappCampaign: "whatsappCampaigns", financialEntry: "financialEntries" };
export async function loadActivityDetail(item, profile) {
  const allowedSources = [
    ...(can(profile, "locations", "view") || canAccessAdministration(profile) ? ["auditLogs", "stockMovements"] : []),
    ...(can(profile, "quick-sales", "view") || can(profile, "metrics", "view") ? ["sales"] : []),
  ];
  if (!allowedSources.includes(item?.source) || !validId(item.sourceId)) throw new Error("No tenés permiso para abrir esta actividad.");
  const snapshot = await getDoc(doc(db, item.source, item.sourceId));
  if (!snapshot.exists()) throw new Error("Este registro ya no está disponible. Actualizá la actividad.");
  const raw = snapshot.data();
  const recordedFields = raw.after || raw.next || raw.newSettings;
  let record = raw.detailSnapshot || (recordedFields && typeof recordedFields === "object" && !Array.isArray(recordedFields) ? recordedFields : null), recorded = Boolean(record), warning = "", movements = [];
  if (item.source === "sales" && canAccessAdministration(profile)) {
    const audits = await getDocs(query(collection(db, "auditLogs"), where("entityId", "==", item.sourceId), where("action", "==", "sale.created"), limit(1)));
    const historical = audits.docs[0]?.data().detailSnapshot;
    if (historical) { record = historical; recorded = true; }
  }
  const entityId = raw.entityId, entityCollection = entityCollections[raw.entityType] || (String(raw.action).startsWith("sale.") ? "sales" : null);
  const stockContext = raw.entityType === "locationProduct" ? ["locationStock", raw.locationId] : raw.entityType === "warehouseProduct" ? ["warehouseStock", raw.warehouseId] : null;
  const relatedPath = entityCollection && validId(entityId) ? [entityCollection, entityId] : stockContext && validId(stockContext[1]) && validId(entityId) ? [...stockContext, "items", entityId] : null;
  if (!record && relatedPath) {
    try {
      const related = await getDoc(doc(db, ...relatedPath));
      if (related.exists()) { record = related.data(); warning = "Este registro antiguo no guardó un desglose completo. Los datos relacionados que ves abajo son los actuales."; }
      else warning = "El registro relacionado ya no está disponible. Se conserva la información de esta actividad.";
    } catch (error) { if (error.code !== "permission-denied") throw error; warning = "Tu usuario puede ver esta actividad, pero no el registro relacionado."; }
  }
  if (item.source === "sales" && !record) { record = raw; warning = "Este registro antiguo no guardó una copia histórica. Se muestra el detalle actual de la venta."; }
  if (["stockOperation", "inventoryOperation"].includes(raw.entityType) && validId(entityId)) {
    const constraints = [where("operationId", "==", entityId)];
    if (!canAccessAdministration(profile) && raw.locationId) constraints.push(where("locationId", "==", raw.locationId));
    const results = await getDocs(query(collection(db, "stockMovements"), ...constraints, limit(101)));
    movements = results.docs.slice(0, 100).map(row => ({ id: row.id, ...row.data() }));
    if (results.docs.length > 100) warning = "Se muestran los primeros 100 movimientos de esta operación.";
    if (movements.length) { recorded = true; if (results.docs.length <= 100) warning = ""; }
  }
  return { raw, record, recorded, warning, movements };
}
