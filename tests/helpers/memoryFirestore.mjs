import { build } from "esbuild";
export async function memoryServices(exports) {
  const state = { data: new Map(), queries: [], writes: [], sequence: 0, queue: Promise.resolve() };
  const key = `__crmFinanceQA${Math.random().toString(36).slice(2)}`;
  globalThis[key] = state;
  const firestore = `
    const state = globalThis[${JSON.stringify(key)}];
    export const collection = (_db,...parts) => ({path:parts.join('/')});
    export const doc = (base,...parts) => {const path=base.path?base.path+'/'+(parts.join('/')||'auto-'+(++state.sequence)):parts.join('/');return {path,id:path.split('/').at(-1)};};
    const snapshot = reference => ({id:reference.id,ref:reference,exists:()=>state.data.has(reference.path),data:()=>structuredClone(state.data.get(reference.path))});
    export const getDoc = async reference => snapshot(reference);
    export const where=(field,op,value)=>({kind:'where',field,op,value});
    export const orderBy=(field,direction='asc')=>({kind:'order',field,direction});
    export const limit=count=>({kind:'limit',count});
    export const startAfter=cursor=>({kind:'cursor',cursor});
    export const query=(target,...constraints)=>({...target,constraints});
    export const Timestamp={fromDate:date=>date};
    export const serverTimestamp=()=>new Date('2026-10-02T15:00:00Z');
    export const getDocs=async target=>{
      state.queries.push(target); const constraints=target.constraints||[];
      let rows=[...state.data].filter(([path])=>path.startsWith(target.path+'/')&&path.split('/').length===target.path.split('/').length+1).map(([path])=>snapshot({path,id:path.split('/').at(-1)}));
      for(const c of constraints.filter(c=>c.kind==='where'))rows=rows.filter(row=>{const value=row.data()[c.field];if(c.op==='==')return value===c.value;if(c.op==='in')return c.value.includes(value);if(c.op==='>=')return value>=c.value;if(c.op==='<')return value<c.value;throw Error('Filtro no soportado en QA');});
      const orders=constraints.filter(c=>c.kind==='order');
      const compare=(a,b)=>{for(const c of orders){const left=a.data()[c.field],right=b.data()[c.field];const result=left>right?1:left<right?-1:0;if(result)return c.direction==='desc'?-result:result;}return orders.at(-1)?.direction==='desc'?b.id.localeCompare(a.id):a.id.localeCompare(b.id);};
      if(orders.length){rows=rows.filter(row=>orders.every(c=>row.data()[c.field]!=null)).sort(compare);}
      const cursor=constraints.find(c=>c.kind==='cursor');if(cursor)rows=rows.filter(row=>compare(row,cursor.cursor)>0);
      const count=constraints.find(c=>c.kind==='limit')?.count;if(count!=null)rows=rows.slice(0,count);
      return {docs:rows,size:rows.length};
    };
    export const runTransaction=(_db,body)=>{const task=state.queue.then(async()=>{const pending=[];const result=await body({get:async ref=>{if(pending.length)throw Error('Lectura posterior a escritura');return snapshot(ref)},set:(ref,data,options)=>pending.push({ref,data,merge:options?.merge}),update:(ref,data)=>pending.push({ref,data,merge:true})});for(const write of pending){state.data.set(write.ref.path,{...(write.merge?state.data.get(write.ref.path):{}),...structuredClone(write.data)});state.writes.push(write);}return result;});state.queue=task.catch(()=>{});return task;};
    export const setDoc=async(ref,data,options)=>runTransaction({},async tx=>tx.set(ref,data,options));
    export const writeBatch=()=>{const writes=[];return {set:(...args)=>writes.push(args),commit:()=>runTransaction({},async tx=>writes.forEach(args=>tx.set(...args)))};};
  `;
  const bundle = await build({ stdin: { contents: exports, resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "memory-firestore", setup(builder) {
    builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: "firestore", namespace: "qa" }));
    builder.onResolve({ filter: /(^|\/)firebase(\.js)?$/ }, () => ({ path: "db", namespace: "qa" }));
    builder.onResolve({ filter: /sharedResources(\.js)?$/ }, () => ({ path: "resources", namespace: "qa" }));
    builder.onLoad({ filter: /.*/, namespace: "qa" }, ({ path }) => ({ contents: path === "db" ? "export const db={}; export const auth={currentUser:null};" : path === "resources" ? `export const listMasterProductsShared=async()=>[...globalThis[${JSON.stringify(key)}].data].filter(([path])=>path.startsWith('products/')).map(([path,data])=>({id:path.split('/').at(-1),...data}));` : firestore }));
  } }] });
  const service = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
  return { state, service };
}
