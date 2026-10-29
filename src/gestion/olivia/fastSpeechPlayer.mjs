import { VoiceAcknowledgement } from './voiceAcknowledgement.mjs';
import { chooseLocalGreeting, speechIntent } from '../../shared/oliviaFastSpeech.mjs';

export class FastSpeechPlayer {
  constructor({cache,select,loadFallback,play,onMetric=()=>{},now=()=>performance.now(),setTimer=(fn,ms)=>globalThis.setTimeout(fn,ms),clearTimer=id=>globalThis.clearTimeout(id)}) {
    Object.assign(this,{cache,select,play,onMetric,now,setTimer,clearTimer});this.recent=[];this.generation=0;
    this.fallback=new VoiceAcknowledgement({load:loadFallback,play,delayMs:0});
  }
  async warm(){await this.cache.warm();const manifest=await this.cache.manifest();if(!manifest?.entries?.some(item=>item.status==='ready'))await this.fallback.warm();}
  anticipate(text){const clip=chooseLocalGreeting(text,this.recent);if(clip)void this.cache.get(clip.id);}
  async greeting(text,isCurrent=()=>true) {
    const clip=chooseLocalGreeting(text,this.recent);if(!clip)return false;
    const privateBytes=this.cache.peek?.('personalizada_01');
    const generation=this.generation,response=privateBytes?new Response(privateBytes.slice(0)):await this.cache.response({clip_id:clip.id,intent:'greeting'});
    // Missing personal audio never delays this greeting; prepare only after a real greeting.
    if(!privateBytes)void this.cache.get('personalizada_01');
    if(!response || generation!==this.generation || !isCurrent())return false;
    this.recent.push(clip.id);void this.playClip(response,{text:clip.text},isCurrent,generation);return true;
  }
  start(isCurrent=()=>true,context={}) {
    this.cancel();const generation=this.generation,started=this.now();this.controller=new AbortController();
    const selected=Promise.resolve().then(()=>this.select(context,this.controller.signal)).catch(()=>null);
    // One bounded intermediate intervention. Never wait for this on the main path.
    this.timer=this.setTimer(async()=>{
      let deadline;
      const choice=await Promise.race([selected,new Promise(resolve=>{deadline=this.setTimer(()=>resolve(null),500);})]);this.clearTimer(deadline);
      if(generation!==this.generation || !isCurrent())return;
      if(choice?.mode==='silence')return;
      const fallback=['espera_real_01','espera_real_02','espera_real_03'].find(id=>!this.recent.slice(-2).includes(id)) || 'espera_real_01';
      const decision=choice?.clip_id?choice:{clip_id:fallback,intent:speechIntent(context.text),text:''};
      const response=await this.cache.response(decision);
      if(generation!==this.generation || !isCurrent())return;
      if(!response){this.fallback.start(isCurrent);return;}
      this.recent.push(decision.clip_id);this.recent=this.recent.slice(-8);
      if(choice?.selectionMs!=null)this.onMetric('selection',choice.selectionMs);
      if(choice?.estimatedCostUsd!=null)this.onMetric('selectionCostUsd',choice.estimatedCostUsd);
      this.onMetric('fastAudioAvailable',this.now()-started);
      await this.playClip(response,decision,isCurrent,generation);
    },120);
  }
  async playClip(response,choice,isCurrent,generation) {
    if(generation!==this.generation || !isCurrent())return;
    const controller=this.playback=new AbortController();
    try{await this.play(response,{signal:controller.signal,text:choice.text});}catch{}finally{if(this.playback===controller)this.playback=null;}
  }
  cancel(){this.generation++;this.clearTimer(this.timer);this.controller?.abort();this.playback?.abort('fast-speech-ended');this.fallback.cancel();}
  dispose(){this.cancel();this.fallback.dispose();this.cache.dispose();}
}
