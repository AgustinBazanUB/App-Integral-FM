import actual from '../../../netlify/functions/arca-document.mjs';

export default async function handler(req){const b=await req.clone().json();await fetch('http://127.0.0.1:5181/__qa/record',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'http',endpoint:'arca-document',body:b})});const s=await fetch('http://127.0.0.1:5181/__qa/state').then(r=>r.json());if(s.settings.metadataError&&b.mode==='metadata')return Response.json({ok:false,message:'Metadata temporalmente no disponible QA',code:'arca-network-error'},{status:503});return actual(req)}
