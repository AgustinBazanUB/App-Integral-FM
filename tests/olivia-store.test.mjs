import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  createOliviaStore,
  oliviaServerEnvironment,
} from "../netlify/functions/_lib/olivia/store.mjs";

test("server queries preserve injected credentials when using an opaque history cursor", async () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const env = {
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        project_id: "app-integral-fm",
        client_email: "fixture@example.invalid",
        private_key: privateKey,
      }),
    },
    calls = [];
  const store = createOliviaStore({
    env,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url === "https://oauth2.googleapis.com/token")
        return Response.json({
          access_token: "fixture-token",
          expires_in: 3600,
        });
      return Response.json([
        {
          document: {
            name: "projects/app-integral-fm/databases/(default)/documents/oliviaConversations/conversation/messages/message_b",
            fields: {
              createdAt: { timestampValue: "2026-10-04T15:00:00Z" },
              content: { stringValue: "Mensaje de prueba" },
            },
          },
        },
      ]);
    },
  });
  const rows = await store.query(
    "oliviaConversations/conversation/messages",
    [],
    61,
    [
      ["createdAt", "DESCENDING"],
      ["__name__", "DESCENDING"],
    ],
    { after: { createdAt: "2026-10-04T16:00:00Z", id: "message_c" } },
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.headers.Authorization, "Bearer fixture-token");
  assert.equal(
    calls[1].url,
    "https://firestore.googleapis.com/v1/projects/app-integral-fm/databases/(default)/documents/oliviaConversations/conversation:runQuery",
  );
  const query = JSON.parse(calls[1].init.body).structuredQuery;
  assert.equal(query.limit, 61);
  assert.equal(query.startAt.before, false);
  assert.equal(
    query.startAt.values[1].referenceValue,
    "projects/app-integral-fm/databases/(default)/documents/oliviaConversations/conversation/messages/message_c",
  );
  assert.ok(calls.every((c) => c.init.signal instanceof AbortSignal));
  assert.equal(rows[0].id, "message_b");
  await assert.rejects(
    store.query("oliviaConversations/conversation/messages", [], 61, [], {
      after: { createdAt: "invalid", id: "message_c" },
    }),
    { code: "invalid-input" },
  );
  assert.equal(calls.length, 2);
});

test("administrative service accounts from another project are rejected before network access", () => {
  assert.throws(
    () =>
      oliviaServerEnvironment({
        FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
          project_id: "another-project",
        }),
      }),
    { code: "firebase-project-mismatch" },
  );
});
