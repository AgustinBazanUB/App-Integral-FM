// Reuses the already-authorized microphone. No generated assistant audio or tools.
export class LiveTranscription {
  constructor({connect,stop,onPartial=()=>{},onUnavailable=()=>{},Peer=globalThis.RTCPeerConnection,now=()=>performance.now()}) {
    Object.assign(this,{connect,stop,onPartial,onUnavailable,Peer,now});this.pending=[];this.items=new Map();this.closed=false;this.controller=new AbortController();
  }
  async start(stream) {
    if(!this.Peer)throw Error('Este navegador usará el dictado por turnos.');
    const peer=this.peer=new this.Peer();
    this.track=stream.getAudioTracks()[0].clone();this.track.enabled=false;peer.addTrack(this.track,stream);
    const channel=this.channel=peer.createDataChannel('oai-events');
    const ready=new Promise((resolve,reject)=>{
      this.readyReject=reject;
      this.readyTimer=setTimeout(()=>reject(Error('No se pudo conectar la transcripción en vivo.')),12000);
      channel.onmessage=({data})=>{let event;try{event=JSON.parse(data);}catch{return;}
        if(['session.created','session.updated'].includes(event.type)){clearTimeout(this.readyTimer);resolve();}
        this.receive(event);
      };
    });
    ready.catch(()=>{});
    peer.onconnectionstatechange=()=>{if(['failed','disconnected','closed'].includes(peer.connectionState) && !this.closed)this.fail(Error('La transcripción en vivo se interrumpió; sigo con el dictado por turnos.'));};
    const offer=await peer.createOffer();await peer.setLocalDescription(offer);
    const session=await this.connect(offer.sdp,this.controller.signal);this.session=session;
    if(this.closed){void this.stop(session).catch(()=>{});throw new DOMException('Cerrado','AbortError');}
    await peer.setRemoteDescription({type:'answer',sdp:session.sdp});await ready;
    this.limitTimer=setTimeout(()=>this.fail(Error('Terminó el tramo de transcripción en vivo. Podés continuar con el dictado por turnos o reiniciar la voz.')),session.maxSessionSeconds*1000);
    return this;
  }
  send(event){if(this.channel?.readyState!=='open' || this.closed)throw Error('La transcripción en vivo no está conectada.');this.channel.send(JSON.stringify(event));}
  beginTurn(){this.partial='';this.onPartial('');this.send({type:'input_audio_buffer.clear'});this.track.enabled=true;}
  discardTurn(){if(this.track)this.track.enabled=false;this.partial='';if(!this.closed && this.channel?.readyState==='open')this.send({type:'input_audio_buffer.clear'});}
  commit(metadata={}) {
    if(this.closed)return Promise.reject(Error('La transcripción en vivo se interrumpió.'));
    this.track.enabled=false;
    return new Promise((resolve,reject)=>{
      const turn={metadata,resolve,reject,committedAt:this.now()};
      turn.timer=setTimeout(()=>{this.fail(Error('La transcripción en vivo no terminó a tiempo; recupero el audio grabado.'));},5000);
      this.pending.push(turn);
      try{this.send({type:'input_audio_buffer.commit'});}catch(error){this.fail(error);}
    });
  }
  receive(event) {
    if(this.closed)return;
    if(event.type==='error')return this.fail(Error('La transcripción en vivo no está disponible; sigo con dictado por turnos.'));
    if(event.type==='input_audio_buffer.committed') {
      const turn=this.pending.find(item=>!item.itemId);if(turn){turn.itemId=event.item_id;this.items.set(event.item_id,{turn,text:''});}
    }
    if(event.type==='conversation.item.input_audio_transcription.delta') {
      const item=this.items.get(event.item_id);if(item)item.text+=event.delta || '';
      // Late deltas for a committed turn cannot replace the next speaker turn's partial.
      if(!item && this.track?.enabled){this.partial=(this.partial || '')+(event.delta || '');this.onPartial(this.partial,event.item_id);}
    }
    if(event.type==='conversation.item.input_audio_transcription.completed') {
      const item=this.items.get(event.item_id);if(!item)return;
      clearTimeout(item.turn.timer);this.items.delete(event.item_id);this.pending=this.pending.filter(turn=>turn!==item.turn);
      const text=String(event.transcript || '').trim();
      if(!text)item.turn.reject(Error('La transcripción final está vacía.'));
      else item.turn.resolve({text,itemId:event.item_id,transcriptAt:this.now(),model:'gpt-live-transcribe'});
    }
    if(event.type==='conversation.item.input_audio_transcription.failed')this.fail(Error('La transcripción en vivo falló; recupero el audio grabado.'));
  }
  fail(error){if(this.closed)return;this.onUnavailable(error);this.close(error);}
  close(error=new DOMException('Sesión finalizada','AbortError')) {
    if(this.closed)return;this.closed=true;clearTimeout(this.readyTimer);clearTimeout(this.limitTimer);this.readyReject?.(error);this.controller.abort();
    for(const turn of this.pending){clearTimeout(turn.timer);turn.reject(error);}this.pending=[];this.items.clear();
    this.channel?.close();this.peer?.close();this.track?.stop();if(this.session)void this.stop(this.session).catch(()=>{});
  }
}
