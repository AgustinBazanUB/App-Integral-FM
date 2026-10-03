import test from "node:test";
import assert from "node:assert/strict";
import { memoryServices } from "./helpers/memoryFirestore.mjs";
const { state, service } = await memoryServices('export * from "./src/gestion/services/locationSalesService.js"; export * from "./src/gestion/customers/crmService.js";');
const admin = { id: "admin", role: "admin", active: true };
test("historial de ubicación y cliente conserva cursor al omitir ventas archivadas", async () => {
  for (let index = 1; index <= 14; index++) state.data.set(`sales/s${String(index).padStart(2, "0")}`, { locationId: "local", customerId: "customer", createdAt: new Date(Date.UTC(2026, 8, index, 15)), deleted: index > 4, status: index === 3 ? "cancelled" : "active", total: 100 });
  const first = await service.listLocationSalesPage({ profile: admin, locationId: "local", pageSize: 10 });
  assert.equal(first.items.length, 0); assert.equal(first.hasMore, true); assert.ok(first.cursor);
  const second = await service.listLocationSalesPage({ profile: admin, locationId: "local", pageSize: 10, cursor: first.cursor });
  assert.equal(second.items.length, 4); assert.equal(second.hasMore, false);
  assert.ok(second.items.some(sale => sale.status === "cancelled"));
  const history = await service.customerHistoryPage(admin, { id: "customer" });
  assert.equal(history.items.length, 4); assert.ok(history.items.some(sale => sale.status === "cancelled"));
});
