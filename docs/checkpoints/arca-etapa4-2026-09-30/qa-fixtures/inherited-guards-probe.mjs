import{resolve}from'node:path';import{pathToFileURL}from'node:url';
const roots={current:resolve(process.argv[2]||'.').replaceAll('\\','/')};
const results={};for(const[name,root]of Object.entries(roots)){
 const{ensurePendingInvoice}=await import(pathToFileURL(root+'/netlify/functions/_lib/arca/invoicePersistence.mjs').href);
 const{parseWsaaEncryptionKey}=await import(pathToFileURL(root+'/netlify/functions/_lib/arca/wsaaSharedCache.mjs').href);
 const{invoiceIdForEnvironment}=await import(pathToFileURL(root+'/netlify/functions/_lib/arca/billing.mjs').href);
 const env={ARCA_ENVIRONMENT:'homologation',ARCA_ISSUER_CUIT:'20123456786',ARCA_POINT_OF_SALE:'3'};let cases={};
 for(const type of ['ecommerce','seller_sale']){const sale={sourceType:type,status:'active',sellerId:'seller-1',items:[{productId:'p1',qty:1,unitPrice:121,subtotal:121}],total:121};const docs=new Map([['sales/probe',{data:sale}],['products/p1',{data:{name:'QA',arcaVatRate:21}}]]);try{await ensurePendingInvoice({sourceType:'admin_quick_sale',sourceId:'probe',requestIntent:true,env,getDocument:async p=>docs.get(p),createDocument:async(c,id,data)=>{docs.set(c+'/'+id,{data});return{data}}});cases['declared-'+type]='ACCEPTED'}catch(e){cases['declared-'+type]=e.code}}
 const id=invoiceIdForEnvironment('homologation','seller_sale','probe');const docs=new Map([['sales/probe',{data:{status:'active',saleOrigin:'seller_panel',ticketRequested:true,fiscalInvoiceId:'other-invoice',fiscalEnvironment:'homologation'}}],['invoices/'+id,{data:{sourceType:'seller_sale',sourceId:'probe',status:'authorized'}}]]);try{const r=await ensurePendingInvoice({sourceType:'seller_sale',sourceId:'probe',env,getDocument:async p=>docs.get(p),createDocument:async()=>{throw Error('unexpected')}});cases.associationConflict=r.created===false?'REUSED_CONFLICT':'unexpected'}catch(e){cases.associationConflict=e.code}
 try{parseWsaaEncryptionKey({ARCA_TA_ENCRYPTION_KEY:Buffer.alloc(32).toString('base64')+'==='},{required:true});cases.base64ExcessPadding='ACCEPTED'}catch(e){cases.base64ExcessPadding=e.code}
 results[name]=cases;
}
console.log(JSON.stringify(results));
