import{generateKeyPairSync}from'node:crypto';import{appendFileSync}from'node:fs';

const original=globalThis.fetch;const local='http://127.0.0.1:5181';

process.env.ARCA_ENVIRONMENT='homologation';for(const key of ['ARCA_ALLOW_PRODUCTION_INVOICE_PREPARE','ARCA_ALLOW_PRODUCTION_CAE','ARCA_AUTO_AUTHORIZE_PRODUCTION','ARCA_ALLOW_PRODUCTION_READONLY','ARCA_ALLOW_CAE_HOMOLOGATION'])process.env[key]='false';

process.env.ARCA_AUTO_AUTHORIZE_PRODUCTION_SOURCES='admin_quick_sale';process.env.ARCA_ISSUER_CUIT='20123456786';process.env.ARCA_POINT_OF_SALE='3';process.env.ARCA_CONSUMER_FINAL_ID_THRESHOLD='1000';process.env.ARCA_ISSUER_VAT_CONDITION='responsable_inscripto';

process.env.ARCA_ISSUER_LEGAL_NAME='Emisor QA';process.env.ARCA_ISSUER_COMMERCIAL_ADDRESS='Domicilio sintético QA';process.env.ARCA_ISSUER_GROSS_INCOME='Exento';process.env.ARCA_ISSUER_ACTIVITY_START='2020-01-01';

delete process.env.ARCA_CERTIFICATE_PEM;delete process.env.ARCA_PRIVATE_KEY_PEM;delete process.env.ARCA_TA_ENCRYPTION_KEY;

process.env.FIREBASE_ADMIN_CLIENT_EMAIL='qa@fixture.invalid';process.env.FIREBASE_ADMIN_PRIVATE_KEY=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}).privateKey;

globalThis.fetch=async(input,opt={})=>{const r=input instanceof Request?input:new Request(input,opt);const u=new URL(r.url);if(['localhost','127.0.0.1','::1','[::1]'].includes(u.hostname))return original(input,opt);if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'SYNTHETIC_OAUTH_ONLY',expires_in:3600});if(u.hostname==='identitytoolkit.googleapis.com'){const b=await r.json();return b.idToken==='STAGE4_QA_ONLY'?Response.json({users:[{localId:'qa-seller',disabled:false}]}):Response.json({error:{}},{status:401})}if(u.hostname==='firestore.googleapis.com')return original(local+'/__qa/firestore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:r.url,method:r.method,body:r.method==='GET'?null:await r.json()})});appendFileSync(new URL('../stage4-blocked-external.jsonl',import.meta.url),JSON.stringify({host:u.hostname,method:r.method})+'\n');throw Error('STAGE4_EXTERNAL_NETWORK_BLOCKED')};
