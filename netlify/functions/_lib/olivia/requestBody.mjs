import { oliviaError } from "../../../../src/shared/oliviaContracts.mjs";
export async function boundedBody(request, maxBytes) {
  if (Number(request.headers.get("content-length")) > maxBytes) throw oliviaError("request-too-large", "El archivo o solicitud supera el límite permitido.", 413);
  if (!request.body) throw oliviaError("invalid-input", "No se recibió la solicitud.");
  const reader = request.body.getReader(), chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw oliviaError("request-too-large", "El archivo o solicitud supera el límite permitido.", 413);
      chunks.push(value);
    }
    return new Response(new Blob(chunks), { headers: { "Content-Type": request.headers.get("content-type") || "application/json" } });
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}
export async function boundedMultipart(request) {
  const form = await (await boundedBody(request, 4.5 * 1024 * 1024)).formData();
  if (form.getAll("file").length !== 1 || [...form.keys()].some((key) => !["file", "conversationId", "requestId", "audience", "module", "confirmed"].includes(key))) throw oliviaError("invalid-file", "Adjuntá un solo archivo por carga.");
  return form;
}
