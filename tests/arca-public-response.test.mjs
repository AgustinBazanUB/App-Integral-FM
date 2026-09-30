import assert from 'node:assert/strict';import test from 'node:test';import{generateKeyPairSync}from'node:crypto';
import handler from "../netlify/functions/arca-authorize.mjs";
import { publicAuthorizationResult, publicFiscalMessages, publicFiscalReadiness } from "../netlify/functions/_lib/arca/publicInvoice.mjs";
import { toPublicArcaError } from "../netlify/functions/_lib/arca/publicError.mjs";
test('proyección fiscal descarta campos históricos y texto externo en todos los niveles', () => {
 const sentinel = 'SENSITIVE_SENTINEL_VALUE';
 const payload = publicAuthorizationResult({ status: 'authorized', token: sentinel, sign: sentinel,
  invoice: { status: 'authorized', privateKey: sentinel, error: { code: sentinel, message: sentinel },
   authorization: { voucherNumber: 7, pointOfSale: 3, cae: '12345678901234', observations: [{ code: 10000, message: sentinel, token: sentinel }] },
   verification: { matched: true, checkedAt: '2026-09-30T12:00:00Z', errors: [{ code: 1, message: sentinel }] } },
  postAuthorizationVerification: { verified: true, matched: true, verification: { matched: true, events: [{ code: 2, message: sentinel }] } } });
 assert.equal(JSON.stringify(payload).includes(sentinel), false);
 assert.equal(payload.invoice.authorization.voucherNumber, 7);
 assert.equal(payload.invoice.authorization.cae, '12345678901234');
 assert.equal(payload.postAuthorizationVerification.matched, true);
});
test('dry-run conserva importes, identificación y bloqueos explícitos sin publicar el documento entero', () => {
 const result = publicAuthorizationResult({ status:'pending', dryRun:true, plan:{voucherClass:'B', fiscal:{total:121,net:100,vat:21}, detailBase:{concept:1,docType:99,docNumber:'0',total:121}, blockers:['consumer-final-identification-required','SENSITIVE_SENTINEL_VALUE']}});
 assert.equal(result.plan.fiscal.total,121); assert.equal(result.plan.detailBase.docNumber,'0');
 assert.deepEqual(result.plan.blockers,['consumer-final-identification-required']);
 assert.deepEqual(publicFiscalReadiness({ready:false,missingProducts:['p1'],missingVatRate:['p2'],token:'private'}),{ready:false,missingProducts:['p1'],missingVatRate:['p2']});
});
test('mensajes fiscales conservan sólo códigos numéricos y faltantes usan etiquetas específicas', () => {
 assert.deepEqual(publicFiscalMessages([{code:'100',message:'PRIVATE'},{code:'PRIVATE'}]).map(x=>x.code),[100,null]);
 assert.match(toPublicArcaError({code:'arca-config-missing',field:'ARCA_CONSUMER_FINAL_ID_THRESHOLD'}).message,/umbral/);
 assert.equal(toPublicArcaError({code:'arca-config-missing',field:'PRIVATE'}).message.includes('PRIVATE'),false);
});
test('ticket vigente perdido por la instancia es configuración y no indisponibilidad temporal', () => {
 const error = toPublicArcaError({code:'arca-wsaa-already-authenticated',status:500,message:'SENSITIVE_SENTINEL_VALUE'});
 assert.equal(error.category,'CONFIGURATION_ERROR'); assert.equal(error.status,409);
 assert.match(error.message,/caché/); assert.equal(error.message.includes('SENSITIVE'),false);
});
test('heredado: la respuesta reconciling no debe reflejar un error almacenado sensible',async()=>{
 const before={...process.env};const original=globalThis.fetch;
 try{
  process.env.ARCA_ENVIRONMENT='homologation';process.env.ARCA_ISSUER_VAT_CONDITION='responsable_inscripto';
  process.env.FIREBASE_ADMIN_CLIENT_EMAIL='audit@example.invalid';
  process.env.FIREBASE_ADMIN_PRIVATE_KEY=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
  globalThis.fetch=async(input)=>{
   const url=new URL(input instanceof Request?input.url:String(input));
   if(url.hostname==='identitytoolkit.googleapis.com')return Response.json({users:[{localId:'audit-admin'}]});
   if(url.pathname.endsWith('/users/audit-admin'))return Response.json({fields:{active:{booleanValue:true},role:{stringValue:'admin'}}});
   if(url.hostname==='oauth2.googleapis.com')return Response.json({access_token:'UNIT_TEST_ONLY',expires_in:3600});
   if(url.pathname.endsWith('/invoices/audit-invoice'))return Response.json({name:'projects/app-integral-fm/databases/(default)/documents/invoices/audit-invoice',fields:{status:{stringValue:'reconciling'},fiscalEnvironment:{stringValue:'homologation'},error:{mapValue:{fields:{message:{stringValue:'SENSITIVE_SENTINEL_VALUE'}}}}}});
   throw Error('AUDIT_UNEXPECTED_TRANSPORT');
  };
  const response=await handler(new Request('http://127.0.0.1/arca-authorize',{method:'POST',headers:{Authorization:'Bearer UNIT_TEST_ONLY','Content-Type':'application/json'},body:JSON.stringify({mode:'dry-run',invoiceId:'audit-invoice'})}));
  assert.equal(response.status,200);assert.equal((await response.text()).includes('SENSITIVE_SENTINEL_VALUE'),false);
 }finally{globalThis.fetch=original;for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);}
});
