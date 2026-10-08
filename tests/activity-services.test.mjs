import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const mock = { documents: new Map(), calls: [] };
globalThis.__activityRead = mock;
const bundle = await build({ stdin: { contents: 'export * from "./src/gestion/services/dashboardService.js";export * from "./src/gestion/services/activityService.js";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "activity-read", setup(b) {
  b.onResolve({ filter: /^firebase\/firestore$|^\.\/firebase$/ }, args => ({ path: args.path, namespace: "qa" }));
  b.onLoad({ filter: /.*/, namespace: "qa" }, ({ path }) => ({ contents: path === "./firebase" ? "export const db={};" : `
    export const collection=(_db,...parts)=>parts.join('/'),doc=collection;
    export const query=(collection,...constraints)=>({collection,constraints});
    export const where=(field,operator,value)=>({field,operator,value});
    export const orderBy=(field,direction)=>({field,direction});
    export const limit=value=>({limit:value}),startAfter=cursor=>({cursor});
    export const Timestamp={fromDate:date=>date};
    export async function getDoc(path){const m=globalThis.__activityRead;m.calls.push({path});const data=m.documents.get(path);return {id:path.split('/').at(-1),exists:()=>!!data,data:()=>data};}
    export async function getDocs(input){
      const m=globalThis.__activityRead,q=typeof input==='string'?{collection:input,constraints:[]}:input;m.calls.push(q);
      let rows=[...m.documents].filter(([path])=>path.startsWith(q.collection+'/')&&path.split('/').length===2).map(([path,data])=>({id:path.split('/').at(-1),data:()=>data}));
      const scalar=v=>v?.toDate?.()?.getTime()??(v instanceof Date?v.getTime():v);
      for(const c of q.constraints.filter(c=>c.field&&c.operator))rows=rows.filter(row=>{const v=scalar(row.data()[c.field]),w=scalar(c.value);return c.operator==='=='?v===w:c.operator==='in'?c.value.includes(v):c.operator==='>='?v>=w:c.operator==='<'?v<w:false;});
      if(q.constraints.some(c=>c.direction))rows.sort((a,b)=>scalar(b.data().createdAt)-scalar(a.data().createdAt)||b.id.localeCompare(a.id));
      const cursor=q.constraints.find(c=>c.cursor)?.cursor;if(cursor){const i=rows.findIndex(row=>row.id===cursor.id);rows=rows.slice(i+1);}
      const max=q.constraints.find(c=>c.limit)?.limit;if(max)rows=rows.slice(0,max);
      return {docs:rows};
    }
  ` }));
} }] });
const service = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const admin = { id: "admin", role: "admin", active: true };
const stamp = n => ({ toDate: () => new Date(n * 1000), toMillis: () => n * 1000 });
const reset = () => { mock.documents.clear(); mock.calls = []; };
const write = (path, data) => mock.documents.set(path, data);

