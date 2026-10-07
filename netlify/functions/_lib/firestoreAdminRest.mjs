import { createPrivateKey, createSign } from "node:crypto";

const PROJECT_ID = "app-integral-fm";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
let tokenCache = null;

function required(name, env = process.env) {
  const value = String(env[name] || "").trim();
  if (!value) {
    const error = new Error(`Falta configurar ${name}.`);
    error.code = "firebase-admin-config-missing";
    error.field = name;
    throw error;
  }
  return value;
}

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function adminConfig(env = process.env) {
  const projectId = String(env.FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID || PROJECT_ID).trim();
  if (projectId !== PROJECT_ID) {
    const error = new Error("Configuración Firebase administrativa inválida.");
    error.code = "firebase-project-mismatch";
    throw error;
  }
  const clientEmail = required("FIREBASE_ADMIN_CLIENT_EMAIL", env);
  const privateKeyPem = required("FIREBASE_ADMIN_PRIVATE_KEY", env).replace(/\\n/g, "\n");
  let privateKey;
  try {
    privateKey = createPrivateKey(privateKeyPem);
  } catch {
    const error = new Error("La clave privada administrativa de Firebase no tiene un formato válido.");
    error.code = "firebase-admin-private-key-invalid";
    error.status = 409;
    throw error;
  }
  return {
    projectId,
    clientEmail,
    privateKey,
  };
}

function serviceAccountAssertion(config, now = new Date()) {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: config.clientEmail,
    scope: FIRESTORE_SCOPE,
    aud: TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(config.privateKey).toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
  return `${unsigned}.${signature}`;
}

export async function firebaseAdminAccessToken({
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  forceRefresh = false,
} = {}) {
  if (!forceRefresh && tokenCache && tokenCache.expiresAt - now.getTime() > 5 * 60 * 1000) {
    return tokenCache.token;
  }
  const config = adminConfig(env);
  const assertion = serviceAccountAssertion(config, now);
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const error = new Error("Google rechazó las credenciales administrativas de Firebase.");
    error.code = "firebase-admin-token-error";
    error.status = response.status || 500;
    throw error;
  }
  tokenCache = {
    token: payload.access_token,
    expiresAt: now.getTime() + Number(payload.expires_in || 3600) * 1000,
  };
  return tokenCache.token;
}

export function clearFirebaseAdminTokenCache() {
  tokenCache = null;
}

function firestoreBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

function encodePath(path) {
  return String(path || "").split("/").map((part) => encodeURIComponent(part)).join("/");
}

function fromFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in value) return Object.fromEntries(
    Object.entries(value.mapValue.fields || {}).map(([key, child]) => [key, fromFirestoreValue(child)]),
  );
  return null;
}

function toFirestoreValue(value) {
  if (value == null) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value)
            .filter(([, child]) => child !== undefined)
            .map(([key, child]) => [key, toFirestoreValue(child)]),
        ),
      },
    };
  }
  throw new Error("Tipo de dato no soportado para Firestore.");
}

function fieldsFromObject(object = {}) {
  return Object.fromEntries(
    Object.entries(object)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, toFirestoreValue(value)]),
  );
}

function documentFromResponse(payload, path) {
  if (!payload?.name) return null;
  const parts = payload.name.split("/documents/");
  return {
    path: parts[1] || path,
    createTime: payload.createTime || null,
    updateTime: payload.updateTime || null,
    data: Object.fromEntries(
      Object.entries(payload.fields || {}).map(([key, value]) => [key, fromFirestoreValue(value)]),
    ),
  };
}

