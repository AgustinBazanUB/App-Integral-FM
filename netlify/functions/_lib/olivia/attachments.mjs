import { randomUUID, createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { attachmentMetadata, ATTACHMENT_LIMITS } from "../../../../src/shared/oliviaAttachmentPolicy.mjs";
import { safeId, oliviaError } from "../../../../src/shared/oliviaContracts.mjs";
import { assertOliviaAccess } from "./guards.mjs";
import { assertConversationOwner } from "./conversations.mjs";
import { openaiRequest } from "./provider.mjs";

export async function validateAttachment(file) {
  let metadata;
  try { metadata = attachmentMetadata(file); } catch (error) { throw oliviaError("invalid-file", error.message, 422); }
  const bytes = new Uint8Array(await file.arrayBuffer()), buffer = Buffer.from(bytes);
  let valid = false;
  if (metadata.extension === "pdf") valid = buffer.subarray(0, 5).toString() === "%PDF-";
  if (["jpg", "jpeg"].includes(metadata.extension)) valid = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (metadata.extension === "png") valid = buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (metadata.extension === "webp") valid = buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
  if (["docx", "xlsx"].includes(metadata.extension)) {
    let expanded = 0, entries = 0;
    try {
      const files = unzipSync(bytes, { filter: (entry) => {
        expanded += entry.originalSize; entries++;
        if (expanded > ATTACHMENT_LIMITS.maxExpandedBytes || entries > 512 || /\.\.|\\|^\//.test(entry.name) || /vbaProject|\.exe$|\.bin$/i.test(entry.name)) throw new Error("Archivo comprimido no permitido.");
        return entry.name === "[Content_Types].xml" || entry.name === (metadata.extension === "docx" ? "word/document.xml" : "xl/workbook.xml");
      } });
      valid = Boolean(files["[Content_Types].xml"] && files[metadata.extension === "docx" ? "word/document.xml" : "xl/workbook.xml"]);
    } catch { valid = false; }
  }
  if (["txt", "csv"].includes(metadata.extension)) {
    try { const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); valid = !text.includes("\0"); } catch { valid = false; }
  }
  if (!valid) throw oliviaError("invalid-file-content", "El contenido no coincide con el formato permitido o supera los límites de extracción.", 422);
  return { ...metadata, contentHash: createHash("sha256").update(buffer).digest("hex") };
}
export function publicAttachment(row) { return { id: row.id, name: row.name, type: row.type, size: row.size, image: row.image, status: row.status, expiresAt: row.expiresAt }; }
export async function uploadAttachment({ session, form, store, provider = openaiRequest, env = process.env, now = new Date() }) {
  assertOliviaAccess(session);
  if ((await store.get("oliviaConfiguration/global"))?.enabled === false) throw oliviaError("assistant-disabled", "Olivia está deshabilitada.", 503);
  const conversationId = safeId(String(form.get("conversationId") || ""));
  const conversation = await store.get(`oliviaConversations/${conversationId}`);
  assertConversationOwner(session, conversation, now);
  const metadata = await validateAttachment(form.get("file"));
  const id = safeId(String(form.get("requestId") || randomUUID()));
  const existing = await store.get(`oliviaAttachments/${id}`);
  if (existing) {
    if (existing.userId !== session.uid || existing.conversationId !== conversationId) throw oliviaError("permission-denied", "El archivo no pertenece a esta conversación.", 403);
    if (existing.contentHash !== metadata.contentHash || existing.name !== metadata.name || existing.type !== metadata.type) throw oliviaError("request-already-used", "Este intento ya corresponde a otro archivo.", 409);
    if (existing.sessionBinding !== String(session.authTime || "") || new Date(existing.expiresAt) <= now) throw oliviaError("file-unavailable", "El archivo venció. Adjuntalo nuevamente.", 403);
    if (existing.status === "ready") return { attachment: publicAttachment(existing) };
    throw oliviaError("file-uploading", "El archivo ya se está cargando.", 409);
  }
  // Durable claim and daily count keep uploads bounded, including retries and failed attempts.
  const expiresAt = new Date(Math.min(new Date(conversation.expiresAt).getTime(), now.getTime() + ATTACHMENT_LIMITS.temporaryHours * 3600000));
  await store.transaction(async (tx) => {
    const path = `oliviaUploadBudgets/${session.uid}_${now.toISOString().slice(0, 10)}`;
    const [budget, claimed] = await Promise.all([tx.getDocument(path), tx.getDocument(`oliviaAttachments/${id}`)]);
    if (claimed) throw oliviaError("file-uploading", "Este archivo ya fue solicitado.", 409);
    if (Number(budget?.data.count || 0) >= 40) throw oliviaError("upload-limit", "Alcanzaste el límite diario de archivos.", 429);
    await tx.commitDocuments([
      { type: budget ? "update" : "create", path, data: { count: Number(budget?.data.count || 0) + 1, expiresAt: new Date(now.getTime() + 2 * 86400000) } },
      { type: "create", path: `oliviaAttachments/${id}`, data: { ...metadata, userId: session.uid, conversationId, sessionBinding: String(session.authTime || ""), status: "uploading", expiresAt, createdAt: now } },
    ]);
  });
  let providerFileId;
  try {
    const upload = new FormData(); upload.set("file", form.get("file"), metadata.name); upload.set("purpose", "user_data");
    upload.set("expires_after[anchor]", "created_at"); upload.set("expires_after[seconds]", String(ATTACHMENT_LIMITS.temporaryHours * 3600));
    const file = await provider("files", upload, { env, multipart: true });
    if (!/^file-[A-Za-z0-9_-]+$/.test(file.id || "")) throw oliviaError("file-upload-error", "No se pudo cargar el archivo.", 502);
    providerFileId = file.id;
    await store.commit([{ type: "update", path: `oliviaAttachments/${id}`, data: { providerFileId, status: "ready" } }]);
    return { attachment: publicAttachment({ id, ...metadata, status: "ready", expiresAt }) };
  } catch (error) {
    let deletionPending = false;
    if (providerFileId) await provider(`files/${providerFileId}`, null, { env, method: "DELETE" }).catch(() => { deletionPending = true; });
    await store.commit([{ type: "update", path: `oliviaAttachments/${id}`, data: { status: "failed", ...(providerFileId ? { providerFileId } : {}), deletionPending } }]).catch(() => {});
    throw error;
  }
}
export async function resolveAttachments({ ids = [], session, conversationId, store, now = new Date() }) {
  if (!Array.isArray(ids) || ids.length > ATTACHMENT_LIMITS.maxFiles || new Set(ids).size !== ids.length) throw oliviaError("invalid-files", "Podés adjuntar hasta cuatro archivos por mensaje.");
  return Promise.all(ids.map(async (id) => {
    const file = await store.get(`oliviaAttachments/${safeId(id)}`);
    if (!file || file.userId !== session.uid || file.conversationId !== conversationId || file.sessionBinding !== String(session.authTime || "") || file.status !== "ready" || new Date(file.expiresAt) <= now) throw oliviaError("file-unavailable", "El archivo venció o no pertenece a esta conversación. Adjuntalo nuevamente.", 403);
    return file;
  }));
}
export const attachmentInput = (file) => file.image ? { type: "input_image", file_id: file.providerFileId, detail: "auto" } : { type: "input_file", file_id: file.providerFileId };
