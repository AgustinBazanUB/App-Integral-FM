const req=async(path,body)=>{const r=await fetch('/__qa/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});return r.json()};

let n=0;export const collection=(db,...parts)=>({path:parts.join('/')});export const doc=(base,...parts)=>({path:parts.length?parts.join('/'):base.path+'/qa-'+Date.now()+'-'+(++n),get id(){return this.path.split('/').at(-1)}});export const query=(ref,...filters)=>({...ref,filters});export const where=(key,op,value)=>({key,op,value});export const orderBy=()=>({});export const limit=()=>({});export const serverTimestamp=()=>new Date().toISOString();

export const getDoc=async ref=>{const d=await req('doc?path='+encodeURIComponent(ref.path));return{id:ref.id,exists:()=>d!==null,data:()=>d}};

export const getDocs=async ref=>({docs:(await req('list?path='+encodeURIComponent(ref.path))).filter(d=>(ref.filters||[]).every(f=>!f.key||f.op!=='=='||d[f.key]===f.value)).map(d=>({id:d.id,data:()=>d}))});

export async function runTransaction(db,fn){const writes=[];const result=await fn({get:getDoc,set:(ref,data,opt)=>writes.push({path:ref.path,data,merge:opt?.merge||false}),update:(ref,data)=>writes.push({path:ref.path,data,merge:true})});await req('commit',{writes});return result}

export const addDoc=()=>{throw Error('Unexpected addDoc')};export const setDoc=()=>{throw Error('Unexpected setDoc')};

export const getDocFromServer=getDoc;



export const Timestamp={fromDate:d=>d.toISOString()};

export const onSnapshot=(ref,onData,onError)=>{let active=true;const run=()=>getDocs(ref).then(v=>{if(active)onData(v)}).catch(e=>active&&onError?.(e));run();const t=setInterval(run,800);return()=>{active=false;clearInterval(t)}};

export const writeBatch=()=>{throw Error("QA: unexpected batch")};