async function adminFetch(path, {
  env = process.env,
  fetchImpl = fetch,
  method = "GET",
  query = "",
  body,
  transaction,
} = {}) {
  if (transaction && method === "GET") {
    query += `${query ? "&" : "?"}transaction=${encodeURIComponent(transaction)}`;
  }
  const config = adminConfig(env);
  const token = await firebaseAdminAccessToken({ env, fetchImpl });
  const response = await fetchImpl(`${firestoreBase(config.projectId)}/${encodePath(path)}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

export async function adminGetDocument(path, options = {}) {
  if (options.transaction) {
    const config = adminConfig(options.env);
    const token = await firebaseAdminAccessToken(options);
    const response = await (options.fetchImpl || fetch)(`${firestoreBase(config.projectId)}:batchGet`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ documents: [qualifiedDocumentName(config.projectId, path)], transaction: options.transaction }),
      signal: AbortSignal.timeout(30000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error("No se pudo leer el snapshot comercial.");
      error.code = ["ABORTED", "FAILED_PRECONDITION"].includes(payload.error?.status)
        ? "firebase-admin-precondition-failed" : "firebase-admin-read-error";
      error.status = response.status;
      error.retryable = payload.error?.status === "ABORTED";
      throw error;
    }
    const result = (Array.isArray(payload) ? payload : [payload]).find((entry) => entry.found || entry.missing);
    if (result?.missing) return null;
    if (result?.found) return documentFromResponse(result.found, path);
    throw new Error("Firestore did not return the requested document.");
  }
  const { response, payload } = await adminFetch(path, options);
  if (response.status === 404) return null;
  if (!response.ok) {
    const error = new Error("No se pudo leer Firestore desde el backend.");
    error.code = "firebase-admin-read-error";
    error.status = response.status;
    throw error;
  }
  return documentFromResponse(payload, path);
}

export async function adminCreateDocument(collectionPath, documentId, data, options = {}) {
  const query = `?documentId=${encodeURIComponent(documentId)}`;
  const { response, payload } = await adminFetch(collectionPath, {
    ...options,
    method: "POST",
    query,
    body: { fields: fieldsFromObject(data) },
  });
  if (response.status === 409) {
    const error = new Error("El documento ya existe.");
    error.code = "firebase-admin-already-exists";
    error.status = 409;
    throw error;
  }
  if (!response.ok) {
    const error = new Error("No se pudo crear el documento fiscal.");
    error.code = "firebase-admin-create-error";
    error.status = response.status;
    throw error;
  }
  return documentFromResponse(payload, `${collectionPath}/${documentId}`);
}

export async function adminPatchDocument(path, data, {
  updateMask = Object.keys(data || {}),
  currentUpdateTime = null,
  requireExists = false,
  ...options
} = {}) {
  if (currentUpdateTime) {
    // Keep the compare-and-swap timestamp in the JSON precondition, avoiding
    // query-string timestamp parsing differences in Firestore REST runtimes.
    await adminCommitDocuments([{ type: "update", path, data, updateMask, currentUpdateTime }], options);
    return adminGetDocument(path, options);
  }
  const queryParts = updateMask.map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`);
  if (requireExists) {
    queryParts.push("currentDocument.exists=true");
  }
  const query = queryParts.length ? `?${queryParts.join("&")}` : "";
  const { response, payload } = await adminFetch(path, {
    ...options,
    method: "PATCH",
    query,
    body: { fields: fieldsFromObject(data) },
  });
  if (response.status === 412) {
    const error = new Error("El documento cambió antes de completar la actualización.");
    error.code = "firebase-admin-precondition-failed";
    error.status = 412;
    throw error;
  }
  if (!response.ok) {
    const error = new Error("No se pudo actualizar el documento fiscal.");
    error.code = "firebase-admin-update-error";
    error.status = response.status;
    throw error;
  }
  return documentFromResponse(payload, path);
}


