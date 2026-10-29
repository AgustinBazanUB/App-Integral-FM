import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/olivia-fixture.mjs";
import { runTool, toolDefinitions } from "../netlify/functions/_lib/olivia/tools.mjs";
import { appCapabilities } from "../netlify/functions/_lib/olivia/appCapabilities.mjs";
import { retrieveCurrentOliviaKnowledge } from "../src/shared/oliviaCurrentKnowledge.mjs";

test("capability directory is scoped to the user and does not advertise retired shipping mutations", async () => {
  const admin = fixture({ role: "admin" }), seller = fixture();
  const result = await runTool({ session: seller.session, name: "get_app_capabilities", args: { query: "" }, store: seller.store });
  assert.deepEqual(result.data.modules.map(row => row.module), ["seller"]);
  const definitions = toolDefinitions(admin.session, { query: "envíos", context: { module: "shipping" } });
  assert.ok(definitions.some(tool => tool.name === "get_shipments"));
  assert.ok(!definitions.some(tool => ["prepare_shipment_create", "prepare_shipment_update"].includes(tool.name)));
  assert.match(appCapabilities(admin.session, "envíos").modules.find(row => row.module === "shipping").manual, /Venta Rápida/);
  admin.session.profile.permissionDeny = { finance: ["view", "admin"] };
  assert.ok(!appCapabilities(admin.session).modules.some(row => row.module === "finance"));
});
test("shipping knowledge describes current logistics rather than the historical generic table", () => {
  const result = retrieveCurrentOliviaKnowledge("envíos preparación repositorio repartidor QR rutas", { role: "admin", module: "shipping", allowedModules: ["shipping"], limit: 4 });
  assert.ok(result.some(row => row.id === "guide-shipping"));
  assert.ok(!result.some(row => row.text.includes("No hay tracking de transportista, cálculo de tarifas, impresión de etiquetas")));
});
