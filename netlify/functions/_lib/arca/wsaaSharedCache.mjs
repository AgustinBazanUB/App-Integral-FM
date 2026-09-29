import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import {
  adminCreateDocument,
  adminGetDocument,
  adminPatchDocument,
} from "../firestoreAdminRest.mjs";

const COLLECTION = "arcaWsaaTickets";
const SCHEMA_VERSION = 1;
const CIPHER = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const DEFAULT_MIN_VALIDITY_MS = 5 * 60 * 1000;
const DEFAULT_LEASE_MS = 60 * 1000;

function iso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    const error = new Error("Fecha inválida en caché WSAA.");
    error.code = "arca-wsaa-cache-invalid-date";
    throw error;
  }
  return date.toISOString();
}

function serviceKey(service) {
  const normalized = String(service || "").trim();
  if (!normalized || !/^[A-Za-z0-9_.-]{1,100}$/.test(normalized)) {
    const error = new Error("Servicio WSAA inválido para caché compartida.");
    error.code = "arca-wsaa-cache-invalid-service";
    throw error;
  }
  return normalized;
}

function environmentKey(environmentId) {
  const normalized = String(environmentId || "").trim().toLowerCase();
  if (!["homologation", "production"].includes(normalized)) {
    const error = new Error("Entorno ARCA inválido para caché compartida.");
    error.code = "arca-wsaa-cache-invalid-environment";
    throw error;
  }
  return normalized;
}

export function wsaaTicketDocumentId(environmentId, service) {
  const envId = environmentKey(environmentId);
  const serviceId = serviceKey(service).replace(/[^A-Za-z0-9_-]/g, "_");
  return `${envId}_${serviceId}`;
}

function ticketPath(environmentId, service) {
  return `${COLLECTION}/${wsaaTicketDocumentId(environmentId, service)}`;
}

export function parseWsaaEncryptionKey(env = process.env, { required = false } = {}) {
  const raw = String(env.ARCA_TA_ENCRYPTION_KEY || "").trim();
  if (!raw) {
    if (!required) return null;
    const error = new Error("Falta configurar ARCA_TA_ENCRYPTION_KEY.");
    error.code = "arca-wsaa-cache-key-missing";
    throw error;
  }

  let key;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    key = Buffer.alloc(0);
  }

  if (key.length !== KEY_BYTES || key.toString("base64").replace(/=+$/g, "") !== raw.replace(/=+$/g, "")) {
    const error = new Error("ARCA_TA_ENCRYPTION_KEY debe ser una clave Base64 de 32 bytes.");
    error.code = "arca-wsaa-cache-key-invalid";
    throw error;
  }
  return key;
}

export function wsaaSharedCacheConfigured(env = process.env) {
  return Boolean(parseWsaaEncryptionKey(env, { required: false }));
}

function issuerScope(env = process.env) {
  const issuerCuit = String(env.ARCA_ISSUER_CUIT || "").replace(/\D/g, "");
  if (!/^\d{11}$/.test(issuerCuit)) {
    const error = new Error("ARCA_ISSUER_CUIT es obligatorio para aislar la caché WSAA compartida.");
    error.code = "arca-wsaa-cache-issuer-missing";
    throw error;
  }
  return issuerCuit;
}

function aad(environmentId, service, env) {
  return Buffer.from(
    `arca-wsaa-ticket:v${SCHEMA_VERSION}:${environmentKey(environmentId)}:${serviceKey(service)}:${issuerScope(env)}`,
    "utf8",
  );
}

