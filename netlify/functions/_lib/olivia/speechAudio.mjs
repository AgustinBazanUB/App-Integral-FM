import { createHash } from 'node:crypto';
import { speechTemplates, voiceVersion } from '../../../../src/shared/oliviaFastSpeech.mjs';
import { safeId, oliviaError, retentionDate } from '../../../../src/shared/oliviaContracts.mjs';
import { canUseOliviaVoice } from '../../../../src/shared/oliviaVoiceAvailability.mjs';
import { assertConversationOwner } from './conversations.mjs';
import { authenticatedFirstName } from './fastSpeech.mjs';
import { synthesizeChirp } from './chirp.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');

export async function personalizedSpeech({session,store,engine,body,request,synthesize=synthesizeChirp,now=new Date()}) {
  if(!canUseOliviaVoice(session)) throw oliviaError('voice-not-enabled','La voz no está habilitada.',403);
  const config=await engine.configuration();
  if(!config.enabled || !config.naturalVoice.enabled) throw oliviaError('voice-not-enabled','La voz no está disponible.',503);
  assertConversationOwner(session,await store.get(`oliviaConversations/${safeId(body.conversationId)}`),now);
  const template=speechTemplates.find(item=>item.id===body.clipId), name=authenticatedFirstName(session);
  if(!template || !name) throw oliviaError('clip-unavailable','Usá una frase genérica.',404);
  const text=template.template.replace('{firstName}',name), version=voiceVersion(config.naturalVoice);
  const path=`oliviaPrivateSpeech/${session.uid}_${hash(version+'\0'+template.id+'\0'+text)}`;
  const cached=await store.get(path);
  if(cached?.userId===session.uid && cached.status==='ready' && cached.voiceVersion===version && new Date(cached.expiresAt)>now && cached.audio) {
    const bytes=Buffer.from(cached.audio,'base64');
    if(hash(bytes)===cached.checksum) return new Response(bytes,{headers:{'Content-Type':'audio/pcm;rate=24000;channels=1','Cache-Control':'no-store','X-Olivia-Audio-Checksum':cached.checksum,'X-Olivia-Voice-Version':version}});
  }
  if(body.operation!=='prepare') throw oliviaError('clip-unavailable','La variante privada todavía no está preparada.',404);
  let acquired=false;
  await store.transaction(async tx=>{
    const prior=(await tx.getDocument(path))?.data;
    if(prior?.status==='building' && new Date(prior.leaseUntil)>now || prior?.status==='ready' && new Date(prior.expiresAt)>now)return;
    await tx.commitDocuments([{type:prior?'update':'create',path,data:{userId:session.uid,voiceVersion:version,status:'building',leaseUntil:new Date(now.getTime()+60000),expiresAt:retentionDate(config.retentionMonths,now),retentionExpiresAt:retentionDate(config.retentionMonths,now)}}]); acquired=true;
  });
  if(!acquired) return new Response(null,{status:202,headers:{'Cache-Control':'no-store'}});
  try {
    const synthesisRequest=new Request(request.url,{method:'POST',signal:request.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId:body.conversationId,requestId:safeId(body.requestId),text})});
    const response=await synthesize({request:synthesisRequest,session,store,engine});
    const bytes=Buffer.from(await response.arrayBuffer());
    if(!bytes.length || bytes.length>300000) throw Error('Audio inválido.');
    await store.commit([{type:'update',path,data:{status:'ready',audio:bytes.toString('base64'),checksum:hash(bytes),durationMs:bytes.length/48,characters:Array.from(text).length,createdAt:now}}]);
    return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});
  } catch(error) { await store.commit([{type:'update',path,data:{status:'failed'}}]).catch(()=>{}); throw error; }
}
