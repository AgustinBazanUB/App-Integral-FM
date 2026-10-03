import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import './guard.mjs';
import {adminGetDocument,adminCreateDocument,adminPatchDocument,adminListDocuments} from '../../netlify/functions/_lib/firestoreAdminRest.mjs';
import {ensurePendingInvoice,syncInvoiceToSale} from '../../netlify/functions/_lib/arca/invoicePersistence.mjs';
import {authorizeInvoice,reconcileInvoice} from '../../netlify/functions/_lib/arca/authorizer.mjs';
const env={...process.env,NODE_ENV:'test',ARCA_ALLOW_CAE_HOMOLOGATION:'true'};
const receiver={vatConditionId:5,documentType:99,documentNumber:'0',anonymousConsumerFinal:true,concept:1};
const users=JSON.parse(await readFile(new URL('./auth-fixtures.json',import.meta.url)));
const key=process.env.QA_FISCAL_KEY||'qa_fiscal_stage7_1';
const proof=[];
let last=0;
async function fixture(sourceType,index=''){
 const id=`${key}_${sourceType}${index}`;
 await adminCreateDocument('sales',id,{sourceType,sellerId:users.seller.uid,status:'active',invoiceStatus:'pending',ticketRequested:true,paymentProvider:'simulation',paymentStatus:'simulated_approved',saleCode:`MOCK-SIN-EMISION-${sourceType}${index}`,total:1210,subtotal:1210,totalItems:1,locationId:'qa-local',items:[{productId:'qa-product',name:'Producto MOCK QA',qty:1,unitPrice:1210,subtotal:1210,arcaVatRate:21}],createdAt:new Date()});
 return ensurePendingInvoice({sourceType,sourceId:id,requestedBy:users.admin.uid,receiver,env});
}
const transport={getLastAuthorizedFn:async()=>({number:last,errors:[]}),requestCaeFn:async({details})=>{last=details[0].voucherFrom;return{result:'A',cae:'12345678901234',caeExpiration:'20261231',voucherFrom:last,voucherTo:last,errors:[]};}};
for(const sourceType of ['admin_quick_sale','seller_sale','ecommerce'])test(`Firestore REST real: ${sourceType}, dos workers, sync, terminal`,async()=>{
 const p=await fixture(sourceType);let sent=0;
 const opts={invoiceId:p.invoiceId,issuerVatCondition:'responsable_inscripto',env,allowCaeRequest:true,...transport,requestCaeFn:async(input)=>{sent++;return transport.requestCaeFn(input);}};
 const result=await Promise.all([authorizeInvoice(opts),authorizeInvoice(opts)]);assert.equal(sent,1);assert.equal(result.some(r=>r.status==='authorized'),true);
 await syncInvoiceToSale({invoiceId:p.invoiceId,env});const sale=await adminGetDocument(`sales/${p.invoice.sourceId}`);assert.equal(sale.data.fiscalInvoiceId,p.invoiceId);assert.equal(sale.data.invoiceStatus,'authorized');
 const again=await authorizeInvoice(opts);assert.equal(again.alreadyAuthorized,true);assert.equal(sent,1);
 const reloaded=await ensurePendingInvoice({sourceType,sourceId:p.invoice.sourceId,receiver,env});assert.equal(reloaded.created,false);assert.equal(reloaded.invoice.status,'authorized');
 await adminPatchDocument(`invoices/${p.invoiceId}`,{qaMock:true});
 proof.push({sourceType,invoiceId:p.invoiceId,saleId:p.invoice.sourceId,sentMock:sent,realCAERequests:0,status:again.status});
});
test('Firestore REST real: timeout bloquea otra invoice y reconciliación exacta libera',async()=>{
 const p=await fixture('admin_quick_sale','_uncertain');const opts={invoiceId:p.invoiceId,issuerVatCondition:'responsable_inscripto',env,allowCaeRequest:true,...transport};
 const r=await authorizeInvoice({...opts,requestCaeFn:async()=>{throw Object.assign(new Error('mock timeout'),{code:'arca-timeout',status:504});},consultVoucherFn:async()=>({errors:[{code:602}]})});assert.equal(r.status,'reconciling');
 const lockBefore=await adminGetDocument('arcaSequenceLocks/homologation_pos_3_type_6');assert.equal(lockBefore.data.reservation.invoiceId,p.invoiceId);
 const other=await fixture('seller_sale','_after_uncertain');let sent=0;const blocked=await authorizeInvoice({...opts,invoiceId:other.invoiceId,requestCaeFn:async()=>{sent++;}});assert.equal(blocked.lockAcquired,false);assert.equal(sent,0);
 const current=await adminGetDocument(`invoices/${p.invoiceId}`);const a=current.data.authorization;
 const reconciled=await reconcileInvoice({invoiceId:p.invoiceId,env,consultVoucherFn:async()=>({...a.requestSnapshot,result:'A',cae:'12345678901234',caeExpiration:'20261231',pointOfSale:a.pointOfSale,voucherType:a.voucherType,voucherNumber:a.voucherNumber,voucherTo:a.voucherNumber,errors:[]})});assert.equal(reconciled.status,'authorized');
 const lockAfter=await adminGetDocument('arcaSequenceLocks/homologation_pos_3_type_6');assert.equal(lockAfter.data.reservation,null);
 await syncInvoiceToSale({invoiceId:p.invoiceId,env});await adminPatchDocument(`invoices/${p.invoiceId}`,{qaMock:true});
 proof.push({case:'uncertain',invoiceId:p.invoiceId,otherInvoiceId:other.invoiceId,status:reconciled.status,otherBlocked:true,realCAERequests:0});
});
test('Netlify Dev: review, capability y gates reales cerrados',async()=>{
 for(const row of proof.filter(p=>p.sourceType)){
  const response=await fetch('http://localhost:8887/.netlify/functions/arca-authorize',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${users.admin.token}`},body:JSON.stringify({mode:'review',invoiceId:row.invoiceId})});const body=await response.json();assert.equal(response.status,200);assert.equal(body.result.terminal,true);assert.equal(body.result.caeRequested,false);
 }
 const p=await fixture('admin_quick_sale','_gate');
 const response=await fetch('http://localhost:8887/.netlify/functions/arca-authorize',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${users.admin.token}`},body:JSON.stringify({mode:'authorize',invoiceId:p.invoiceId})});const body=await response.json();assert.equal(response.status,409);assert.equal(body.code,'arca-cae-disabled');
 const invoices=await adminListDocuments('invoices');for(const row of proof.filter(item=>item.saleId))assert.equal(invoices.filter(item=>item.sourceId===row.saleId).length,1);
 await writeFile(new URL('./fiscal-integration-proof.json',import.meta.url),JSON.stringify({proof,realCAERequests:0,fixture:'MOCK_ONLY'},null,2));
});