export function encryptWsaaTicket(ticket, {
  environmentId,
  service,
  env = process.env,
  iv = randomBytes(IV_BYTES),
} = {}) {
  const key = parseWsaaEncryptionKey(env, { required: true });
  const expiresAt = ticket?.expiresAt instanceof Date
    ? ticket.expiresAt
    : new Date(ticket?.expirationTime || ticket?.expiresAt || "");

  if (!ticket?.token || !ticket?.sign || Number.isNaN(expiresAt.valueOf())) {
    const error = new Error("Ticket WSAA inválido para cifrar.");
    error.code = "arca-wsaa-cache-ticket-invalid";
    throw error;
  }

  const cipher = createCipheriv(CIPHER, key, iv);
  cipher.setAAD(aad(environmentId, service, env));
  const plaintext = Buffer.from(JSON.stringify({
    token: String(ticket.token),
    sign: String(ticket.sign),
    expirationTime: String(ticket.expirationTime || expiresAt.toISOString()),
  }), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    cipher: CIPHER,
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ticketExpiresAt: expiresAt.toISOString(),
  };
}

export function decryptWsaaTicket(record, {
  environmentId,
  service,
  env = process.env,
} = {}) {
  const key = parseWsaaEncryptionKey(env, { required: true });
  if (record?.cipher !== CIPHER || !record?.ciphertext || !record?.iv || !record?.authTag) {
    const error = new Error("El ticket compartido WSAA no tiene un payload cifrado válido.");
    error.code = "arca-wsaa-cache-payload-invalid";
    throw error;
  }

  try {
    const decipher = createDecipheriv(
      CIPHER,
      key,
      Buffer.from(record.iv, "base64"),
    );
    decipher.setAAD(aad(environmentId, service, env));
    decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, "base64")),
      decipher.final(),
    ]);
    const payload = JSON.parse(plaintext.toString("utf8"));
    const expiresAt = new Date(payload.expirationTime);
    if (!payload.token || !payload.sign || Number.isNaN(expiresAt.valueOf())) {
      throw new Error("payload");
    }
    return {
      token: String(payload.token),
      sign: String(payload.sign),
      expirationTime: String(payload.expirationTime),
      expiresAt,
    };
  } catch (cause) {
    const error = new Error("No se pudo descifrar el Ticket de Acceso WSAA compartido.");
    error.code = "arca-wsaa-cache-decrypt-error";
    error.causeCode = cause?.code || null;
    throw error;
  }
}

function validTicketMetadata(data, now, minValidityMs) {
  if (!data?.ticketExpiresAt) return false;
  const expiresAt = new Date(data.ticketExpiresAt);
  return !Number.isNaN(expiresAt.valueOf())
    && expiresAt.getTime() - now.getTime() > minValidityMs;
}

export async function readSharedWsaaTicket({
  environmentId,
  service,
  env = process.env,
  now = new Date(),
  minValidityMs = DEFAULT_MIN_VALIDITY_MS,
  getDocument = adminGetDocument,
} = {}) {
  parseWsaaEncryptionKey(env, { required: true });
  const path = ticketPath(environmentId, service);
  const document = await getDocument(path, { env });
  if (!document) return { ticket: null, document: null, reason: "missing" };

  const data = document.data || {};
  if (data.schemaVersion !== SCHEMA_VERSION
    || data.environment !== environmentKey(environmentId)
    || data.service !== serviceKey(service)) {
    const error = new Error("El documento compartido WSAA no coincide con el entorno/servicio esperado.");
    error.code = "arca-wsaa-cache-document-mismatch";
    throw error;
  }

  if (!validTicketMetadata(data, now, Number(minValidityMs))) {
    return { ticket: null, document, reason: "expired-or-near-expiry" };
  }

  const ticket = decryptWsaaTicket(data, { environmentId, service, env });
  if (ticket.expiresAt.getTime() - now.getTime() <= Number(minValidityMs)) {
    return { ticket: null, document, reason: "payload-expired-or-near-expiry" };
  }

  return { ticket, document, reason: "valid" };
}

function leaseIsBusy(data, holder, now) {
  if (!data?.leaseHolder || data.leaseHolder === holder) return false;
  const expiresAt = new Date(data.leaseExpiresAt || "");
  return !Number.isNaN(expiresAt.valueOf()) && expiresAt.getTime() > now.getTime();
}

