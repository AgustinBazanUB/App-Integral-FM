import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceVoiceCollection } from '../src/shared/oliviaVoiceCollection.mjs';
import { capabilityAllowed } from '../src/shared/oliviaCapabilities.mjs';
import { catalogStockPlan } from '../netlify/functions/_lib/olivia/catalogStock.mjs';
import { progressiveStock } from '../netlify/functions/_lib/olivia/tasks.mjs';
import { manageConversationTask } from '../netlify/functions/_lib/olivia/conversationTasks.mjs';
import { startDelegatedTask } from '../netlify/functions/_lib/olivia/delegatedTasks.mjs';
import { createOliviaEngine } from '../netlify/functions/_lib/olivia/engine.mjs';
import { fixture, start } from './helpers/olivia-fixture.mjs';

const warehouseProfile = { id:'warehouse-user', name:'Warehouse QA', role:'warehouse_manager', active:true };

test('pausing and resuming a warehouse collection retains its unverified destination before product dictation',async()=>{
  const {run}=stockTools();
  const first=await progressiveStock({initialId:'paused-warehouse',message:'Quiero cargar stock en el depósito Norte',context:{},run});
  const paused=manageConversationTask({task:first.task},'pause');
  const resumed=manageConversationTask(paused,'resume');
  const next=await progressiveStock({previous:resumed.task,message:'Diez botellas de Aceite Arbequina',context:{},run});
  assert.equal(next.task.status,'prepared');
  assert.equal(next.task.slots.warehouseId,'warehouse-b');
});

function stockTools(){
  const calls=[];
  const run=async(name,args)=>{
    calls.push({name,args});
    if(name==='list_warehouses')return {data:{records:[{id:'warehouse-b',name:'Norte',active:true}]}};
    if(name==='list_locations')return {data:{locations:[{id:'local-b',name:'Norte',active:true}]}};
    if(name==='search_products')return {data:{products:[{productId:'oil',name:'Aceite Arbequina'},{productId:'coratina',name:'Aceite Coratina'}]}};
    if(name.startsWith('prepare_'))return {prepared:{canonicalArgs:args,summary:'Lista de QA preparada.'},data:{state:'ESPERANDO_CONFIRMACION'}};
    throw new Error(`Unexpected tool ${name}`);
  };
  return {calls,run};
}

test('a complete spoken-style text warehouse request uses the warehouse tool without a client collection payload',async()=>{
  const {calls,run}=stockTools();
  const result=await progressiveStock({initialId:'native-warehouse',message:'Cargá diez botellas de Aceite Arbequina en el depósito Norte',context:{},run});
  assert.equal(result.task.intent,'prepare_warehouse_stock_load');
  assert.equal(result.task.slots.warehouseId,'warehouse-b');
  assert.equal(calls.some(call=>call.name==='prepare_stock_load'||call.name==='prepare_catalog_stock_load'),false);
});

test('accented inventory nouns are destinations and never phantom merchandise',()=>{
  const empty=advanceVoiceCollection('Quiero cargar stock en un depósito');
  assert.equal(empty.targetType,'warehouse');
  assert.deepEqual(empty.itemsMentioned,[]);
  const named=advanceVoiceCollection('Cargá diez botellas de Aceite Arbequina en el depósito Norte');
  assert.equal(named.requestedWarehouse,'Norte');
  assert.equal(named.itemsMentioned[0].description,'Aceite Arbequina');
  assert.deepEqual(advanceVoiceCollection('Cargá diez',empty).itemsMentioned,[]);
});

