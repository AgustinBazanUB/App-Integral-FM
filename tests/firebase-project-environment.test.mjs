import test from "node:test";
import assert from "node:assert/strict";
import {
  assertFirebaseServiceAccountProject,
  configuredFirebaseProjectId,
  PRODUCTION_FIREBASE_PROJECT_ID,
  STAGING_FIREBASE_PROJECT_ID,
} from "../netlify/functions/_lib/firebaseProject.mjs";
import {
  publicFirebaseProjectId,
  requireFirebaseActiveProfile,
} from "../netlify/functions/_lib/firebaseAuth.mjs";
import {
  adminGetDocument,
  clearFirebaseAdminTokenCache,
  firebaseAdminAccessToken,
} from "../netlify/functions/_lib/firestoreAdminRest.mjs";

function withEnvironment(values, action) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(action)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test("Firebase project resolution is allow-listed and defaults to production", () => {
  assert.equal(configuredFirebaseProjectId({}), PRODUCTION_FIREBASE_PROJECT_ID);
  assert.equal(configuredFirebaseProjectId({ FIREBASE_PROJECT_ID: STAGING_FIREBASE_PROJECT_ID }), STAGING_FIREBASE_PROJECT_ID);
  assert.throws(() => configuredFirebaseProjectId({
    FIREBASE_PROJECT_ID: PRODUCTION_FIREBASE_PROJECT_ID,
    VITE_FIREBASE_PROJECT_ID: STAGING_FIREBASE_PROJECT_ID,
  }), { code: "firebase-project-mismatch" });
  assert.throws(() => configuredFirebaseProjectId({ FIREBASE_PROJECT_ID: "another-project" }), { code: "firebase-project-mismatch" });
});

test("service accounts must belong to the configured Firebase project", () => {
  assert.doesNotThrow(() => assertFirebaseServiceAccountProject(
    STAGING_FIREBASE_PROJECT_ID,
    "firebase-adminsdk-test@app-integral-fm-pruebas.iam.gserviceaccount.com",
  ));
  assert.throws(() => assertFirebaseServiceAccountProject(
    STAGING_FIREBASE_PROJECT_ID,
    "firebase-adminsdk-prod@app-integral-fm.iam.gserviceaccount.com",
  ), { code: "firebase-project-mismatch" });
});

test("authenticated function profile lookup stays in the selected staging project", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  await withEnvironment({
    FIREBASE_PROJECT_ID: STAGING_FIREBASE_PROJECT_ID,
    VITE_FIREBASE_PROJECT_ID: null,
    FIREBASE_WEB_API_KEY: "staging-web-key",
    VITE_FIREBASE_API_KEY: null,
  }, async () => {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.startsWith("https://identitytoolkit.googleapis.com/")) {
        return Response.json({ users: [{ localId: "staging-user", email: "qa@example.test" }] });
      }
      if (url.includes(`/projects/${STAGING_FIREBASE_PROJECT_ID}/databases/(default)/documents/users/staging-user`)) {
        return Response.json({ fields: { active: { booleanValue: true }, role: { stringValue: "seller" } } });
      }
      throw new Error(`Unexpected Firebase endpoint: ${url}`);
    };
    try {
      assert.equal(publicFirebaseProjectId(), STAGING_FIREBASE_PROJECT_ID);
      const session = await requireFirebaseActiveProfile(new Request("https://preview.example.test/.netlify/functions/shipping", {
        headers: { Authorization: "Bearer staging-id-token" },
      }));
      assert.equal(session.uid, "staging-user");
      assert.equal(session.profile.active, true);
      assert.equal(requests.length, 2);
      assert.match(requests[0].url, /accounts:lookup\?key=staging-web-key$/);
      assert.match(requests[1].url, new RegExp(`/projects/${STAGING_FIREBASE_PROJECT_ID}/`));
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test("Firebase Admin rejects a production credential when staging is selected", async () => {
  clearFirebaseAdminTokenCache();
  const { generateKeyPairSync } = await import("node:crypto");
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  await assert.rejects(firebaseAdminAccessToken({
    env: {
      FIREBASE_PROJECT_ID: STAGING_FIREBASE_PROJECT_ID,
      FIREBASE_ADMIN_CLIENT_EMAIL: "firebase-adminsdk-prod@app-integral-fm.iam.gserviceaccount.com",
      FIREBASE_ADMIN_PRIVATE_KEY: privateKey,
    },
    fetchImpl: async () => { throw new Error("Must reject before requesting an access token"); },
  }), { code: "firebase-project-mismatch" });
  clearFirebaseAdminTokenCache();
});

test("Firebase Admin document reads use the selected staging database", async () => {
  clearFirebaseAdminTokenCache();
  const { generateKeyPairSync } = await import("node:crypto");
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const requests = [];
  const env = {
    FIREBASE_PROJECT_ID: STAGING_FIREBASE_PROJECT_ID,
    FIREBASE_ADMIN_CLIENT_EMAIL: `firebase-adminsdk-test@${STAGING_FIREBASE_PROJECT_ID}.iam.gserviceaccount.com`,
    FIREBASE_ADMIN_PRIVATE_KEY: privateKey,
  };
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url) === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "staging-admin-token", expires_in: 3600 });
    }
    return Response.json({
      name: `projects/${STAGING_FIREBASE_PROJECT_ID}/databases/(default)/documents/users/staging-user`,
      fields: { active: { booleanValue: true } },
    });
  };
  const profile = await adminGetDocument("users/staging-user", { env, fetchImpl });
  assert.equal(profile.data.active, true);
  assert.equal(requests.length, 2);
  assert.match(requests[1].url, new RegExp(`/projects/${STAGING_FIREBASE_PROJECT_ID}/`));
  clearFirebaseAdminTokenCache();
});
