import { createHash } from "node:crypto";

const sourceProject = process.env.FIRESTORE_SOURCE_PROJECT;
const destinationProject = process.env.FIRESTORE_DESTINATION_PROJECT;
const accessToken = process.env.FIREBASE_ACCESS_TOKEN;
const databaseId = process.env.FIRESTORE_DATABASE_ID || "(default)";

if (!sourceProject || !destinationProject || !accessToken) {
  throw new Error(
    "Faltan FIRESTORE_SOURCE_PROJECT, FIRESTORE_DESTINATION_PROJECT o FIREBASE_ACCESS_TOKEN.",
  );
}

if (sourceProject === destinationProject) {
  throw new Error("El proyecto de origen y el de destino deben ser distintos.");
}

const apiRoot = "https://firestore.googleapis.com/v1";
const batchSize = 400;
const sourceHashes = new Map();
const destinationHashes = new Map();
const collectionPaths = new Set();
let pendingWrites = [];
let copiedDocuments = 0;

const encodePath = (path) =>
  path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const documentRoot = (project) =>
  `${apiRoot}/projects/${project}/databases/${encodeURIComponent(databaseId)}/documents`;

const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function requestJson(url, options = {}, attempt = 0) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok && (response.status === 429 || response.status >= 500) && attempt < 5) {
    await pause(500 * 2 ** attempt);
    return requestJson(url, options, attempt + 1);
  }

  const body = await response.text();
  const payload = body ? JSON.parse(body) : {};
  if (!response.ok) {
    const message = payload?.error?.message || response.statusText;
    throw new Error(`Firestore respondió ${response.status}: ${message}`);
  }
  return payload;
}

async function listCollectionIds(project, documentPath = "") {
  const parent = documentPath
    ? `${documentRoot(project)}/${encodePath(documentPath)}`
    : documentRoot(project);
  const collectionIds = [];
  let pageToken;

  do {
    const payload = await requestJson(`${parent}:listCollectionIds`, {
      method: "POST",
      body: JSON.stringify({ pageSize: 1000, pageToken }),
    });
    collectionIds.push(...(payload.collectionIds || []));
    pageToken = payload.nextPageToken;
  } while (pageToken);

  return collectionIds.sort();
}

async function listDocuments(project, parentPath, collectionId) {
  const parent = parentPath
    ? `${documentRoot(project)}/${encodePath(parentPath)}`
    : documentRoot(project);
  const documents = [];
  let pageToken;

  do {
    const query = new URLSearchParams({
      pageSize: "1000",
      showMissing: "true",
    });
    if (pageToken) query.set("pageToken", pageToken);
    const payload = await requestJson(
      `${parent}/${encodeURIComponent(collectionId)}?${query.toString()}`,
    );
    documents.push(...(payload.documents || []));
    pageToken = payload.nextPageToken;
  } while (pageToken);

  return documents;
}

function rebaseReferences(value) {
  if (Array.isArray(value)) return value.map(rebaseReferences);
  if (!value || typeof value !== "object") return value;

  const rebased = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === "referenceValue" && typeof nestedValue === "string") {
      rebased[key] = nestedValue.replace(
        `projects/${sourceProject}/databases/${databaseId}/documents/`,
        `projects/${destinationProject}/databases/${databaseId}/documents/`,
      );
    } else {
      rebased[key] = rebaseReferences(nestedValue);
    }
  }
  return rebased;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

const hashFields = (fields) =>
  createHash("sha256").update(JSON.stringify(canonicalize(fields || {}))).digest("hex");

const relativeDocumentPath = (documentName) => documentName.split("/documents/")[1];

async function flushWrites() {
  if (!pendingWrites.length) return;
  const url = `${documentRoot(destinationProject)}:commit`;
  const payload = await requestJson(url, {
    method: "POST",
    body: JSON.stringify({ writes: pendingWrites }),
  });
  copiedDocuments += payload.writeResults?.length || pendingWrites.length;
  pendingWrites = [];
}

async function copyDocument(document) {
  const documentPath = relativeDocumentPath(document.name);
  const fields = rebaseReferences(document.fields || {});
  sourceHashes.set(documentPath, hashFields(fields));
  pendingWrites.push({
    update: {
      name: `projects/${destinationProject}/databases/${databaseId}/documents/${documentPath}`,
      fields,
    },
    currentDocument: { exists: false },
  });

  if (pendingWrites.length >= batchSize) await flushWrites();
}

async function walkProject(project, documentPath = "", onDocument) {
  const collectionIds = await listCollectionIds(project, documentPath);
  for (const collectionId of collectionIds) {
    const collectionPath = documentPath
      ? `${documentPath}/${collectionId}`
      : collectionId;
    if (project === sourceProject) collectionPaths.add(collectionPath);
    const documents = await listDocuments(project, documentPath, collectionId);

    for (const document of documents) {
      const currentPath = relativeDocumentPath(document.name);
      const exists = Boolean(document.createTime || document.updateTime || document.fields);
      if (exists) await onDocument(document, currentPath);
      await walkProject(project, currentPath, onDocument);
    }
  }
}

await walkProject(sourceProject, "", copyDocument);
await flushWrites();

await walkProject(destinationProject, "", async (document, documentPath) => {
  destinationHashes.set(documentPath, hashFields(document.fields || {}));
});

const missing = [];
const different = [];
for (const [documentPath, sourceHash] of sourceHashes) {
  const destinationHash = destinationHashes.get(documentPath);
  if (!destinationHash) missing.push(documentPath);
  else if (destinationHash !== sourceHash) different.push(documentPath);
}
const unexpected = [...destinationHashes.keys()].filter((path) => !sourceHashes.has(path));

if (missing.length || different.length || unexpected.length) {
  throw new Error(
    `La verificación falló: faltantes=${missing.length}, diferentes=${different.length}, inesperados=${unexpected.length}.`,
  );
}

console.log(
  JSON.stringify(
    {
      sourceProject,
      destinationProject,
      collections: collectionPaths.size,
      sourceDocuments: sourceHashes.size,
      copiedDocuments,
      destinationDocuments: destinationHashes.size,
      verified: true,
    },
    null,
    2,
  ),
);