test('a native warehouse dialogue retains its target, clarifies one-item correction and safely switches to a location',async()=>{
  const {calls,run}=stockTools();let previous;
  const say=async message=>{const result=await progressiveStock({previous,initialId:'warehouse-dialogue',message,context:{},run});assert.ok(result,message);previous=result.task;return result;};
  await say('Quiero cargar stock en un depósito');
  await say('Depósito Norte');
  assert.equal(previous.collectionDraft.requestedWarehouse,'Norte');
  await say('Diez botellas de Aceite Arbequina y cinco de Aceite Coratina');
  assert.equal(previous.status,'prepared');
  assert.equal(previous.slots.warehouseId,'warehouse-b');
  const preparedCount=()=>calls.filter(call=>call.name.startsWith('prepare_')).length;
  assert.equal(preparedCount(),1);
  const ambiguous=await say('No, eran quince');
  assert.equal(previous.status,'collecting');
  assert.match(ambiguous.content,/cuál producto/);
  assert.equal(preparedCount(),1,'an ambiguous quantity must not prepare an unchanged proposal');
  await say('Aceite Coratina');
  assert.deepEqual(previous.slots.items.map(item=>item.quantity),[10,15]);
  await say('No, en el local Norte');
  assert.equal(previous.id,'warehouse-dialogue');
  assert.equal(previous.intent,'prepare_catalog_stock_load');
  assert.equal(previous.slots.locationId,'local-b');
  assert.equal(Object.hasOwn(previous.slots,'warehouseId'),false);
  assert.deepEqual(previous.slots.items.map(item=>item.quantity),[10,15]);
  assert.equal(preparedCount(),3);
});

test('a newly submitted voice collection keeps its new task identity beside an older stock proposal',async()=>{
  const {run}=stockTools();
  const previous={id:'older-stock',intent:'prepare_warehouse_stock_load',status:'prepared',revision:1,slots:{warehouseId:'older-warehouse',items:[]}};
  const context={voiceCollectionDraft:{intent:'stock-load',targetType:'warehouse',requestedWarehouse:'Norte',itemsMentioned:[{description:'Aceite Arbequina',quantityMentioned:'diez'}]}};
  const result=await progressiveStock({previous,initialId:'new-stock',message:'Nueva carga',context,run});
  assert.equal(result.task.id,'new-stock');
  assert.equal(previous.id,'older-stock');
  assert.equal(result.task.slots.warehouseId,'warehouse-b');
});

test('warehouse capability follows warehouse edit permission and remains unavailable to sellers',()=>{
  assert.equal(capabilityAllowed({profile:warehouseProfile},'prepare_warehouse_stock_load'),true);
  assert.equal(capabilityAllowed({profile:{...warehouseProfile,role:'seller'}},'prepare_warehouse_stock_load'),false);
});

test('a recent warehouse list resolves an ordinal destination without converting it into a location',()=>{
  const draft=advanceVoiceCollection('Quiero cargar diez botellas de Aceite en el segundo',null,{messages:[{role:'assistant',content:'Los depósitos activos son: Central, Norte.'}]});
  assert.equal(draft.targetType,'warehouse');
  assert.equal(draft.targetOrdinal,2);
  assert.equal(draft.status,'ready');
  assert.equal(draft.requestedLocation,null);
});

test('the deterministic multi-item collector resolves the second real warehouse and hands off one prepared list',async()=>{
  const calls=[];
  const run=async(name,args)=>{
    calls.push({name,args});
    if(name==='list_warehouses')return {data:{records:[{id:'warehouse-a',name:'Central',active:true},{id:'warehouse-b',name:'Norte',active:true}]}};
    if(name==='search_products')return {data:{products:[{productId:'oil',name:'Aceite Arbequina'}]}};
    if(name==='prepare_warehouse_stock_load')return {prepared:{canonicalArgs:args,summary:'Preparar ingreso en Norte: +10 Aceite Arbequina.'},data:{state:'ESPERANDO_CONFIRMACION'}};
    throw new Error(`Unexpected tool ${name}`);
  };
  const result=await progressiveStock({initialId:'task-voice-stock',message:'Diez botellas de Aceite Arbequina',context:{voiceCollectionDraft:{intent:'stock-load',targetType:'warehouse',targetOrdinal:2,requestedWarehouse:null,itemsMentioned:[{description:'Aceite Arbequina',quantityMentioned:'diez'}]}},run,check:name=>calls.push({check:name})});
  assert.equal(result.task.status,'prepared');
  assert.equal(result.task.intent,'prepare_warehouse_stock_load');
  const prepared=calls.find(call=>call.name==='prepare_warehouse_stock_load');
  assert.equal(prepared.args.warehouseId,'warehouse-b');
  assert.deepEqual(prepared.args.items.map(({name,quantity,productId})=>({name,quantity,productId})),[{name:'Aceite Arbequina',quantity:10,productId:'oil'}]);
  assert.equal(calls.filter(call=>call.name==='prepare_warehouse_stock_load').length,1);
});

