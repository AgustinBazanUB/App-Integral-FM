// Audio/transport fixture only: no physical microphone, provider or database.
export function measuredVoice(Voice, { text, adaptiveEndpointing=true }={}) {
  let now=0,amplitude=0,partial;
  const frames=[],turns=[],events=[],tracks=[{enabled:true,stop(){this.stopped=true;}}];
  class Recorder {static isTypeSupported(){return true;}constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['synthetic audio'])});this.onstop?.();}}
  const context={currentTime:0,destination:{},resume:async()=>{},close:async()=>{},createMediaStreamSource:()=>({connect(){},disconnect(){}}),createAnalyser:()=>({fftSize:1024,connect(){},disconnect(){},getFloatTimeDomainData(buffer){buffer.fill(amplitude);}})};
  const voice=new Voice({adaptiveEndpointing,Recorder,AudioContext:class{constructor(){return context;}},mediaDevices:{getUserMedia:async()=>({getTracks:()=>tracks,getAudioTracks:()=>tracks})},frame:fn=>{frames.push(fn);return frames.length;},cancelFrame(){},now:()=>now,createTranscriber:async(_stream,onPartial)=>{partial=onPartial;return {closed:false,beginTurn(){},commit:async()=>({text,transcriptAt:now}),close(){this.closed=true;}};},onTurn:(_blob,metadata)=>turns.push(metadata),onTrace:event=>events.push(event)});
  return {voice,turns,events,tick(at,level=0,transcript){now=at;amplitude=level;if(transcript!==undefined)partial?.(transcript);frames.shift()?.();}};
}
export async function measureEndpoint(Voice,text){
  const f=measuredVoice(Voice,{text});await f.voice.start();f.tick(100,.1);f.tick(200,.1,text);let finishAt=0;
  for(let at=216;at<=5200;at+=16){f.tick(at);if(!f.voice.recordingTurn){finishAt=at;break;}}
  await new Promise(resolve=>setImmediate(resolve));f.voice.close();
  if(f.turns.length!==1)throw Error('La muestra no produjo exactamente un turno.');return {silenceMs:finishAt-200,endedAt:finishAt};
}
