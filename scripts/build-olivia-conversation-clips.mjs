import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {conversationClips} from '../src/shared/oliviaConversationRouter.mjs';
import {voiceVersion} from '../src/shared/oliviaFastSpeech.mjs';
import {defaultOliviaConfiguration} from '../src/shared/oliviaContracts.mjs';
import {validatePreviewFirebase} from './validate-preview-firebase.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const config=defaultOliviaConfiguration().naturalVoice;
const plan={voice:config.voice,speakingRate:config.speakingRate,voiceVersion:voiceVersion(config),clips:conversationClips,characters:conversationClips.reduce((sum,c)=>sum+Array.from(c.text).length,0)};
plan.estimatedCostUsd=plan.characters*30/1e6;const approvalHash=sha(JSON.stringify(plan));
async function main(){
  if(!process.argv.includes('--execute')){console.log(JSON.stringify({...plan,approvalHash},null,2));return;}
  if(!process.argv.includes('--approve-plan='+approvalHash))throw Error('Falta aprobar el plan exacto.');
  const env=process.env,expected='app-integral-fm-pruebas';
  if(env.NETLIFY!=='true'||env.CONTEXT!=='deploy-preview'||env.HEAD!=='codex/olivia-latency-v3'||env.SITE_ID!=='8b6e2130-3336-4f04-9ab8-a58dffd96bf7')throw Error('La generación requiere el build de la preview autorizada.');
  validatePreviewFirebase(env);
  const account=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON||'{}'),google=JSON.parse(env.GOOGLE_APPLICATION_CREDENTIALS_JSON||'{}');
  const authResponse=await fetch('https://identitytoolkit.googleapis.com/v1/projects?key='+encodeURIComponent(env.FIREBASE_WEB_API_KEY||''),{signal:AbortSignal.timeout(10000)}),auth=authResponse.ok?await authResponse.json():{};
  if(env.FIREBASE_PROJECT_ID!==expected||account.project_id!==expected||!account.client_email?.endsWith('@'+expected+'.iam.gserviceaccount.com')||(env.FIREBASE_ADMIN_CLIENT_EMAIL&&!env.FIREBASE_ADMIN_CLIENT_EMAIL.endsWith('@'+expected+'.iam.gserviceaccount.com'))||auth.projectId!=='545036860675'||!auth.authorizedDomains?.includes(expected+'.firebaseapp.com')||google.project_id!=='app-integral-fm-olivia-preview'||env.GOOGLE_CLOUD_PROJECT!==google.project_id)throw Error('La configuración debe corresponder solo a pruebas.');
  const {createOliviaStore}=await import('../netlify/functions/_lib/olivia/store.mjs');
  const saved=await createOliviaStore({env:{...env,VITE_FIREBASE_PROJECT_ID:env.VITE_PREVIEW_FIREBASE_PROJECT_ID}}).get('oliviaConfiguration/global');
  if(voiceVersion(saved?.naturalVoice||config)!==plan.voiceVersion)throw Error('La voz actual difiere del plan.');
  const {chirpClient}=await import('../netlify/functions/_lib/olivia/chirp.mjs');
  const directory=path.join('public/olivia-speech',plan.voiceVersion),file=path.join(directory,'conversation-manifest.json');await mkdir(directory,{recursive:true});
  let old;try{old=JSON.parse(await readFile(file,'utf8'));}catch{}
  const entries=[];let generated=0;
  for(const clip of conversationClips){
    const previous=old?.entries?.find(e=>e.id===clip.id&&e.text===clip.text&&e.voiceVersion===plan.voiceVersion);let bytes;
    if(previous){try{const cached=await readFile(path.join(directory,clip.id+'.pcm'));if(sha(cached)===previous.checksum)bytes=cached;}catch{}}
    if(bytes){entries.push(previous);continue;}
    const started=performance.now();let firstPacketMs=null;
    bytes=await new Promise((resolve,reject)=>{const stream=chirpClient().streamingSynthesize(),chunks=[];const timer=setTimeout(()=>{stream.cancel();reject(Error('Google TTS superó el tiempo permitido.'));},30000);stream.on('data',frame=>{if(frame.audioContent?.length){firstPacketMs??=performance.now()-started;chunks.push(frame.audioContent);}});stream.on('error',()=>{clearTimeout(timer);reject(Error('Google TTS no generó el audio.'));});stream.on('end',()=>{clearTimeout(timer);resolve(Buffer.concat(chunks));});stream.write({streamingConfig:{voice:{languageCode:'es-US',name:plan.voice},streamingAudioConfig:{audioEncoding:'PCM',sampleRateHertz:24000,speakingRate:plan.speakingRate}}});stream.write({input:{text:clip.text}});stream.end();});
    if(!bytes.length||bytes.length%2||bytes.length>960000)throw Error('PCM inválido.');
    await writeFile(path.join(directory,clip.id+'.pcm'),bytes);generated++;
    entries.push({...clip,voice:plan.voice,voiceVersion:plan.voiceVersion,codec:'pcm_s16le',sampleRate:24000,durationMs:bytes.length/48,checksum:sha(bytes),textChecksum:sha(clip.text),status:'ready',url:'/olivia-speech/'+plan.voiceVersion+'/'+clip.id+'.pcm',providerFirstPacketMs:firstPacketMs,providerCompleteMs:performance.now()-started});
    await writeFile(file,JSON.stringify({...plan,libraryVersion:'1.0.0',approvalHash,generatedAt:new Date().toISOString(),firebaseProject:expected,entries},null,2)+'\n');
  }
  console.log(JSON.stringify({ready:entries.length,generated,characters:plan.characters,estimatedCostUsd:plan.estimatedCostUsd,firebaseVerified:true,voice:plan.voice}));
}
main().catch(error=>{console.error(error.message?.startsWith('Google TTS')?error.message:'No se generaron los clips de conversación: revisar las comprobaciones del entorno o el plan.');process.exitCode=1;});
