import test from "node:test";
import assert from "node:assert/strict";

import { requestAccessTicket, clearWsaaTicketCache } from "../netlify/functions/_lib/arca/wsaa.mjs";
import {
  acquireWsaaRenewalLease,
  decryptWsaaTicket,
  encryptWsaaTicket,
  parseWsaaEncryptionKey,
  readSharedWsaaTicket,
  storeSharedWsaaTicket,
  wsaaTicketDocumentId,
} from "../netlify/functions/_lib/arca/wsaaSharedCache.mjs";

const KEY = Buffer.alloc(32, 7).toString("base64");
const ENV = { ARCA_TA_ENCRYPTION_KEY: KEY };

function memoryStore() {
  const documents = new Map();
  let revision = 0;
  const nextUpdateTime = () => `u${++revision}`;

  return {
    documents,
    async getDocument(path) {
      const value = documents.get(path);
      return value ? structuredClone(value) : null;
    },
    async createDocument(collectionPath, documentId, data) {
      const path = `${collectionPath}/${documentId}`;
      if (documents.has(path)) {
        const error = new Error("exists");
        error.code = "firebase-admin-already-exists";
        error.status = 409;
        throw error;
      }
      const document = {
        path,
        data: structuredClone(data),
        createTime: "c1",
        updateTime: nextUpdateTime(),
      };
      documents.set(path, document);
      return structuredClone(document);
    },
    async patchDocument(path, data, { currentUpdateTime } = {}) {
      const current = documents.get(path);
      if (!current || (currentUpdateTime && current.updateTime !== currentUpdateTime)) {
        const error = new Error("precondition");
        error.code = "firebase-admin-precondition-failed";
        error.status = 412;
        throw error;
      }
      const document = {
        ...current,
        data: { ...current.data, ...structuredClone(data) },
        updateTime: nextUpdateTime(),
      };
      documents.set(path, document);
      return structuredClone(document);
    },
  };
}

function ticket() {
  const expirationTime = "2026-09-29T13:00:00.000Z";
  return {
    token: "TOKEN-SECRETO-WSAA",
    sign: "SIGN-SECRETO-WSAA",
    expirationTime,
    expiresAt: new Date(expirationTime),
  };
}

test("clave WSAA compartida exige exactamente 32 bytes Base64", () => {
  assert.equal(parseWsaaEncryptionKey(ENV).length, 32);
  assert.throws(
    () => parseWsaaEncryptionKey({ ARCA_TA_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }),
    (error) => error?.code === "arca-wsaa-cache-key-invalid",
  );
});

test("TA se cifra AES-256-GCM y Token/Sign no quedan en claro", () => {
  const encrypted = encryptWsaaTicket(ticket(), {
    environmentId: "homologation",
    service: "wsfe",
    env: ENV,
    iv: Buffer.alloc(12, 3),
  });

  const serialized = JSON.stringify(encrypted);
  assert.equal(serialized.includes("TOKEN-SECRETO-WSAA"), false);
  assert.equal(serialized.includes("SIGN-SECRETO-WSAA"), false);
  assert.equal(encrypted.cipher, "aes-256-gcm");

  const decrypted = decryptWsaaTicket(encrypted, {
    environmentId: "homologation",
    service: "wsfe",
    env: ENV,
  });
  assert.equal(decrypted.token, "TOKEN-SECRETO-WSAA");
  assert.equal(decrypted.sign, "SIGN-SECRETO-WSAA");
  assert.equal(decrypted.expiresAt.toISOString(), "2026-09-29T13:00:00.000Z");
});

test("AAD impide usar un TA cifrado para otro servicio", () => {
  const encrypted = encryptWsaaTicket(ticket(), {
    environmentId: "homologation",
    service: "wsfe",
    env: ENV,
    iv: Buffer.alloc(12, 4),
  });

  assert.throws(
    () => decryptWsaaTicket(encrypted, {
      environmentId: "homologation",
      service: "ws_sr_constancia_inscripcion",
      env: ENV,
    }),
    (error) => error?.code === "arca-wsaa-cache-decrypt-error",
  );
});

