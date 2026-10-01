import {fileURLToPath} from 'node:url';
import {createServer} from '../../node_modules/vite/dist/node/index.js';

import {readFileSync,appendFileSync} from 'node:fs';

const root=fileURLToPath(new URL('../../',import.meta.url)).replaceAll(String.fromCharCode(92),'/').replace(/\/$/,'');

const qa=root+'/.netlify/stage4-qa';

let docs={}, events=[], settings={invoiceDelay:0,invoiceError:false,metadataError:false,receiverCase:'ok'};

const stamp=()=>new Date().toISOString();

const location={name:'Ubicación QA',active:true,codePrefix:'QA',assignedSellerIds:['qa-seller']};

const reset=()=>{docs={'locations/qa':location,'products/product-1':{name:'Producto QA',arcaVatRate:21},'locationStock/qa/items/product-1':{productName:'Producto QA',currentStock:20,price:121,active:true},'users/qa-admin':{active:true,role:'admin',name:'Admin QA'},'users/qa-seller':{active:true,role:'seller',name:'Vendedor QA',allowedLocationIds:['qa']}}; events=[]; settings={invoiceDelay:0,invoiceError:false,metadataError:false,receiverCase:'ok'};};reset();

function enc(v){if(v===null)return{nullValue:null};if(typeof v==='string')return{stringValue:v};if(typeof v==='boolean')return{booleanValue:v};if(typeof v==='number')return{doubleValue:v};if(Array.isArray(v))return{arrayValue:{values:v.map(enc)}};return{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,w])=>[k,enc(w)]))}};}

function dec(v){if('nullValue'in v)return null;if('stringValue'in v)return v.stringValue;if('booleanValue'in v)return v.booleanValue;if('doubleValue'in v)return v.doubleValue;if('integerValue'in v)return Number(v.integerValue);if('timestampValue'in v)return v.timestampValue;if('arrayValue'in v)return(v.arrayValue.values||[]).map(dec);return Object.fromEntries(Object.entries(v.mapValue?.fields||{}).map(([k,w])=>[k,dec(w)]));}

function wire(path){return{name:'projects/app-integral-fm/databases/(default)/documents/'+path,fields:Object.fromEntries(Object.entries(docs[path]).map(([k,v])=>[k,enc(v)])),updateTime:stamp(),createTime:stamp()}}

const server=await createServer({root,configFile:root+'/vite.config.js',plugins:[{name:'stage4-audit-fixtures',enforce:'pre',resolveId(source,importer){if(source==='firebase/firestore')return qa+'/firestore.js';if((source.endsWith('/firebase')||source.endsWith('/firebase.js')))return qa+'/firebase.js';if(source.endsWith('AuthContext'))return qa+'/auth.jsx';if(source.endsWith('inventoryService')||source.endsWith('locationManagementService')||source.endsWith('locationSalesService')||source.endsWith('sharedResources'))return qa+'/services.js';},configureServer(s){s.middlewares.use(async(req,res,next)=>{const u=new URL(req.url,'http://localhost');if(!u.pathname.startsWith('/__qa/'))return next();let b={};if(req.method!=='GET') {let raw='';for await(const part of req)raw+=part;b=raw?JSON.parse(raw):{};}const reply=(data,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};try{if(u.pathname==='/__qa/state')return reply({docs,events,settings});if(u.pathname==='/__qa/reset'){reset();return reply({ok:true})};if(u.pathname==='/__qa/config'){Object.assign(settings,b);return reply(settings)}if(u.pathname==='/__qa/seed'){Object.assign(docs,b.docs||{});return reply({ok:true})}if(u.pathname==='/__qa/doc')return reply(docs[u.searchParams.get('path')]||null);if(u.pathname==='/__qa/list'){const prefix=u.searchParams.get('path')+'/';return reply(Object.entries(docs).filter(([p])=>p.startsWith(prefix)&&!p.slice(prefix.length).includes('/')).map(([p,d])=>({id:p.split('/').at(-1),...d})))}if(u.pathname==='/__qa/commit'){events.push({kind:'commercial-commit',writes:b.writes.map(x=>x.path)});for(const w of b.writes)docs[w.path]=w.merge?{...docs[w.path],...w.data}:w.data;return reply({ok:true})}if(u.pathname==='/__qa/record'){events.push(b);appendFileSync(new URL('../stage4-http-events.jsonl',import.meta.url),JSON.stringify(b)+'\n');return reply({ok:true})}if(u.pathname==='/__qa/firestore'){const fu=new URL(b.url);let path=decodeURIComponent(fu.pathname.split('/documents/')[1]||'');events.push({kind:'admin-rest',method:b.method,path});if(b.method==='GET')return docs[path]?reply(wire(path)):reply({error:{status:'NOT_FOUND'}},404);let data=Object.fromEntries(Object.entries(b.body?.fields||{}).map(([k,v])=>[k,dec(v)]));if(b.method==='POST'){path+='/'+fu.searchParams.get('documentId');if(docs[path])return reply({error:{status:'ALREADY_EXISTS'}},409);docs[path]=data;return reply(wire(path))}if(b.method==='PATCH'){docs[path]={...docs[path],...data};return reply(wire(path))}return reply({error:'unexpected write'},500)}return reply({error:'Unknown audit route'},404)}catch(e){return reply({error:e.message},500)}})}}],optimizeDeps:{entries:['.netlify/stage4-qa/index.html']},server:{host:'127.0.0.1',port:5181,strictPort:true,fs:{allow:[root]}}});

await server.listen();server.printUrls();
