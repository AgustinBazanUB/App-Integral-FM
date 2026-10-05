import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/olivia-fixture.mjs";
import { salesMetrics } from "../netlify/functions/_lib/olivia/analytics.mjs";
import { calculateMetrics, buildMetricsDateRange } from "../src/modules/locations/domain/metrics.js";

test("Olivia yesterday metrics match the panel across Argentina day boundaries and commercial states", async () => {
  const f = fixture({ role: "admin" });
  for (const [path] of f.documents) if (path.startsWith("sales/")) f.documents.delete(path);
  const make = (id, createdAt, total, status = "active") => ({ id, createdAt: new Date(createdAt), total, status, locationId: "local_a", locationName: "Local A", sellerId: "user_a", sellerName: "Ana", paymentMethod: "cash", items: [{ productId: "oil", name: "Aceite", qty: 2, unitPrice: 600, subtotal: 1200 }] });
  const rows = [
    make("first", "2026-10-03T03:00:00Z", 1500),
    make("last", "2026-10-04T02:59:59Z", 2500),
    make("pending", "2026-10-03T18:00:00Z", 1000, "pending"),
    make("cancelled", "2026-10-03T19:00:00Z", 7000, "cancelled"),
    make("tomorrow", "2026-10-04T03:00:00Z", 9000),
  ];
  for (const row of rows) f.documents.set(`sales/${row.id}`, row);
  const result = await salesMetrics({ store: f.store, args: { startDate: "2026-10-03", endDate: "2026-10-03" }, now: f.clock() });
  const range = buildMetricsDateRange("day", "2026-10-03");
  const panel = calculateMetrics(rows.filter((row) => row.createdAt >= range.start && row.createdAt < range.end), range);
  assert.equal(result.total, panel.total);
  assert.equal(result.count, panel.salesCount);
  assert.equal(result.averageTicket, panel.ticket);
  assert.equal(result.units, panel.totalItems);
  assert.equal(result.products[0].revenue, panel.byProduct[0].total);
  assert.deepEqual(result.cancelled, { count: 1, total: 7000 });
  assert.equal(result.locations[0].name, "Local A");
  assert.equal(result.total, 5000);
  assert.equal(result.changePercent, null);
  assert.match(result.source, /cálculos compartidos/);
});

test("metrics retain location scope and distinguish no sales from a zero average ticket", async () => {
  const f = fixture({ role: "admin" });
  const result = await salesMetrics({ store: f.store, args: { startDate: "2026-10-04", endDate: "2026-10-04", locationId: "local_b" }, now: f.clock() });
  assert.equal(result.count, 0);
  assert.equal(result.total, 0);
  assert.equal(result.averageTicket, null);
  assert.equal(result.partial, false);
});
