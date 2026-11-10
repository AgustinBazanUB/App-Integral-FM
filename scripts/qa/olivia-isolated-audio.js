// Developer-console QA only. Never import into the application bundle.
// This feeds prerecorded PCM through Conversar's real microphone pipeline.
// It does not supply text, mock Gemini, or call business APIs.
(() => {
  if (location.hostname !== 'deploy-preview-63--appintegralflormia.netlify.app') throw new Error('QA requires the authorized Deploy Preview.');
  if (window.__oliviaQaAudio) throw new Error('Restore the previous QA input first.');
  const media = navigator.mediaDevices;
  const hadOwn = Object.hasOwn(media, 'getUserMedia');
  const original = media.getUserMedia;
  const context = new AudioContext({ sampleRate: 48000 });
  const destination = context.createMediaStreamDestination();
  const gain = context.createGain();
  gain.gain.value = 0.65;
  gain.connect(destination);
  const silence = context.createConstantSource();
  silence.offset.value = 0;
  silence.connect(gain);
  silence.start();
  const streams = new Set();
  const sources = new Set();
  const lab = { mode: 'isolated-virtual-audio', intercepted: 0, events: [], closed: false };
  media.getUserMedia = async constraints => {
    if (!constraints?.audio || constraints.video) throw new Error('This QA session supports isolated audio only.');
    if (lab.closed) throw new Error('QA audio is closed.');
    await context.resume();
    const stream = destination.stream.clone();
    streams.add(stream);
    lab.intercepted++;
    return stream;
  };
  lab.play = async (id, base64) => {
    if (lab.closed || sources.size) throw new Error('QA input is closed or still playing.');
    const status = document.querySelector('[aria-label="Estado de Olivia"]')?.textContent || '';
    if (!status.includes('Micrófono activado')) throw new Error('Conversar must have an active microphone.');
    const bytes = Uint8Array.from(atob(base64), value => value.charCodeAt(0));
    const buffer = await context.decodeAudioData(bytes.buffer);
    await context.resume();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    sources.add(source);
    const entry = { id, mode: lab.mode, durationSeconds: buffer.duration, scheduledEpochMs: Date.now() + 40 };
    lab.events.push(entry);
    return new Promise(resolve => {
      source.onended = () => {
        sources.delete(source);
        source.disconnect();
        entry.endedEpochMs = Date.now();
        resolve(entry);
      };
      source.start(context.currentTime + 0.04);
    });
  };
  lab.restore = async () => {
    lab.closed = true;
    for (const source of sources) { try { source.stop(); } catch {} }
    for (const stream of streams) for (const track of stream.getTracks()) track.stop();
    for (const track of destination.stream.getTracks()) track.stop();
    silence.stop();
    gain.disconnect();
    await context.close();
    if (hadOwn) media.getUserMedia = original;
    else delete media.getUserMedia;
    delete window.__oliviaQaAudio;
    return { restored: media.getUserMedia === original, contextState: context.state };
  };
  window.__oliviaQaAudio = lab;
  return { mode: lab.mode, sampleRate: context.sampleRate, physicalMicrophoneRequested: false, speakerFeedback: false };
})();