test("chronological paging deduplicates sale creation across page boundaries without hiding edits or cancellations", async () => {
  reset();
  for (let i = 1; i <= 10; i++) {
    write(`sales/s${i}`, { sellerId: "admin", total: 99000, status: i === 1 ? "cancelled" : "active", createdAt: stamp(i) });
    write(`auditLogs/a${i}`, { entityType: "sale", entityId: `s${i}`, action: "sale.created", userId: "admin", amount: i * 1000, createdAt: stamp(i) });
  }
  write("auditLogs/edit", { action: "sale.updated", entityType: "sale", entityId: "s1", userId: "admin", createdAt: stamp(11) });
  write("auditLogs/cancel", { action: "sale.cancelled", entityType: "sale", entityId: "s1", userId: "admin", createdAt: stamp(12) });
  let cursor = {}, all = [], page;
  do { page = await service.listActivityPage({ profile: admin, pageSize: 3, cursor }); all.push(...page.items); cursor = page.cursor; assert.ok(all.length <= 12); } while (page.hasMore);
  assert.equal(all.length, 12); assert.equal(new Set(all.map(item => item.key)).size, 12);
  assert.deepEqual(all.slice(0, 2).map(item => item.action), ["sale.cancelled", "sale.updated"]);
  assert.equal(all.at(-1).action, "sale.created"); assert.equal(all.at(-1).createdAt.toMillis(), 1000);
  assert.equal(all.find(item => item.key === "sale:s10:created").amount, 10000);
  assert.ok(all.every((item, index) => !index || all[index - 1].createdAt.toMillis() >= item.createdAt.toMillis()));
});
test("a sparse user filter refills the newest stream before yielding an older match", async () => {
  reset();
  for (let i = 0; i < 120; i++) write(`auditLogs/a${i}`, { userId: i === 110 ? "target" : "other", action: "product.updated", createdAt: stamp(1000 - i) });
  write("sales/old", { sellerId: "target", total: 1, status: "active", createdAt: stamp(500) });
  const first = await service.listActivityPage({ profile: admin, filters: { userId: "target" }, pageSize: 1 });
  assert.equal(first.items[0].sourceId, "a110");
  const second = await service.listActivityPage({ profile: admin, filters: { userId: "target" }, pageSize: 1, cursor: first.cursor });
  assert.equal(second.items[0].sourceId, "old");
});
test("activity written between pages only appears after refreshing the timeline", async () => {
  reset();
  write("auditLogs/first", { action: "product.updated", createdAt: stamp(10) });
  write("auditLogs/second", { action: "product.updated", createdAt: stamp(5) });
  const first = await service.listActivityPage({ profile: admin, pageSize: 1 });
  write("sales/new", { total: 10000, createdAt: stamp(first.cursor.__asOf.getTime() / 1000 + 1) });
  const next = await service.listActivityPage({ profile: admin, pageSize: 1, cursor: first.cursor });
  assert.equal(next.items[0].sourceId, "second");
  assert.equal(next.hasMore, false);
  const refreshed = await service.listActivityPage({ profile: admin, pageSize: 1, cursor: { __asOf: new Date(first.cursor.__asOf.getTime() + 2000) } });
  assert.equal(refreshed.items[0].sourceId, "new");
});
test("bounded scans retain a continuation when no matches appear yet and eventually find older user activity", async () => {
  reset();
  for (let i = 0; i < 702; i++) write(`auditLogs/a${i}`, { action: "product.updated", userId: i === 700 ? "target" : "other", createdAt: stamp(1000 - i) });
  const first = await service.listActivityPage({ profile: admin, filters: { userId: "target" } });
  assert.equal(first.items.length, 0); assert.equal(first.hasMore, true);
  const second = await service.listActivityPage({ profile: admin, filters: { userId: "target" }, cursor: first.cursor });
  assert.equal(second.items.length, 1); assert.equal(second.items[0].sourceId, "a700"); assert.equal(second.hasMore, false);
  const none = await service.listActivityPage({ profile: admin, filters: { userId: "idle" }, cursor: first.cursor });
  assert.equal(none.items.length, 0); assert.equal(none.hasMore, false);
});
test("location scope is enforced before querying and directory access never expands to non-admin roles", async () => {
  reset(); const manager = { id: "manager", active: true, role: "location_manager", allowedLocationIds: ["local"] };
  const denied = await service.listActivityPage({ profile: manager, locationIds: ["foreign"] });
  assert.deepEqual(denied.items, []); assert.equal(mock.calls.length, 0);
  assert.deepEqual(await service.listActivityUsers(manager), []); assert.equal(mock.calls.length, 0);
  write("users/idle", { name: "Sin registros", active: false, password: "PRIVATE" });
  assert.deepEqual(await service.listActivityUsers(admin), [{ id: "idle", name: "Sin registros", active: false, deleted: false, email: "" }]);
});
test("sale detail uses the immutable event snapshot and does not read the changed sale", async () => {
  reset(); const recorded = { total: 15000, items: [{ name: "Mermelada", qty: 2 }] };
  write("auditLogs/event", { action: "sale.created", entityType: "sale", entityId: "s1", detailSnapshot: recorded }); write("sales/s1", { total: 99000 });
  const detail = await service.loadActivityDetail({ source: "auditLogs", sourceId: "event" }, admin);
  assert.deepEqual(detail.record, recorded); assert.equal(detail.recorded, true); assert.equal(detail.warning, "");
  assert.deepEqual(mock.calls, [{ path: "auditLogs/event" }]);
});
test("legacy activity opens its current sale with an explicit historical limitation", async () => {
  reset(); write("auditLogs/legacy", { action: "sale.created", entityType: "sale", entityId: "s1" }); write("sales/s1", { total: 20000, items: [{ name: "Aceite", qty: 1 }] });
  const detail = await service.loadActivityDetail({ source: "auditLogs", sourceId: "legacy" }, admin);
  assert.equal(detail.record.total, 20000); assert.equal(detail.recorded, false); assert.match(detail.warning, /actuales/);
});
test("sale fallback detail also recovers a saved audit snapshot instead of showing later edits", async () => {
  reset(); write("sales/s1", { total: 99000 }); write("auditLogs/a1", { action: "sale.created", entityId: "s1", detailSnapshot: { total: 10000 } });
  const detail = await service.loadActivityDetail({ source: "sales", sourceId: "s1" }, admin);
  assert.equal(detail.record.total, 10000); assert.equal(detail.recorded, true);
});
test("stock activity loads only its immutable operation movements", async () => {
  reset(); write("auditLogs/add", { action: "stock.add", entityType: "stockOperation", entityId: "op", locationId: "local" }); write("stockOperations/op", { itemCount: 2 });
  write("stockMovements/a", { operationId: "op", productName: "Mermelada", qty: 5, previousStock: 2, newStock: 7 }); write("stockMovements/b", { operationId: "another", qty: 100 });
  const detail = await service.loadActivityDetail({ source: "auditLogs", sourceId: "add" }, admin);
  assert.equal(detail.movements.length, 1); assert.equal(detail.movements[0].newStock, 7); assert.equal(detail.recorded, true);
  assert.equal(mock.calls.find(call => call.collection === "stockMovements").constraints[0].value, "op");
});
test("detail rejects arbitrary paths and reports unavailable records without exposing other collections", async () => {
  reset();
  await assert.rejects(service.loadActivityDetail({ source: "settings", sourceId: "openai" }, admin), /permiso/);
  await assert.rejects(service.loadActivityDetail({ source: "auditLogs", sourceId: "a/secret" }, admin), /permiso/);
  assert.equal(mock.calls.length, 0);
  await assert.rejects(service.loadActivityDetail({ source: "auditLogs", sourceId: "gone" }, admin), /no está disponible/);
});
test("product configuration uses saved settings and never substitutes later stock values", async () => {
  reset(); write("auditLogs/config", { entityType: "locationProduct", entityId: "jam", locationId: "local", previousSettings: { price: 8000 }, newSettings: { priceOverride: 10000, active: true } });
  write("locationStock/local/items/jam", { price: 99000 });
  const detail = await service.loadActivityDetail({ source: "auditLogs", sourceId: "config" }, admin);
  assert.equal(detail.record.priceOverride, 10000); assert.equal(detail.recorded, true);
  assert.deepEqual(mock.calls, [{ path: "auditLogs/config" }]);
});
test("legacy location products resolve only their own nested stock document", async () => {
  reset(); write("auditLogs/config", { entityType: "locationProduct", entityId: "jam", locationId: "local" });
  write("locationStock/local/items/jam", { productName: "Mermelada", currentStock: 7 });
  const detail = await service.loadActivityDetail({ source: "auditLogs", sourceId: "config" }, admin);
  assert.equal(detail.record.currentStock, 7); assert.match(detail.warning, /actuales/);
  assert.deepEqual(mock.calls, [{ path: "auditLogs/config" }, { path: "locationStock/local/items/jam" }]);
});
