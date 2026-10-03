import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, query, where, orderBy } from "firebase/firestore";
let environment, service, directory;
const admin = { id: "admin", role: "admin", active: true }, finance = { id: "finance", role: "financial_manager", active: true };
before(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-flormia-crm-finance", firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") } });
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([...[admin, finance, { id: "seller", role: "seller", active: true }, { id: "marketing", role: "marketing_manager", active: true }, { id: "analyst", role: "analyst", active: true }].map(profile => setDoc(doc(db, "users", profile.id), profile)), setDoc(doc(db, "settings", "financeConfig"), { versions: [{ version: 1, effectiveFrom: "2026-01-01", fees: { alias: { percent: 0, settlementDays: 0 } }, taxPercent: 0 }] }), setDoc(doc(db, "sales", "sale"), { status: "active", createdAt: new Date("2026-10-01T15:00:00Z"), sellerId: "admin", locationId: "local", total: 1000, paymentMethod: "alias", customerId: "customer", items: [] }), setDoc(doc(db, "orders", "order"), { total: 1000 }), setDoc(doc(db, "suppliers", "supplier"), { name: "Proveedor" }), setDoc(doc(db, "shipments", "shipment"), { name: "Envío" })]);
  });
  globalThis.__crmFinanceRulesDb = environment.authenticatedContext(finance.id).firestore();
  const bundle = await build({ stdin: { contents: 'export * from "./src/gestion/finance/financeService.js";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "emulator-db", setup(builder) {
    builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: import.meta.resolve("firebase/firestore"), external: true }));
    builder.onResolve({ filter: /(^|\/)firebase(\.js)?$/ }, () => ({ path: "db", namespace: "qa" }));
    builder.onLoad({ filter: /.*/, namespace: "qa" }, () => ({ contents: "export const db = globalThis.__crmFinanceRulesDb;" }));
  } }] });
  directory = await mkdtemp(path.join(tmpdir(), "flormia-crm-finance-rules-")); const output = path.join(directory, "service.mjs"); await writeFile(output, bundle.outputFiles[0].text); service = await import(pathToFileURL(output).href);
});
after(async () => { await environment?.cleanup(); if (directory) await rm(directory, { recursive: true, force: true }); });
test("CRM y analista leen ventas comerciales; vendedor no obtiene resumen global ni configuración bancaria", async () => {
  for (const id of ["marketing", "analyst"]) await assertSucceeds(getDocs(query(collection(environment.authenticatedContext(id).firestore(), "sales"), where("customerId", "==", "customer"), orderBy("createdAt", "desc"))));
  const seller = environment.authenticatedContext("seller").firestore(); await assertFails(getDocs(collection(seller, "sales"))); await assertFails(getDoc(doc(seller, "settings", "financeConfig"))); await assertFails(getDocs(collection(seller, "financialEntries")));
});
test("Finanzas guarda gasto idempotente y vincula referencias existentes, con auditoría permitida", async () => {
  const input = { type: "expense", name: "Logística QA", category: "Logística y envíos", nature: "variable", scope: "general", amount: 100, accruedOn: "2026-10-02", orderId: "order", supplierId: "supplier", shipmentId: "shipment" };
  await service.saveFinancialEntry(finance, input, "expense"); await service.saveFinancialEntry(finance, input, "expense");
  const db = environment.authenticatedContext(finance.id).firestore(); assert.equal((await getDoc(doc(db, "financialEntries", "expense"))).data().amount, 100); await assertSucceeds(getDoc(doc(db, "auditLogs", "finance_expense")));
  await assertFails(setDoc(doc(environment.authenticatedContext("seller").firestore(), "financialEntries", "forged"), { ...input, createdBy: "seller" }));
});
test("Finance manager conserva configuración versionada, crea y resuelve alerta en la base existente", async () => {
  await service.saveFinanceConfig(finance, { effectiveFrom: "2026-10-01", fees: { alias: { percent: 0, settlementDays: 0 } }, taxPercent: 0 });
  await service.syncFinanceAlerts(finance, { settlements: [{ id: "settlement_sale_alias", saleId: "sale", saleCode: "V1", discrepancy: true, state: "Acreditación vencida" }], budgets: [] });
  const db = environment.authenticatedContext(finance.id).firestore(); assert.equal((await getDoc(doc(db, "alerts", "finance_settlement_sale_alias"))).data().active, true);
  await service.recordSettlement(finance, { saleId: "sale", method: "alias" }, { amount: 1000, paidOn: "2026-10-02", reference: "Comprobante QA" }); assert.equal((await getDoc(doc(db, "alerts", "finance_settlement_sale_alias"))).data().status, "resolved");
});
test("Permisos CRM no conceden gastos/finanzas y Finanzas no escribe comprobantes ARCA ni pagos backend", async () => {
  const marketing = environment.authenticatedContext("marketing").firestore(), db = environment.authenticatedContext(finance.id).firestore();
  await assertFails(getDocs(collection(marketing, "financialEntries"))); await assertFails(getDoc(doc(marketing, "settings", "financeConfig")));
  await assertFails(setDoc(doc(db, "invoices", "forged"), { createdBy: finance.id })); await assertFails(setDoc(doc(db, "payments", "forged"), { createdBy: finance.id })); await assertFails(setDoc(doc(db, "orders", "forged"), { createdBy: finance.id }));
});
