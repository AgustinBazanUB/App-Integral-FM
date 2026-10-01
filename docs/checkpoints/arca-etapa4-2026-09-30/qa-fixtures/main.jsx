import React from 'react';import{createRoot}from'react-dom/client';

import SellerPanel from '../../src/gestion/seller/SellerPanel.jsx';
import {RouterProvider} from '../../src/router.jsx';

import {saveSellerPendingSale,listSellerPendingSales,openSellerOfflineDb} from '../../src/gestion/seller/offlineSales.js';

import {createSellerSale,updateSellerSale,cancelSellerSale} from '../../src/gestion/services/sellerService.js';

const profile={id:'qa-seller',name:'Vendedor QA',role:'seller',active:true,allowedLocationIds:['qa']};

import '@fontsource/cormorant-garamond/latin-500.css';

import '@fontsource/cormorant-garamond/latin-600.css';

import '@fontsource/manrope/latin-400.css';

import '@fontsource/manrope/latin-500.css';

import '@fontsource/manrope/latin-600.css';

import '@fontsource/manrope/latin-700.css';

import '@fontsource/inter/latin-400.css';

import '@fontsource/inter/latin-500.css';

import '@fontsource/inter/latin-600.css';

import '@fontsource/inter/latin-700.css';

import '../../src/styles.css';

import '../../src/styles-v3.css';

import '../../src/styles-responsive-mobile.css';

import '../../src/styles/tokens.css';

import '../../src/styles/theme.css';

import '../../src/styles/management.css';

import '../../src/styles/location-enhancements.css';

import '../../src/styles/dashboard-filters.css';

import '../../src/styles/seller-panel.css';

import '../../src/styles/seller-stage2.css';

import '../../src/styles/seller-stage2-mobile.css';

import '../../src/styles/responsive.css';

import '../../src/styles/performance-optimizations.css';

import '../../src/styles/metrics-fixes.css';

import '../../src/styles/seller-customers.css';

import '../../src/styles/customer-import.css';

import '../../src/styles/whatsapp-marketing.css';

import '../../src/styles/inventory.css';

import './qa.css';



function App(){const[offline,setOffline]=React.useState(false);const[notice,setNotice]=React.useState('');

async function connectivity(value){Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>!value});window.dispatchEvent(new Event(value?'offline':'online'));setOffline(value);setNotice(value?'Red QA offline; IndexedDB real':'Red QA online');}

async function inspect(){const db=await openSellerOfflineDb();const tx=db.transaction('seller_pending_sales','readonly');const req=tx.objectStore('seller_pending_sales').getAll();req.onsuccess=()=>setNotice(JSON.stringify({indexedDB:'real',stores:[...db.objectStoreNames],pending:req.result.map(x=>({id:x.localId,status:x.status,ticketRequested:x.ticketRequested,hasInvoice:Boolean(x.fiscalInvoiceId||x.fiscalInvoice||x.invoiceStatus)}))}));}

async function legacy(){await saveSellerPendingSale({localId:'local_legacy_stage4',localCode:'LEGACY QA',sellerId:profile.id,sellerName:profile.name,locationId:'qa',locationName:'Ubicación QA',locationPrefix:'QA',items:[{productId:'product-1',name:'Producto QA',qty:1,unitPrice:121}],discounts:[],total:121,paymentMethod:'cash',ticketRequested:true});setNotice('Fixture legacy escrita en IndexedDB real');}

async function serviceProbe(){const state=await fetch('/__qa/state').then(r=>r.json());const sale=Object.entries(state.docs).filter(([p,d])=>p.startsWith('sales/')&&d.status==='active').at(-1);let results=[];for(const field of ['fiscalInvoiceId','fiscalInvoice','invoiceStatus']){await fetch('/__qa/seed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({docs:{[sale[0]]:{...sale[1],[field]:field==='fiscalInvoice'?{id:'qa-invoice'}:'pending'}}})});for(const action of ['edit','cancel'])try{await(action==='cancel'?cancelSellerSale({profile,saleId:sale[0].slice(6)}):updateSellerSale({profile,saleId:sale[0].slice(6),location:{id:'qa'},items:sale[1].items,paymentMethod:'cash'}));results.push(field+':'+action+':UNEXPECTED')}catch(e){results.push(field+':'+action+':'+e.message)}}await fetch('/__qa/seed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({docs:{[sale[0]]:sale[1]}})});setNotice(results.join(' | '));}

async function legacyOnline(){try{await createSellerSale({profile:{...profile,permissionDeny:{'quick-sales':['requestTicket']}},location:{id:'qa'},items:[{productId:'product-1',name:'Producto QA',qty:1,unitPrice:121}],paymentMethod:'cash',ticketRequested:true});setNotice('Legacy online: UNEXPECTED')}catch(e){setNotice('Legacy online DENY: '+e.message)}}

return <><div className='qa-shell'><p>QA Etapa 4 · datos sintéticos · transporte externo bloqueado</p><nav className='qa-toolbar'><button onClick={()=>connectivity(!offline)}>QA {offline?'Conectar':'Desconectar'}</button><button onClick={inspect}>QA inspeccionar IndexedDB</button><button onClick={legacy}>QA cola legacy</button><button onClick={serviceProbe}>QA guardas editar anular</button><button onClick={legacyOnline}>QA legacy online permiso</button></nav><p role='status'>{notice}</p></div><SellerPanel/></>}

document.body.classList.add('fm-management-body');createRoot(document.getElementById('root')).render(<RouterProvider><App/></RouterProvider>);
