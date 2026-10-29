const status = document.querySelector('#status'), clips = document.querySelector('#clips');
let context, source, playing, generation = 0;
function stop() { generation++; if (source) { source.onended = null; source.stop(); source = null; } if (playing) { playing.dataset.playing = 'false'; playing.querySelector('button').textContent = '▶ Escuchar'; playing = null; } }
document.querySelector('#stop').addEventListener('click', stop);
document.querySelector('#search').addEventListener('input', event => { const q=event.target.value.toLocaleLowerCase('es'); for (const card of clips.children) card.hidden = !card.textContent.toLocaleLowerCase('es').includes(q); });
try {
  const response = await fetch('./es-US-Chirp3-HD-Aoede-r1-pcm24k-v1/manifest.json', {cache:'no-cache'});
  if (!response.ok) throw Error('Biblioteca no disponible.');
  const manifest = await response.json(), ready = manifest.entries.filter(entry => entry.status === 'ready');
  status.textContent = `${ready.length} de 90 frases listas · Chirp 3 HD · Aoede · Velocidad ${manifest.speakingRate}`;
  for (const entry of ready) {
    const card = document.createElement('article'), category = document.createElement('small'), text = document.createElement('p'), button = document.createElement('button');
    card.className = 'clip'; category.textContent = entry.category.replaceAll('_',' ') + ' · ' + (entry.durationMs / 1000).toFixed(1) + ' s'; text.textContent = entry.text; button.type='button'; button.textContent='▶ Escuchar'; button.setAttribute('aria-label','Escuchar: '+entry.text);
    button.addEventListener('click', async () => {
      stop();
      const playback = generation;
      playing=card; card.dataset.playing='true'; button.textContent='Cargando…';
      try {
        context ||= new (window.AudioContext || window.webkitAudioContext)(); await context.resume();
        if (!entry.url.startsWith('/olivia-speech/'+manifest.voiceVersion+'/')) throw Error('Ruta inválida.');
        const audio = await fetch(entry.url); if (!audio.ok) throw Error('Audio no disponible.');
        const bytes = await audio.arrayBuffer();
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b=>b.toString(16).padStart(2,'0')).join('');
        if (hash !== entry.checksum || bytes.byteLength % 2) throw Error('El audio no supera la verificación.');
        if (playing !== card || playback !== generation) return;
        const view=new DataView(bytes), buffer=context.createBuffer(1,bytes.byteLength/2,entry.sampleRate), channel=buffer.getChannelData(0);
        for (let i=0;i<channel.length;i++) channel[i]=view.getInt16(i*2,true)/32768;
        source=context.createBufferSource(); source.buffer=buffer; source.connect(context.destination); source.onended=()=>{source=null;stop();}; button.textContent='Reproduciendo…'; source.start();
      } catch { if (playback === generation) { stop(); status.textContent='No pudimos reproducir la frase. Volvé a intentarlo.'; } }
    });
    card.append(category,text,button); clips.append(card);
  }
} catch { status.textContent='La biblioteca todavía no está disponible en esta versión.'; }
window.addEventListener('pagehide',()=>{stop();context?.close();});