test('warehouse plan writes the warehouse schema and keeps stock unchanged until confirmation',async()=>{
  const product={id:'oil',name:'Aceite Arbequina',abbreviation:'AA',categoryId:'cat',categoryName:'Aceites',defaultPrice:8500,active:true,deleted:false};
  const documents=new Map([
    ['warehouses/warehouse-a',{id:'warehouse-a',name:'Central QA',active:true,deleted:false}],
    ['products/oil',product],
    ['warehouseStock/warehouse-a/items/oil',{productId:'oil',currentStock:4,initialStock:4,active:true,deleted:false}],
    ['productCategories/cat',{id:'cat',name:'Aceites',active:true,deleted:false}],
  ]);
  const store={get:async path=>documents.get(path)||null,list:async path=>path==='products'?[product]:path==='productCategories'?[documents.get('productCategories/cat')]:[]};
  const session={uid:'admin-qa',profile:{id:'admin-qa',name:'Admin QA',role:'admin',active:true}};
  const plan=await catalogStockPlan({session,args:{warehouseId:'warehouse-a',reason:null,items:[{productId:'oil',name:'Aceite Arbequina',quantity:10,categoryName:null,abbreviation:null,defaultPrice:null}]},store,entityId:'preview-operation',targetType:'warehouse'});
  assert.equal(plan.toolName,'prepare_warehouse_stock_load');
  assert.match(plan.summary,/Central QA/);
  assert.match(plan.summary,/4 → 14/);
  assert.equal(plan.writes.find(write=>write.path==='warehouseStock/warehouse-a/items/oil').data.currentStock,14);
  assert.equal(Object.hasOwn(plan.writes.find(write=>write.path==='warehouseStock/warehouse-a/items/oil').data,'price'),false);
  assert.equal(plan.writes.some(write=>write.path.startsWith('locationStock/')),false);
  assert.equal(documents.get('warehouseStock/warehouse-a/items/oil').currentStock,4,'planning is read-only');
});

test('a warehouse manager with catalog access can prepare the first product assignment without location permissions',async()=>{
  const product={id:'oil',name:'Aceite QA',abbreviation:'AQA',categoryId:'',categoryName:'Sin categoría',defaultPrice:1000,active:true,deleted:false};
  const documents=new Map([['warehouses/warehouse-a',{name:'Depósito QA',active:true}],['products/oil',product]]);
  const store={get:async path=>documents.get(path)||null,list:async path=>path==='products'?[product]:[]};
  const profile={...warehouseProfile,permissionAllow:{products:['view']}};
  const plan=await catalogStockPlan({session:{uid:warehouseProfile.id,profile},args:{warehouseId:'warehouse-a',reason:'Auditoría QA',items:[{productId:'oil',name:'Aceite QA',quantity:3,categoryName:null,abbreviation:null,defaultPrice:null}]},store,entityId:'first-warehouse-assignment',targetType:'warehouse'});
  const stock=plan.writes.find(write=>write.path==='warehouseStock/warehouse-a/items/oil');
  assert.equal(stock.type,'create');
  assert.equal(stock.data.currentStock,3);
  assert.equal(stock.data.initialStock,3);
  assert.equal(Object.hasOwn(stock.data,'price'),false);
  assert.equal(plan.writes.some(write=>write.path.startsWith('locationStock/')),false);
  assert.equal(documents.has('warehouseStock/warehouse-a/items/oil'),false,'preparation must not write stock');
});

