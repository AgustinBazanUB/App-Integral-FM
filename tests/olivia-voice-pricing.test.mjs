import test from "node:test";
import assert from "node:assert/strict";
import { formatOliviaCost } from "../src/shared/oliviaCostFormat.mjs";

test("generic Olivia cost formatting handles pesos, dollars, tiny amounts and missing measurements", () => {
  assert.equal(formatOliviaCost(null), "Sin medición");
  assert.equal(formatOliviaCost(0.02), "< $0,1");
  assert.match(formatOliviaCost(123.456), /123,5/);
  assert.match(formatOliviaCost(0.012345, "USD"), /0,0123/);
});