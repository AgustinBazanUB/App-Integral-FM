import { createOliviaStore } from "./_lib/olivia/store.mjs";
import { openaiRequest } from "./_lib/olivia/provider.mjs";
export const config = { schedule: "@daily" };
const TEMPORARY = ["oliviaAttachments", "oliviaUploadBudgets", "oliviaRealtimeToolCalls", "oliviaRealtimeTurns", "oliviaToolEvents", "oliviaLiveDelegations"];
export async function purgeOliviaResources({ store = createOliviaStore(), provider = openaiRequest, now = new Date(), env = process.env, limit = 20, timeBudgetMs = 18000 } = {}) {
  const deadline = Date.now() + Math.min(18000, Math.max(0, timeBudgetMs)), size = Math.min(20, Math.max(1, limit));
  let removed = 0, pending = 0, backlog = false;
  const queries = await Promise.allSettled([
    ...TEMPORARY.map((collection) => store.query(collection, [["expiresAt", "LESS_THAN_OR_EQUAL", now]], size, [["expiresAt", "ASCENDING"]])),
    store.query("oliviaKnowledgeDocuments", [["deletionPending", "EQUAL", true]], size),
  ]);
  const work = [];
  queries.forEach((result, index) => {
    if (result.status === "rejected") { pending++; backlog = true; return; }
    if (result.value.length === size) backlog = true;
    for (const row of result.value) work.push({ collection: TEMPORARY[index] || "oliviaKnowledgeDocuments", row });
  });
  const clean = async ({ collection, row }) => {
    const knowledge = collection === "oliviaKnowledgeDocuments";
    if (knowledge && row.active) return;
    try {
      const file = /^file-[A-Za-z0-9_-]+$/.test(row.providerFileId || "");
      if (knowledge && file && /^vs_[A-Za-z0-9_-]+$/.test(row.vectorStoreId || "")) await provider(`vector_stores/${row.vectorStoreId}/files/${row.providerFileId}`, null, { env, method: "DELETE", timeoutMs: 2500 });
      if (file) await provider(`files/${row.providerFileId}`, null, { env, method: "DELETE", timeoutMs: 2500 });
      await store.transaction(async (tx) => {
        const path = `${collection}/${row.id}`, current = await tx.getDocument(path);
        if (!current || (knowledge ? current.data.active : new Date(current.data.expiresAt) > now)) return;
        await tx.commitDocuments([{ type: knowledge ? "update" : "delete", path, ...(knowledge ? { data: { deletionPending: false } } : {}), ...(current.updateTime ? { currentUpdateTime: current.updateTime } : {}) }]);
        removed++;
      });
    } catch { pending++; backlog = true; }
  };
  for (let index = 0; index < work.length; index += 3) {
    if (Date.now() >= deadline) { pending += work.length - index; backlog = true; break; }
    await Promise.all(work.slice(index, index + 3).map(clean));
  }
  return { removed, pending, backlog };
}
export default async function handler() {
  const result = await purgeOliviaResources();
  // Scheduled Functions complete without an HTTP response body.
  console.log(JSON.stringify({ event: "olivia.resources.retention", ...result }));
}
