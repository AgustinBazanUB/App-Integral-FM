import './guard.mjs';
import {appendFile} from 'node:fs/promises';
import {authorizeInvoice} from '../../netlify/functions/_lib/arca/authorizer.mjs';
const [invoiceId,logPath]=process.argv.slice(2);
const result=await authorizeInvoice({invoiceId,env:{...process.env,NODE_ENV:'test',ARCA_ALLOW_CAE_HOMOLOGATION:'true'},issuerVatCondition:'responsable_inscripto',allowCaeRequest:true,
 getLastAuthorizedFn:async()=>({number:100,errors:[]}),
 requestCaeFn:async()=>{await appendFile(logPath,JSON.stringify({pid:process.pid,invoiceId,mode:'MOCK_ONLY',realCAERequests:0})+'\n');return {result:'A',cae:'12345678901234',caeExpiration:'20261231',errors:[]};},
 consultVoucherFn:async()=>{throw new Error('No consult transport permitted in this mock worker');}
});
console.log(JSON.stringify({pid:process.pid,status:result.status,alreadyAuthorized:result.alreadyAuthorized===true,realCAERequests:0}));
