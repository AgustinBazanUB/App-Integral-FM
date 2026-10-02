import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import './guard.mjs';
import {adminGetDocument,adminCreateDocument} from '../../netlify/functions/_lib/firestoreAdminRest.mjs';
import {ensurePendingInvoice,syncInvoiceToSale} from '../../netlify/functions/_lib/arca/invoicePersistence.mjs';
const exec=promisify(execFile);
test('dos procesos Node independientes, REST Emulator: un envío mock, una Invoice y un mirror',async()=>{
 const saleId=process.env.QA_WORKER_KEY||'qa_fiscal_two_processes_stage7';
 const template={sourceType:'seller_sale',status:'active',ticketRequested:true,total:1210,subtotal:1210,totalItems:1,
   items:[{productId:'qa-product',name:'Producto MOCK QA',qty:1,unitPrice:1210,subtotal:1210,arcaVatRate:21}]};
 delete template.fiscalInvoice;delete template.fiscalInvoiceId;delete template.fiscalEnvironment;delete template.fiscalUpdatedAt;
 template.saleCode='MOCK-SIN-EMISION-TWO-PROCESSES';template.invoiceStatus='pending';template.qaMock=true;
 await adminCreateDocument('sales',saleId,template);
 const p=await ensurePendingInvoice({sourceType:'seller_sale',sourceId:saleId,receiver:{vatConditionId:5,documentType:99,documentNumber:'0',anonymousConsumerFinal:true,concept:1}});
 const log=resolve('.netlify/stage7-qa/two-worker-requests.jsonl');await writeFile(log,'');
 const results=await Promise.all([exec(process.execPath,['.netlify/stage7-qa/fiscal-worker.mjs',p.invoiceId,log]),exec(process.execPath,['.netlify/stage7-qa/fiscal-worker.mjs',p.invoiceId,log])]);
 const workers=results.map(r=>JSON.parse(r.stdout.trim()));assert.notEqual(workers[0].pid,workers[1].pid);
 const requests=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(requests.length,1);
 const invoice=(await adminGetDocument(`invoices/${p.invoiceId}`)).data;assert.equal(invoice.status,'authorized');
 await syncInvoiceToSale({invoiceId:p.invoiceId});assert.equal((await adminGetDocument(`sales/${saleId}`)).data.fiscalInvoiceId,p.invoiceId);
 await writeFile('.netlify/stage7-qa/two-worker-proof.json',JSON.stringify({workers,requests,saleId,invoiceId:p.invoiceId,status:invoice.status,realCAERequests:0,fixture:'MOCK_ONLY'},null,2));
});
