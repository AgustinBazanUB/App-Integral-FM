import { oliviaSession, json, errorResponse } from "./_lib/olivia/http.mjs";
import { createOliviaStore } from "./_lib/olivia/store.mjs";
import { uploadAttachment } from "./_lib/olivia/attachments.mjs";
import { boundedMultipart } from "./_lib/olivia/requestBody.mjs";
export default async function handler(request) {
  if (request.method !== "POST") return json({ message: "Método no permitido." }, 405);
  try {
    const session = await oliviaSession(request);
    const form = await boundedMultipart(request);
    return json(await uploadAttachment({ session, form, store: createOliviaStore() }));
  } catch (error) { return errorResponse(error); }
}