export async function acquireWsaaRenewalLease({
  environmentId,
  service,
  holder,
  env = process.env,
  now = new Date(),
  leaseMs = DEFAULT_LEASE_MS,
  minValidityMs = DEFAULT_MIN_VALIDITY_MS,
  getDocument = adminGetDocument,
  createDocument = adminCreateDocument,
  patchDocument = adminPatchDocument,
} = {}) {
  parseWsaaEncryptionKey(env, { required: true });
  const cleanHolder = String(holder || "").trim();
  if (!cleanHolder) {
    const error = new Error("Falta identificar el renovador WSAA.");
    error.code = "arca-wsaa-cache-holder-missing";
    throw error;
  }

  const envId = environmentKey(environmentId);
  const serviceId = serviceKey(service);
  const documentId = wsaaTicketDocumentId(envId, serviceId);
  const path = `${COLLECTION}/${documentId}`;
  const leaseExpiresAt = iso(new Date(now.getTime() + Number(leaseMs || DEFAULT_LEASE_MS)));
  const current = await getDocument(path, { env });

  if (!current) {
    try {
      const created = await createDocument(COLLECTION, documentId, {
        schemaVersion: SCHEMA_VERSION,
        environment: envId,
        service: serviceId,
        cipher: null,
        ciphertext: null,
        iv: null,
        authTag: null,
        ticketExpiresAt: null,
        leaseHolder: cleanHolder,
        leaseExpiresAt,
        createdAt: iso(now),
        updatedAt: iso(now),
      }, { env });
      return {
        acquired: true,
        path,
        holder: cleanHolder,
        updateTime: created.updateTime || null,
        leaseExpiresAt,
        reason: "created",
      };
    } catch (error) {
      if (error?.code !== "firebase-admin-already-exists") throw error;
      return {
        acquired: false,
        path,
        holder: null,
        updateTime: null,
        leaseExpiresAt: null,
        reason: "concurrent-create",
      };
    }
  }

  const data = current.data || {};
  if (validTicketMetadata(data, now, Number(minValidityMs))) {
    return {
      acquired: false,
      path,
      holder: data.leaseHolder || null,
      updateTime: current.updateTime || null,
      leaseExpiresAt: data.leaseExpiresAt || null,
      reason: "ticket-available",
    };
  }

  if (leaseIsBusy(data, cleanHolder, now)) {
    return {
      acquired: false,
      path,
      holder: data.leaseHolder,
      updateTime: current.updateTime || null,
      leaseExpiresAt: data.leaseExpiresAt || null,
      reason: "busy",
    };
  }

  try {
    const updated = await patchDocument(path, {
      leaseHolder: cleanHolder,
      leaseExpiresAt,
      updatedAt: iso(now),
    }, {
      env,
      currentUpdateTime: current.updateTime,
    });
    return {
      acquired: true,
      path,
      holder: cleanHolder,
      updateTime: updated.updateTime || null,
      leaseExpiresAt,
      reason: data.leaseHolder === cleanHolder ? "renewed" : "acquired",
    };
  } catch (error) {
    if (error?.code !== "firebase-admin-precondition-failed") throw error;
    return {
      acquired: false,
      path,
      holder: null,
      updateTime: null,
      leaseExpiresAt: null,
      reason: "concurrent-update",
    };
  }
}

export async function storeSharedWsaaTicket({
  environmentId,
  service,
  holder,
  ticket,
  expectedUpdateTime,
  env = process.env,
  now = new Date(),
  getDocument = adminGetDocument,
  patchDocument = adminPatchDocument,
} = {}) {
  const path = ticketPath(environmentId, service);
  const encrypted = encryptWsaaTicket(ticket, { environmentId, service, env });

  const patch = async (updateTime) => patchDocument(path, {
    ...encrypted,
    leaseHolder: null,
    leaseExpiresAt: null,
    updatedAt: iso(now),
  }, {
    env,
    currentUpdateTime: updateTime,
  });

  try {
    return await patch(expectedUpdateTime);
  } catch (error) {
    if (error?.code !== "firebase-admin-precondition-failed") throw error;
    const current = await getDocument(path, { env });
    if (!current || current.data?.leaseHolder !== holder) {
      const leaseError = new Error("Se perdió el lease WSAA antes de persistir el Ticket de Acceso.");
      leaseError.code = "arca-wsaa-cache-lease-lost";
      leaseError.status = 409;
      throw leaseError;
    }
    return patch(current.updateTime);
  }
}

