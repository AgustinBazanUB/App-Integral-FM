import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { initializeTestEnvironment, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, writeBatch, serverTimestamp } from "firebase/firestore";
import { build } from "esbuild";

let environment;
let service;
let sellerService;
let temporaryDirectory;
const admin = { id: "quick-admin", role: "admin", active: true, name: "Admin QA" };
const seller = { id: "quick-seller", role: "seller", active: true, name: "Vendedor QA", allowedLocationIds: ["origin"] };
before(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-flor-mia-quick-sales", firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") } });
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await Promise.all([
      setDoc(doc(database, "users", admin.id), admin),
      setDoc(doc(database, "users", seller.id), seller),
      setDoc(doc(database, "users", "quick-finance"), { role: "financial_manager", active: true }),
      setDoc(doc(database, "warehouses", "origin"), { name: "Depósito QA", active: true }),
      setDoc(doc(database, "locations", "origin"), { name: "Local QA", active: true }),
      setDoc(doc(database, "locations", "destination"), { name: "Feria futura QA", active: false }),
      setDoc(doc(database, "products", "oil"), { name: "Aceite", active: true, defaultPrice: 2500 }),
      ...["warehouseStock", "locationStock"].map((collection) => setDoc(doc(database, collection, "origin", "items", "oil"), { productId: "oil", productName: "Aceite", currentStock: 20, active: true })),
    ]);
  });
  globalThis.__quickSalesRulesDb = environment.authenticatedContext(admin.id).firestore();
  const bundle = await build({ stdin: { contents: 'export { createAdministrativeSale, createSellerSale, updateSellerSale, cancelSellerSale } from "./src/gestion/services/sellerService.js"; export { addStockToInventory, adjustInventoryStock } from "./src/gestion/services/inventoryService.js";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "operations-rules-db", setup(builder) {
    builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: import.meta.resolve("firebase/firestore"), external: true }));
    builder.onResolve({ filter: /arcaService$/ }, () => ({ path: "fiscal", namespace: "qa" }));
    builder.onResolve({ filter: /sharedResources$/ }, () => ({ path: "shared", namespace: "qa" }));
    builder.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: "db", namespace: "qa" })); builder.onLoad({ filter: /.*/, namespace: "qa" }, ({path}) => ({ contents: path === "fiscal" ? "export async function requestPendingArcaInvoice(){throw Error(\"ARCA real prohibida\")}" : path === "shared" ? "export const listLocationsShared=async()=>[];export const loadSellerResourcesShared=async()=>({});" : "export const db = globalThis.__quickSalesRulesDb;" }));
  } }] });
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "flormia-quick-sales-rules-"));
  const output = pathToFileURL(path.join(temporaryDirectory, "service.mjs"));
  await writeFile(output, bundle.outputFiles[0].text);
  service = await import(`${output.href}?rules`);
  globalThis.__quickSalesRulesDb = environment.authenticatedContext(seller.id).firestore();
  sellerService = await import(`${output.href}?seller-rules`);
  globalThis.__quickSalesRulesDb = environment.authenticatedContext(admin.id).firestore();
});
after(async () => {
  await environment?.cleanup();
  delete globalThis.__quickSalesRulesDb;
  if (temporaryDirectory) {
    const resolved = path.resolve(temporaryDirectory);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("flormia-quick-sales-rules-")) throw new Error("Directorio temporal de prueba inesperado");
    await rm(resolved, { recursive: true, force: true });
  }
});


const input=(type,requestId)=>({profile:admin,stockOrigin:{type,id:"origin"},requestId,channel:type==="warehouse"?"whatsapp":"instagram",items:[{id:"oil",name:"Aceite",qty:2,price:2500}],paymentMethod:"multiple",paymentMethodLabel:"+2 pagos",payments:[{method:"cash",amount:2000},{method:"alias",amount:3000}],customer:{phone:"11 1234-5678",name:"Cliente QA",zoneName:"Zona QA"}});
for(const type of ["location","warehouse"]) test(`reglas: venta desde ${type}, cliente y reintento concurrente generan una sola salida`,async()=>{const args=input(type,`rules-${type}`);const [sale,retry]=await Promise.all([service.createAdministrativeSale(args),service.createAdministrativeSale(args)]);assert.equal(sale.id,retry.id);const database=globalThis.__quickSalesRulesDb;assert.equal((await getDoc(doc(database,type==="warehouse"?"warehouseStock":"locationStock","origin","items","oil"))).data().currentStock,18);const stored=(await getDoc(doc(database,"sales",sale.id))).data();assert.equal(stored.sourceChannel,args.channel);assert.equal(stored.stockOriginType,type);assert.ok(stored.customerId);assert.equal(stored.locationId,type==="warehouse"?null:"origin");});
test("reglas: Finanzas lee el ingreso desde la venta pero no fabrica ventas ni modifica datos fiscales",async()=>{const database=environment.authenticatedContext("quick-finance").firestore();const reference=doc(database,"sales","quick_quick-admin_rules-warehouse");assert.equal((await getDoc(reference)).data().total,5000);await assertFails(setDoc(reference,{fiscalInvoiceId:"fake"},{merge:true}));await assertFails(setDoc(doc(database,"sales","forged-finance"),{sellerId:"quick-finance",total:5000,status:"active",locationId:null}));});

async function seedProduct(id, stock = 0) {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "products", id), { name: id, defaultPrice: 100, active: true });
    await setDoc(doc(context.firestore(), "locationStock", "origin", "items", id), { productId: id, productName: id, currentStock: stock, active: true });
  });
}
const stockReference = (database, id) => doc(database, "locationStock", "origin", "items", id);
const sellerInput = id => ({ profile: seller, location: { id: "origin" }, items: [{ id, name: id, qty: 1, unitPrice: 100 }], paymentMethod: "cash", paymentMethodLabel: "Efectivo" });

