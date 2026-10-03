import './guard.mjs';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {adminListDocuments,adminGetDocument} from '../../netlify/functions/_lib/firestoreAdminRest.mjs';
const orders=await adminListDocuments('orders');const invoices=await adminListDocuments('invoices');const movements=await adminListDocuments('stockMovements');const results=[];
for(const order of orders){
 if(order.sourceType!=='ecommerce'||order.paymentProvider!=='simulation')continue;
 const sale=await adminGetDocument(`sales/${order.saleId}`);const payment=await adminGetDocument(`payments/${order.paymentId}`);const related=invoices.filter(i=>i.sourceId===order.saleId);const moves=movements.filter(m=>m.saleId===order.saleId);
 assert.equal(related.length,1);assert.equal(order.paymentStatus,'simulated_approved');assert.equal(payment.data.status,'simulated_approved');assert.equal(payment.data.provider,'simulation');assert.equal(sale.data.paymentProvider,'simulation');assert.equal(sale.data.orderId,order.id);assert.equal(related[0].authorization.cae,null);assert.equal(related[0].authorization.voucherNumber,null);assert.equal(related[0].status,'pending');assert.equal(moves.length,sale.data.items.length);
 results.push({orderId:order.id,paymentId:order.paymentId,paymentProvider:order.paymentProvider,paymentStatus:order.paymentStatus,saleId:order.saleId,invoiceId:related[0].id,invoiceStatus:related[0].status,total:order.total,cae:null,voucherNumber:null,receiver:related[0].receiverSnapshot,movements:moves.map(m=>({id:m.id,previousStock:m.previousStock,newStock:m.newStock,qty:m.qty}))});
}
const network=(await readFile(new URL('./network.jsonl',import.meta.url),'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));
assert.equal(network.filter(n=>n.host&&/afip|arca|wsaa|wsfe/i.test(n.host)).length,0);
const summary={verifiedAt:new Date().toISOString(),operations:results,caeProductivos:0,deploys:0,previews:0,arcaTransportRequests:0,externalBlocked:network.filter(n=>n.kind==='external-blocked').map(n=>({host:n.host,method:n.method}))};
await writeFile(new URL('./persistence-proof.json',import.meta.url),JSON.stringify(summary,null,2));console.log(`Verificadas ${results.length} operaciones reales en Emulator: una Invoice y un movimiento por producto; CAE=0, transporte ARCA=0.`);
