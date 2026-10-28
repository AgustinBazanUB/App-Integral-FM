import test from "node:test";
import assert from "node:assert/strict";
import { shippingFeed, markShippingNotificationRead } from "../netlify/functions/_lib/shippingFeed.mjs";
import { admin, seller, preparer, session, memoryStore } from "./helpers/shippingFixtures.mjs";
const rows = [
  { id: "own", shippingSchemaVersion: 1, createdBy: seller.id, assignedPreparerIds: [preparer.id], updatedAt: "2026-10-16T15:00:00Z" },
  { id: "other", shippingSchemaVersion: 1, createdBy: "other", assignedPreparerIds: [], updatedAt: "2026-10-16T16:00:00Z" },
  { id: "legacy", createdBy: seller.id, updatedAt: "2026-10-16T17:00:00Z" },
];
test("authenticated fallback scopes board, assigned preparations and administrator reads", async () => {
  const queryRows = async () => rows;
  assert.deepEqual((await shippingFeed({ session: session(seller), queryRows })).map(row => row.id), ["own"]);
  assert.deepEqual((await shippingFeed({ session: session(preparer), assigned: true, queryRows })).map(row => row.id), ["own"]);
  assert.deepEqual((await shippingFeed({ session: session(admin), queryRows })).map(row => row.id), ["other", "own"]);
  let queried = false;
  await assert.rejects(shippingFeed({ session: null, queryRows: async () => { queried = true; } }), /permiso/);
  await assert.rejects(shippingFeed({ session: { uid: "other", profile: seller }, queryRows }), /permiso/);
  await assert.rejects(shippingFeed({ session: session({ ...seller, active: false }), queryRows }), /permiso/);
  assert.equal(queried, false);
});
test("notification fallback only exposes the current recipient's active shipping notices", async () => {
  const queryRows = async () => [
    { id: "mine", source: "shipping", responsibleId: seller.id, active: true },
    { id: "other", source: "shipping", responsibleId: admin.id, active: true },
    { id: "closed", source: "shipping", responsibleId: seller.id, active: false },
    { id: "finance", source: "finance", responsibleId: seller.id, active: true },
  ];
  assert.deepEqual((await shippingFeed({ session: session(seller), kind: "notifications", queryRows })).map(row => row.id), ["mine"]);
});
test("notification acknowledgement rechecks active profile and ownership in its transaction", async () => {
  const store = memoryStore();
  store.documents.set("alerts/notice", { source: "shipping", responsibleId: seller.id, read: false });
  const input = { alertId: "notice", runTransaction: store.runTransaction };
  await assert.rejects(markShippingNotificationRead({ ...input, session: session(admin) }), /permiso/);
  await markShippingNotificationRead({ ...input, session: session(seller) });
  assert.equal(store.documents.get("alerts/notice").read, true);
  store.documents.get("users/seller").active = false;
  await assert.rejects(markShippingNotificationRead({ ...input, session: session(seller) }), /permiso/);
});
