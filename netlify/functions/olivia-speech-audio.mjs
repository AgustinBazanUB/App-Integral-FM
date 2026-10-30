import { createOliviaStore } from './_lib/olivia/store.mjs';
import { createOliviaEngine } from './_lib/olivia/engine.mjs';
import { oliviaSession, json, errorResponse } from './_lib/olivia/http.mjs';
import { personalizedSpeech } from './_lib/olivia/speechAudio.mjs';
export default async function handler(request) {
  if(request.method!=='POST')return json({message:'Método no permitido.'},405);
  try {
    const session=await oliviaSession(request),raw=await request.text();
    if(raw.length>2000)return json({message:'Solicitud demasiado grande.'},413);
    const store=createOliviaStore();return await personalizedSpeech({session,store,engine:createOliviaEngine({store}),request,body:JSON.parse(raw)});
  } catch(error){return errorResponse(error);}
}
