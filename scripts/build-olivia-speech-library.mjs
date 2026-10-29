import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { speechClips, speechTemplates, voiceVersion, SPEECH_LIBRARY_VERSION } from '../src/shared/oliviaFastSpeech.mjs';
import { defaultOliviaConfiguration } from '../src/shared/oliviaContracts.mjs';

export const checksum = bytes => createHash('sha256').update(bytes).digest('hex');
export function speechBuildPlan(config = defaultOliviaConfiguration().naturalVoice) {
  if (!['es-US-Chirp3-HD-Aoede','es-US-Chirp3-HD-Charon'].includes(config.voice) || !Number.isFinite(config.speakingRate) || config.speakingRate < .9 || config.speakingRate > 1.1) throw Error('Configuración de voz inválida.');
  const version=voiceVersion(config), characters=speechClips.reduce((sum,clip)=>sum+Array.from(clip.text).length,0);
  const plan={libraryVersion:SPEECH_LIBRARY_VERSION,voiceVersion:version,voice:config.voice,language:'es-AR',voiceLocale:'es-US',speakingRate:config.speakingRate,codec:'pcm_s16le',sampleRate:24000,genericClips:speechClips.length,personalizedTemplates:speechTemplates.length,characters,usdPerMillionCharacters:30,estimatedCostUsd:characters*30/1e6,pricingDate:'2026-10-29',pricingSource:'https://cloud.google.com/text-to-speech/pricing',sourceChecksum:checksum(JSON.stringify(speechClips))};
  return {...plan,approvalHash:checksum(JSON.stringify(plan))};
}
export async function buildSpeechLibrary({ config, outputRoot='public/olivia-speech', execute=false, approvalHash, synthesize }={}) {
  const plan=speechBuildPlan(config);
  if(execute && approvalHash!==plan.approvalHash) throw Error('La generación paga requiere autorización del plan exacto (--approve-plan). Ejecutá primero el cálculo sin --execute.');
  const directory=path.join(outputRoot,plan.voiceVersion); await mkdir(directory,{recursive:true});
  const manifestPath=path.join(directory,'manifest.json');
  let previous; try { previous=JSON.parse(await readFile(manifestPath,'utf8')); } catch { previous=null; }
  const entries=[]; let generated=0;
  for(const clip of speechClips) {
    const textChecksum=checksum(clip.text), old=previous?.entries?.find(item=>item.id===clip.id&&item.textChecksum===textChecksum&&item.voiceVersion===plan.voiceVersion);
    let valid=false;
    if(old?.checksum) { try { valid=checksum(await readFile(path.join(directory,clip.id+'.pcm')))===old.checksum; } catch {} }
    let entry=valid ? old : {id:clip.id,text:clip.text,category:clip.category,textChecksum,voice:plan.voice,voiceVersion:plan.voiceVersion,language:plan.language,voiceLocale:plan.voiceLocale,codec:plan.codec,sampleRate:24000,durationMs:null,checksum:null,status:'pending-authorization',url:null};
    if(!valid && execute) {
      if(!synthesize) throw Error('Falta el sintetizador.');
      const bytes=Buffer.from(await synthesize(clip.text,plan));
      if(!bytes.length || bytes.length%2 || bytes.length>960000) throw Error('Audio PCM vacío, inválido o demasiado grande: '+clip.id);
      await writeFile(path.join(directory,clip.id+'.pcm'),bytes);
      entry={...entry,durationMs:bytes.length/48,checksum:checksum(bytes),status:'ready',url:`/olivia-speech/${plan.voiceVersion}/${clip.id}.pcm`}; generated++;
    }
    entries.push(entry);
    if(execute) await writeFile(manifestPath,JSON.stringify({...plan,entries},null,2)+'\n'); // Resume without re-synthesizing completed files.
  }
  const manifest={...plan,entries}; await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  return {...plan,generated,ready:entries.filter(item=>item.status==='ready').length,manifestPath};
}
async function main() {
  const args=process.argv.slice(2), value=name=>args.find(arg=>arg.startsWith(name+'='))?.slice(name.length+1);
  const config=value('--config') ? JSON.parse(await readFile(value('--config'),'utf8')).naturalVoice : defaultOliviaConfiguration().naturalVoice;
  const execute=args.includes('--execute');
  let synthesize;
  if(execute) {
    const plan=speechBuildPlan(config);
    if(value('--approve-plan')!==plan.approvalHash) throw Error('Falta aprobación del plan exacto; no se llamó a Google.');
    const { chirpClient }=await import('../netlify/functions/_lib/olivia/chirp.mjs');
    synthesize=(text,plan)=>new Promise((resolve,reject)=>{
      const stream=chirpClient().streamingSynthesize(), chunks=[];
      stream.on('data',frame=>{if(frame.audioContent)chunks.push(frame.audioContent);});stream.on('error',()=>reject(Error('Google TTS no pudo generar el clip.')));stream.on('end',()=>resolve(Buffer.concat(chunks)));
      stream.write({streamingConfig:{voice:{languageCode:plan.voiceLocale,name:plan.voice},streamingAudioConfig:{audioEncoding:'PCM',sampleRateHertz:24000,speakingRate:plan.speakingRate}}});stream.write({input:{text}});stream.end();
    });
  }
  console.log(JSON.stringify(await buildSpeechLibrary({config,execute,approvalHash:value('--approve-plan'),synthesize}),null,2));
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error=>{console.error(error.message);process.exitCode=1;});
