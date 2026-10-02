import test, {before,after} from 'node:test';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc} from 'firebase/firestore';
let environment;
before(async()=>{
 environment=await initializeTestEnvironment({projectId:'demo-ecommerce-stage6-rules',firestore:{rules:await readFile(new URL('../firestore.rules',import.meta.url),'utf8')}});
 await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  for(const role of ['admin','seller'])await setDoc(doc(db,`users/qa-${role}`),{role,active:true,name:'QA',allowedLocationIds:['qa-local']});
  for(const [path,data] of Object.entries({'orders/qa-order':{sourceType:'ecommerce',paymentStatus:'pending'},'payments/qa-payment':{sourceType:'ecommerce',status:'pending'},'sales/qa-sale':{sourceType:'ecommerce',sourceChannel:'ecommerce',status:'active',locationId:'qa-local',sellerId:'qa-seller',total:22000},'invoices/qa-invoice':{sourceType:'ecommerce',status:'pending'}}))await setDoc(doc(db,path),data);
 });
});
after(async()=>environment?.cleanup());
for(const role of ['admin','seller']){
 for(const collection of ['orders','payments','sales','invoices'])test(`Etapa 6 Rules: ${role} navegador no crea ${collection}`,async()=>{const db=environment.authenticatedContext(`qa-${role}`).firestore();await assertFails(setDoc(doc(db,`${collection}/browser-${role}`),{sourceType:'ecommerce',status:'pending',locationId:'qa-local',sellerId:`qa-${role}`,total:1,createdAt:new Date()}));});
 for(const [label,path,data] of [
  ['Order','orders/qa-order',{total:1}],['Order paymentStatus','orders/qa-order',{paymentStatus:'simulated_approved'}],['Payment','payments/qa-payment',{status:'approved'}],['Sale comercial','sales/qa-sale',{total:1}],['Sale fiscal','sales/qa-sale',{fiscalEnvironment:'production'}],['Sale CAE','sales/qa-sale',{fiscalInvoice:{cae:'blocked-test'}}],['Sale invoice status','sales/qa-sale',{invoiceStatus:'authorized'}],['Sale voucher number','sales/qa-sale',{fiscalInvoice:{voucherNumber:1}}],['Sale invoice link','sales/qa-sale',{fiscalInvoiceId:'browser-link'}],['Invoice','invoices/qa-invoice',{status:'authorized'}],['Invoice CAE','invoices/qa-invoice',{authorization:{cae:'blocked-test'}}],
 ])test(`Etapa 6 Rules: ${role} navegador no modifica ${label}`,async()=>{const db=environment.authenticatedContext(`qa-${role}`).firestore();await assertFails(updateDoc(doc(db,path),data));});
}
