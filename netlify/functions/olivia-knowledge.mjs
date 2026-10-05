import { oliviaSession, json, errorResponse } from "./_lib/olivia/http.mjs";
import { createOliviaStore } from "./_lib/olivia/store.mjs";
import { publishKnowledge, listKnowledgePage, removeKnowledge } from "./_lib/olivia/knowledge.mjs";
import { boundedBody, boundedMultipart } from "./_lib/olivia/requestBody.mjs";
export default async function handler(request) {
  if (request.method !== "POST") return json({ message: "Método no permitido." }, 405);
  try {
    const session = await oliviaSession(request), store = createOliviaStore();
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) return json(await publishKnowledge({ session, form: await boundedMultipart(request), store }));
    const body = await (await boundedBody(request, 65000)).json();
    if (body.operation === "list") return json(await listKnowledgePage({ session, store, cursor: body.cursor || null }));
    if (body.operation === "remove") return json(await removeKnowledge({ session, body, store }));
    return json({ message: "Operación no permitida." }, 400);
  } catch (error) { return errorResponse(error); }
}
