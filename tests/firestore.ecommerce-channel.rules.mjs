import test, { before, after } from "node:test";
import { readFile } from "node:fs/promises";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, getDoc } from "firebase/firestore";
let environment;
before(async () => {
  environment = await initializeTestEnvironment({
    projectId: "demo-ecommerce-channel-integral",
    firestore: {
      rules: await readFile(
        new URL("../firestore.rules", import.meta.url),
        "utf8",
      ),
    },
  });
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users/admin"), {
      role: "admin",
      active: true,
      name: "Admin QA",
    });
    await setDoc(doc(db, "users/seller"), {
      role: "seller",
      active: true,
      name: "Seller QA",
      allowedLocationIds: ["qa"],
    });
    for (const path of [
      "locationStock/qa/items/oil",
      "warehouseStock/qa/items/oil",
    ])
      await setDoc(doc(db, path), {
        productId: "oil",
        currentStock: 5,
        reservedQuantity: 3,
        ecommerceReservations: {
          qa: { quantity: 3, expiresAt: new Date(Date.now() + 60000) },
        },
        active: true,
      });
    await setDoc(doc(db, "channels/ecommerce"), { active: true });
    await setDoc(doc(db, "orders/private"), {
      sourceType: "ecommerce",
      accessHash: "private",
    });
  });
});
after(async () => environment?.cleanup());
for (const role of ["admin", "seller"])
  for (const path of [
    "locationStock/qa/items/oil",
    "warehouseStock/qa/items/oil",
  ]) {
    test(`reservas Rules: ${role} no altera el ledger ${path}`, async () =>
      assertFails(
        updateDoc(
          doc(environment.authenticatedContext(role).firestore(), path),
          { ecommerceReservations: {}, reservedQuantity: 0 },
        ),
      ));
    test(`reservas Rules: ${role} no consume unidades reservadas ${path}`, async () =>
      assertFails(
        updateDoc(
          doc(environment.authenticatedContext(role).firestore(), path),
          { currentStock: 2 },
        ),
      ));
  }
for (const role of ["admin", "seller"])
  for (const collection of [
    "channels",
    "ecommerceOperations",
    "ecommerceRateLimits",
  ])
    test(`web Rules: ${role} no escribe ${collection}`, async () =>
      assertFails(
        setDoc(
          doc(
            environment.authenticatedContext(role).firestore(),
            `${collection}/forged`,
          ),
          { active: true },
        ),
      ));
test("web Rules: anónimo no lee configuración ni datos de pedido", async () => {
  const db = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "channels/ecommerce")));
  await assertFails(getDoc(doc(db, "orders/private")));
});
test("web Rules: administrador puede consultar canal", async () =>
  assertSucceeds(
    getDoc(
      doc(
        environment.authenticatedContext("admin").firestore(),
        "channels/ecommerce",
      ),
    ),
  ));