test('delegated voice draft creates one visual confirmation and commits warehouse stock only through confirm()',async()=>{
  const f=fixture({role:'admin',provider:async()=>{assert.fail('warehouse list preparation must not call Luna');}});
  f.session.email='agsreserva@gmail.com';
  f.config.hybridVoice.enabled=true;f.documents.set('oliviaConfiguration/global',f.config);
  f.engine=createOliviaEngine({store:f.store,clock:f.clock,provider:async()=>{assert.fail('warehouse list preparation must not call Luna');},env:{OPENAI_API_KEY:'fixture',OLIVIA_DEPLOY_PREVIEW_CONTEXT:'deploy-preview',OLIVIA_HYBRID_LIVE_ENABLED:'true',GEMINI_API_KEY:'synthetic',GEMINI_API_BILLING_TIER:'paid',FIREBASE_PROJECT_ID:'app-integral-fm-pruebas'}});
  f.documents.set('warehouses/warehouse-qa',{name:'Depósito QA',active:true,deleted:false});
  f.documents.set('warehouseStock/warehouse-qa/items/oil',{productId:'oil',productName:'Aceite',currentStock:4,initialStock:4,active:true,deleted:false});
  const conversation=await start(f),root=f.documents.get(`oliviaConversations/${conversation.conversationId}`);
  const initial=advanceVoiceCollection('Quiero cargar stock');
  const selectedType=advanceVoiceCollection('En un depósito',initial);
  const target=advanceVoiceCollection('Depósito QA',selectedType);
  const ready=advanceVoiceCollection('Diez botellas de Aceite',target);
  assert.equal(ready.status,'ready');
  root.voiceCollection=ready;
  root.conversationFocus={activeIntentId:'stock-load',intentEpoch:4,activeDraftId:'draft-stock',draftStatus:'ready',turnId:'turn-stock-4',sessionId:'session-a',turnIndex:4};
  const request={conversationId:root.id,requestId:'turn-stock-4',message:ready.turns.join('\n'),collectionRevision:ready.revision,voiceCollectionDraft:{intent:'stock-load',revision:ready.revision,targetType:'warehouse',requestedWarehouse:ready.requestedWarehouse,itemsMentioned:ready.itemsMentioned.map(item=>({description:item.description,quantityMentioned:item.quantityMentioned}))},intentEpoch:4,focusTurnId:'turn-stock-4',focusSessionId:'session-a',screenContext:{module:'warehouse'}};
  const task=await startDelegatedTask({store:f.store,engine:f.engine,session:f.session,body:request,dispatch:async()=>{},now:f.clock()});
  const savedTask=f.documents.get(`oliviaConversations/${root.id}/delegatedTasks/${task.id}`);
  assert.equal(task.status,'awaiting-confirmation',JSON.stringify({task,failure:savedTask?.failure}));
  assert.ok(savedTask.pendingAction?.confirmationToken);
  assert.equal(f.documents.get('warehouseStock/warehouse-qa/items/oil').currentStock,4,'voice dispatch only prepares the card');
  assert.equal(f.documents.has(`inventoryOperations/olivia_stock_${savedTask.pendingAction.confirmationToken.split('.')[0]}`),false);
  await f.engine.confirm(f.session,{conversationId:savedTask.scopeId,confirmationToken:savedTask.pendingAction.confirmationToken});
  assert.equal(f.documents.get('warehouseStock/warehouse-qa/items/oil').currentStock,14);
  assert.ok([...f.documents.keys()].some(path=>path.startsWith('inventoryOperations/')));
  assert.equal([...f.documents.keys()].some(path=>path.startsWith('locationStock/')),true,'only the fixture location inventory remains; no location load is written');
});
