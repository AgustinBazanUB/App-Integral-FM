import test, { before, after } from "node:test";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, deleteDoc, deleteField, getDoc } from "firebase/firestore";
let environment;
before(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-fiscal-recovery", firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") } });
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const role of ["admin", "seller"]) await setDoc(doc(db, "users", role), { role, active: true, allowedLocationIds: ["loc1"] });
    await setDoc(doc(db, "locations", "loc1"), { active: true, deleted: false });
    for (const sourceType of ["admin_quick_sale", "seller_sale", "ecommerce"]) {
      const sale = { sellerId: "seller", locationId: "loc1", status: "active", sourceType, total: 1210, items: [{ productId: "p", qty: 1 }], fiscalInvoiceId: `invoice_homologation_${sourceType}_mirror`, fiscalInvoice: { status: "authorized", cae: "12345678901234" } };
      await setDoc(doc(db, "sales", sourceType), sale);
      await setDoc(doc(db, "sales", `stale_${sourceType}`), { sellerId: "seller", locationId: "loc1", status: "active", sourceType, total: 1210 });
      await setDoc(doc(db, "invoices", `invoice_homologation_${sourceType}_stale_${sourceType}`), { sourceType, sourceId: `stale_${sourceType}`, status: "pending" });
    }
    await setDoc(doc(db, "sales", "unbilled"), { sellerId: "seller", locationId: "loc1", status: "active", total: 1210 });
    await setDoc(doc(db, "sales", "backend_fiscal_fields"), { sellerId: "seller", locationId: "loc1", status: "active", total: 1210, pointOfSale: 3, verificationMatched: true });
    await setDoc(doc(db, "invoices", "invoice1"), { status: "authorized", authorization: { cae: "12345678901234", voucherNumber: 8 } });
    await setDoc(doc(db, "arcaWsaaTickets", "ticket1"), { encryptedTicket: "fake", lease: { holder: "backend" } });
    await setDoc(doc(db, "arcaSequenceLocks", "lock1"), { holder: "backend", reservation: { invoiceId: "invoice1" } });
  });
});
after(async () => environment?.cleanup());
for (const role of ["admin", "seller"]) {
  for (const collection of ["invoices", "arcaWsaaTickets", "arcaSequenceLocks"]) {
    const id = collection === "invoices" ? "invoice1" : collection === "arcaWsaaTickets" ? "ticket1" : "lock1";
    test(`${role}: ${collection} create/update/nested/deleteField/delete bloqueados`, async () => {
      const db = environment.authenticatedContext(role).firestore();
      await assertFails(setDoc(doc(db, collection, `new_${role}`), { status: "authorized" }));
      const ref = doc(db, collection, id);
      await assertFails(updateDoc(ref, { status: "pending" }));
      await assertFails(updateDoc(ref, { "authorization.cae": "99999999999999", "reservation.invoiceId": "other" }));
      await assertFails(updateDoc(ref, { authorization: deleteField(), holder: deleteField() }));
      await assertFails(deleteDoc(ref));
    });
  }
  for (const source of ["admin_quick_sale", "seller_sale", "ecommerce"]) {
    test(`${role}: espejo ${source} update/nested/deleteField/delete bloqueados`, async () => {
      const db = environment.authenticatedContext(role).firestore(); const ref = doc(db, "sales", source);
      await assertFails(updateDoc(ref, { invoiceStatus: "authorized" }));
      await assertFails(updateDoc(ref, { "fiscalInvoice.cae": "99999999999999" }));
      await assertFails(updateDoc(ref, { fiscalInvoiceId: deleteField(), fiscalInvoice: deleteField() }));
      await assertFails(updateDoc(ref, { total: 10, status: "cancelled" }));
      await assertFails(deleteDoc(ref));
    });
    test(`${role}: ${source} sin mirror pero invoice determinística es inmutable`, async () => {
      await assertFails(updateDoc(doc(environment.authenticatedContext(role).firestore(), "sales", `stale_${source}`), { total: 10 }));
    });
  }
  test(`${role}: no puede crear mirror ni autorización en venta nueva`, async () => {
    await assertFails(setDoc(doc(environment.authenticatedContext(role).firestore(), "sales", `new_${role}`), { sellerId: role, locationId: "loc1", status: "active", fiscalInvoice: { status: "authorized" } }));
  });
  test(`${role}: venta sin factura no permite introducir/eliminar campos fiscales`, async () => {
    const ref = doc(environment.authenticatedContext(role).firestore(), "sales", "unbilled");
    await assertFails(updateDoc(ref, { fiscalInvoiceId: "invoice1" }));
    await assertFails(updateDoc(ref, { invoiceStatus: "authorized" }));
    await assertFails(updateDoc(ref, { "authorization.cae": "12345678901234" }));
    for (const field of ["pointOfSale", "verificationMatched"]) {
      const value = field === "pointOfSale" ? 999 : true;
      await assertFails(updateDoc(ref, { [field]: value }));
      await assertFails(updateDoc(ref, { [`${field}.forged`]: value }));
      await assertFails(setDoc(doc(ref.firestore, "sales", `forged_${role}_${field}`), {
        sellerId: role, locationId: "loc1", status: "active", [field]: value,
      }));
      await assertFails(updateDoc(doc(ref.firestore, "sales", "backend_fiscal_fields"), { [field]: deleteField() }));
    }
  });
  test(`${role}: no puede leer WSAA ni locks`, async () => {
    const db = environment.authenticatedContext(role).firestore();
    await assertFails(getDoc(doc(db, "arcaWsaaTickets", "ticket1")));
    await assertFails(getDoc(doc(db, "arcaSequenceLocks", "lock1")));
  });
}
test("admin conserva edición comercial de venta sin invoice", async () => {
  await assertSucceeds(updateDoc(doc(environment.authenticatedContext("admin").firestore(), "sales", "unbilled"), { total: 1220 }));
});

test("seller conserve edición comercial cuando no existe invoice ni mirror", async () => {
  await assertSucceeds(updateDoc(doc(environment.authenticatedContext("seller").firestore(), "sales", "unbilled"), { total: 1230 }));
});
