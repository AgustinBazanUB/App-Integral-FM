import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { buildMetricsDateRange, calculateMetrics, applyMetricsFilters } from "../src/modules/locations/domain/metrics.js";
import { customerDocumentId } from "../src/gestion/customers/customerDomain.js";
import { customerPurchaseIndex } from "../src/gestion/customers/customerPurchases.js";
import { financeSummary } from "../src/gestion/finance/financeDomain.js";

// Adaptador transaccional local: lecturas antes de escrituras, commit atómico y cola
// para verificar reintentos/concurrencia sin escribir Firebase real.
const mock = { data: new Map(), writes: [], queries: [], sequence: 0, queue: Promise.resolve() };
globalThis.__quickSaleTest = mock;
const bundle = await build({stdin:{contents:'export { createQuickSale } from "./src/gestion/services/managementService.js"; export { createSellerSale, updateSellerSale, cancelSellerSale } from "./src/gestion/services/sellerService.js";',resolveDir:process.cwd()},bundle:true,write:false,platform:"node",format:"esm",plugins:[{name:"operations-transaction-adapter",setup(builder){
  builder.onResolve({filter:/^firebase\/firestore$/},()=>({path:"firestore",namespace:"qa"}));
  builder.onResolve({filter:/^\.\/firebase$/},()=>({path:"firebase",namespace:"qa"}));
  builder.onResolve({filter:/arcaService$/},()=>({path:"fiscal",namespace:"qa"}));
  builder.onResolve({filter:/sharedResources$/},()=>({path:"shared",namespace:"qa"}));
  builder.onResolve({filter:/^firebase\/(app|auth)$/},()=>({path:"auth",namespace:"qa"}));
  builder.onLoad({filter:/.*/,namespace:"qa"},({path})=>({contents:path==="firebase"?'export const db = {}; export const auth={}; export const firebaseConfig={};':path==="fiscal"?'export async function requestPendingArcaInvoice(){ throw Error("Fiscal real prohibido en QA"); }':path==="shared"?'export async function listLocationsShared(){return []}; export async function loadSellerResourcesShared(){return {}};':path==="auth"?'export const deleteApp=()=>{};export const initializeApp=()=>{};export const createUserWithEmailAndPassword=()=>{};export const getAuth=()=>{};export const onAuthStateChanged=()=>{};export const signOut=()=>{};':`
    const mock = globalThis.__quickSaleTest;
    export const collection = (_db,...parts) => ({path:parts.join('/')});
    export const doc = (base,...parts) => { const path=base.path ? base.path+'/'+(parts.join('/') || 'auto-'+(++mock.sequence)) : parts.join('/'); return {path,id:path.split('/').at(-1)}; };
    const snap = ref => ({id:ref.id,ref,exists:()=>mock.data.has(ref.path),data:()=>structuredClone(mock.data.get(ref.path))});
    export const getDoc = async ref => snap(ref);
    export const serverTimestamp = () => new Date('2026-10-02T15:00:00Z');
    export const where = (field,op,value) => ({field,op,value});
    export const orderBy = (field,direction) => ({field,direction});
    export const limit = count => ({count});
    export const query = (collection,...constraints) => ({...collection,constraints});
    export const getDocs = async target => { mock.queries.push(target); return {docs:[]}; };
    export const addDoc=async()=>{};
    export const Timestamp = {fromDate:date=>date}; export const onSnapshot=()=>()=>{}; export const startAfter=()=>({});
    export const getCountFromServer = async () => ({data:()=>({count:0})});
    const commit = writes => {
      const next=new Map(mock.data);
      for(const [kind,ref,value,options] of writes){
        if(kind==='update'&&!next.has(ref.path))throw Error('No existe documento a actualizar');
        next.set(ref.path,options?.merge||kind==='update'?{...next.get(ref.path),...structuredClone(value)}:structuredClone(value));
      }
      mock.data=next; mock.writes.push(...writes);
    };
    export function runTransaction(_db,fn){
      const run=mock.queue.then(async()=>{
        const writes=[];
        const result=await fn({get:async ref=>{if(writes.length)throw Error('Lectura después de escritura');return snap(ref);},set:(ref,value,options)=>writes.push(['set',ref,value,options]),update:(ref,value)=>writes.push(['update',ref,value])});
        commit(writes);return result;
      });
      mock.queue=run.catch(()=>{});return run;
    }
    export const writeBatch = () => {const writes=[];return {set:(...args)=>writes.push(['set',...args]),update:(...args)=>writes.push(['update',...args]),commit:async()=>commit(writes)};};
    export const setDoc = async (ref,value,options) => commit([['set',ref,value,options]]);
  `}));
}}]});
const service=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const admin={id:"admin",name:"Administrador QA",role:"admin",active:true};
const seed=()=>{mock.data=new Map();mock.writes=[];mock.queries=[];mock.sequence=0;mock.queue=Promise.resolve();for(const type of ["locations","warehouses"])mock.data.set(`${type}/origin`,{name:type==="locations"?"Local":"Depósito central",codePrefix:"LOC",active:true});mock.data.set("products/oil",{name:"Aceite",defaultPrice:2500,active:true});for(const type of ["locationStock","warehouseStock"])mock.data.set(`${type}/origin/items/oil`,{productId:"oil",productName:"Aceite",currentStock:20,active:true});};
const args=(type="location",extra={})=>({seller:admin,stockOrigin:{type,id:"origin"},channel:"whatsapp",items:[{id:"oil",name:"Aceite",qty:2,unitPrice:2500}],paymentMethod:"cash",requestId:"attempt-1",...extra});
const sales=()=>[...mock.data].filter(([path])=>path.startsWith("sales/")).map(([path,data])=>({id:path.split("/").at(-1),...data}));
const range=buildMetricsDateRange("month","2026-10");