export async function adminListDocuments(collectionPath, {
  pageSize = 500,
  env = process.env,
  fetchImpl = fetch,
  transaction,
} = {}) {
  const safePageSize = Math.min(500, Math.max(1, Number(pageSize) || 500));
  const documents = [];
  let pageToken = "";
  do {
  const { response, payload } = await adminFetch(collectionPath, {
    env,
    fetchImpl,
    transaction,
    query: `?pageSize=${safePageSize}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
  });
  if (!response.ok) {
    const error = new Error("No se pudo listar Firestore desde el backend.");
    error.code = "firebase-admin-read-error";
    error.status = response.status;
    throw error;
  }
  documents.push(...(payload?.documents || []).map((document) => {
    const parsed = documentFromResponse(document, collectionPath);
    return {
      ...parsed.data,
      id: document.name.split("/").at(-1),
      __createTime: parsed.createTime,
      __updateTime: parsed.updateTime,
    };
  }));
  pageToken = payload.nextPageToken || "";
  } while (pageToken);
  return documents;
}

function qualifiedDocumentName(projectId, path) {
  return `projects/${projectId}/databases/(default)/documents/${String(path || "")}`;
}

function commitWriteForOperation(operation, projectId) {
  const type = String(operation?.type || "").trim();
  const path = String(operation?.path || "").trim();
  if (!path) {
    const error = new Error("Falta la ruta de una escritura Firestore.");
    error.code = "firebase-admin-commit-invalid";
    error.status = 500;
    throw error;
  }
  const name = qualifiedDocumentName(projectId, path);
  if (type === "create") {
    return {
      update: {
        name,
        fields: fieldsFromObject(operation.data || {}),
      },
      currentDocument: { exists: false },
    };
  }
  if (type === "update") {
    const data = operation.data || {};
    const updateMask = operation.updateMask || Object.keys(data);
    const write = {
      update: {
        name,
        fields: fieldsFromObject(data),
      },
      updateMask: {
        fieldPaths: updateMask,
      },
    };
    if (operation.currentUpdateTime) {
      write.currentDocument = { updateTime: operation.currentUpdateTime };
    } else {
      write.currentDocument = { exists: true };
    }
    return write;
  }
  const error = new Error("Tipo de escritura Firestore no soportado.");
  error.code = "firebase-admin-commit-invalid";
  error.status = 500;
  throw error;
}

export async function adminCommitDocuments(operations = [], {
  env = process.env,
  fetchImpl = fetch,
  transaction,
} = {}) {
  if (!Array.isArray(operations)) throw new TypeError("Firestore operations must be an array.");
  if (!operations.length && !transaction) return { writeResults: [] };
  const config = adminConfig(env);
  const token = await firebaseAdminAccessToken({ env, fetchImpl });
  const writes = operations.map((operation) => commitWriteForOperation(operation, config.projectId));
  const response = await fetchImpl(
    `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents:commit`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ writes, ...(transaction ? { transaction } : {}) }),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (payload?.error?.status === "ALREADY_EXISTS" || (response.status === 409 && !payload?.error?.status)) {
    const error = new Error("Uno de los documentos ya existe.");
    error.code = "firebase-admin-already-exists";
    error.status = 409;
    throw error;
  }
  if (response.status === 412 || payload?.error?.status === "FAILED_PRECONDITION" || payload?.error?.status === "ABORTED") {
    const error = new Error("Los datos cambiaron antes de completar la escritura.");
    error.code = "firebase-admin-precondition-failed";
    error.status = 409;
    error.retryable = payload?.error?.status === "ABORTED";
    throw error;
  }
  if (!response.ok) {
    const error = new Error("No se pudo guardar la operación comercial.");
    error.code = "firebase-admin-commit-error";
    error.status = response.status || 500;
    throw error;
  }
  return payload;
}

// All commercial reads use the same read/write transaction. Firestore checks
// its read set at commit, including documents that are not being written.
async function runTransactionAttempt(work, { env = process.env, fetchImpl = fetch } = {}) {
  const config = adminConfig(env);
  const token = await firebaseAdminAccessToken({ env, fetchImpl });
  const request = async (action, body) => {
    const response = await fetchImpl(`${firestoreBase(config.projectId)}:${action}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error("No se pudo completar la transacción comercial.");
      error.code = ["ABORTED", "FAILED_PRECONDITION"].includes(payload.error?.status)
        ? "firebase-admin-precondition-failed" : "firebase-admin-transaction-error";
      error.status = response.status;
      error.retryable = payload.error?.status === "ABORTED";
      throw error;
    }
    return payload;
  };
  const { transaction } = await request("beginTransaction", { options: { readWrite: {} } });
  if (!transaction) throw new Error("Firestore did not provide a transaction.");
  let committed = false;
  const options = { env, fetchImpl, transaction };
  try {
    return await work({
      getDocument: (path) => {
        if (committed) throw new Error("Transaction reads must precede writes.");
        return adminGetDocument(path, options);
      },
      listDocuments: (path) => {
        if (committed) throw new Error("Transaction reads must precede writes.");
        return adminListDocuments(path, options);
      },
      commitDocuments: async (operations) => {
        if (committed) throw new Error("Transaction already committed.");
        const result = await adminCommitDocuments(operations, options);
        committed = true;
        return result;
      },
    });
  } finally {
    if (!committed) await request("rollback", { transaction }).catch(() => {});
  }
}

export async function adminRunTransaction(work, options = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await runTransactionAttempt(work, options); }
    catch (error) {
      if (!error.retryable || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, (30 + Math.floor(Math.random() * 60)) * (attempt + 1)));
    }
  }
}