test("reglas: vendedor vende 0 → -1 → -2 y anula dejando -1 antes de recuperar cero", async () => {
  const id = "negative-seller"; await seedProduct(id);
  const database = environment.authenticatedContext(seller.id).firestore();
  const first = await sellerService.createSellerSale(sellerInput(id));
  assert.equal((await getDoc(stockReference(database, id))).data().currentStock, -1);
  const second = await sellerService.createSellerSale(sellerInput(id));
  assert.equal((await getDoc(stockReference(database, id))).data().currentStock, -2);
  await sellerService.cancelSellerSale({ profile: seller, saleId: second.id });
  assert.equal((await getDoc(stockReference(database, id))).data().currentStock, -1);
  await sellerService.cancelSellerSale({ profile: seller, saleId: first.id });
  assert.equal((await getDoc(stockReference(database, id))).data().currentStock, 0);
});

test("reglas: Administrador y reintento conservan una sola venta desde ubicación sin stock", async () => {
  const id = "negative-admin"; await seedProduct(id, -1);
  const input = { ...sellerInput(id), profile: admin, stockOrigin: { type: "location", id: "origin" }, channel: "whatsapp", requestId: "negative-admin" };
  const [first, retry] = await Promise.all([service.createAdministrativeSale(input), service.createAdministrativeSale(input)]);
  assert.equal(first.id, retry.id);
  assert.equal((await getDoc(stockReference(globalThis.__quickSalesRulesDb, id))).data().currentStock, -2);
  assert.equal((await getDoc(doc(globalThis.__quickSalesRulesDb, "sales", first.id))).data().stockDiscrepancies[0].newStock, -2);
});

test("reglas: carrito de ocho productos sin stock confirma todos los movimientos atómicos", async () => {
  const ids = Array.from({ length: 8 }, (_, index) => `negative-many-${index}`);
  for (const id of ids) await seedProduct(id);
  const result = await sellerService.createSellerSale({ ...sellerInput(ids[0]), items: ids.map(id => ({ id, name: id, qty: 1, unitPrice: 100 })) });
  assert.equal(result.total, 800);
  const database = environment.authenticatedContext(seller.id).firestore();
  for (const id of ids) assert.equal((await getDoc(stockReference(database, id))).data().currentStock, -1);
});

test("reglas: edición recalcula faltante y respeta el bloqueo de comprobantes fiscales", async () => {
  const id = "negative-edit"; await seedProduct(id);
  const input = sellerInput(id), sale = await sellerService.createSellerSale(input);
  await sellerService.updateSellerSale({ ...input, saleId: sale.id, items: [{ id, name: id, qty: 2, unitPrice: 100 }] });
  const database = environment.authenticatedContext(seller.id).firestore();
  assert.equal((await getDoc(stockReference(database, id))).data().currentStock, -2);
  await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), "sales", sale.id), { fiscalInvoiceId: "protected-qa" }, { merge: true }));
  await assert.rejects(sellerService.cancelSellerSale({ profile: seller, saleId: sale.id }), /fiscal/);
  await assert.rejects(sellerService.updateSellerSale({ ...input, saleId: sale.id }), /fiscal/);
});

test("reglas: carga parcial y ajuste físico corrigen inventario negativo sin darle permiso al vendedor", async () => {
  const id = "negative-recovery"; await seedProduct(id, -3);
  const input = { type: "location", inventory: { id: "origin" }, product: { id, productName: id }, quantity: 1, profile: admin, requestId: "negative-recovery-add" };
  await service.addStockToInventory(input);
  assert.equal((await getDoc(stockReference(globalThis.__quickSalesRulesDb, id))).data().currentStock, -2);
  await service.adjustInventoryStock({ ...input, quantity: 4, requestId: "negative-recovery-adjust" });
  assert.equal((await getDoc(stockReference(globalThis.__quickSalesRulesDb, id))).data().currentStock, 4);
  await assert.rejects(sellerService.adjustInventoryStock({ ...input, profile: seller }), /permiso/);
});

test("reglas: saldo negativo aislado, movimiento huérfano y cantidad falsa no se aceptan", async () => {
  const id = "negative-forged"; await seedProduct(id);
  const database = environment.authenticatedContext(seller.id).firestore(), stock = stockReference(database, id);
  await assertFails(setDoc(stock, { currentStock: -1, updatedAt: serverTimestamp() }, { merge: true }));
  const sale = doc(database, "sales", "forged-negative-sale"), movement = doc(database, "stockMovements", "forged-negative-movement");
  const movementData = { locationId: "origin", productId: id, type: "sale", qty: -2, previousStock: 0, newStock: -2, userId: seller.id, saleId: sale.id, previousSaleItemIndex: -1, saleItemIndex: 0, createdAt: serverTimestamp() };
  await assertFails(setDoc(movement, movementData));
  const batch = writeBatch(database);
  batch.set(sale, { ...sellerInput(id), sellerId: seller.id, locationId: "origin", status: "active", total: 100, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), items: [{ productId: id, qty: 1, unitPrice: 100 }] });
  batch.set(movement, movementData);
  batch.update(stock, { currentStock: -2, lastSaleId: sale.id, lastMovementId: movement.id, updatedAt: serverTimestamp() });
  await assertFails(batch.commit());
  const inspection = environment.authenticatedContext(admin.id).firestore();
  assert.equal((await getDoc(stockReference(inspection, id))).data().currentStock, 0);
  assert.equal((await getDoc(doc(inspection, "sales", sale.id))).exists(), false);
});
