import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import "../../../src/styles.css";
import "../../../src/styles-v3.css";
import "../../../src/styles-responsive-mobile.css";
import "../../../src/styles/tokens.css";
import "../../../src/styles/theme.css";
import "../../../src/styles/management.css";
import "../../../src/styles/location-enhancements.css";
import "../../../src/styles/dashboard-filters.css";
import "../../../src/styles/seller-panel.css";
import "../../../src/styles/seller-stage2.css";
import "../../../src/styles/seller-stage2-mobile.css";
import "../../../src/styles/responsive.css";
import "../../../src/styles/performance-optimizations.css";
import "../../../src/styles/metrics-fixes.css";
import "../../../src/styles/seller-customers.css";
import "../../../src/styles/customer-import.css";
import "../../../src/styles/whatsapp-marketing.css";
import "../../../src/styles/inventory.css";
import "../../../src/styles/scrollbars.css";
import "../../../src/styles/seller-compact.css";
import "../../../src/styles/seller-pos.css";
import OliviaAssistant from '../../../src/gestion/olivia/OliviaAssistant';
import { FixtureModule } from './mocks';
import { speechClips, voiceVersion } from '../../../src/shared/oliviaFastSpeech.mjs';
import {conversationClips} from '../../../src/shared/oliviaConversationRouter.mjs';
import { qaTraffic, countTraffic } from './service.mjs';
function Traffic(){const [,refresh]=React.useState(0);React.useEffect(()=>{const update=()=>refresh(x=>x+1);window.addEventListener('olivia:qa-traffic',update);return()=>window.removeEventListener('olivia:qa-traffic',update);},[]);return <output aria-label="Tráfico sintético">{JSON.stringify(qaTraffic)}</output>;}

const qaParams=new URLSearchParams(location.search);
// Protocol fixture only: no OpenAI connection or credentials leave this tab.
if(qaParams.has('live'))window.RTCPeerConnection=class {
  addTrack(track){this.track=track;}
  createDataChannel(){return this.channel={readyState:'open',send:raw=>{
    const event=JSON.parse(raw);
    if(event.type==='input_audio_buffer.clear') {this.item='item-'+Math.random().toString(16).slice(2);this.partialTimer=setTimeout(()=>this.channel.onmessage?.({data:JSON.stringify({type:'conversation.item.input_audio_transcription.delta',item_id:this.item,delta:qaParams.has('wellbeing')?'Olivia, ¿cómo estás?':qaParams.has('stockRead')?'¿Cuántas almendras quedan?':'Hola'})}),200);}
    if(event.type==='input_audio_buffer.commit') {
      this.channel.onmessage?.({data:JSON.stringify({type:'input_audio_buffer.committed',item_id:this.item})});
      const transcript=qaParams.has('wellbeing')?'Olivia, ¿cómo estás?':qaParams.has('stockRead')?'¿Cuántas almendras quedan?':qaParams.has('greeting')?'Hola':qaParams.has('slowVoice')?'Hola, revisame las ventas. Consulta lenta de prueba.':'Hola, revisame las ventas';
      this.finalTimer=setTimeout(()=>this.channel.onmessage?.({data:JSON.stringify({type:'conversation.item.input_audio_transcription.completed',item_id:this.item,transcript})}),30);
    }
  },close(){}};}
  async createOffer(){return {sdp:'v=0\nsynthetic'};}
  async setLocalDescription(){}
  async setRemoteDescription(){this.channel.onmessage({data:JSON.stringify({type:'session.created'})});}
  close(){clearTimeout(this.partialTimer);clearTimeout(this.finalTimer);}
};
if(qaParams.get('clips')==='ready') {
  const pcm=new Int16Array(12000),version=voiceVersion({voice:'es-US-Chirp3-HD-Aoede',speakingRate:1});
  for(let i=0;i<pcm.length;i++)pcm[i]=Math.sin(i/12)*3000;
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pcm.buffer)),x=>x.toString(16).padStart(2,'0')).join('');
  const fetchOriginal=window.fetch.bind(window);
  window.fetch=(url,options)=>{if(String(url).startsWith('/olivia-speech/')){if(!String(url).endsWith('manifest.json'))countTraffic('clips');const entries=String(url).endsWith('conversation-manifest.json')?conversationClips:speechClips;return Promise.resolve(String(url).endsWith('manifest.json')?Response.json({voiceVersion:version,libraryVersion:'1.0.0',entries:entries.map(clip=>({id:clip.id,status:'ready',url:`/olivia-speech/${version}/${clip.id}.pcm`,codec:'pcm_s16le',sampleRate:24000,checksum:digest}))}):new Response(pcm));}return fetchOriginal(url,options);};
}

// Synthetic WebAudio input/output only. No system microphone permission and no
// audible test noise; production mediaDevices are untouched outside this tab.
const NativeContext = window.AudioContext;
window.AudioContext = class {
  constructor() {
    const context = new NativeContext(), silent = context.createGain(); silent.gain.value = 0; silent.connect(context.destination);
    return new Proxy(context, { get(target, key) { if (key === 'destination') return silent; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; } });
  }
};
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
  if (new URLSearchParams(location.search).get('mic') === 'denied') throw new DOMException('Synthetic permission rejection', 'NotAllowedError');
  const context = new NativeContext(), tone = context.createOscillator(), gain = context.createGain(), destination = context.createMediaStreamDestination();
  tone.connect(gain); gain.connect(destination); gain.gain.setValueAtTime(0, context.currentTime); gain.gain.setValueAtTime(.12, context.currentTime + .2); gain.gain.setValueAtTime(0, context.currentTime + 1.2); tone.start(); await context.resume();
  const track = destination.stream.getTracks()[0], stop = track.stop.bind(track); track.stop = () => { stop(); tone.stop(); context.close(); };
  return destination.stream;
} });
document.body.style.cssText = 'margin:0;min-height:100vh;background:#e9edf3;padding:24px;font-family:Manrope,sans-serif';
createRoot(document.getElementById('root')).render(<div className="fm-management-body"><p>QA local · datos y audio sintéticos</p><Traffic /><FixtureModule /><OliviaAssistant /></div>);
