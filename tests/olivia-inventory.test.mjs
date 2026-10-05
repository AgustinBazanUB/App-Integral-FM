import test from "node:test";
import assert from "node:assert/strict";
import { fixture, start, textResponse, functionResponse } from "./helpers/olivia-fixture.mjs";
import { runTool } from "../netlify/functions/_lib/olivia/tools.mjs";

test("inventory preserves zero and unknown quantities and resolves omitted product names without writes", async () => {
  const f = fixture({ role: "admin" });
  f.documents.set("warehouses/central", { name: "Central", active: true });
  f.documents.set("warehouseStock/central/items/oil", { productId: "oil", currentStock: 0 });
  f.documents.set("warehouseStock/central/items/unknown", { productName: "Sin conteo" });
  f.documents.set("warehouseStock/central/items/removed", { deleted: true, currentStock: 9 });
  const before = structuredClone([...f.documents]);
  const { data } = await runTool({ session: f.session, name: "get_inventory_summary", args: { inventoryType: "warehouse", inventoryId: "central" }, store: f.store, context: {} });
  assert.equal(data.owner.name, "Central");
  assert.equal(data.items.length, 2);
  assert.equal(data.items.find((item) => item.id === "oil").productName, "Aceite");
  assert.equal(data.items.find((item) => item.id === "oil").currentStock, 0);
  assert.equal(Object.hasOwn(data.items.find((item) => item.id === "unknown"), "currentStock"), false);
  assert.equal(data.partial, false);
  assert.deepEqual([...f.documents], before);
});

test("inventory continuation retains the selected type and exposes its permitted tool outside the warehouse screen", async () => {
  let call = 0;
  const f = fixture({ role: "admin", provider: async (_path, body) => {
    call++;
    if (call === 1) return functionResponse("update_task", { intent: "get_inventory_summary", slotsJson: '{"inventoryType":"warehouse","inventoryId":null}' });
    if (call === 2) return textResponse("¿Qué depósito querés consultar?");
    if (call === 3) {
      assert.ok(body.tools.some((tool) => tool.name === "get_inventory_summary"));
      assert.deepEqual(JSON.parse(body.input[0].content).taskState.slots, { inventoryType: "warehouse", inventoryId: null });
      return functionResponse("get_inventory_summary", { inventoryType: "warehouse", inventoryId: "central" });
    }
    const data = JSON.parse(body.input.filter((item) => item.type === "function_call_output").at(-1).output);
    assert.equal(data.items[0].currentStock, 4);
    return textResponse("Central:\n- Aceite: 4 unidades.");
  } });
  f.documents.set("warehouses/central", { name: "Central", active: true });
  f.documents.set("warehouseStock/central/items/oil", { productId: "oil", productName: "Aceite", currentStock: 4 });
  const { conversationId } = await start(f);
  const turn = (message, requestId) => f.engine.chat(f.session, { conversationId, message, requestId, screenContext: { route: "/gestion/settings", module: "settings" } });
  const first = await turn("Quiero el inventario de un depósito", "inventory_first");
  assert.equal(first.state, "DATOS_INCOMPLETOS");
  assert.deepEqual(f.documents.get(`oliviaConversations/${conversationId}`).taskState.missingFields, ["inventoryId"]);
  f.advance(2000);
  const second = await turn("Central", "inventory_choice");
  assert.match(second.messages.at(-1).content, /Aceite: 4/);
  assert.equal(second.pendingAction, null);
  assert.equal(second.state, "INFORMACION");
  assert.equal(f.documents.get(`oliviaConversations/${conversationId}`).taskState.status, "completed");
  assert.equal(f.documents.get("warehouseStock/central/items/oil").currentStock, 4);
});

test("warehouse inventory remains unavailable to sellers and administrators denied warehouse access", async () => {
  for (const role of ["seller", "admin"]) {
    const f = fixture({ role });
    if (role === "admin") {
      const profile = { ...f.session.profile, permissionDeny: { warehouse: ["view", "admin"] } };
      f.documents.set("users/user_a", profile);
    }
    await assert.rejects(runTool({ session: f.session, name: "get_inventory_summary", args: { inventoryType: "warehouse", inventoryId: "central" }, store: f.store, context: {} }), { code: "permission-denied" });
  }
});
