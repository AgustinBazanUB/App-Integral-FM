import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc} from 'firebase/firestore';
import {pathToFileURL} from 'node:url';
const base='c975b8b46509d91122f1c4ad1ad5129acf8763f7';
const rules=execFileSync('git',['show',`${base}:firestore.rules`],{encoding:'utf8'});
const environment=await initializeTestEnvironment({projectId:'demo-stage7-base-comparison',firestore:{host:'127.0.0.1',port:8187,rules}});
const proof={base,fixture:'MOCK_ONLY',cases:[]};
try{
 await environment.withSecurityRulesDisabled(async context=>{const db=context.firestore();for(const role of ['admin','seller'])await setDoc(doc(db,'users',role),{active:true,role,allowedLocationIds:['loc1']});await setDoc(doc(db,'locations','loc1'),{active:true,deleted:false});await setDoc(doc(db,'sales','s1'),{sellerId:'seller',locationId:'loc1',status:'active',sourceType:'seller_sale',total:1210,fiscalInvoiceId:'invoice1',fiscalInvoice:{status:'authorized',cae:'12345678901234'}});});
 for(const role of ['admin','seller']){await assertSucceeds(updateDoc(doc(environment.authenticatedContext(role).firestore(),'sales','s1'),{total:10,'fiscalInvoice.cae':'99999999999999'}));proof.cases.push({case:`${role} SDK modifica venta facturada y espejo en base`,baseline:'ALLOWED',current:'DENIED - rules-final.log'});}
}finally{await environment.cleanup();}
if(!process.env.QA_BASE_ROOT)throw Error('Definir QA_BASE_ROOT como checkout detached de c975b8b para comparar sin modificarlo');
const baseLock=await import(pathToFileURL(process.env.QA_BASE_ROOT+'/netlify/functions/_lib/arca/sequenceLock.mjs'));
const result=await baseLock.acquireSequenceLock({pointOfSale:3,voucherType:6,holder:'new-worker',env:{ARCA_ENVIRONMENT:'homologation'},getDocument:async()=>({updateTime:'old',data:{holder:'old-worker',leaseExpiresAt:'2020-01-01',reservation:{invoiceId:'uncertain-invoice'}}}),patchDocument:async()=>({updateTime:'new'})});
if(!result.acquired)throw Error('Base probe changed');proof.cases.push({case:'lease vencido con reserva incierta',baseline:'ACQUIRED',current:'BLOCKED - arca-recovery test durable reservation'});
const baseAuthorizer=await import(pathToFileURL(process.env.QA_BASE_ROOT+'/netlify/functions/_lib/arca/authorizer.mjs'));
let consulted=0;
await baseAuthorizer.reconcileInvoice({invoiceId:'qa-rejected',env:{ARCA_ENVIRONMENT:'homologation'},getDocument:async()=>({updateTime:'old',data:{fiscalEnvironment:'homologation',status:'rejected',authorization:{voucherType:6,pointOfSale:3,voucherNumber:8}}}),consultVoucherFn:async()=>{consulted++;return {errors:[]};},markReconcilingFn:async()=>({data:{status:'reconciling'}})});
if(consulted!==0)throw Error('Base rejected reconciliation probe changed');proof.cases.push({case:'reconcile explícito de invoice rechazada',baseline:'BLOCKED_WITHOUT_CONSULT',current:'BLOCKED_WITHOUT_CONSULT - regresión intermedia Etapa 7 detectada y corregida'});
const basePersistence=await import(pathToFileURL(process.env.QA_BASE_ROOT+'/netlify/functions/_lib/arca/invoicePersistence.mjs'));
let code=null;try{await basePersistence.ensurePendingInvoice({sourceType:'ecommerce',sourceId:'qa-sale',env:{ARCA_ENVIRONMENT:'homologation'},getDocument:async(path)=>({data:path.startsWith('sales/')?{sourceType:'ecommerce',status:'active',paymentProvider:'simulation',paymentStatus:'simulated_approved',invoiceStatus:'authorized',items:[{qty:1}],fiscalInvoiceId:'invoice_homologation_ecommerce_qa-sale',fiscalEnvironment:'homologation'}:{sourceType:'ecommerce',sourceId:'qa-sale',fiscalEnvironment:'homologation',status:'authorized'}}),createDocument:async()=>{throw Error('Unexpected create');}});}catch(error){code=error.code;}
if(code!=='arca-invoice-not-requested')throw Error('Base ecommerce terminal probe changed');proof.cases.push({case:'cargar invoice ecommerce terminal tras sincronizar venta',baseline:code,current:'REUSES_AUTHORIZED - all three source tests after sync'});
await writeFile('.netlify/stage7-qa/base-comparison.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
