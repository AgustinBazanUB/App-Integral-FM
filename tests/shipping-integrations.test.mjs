import test from "node:test";
import assert from "node:assert/strict";
import { shippingAdapters, createShippingGeocoder } from "../src/shared/shippingIntegrations.mjs";
test("future shipping connectors stay disabled; geocoder never invents a location or confirmation", async () => {
  for (const adapter of Object.values(shippingAdapters)) {
    assert.equal(adapter.enabled, false);
    await assert.rejects(Object.values(adapter).find(value => typeof value === "function")(), { code: "shipping/integration-disabled" });
  }
  assert.deepEqual((await createShippingGeocoder().search("Calle de prueba 123")).candidates, []);
  const result = await createShippingGeocoder({ search: async () => [{ lat: 200, lng: 0 }, { lat: -34.6, lng: -58.4, verified: true }] }).search("Dirección de prueba");
  assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].verified, false);
});
