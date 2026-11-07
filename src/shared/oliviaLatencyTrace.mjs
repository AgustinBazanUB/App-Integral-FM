const allowed = new Set(['route','kind','tool','operation','model','reasoning','count','status','mode','sampleRate','requestBytes','pending','delay','turnId','turnIndex','provider','durationMs','queueMs','costUsd','inputTokens','outputTokens','endpointMs','silenceMs','authorized','source','fallback','configurationMs','conversationMs','reservationMs','providerMs']);
export function latencyTrace({ id, now = () => performance.now(), origin = 'client', maxEvents = 100 } = {}) {
  const startedAt = now(), events = [];let requestId=null;
  const mark = (stage, metadata = {}, at = now()) => {
    if (!/^[a-z][a-z0-9_.-]{0,65}$/.test(stage) || !Number.isFinite(at)) return;
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

const csvFields = ['turnIndex','route','kind','provider','model','operation','reasoning','status','mode','source','fallback','authorized','sampleRate','requestBytes','pending','delay','count','durationMs','queueMs','endpointMs','silenceMs','costUsd','inputTokens','outputTokens','configurationMs','conversationMs','reservationMs','providerMs'];
const safeIdentifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : null;

export function sanitizeLatencyTrace(trace) {
  if (!trace || !Array.isArray(trace.events)) return null;
  const events = trace.events.filter(event => typeof event?.stage === 'string' && /^[a-z][a-z0-9_.-]{0,65}$/.test(event.stage) && Number.isFinite(event.ms)).map(event => {
    const safe = { stage: event.stage, ms: Math.round(event.ms * 100) / 100 };
    for (const [key, value] of Object.entries(event)) {
      if (!allowed.has(key)) continue;
      if (typeof value === 'boolean' || Number.isFinite(value) || (typeof value === 'string' && /^[a-zA-Z0-9_.:/-]{1,90}$/.test(value))) safe[key] = value;
    }
    return safe;
  });
  return {
    id: safeIdentifier(trace.id),
    requestId: safeIdentifier(trace.requestId),
    origin: ['client','server'].includes(trace.origin) ? trace.origin : 'client',
    clock: ['performance','unix-ms'].includes(trace.clock) ? trace.clock : 'performance',
    startedAt: Number.isFinite(trace.startedAt) ? trace.startedAt : null,
    elapsedMs: Number.isFinite(trace.elapsedMs) ? trace.elapsedMs : null,
    events,
  };
}

export function latencyTracesJson(traces) {
  return JSON.stringify((Array.isArray(traces) ? traces : []).map(sanitizeLatencyTrace).filter(Boolean), null, 2);
}

export function latencyTracesCsv(traces) {
  const columns = ['turnId','requestId','origin','clock','stage','ms',...csvFields];
  const escape = value => {
    if (value == null) return '';
    const raw = String(value);
    return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g,'""')}"` : raw;
  };
  const rows = [columns.join(',')];
  for (const trace of (Array.isArray(traces) ? traces : []).map(sanitizeLatencyTrace).filter(Boolean)) {
    for (const event of trace.events) rows.push(columns.map(column => escape(column === 'turnId' ? trace.id : column === 'requestId' ? trace.requestId : column === 'origin' ? trace.origin : column === 'clock' ? trace.clock : event[column])).join(','));
  }
  return rows.join('\r\n');
}