export async function releaseWsaaRenewalLease({
  environmentId,
  service,
  holder,
  expectedUpdateTime,
  env = process.env,
  now = new Date(),
  getDocument = adminGetDocument,
  patchDocument = adminPatchDocument,
} = {}) {
  const path = ticketPath(environmentId, service);
  const current = await getDocument(path, { env });
  if (!current) return { released: true, reason: "missing" };
  if (current.data?.leaseHolder !== holder) {
    return { released: false, reason: "not-holder" };
  }
  try {
    const updated = await patchDocument(path, {
      leaseHolder: null,
      leaseExpiresAt: null,
      updatedAt: iso(now),
    }, {
      env,
      currentUpdateTime: expectedUpdateTime || current.updateTime,
    });
    return {
      released: true,
      reason: "released",
      updateTime: updated.updateTime || null,
    };
  } catch (error) {
    if (error?.code !== "firebase-admin-precondition-failed") throw error;
    return { released: false, reason: "concurrent-update" };
  }
}

export async function waitForSharedWsaaTicket({
  environmentId,
  service,
  env = process.env,
  now = new Date(),
  attempts = 12,
  intervalMs = 500,
  minValidityMs = DEFAULT_MIN_VALIDITY_MS,
  getDocument = adminGetDocument,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleepImpl(intervalMs);
    const checkNow = new Date(now.getTime() + attempt * intervalMs);
    const shared = await readSharedWsaaTicket({
      environmentId,
      service,
      env,
      now: checkNow,
      minValidityMs,
      getDocument,
    });
    if (shared.ticket) return shared;
  }
  return { ticket: null, document: null, reason: "wait-timeout" };
}

export const WSAA_SHARED_CACHE_DEFAULTS = Object.freeze({
  collection: COLLECTION,
  minValidityMs: DEFAULT_MIN_VALIDITY_MS,
  leaseMs: DEFAULT_LEASE_MS,
});


export async function inspectSharedWsaaCache({
  environmentId,
  service,
  env = process.env,
  now = new Date(),
  getDocument = adminGetDocument,
} = {}) {
  const configured = Boolean(String(env.ARCA_TA_ENCRYPTION_KEY || "").trim());
  if (!configured) {
    return {
      configured: false,
      exists: false,
      decryptable: false,
      reusable: false,
      ticketExpiresAt: null,
      leaseBusy: false,
      leaseExpiresAt: null,
    };
  }

  parseWsaaEncryptionKey(env, { required: true });
  const path = ticketPath(environmentId, service);
  const document = await getDocument(path, { env });
  if (!document) {
    return {
      configured: true,
      exists: false,
      decryptable: false,
      reusable: false,
      ticketExpiresAt: null,
      leaseBusy: false,
      leaseExpiresAt: null,
    };
  }

  const data = document.data || {};
  let decryptable = false;
  let reusable = false;
  if (data.ciphertext && data.iv && data.authTag) {
    try {
      const ticket = decryptWsaaTicket(data, { environmentId, service, env });
      decryptable = true;
      reusable = ticket.expiresAt.getTime() - now.getTime() > DEFAULT_MIN_VALIDITY_MS;
    } catch {
      decryptable = false;
      reusable = false;
    }
  }

  const leaseExpiresAt = data.leaseExpiresAt || null;
  const leaseDate = leaseExpiresAt ? new Date(leaseExpiresAt) : null;
  const leaseBusy = Boolean(
    data.leaseHolder
    && leaseDate
    && !Number.isNaN(leaseDate.valueOf())
    && leaseDate.getTime() > now.getTime()
  );

  return {
    configured: true,
    exists: true,
    decryptable,
    reusable,
    ticketExpiresAt: data.ticketExpiresAt || null,
    leaseBusy,
    leaseExpiresAt,
    updatedAt: data.updatedAt || null,
  };
}
