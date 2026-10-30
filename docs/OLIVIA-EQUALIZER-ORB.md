# Olivia · Equalizer Orb

## Scope and source

This update adds the real [VoiceOrbs Equalizer Orb](https://voiceorbs.vercel.app/orbs/equalizer-orb), its CSS and required utilities under the upstream MIT license. The pinned upstream revision and React 18 adaptations are recorded in `src/gestion/olivia/voiceorbs/README.md`. The supplied reference is preserved in `olivia-equalizer-orb-design-v1.json`.

The update continues the pending Chirp natural-voice integration. Live and Realtime modules were already retired; they are not reintroduced. Business tools, permissions, history, attachment processing and visual Sí/No confirmations retain their existing backend contracts.

## Causes and changes

- The browser VAD previously closed turns after 350 ms of silence. The new default is 1900 ms. If real speech resumes after a pause, that same recording stays open and the trailing window increases to 3000 ms, or 4000 ms after repeated continuations. Manual Send closes the current turn immediately. Short natural pauses do not generate separate requests. Recording remains bounded by 60 seconds/4 MB.
- GPT Transcribe receives completed turn files. There is no partial transcript before the upload, so the frontend cannot detect a grammatically unfinished sentence at that point. The adaptive window uses observed acoustic pauses, not an invented semantic or provider-VAD feature. Legacy 250–500 ms settings migrate to 1900 ms at read time without rewriting production documents.
- All AbortErrors previously shared an error banner. `interactionState.mjs` distinguishes explicit stop/end, automatic interruption, recovery of an active job and a confirmed failure. Stale request callbacks are ignored. Cancelling or ending voice is neutral; a declined confirmation is not an error.
- New speech interrupts playback, not an unrelated active backend job. Finished utterances queue behind the current work. The output stream is cancelled promptly, and the saved written answer survives the interruption.
- Polling keeps the original job ID through transient network and server failures, with bounded backoff. It waits for the backend's completed/failed/cancelled result instead of declaring failure after an arbitrary UI timeout. Slow work receives calm progress copy after 9/20 seconds. Lost start acknowledgements retry the same conversation/request identity and reconcile existing work before recovery. Confirmation operations are never automatically replayed.
- Confirmed chat failures expose a read-only “Recuperar conversación” action. Audio/transcription failures preserve the text/audio needed for a deliberate retry. Provider failures and permission errors remain visible; temporary network loss does not become a false terminal orb error.
- Dictation appends to the existing written draft, including “transcribe and send”. Empty transcription does not send a pre-existing draft accidentally.

## Audio and presentation

`OliviaVoiceControls` renders one state description from the shared visual lifecycle: idle, connecting, listening, thinking, speaking, error or disabled. Microphone amplitude comes from the existing input analyser, and PCM playback passes through an output analyser in the same authorized AudioContext. `levelRef` updates outside React's render loop. Speaking begins when audio is actually scheduled, rather than while waiting for synthesis. There is no second microphone permission or getUserMedia call for the orb.

The header, message surfaces, composer and voice stage use the new light chat styling, with the original cyan/indigo orb colors and Flor Mía branding. Usage/costs remain in an expandable secondary area; developer information, attachments, camera, dictation, mute/end, manual turn-send and stop controls remain available. The source orb honors dark color preference. Reduced-motion removes animations; offscreen animation and the analyser visualization RAF pause. The visualization does not open or close media on visibility changes. Browsers can throttle the local VAD RAF in background tabs; recordings also have a duration timer/byte cap, and pagehide releases the microphone while retaining any active backend job. Background microphone behavior is therefore not guaranteed across devices.

The mobile drawer respects visualViewport and safe areas. The textarea uses 16px on mobile to avoid focus zoom. Primary icon/confirmation controls have at least 44px touch targets. A compact stage leaves room for messages and confirmation when the visual viewport is reduced by a keyboard.

## Files and validation

Changed Olivia UI: `OliviaAssistant.jsx`, `OliviaComposer.jsx`, `OliviaVoiceControls.jsx`, `olivia.css`, `OliviaSettings.jsx`, `interactionState.mjs`, `naturalVoice.mjs`, `client.mjs`. Olivia settings defaults/schema are updated in `src/shared/oliviaContracts.mjs`. No other module's UI is changed.

Focused tests cover natural pauses and 3–4s continuation, immediate manual turn-send, one microphone request, permission rejection, PCM output through the shared analyser, interruption cleanup, zero-valued partial PCM bytes, neutral cancellations, slow jobs, seven consecutive network failures, lost start acknowledgements, streaming deltas, draft preservation and legacy setting migration.

Local UI fixture: `node tests/qa-olivia-orb.mjs`, then open the printed localhost URL. It renders the real Assistant/components/styles with a synthetic service and inaudible WebAudio input/output. It never uses Firebase or production credentials. `?mic=denied` selects a synthetic permission rejection. The fixture is not imported by the production app and cannot grant real access.

Browser observations in Chromium: desktop and mobile layout; successful synthetic microphone → transcription → background response → output analyser; real orb output level above zero; slow response completion without an alert; explicit stop with neutral state; definitive failure with recovery; draft preserved after dictation; visual Sí/No card; permission-denied state; reduced-motion with no active CSS animations; no horizontal overflow at 390px, and usable composer/messages at 390×420. Screenshots are QA fixtures, not production business data.

Required checks: `npm run build:gestion`, focused Olivia tests and the general suite. PR/Deploy Preview/CI results are recorded in the pull request after publication.

## Preview acceptance and limitations

The preview must use `app-integral-fm-pruebas` for frontend, Functions, Authentication and Firestore, and the dedicated TTS project/credentials only in Netlify Deploy Previews. Do not copy production data or merge/publish without the user's explicit approval of this update.

The browser fixture validates UI/lifecycle behavior with synthetic data. The remote smoke test validates provider connectivity. Neither proves physical microphone quality, echo cancellation, headset latency or playback on a real iPhone/Android device. Actual Safari/iPhone, Android Chrome and interruption/noise acceptance remain a device test before widening availability. The 1900–4000 ms waiting window trades response latency for conversational patience and can be adjusted within the validated settings range.
