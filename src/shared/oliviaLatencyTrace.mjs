const allowed = new Set(['route','kind','tool','operation','model','reasoning','count','status','mode','sampleRate','requestBytes','pending','delay']);
export function latencyTrace({ id, now = () => performance.now(), origin = 'client', maxEvents = 100 } = {}) {
  const startedAt = now(), events = [];let requestId=null;
  const mark = (stage, metadata = {}, at = now()) => {
    if (!/^[a-z][a-z0-9_.-]{0,65}$/i.test(stage) || !Number.isFinite(at)) return;
    const safe = Object.fromEntries(Object.entries(metadata).filter(([k,v]) => allowed.has(k) && (typeof v === 'boolean' || Number.isFinite(v) || (typeof v === 'string' && /^[a-zA-Z0-9_.:/-]{1,90}$/.test(v)))));
    events.push({ stage, ms: Math.round((at - startedAt) * 100) / 100, ...safe });
    if (events.length > maxEvents) events.shift();
  };
  const span = async (stage, metadata, work) => { const at = now(); mark(stage + '.start', metadata, at); try { const value = await work(); mark(stage + '.end', {...metadata,status:'ok'}); return value; } catch (error) { mark(stage + '.end', {...metadata,status:'error'}); throw error; } };
  return { id, mark, span,bindRequest:value=>{if(/^[a-zA-Z0-9_-]{1,128}$/.test(value || ''))requestId=value;}, snapshot: () => ({id,requestId,origin,clock:origin==='server'?'unix-ms':'performance',startedAt,elapsedMs:Math.max(0,now()-startedAt),events:events.map(e=>({...e}))}) };
}
// Paths, queries, names, arguments and returned data are never trace metadata.
export function tracedStore(source, trace) {
  const wrap = (target, prefix) => new Proxy(target, { get(object,key) {
    const fn=object[key]; if(typeof fn !== 'function') return fn;
    return (...args) => {
      const current=trace(); if(!current) return fn.apply(object,args);
      if(key==='transaction') return current.span('firestore.transaction',{},()=>fn.call(object,tx=>args[0](wrap(tx,'firestore'))));
      return current.span(prefix+'.'+String(key),{},()=>fn.apply(object,args));
    };
  }});
  return wrap(source,'firestore');
}
