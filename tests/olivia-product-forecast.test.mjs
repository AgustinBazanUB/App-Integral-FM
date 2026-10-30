import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/olivia-fixture.mjs";
import { runTool } from "../netlify/functions/_lib/olivia/tools.mjs";

test("product forecast uses the requested presentation, calendar days and recorded active sales", async () => {
  const f = fixture({ role: "admin" });
  for (const [path] of f.documents) if (path.startsWith("sales/")) f.documents.delete(path);
  for (const [id, status, units] of [["a", "active", 30], ["b", "cancelled", 99]]) f.documents.set(`sales/${id}`, { id, createdAt: new Date("2026-09-15T15:00:00Z"), status, locationId: "local_a", total: 3000, items: [{ productId: "oil", name: "Arbosana 500 ml", qty: units, unitPrice: 100, subtotal: units * 100 }, { productId: "other", name: "Otra variedad", qty: 99, unitPrice: 10, subtotal: 990 }] });
  const args = { productId: "oil", locationId: null, startDate: "2026-09-01", endDate: "2026-09-30", forecastDays: 20 };
  const result = await runTool({ session: f.session, name: "forecast_product_demand", args, store: f.store, context: {}, now: f.clock() });
  assert.equal(result.data.historicalUnits, 30);
  assert.equal(result.data.baseCalendarDays, 30);
  assert.deepEqual(result.data.scenarios, { conservative: 16, central: 20, optimistic: 24 });
  assert.equal(result.data.partial, false);
  assert.match(result.data.scenarioBasis, /no es un intervalo/);
  const seller = fixture();
  await assert.rejects(runTool({ session: seller.session, name: "forecast_product_demand", args, store: seller.store }), { code: "permission-denied" });
});
test("no sales means insufficient forecasting evidence; future reference periods are rejected", async () => {
  const f = fixture({ role: "admin" });
  const args = { productId: "oil", locationId: "local_b", startDate: "2026-09-01", endDate: "2026-09-30", forecastDays: 30 };
  const result = await runTool({ session: f.session, name: "forecast_product_demand", args, store: f.store, now: f.clock() });
  assert.equal(result.data.scenarios, null);
  assert.equal(result.data.evidence, "insufficient");
  await assert.rejects(runTool({ session: f.session, name: "forecast_product_demand", args: { ...args, endDate: "2030-01-01" }, store: f.store, now: f.clock() }), { code: "invalid-period" });
});
