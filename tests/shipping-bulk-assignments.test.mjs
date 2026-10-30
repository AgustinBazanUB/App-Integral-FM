import test from "node:test";
import assert from "node:assert/strict";
import { assignPreparersToShipments } from "../src/gestion/shipping/bulkAssignments.mjs";
test("three assignments use distinct stable request ids and report individual errors", async () => {
  const calls = [];
  const result = await assignPreparersToShipments(["a", "b", "c"], { a: "1", b: "2", c: "3" }, "active", "Cambio de turno", async request => {
    calls.push(request); if (request.shipmentId === "b") throw new Error("Estado incompatible");
  });
  assert.deepEqual(result.successes, ["a", "c"]);
  assert.deepEqual(result.failures, [{ id: "b", message: "Estado incompatible" }]);
  assert.deepEqual(calls.map(call => call.requestId), ["1", "2", "3"]);
  assert.ok(calls.every(call => call.assignedPreparerIds[0] === "active"));
});
