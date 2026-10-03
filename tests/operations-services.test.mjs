import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { reconcileTransferLine } from "../src/modules/inventory/domain/inventory.js";
import { normalizeOperatingCalendar } from "../src/modules/locations/domain/locations.js";
import { joinMasterProducts } from "../src/modules/locations/domain/dashboard.js";

// Adaptador transaccional local: lecturas antes de escrituras, commit atómico y cola
// para verificar reintentos/concurrencia sin escribir Firebase real.
const mock = { data: new Map(), writes: [], queries: [], sequence: 0, queue: Promise.resolve() };
globalThis.__operationsTest = mock;
const bundle = await build({stdin:{contents:'export * from "./src/gestion/services/inventoryService.js"; export * from "./src/gestion/services/locationManagementService.js";',resolveDir:process.cwd()},bundle:true,write:false,platform:"node",format:"esm",plugins:[{name:"operations-transaction-adapter",setup(builder){
  builder.onResolve({filter:/^firebase\/firestore$/},()=>({path:"firestore",namespace:"qa"}));
  builder.onResolve({filter:/^\.\/firebase$/},()=>({path:"firebase",namespace:"qa"}));
  builder.onLoad({filter:/.*/,namespace:"qa"},({path})=>({contents:path==="firebase"?'export const db = {};':`
    const mock = globalThis.__operationsTest;
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
const reset=()=>{mock.data=new Map();mock.writes=[];mock.queries=[];mock.sequence=0;mock.queue=Promise.resolve();};
const stockPath=(type,id)=>`${type==="warehouse"?"warehouseStock":"locationStock"}/${id}/items/oil`;
const seed=(originType="warehouse",destinationType="location")=>{
  reset();
  mock.data.set(`${originType==="warehouse"?"warehouses":"locations"}/origin`,{name:"Origen",active:true});
  mock.data.set(`${destinationType==="warehouse"?"warehouses":"locations"}/destination`,{name:"Destino",active:destinationType!=="location"});
  mock.data.set("products/oil",{name:"Aceite",defaultPrice:2500,active:true,yellowAlertQty:50,redAlertQty:30});
  mock.data.set(stockPath(originType,"origin"),{productId:"oil",productName:"Aceite",currentStock:20,active:true});
  mock.data.set(stockPath(destinationType,"destination"),{productId:"oil",currentStock:10,priceMode:"custom",priceOverride:1700,yellowAlertQty:8,redAlertQty:3,active:false});
};
const transfer=(originType="warehouse",destinationType="location",extra={})=>({origin:{type:originType,id:"origin"},destination:{type:destinationType,id:"destination",note:"Una faltó en preparación y otra se rompió"},lines:[{productId:"oil",quantity:20,preparedQuantity:19,receivedQuantity:18}],profile:admin,transferId:"transfer-qa",carrierName:"Transportista QA",...extra});

test("carga y conteo físico corrigen saldos negativos de ubicación con auditoría e idempotencia", async () => {
  seed("location", "warehouse"); mock.data.get(stockPath("location", "origin")).currentStock = -3;
  const input = { type: "location", inventory: { id: "origin" }, product: { id: "oil", productName: "Aceite" }, quantity: 1, profile: admin, requestId: "negative-add" };
  await service.addStockToInventory(input); await service.addStockToInventory(input);
  assert.equal(mock.data.get(stockPath("location", "origin")).currentStock, -2);
  const result = await service.adjustInventoryStock({ ...input, quantity: 4, requestId: "negative-adjust", reason: "Conteo físico" });
  assert.equal(result.previousStock, -2); assert.equal(result.newStock, 4);
  assert.equal(mock.data.get(stockPath("location", "origin")).currentStock, 4);
  assert.ok([...mock.data.values()].some(data => data.action === "stock.adjust" && data.previousStock === -2));
});

for(const originType of ["warehouse","location"])for(const destinationType of ["warehouse","location"]){
  test(`transferencia ${originType} → ${destinationType}: faltantes/pérdidas no ingresan al destino y reintentos no duplican`,async()=>{
    seed(originType,destinationType);
    if(originType==="location")mock.data.get("locations/origin").active=false;
    const args=transfer(originType,destinationType);
    const [result,repeated]=await Promise.all([service.transferStock(args),service.transferStock(args)]);
    assert.equal(result.id,repeated.id);
    assert.equal(mock.data.get(stockPath(originType,"origin")).currentStock,0);
    const destination=mock.data.get(stockPath(destinationType,"destination"));
    assert.equal(destination.currentStock,28);assert.equal(destination.priceOverride,1700);assert.equal(destination.yellowAlertQty,8);assert.equal(destination.active,false);
    assert.equal(result.receivedQuantity,18);assert.equal(result.missingQuantity,1);assert.equal(result.lostQuantity,1);assert.equal(result.status,"completed");assert.equal(result.carrierName,"Transportista QA");assert.equal(result.receivedBy,admin.id);
    assert.equal(mock.data.get("stockMovements/transfer-qa_oil_in").qty,18);
    assert.equal(mock.data.get("stockMovements/transfer-qa_oil_out").qty,-20);
    assert.equal([...mock.data.keys()].filter(key=>key.startsWith("stockMovements/")).length,2);
    assert.equal(mock.data.get("auditLogs/transfer-qa").lostQuantity,1);
  });
}

test("transferencias inválidas son atómicas: duplicados, recepción excesiva y stock insuficiente",async()=>{
  for(const lines of [[{productId:"oil",quantity:10},{productId:"oil",quantity:10}],[{productId:"oil",quantity:20,preparedQuantity:19,receivedQuantity:20}],[{productId:"oil",quantity:21}],[{productId:"oil",quantity:20,preparedQuantity:""}]]){
    seed();const before=structuredClone(mock.data);await assert.rejects(service.transferStock(transfer("warehouse","location",{lines})));assert.deepEqual(mock.data,before);assert.equal(mock.writes.length,0);
  }
});

test("nuevo destino habilita el mismo ID global, usa precio base y umbrales locales sin copiar el maestro",async()=>{
  seed();mock.data.delete(stockPath("location","destination"));
  await service.transferStock(transfer());const item=mock.data.get(stockPath("location","destination"));
  assert.equal(item.productId,"oil");assert.equal(item.currentStock,18);assert.equal(item.priceMode,"default");assert.equal(item.yellowAlertQty,0);assert.equal(item.redAlertQty,0);assert.equal([...mock.data.keys()].filter(k=>k.startsWith("products/")).length,1);
});

test("ajuste físico exige autorización y registra anterior, real, delta y auditoría de manera idempotente",async()=>{
  seed();const args={type:"warehouse",inventory:{id:"origin"},product:{productId:"oil",productName:"Aceite"},quantity:19,reason:"Conteo físico",requestId:"adjust-qa",profile:admin};
  await assert.rejects(service.adjustInventoryStock({...args,profile:{id:"manager",role:"warehouse_manager",active:true}}),/permiso/);
  await service.adjustInventoryStock(args);await service.adjustInventoryStock(args);
  assert.equal(mock.data.get(stockPath("warehouse","origin")).currentStock,19);
  assert.equal(mock.data.get("stockMovements/adjust-qa_oil").qty,-1);assert.equal(mock.data.get("stockMovements/adjust-qa_oil").previousStock,20);assert.equal(mock.data.get("auditLogs/adjust-qa").newStock,19);
});

test("crear/editar ubicación conserva historial y calendario anterior; pausar/reactivar no elimina datos",async()=>{
  reset();const values={name:"Feria QA",type:"fair",codePrefix:"FQA",dniMode:"optional",requestId:"location-qa",operatingCalendar:{weekdays:[6,7],openingTime:"09:00",closingTime:"18:00",dates:["2026-10-03"]}};
  const id=await service.saveManagedLocation(values,admin);await service.saveManagedLocation(values,admin);assert.equal(id,"location-qa");
  mock.data.set("sales/historic",{locationId:id,total:100});mock.data.set(`locationStock/${id}/items/oil`,{currentStock:5});
  await service.saveManagedLocation({...values,operatingCalendar:{weekdays:[7],openingTime:"10:00",closingTime:"17:00"}},admin,id);
  assert.ok([...mock.data.values()].some(v=>v.previousCalendar?.openingTime==="09:00"));
  const calendar = structuredClone(mock.data.get(`locations/${id}`).operatingCalendar);
  await service.saveManagedLocation({ ...values, operatingCalendar: undefined }, admin, id);
  assert.deepEqual(mock.data.get(`locations/${id}`).operatingCalendar, calendar);
  mock.data.get(`locations/${id}`).manualInactiveDays = 3;
  mock.data.get(`locations/${id}`).manualInactiveUntilDateTime = "2030-01-01";
  await service.setLocationLifecycle({id,name:values.name,manualInactiveUntilDateTime:"2030-01-01"},"pause",admin);assert.equal(mock.data.get(`locations/${id}`).active,false);assert.equal(mock.data.get(`locations/${id}`).manualInactiveDays,null);assert.equal(mock.data.get(`locations/${id}`).manualInactiveUntilDateTime,null);
  await service.setLocationLifecycle({id,name:values.name},"activate",admin);assert.equal(mock.data.get(`locations/${id}`).active,true);assert.equal(mock.data.get("sales/historic").total,100);assert.equal(mock.data.get(`locationStock/${id}/items/oil`).currentStock,5);
  await assert.rejects(service.saveManagedLocation({...values,type:"warehouse_store",requestId:"bad-warehouse"},admin),/depósitos/);
});

test("habilitar producto sin permiso de cargar stock permite cero; configuración no altera cantidades y se audita",async()=>{
  reset();mock.data.set("locations/local",{name:"Local",active:true});mock.data.set("products/oil",{name:"Aceite",defaultPrice:2500,active:true});
  const profile={id:"custom",active:true,role:"analyst",permissions:{locations:["view","configureLocationProducts"]}};
  const args={location:{id:"local",name:"Local"},product:{id:"oil"},initialStock:2,profile,requestId:"assign-qa"};
  await assert.rejects(service.addProductToLocation(args),/cargar cantidades/);
  await service.addProductToLocation({...args,initialStock:0});
  await service.saveLocationProductSettings({location:args.location,productId:"oil",values:{useDefaultPrice:false,priceOverride:2000,yellowAlertQty:5,redAlertQty:2},profile});
  assert.equal(mock.data.get("locationStock/local/items/oil").currentStock,0);assert.ok([...mock.data.values()].some(v=>v.action==="locationProduct.configured"&&v.newSettings.priceOverride===2000));
  mock.data.get("locationStock/local/items/oil").currentStock = 7;
  await service.saveLocationProductConfiguration({ location: args.location, product: { id: "oil", hasLocalRecord: false }, values: { price: 0 }, profile });
  assert.equal(mock.data.get("locationStock/local/items/oil").currentStock, 7);
  assert.equal(mock.data.get("locationStock/local/items/oil").priceOverride, 0);
});

test("la carga masiva rechaza duplicados y no permite que cargar reemplace un stock inicial existente sin permiso de ajuste",async()=>{
  seed("location");const args={location:{id:"origin",active:true,name:"Origen"},mode:"add",operationId:"bulk-qa",profile:admin,entries:[{product:{id:"oil",name:"Aceite"},quantity:2},{product:{id:"oil",name:"Aceite"},quantity:3}]};
  await assert.rejects(service.loadLocationStock(args),/una sola vez/);assert.equal(mock.writes.length,0);
  const profile={id:"loader",role:"analyst",active:true,permissions:{locations:["loadStock"]}};
  await assert.rejects(service.loadLocationStock({...args,profile,mode:"initial",entries:[{product:{id:"oil",name:"Aceite"},quantity:3}]}),/ajuste/);
});

test("historial limita después de ordenar en Firestore; depósito nace separado y vacío",async()=>{
  reset();await service.listInventoryMovements({type:"warehouse",inventoryId:"origin",productId:"oil",pageSize:30});assert.ok(mock.queries[0].constraints.some(c=>c.field==="createdAt"&&c.direction==="desc"));
  const id=await service.createWarehouse({values:{name:"Central QA"},profile:admin});assert.equal(mock.data.get(`warehouses/${id}`).name,"Central QA");assert.equal([...mock.data.keys()].filter(k=>k.startsWith("locations/")||k.startsWith("warehouseStock/")).length,0);
});

test("precio efectivo consistente en catálogo/ventas, cero propio válido y calendario nocturno validado",()=>{
  assert.equal(joinMasterProducts([{id:"oil",defaultPrice:3000}],[{productId:"oil",priceMode:"default",price:1000}])[0].price,3000);
  assert.equal(joinMasterProducts([{id:"oil",defaultPrice:3000}],[{productId:"oil",priceMode:"custom",priceOverride:0}])[0].price,0);
  assert.equal(normalizeOperatingCalendar({weekdays:[1,1,7],openingTime:"22:00",closingTime:"02:00"}).overnight,true);
  assert.throws(()=>normalizeOperatingCalendar({dates:["2026-02-30"]}));assert.throws(()=>normalizeOperatingCalendar({openingTime:"10:00"}));assert.throws(()=>normalizeOperatingCalendar({weekdays:[8]}));
  assert.deepEqual(reconcileTransferLine({quantity:20,preparedQuantity:19,receivedQuantity:18},20),{quantity:20,preparedQuantity:19,receivedQuantity:18,missingQuantity:1,lostQuantity:1});
});
