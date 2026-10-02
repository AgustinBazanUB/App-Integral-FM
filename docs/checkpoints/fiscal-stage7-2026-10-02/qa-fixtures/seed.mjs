import './guard.mjs';
import {writeFile} from 'node:fs/promises';
import {adminGetDocument,adminCreateDocument,adminPatchDocument} from '../../netlify/functions/_lib/firestoreAdminRest.mjs';
const accounts={};
for(const role of ['admin','seller']){
 const response=await fetch('http://127.0.0.1:9187/identitytoolkit.googleapis.com/v1/accounts:signUp?key=qa-stage7-only',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`${role}@qa.invalid`,password:'qa-password-only',returnSecureToken:true})});
 let data=await response.json();
 if(!response.ok){const login=await fetch('http://127.0.0.1:9187/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=qa-stage7-only',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`${role}@qa.invalid`,password:'qa-password-only',returnSecureToken:true})});data=await login.json();}
 if(!data.localId||!data.idToken)throw new Error('QA Auth seed failed');
 accounts[role]={uid:data.localId,token:data.idToken};
}
const records={
 'locations/qa-local':{name:'Ubicación QA ficticia',active:true,deleted:false},
 'products/qa-product':{name:'Producto QA Etapa 7',active:true,deleted:false,defaultPrice:22000,arcaVatRate:21,ecommerceEditorialId:'oil-5l',categoryId:'olive_oil',ecommerceSlug:'aceite-oliva-5l'},
 'locationStock/qa-local/items/qa-product':{productId:'qa-product',productName:'Producto QA Etapa 7',currentStock:50,active:true,deleted:false,priceMode:'default'},
};
for(const role of ['admin','seller'])records[`users/${accounts[role].uid}`]={name:`QA ${role}`,role,active:true,allowedLocationIds:role==='seller'?['qa-local']:[]};
for(const [path,data] of Object.entries(records)){const previous=await adminGetDocument(path);if(previous)await adminPatchDocument(path,data);else{const segments=path.split('/');await adminCreateDocument(segments.slice(0,-1).join('/'),segments.at(-1),data);}}
await writeFile(new URL('./auth-fixtures.json',import.meta.url),JSON.stringify(accounts));console.log('QA Auth admin/seller y stock ficticios creados en Emulator');
