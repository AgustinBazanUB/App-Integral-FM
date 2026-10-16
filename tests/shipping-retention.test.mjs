import test from "node:test";
import assert from "node:assert/strict";
import { clearExpiredShippingPositions } from "../netlify/functions/_lib/shippingRetention.mjs";
import { memoryStore, now } from "./helpers/shippingFixtures.mjs";
test("retention removes expired points but preserves a concurrent fresh update and all stock/history", async () => {
  const store = memoryStore();
  store.documents.set("shipments/old", { status: "reparto_final", lastPosition: { lat: -34, lng: -58, expiresAt: new Date(now.valueOf() - 1000) } });
  store.documents.set("shipments/new", { status: "reparto_final", lastPosition: { lat: -34, lng: -58, expiresAt: new Date(now.valueOf() + 1000) } });
  store.documents.set("shipments/old/events/created", { immutable: true });
  const result = await clearExpiredShippingPositions({ now, runTransaction: store.runTransaction, queryPositions: async () => ["shipments/old", "shipments/new"] });
  assert.equal(result.cleared, 1); assert.equal(store.documents.get("shipments/old").lastPosition, null);
  assert(store.documents.get("shipments/new").lastPosition);
  assert.equal(store.documents.get("locationStock/valle/items/oil").currentStock, 10);
  assert.equal(store.documents.get("shipments/old/events/created").immutable, true);
});
