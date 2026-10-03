import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

// Adaptador de lectura en memoria: no conecta Firebase ni puede escribir datos.
const mock = { calls: [], documents: [], error: null };
globalThis.__dashboardReadTest = mock;
const result = await build({
  stdin: {
    contents: 'export * from "./src/gestion/services/dashboardService.js"; export * from "./src/gestion/services/alertsService.js"; export * from "./src/gestion/services/runtimeCache.js";',
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{ name: "dashboard-read-adapter", setup(builder) {
    builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: "firestore", namespace: "qa" }));
    builder.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: "firebase", namespace: "qa" }));
    builder.onLoad({ filter: /.*/, namespace: "qa" }, ({ path }) => ({ contents: path === "firebase" ? 'export const db = {};' : `
      export const collection = (_db, name) => name;
      export const where = (field, operator, value) => ({field, operator, value});
      export const query = (collection, ...constraints) => ({collection, constraints});
      export const orderBy = (field, direction) => ({field, direction});
      export const limit = value => ({limit:value});
      export const startAfter = value => ({cursor:value});
      export const Timestamp = {fromDate: date => date};
      export async function getDocs(query) {
        const mock = globalThis.__dashboardReadTest;
        mock.calls.push(query);
        if (mock.error) throw mock.error;
        return {docs: mock.documents.map(document => ({id:document.id, data:()=>document.data}))};
      }
    ` }));
  } }],
});
const service = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const admin = { id: "admin", role: "admin", active: true };
const range = { start: new Date("2026-10-02T03:00:00Z"), end: new Date("2026-10-03T03:00:00Z") };
const reset = () => {
  mock.calls = []; mock.documents = []; mock.error = null;
  service.clearRuntimeCache(); service.invalidateDashboardSales();
};

test("ventas consultan sólo el rango y ubicación; nunca leen facturas", async () => {
  reset();
  mock.documents = [{ id: "venta", data: { total: 100, status: "active", invoiceId: "factura" } }];
  const sales = await service.listSalesByRange({ profile: admin, locationIds: ["local", "local"], ...range });
  assert.equal(sales.length, 1);
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].collection, "sales");
  assert.deepEqual(mock.calls[0].constraints.slice(0, 4), [
    { field: "locationId", operator: "in", value: ["local"] },
    { field: "status", operator: "==", value: "active" },
    { field: "createdAt", operator: ">=", value: range.start },
    { field: "createdAt", operator: "<", value: range.end },
  ]);
  await service.listSalesByRange({ profile: admin, locationIds: ["local"], ...range });
  assert.equal(mock.calls.length, 1, "caché reutilizada");
  service.invalidateDashboardSales();
  await service.listSalesByRange({ profile: admin, locationIds: ["local"], ...range });
  assert.equal(mock.calls.length, 2, "reintentar invalida el resumen");
});

test("grupos de ubicaciones deduplican ventas y una selección vacía no lee Firestore", async () => {
  reset();
  mock.documents = [{ id: "una", data: { total: 100 } }, { id: "eliminada", data: { deleted: true } }];
  const ids = Array.from({ length: 11 }, (_, index) => `local-${index}`);
  const sales = await service.listSalesByRange({ profile: admin, locationIds: ids, ...range });
  assert.equal(mock.calls.length, 2);
  assert.equal(sales.length, 1);
  assert.deepEqual(await service.listSalesByRange({ profile: admin, locationIds: [], ...range }), []);
  assert.equal(mock.calls.length, 2);
});

test("alertas usan la colección central activa, ordenan antes de resumir y comparten consultas simultáneas", async () => {
  reset();
  mock.documents = [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `info-${index}`, data: { active: true, status: "new" } })),
    { id: "critical", data: { active: true, severity: "critical" } },
    { id: "closed", data: { active: true, status: "resolved" } },
  ];
  const [first, second] = await Promise.all([service.listActiveAlerts(admin), service.listActiveAlerts(admin)]);
  assert.equal(first[0].id, "critical");
  assert.deepEqual(first, second);
  assert.equal(first.length, 9);
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].collection, "alerts");
  assert.deepEqual(mock.calls[0].constraints, [{ field: "active", operator: "==", value: true }]);
});

test("permisos de alertas se aplican antes de leer y responsables usan query autorizable", async () => {
  reset();
  const denied = { ...admin, permissionDeny: { alerts: ["view", "admin"] } };
  assert.deepEqual(await service.listActiveAlerts(denied), []);
  assert.equal(mock.calls.length, 0);
  await service.listActiveAlerts({ id: "manager", role: "location_manager", active: true });
  assert.deepEqual(mock.calls[0].constraints[1], { field: "responsibleId", operator: "==", value: "manager" });
});

test("errores de lectura se propagan y el reintento de alertas no conserva un rechazo en caché", async () => {
  reset(); mock.error = new Error("offline");
  await assert.rejects(service.listActiveAlerts(admin), /offline/);
  mock.error = null;
  assert.deepEqual(await service.listActiveAlerts(admin), []);
  assert.equal(mock.calls.length, 2);
});