test("lease exclusivo evita dos renovaciones y el TA publicado se reutiliza", async () => {
  const db = memoryStore();
  const now = new Date("2026-09-29T12:00:00.000Z");

  const first = await acquireWsaaRenewalLease({
    environmentId: "homologation",
    service: "wsfe",
    holder: "worker-a",
    env: ENV,
    now,
    getDocument: db.getDocument,
    createDocument: db.createDocument,
    patchDocument: db.patchDocument,
  });
  assert.equal(first.acquired, true);

  const second = await acquireWsaaRenewalLease({
    environmentId: "homologation",
    service: "wsfe",
    holder: "worker-b",
    env: ENV,
    now: new Date("2026-09-29T12:00:10.000Z"),
    getDocument: db.getDocument,
    createDocument: db.createDocument,
    patchDocument: db.patchDocument,
  });
  assert.equal(second.acquired, false);
  assert.equal(second.reason, "busy");

  await storeSharedWsaaTicket({
    environmentId: "homologation",
    service: "wsfe",
    holder: "worker-a",
    ticket: ticket(),
    expectedUpdateTime: first.updateTime,
    env: ENV,
    now: new Date("2026-09-29T12:00:15.000Z"),
    getDocument: db.getDocument,
    patchDocument: db.patchDocument,
  });

  const shared = await readSharedWsaaTicket({
    environmentId: "homologation",
    service: "wsfe",
    env: ENV,
    now: new Date("2026-09-29T12:01:00.000Z"),
    getDocument: db.getDocument,
  });
  assert.equal(shared.reason, "valid");
  assert.equal(shared.ticket.token, "TOKEN-SECRETO-WSAA");

  const afterPublish = await acquireWsaaRenewalLease({
    environmentId: "homologation",
    service: "wsfe",
    holder: "worker-b",
    env: ENV,
    now: new Date("2026-09-29T12:01:05.000Z"),
    getDocument: db.getDocument,
    createDocument: db.createDocument,
    patchDocument: db.patchDocument,
  });
  assert.equal(afterPublish.acquired, false);
  assert.equal(afterPublish.reason, "ticket-available");

  const path = `arcaWsaaTickets/${wsaaTicketDocumentId("homologation", "wsfe")}`;
  const raw = JSON.stringify(db.documents.get(path));
  assert.equal(raw.includes("TOKEN-SECRETO-WSAA"), false);
  assert.equal(raw.includes("SIGN-SECRETO-WSAA"), false);
});

test("producción rechaza WSAA si la caché compartida cifrada no está configurada", async () => {
  clearWsaaTicketCache();
  await assert.rejects(
    requestAccessTicket("wsfe", {
      env: { ARCA_ENVIRONMENT: "production" },
      now: new Date("2026-09-29T12:00:00.000Z"),
    }),
    (error) => error?.code === "arca-wsaa-shared-cache-required",
  );
});


test("requestAccessTicket reutiliza TA compartido tras perder la caché en memoria", async () => {
  const db = memoryStore();
  const now = new Date("2026-09-29T12:00:00.000Z");
  const firstLease = await acquireWsaaRenewalLease({
    environmentId: "homologation",
    service: "wsfe",
    holder: "bootstrap-worker",
    env: ENV,
    now,
    getDocument: db.getDocument,
    createDocument: db.createDocument,
    patchDocument: db.patchDocument,
  });
  await storeSharedWsaaTicket({
    environmentId: "homologation",
    service: "wsfe",
    holder: "bootstrap-worker",
    ticket: ticket(),
    expectedUpdateTime: firstLease.updateTime,
    env: ENV,
    now,
    getDocument: db.getDocument,
    patchDocument: db.patchDocument,
  });

  clearWsaaTicketCache();
  let fetchCalls = 0;
  const reused = await requestAccessTicket("wsfe", {
    env: {
      ...ENV,
      ARCA_ENVIRONMENT: "homologation",
    },
    now: new Date("2026-09-29T12:01:00.000Z"),
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("WSAA no debe ser invocado si existe un TA compartido vigente");
    },
    sharedCache: {
      getDocument: db.getDocument,
      createDocument: db.createDocument,
      patchDocument: db.patchDocument,
      sleepImpl: async () => {},
    },
  });

  assert.equal(reused.token, "TOKEN-SECRETO-WSAA");
  assert.equal(reused.sign, "SIGN-SECRETO-WSAA");
  assert.equal(fetchCalls, 0);
});
