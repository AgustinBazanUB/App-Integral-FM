// One-time, explicitly authorized synthesis inside Netlify: credentials never leave its build environment.
import { writeFile } from 'node:fs/promises';
import { buildSpeechLibrary, speechBuildPlan } from './build-olivia-speech-library.mjs';
import { validatePreviewFirebase } from './validate-preview-firebase.mjs';
import { createOliviaStore } from '../netlify/functions/_lib/olivia/store.mjs';
import { defaultOliviaConfiguration } from '../src/shared/oliviaContracts.mjs';
import { chirpClient } from '../netlify/functions/_lib/olivia/chirp.mjs';

const approvedHash = '67ada6893c140142f7be305daa916da27cf43363a1d5f58e7f5bd600765d3904';
async function main() {
  const env = process.env;
  console.log(JSON.stringify({ event: 'olivia-speech-build-context', netlify: env.NETLIFY, context: env.CONTEXT, reviewId: env.REVIEW_ID, branch: env.BRANCH, head: env.HEAD, preview: env.DEPLOY_PRIME_URL }));
  if (env.NETLIFY !== 'true' || env.CONTEXT !== 'deploy-preview' || env.DEPLOY_PRIME_URL !== 'https://deploy-preview-48--appintegralflormia.netlify.app' || (env.HEAD || env.BRANCH) !== 'codex/olivia-fast-speech') throw Error('La generación está limitada a la preview 48 autorizada.');
  if (!process.argv.includes('--approve-plan=' + approvedHash)) throw Error('Falta la autorización puntual del lote. No se llamó a Google.');
  validatePreviewFirebase(env);
  const expected = 'app-integral-fm-pruebas';
  const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
  const authResponse = await fetch('https://identitytoolkit.googleapis.com/v1/projects?key=' + encodeURIComponent(env.FIREBASE_WEB_API_KEY || ''), {signal: AbortSignal.timeout(15000)});
  const auth = authResponse.ok ? await authResponse.json() : {};
  const identity = {serverProject: env.FIREBASE_PROJECT_ID, effectiveClientProject: env.VITE_PREVIEW_FIREBASE_PROJECT_ID, accountProject: account.project_id, accountMatches: !!account.client_email?.endsWith('@' + expected + '.iam.gserviceaccount.com'), adminMatches: !env.FIREBASE_ADMIN_CLIENT_EMAIL || env.FIREBASE_ADMIN_CLIENT_EMAIL.endsWith('@' + expected + '.iam.gserviceaccount.com'), authProject: auth.projectId, authStatus: authResponse.status};
  console.log(JSON.stringify({event: 'olivia-speech-firebase-verification', ...identity}));
  if (identity.serverProject !== expected || identity.effectiveClientProject !== expected || identity.accountProject !== expected || !identity.accountMatches || !identity.adminMatches || identity.authProject !== expected) throw Error('El backend, Auth y el frontend deben corresponder exclusivamente a Firebase de pruebas.');
  const google = JSON.parse(env.GOOGLE_APPLICATION_CREDENTIALS_JSON || '{}');
  if (google.project_id !== 'app-integral-fm-olivia-preview' || env.GOOGLE_CLOUD_PROJECT !== google.project_id) throw Error('La voz debe usar el proyecto de Olivia para previews.');
  // Read only the assistant configuration; no business records or Firestore writes.
  // Netlify's TOML still contains the public production defaults; Vite selects VITE_PREVIEW_*.
  // Match that effective client identity for this build-only read. Functions use their own scoped env.
  const configured = await createOliviaStore({env: {...env, VITE_FIREBASE_PROJECT_ID: env.VITE_PREVIEW_FIREBASE_PROJECT_ID}}).get('oliviaConfiguration/global');
  const config = configured?.naturalVoice || defaultOliviaConfiguration().naturalVoice;
  const plan = speechBuildPlan(config);
  if (plan.approvalHash !== approvedHash) throw Error('La voz configurada difiere del lote autorizado. No se llamó a Google.');
  console.log(JSON.stringify({ event: 'olivia-speech-environment-verified', firebaseProject: expected, googleProject: google.project_id, voice: plan.voice, speakingRate: plan.speakingRate, characters: plan.characters, estimatedCostUsd: plan.estimatedCostUsd }));
  let completed = 0;
  const synthesize = (text, p) => new Promise((resolve, reject) => {
    const stream = chirpClient().streamingSynthesize(), chunks = [];
    const timer = setTimeout(() => { stream.cancel(); reject(Error('Google TTS superó el tiempo del clip; no se reintentó automáticamente.')); }, 30000);
    stream.on('data', frame => { if (frame.audioContent) chunks.push(frame.audioContent); });
    stream.on('error', error => { clearTimeout(timer); reject(Error('Google TTS rechazó el clip (código ' + (Number(error.code) || 'desconocido') + ').')); });
    stream.on('end', () => { clearTimeout(timer); completed++; if (completed % 10 === 0) console.log('Olivia: ' + completed + '/90 clips sintetizados.'); resolve(Buffer.concat(chunks)); });
    stream.write({ streamingConfig: { voice: { languageCode: p.voiceLocale, name: p.voice }, streamingAudioConfig: { audioEncoding: 'PCM', sampleRateHertz: 24000, speakingRate: p.speakingRate } } });
    stream.write({ input: { text } });
    stream.end();
  });
  const result = await buildSpeechLibrary({ config, execute: true, approvalHash: approvedHash, synthesize });
  if (result.ready !== 90) throw Error('El lote no quedó completo.');
  await writeFile('public/olivia-speech/generation-report.json', JSON.stringify({ generatedAt: new Date().toISOString(), firebaseProject: expected, googleProject: google.project_id, voice: plan.voice, speakingRate: plan.speakingRate, characters: plan.characters, estimatedCostUsd: plan.estimatedCostUsd, ready: result.ready, generated: result.generated, approvalHash: approvedHash, firestoreWrites: 0 }, null, 2) + '\n');
  console.log(JSON.stringify(result));
}
main().catch(error => { console.error('No se completó el lote de Olivia.'); if (/^(La generación|Falta la autorización|Deploy Preview bloqueado|El backend|La voz|Google TTS|El lote)/.test(error.message)) console.error(error.message); else console.error('Revisar configuración o acceso al proveedor (sin exponer secretos).'); process.exitCode = 1; });
