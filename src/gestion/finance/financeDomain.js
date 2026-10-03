import { isActiveSale, summarizeSales, saleDate } from "../../modules/locations/domain/saleFacts.js";
import { salePaymentParts } from "../../modules/locations/domain/payments.js";
import { argentinaDateFromKey, argentinaDateKey } from "../../modules/locations/domain/time.js";

export const EXPENSE_CATEGORIES = ["Mercadería", "Alquiler local", "Servicios", "Personal", "Insumos", "Logística y envíos", "Espacios de ferias y eventos", "Marketing y publicidad", "Diseño y contenido", "Impuestos y tasas", "Otros gastos extraordinarios"];
const money = (value, label) => { const number = Number(value); if (value === "" || value == null || !Number.isFinite(number) || number < 0 || Math.abs(Math.round(number * 100) - number * 100) > 0.000001) throw new Error(`${label}: ingresá un monto válido con hasta dos decimales.`); return number; };
const optionalDate = value => value ? argentinaDateFromKey(value) : null;

export function validateFinancialEntry(input) {
  const type = input.type;
  if (!["expense", "external_income"].includes(type)) throw new Error("Elegí gasto o ingreso externo.");
  const amount = money(input.amount, "Importe");
  if (!amount) throw new Error("El importe debe ser mayor a cero.");
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Describí el movimiento.");
  if (!input.accruedOn) throw new Error("Indicá la fecha de devengamiento.");
  optionalDate(input.accruedOn); optionalDate(input.dueOn); optionalDate(input.paidOn);
  if (input.paidOn && input.paidOn > argentinaDateKey()) throw new Error("Un pago efectivo no puede tener fecha futura; usá vencimiento para proyectarlo.");
  if (!["fixed", "variable", "extraordinary"].includes(input.nature)) throw new Error("Elegí la naturaleza del movimiento.");
  if (!input.category?.trim()) throw new Error("Elegí una categoría.");
  if (input.scope === "location" && !input.locationId) throw new Error("Seleccioná la ubicación.");
  if (!["general", "location"].includes(input.scope)) throw new Error("Elegí el alcance del gasto.");
  if (input.paidOn && !["cash", "bank"].includes(input.cashAccount)) throw new Error("Indicá si el pago fue en efectivo o bancario.");
  if (input.saleId || input.invoiceId || input.orderId && type === "external_income") throw new Error("Las ventas y facturas ingresan automáticamente; no se pueden duplicar como ingreso manual.");
  if (type === "external_income" && !String(input.reference || "").trim()) throw new Error("El ingreso externo necesita una referencia trazable ajena a ventas.");
  return { type, name, amount, category: input.category.trim(), nature: input.nature, scope: input.scope, locationId: input.scope === "location" ? input.locationId : "", accruedOn: input.accruedOn, dueOn: input.dueOn || "", paidOn: input.paidOn || "", cashAccount: input.cashAccount || "", notes: String(input.notes || "").trim(), reference: String(input.reference || "").trim(), supplierId: input.supplierId || "", orderId: input.orderId || "", shipmentId: input.shipmentId || "", status: "active", active: true, deleted: false };
}
export function validateFinancePolicy(input) {
  if (!input.effectiveFrom) throw new Error("Indicá desde qué fecha rige esta configuración.");
  argentinaDateFromKey(input.effectiveFrom);
  const fees = {};
  Object.entries(input.fees || {}).forEach(([method, item]) => {
    const percent = item.percent === "" || item.percent == null ? null : money(item.percent, "Comisión");
    const days = item.settlementDays === "" || item.settlementDays == null ? null : Number(item.settlementDays);
    if (percent != null && percent > 100 || days != null && (!Number.isInteger(days) || days < 0 || days > 365)) throw new Error("Comisión entre 0 y 100; plazo entre 0 y 365 días corridos.");
    fees[method] = { percent, settlementDays: days };
  });
  const taxPercent = input.taxPercent === "" || input.taxPercent == null ? null : money(input.taxPercent, "Impuesto estimado");
  if (taxPercent != null && taxPercent > 100) throw new Error("El impuesto estimado debe estar entre 0 y 100.");
  return { effectiveFrom: input.effectiveFrom, fees, taxPercent, categories: [...new Set([...(input.categories || EXPENSE_CATEGORIES)].map(category => String(category).trim()).filter(Boolean))] };
}
export function policyForSale(config, sale) {
  const key = saleDate(sale) ? argentinaDateKey(saleDate(sale)) : "";
  return (config.versions || []).filter(version => version.effectiveFrom <= key).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.version - a.version)[0] || null;
}
export function settlementId(saleId, method) {
  return `settlement_${encodeURIComponent(saleId)}_${encodeURIComponent(method)}`;
}
export function expectedSettlements(sales, config = {}, entries = [], now = new Date()) {
  const evidence = new Map(entries.filter(entry => entry.type === "settlement" && !entry.deleted && entry.status !== "cancelled").map(entry => [entry.id, entry]));
  return summarizeSales(sales).sales.flatMap(sale => {
    const policy = policyForSale(config, sale);
    return salePaymentParts(sale).filter(part => part.method !== "cash").map(part => {
      const fee = policy?.fees?.[part.method];
      const expected = fee?.percent != null ? Math.round(part.amount * (1 - fee.percent / 100) * 100) / 100 : null;
      const due = saleDate(sale) && fee?.settlementDays != null ? new Date(saleDate(sale).getTime() + fee.settlementDays * 86400000) : null;
      const id = settlementId(sale.id, part.method), actual = evidence.get(id);
      const difference = actual && expected != null ? Math.round((Number(actual.amount) - expected) * 100) / 100 : null;
      const discrepancy = difference != null && difference !== 0 || !actual && due != null && now > due;
      return { id, saleId: sale.id, saleCode: sale.saleCode || sale.id, method: part.method, label: part.label, gross: part.amount, expected, due, actual: actual || null, difference, discrepancy, state: actual ? difference == null ? "Acreditado · comparación sin configurar" : difference === 0 ? "Conciliado" : "Diferencia de importe" : due == null ? "Plazo sin configurar" : now > due ? "Acreditación vencida" : "Dentro del plazo", policyVersion: policy?.version || null };
    });
  });
}
export function financeSummary(sales, entries, config = {}, range, locationIds = [], now = new Date()) {
  const facts = summarizeSales(sales);
  const inPeriod = key => key && argentinaDateFromKey(key) >= range.start && argentinaDateFromKey(key) < range.end;
  const allEntries = entries.filter(entry => !entry.deleted && !["cancelled", "archived"].includes(entry.status));
  const available = allEntries.filter(entry => !locationIds.length || entry.scope !== "location" || locationIds.includes(entry.locationId));
  const expenses = available.filter(entry => entry.type === "expense" && inPeriod(entry.accruedOn));
  const extraIncome = available.filter(entry => entry.type === "external_income" && inPeriod(entry.accruedOn));
  let knownCost = 0, missingCost = 0, commissions = 0, missingFees = 0, taxes = 0, missingTaxes = 0;
  facts.sales.forEach(sale => {
    if (!(sale.items || []).length && Number(sale.total) > 0) missingCost++;
    (sale.items || []).forEach(item => {
      const quantity = Number(item.qty ?? item.quantity ?? 0);
      if (!Number.isFinite(quantity) || quantity <= 0 || item.unitCost == null || !Number.isFinite(Number(item.unitCost)) || Number(item.unitCost) < 0) missingCost += Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
      else knownCost += Number(item.unitCost) * quantity;
    });
    const policy = policyForSale(config, sale);
    const parts = salePaymentParts(sale);
    if (!parts.length && Number(sale.total) > 0) missingFees++;
    parts.forEach(part => { if (policy?.fees?.[part.method]?.percent == null) missingFees++; else commissions += part.amount * policy.fees[part.method].percent / 100; });
    if (policy?.taxPercent == null) missingTaxes++; else taxes += Number(sale.total || 0) * policy.taxPercent / 100;
  });
  const expenseTotal = expenses.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  // La imputación de compras de inventario no está definida. No descontarlas
  // otra vez sobre un margen que ya incluye el costo de mercadería vendida.
  const inventoryTreatmentPending = expenses.some(entry => entry.category === EXPENSE_CATEGORIES[0]);
  const contribution = missingCost || missingFees || missingTaxes ? null : facts.total - knownCost - commissions - taxes;
  const settlements = expectedSettlements(facts.sales, config, available, now);
  const paid = available.filter(entry => ["expense", "external_income"].includes(entry.type) && inPeriod(entry.paidOn));
  const cashSales = facts.sales.reduce((sum, sale) => sum + salePaymentParts(sale).filter(part => part.method === "cash").reduce((amount, part) => amount + part.amount, 0), 0);
  const signed = entry => (entry.type === "expense" ? -1 : 1) * Number(entry.amount || 0);
  const cashMovement = cashSales + paid.filter(entry => entry.cashAccount === "cash").reduce((sum, entry) => sum + signed(entry), 0);
  // Acreditaciones del período efectivo, aunque la venta pertenezca a otro mes.
  const bankMovement = available.filter(entry => entry.type === "settlement" && inPeriod(entry.paidOn)).reduce((sum, entry) => sum + Number(entry.amount || 0), 0) + paid.filter(entry => entry.cashAccount === "bank").reduce((sum, entry) => sum + signed(entry), 0);
  const projected = available.filter(entry => ["expense", "external_income"].includes(entry.type) && !entry.paidOn && entry.dueOn && argentinaDateFromKey(entry.dueOn) >= now).map(entry => ({ id: entry.id, date: entry.dueOn, name: entry.name, amount: signed(entry), evidence: "Vencimiento registrado" }));
  settlements.filter(part => !part.actual && part.expected != null && part.due && part.due >= now).forEach(part => projected.push({ id: part.id, date: argentinaDateKey(part.due), name: part.saleCode, amount: part.expected, evidence: "Venta y plazo configurado" }));
  const month = argentinaDateKey(range.start).slice(0, 7);
  const budgets = available.filter(entry => entry.type === "budget" && entry.month === month).map(budget => {
    const spent = allEntries.filter(entry => entry.type === "expense" && inPeriod(entry.accruedOn) && entry.category === budget.category && (budget.scope !== "location" || entry.locationId === budget.locationId)).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    return { ...budget, spent, difference: budget.amount - spent, percentage: budget.amount ? spent / budget.amount * 100 : null };
  });
  const inactiveSettlementIds = sales.filter(sale => !isActiveSale(sale)).flatMap(sale => salePaymentParts(sale).filter(part => part.method !== "cash").map(part => settlementId(sale.id, part.method)));
  const expenseHistory = entries.filter(entry => entry.type === "expense" && inPeriod(entry.accruedOn) && (!locationIds.length || entry.scope !== "location" || locationIds.includes(entry.locationId)));
  return { extraIncomeEntries: extraIncome, expenseHistory, inactiveSettlementIds, inventoryTreatmentPending, sales: facts.sales, salesCount: facts.count, saleIncome: facts.total, extraIncome: extraIncome.reduce((sum, entry) => sum + Number(entry.amount), 0), expenses, expenseTotal, knownCost, missingCost, commissions: missingFees ? null : commissions, taxes: missingTaxes ? null : taxes, missingFees, missingTaxes, contribution, result: contribution == null || inventoryTreatmentPending ? null : contribution + extraIncome.reduce((sum, entry) => sum + Number(entry.amount), 0) - expenseTotal, cashMovement, bankMovement, settlements, projected, budgets, shippingCharged: facts.sales.reduce((sum, sale) => sum + Number(sale.shippingAmount || 0), 0) };
}
