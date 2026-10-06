export const ATTACHMENT_LIMITS = Object.freeze({ maxBytes: 4 * 1024 * 1024, maxFiles: 4, maxExpandedBytes: 20 * 1024 * 1024, temporaryHours: 24 });
export const ATTACHMENT_TYPES = Object.freeze({
  pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv", txt: "text/plain",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
});
export function attachmentMetadata(file) {
  const extension = String(file?.name || "").split(".").at(-1).toLowerCase();
  const mime = ATTACHMENT_TYPES[extension];
  if (!mime || !file.size || file.size > ATTACHMENT_LIMITS.maxBytes) throw new Error("Elegí PDF, DOCX, XLSX, CSV, TXT o imágenes de hasta 4 MB.");
  const actual = String(file.type || "").split(";")[0].toLowerCase();
  if (actual && actual !== mime && !(extension === "csv" && actual === "application/vnd.ms-excel")) throw new Error("El tipo del archivo no coincide con su extensión.");
  return { name: file.name.replace(/[\x00-\x1f/\\]/g, "_").slice(0, 150), type: mime, extension, size: file.size, image: mime.startsWith("image/") };
}
