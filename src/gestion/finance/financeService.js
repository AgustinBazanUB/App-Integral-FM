import { collection, doc, getDoc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp, Timestamp, where } from "firebase/firestore";
import { db } from "../services/firebase";
import { can } from "../permissions";
import { argentinaDateFromKey, argentinaDateKey } from "../../modules/locations/domain/time";
import { isActiveSale, saleDate } from "../../modules/locations/domain/saleFacts";
import { expectedSettlements, settlementId, validateFinancePolicy, validateFinancialEntry } from "./financeDomain";

const requireFinance = (profile, action = "view") => { if (!can(profile, "finance", action)) throw new Error("No tenés permiso para esta operación financiera."); };
const auditData = (profile, action, entityId, detail = {}) => ({ moduleId: "finance", action, entityType: "financialEntry", entityId, userId: profile.id, userName: profile.name || profile.email || "Usuario", description: action, ...detail, createdAt: serverTimestamp() });
export async function getFinanceConfig(profile) {
  requireFinance(profile);
  const snapshot = await getDoc(doc(db, "settings", "financeConfig"));
  return snapshot.exists() ? snapshot.data() : { versions: [] };
}
export async function saveFinanceConfig(profile, input) {
  requireFinance(profile, "admin");
  const policy = validateFinancePolicy(input), reference = doc(db, "settings", "financeConfig"), audit = doc(collection(db, "auditLogs"));
  await runTransaction(db, async transaction => {
    const previous = await transaction.get(reference);
    const versions = previous.data()?.versions || [];
    if (versions.length >= 100) throw new Error("El historial alcanzó 100 versiones. Es necesario ampliar el almacenamiento conservando la trazabilidad.");
    const version = Number(previous.data()?.version || 0) + 1;
    transaction.set(reference, { version, versions: [...versions, { ...policy, version }], updatedBy: profile.id, updatedAt: serverTimestamp() });
    transaction.set(audit, auditData(profile, "finance.configured", "financeConfig", { version, policy }));
  });
}
export async function listFinancialEntries(profile, range, saleIds = []) {
  requireFinance(profile);
  const tasks = ["occurredAt", "paidAt", "dueAt"].map(field => getDocs(query(collection(db, "financialEntries"), where(field, ">=", Timestamp.fromDate(range.start)), where(field, "<", Timestamp.fromDate(range.end)), orderBy(field, "desc"))));
  tasks.push(getDocs(query(collection(db, "financialEntries"), where("type", "==", "budget"), where("month", "==", argentinaDateKey(range.start).slice(0, 7)))));
  for (let index = 0; index < saleIds.length; index += 10) tasks.push(getDocs(query(collection(db, "financialEntries"), where("type", "==", "settlement"), where("saleId", "in", saleIds.slice(index, index + 10)))));
  const snapshots = await Promise.all(tasks);
  const entries = new Map();
  snapshots.forEach(snapshot => snapshot.docs.forEach(item => entries.set(item.id, { id: item.id, ...item.data() })));
  return [...entries.values()];
}
export async function listLegacyFinancialEntries(profile) {
  requireFinance(profile);
  const snapshot = await getDocs(query(collection(db, "financialEntries"), orderBy("updatedAt", "desc"), limit(30)));
  /** @type {any[]} */
  const entries = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  return entries.filter(entry => !entry.type && !entry.deleted);
}
export function newFinancialIntent() { return doc(collection(db, "financialEntries")).id; }
export async function saveFinancialEntry(profile, input, intentId) {
  requireFinance(profile, "create");
  if (!intentId) throw new Error("Falta el identificador de la operación.");
  const data = validateFinancialEntry(input), reference = doc(db, "financialEntries", intentId), audit = doc(db, "auditLogs", `finance_${intentId}`);
  await runTransaction(db, async transaction => {
    const previous = await transaction.get(reference);
    if (previous.exists()) {
      if (previous.data().createdBy !== profile.id || !Object.keys(data).every(key => previous.data().intentPayload?.[key] === data[key])) throw new Error("El identificador ya corresponde a otro movimiento.");
      return;
    }
    for (const [field, source] of [["supplierId", "suppliers"], ["orderId", "orders"], ["shipmentId", "shipments"]]) {
      if (data[field]) { const linked = await transaction.get(doc(db, source, data[field])); if (!linked.exists()) throw new Error(`No existe la referencia ${field}.`); }
    }
    transaction.set(reference, { ...data, intentPayload: data, occurredAt: Timestamp.fromDate(argentinaDateFromKey(data.accruedOn)), paidAt: data.paidOn ? Timestamp.fromDate(argentinaDateFromKey(data.paidOn)) : null, dueAt: data.dueOn ? Timestamp.fromDate(argentinaDateFromKey(data.dueOn)) : null, createdBy: profile.id, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    transaction.set(audit, auditData(profile, "finance.entry.created", intentId, { amount: data.amount, type: data.type }));
  });
  return intentId;
}
export async function cancelFinancialEntry(profile, entry, reason) {
  requireFinance(profile, "edit");
  if (!String(reason || "").trim()) throw new Error("Indicá el motivo de la anulación.");
  if (!["expense", "external_income"].includes(entry.type)) throw new Error("Este tipo de registro tiene su propio flujo de conciliación.");
  const reference = doc(db, "financialEntries", entry.id), audit = doc(collection(db, "auditLogs"));
  await runTransaction(db, async transaction => {
    const stored = await transaction.get(reference);
    if (!stored.exists()) throw new Error("El movimiento no existe.");
    if (stored.data().status === "cancelled") return;
    transaction.update(reference, { status: "cancelled", active: false, cancellationReason: reason.trim(), updatedBy: profile.id, updatedAt: serverTimestamp() });
    transaction.set(audit, auditData(profile, "finance.entry.cancelled", entry.id, { reason: reason.trim() }));
  });
}
export async function saveBudget(profile, input) {
  requireFinance(profile, "edit");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month) || !input.category?.trim() || !Number.isFinite(Number(input.amount)) || Number(input.amount) <= 0 || !Number.isFinite(Number(input.threshold)) || Number(input.threshold) < 1 || Number(input.threshold) > 100) throw new Error("Completá mes, categoría, presupuesto positivo y umbral de 1 a 100 %.");
  const id = `budget_${input.month}_${encodeURIComponent(input.category)}_${encodeURIComponent(input.locationId || "general")}`, reference = doc(db, "financialEntries", id), audit = doc(collection(db, "auditLogs"));
  await runTransaction(db, async transaction => {
    const previous = await transaction.get(reference);
    transaction.set(reference, { type: "budget", month: input.month, category: input.category.trim(), amount: Number(input.amount), threshold: Number(input.threshold), scope: input.locationId ? "location" : "general", locationId: input.locationId || "", active: true, deleted: false, status: "active", createdBy: previous.data()?.createdBy || profile.id, createdAt: previous.data()?.createdAt || serverTimestamp(), updatedBy: profile.id, updatedAt: serverTimestamp() });
    transaction.set(audit, auditData(profile, "finance.budget.saved", id, { amount: Number(input.amount), threshold: Number(input.threshold) }));
  });
}
export async function recordSettlement(profile, part, input) {
  requireFinance(profile, "edit");
  const amount = Number(input.amount), referenceText = String(input.reference || "").trim();
  if (input.amount === "" || !Number.isFinite(amount) || amount < 0 || Math.abs(Math.round(amount * 100) - amount * 100) > 0.000001 || !referenceText || !input.paidOn) throw new Error("Completá importe acreditado (hasta dos decimales), fecha y referencia verificable.");
  if (input.paidOn > argentinaDateKey()) throw new Error("Una acreditación efectiva no puede tener fecha futura.");
  const id = settlementId(part.saleId, part.method), reference = doc(db, "financialEntries", id), alert = doc(db, "alerts", `finance_${id}`), audit = doc(collection(db, "auditLogs"));
  await runTransaction(db, async transaction => {
    const saleSnapshot = await transaction.get(doc(db, "sales", part.saleId)), config = await transaction.get(doc(db, "settings", "financeConfig")), previous = await transaction.get(reference), existingAlert = await transaction.get(alert);
    if (!saleSnapshot.exists() || !isActiveSale(saleSnapshot.data())) throw new Error("La venta ya no está activa; actualizá los controles.");
    const current = expectedSettlements([{ id: part.saleId, ...saleSnapshot.data() }], config.data() || {}).find(item => item.method === part.method);
    if (!current) throw new Error("El medio de pago ya no forma parte de esta venta.");
    if (previous.exists() && previous.data().amount === amount && previous.data().paidOn === input.paidOn && previous.data().reference === referenceText) return;
    const matched = current.expected != null && Math.round(amount * 100) === Math.round(current.expected * 100);
    transaction.set(reference, { type: "settlement", scope: saleSnapshot.data().locationId ? "location" : "general", locationId: saleSnapshot.data().locationId || "", saleId: part.saleId, method: part.method, amount, paidOn: input.paidOn, paidAt: Timestamp.fromDate(argentinaDateFromKey(input.paidOn)), occurredAt: Timestamp.fromDate(saleDate(saleSnapshot.data())), reference: referenceText, evidenceSource: "manual_evidence", policyVersion: current.policyVersion, active: true, deleted: false, status: "active", createdBy: previous.data()?.createdBy || profile.id, createdAt: previous.data()?.createdAt || serverTimestamp(), updatedBy: profile.id, updatedAt: serverTimestamp() });
    if (matched && existingAlert.exists()) transaction.update(alert, { status: "resolved", active: false, resolution: "Acreditación posterior coincidente", updatedAt: serverTimestamp() });
    transaction.set(audit, auditData(profile, matched ? "finance.settlement.matched" : "finance.settlement.recorded", id, { amount, reference: referenceText, policyVersion: current.policyVersion }));
  });
}
export async function syncFinanceAlerts(profile, summary) {
  requireFinance(profile, "edit");
  const controls = [
    ...(summary.inactiveSettlementIds || []).map(id => ({ id: `finance_${id}`, active: false, sourceId: id })),
    ...summary.settlements.map(part => ({ id: `finance_${part.id}`, active: part.discrepancy, title: `${part.state}: ${part.saleCode}`, severity: "critical", sourceId: part.id, signature: JSON.stringify([part.state, part.expected, part.actual?.amount, part.actual?.reference, part.policyVersion, part.due?.toISOString?.()]) })),
    ...summary.budgets.map(budget => ({ id: `finance_${budget.id}`, active: budget.percentage != null && budget.percentage >= budget.threshold, title: `Presupuesto ${budget.category}: ${budget.percentage?.toFixed(1)} %`, severity: budget.percentage >= 100 ? "critical" : "warning", sourceId: budget.id, signature: JSON.stringify([budget.amount, budget.spent, budget.threshold]) })),
  ];
  for (const control of controls) {
    const reference = doc(db, "alerts", control.id), audit = doc(collection(db, "auditLogs"));
    await runTransaction(db, async transaction => {
      const previous = await transaction.get(reference);
      if (control.active) {
        if (previous.data()?.manualResolution && previous.data()?.resolvedControlSignature === control.signature) return;
        if (previous.data()?.active === true && previous.data()?.controlSignature === control.signature) return;
        transaction.set(reference, { controlSignature: control.signature || "", title: control.title, name: control.title, description: "Control financiero basado en ventas, acreditaciones o presupuesto", severity: control.severity, status: "active", active: true, deleted: false, moduleId: "finance", sourceId: control.sourceId, targetPath: "/gestion/finance", responsibleId: profile.id, createdBy: previous.data()?.createdBy || profile.id, createdAt: previous.data()?.createdAt || serverTimestamp(), updatedAt: serverTimestamp() });
      } else if (previous.exists() && previous.data().active === true) transaction.update(reference, { status: "resolved", active: false, resolution: "Control actualizado sin discrepancia", updatedAt: serverTimestamp() });
      else return;
      transaction.set(audit, auditData(profile, control.active ? "finance.alert.opened" : "finance.alert.resolved", control.id));
    });
  }
}
export async function resolveFinanceAlert(profile, sourceId, title, reason) {
  requireFinance(profile, "edit");
  if (!String(reason || "").trim()) throw new Error("La resolución manual requiere un motivo.");
  const reference = doc(db, "alerts", `finance_${sourceId}`), audit = doc(collection(db, "auditLogs"));
  await runTransaction(db, async transaction => {
    const previous = await transaction.get(reference);
    if (!previous.exists()) throw new Error("Actualizá los controles para registrar esta discrepancia antes de resolverla.");
    transaction.update(reference, { active: false, status: "resolved", manualResolution: reason.trim(), controlTitle: title, resolvedControlSignature: previous.data().controlSignature || "", resolvedBy: profile.id, updatedAt: serverTimestamp() });
    transaction.set(audit, auditData(profile, "finance.alert.manually_resolved", sourceId, { reason: reason.trim() }));
  });
}
