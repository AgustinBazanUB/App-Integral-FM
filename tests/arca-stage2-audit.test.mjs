import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolveFiscalReceiver} from '../netlify/functions/_lib/arca/fiscalReceiverResolver.mjs';
import {toPublicArcaError} from '../netlify/functions/_lib/arca/publicError.mjs';
import {normalizeCuit,isValidCuit} from '../src/shared/fiscal/cuit.js';
import {createReceiverRequestGuard} from '../src/gestion/fiscal/receiverRequestGuard.js';
const env={ARCA_ENVIRONMENT:'homologation',ARCA_CONSUMER_FINAL_ID_THRESHOLD:'1000'};
const sentinel='SENSITIVE_SENTINEL_VALUE';
test('auditoría Etapa 2: códigos arbitrarios tampoco reflejan secretos',()=>{
  assert.equal(JSON.stringify(toPublicArcaError({code:sentinel,message:sentinel,detail:sentinel,cause:sentinel,status:502})).includes(sentinel),false);
});
test('auditoría Etapa 2: configuración WSAA no se clasifica como caída por su HTTP 503',()=>{
  assert.equal(toPublicArcaError({code:'arca-wsaa-shared-cache-required',status:503,message:sentinel}).category,'CONFIGURATION_ERROR');
  assert.equal(toPublicArcaError({code:'arca-production-network-disabled',status:409}).category,'CONFIGURATION_ERROR');
});
test('auditoría Etapa 2: SOAP de credenciales se distingue de indisponibilidad',()=>{
  assert.equal(toPublicArcaError({code:'ns1:cms.cert.untrusted',status:500,message:sentinel}).category,'CREDENTIAL_ERROR');
});
test('auditoría Etapa 2: total inválido no se convierte silenciosamente a cero',async()=>{
  for(const saleTotal of [' ',true,[],{}]) await assert.rejects(resolveFiscalReceiver({mode:'consumer_final',saleTotal,env}),e=>e.code==='fiscal-sale-total-required');
});
test('auditoría Etapa 2: debajo, igual y sobre umbral no consultan Padrón',async()=>{
  let calls=0; const lookupTaxpayer=async()=>{calls++;throw Error('lookup prohibido');};
  assert.equal((await resolveFiscalReceiver({mode:'consumer_final',saleTotal:999,env,lookupTaxpayer})).receiver.documentType,99);
  for(const saleTotal of [1000,1001]) await assert.rejects(resolveFiscalReceiver({mode:'consumer_final',saleTotal,env,lookupTaxpayer}),e=>e.code==='consumer-final-identification-required');
  assert.equal(calls,0);
});
test('auditoría Etapa 2: CUIT con espacios, longitud y dígito verificador',()=>{
  assert.equal(normalizeCuit(' 20 - 12345678 - 6 '),'20123456786');
  assert.equal(isValidCuit(' 20 - 12345678 - 6 '),true);
  for(const cuit of ['123','201234567860','20123456780']) assert.equal(isValidCuit(cuit),false);
});
test('auditoría Etapa 2: Monotributo y contribuyente inactivo con adaptador inyectado',async()=>{
  const person={cuit:'20123456786',found:true,keyStatus:'ACTIVO',monotributo:true,monotributoData:{taxes:[{id:20,status:'AC'}]},taxes:[]};
  const result=await resolveFiscalReceiver({mode:'cuit',cuit:person.cuit,env,lookupTaxpayer:async()=>person});
  assert.equal(result.receiver.vatConditionId,6); assert.equal(result.requiresConfirmation,true);
  await assert.rejects(resolveFiscalReceiver({mode:'cuit',cuit:person.cuit,env,lookupTaxpayer:async()=>({...person,keyStatus:'INACTIVO'})}),e=>e.code==='fiscal-taxpayer-inactive');
});
test('auditoría Etapa 2: categorías públicas de validación, permisos, credenciales y red',()=>{
  for(const code of ['arca-cuit-invalid','fiscal-taxpayer-not-found','fiscal-vat-condition-unresolved']) assert.equal(toPublicArcaError({code}).category,'VALIDATION_ERROR');
  assert.equal(toPublicArcaError({code:'arca-production-taxpayer-lookup-disabled'}).category,'CONFIGURATION_ERROR');
  assert.equal(toPublicArcaError({code:'permission-denied'}).category,'PERMISSION_ERROR');
  assert.equal(toPublicArcaError({code:'arca-private-key-invalid',status:500}).category,'CREDENTIAL_ERROR');
  for(const code of ['arca-network-error','arca-timeout','arca-soap-http-error']) assert.equal(toPublicArcaError({code,status:502}).category,'TEMPORARY_UPSTREAM_ERROR');
});
test('auditoría Etapa 2: los cinco endpoints no reflejan errores arbitrarios de autenticación',async()=>{
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>{throw Object.assign(Error(sentinel),{code:sentinel,status:502,detail:sentinel});};
    for(const name of ['arca-receiver','arca-taxpayer','arca-authorize','arca-invoice','arca-document']) {
      const {default:handler}=await import('../netlify/functions/'+name+'.mjs');
      const response=await handler(new Request('http://127.0.0.1/'+name,{method:'POST',headers:{Authorization:'Bearer UNIT_TEST_ONLY','Content-Type':'application/json'},body:'{}'}));
      assert.equal((await response.text()).includes(sentinel),false,name);
    }
  } finally {globalThis.fetch=original;}
});
test('auditoría Etapa 2: servicio comercial no escribe invoiceStatus reservado',async()=>{
  const source=await readFile(new URL('../src/gestion/services/managementService.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/invoiceStatus:\s*invoiceRequested/);
});
test('auditoría Etapa 2: una respuesta anterior no reemplaza una consulta nueva',async()=>{
  const guard=createReceiverRequestGuard(); const applied=[];
  let releaseOld; const oldResult=new Promise(resolve=>{releaseOld=resolve;});
  const oldVersion=guard.begin();
  const oldTask=oldResult.then(value=>{if(guard.isCurrent(oldVersion))applied.push(value);});
  const newVersion=guard.begin();
  if(guard.isCurrent(newVersion))applied.push('receptor actual');
  releaseOld('receptor obsoleto');await oldTask;
  assert.deepEqual(applied,['receptor actual']);
});
test('auditoría Etapa 2: cerrar o cambiar los datos invalida el resultado y el error pendientes',()=>{
  const guard=createReceiverRequestGuard();const old=guard.begin();guard.invalidate();
  assert.equal(guard.isCurrent(old),false);
  const reopened=guard.begin();assert.equal(guard.isCurrent(reopened),true);assert.equal(guard.isCurrent(old),false);
});
