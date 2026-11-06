import test from "node:test";
import assert from "node:assert/strict";
import { canUseOliviaVoice } from "../src/shared/oliviaVoiceAvailability.mjs";

const isolatedPreview = {
  OLIVIA_DEPLOY_PREVIEW_CONTEXT: "deploy-preview",
  OLIVIA_HYBRID_LIVE_ENABLED: "true",
  GEMINI_API_BILLING_TIER: "paid",
  GEMINI_API_KEY: "configured",
  FIREBASE_PROJECT_ID: "app-integral-fm-pruebas",
};

test("allows an active administrator to use voice in the paid isolated preview", () => {
  assert.equal(canUseOliviaVoice({ email: "preview-admin@example.test", profile: { active: true, role: "general_admin" } }, isolatedPreview), true);
});

test("keeps the preview voice gate closed for sellers and non-preview contexts", () => {
  assert.equal(canUseOliviaVoice({ email: "seller@example.test", profile: { active: true, role: "seller" } }, isolatedPreview), false);
  assert.equal(canUseOliviaVoice({ email: "preview-admin@example.test", profile: { active: true, role: "admin" } }, { ...isolatedPreview, OLIVIA_DEPLOY_PREVIEW_CONTEXT: "" }), false);
  assert.equal(canUseOliviaVoice({ email: "preview-admin@example.test", profile: { active: true, role: "admin" } }, { ...isolatedPreview, CONTEXT: "production" }), false);
});

test("requires the staging project, paid tier, key, and hybrid flag", () => {
  const admin = { email: "preview-admin@example.test", profile: { active: true, role: "admin" } };
  for (const [key, value] of [["FIREBASE_PROJECT_ID", "app-integral-fm"], ["GEMINI_API_BILLING_TIER", "free"], ["GEMINI_API_KEY", ""], ["OLIVIA_HYBRID_LIVE_ENABLED", "false"]]) {
    assert.equal(canUseOliviaVoice(admin, { ...isolatedPreview, [key]: value }), false, `${key} must keep the preview gate closed`);
  }
});

test("preserves the existing owner trial", () => {
  assert.equal(canUseOliviaVoice({ email: "agsreserva@gmail.com" }, { ...isolatedPreview, OLIVIA_DEPLOY_PREVIEW_CONTEXT: "", OLIVIA_HYBRID_LIVE_ENABLED: "false" }), true);
});