for(const type of ["location","warehouse"]) test(`venta simple desde ${type}: stock, canal, actor, fecha y actividad en una transacción`,async()=>{seed();const result=await service.createQuickSale(args(type));const sale=sales()[0];assert.equal(result.total,5000);assert.equal(sale.sourceChannel,"whatsapp");assert.equal(sale.stockOriginType,type);assert.equal(sale.locationId,type==="location"?"origin":null);assert.equal(sale.warehouseId,type==="warehouse"?"origin":undefined);assert.equal(sale.sellerId,admin.id);assert.equal(sale.sourceType,"admin_quick_sale");assert.ok(sale.saleDate);assert.ok(sale.saleTime);assert.equal(mock.data.get(`${type==="warehouse"?"warehouseStock":"locationStock"}/origin/items/oil`).currentStock,18);assert.equal([...mock.data.keys()].filter(k=>k.startsWith("stockMovements/")).length,1);assert.equal([...mock.data.keys()].filter(k=>k.startsWith("auditLogs/")).length,1);});

test("pagos combinados exactos y descuento manual con precio administrativo editable",async()=>{seed();const result=await service.createQuickSale(args("warehouse",{items:[{id:"oil",name:"Aceite",qty:2,unitPrice:3000}],discounts:[{discountId:"manual",source:"manual",type:"percent",value:10}],paymentMethod:"multiple",paymentMethodLabel:"+2 pagos",payments:[{method:"cash",amount:2000},{method:"alias",amount:3400}]}));assert.equal(result.total,5400);const sale=sales()[0];assert.equal(sale.items[0].unitPrice,3000);assert.equal(sale.discountTotal,600);assert.deepEqual(sale.priceOverrides,[{productId:"oil",suggestedPrice:2500,unitPrice:3000}]);assert.ok([...mock.data.values()].some(v=>v.action==="sale.created"&&v.priceOverrides?.length===1));assert.equal(sale.payments.reduce((n,p)=>n+p.amount,0),5400);});

test("pagos con diferencia, canal manual, duplicados y catálogo inactivo no escriben nada",async()=>{for(const extra of [{paymentMethod:"multiple",paymentMethodLabel:"+2 pagos",payments:[{method:"cash",amount:1000},{method:"alias",amount:2000}]},{channel:"manual"},{items:[{id:"oil",qty:2,unitPrice:2500},{id:"oil",qty:2,unitPrice:2500}]}]){seed();await assert.rejects(service.createQuickSale(args("location",extra)));assert.equal(mock.writes.length,0);}seed();mock.data.get("products/oil").active=false;await assert.rejects(service.createQuickSale(args()));assert.equal(mock.writes.length,0);});

