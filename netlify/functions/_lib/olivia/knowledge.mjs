import { randomUUID } from "node:crypto";
import { can, canAccessAdministration, normalizedRole } from "../../../../src/gestion/permissions.js";
import { retrieveOliviaKnowledge } from "../../../../src/shared/oliviaKnowledge.mjs";
import { retrieveCurrentOliviaKnowledge } from "../../../../src/shared/oliviaCurrentKnowledge.mjs";
import { safeId, oliviaError } from "../../../../src/shared/oliviaContracts.mjs";
import { validateAttachment } from "./attachments.mjs";
import { openaiRequest } from "./provider.mjs";
const MODULES = ["seller", "locations", "products", "quick-sales", "loyal-customers", "metrics", "finance", "warehouse", "ecommerce", "shipping", "alerts", "suppliers", "marketing", "social", "ai"];
export function assertKnowledgeAdmin(session) {
  if (!session.profile?.active || !canAccessAdministration(session.profile)) throw oliviaError("permission-denied", "Solo un Administrador autorizado puede gestionar el conocimiento.", 403);
}
export function knowledgeAllowed(session, row) {
  if (row.active !== true || row.status !== "completed") return false;
  if (normalizedRole(session.profile) === "seller") return row.audience === "seller" && row.module === "seller";
  return row.module === "seller" || (row.module === "ai" && canAccessAdministration(session.profile)) || can(session.profile, row.module, "view");
}
export async function ensureKnowledgeStore({ store, provider, env }) {
  const path = "oliviaKnowledgeSettings/global", current = await store.get(path);
  if (current?.vectorStoreId) return current.vectorStoreId;
  const vector = await provider("vector_stores", { name: "Olivia · Flor Mía · documentación permanente" }, { env });
  if (!/^vs_[A-Za-z0-9_-]+$/.test(vector.id || "")) throw oliviaError("knowledge-provider-error", "No se pudo crear la biblioteca.", 502);
  let selected;
  await store.transaction(async (tx) => {
    const previous = await tx.getDocument(path); selected = previous?.data.vectorStoreId || vector.id;
    if (!previous) await tx.commitDocuments([{ type: "create", path, data: { vectorStoreId: vector.id, createdAt: new Date() } }]);
  });
  if (selected !== vector.id) await provider(`vector_stores/${vector.id}`, null, { env, method: "DELETE" }).catch(() => {});
  return selected;
}
export async function publishKnowledge({ session, form, store, provider = openaiRequest, env = process.env }) {
  assertKnowledgeAdmin(session);
  if (form.get("confirmed") !== "true") throw oliviaError("confirmation-required", "Revisá y confirmá la publicación en la biblioteca.", 409);
  const module = String(form.get("module") || ""), audience = String(form.get("audience") || "admin");
  if (!MODULES.includes(module) || !["admin", "seller"].includes(audience) || (audience === "seller" && module !== "seller") || (!["seller", "ai"].includes(module) && !can(session.profile, module, "view"))) throw oliviaError("invalid-audience", "Elegí un módulo y una audiencia permitidos.", 422);
  const file = form.get("file"), metadata = await validateAttachment(file);
  if (!["pdf", "docx", "txt"].includes(metadata.extension)) throw oliviaError("knowledge-format", "La biblioteca admite procedimientos en PDF, DOCX y TXT. Las planillas e imágenes se analizan en el chat.", 422);
  const id = safeId(String(form.get("requestId") || randomUUID())), path = `oliviaKnowledgeDocuments/${id}`;
  const existing = await store.get(path);
  if (existing?.active && existing.createdBy === session.uid && existing.name === metadata.name && existing.contentHash === metadata.contentHash && existing.module === module && existing.audience === audience) return { id, name: existing.name, status: existing.status };
  await store.transaction(async (tx) => {
    const now = new Date(), budgetPath = `oliviaUploadBudgets/${session.uid}_knowledge_${now.toISOString().slice(0, 10)}`;
    const [claimed, budget] = await Promise.all([tx.getDocument(path), tx.getDocument(budgetPath)]);
    if (claimed) throw oliviaError("knowledge-already-used", "Esta publicación ya fue solicitada. Actualizá la biblioteca.", 409);
    if (Number(budget?.data.count || 0) >= 40) throw oliviaError("upload-limit", "Alcanzaste el límite diario de publicaciones.", 429);
    await tx.commitDocuments([{ type: "create", path, data: { ...metadata, audience, module, active: false, status: "uploading", createdBy: session.uid, createdAt: now, version: 1 } }, { type: budget ? "update" : "create", path: budgetPath, data: { count: Number(budget?.data.count || 0) + 1, expiresAt: new Date(now.getTime() + 2 * 86400000) } }]);
  });
  let providerFileId, vectorStoreId;
  try {
    vectorStoreId = await ensureKnowledgeStore({ store, provider, env });
    const upload = new FormData(); upload.set("file", file, metadata.name); upload.set("purpose", "assistants");
    const uploaded = await provider("files", upload, { env, multipart: true });
    if (!/^file-[A-Za-z0-9_-]+$/.test(uploaded.id || "")) throw oliviaError("knowledge-provider-error", "No se pudo cargar el documento.", 502);
    providerFileId = uploaded.id;
    const indexed = await provider(`vector_stores/${vectorStoreId}/files`, { file_id: providerFileId, attributes: { documentId: id, audience, module } }, { env });
    await store.commit([
      { type: "update", path, data: { vectorStoreId, providerFileId, active: true, status: indexed.status || "in_progress" } },
      { type: "create", path: `auditLogs/olivia_knowledge_${id}`, data: { userId: session.uid, userName: session.profile.name || "Administrador", role: normalizedRole(session.profile), createdAt: new Date(), moduleId: "ai", action: "knowledge.publish", entityId: id, origin: "Asistente IA / Olivia", audience, knowledgeModule: module, result: "indexing", requestId: id, storageCostUsd: null } },
    ]);
    return { id, name: metadata.name, status: indexed.status || "in_progress" };
  } catch (error) {
    let deletionPending = false;
    if (providerFileId) {
      if (vectorStoreId) await provider(`vector_stores/${vectorStoreId}/files/${providerFileId}`, null, { env, method: "DELETE" }).catch(() => { deletionPending = true; });
      await provider(`files/${providerFileId}`, null, { env, method: "DELETE" }).catch(() => { deletionPending = true; });
    }
    await store.commit([{ type: "update", path, data: { active: false, status: "failed", ...(providerFileId ? { providerFileId, vectorStoreId } : {}), deletionPending } }]).catch(() => {});
    throw error;
  }
}
export async function listKnowledge({ session, store, provider = openaiRequest, env = process.env }) {
  return (await listKnowledgePage({ session, store, provider, env })).documents;
}
export async function listKnowledgePage({ session, store, provider = openaiRequest, env = process.env, cursor = null }) {
  assertKnowledgeAdmin(session);
  const result = await store.query("oliviaKnowledgeDocuments", [], 101, [["createdAt", "DESCENDING"], ["__name__", "DESCENDING"]], cursor ? { after: cursor } : {});
  const rows = result.slice(0, 100);
  // Only a small group is polled per refresh; provider requests have a deadline.
  const polling = new Set(rows.filter((row) => row.active && ["in_progress", "uploading"].includes(row.status) && row.providerFileId).slice(0, 5).map((row) => row.id));
  const documents = await Promise.all(rows.map(async (row) => {
    if (polling.has(row.id)) {
      try {
        const file = await provider(`vector_stores/${row.vectorStoreId}/files/${row.providerFileId}`, null, { env, method: "GET", timeoutMs: 5000 });
        row.status = file.status;
        await store.commit([{ type: "update", path: `oliviaKnowledgeDocuments/${row.id}`, data: { status: row.status } }]);
      } catch { /* Existing status remains visible; refresh can retry. */ }
    }
    return { id: row.id, name: row.name, audience: row.audience, module: row.module, status: row.status, active: row.active, version: row.version, deletionPending: Boolean(row.deletionPending) };
  }));
  const last = rows.at(-1);
  return { documents, nextCursor: result.length > 100 ? { id: last.id, createdAt: last.createdAt } : null };
}
export async function removeKnowledge({ session, body, store, provider = openaiRequest, env = process.env }) {
  assertKnowledgeAdmin(session);
  if (body.confirmed !== true) throw oliviaError("confirmation-required", "Confirmá retirar este documento de la biblioteca.", 409);
  const path = `oliviaKnowledgeDocuments/${safeId(body.id)}`, row = await store.get(path);
  if (!row) throw oliviaError("not-found", "No se encontró el documento.", 404);
  // Revoke local authority first: failed provider deletion cannot leak retired context.
  if (!row.deletionPending && row.status === "retired") return { retired: true, deletionPending: false };
  await store.transaction(async (tx) => {
    const current = await tx.getDocument(path);
    if (!current || (!current.data.active && current.data.status === "retired")) return;
    await tx.commitDocuments([{ type: "update", path, data: { active: false, status: "retired", retiredAt: new Date(), deletionPending: true } }, { type: "create", path: `auditLogs/olivia_knowledge_retire_${row.id}`, data: { userId: session.uid, userName: session.profile.name || "Administrador", role: normalizedRole(session.profile), createdAt: new Date(), moduleId: "ai", action: "knowledge.retire", entityId: row.id, origin: "Asistente IA / Olivia", before: { active: current.data.active, status: current.data.status }, after: { active: false, status: "retired" }, result: "revoked", requestId: body.requestId || null } }]);
  });
  try {
    if (row.vectorStoreId && row.providerFileId) await provider(`vector_stores/${row.vectorStoreId}/files/${row.providerFileId}`, null, { env, method: "DELETE" });
    if (row.providerFileId) await provider(`files/${row.providerFileId}`, null, { env, method: "DELETE" });
    await store.commit([{ type: "update", path, data: { deletionPending: false } }]);
    return { retired: true, deletionPending: false };
  } catch { return { retired: true, deletionPending: true }; }
}
export async function retrieveKnowledge({ session, query, context = {}, store, provider = openaiRequest, env = process.env }) {
  const proposed = /soluci[oó]n propuesta|diseñad[oa]|idea futura|requisito propuesto/i.test(query);
  const fallback = proposed
    ? retrieveOliviaKnowledge(query, { role: normalizedRole(session.profile), module: context.module, limit: 4 })
    : retrieveCurrentOliviaKnowledge(query, { role: normalizedRole(session.profile), module: context.module, allowedModules: MODULES.filter(module => can(session.profile, module, "view")), limit: 4 });
  const settings = await store.get("oliviaKnowledgeSettings/global");
  if (!settings?.vectorStoreId) return { documents: fallback, retrieval: "curated", storageCostUsd: null };
  const seller = normalizedRole(session.profile) === "seller";
  const modules = seller ? ["seller"] : MODULES.filter((module) => ["seller", "ai"].includes(module) || can(session.profile, module, "view"));
  if (!modules.length) return { documents: fallback, retrieval: "curated", storageCostUsd: null };
  try {
    const result = await provider(`vector_stores/${settings.vectorStoreId}/search`, { query: query.slice(0, 4000), max_num_results: 4, rewrite_query: true,
      attribute_filter: { type: "and", filters: [{ type: "in", key: "module", value: modules }, ...(seller ? [{ type: "eq", key: "audience", value: "seller" }] : [])] } }, { env, timeoutMs: 6000 });
    const documents = [];
    for (const hit of result.data || []) {
      const id = hit.attributes?.documentId;
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id || "")) continue;
      const row = await store.get(`oliviaKnowledgeDocuments/${id}`);
      if (!row || row.providerFileId !== hit.file_id || !knowledgeAllowed(session, row)) continue;
      documents.push({ id, title: row.name, source: "Biblioteca administrativa", module: row.module, version: row.version, score: hit.score, text: (hit.content || []).filter((part) => part.type === "text").map((part) => part.text).join("\n").slice(0, 2500), trust: "UNTRUSTED_DOCUMENT_DATA" });
    }
    return { documents: [...documents, ...fallback].slice(0, 6), retrieval: "semantic", storageCostUsd: null };
  } catch { return { documents: fallback, retrieval: "curated-fallback", warning: "La biblioteca semántica no respondió; se usó documentación curada.", storageCostUsd: null }; }
}
