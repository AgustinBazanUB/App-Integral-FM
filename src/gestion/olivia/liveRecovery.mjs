export const recoveryBackoff=(attempt,random=Math.random)=>Math.round(Math.min(3000,400*2**(attempt-1))*(.8+.4*random()));
export const recoveryAllowed=error=>!([400,401,403,429].includes(Number(error?.status)) || /budget|query-cap|billing|disabled|permission|session-active/.test(error?.code || ''));
export function recoveryDiagnostic(error) {
  return String(error?.message || 'provider-error')
    .replace(/((?:https?|wss?):\/\/[^\s?#"']+)\?[^\s#"']*/gi,'$1?[redacted]')
    .replace(/\b(access_token|api_key|key|token)(\s*[:=]\s*)["']?[^\s&"']+/gi,'$1$2[redacted]')
    .replace(/auth_tokens\/[a-zA-Z0-9_.-]+/g,'auth_tokens/[redacted]').slice(0,240);
}
export function recoveryWait(ms,signal) {
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new DOMException('Sesión cerrada','AbortError'));return;}
    const abort=()=>{clearTimeout(timer);reject(new DOMException('Sesión cerrada','AbortError'));};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
    signal.addEventListener('abort',abort,{once:true});
  });
}