test("ubicación permite stock cero, insuficiente y negativo; registra saldo, aviso y actividad sin duplicar", async () => {
  for (const stock of [0, 1, -2]) {
    seed(); mock.data.get("locationStock/origin/items/oil").currentStock = stock;
    const input = args("location", { items: [{ id: "oil", name: "Aceite", qty: 2, unitPrice: 2500 }] });
    const [first, retry] = await Promise.all([service.createQuickSale(input), service.createQuickSale(input)]);
    assert.equal(first.id, retry.id); assert.equal(sales().length, 1);
    assert.equal(mock.data.get("locationStock/origin/items/oil").currentStock, stock - 2);
    assert.deepEqual(first.stockDiscrepancies, [{ productId: "oil", name: "Aceite", previousStock: stock, quantity: 2, newStock: stock - 2, missingQuantity: 2 - stock }]);
    assert.deepEqual(sales()[0].stockDiscrepancies, first.stockDiscrepancies);
    const movement = [...mock.data.values()].find(data => data.type === "sale");
    assert.equal(movement.saleItemIndex, 0); assert.equal(movement.previousSaleItemIndex, -1); assert.equal(movement.qty, -2);
    assert.ok([...mock.data.values()].some(data => data.action === "sale.created" && data.stockDiscrepancies?.length === 1));
    assert.equal(calculateMetrics(sales(), range).total, 5000); assert.equal(financeSummary(sales(), [], {}, range).saleIncome, 5000);
    assert.equal([...mock.data.keys()].filter(key => key.startsWith("financialEntries/")).length, 0);
  }
});

test("vendedor registra 0 → -1 → -2; edición y anulación restituyen sólo sus unidades", async () => {
  seed(); mock.data.get("locationStock/origin/items/oil").currentStock = 0;
  const seller = { id: "seller", name: "Vendedor QA", role: "seller", active: true, allowedLocationIds: ["origin"] };
  const input = { profile: seller, location: { id: "origin" }, items: [{ id: "oil", name: "Aceite", qty: 1, unitPrice: 2500 }], paymentMethod: "cash", paymentMethodLabel: "Efectivo" };
  const first = await service.createSellerSale(input);
  assert.equal(mock.data.get("locationStock/origin/items/oil").currentStock, -1);
  const second = await service.createSellerSale(input);
  assert.equal(mock.data.get("locationStock/origin/items/oil").currentStock, -2);
  await service.updateSellerSale({ ...input, saleId: first.id, items: [{ id: "oil", name: "Aceite", qty: 2, unitPrice: 2500 }] });
  assert.equal(mock.data.get("locationStock/origin/items/oil").currentStock, -3);
  await service.cancelSellerSale({ profile: seller, saleId: second.id });
  assert.equal(mock.data.get("locationStock/origin/items/oil").currentStock, -2);
  await assert.rejects(service.cancelSellerSale({ profile: seller, saleId: second.id }), /anulada/);
  await service.cancelSellerSale({ profile: seller, saleId: first.id });
  assert.equal(mock.data.get("locationStock/origin/items/oil").currentStock, 0);
});

test("faltante de depósito, producto ausente o deshabilitado y ubicación inactiva siguen rechazados", async () => {
  seed(); await assert.rejects(service.createQuickSale(args("warehouse", { items: [{ id: "oil", qty: 21, unitPrice: 2500 }] })), /stock/); assert.equal(mock.writes.length, 0);
  for (const change of [() => mock.data.delete("locationStock/origin/items/oil"), () => { mock.data.get("locationStock/origin/items/oil").active = false; }, () => { mock.data.get("locations/origin").active = false; }]) {
    seed(); change(); await assert.rejects(service.createQuickSale(args())); assert.equal(mock.writes.length, 0);
  }
});

test("nuevo cliente y teléfono argentino equivalente reutilizan el mismo registro e historial",async()=>{seed();const customer={phone:"+54 9 11 1234-5678",name:"Ana",zoneName:"CABA"};await service.createQuickSale(args("location",{customer}));const id=await customerDocumentId("1112345678");assert.equal(sales()[0].customerId,id);assert.equal(mock.data.get(`customers/${id}`).source,"admin_quick_sale");await service.createQuickSale(args("warehouse",{channel:"instagram",requestId:"attempt-2",customer:{phone:"11 1234-5678",name:"Nombre distinto",zoneName:"Otra zona"}}));assert.equal([...mock.data.keys()].filter(k=>k.startsWith("customers/")).length,1);assert.equal(sales()[1].customerNameSnapshot,"Ana");assert.equal(sales()[1].customerZoneSnapshot,"CABA");assert.equal(mock.data.get(`customers/${id}`).lastSaleId,sales()[1].id);});

