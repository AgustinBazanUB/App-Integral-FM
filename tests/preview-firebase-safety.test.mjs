import test from "node:test";
import assert from "node:assert/strict";
import { validatePreviewFirebase } from "../scripts/validate-preview-firebase.mjs";

const staging = {
  NETLIFY: "true",
  CONTEXT: "deploy-preview",
  VITE_PREVIEW_FIREBASE_PROJECT_ID: "app-integral-fm-pruebas",
  VITE_PREVIEW_FIREBASE_AUTH_DOMAIN: "app-integral-fm-pruebas.firebaseapp.com",
  VITE_PREVIEW_FIREBASE_STORAGE_BUCKET: "app-integral-fm-pruebas.firebasestorage.app",
  VITE_PREVIEW_FIREBASE_MESSAGING_SENDER_ID: "545036860675",
  VITE_PREVIEW_FIREBASE_APP_ID: "1:545036860675:web:c76e458afc8f8f706f7d36",
  VITE_PREVIEW_FIREBASE_API_KEY: "staging-web-key",
};

test("Netlify previews require the complete staging client identity", () => {
  assert.doesNotThrow(() => validatePreviewFirebase(staging));
  for (const key of Object.keys(staging).filter(key => key.startsWith("VITE_"))) {
    assert.throws(() => validatePreviewFirebase({ ...staging, [key]: "" }), /Firebase/);
  }
  assert.throws(() => validatePreviewFirebase({ ...staging, VITE_PREVIEW_FIREBASE_PROJECT_ID: "app-integral-fm" }), /Firebase/);
  assert.throws(() => validatePreviewFirebase({ ...staging, VITE_PREVIEW_FIREBASE_API_KEY: "AIzaSyCBVuIt36d_0DbDdEkGwRy85hmpZEjbrVg" }), /Firebase/);
});

test("branch deploys and Preview Servers fail closed, while production and local builds remain unchanged", () => {
  assert.throws(() => validatePreviewFirebase({ NETLIFY: "true", CONTEXT: "branch-deploy" }), /Firebase/);
  assert.throws(() => validatePreviewFirebase({ NETLIFY: "true", NETLIFY_PREVIEW_SERVER: "true" }), /Firebase/);
  assert.doesNotThrow(() => validatePreviewFirebase({ NETLIFY: "true", CONTEXT: "production" }));
  assert.throws(() => validatePreviewFirebase({ NETLIFY: "true", CONTEXT: "production", VITE_PREVIEW_FIREBASE_PROJECT_ID: "app-integral-fm-pruebas" }), /producción/);
  assert.doesNotThrow(() => validatePreviewFirebase({}));
});
