import test from "node:test";
import assert from "node:assert/strict";
import { calculateMetrics, applyMetricsFilters, buildMetricsDateRange } from "../src/modules/locations/domain/metrics.js";
import { summarizeRemainingStock } from "../src/modules/inventory/domain/remainingStock.js";
import { retrieveCurrentOliviaKnowledge } from "../src/shared/oliviaCurrentKnowledge.mjs";

const range = buildMetricsDateRange("month", "2026-10");
const sale = (id, date, overrides = {}) => ({ id, createdAt: date, total: 90, sellerId: "a", sellerName: "Ana", items: [{ productId:"oil", name:"Aceite", qty:2, subtotal:100 }], ...overrides });

test("horas acumulan varios días en Argentina y excluyen anuladas, eliminadas y duplicadas", () => {
  const first = sale("1", "2026-10-02T02:59:00Z"); // 23:59 Argentina
  const sales = [first, first, sale("2", "2026-10-03T02:00:00Z"), sale("3", "2026-10-03T03:00:00Z"), sale("4", "2026-10-03T03:00:00Z", {status:"cancelled"}), sale("5", "2026-10-03T03:00:00Z", {deleted:true})];
  const metrics = calculateMetrics(applyMetricsFilters(sales, {}, range), range);
  assert.equal(metrics.byHour.length,24);
  assert.deepEqual(metrics.byHour[23], {key:"23",name:"23:00",total:180,sales:2,items:4});
  assert.equal(metrics.byHour[0].sales,1);
  assert.equal(metrics.byHour.reduce((sum,row)=>sum+row.total,0),metrics.total);
  assert.equal(metrics.byProduct[0].items,6);
  assert.equal(metrics.bySeller[0].sales,3);
});

test("el horario conserva filtros por vendedor y los límites del período", () => {
  const sales = [sale("a","2026-10-01T02:59:59Z"),sale("b","2026-10-01T03:00:00Z"),sale("c","2026-10-01T04:00:00Z",{sellerId:"b"})];
  const metrics = calculateMetrics(applyMetricsFilters(sales,{sellerIds:["a"]},range),range);
  assert.equal(metrics.salesCount,1);
  assert.equal(metrics.byHour[0].sales,1);
});

const origins = [
  {type:"location",id:"local",name:"Local",items:[{id:"a",productId:"a",productName:"Aceite",abbreviation:"ACE",currentStock:-3,categoryId:"oil"},{id:"b",productName:"B",currentStock:0},{id:"gone",currentStock:99,deleted:true}]},
  {type:"warehouse",id:"dep",name:"Depósito",items:[{id:"a",currentStock:2},{id:"c",productName:"C",currentStock:5}]},
];
test("stock suma productos únicos, preserva negativos y cero y excluye eliminados", () => {
  const rows = summarizeRemainingStock(origins);
  assert.deepEqual(rows.map(row=>[row.key,row.quantity]),[["a",-1],["b",0],["c",5]]);
  assert.equal(rows[0].origins.length,2);
  assert.equal(rows[0].abbreviation,"ACE");
  assert.equal(summarizeRemainingStock(origins,{productIds:["a"]}).length,1);
  assert.equal(summarizeRemainingStock(origins,{categoryProductIds:["a"],categoryIds:["oil"]})[0].quantity,-1);
  assert.equal(summarizeRemainingStock([origins[0]])[0].quantity,-3);
});

test("conocimiento actual tiene ARCA disponible y revisión manual sin usar solución propuesta", () => {
  const arca = retrieveCurrentOliviaKnowledge("ARCA autorización automática disponible",{role:"admin"});
  assert.ok(arca.some(row=>row.text.includes("autorización automática ARCA está disponible")));
  assert.ok(arca.every(row=>!row.sourceUrl.includes("drive.google")));
  const review = retrieveCurrentOliviaKnowledge("prepare_product_create",{role:"admin"});
  assert.ok(review.some(row=>/no crea|no da de alta|formulario/i.test(row.text)));
  assert.deepEqual(retrieveCurrentOliviaKnowledge("finanzas presupuesto",{role:"guest"}),[]);
  assert.ok(retrieveCurrentOliviaKnowledge("stock",{role:"seller"}).every(row=>row.audience==="seller"));
  assert.ok(retrieveCurrentOliviaKnowledge("productos",{role:"analyst",allowedModules:["metrics"]}).every(row=>row.module==="metrics"));
});
