import { VoiceAcknowledgement } from './voiceAcknowledgement.mjs';
import { chooseLocalGreeting, speechIntent, eligibleSpeechClips } from '../../shared/oliviaFastSpeech.mjs';
import { instantConversation } from '../../shared/oliviaConversationRouter.mjs';

export class FastSpeechPlayer {
  constructor({cache,select,latencyMode=false,loadFallback,play,onMetric=()=>{},now=()=>performance.now(),setTimer=(fn,ms)=>globalThis.setTimeout(fn,ms),clearTimer=id=>globalThis.clearTimeout(id)}) {
    Object.assign(this,{cache,select,play,onMetric,now,setTimer,clearTimer,latencyMode});this.recent=[];this.generation=0;
    this.fallback=new VoiceAcknowledgement({load:loadFallback,play,delayMs:0});
  }
  async warm(){await this.cache.warm();const manifest=await this.cache.manifest();if(!manifest?.entries?.some(item=>item.status==='ready'))await this.fallback.warm();}
  anticipate(text){const clip=(this.latencyMode?instantConversation(text):null)||chooseLocalGreeting(text,this.recent);if(clip)void this.cache.get(clip.id);}
  async greeting(text,isCurrent=()=>true) {
    const instant=this.latencyMode?instantConversation(text):null,clip=instant||chooseLocalGreeting(text,this.recent);if(!clip)return false;
    const privateBytes=!instant && this.cache.peek?.('personalizada_01');
    const generation=this.generation,response=privateBytes?new Response(privateBytes.slice(0)):await this.cache.response({clip_id:clip.id,intent:'greeting'});
    // Missing personal audio never delays this greeting; prepare only after a real greeting.
    if(!instant && !privateBytes)void this.cache.get('personalizada_01');
    if(!response || generation!==this.generation || !isCurrent())return false;
    this.recent.push(clip.id);void this.playClip(response,{text:clip.text},isCurrent,generation);return true;
  }
  start(isCurrent=()=>true,context={}) {
    this.cancel();const generation=this.generation,started=this.now();this.controller=new AbortController();
    this.facts={processingActive:false,toolQuery:null};this.context=context;this.intervened=false;
    const selected=this.latencyMode?Promise.resolve(null):Promise.resolve().then(()=>this.select(context,this.controller.signal)).catch(()=>null);
    // One bounded intermediate intervention. Never wait for this on the main path.
    this.runIntervention=async()=>{
      let deadline,choice=null;
      if(!this.latencyMode){choice=await Promise.race([selected,new Promise(resolve=>{deadline=this.setTimer(()=>resolve(null),500);})]);this.clearTimer(deadline);}
      if(generation!==this.generation || !isCurrent() || this.intervened)return;
      if(this.latencyMode) {
        const intent=speechIntent(context.text),candidates=eligibleSpeechClips({finalized:true,intent,...this.facts,recent:this.recent});
        const clip=candidates.find(c=>this.facts.toolQuery===intent && c.category!=='espera_real') || candidates.find(c=>this.cache.peek?.(c.id)) || candidates[0];
        if(!clip){this.waitingForFacts=true;return;}
        const response=await this.cache.response({clip_id:clip.id,intent});
        if(!response || generation!==this.generation || !isCurrent())return;
        this.intervened=true;this.waitingForFacts=false;this.recent.push(clip.id);this.onMetric('selection',0);this.onMetric('selectionCostUsd',0);
        this.onMetric('fastAudioAvailable',this.now()-started);
        await this.playClip(response,clip,isCurrent,generation);return;
      }
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
    };this.timer=this.setTimer(this.runIntervention,this.latencyMode?850:120);
  }
  updateFacts({accepted=false,tools=[]}={}) {
    if(!this.facts)return;
    if(accepted)this.facts.processingActive=true;
    const names=tools.join(' ');
    const toolQuery=/get_stock|search_products|inventory/.test(names)?'stock':/sales|metrics/.test(names)?'sales':/shipment|orders/.test(names)?'shipping':null;
    if(toolQuery){this.facts={processingActive:true,toolQuery};const clip=eligibleSpeechClips({finalized:true,intent:toolQuery,...this.facts,recent:this.recent}).find(c=>c.category!=='espera_real');if(clip)void this.cache.get(clip.id);}
    if(this.waitingForFacts && this.facts.processingActive && !this.intervened && this.runIntervention){this.waitingForFacts=false;this.timer=this.setTimer(this.runIntervention,0);}
  }
  async playClip(response,choice,isCurrent,generation) {
    if(generation!==this.generation || !isCurrent())return;
    const controller=this.playback=new AbortController();
    try{await this.play(response,{signal:controller.signal,text:choice.text});}catch{}finally{if(this.playback===controller)this.playback=null;}
  }
  cancel(){this.generation++;this.waitingForFacts=false;this.runIntervention=null;this.clearTimer(this.timer);this.controller?.abort();this.playback?.abort('fast-speech-ended');this.fallback.cancel();}
  dispose(){this.cancel();this.fallback.dispose();this.cache.dispose();}
}
