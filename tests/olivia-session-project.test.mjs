import test from "node:test";
import assert from "node:assert/strict";
import { oliviaSession } from "../netlify/functions/_lib/olivia/http.mjs";
import { hasGoogleCloudTtsCredentials } from "../src/shared/oliviaVoiceAvailability.mjs";

test("voice availability rejects malformed and incomplete TTS secrets", () => {
  for (const value of ["credentials.json", "{invalid}", "null", "{}", '{"project_id":"fixture"}']) {
    assert.equal(hasGoogleCloudTtsCredentials({ GOOGLE_APPLICATION_CREDENTIALS_JSON: value }), false);
  }
  assert.equal(hasGoogleCloudTtsCredentials({ GOOGLE_APPLICATION_CREDENTIALS_JSON: JSON.stringify({ project_id: "fixture", client_email: "fixture@example.test", private_key: "fixture-key" }) }), true);
  assert.equal(hasGoogleCloudTtsCredentials({ GOOGLE_APPLICATION_CREDENTIALS: "/server/credentials.json" }), true);
});

test("Olivia binds authenticated sessions to the configured Firebase environment", async () => {
  const originalFetch = globalThis.fetch;
  const keys = ["FIREBASE_PROJECT_ID", "VITE_FIREBASE_PROJECT_ID", "FIREBASE_WEB_API_KEY"];
  const originalEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  globalThis.fetch = async url => {
    if (String(url).includes("accounts:lookup")) return Response.json({ users: [{ localId: "fixture-admin", email: "fixture@example.test" }] });
    return Response.json({ fields: { active: { booleanValue: true }, role: { stringValue: "admin" } } });
  };
  const request = aud => {
    const payload = Buffer.from(JSON.stringify({ sub: "fixture-admin", aud, auth_time: Math.floor(Date.now() / 1000) })).toString("base64url");
    return new Request("https://preview.example.test/.netlify/functions/olivia", { headers: { Authorization: `Bearer header.${payload}.signature` } });
  };
  try {
    process.env.FIREBASE_WEB_API_KEY = "fixture-key";
    for (const project of ["app-integral-fm-pruebas", "app-integral-fm"]) {
      process.env.FIREBASE_PROJECT_ID = project;
      process.env.VITE_FIREBASE_PROJECT_ID = project;
      assert.equal((await oliviaSession(request(project))).uid, "fixture-admin");
      const other = project === "app-integral-fm" ? "app-integral-fm-pruebas" : "app-integral-fm";
      await assert.rejects(oliviaSession(request(other)), error => error.code === "unauthenticated");
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
});
