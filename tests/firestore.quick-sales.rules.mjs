import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { initializeTestEnvironment, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { build } from "esbuild";

let environment;
let service;
let temporaryDirectory;
const admin = { id: "quick-admin", role: "admin", active: true, name: "Admin QA" };
before(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-flor-mia-quick-sales", firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") } });
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await Promise.all([
      setDoc(doc(database, "users", admin.id), admin),
      setDoc(doc(database, "users", "quick-finance"), { role: "financial_manager", active: true }),
      setDoc(doc(database, "warehouses", "origin"), { name: "Depósito QA", active: true }),
      setDoc(doc(database, "locations", "origin"), { name: "Local QA", active: true }),
      setDoc(doc(database, "locations", "destination"), { name: "Feria futura QA", active: false }),
      setDoc(doc(database, "products", "oil"), { name: "Aceite", active: true, defaultPrice: 2500 }),
      ...["warehouseStock", "locationStock"].map((collection) => setDoc(doc(database, collection, "origin", "items", "oil"), { productId: "oil", productName: "Aceite", currentStock: 20, active: true })),
    ]);
  });
  globalThis.__quickSalesRulesDb = environment.authenticatedContext(admin.id).firestore();
  const bundle = await build({ stdin: { contents: 'export { createAdministrativeSale, createSellerSale } from "./src/gestion/services/sellerService.js";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "operations-rules-db", setup(builder) {
    builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: import.meta.resolve("firebase/firestore"), external: true }));
    builder.onResolve({ filter: /arcaService$/ }, () => ({ path: "fiscal", namespace: "qa" }));
    builder.onResolve({ filter: /sharedResources$/ }, () => ({ path: "shared", namespace: "qa" }));
    builder.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: "db", namespace: "qa" })); builder.onLoad({ filter: /.*/, namespace: "qa" }, ({path}) => ({ contents: path === "fiscal" ? "export async function requestPendingArcaInvoice(){throw Error(\"ARCA real prohibida\")}" : path === "shared" ? "export const listLocationsShared=async()=>[];export const loadSellerResourcesShared=async()=>({});" : "export const db = globalThis.__quickSalesRulesDb;" }));
  } }] });
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "flormia-quick-sales-rules-"));
  const output = pathToFileURL(path.join(temporaryDirectory, "service.mjs"));
  await writeFile(output, bundle.outputFiles[0].text);
  service = await import(`${output.href}?rules`);
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
