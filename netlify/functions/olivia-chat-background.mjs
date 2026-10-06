import { oliviaSession } from "./_lib/olivia/http.mjs";
import { createOliviaStore } from "./_lib/olivia/store.mjs";
import { createOliviaEngine } from "./_lib/olivia/engine.mjs";
import { resolveOliviaPricing } from "./_lib/olivia/pricing.mjs";
import { runChatJob } from "./_lib/olivia/chatJobs.mjs";
export default async function handler(request) {
  if (request.method !== "POST") return;
  let session;
  try {
    session = await oliviaSession(request);
    const text = await request.text();
    if (Buffer.byteLength(text) > 1000) return;
    const { jobId } = JSON.parse(text), store = createOliviaStore();
    await runChatJob({ store, session, jobId, engine: createOliviaEngine({ store, pricingResolver: resolveOliviaPricing }) });
  } catch (error) { console.error("olivia.background_failed", { code: error.code || "assistant-error", userId: session?.uid || null }); }
}
export const config = { background: true };
