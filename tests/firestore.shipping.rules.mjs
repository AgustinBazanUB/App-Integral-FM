import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, getDocs, collection, query, where, runTransaction } from "firebase/firestore";
import { createShippingSale, shippingOperation } from "../netlify/functions/_lib/shipping.mjs";
import { initialDocuments, admin, seller, preparer, manager, session, sale, now } from "./helpers/shippingFixtures.mjs";
let environment, database;
const userDb = uid => environment.authenticatedContext(uid).firestore();
const adapter = work => runTransaction(database, transaction => work({
  getDocument: async path => { const row = await transaction.get(doc(database, path)); return row.exists() ? { data: row.data() } : null; },
  listDocuments: async path => { const snapshot = await getDocs(collection(database, path)); return snapshot.docs.map(row => ({ ...row.data(), id: row.id })); },
  commitDocuments: async operations => { for (const operation of operations) { const ref = doc(database, operation.path); if (operation.type === "create") transaction.set(ref, operation.data); else transaction.update(ref, operation.data); } },
}));
before(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-flor-mia-shipping", firestore: { host: "127.0.0.1", port: 8080, rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") } });
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    database = context.firestore();
    for (const [path, data] of initialDocuments()) await setDoc(doc(database, path), data);
    await setDoc(doc(database, "users/stranger"), { role: "seller", active: true });
    await setDoc(doc(database, "shipments/protected"), { createdBy: seller.id, assignedPreparerIds: [preparer.id], stockCommitState: "pending", status: "solicitud_pendiente" });
    await setDoc(doc(database, "shipments/protected/events/start"), { action: "created" });
    await setDoc(doc(database, "shipmentAccess/hash"), { secret: "hash-only" });
    await setDoc(doc(database, "deliverySessions/route"), { shipmentIds: ["protected"], status: "active", lastPosition: { lat: -34.6, lng: -58.4 } });
    await setDoc(doc(database, "deliverySessionAccess/hash"), { sessionId: "route", kind: "courier_route" });
    await setDoc(doc(database, "sales/protected"), { sourceType: "seller_sale", sellerId: seller.id, locationId: "valle", shipmentId: "protected", status: "active" });
    await setDoc(doc(database, "alerts/shipping-protected"), { source: "shipping", moduleId: "shipping", active: true, responsibleId: preparer.id, read: false, title: "Preparar" });
  });
});
after(async () => environment?.cleanup());
test("shipping rules deny every direct browser shipment write, including administrators", async () => {
  for (const uid of [admin.id, seller.id, manager.id, preparer.id]) {
    await assertFails(setDoc(doc(userDb(uid), "shipments/manual"), { createdBy: uid, assignedPreparerIds: [] }));
    await assertFails(updateDoc(doc(userDb(uid), "shipments/protected"), { status: "entregado" }));
    await assertFails(setDoc(doc(userDb(uid), "shipments/protected/events/fake"), { action: "approved" }));
    await assertFails(getDoc(doc(userDb(uid), "shipmentAccess/hash")));
  }
});
test("shared courier sessions are readable only by authenticated shipping managers and never writable from browsers", async () => {
  await assertSucceeds(getDoc(doc(userDb(admin.id), "deliverySessions/route")));
  await assertSucceeds(getDoc(doc(userDb(manager.id), "deliverySessions/route")));
  await assertFails(getDoc(doc(userDb(seller.id), "deliverySessions/route")));
  await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), "deliverySessions/route")));
  await assertFails(updateDoc(doc(userDb(admin.id), "deliverySessions/route"), { status: "completed" }));
  for (const uid of [admin.id, seller.id, manager.id]) {
    await assertFails(getDoc(doc(userDb(uid), "deliverySessionAccess/hash")));
    await assertFails(setDoc(doc(userDb(uid), "deliverySessionAccess/fake"), { sessionId: "route" }));
  }
});
test("shipping read scopes: manager, creator and assigned staff only; QR/anonymous cannot read", async () => {
  for (const uid of [admin.id, seller.id, preparer.id, manager.id]) await assertSucceeds(getDoc(doc(userDb(uid), "shipments/protected")));
  await assertFails(getDoc(doc(userDb("stranger"), "shipments/protected")));
  await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), "shipments/protected")));
  await assertSucceeds(getDocs(query(collection(userDb(preparer.id), "shipments"), where("assignedPreparerIds", "array-contains", preparer.id))));
  await assertSucceeds(getDoc(doc(userDb(preparer.id), "shipments/protected/events/start")));
});
test("shipping sales cannot be fabricated or edited by browser, including admin", async () => {
  for (const uid of [admin.id, seller.id]) {
    await assertFails(setDoc(doc(userDb(uid), "sales/fabricated"), { sellerId: uid, shipmentId: "fake", deliveryMethod: "shipping" }));
    await assertFails(updateDoc(doc(userDb(uid), "sales/protected"), { status: "cancelled" }));
    await assertFails(updateDoc(doc(userDb(uid), "sales/protected"), { shipmentId: null }));
  }
});
test("notifications persist recipient-only read state; forged incidents and edits denied", async () => {
  const ref = doc(userDb(preparer.id), "alerts/shipping-protected");
  await assertSucceeds(getDoc(ref)); await assertSucceeds(updateDoc(ref, { read: true }));
  await assertFails(updateDoc(ref, { severity: "critical" }));
  await assertFails(updateDoc(doc(userDb(seller.id), "alerts/shipping-protected"), { read: true }));
  await assertFails(setDoc(doc(userDb(admin.id), "alerts/forged"), { source: "shipping", createdBy: admin.id }));
});
test("emulator integration: concurrent sale retries and stock approval commit exactly once", async () => {
  await environment.withSecurityRulesDisabled(async context => {
    database = context.firestore();
    const args = { sale: sale(), session: session(seller), requestId: "concurrent", now, runTransaction: adapter };
    const results = await Promise.all([createShippingSale(args), createShippingSale(args)]);
    assert.equal(results[0].id, results[1].id);
    assert.equal((await getDoc(doc(database, "locationStock/valle/items/oil"))).data().currentStock, 10);
    const body = { mode: "approve", shipmentId: results[0].shipmentId, requestId: "approve-once", originType: "warehouse", originId: "infal", assignedPreparerIds: [preparer.id], deliveryType: "manual" };
    await Promise.all([shippingOperation({ body, session: session(admin), runTransaction: adapter, now }), shippingOperation({ body, session: session(admin), runTransaction: adapter, now })]);
    const stock = (await getDoc(doc(database, "warehouseStock/infal/items/oil"))).data();
    assert.equal(stock.currentStock, 18);
    assert.equal((await getDoc(doc(database, "sales", results[0].id))).data().locationId, "valle");
  });
});
