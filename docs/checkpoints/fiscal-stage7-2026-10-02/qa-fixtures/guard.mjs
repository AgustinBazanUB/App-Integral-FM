import { generateKeyPairSync } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const qaProject='demo-ecommerce-stage7';
const rawFetch=globalThis.fetch;
const logPath=fileURLToPath(new URL('./network.jsonl',import.meta.url));
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
Object.assign(process.env,{FIREBASE_PROJECT_ID:'app-integral-fm',FIREBASE_WEB_API_KEY:'qa-stage7-only',FIREBASE_ADMIN_CLIENT_EMAIL:'fixture@demo.invalid',FIREBASE_ADMIN_PRIVATE_KEY:privateKey.export({type:'pkcs8',format:'pem'}),ARCA_CONSUMER_FINAL_ID_THRESHOLD:'10000000',ARCA_ENVIRONMENT:'homologation',ARCA_ISSUER_CUIT:'20123456786',ARCA_ISSUER_VAT_CONDITION:'responsable_inscripto',ARCA_POINT_OF_SALE:'3',ARCA_ALLOW_PRODUCTION_CAE:'false',ARCA_ALLOW_PRODUCTION_INVOICE_PREPARE:'false',ARCA_ALLOW_PRODUCTION_TAXPAYER_LOOKUP:'false',ARCA_AUTO_AUTHORIZE_PRODUCTION:'false',ARCA_ALLOW_CAE_HOMOLOGATION:'false',ARCA_AUTO_AUTHORIZE_PRODUCTION_SOURCES:'admin_quick_sale',ECOMMERCE_LOCATION_ID:'qa-local',ECOMMERCE_PICKUP_ENABLED:'true'});
for(const key of ['ARCA_PRIVATE_KEY_PEM','ARCA_CERTIFICATE_PEM','ARCA_TA_ENCRYPTION_KEY'])delete process.env[key];
globalThis.fetch=async(input,init={})=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);const method=init.method||input?.method||'GET';
 if(typeof input?.clone==='function'){
  init={...init,method,headers:init.headers||input.headers,...(!['GET','HEAD'].includes(method)&&init.body===undefined?{body:await input.clone().text()}:{})};
 }
 if(url.href==='https://oauth2.googleapis.com/token'){appendFileSync(logPath,JSON.stringify({kind:'oauth-mock',method})+'\n');return new Response(JSON.stringify({access_token:'owner',expires_in:3600}));}
 if(url.hostname==='identitytoolkit.googleapis.com'){const response=await rawFetch(`http://127.0.0.1:9187/identitytoolkit.googleapis.com${url.pathname}${url.search}`,init);const payload=await response.clone().json();appendFileSync(logPath,JSON.stringify({kind:'auth-emulator',method,status:response.status,fields:Object.keys(payload),bodyType:typeof init.body,...(!response.ok?{error:payload.error?.message}:{})})+'\n');return response;}
 if(url.hostname==='firestore.googleapis.com'){
  const path=url.pathname.replace('/projects/app-integral-fm/',`/projects/${qaProject}/`);
  const headers=new Headers(init.headers||input?.headers);const token=headers.get('Authorization');
  // Keep Firebase Auth user tokens for profile reads. Backend OAuth returns owner separately.
  const options={...init,method,headers};
  if(typeof options.body==='string')options.body=options.body.replaceAll('projects/app-integral-fm/',`projects/${qaProject}/`);
  appendFileSync(logPath,JSON.stringify({kind:'firestore-emulator',method,path,auth:token==='Bearer owner'?'backend':'firebase-user'})+'\n');
  const response=await rawFetch(`http://127.0.0.1:8187${path}${url.search}`,options);
  if(path.includes(':beginTransaction')||path.includes(':batchGet')){const data=await response.clone().json();appendFileSync(logPath,JSON.stringify({kind:'transaction-shape',path,status:response.status,array:Array.isArray(data),fields:Object.keys(data),transactionLength:data.transaction?.length})+'\n');}
  if(!response.ok&&response.status!==404)appendFileSync(logPath,JSON.stringify({kind:'emulator-error',method,path,status:response.status,error:(await response.clone().json()).error})+'\n');return response;
 }
 if(['localhost','127.0.0.1','[::1]'].includes(url.hostname))return rawFetch(input,init);
 appendFileSync(logPath,JSON.stringify({kind:'external-blocked',method,host:url.hostname})+'\n');throw new Error('QA refuses external network');
};
