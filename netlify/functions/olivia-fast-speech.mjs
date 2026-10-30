import { createOliviaStore } from './_lib/olivia/store.mjs';
import { createOliviaEngine } from './_lib/olivia/engine.mjs';
import { oliviaSession, json, errorResponse } from './_lib/olivia/http.mjs';
import { fastSpeechRoute } from './_lib/olivia/fastSpeech.mjs';
export default async function handler(request) {
  if(request.method !== 'POST') return json({message:'Método no permitido.'},405);
  try {
    const session=await oliviaSession(request), raw=await request.text();
    if(raw.length>9000) return json({message:'Solicitud demasiado grande.'},413);
    const store=createOliviaStore();
    return json(await fastSpeechRoute({session,store,engine:createOliviaEngine({store}),body:JSON.parse(raw)}));
  } catch(error) { return errorResponse(error); }
}
