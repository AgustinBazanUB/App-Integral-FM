import { oliviaSession } from "./_lib/olivia/http.mjs";
import { createOliviaStore } from "./_lib/olivia/store.mjs";
import { createOliviaEngine } from "./_lib/olivia/engine.mjs";
import { resolveOliviaPricing } from "./_lib/olivia/pricing.mjs";
import { runChatJob } from "./_lib/olivia/chatJobs.mjs";
import { listDelegatedTasks } from './_lib/olivia/delegatedTasks.mjs';
export default async function handler(request) {
  if (request.method !== "POST") return;
  let session;
  try {
    session = await oliviaSession(request);
    const text = await request.text();
    if (Buffer.byteLength(text) > 1000) return;
    const { jobId } = JSON.parse(text), store = createOliviaStore();
    const engine=createOliviaEngine({ store, pricingResolver: resolveOliviaPricing });
    await runChatJob({ store, session, jobId, engine });
    const job=await store.get(`oliviaChatJobs/${jobId}`), scope=job?.payload?.conversationId && await store.get(`oliviaConversations/${job.payload.conversationId}`);
    if(scope?.internalTask && scope.parentConversationId)await listDelegatedTasks({store,engine,session,parent:scope.parentConversationId,dispatch:async nextJobId=>{
      const response=await fetch(new URL('/.netlify/functions/olivia-chat-background',request.url),{method:'POST',headers:{Authorization:`Bearer ${session.idToken}`,'Content-Type':'application/json'},body:JSON.stringify({jobId:nextJobId}),signal:AbortSignal.timeout(10000)});
      if(response.status!==202)throw new Error('No se pudo despachar la tarea siguiente.');
    }});
  } catch (error) { console.error("olivia.background_failed", { code: error.code || "assistant-error", userId: session?.uid || null }); }
}
export const config = { background: true };
