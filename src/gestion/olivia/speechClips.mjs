import { voiceVersion, speechClips } from '../../shared/oliviaFastSpeech.mjs';

export class SpeechClipCache {
  constructor({ voice, userId, conversation=false, fetchImpl=(...args)=>globalThis.fetch(...args), privateAudio, preparePrivate, digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('') }) {
    Object.assign(this,{voice,userId,fetchImpl,privateAudio,preparePrivate,digest,conversation});this.version=voiceVersion(voice);this.memory=new Map();this.ready=new Map();this.prepared=new Set();this.controller=new AbortController();
  }
  async manifest() {
    this.manifestPromise ||= Promise.all([this.fetchImpl(`/olivia-speech/${this.version}/manifest.json`,{signal:this.controller.signal,cache:'no-cache'}).then(r=>r.ok?r.json():null).catch(()=>null),this.conversation?this.fetchImpl(`/olivia-speech/${this.version}/conversation-manifest.json`,{signal:this.controller.signal,cache:'no-cache'}).then(r=>r.ok?r.json():null).catch(()=>null):null]).then(([main,extra])=>main?.voiceVersion===this.version && main?.libraryVersion==='1.0.0'?{...main,entries:[...main.entries,...(extra?.voiceVersion===this.version?extra.entries || []:[])]}:null).catch(()=>null);
    return this.manifestPromise;
  }
  async get(id,{prepare=true}={}) {
    if(this.controller.signal.aborted)return null;
    if(this.memory.has(id))return this.memory.get(id);
    const promise=(async()=>{
      let bytes, expected;
      if(id.startsWith('personalizada_')) {
        const response=await this.privateAudio(id,this.controller.signal).catch(()=>null);
        if(!response?.ok) {
          if(prepare && !this.prepared.has(id)){this.prepared.add(id);void this.preparePrivate?.(id,this.controller.signal).catch(()=>{});}
          return null;
        }
        if(response.headers.get('X-Olivia-Voice-Version')!==this.version)return null;
        bytes=await response.arrayBuffer();expected=response.headers.get('X-Olivia-Audio-Checksum');
      } else {
        const m=await this.manifest(), entry=m?.entries?.find(item=>item.id===id && item.status==='ready');
        const path=`/olivia-speech/${this.version}/${id}.pcm`;
        if(!entry || entry.url!==path || !/^[a-z0-9_]+$/.test(id) || entry.codec!=='pcm_s16le' || entry.sampleRate!==24000)return null;
        const response=await this.fetchImpl(path,{signal:this.controller.signal,cache:'force-cache'});if(!response.ok)return null;
        bytes=await response.arrayBuffer();expected=entry.checksum;
      }
      if(!bytes.byteLength || bytes.byteLength>960000 || bytes.byteLength%2 || !expected || await this.digest(bytes)!==expected)return null;
      return bytes;
    })().catch(()=>null);
    this.memory.set(id,promise);
    if(this.memory.size>8){const oldest=this.memory.keys().next().value;this.memory.delete(oldest);this.ready.delete(oldest);}
    const bytes=await promise;if(!bytes)this.memory.delete(id);else if(!this.controller.signal.aborted)this.ready.set(id,bytes);return bytes;
  }
  async warm() {await Promise.all([...['saludo_01','espera_real_01','espera_real_02',...(this.conversation?['bienestar_01','agradecimiento_01','despedida_01']:[])].map(id=>this.get(id)),...(this.privateAudio?[this.get('personalizada_01',{prepare:false})]:[])]);}
  peek(id){return this.ready.get(id) || null;}
  async response(choice) {
    let bytes=await this.get(choice.clip_id);
    if(!bytes && choice.clip_id?.startsWith('personalizada_')) bytes=await this.get(choice.intent==='greeting'?'saludo_01':'espera_real_01');
    return bytes?new Response(bytes.slice(0),{headers:{'Content-Type':'audio/pcm;rate=24000;channels=1'}}):null;
  }
  dispose(){this.controller.abort();this.memory.clear();this.ready.clear();this.prepared.clear();this.manifestPromise=null;}
}
