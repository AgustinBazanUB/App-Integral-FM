import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { initializeTestEnvironment, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { build } from "esbuild";

let environment;
let service;
let temporaryDirectory;
const admin = { id: "ops-admin", role: "admin", active: true, name: "Admin QA" };
before(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-flor-mia-operations", firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") } });
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await Promise.all([
      setDoc(doc(database, "users", admin.id), admin),
      setDoc(doc(database, "users", "ops-manager"), { role: "warehouse_manager", active: true }),
      setDoc(doc(database, "warehouses", "origin"), { name: "Depósito QA", active: true }),
      setDoc(doc(database, "locations", "origin"), { name: "Local QA", active: true }),
      setDoc(doc(database, "locations", "destination"), { name: "Feria futura QA", active: false }),
      setDoc(doc(database, "products", "oil"), { name: "Aceite", active: true, defaultPrice: 2500 }),
      ...["warehouseStock", "locationStock"].map((collection) => setDoc(doc(database, collection, "origin", "items", "oil"), { productId: "oil", productName: "Aceite", currentStock: 20, active: true })),
    ]);
  });
  globalThis.__operationsRulesDb = environment.authenticatedContext(admin.id).firestore();
  const bundle = await build({ stdin: { contents: 'export * from "./src/gestion/services/inventoryService.js"; export * from "./src/gestion/services/locationManagementService.js";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "operations-rules-db", setup(builder) {
    builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: import.meta.resolve("firebase/firestore"), external: true }));
    builder.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: "db", namespace: "qa" })); builder.onLoad({ filter: /.*/, namespace: "qa" }, () => ({ contents: "export const db = globalThis.__operationsRulesDb;" }));
  } }] });
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "flormia-operations-rules-"));
  const output = pathToFileURL(path.join(temporaryDirectory, "service.mjs"));
  await writeFile(output, bundle.outputFiles[0].text);
  service = await import(`${output.href}?rules`);
});
after(async () => {
  await environment?.cleanup();
  delete globalThis.__operationsRulesDb;
  if (temporaryDirectory) {
    const resolved = path.resolve(temporaryDirectory);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("flormia-operations-rules-")) throw new Error("Directorio temporal de prueba inesperado");
    await rm(resolved, { recursive: true, force: true });
  }
});

test("reglas: transacción real de transferencia y recepción parcial en ubicación inactiva", async () => {
  const result = await service.transferStock({ origin: { type: "warehouse", id: "origin" }, destination: { type: "location", id: "destination" }, lines: [{ productId: "oil", quantity: 20, preparedQuantity: 19, receivedQuantity: 18 }], profile: admin, transferId: "rules-transfer" });
  assert.equal(result.receivedQuantity, 18);
});

test("reglas: ajuste autorizado y calendario operativo guardan sus registros de auditoría", async () => {
  await service.adjustInventoryStock({ type: "location", inventory: { id: "origin" }, product: { productId: "oil", productName: "Aceite" }, quantity: 19, profile: admin, requestId: "rules-adjust" });
  const id = await service.saveManagedLocation({ name: "Evento QA", type: "event", codePrefix: "EQA", dniMode: "optional", requestId: "rules-location", operatingCalendar: { weekdays: [6], openingTime: "10:00", closingTime: "18:00" } }, admin);
  assert.equal(id, "rules-location");
});

test("reglas: un encargado de depósito sin permiso de ajuste no puede fabricar movimientos ni operaciones de ajuste", async () => {
  const database = environment.authenticatedContext("ops-manager").firestore();
  await assertFails(setDoc(doc(database, "stockMovements", "unauthorized-adjustment"), { userId: "ops-manager", inventoryType: "warehouse", warehouseId: "origin", productId: "oil", type: "adjustment", previousStock: 20, newStock: 19, qty: -1, saleId: "" }));
  await assertFails(setDoc(doc(database, "inventoryOperations", "unauthorized-adjustment"), { userId: "ops-manager", inventoryType: "warehouse", inventoryId: "origin", operationType: "adjust_stock" }));
});