test("reintento concurrente/reload y acuse perdido actualizan stock, contador y finanzas una sola vez",async()=>{seed();const input=args("warehouse",{invoiceRequested:true});const [first,second]=await Promise.all([service.createQuickSale(input),service.createQuickSale(input)]);assert.equal(first.id,second.id);assert.equal(sales().length,1);assert.equal(mock.data.get("warehouseStock/origin/items/oil").currentStock,18);mock.data.get("warehouses/origin").active=false;await service.createQuickSale(structuredClone(input));assert.equal(sales().length,1);assert.equal([...mock.data.values()].find(v=>v.lastNumber)?.lastNumber,1);await assert.rejects(service.createQuickSale({...input,channel:"instagram"}),/original|otra venta/);const before=calculateMetrics(sales(),range);mock.data.get(`sales/${first.id}`).fiscalInvoiceId="protected-invoice";mock.data.set("invoices/protected-invoice",{total:5000,status:"authorized"});const after=calculateMetrics(sales(),range);assert.equal(before.total,5000);assert.equal(after.total,5000);assert.equal(after.salesCount,1);assert.equal(after.byChannel[0].id||after.byChannel[0].key,"whatsapp");assert.equal(after.byLocation.length,0);assert.equal(after.byStockOrigin[0].type,"warehouse");assert.equal([...mock.data.keys()].filter(k=>k.startsWith("financialEntries/")).length,0);});

test("Instagram y WhatsApp se filtran por canal sin convertir el depósito en canal",async()=>{seed();await service.createQuickSale(args("warehouse"));await service.createQuickSale(args("location",{requestId:"attempt-2",channel:"instagram"}));const selected=applyMetricsFilters(sales(),{channelIds:["instagram"]},range);assert.equal(selected.length,1);assert.equal(calculateMetrics(selected,range).total,5000);assert.equal(calculateMetrics([],range).total,0);});

test("Panel Vendedor conserva ubicación y canal presencial; retry offline no duplica",async()=>{seed();const input={profile:admin,location:{id:"origin"},items:args().items,paymentMethod:"cash",offlineSale:{localId:"local_qa",createdLocallyAt:"2026-10-02T15:00:00Z"}};await service.createSellerSale(input);await service.createSellerSale(input);assert.equal(sales().length,1);assert.equal(sales()[0].sourceChannel,"in_person");assert.equal(sales()[0].createdOffline,true);assert.equal(mock.data.get("locationStock/origin/items/oil").currentStock,18);});

test("Venta Rápida asociada con pago combinado integra CRM, Métricas y Finanzas; anulación conserva venta y actividad", async () => {
  seed(); const customer = { phone: "11 1234-5678" };
  const created = await service.createQuickSale(args("location", { customer, paymentMethod: "multiple", paymentMethodLabel: "+2 pagos", payments: [{ method: "cash", amount: 2000 }, { method: "debit", amount: 3000 }] }));
  const id = await customerDocumentId(customer.phone), customers = [{ id, ...mock.data.get(`customers/${id}`) }];
  assert.equal(customerPurchaseIndex(customers, sales(), [], {}, new Date("2026-10-03T15:00:00Z")).get(id).count, 1);
  assert.equal(calculateMetrics(sales(), range).salesCount, 1); assert.equal(calculateMetrics(sales(), range).byPayment.reduce((sum, part) => sum + part.total, 0), 5000);
  assert.equal(financeSummary(sales(), [], {}, range).saleIncome, 5000);
  mock.data.get(`sales/${created.id}`).fiscalInvoiceId = "qa-linked-invoice";
  mock.data.set("invoices/qa-linked-invoice", { saleId: created.id, total: 5000, status: "authorized" });
  assert.equal(customerPurchaseIndex(customers, sales(), [], {}, new Date("2026-10-03T15:00:00Z")).get(id).count, 1);
  assert.equal(calculateMetrics(sales(), range).total, 5000); assert.equal(financeSummary(sales(), [], {}, range).saleIncome, 5000);
  await assert.rejects(service.cancelSellerSale({ profile: admin, saleId: created.id, reason: "QA" }), /revisión administrativa/);
  // Otra venta sin comprobante usa la anulación comercial existente.
  seed(); const cancellable = await service.createQuickSale(args("location", { customer }));
  await service.cancelSellerSale({ profile: admin, saleId: cancellable.id, reason: "Corrección de prueba" });
  assert.equal(sales().length, 1); assert.equal(sales()[0].status, "cancelled");
  assert.equal(customerPurchaseIndex(customers, sales(), [], {}, new Date("2026-10-03T15:00:00Z")).get(id).count, 0);
  assert.equal(calculateMetrics(sales(), range).total, 0); assert.equal(financeSummary(sales(), [], {}, range).saleIncome, 0);
  assert.equal(mock.data.get("locationStock/origin/items/oil").currentStock, 20);
  assert.ok([...mock.data.values()].some(row => row.action === "sale.cancelled" && row.description.includes("Corrección de prueba")));
});
