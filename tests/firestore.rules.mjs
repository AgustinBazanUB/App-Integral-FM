import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from "firebase/firestore";

let environment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: "demo-flor-mia-integral",
    firestore: {
      rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
    },
  });
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await Promise.all([
      setDoc(doc(database, "users", "admin-1"), {
        name: "Administrador",
        role: "admin",
        active: true,
      }),
      setDoc(doc(database, "users", "seller-1"), {
        name: "Vendedor",
        role: "seller",
        active: true,
        allowedLocationIds: ["loc-1"],
      }),
      setDoc(doc(database, "users", "manager-1"), {
        name: "Encargado",
        role: "location_manager",
        active: true,
        allowedLocationIds: ["loc-1"],
      }),
      setDoc(doc(database, "locations", "loc-1"), {
        name: "Ubicación autorizada",
        active: true,
        deleted: false,
      }),
      setDoc(doc(database, "locations", "loc-2"), {
        name: "Ubicación ajena",
        active: true,
        deleted: false,
      }),
      setDoc(doc(database, "locationStock", "loc-1", "items", "product-1"), {
        productId: "product-1",
        productName: "Producto",
        currentStock: 5,
        active: true,
        deleted: false,
      }),
      setDoc(doc(database, "locationStock", "loc-2", "items", "product-1"), {
        productId: "product-1",
        productName: "Producto ajeno",
        currentStock: 8,
        active: true,
        deleted: false,
      }),
      setDoc(doc(database, "auditLogs", "audit-1"), {
        action: "stock.add",
        userId: "admin-1",
        locationId: "loc-1",
        createdAt: new Date(),
      }),
      setDoc(doc(database, "auditLogs", "audit-2"), {
        action: "stock.add",
        userId: "admin-1",
        locationId: "loc-2",
        createdAt: new Date(),
      }),
      setDoc(doc(database, "financialEntries", "entry-1"), {
        name: "Entrada protegida",
        createdBy: "admin-1",
      }),
    ]);
  });
});

after(async () => {
  await environment?.cleanup();
});

test("el vendedor sólo puede leer ubicaciones asignadas", async () => {
  const database = environment.authenticatedContext("seller-1").firestore();
  await assertSucceeds(getDoc(doc(database, "locations", "loc-1")));
  await assertFails(getDoc(doc(database, "locations", "loc-2")));
});

test("el vendedor no puede crear ubicaciones", async () => {
  const database = environment.authenticatedContext("seller-1").firestore();
  await assertFails(
    setDoc(doc(database, "locations", "loc-3"), {
      name: "No permitida",
      active: true,
    }),
  );
});

test("finanzas queda restringido al rol autorizado", async () => {
  const adminDb = environment.authenticatedContext("admin-1").firestore();
  const sellerDb = environment.authenticatedContext("seller-1").firestore();
  await assertSucceeds(getDoc(doc(adminDb, "financialEntries", "entry-1")));
  await assertFails(getDoc(doc(sellerDb, "financialEntries", "entry-1")));
});

test("el vendedor no puede ajustar stock fuera de una venta válida", async () => {
  const database = environment.authenticatedContext("seller-1").firestore();
  const stockRef = doc(database, "locationStock", "loc-1", "items", "product-1");
  await assertFails(updateDoc(stockRef, { currentStock: -1, updatedAt: new Date() }));
  await assertFails(updateDoc(stockRef, { currentStock: 4, updatedAt: new Date() }));
  const snapshot = await getDoc(stockRef);
  assert.equal(snapshot.data().currentStock, 5);
});

test("el vendedor no puede leer stock ni actividad de otra ubicación", async () => {
  const database = environment.authenticatedContext("seller-1").firestore();
  await assertSucceeds(getDoc(doc(database, "locationStock", "loc-1", "items", "product-1")));
  await assertFails(getDoc(doc(database, "locationStock", "loc-2", "items", "product-1")));
  await assertSucceeds(getDoc(doc(database, "auditLogs", "audit-1")));
  await assertFails(getDoc(doc(database, "auditLogs", "audit-2")));
});

test("un encargado puede cargar stock pero no asignar vendedores ni descuentos", async () => {
  const database = environment.authenticatedContext("manager-1").firestore();
  await assertSucceeds(setDoc(doc(database, "locationStock", "loc-1", "items", "product-2"), {
    productId: "product-2",
    productName: "Producto nuevo",
    currentStock: 3,
    initialStock: 3,
    active: true,
    deleted: false,
    updatedAt: new Date(),
  }));
  await assertFails(updateDoc(doc(database, "locations", "loc-1"), { assignedSellerIds: ["seller-1"], updatedAt: new Date() }));
  await assertFails(updateDoc(doc(database, "locations", "loc-1"), { enabledDiscountIds: ["discount-1"], updatedAt: new Date() }));
});
