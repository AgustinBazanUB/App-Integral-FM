import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";
import { clearFirebaseAdminTokenCache, firebaseAdminAccessToken } from "../netlify/functions/_lib/firestoreAdminRest.mjs";

test("Firebase rechaza una clave ilegible antes de enviar credenciales a Google", async () => {
  clearFirebaseAdminTokenCache();
  let requests = 0;
  await assert.rejects(firebaseAdminAccessToken({
    env: { FIREBASE_ADMIN_CLIENT_EMAIL: "test@example.invalid", FIREBASE_ADMIN_PRIVATE_KEY: "INVALID TEST KEY" },
    fetchImpl: async () => { requests++; throw new Error("unexpected network"); },
  }), (error) => error.code === "firebase-admin-private-key-invalid" && error.status === 409);
  assert.equal(requests, 0);
});

test("Firebase firma RS256 con una clave PEM válida y saltos escapados", async () => {
  clearFirebaseAdminTokenCache();
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const token = await firebaseAdminAccessToken({
    env: { FIREBASE_ADMIN_CLIENT_EMAIL: "test@example.invalid", FIREBASE_ADMIN_PRIVATE_KEY: pem.replaceAll("\n", "\\n") },
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://oauth2.googleapis.com/token");
      const assertion = options.body.get("assertion");
      const [header, payload, signature] = assertion.split(".");
      assert.equal(JSON.parse(Buffer.from(header, "base64url")).alg, "RS256");
      assert.equal(JSON.parse(Buffer.from(payload, "base64url")).iss, "test@example.invalid");
      assert.equal(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")), true);
      return new Response(JSON.stringify({ access_token: "test-token", expires_in: 3600 }), { status: 200 });
    },
  });
  assert.equal(token, "test-token");
  clearFirebaseAdminTokenCache();
});
