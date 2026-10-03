import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { buildPlan, COLLECTIONS, SOURCE_PROJECT, DESTINATION_PROJECT, sourceDigest, documentPath, documentId, fingerprint, same, validateOperation } from "./legacy-migration/domain.mjs";
import { buildCleanupPlan } from "./legacy-migration/cleanup.mjs";

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const mode = args[0] || "audit";
const privateRoot = path.resolve(".firebase-migration-private");
const folder = path.resolve(option("--folder") || path.join(privateRoot, new Date().toISOString().slice(0,10)));
if (folder !== privateRoot && !folder.startsWith(`${privateRoot}${path.sep}`)) throw new Error("Los snapshots deben permanecer en .firebase-migration-private, fuera de Git");
const protectedCollections = ["invoices", "financialEntries", "users", "roles", "settings"];

async function runtime() {
  const globalRoot = process.env.FIREBASE_TOOLS_MODULE_ROOT || (process.platform === "win32"
    ? path.join(process.env.APPDATA, "npm", "node_modules", "firebase-tools")
    : path.join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "firebase-tools"));
  const require = createRequire(path.join(globalRoot, "package.json"));
  const auth = require("./lib/auth.js");
  const { requireAuth } = require("./lib/requireAuth.js");
  const { Client } = require("./lib/apiv2.js");
  const options = { project: DESTINATION_PROJECT, nonInteractive: true };
  const account = auth.getProjectDefaultAccount(process.cwd());
  if (!account) throw new Error("Iniciá sesión con Firebase CLI antes de migrar");
  auth.setActiveAccount(options, account);
  await requireAuth(options, true);
  return new Client({ urlPrefix: "https://firestore.googleapis.com", apiVersion: "v1" });
}
const root = project => `/projects/${project}/databases/(default)/documents`;
async function list(client, project, relative, metadataOnly = false) {
  const result = [];
  let pageToken;
  do {
    const response = await client.get(`${root(project)}/${relative}`, { queryParams: { pageSize: 1000, showMissing: true,
      ...(metadataOnly ? { "mask.fieldPaths": "migrationProjectionNoStoredField" } : {}), ...(pageToken ? { pageToken } : {}) } });
    result.push(...(response.body.documents || []));
    pageToken = response.body.nextPageToken;
  } while (pageToken);
  return result;
}
async function protection(client) {
  const result = {};
  for (const collection of protectedCollections) result[collection] = (await list(client, DESTINATION_PROJECT, collection, true))
    .filter(doc => doc.createTime).map(doc => [documentPath(doc), doc.updateTime]).sort(([a], [b]) => a.localeCompare(b));
  return result;
}
async function capture(client, project) {
  const snapshot = { project, capturedAt: new Date().toISOString(), collections: {} };
  for (const collection of [...COLLECTIONS, ...(project === DESTINATION_PROJECT ? ["warehouses", "auditLogs"] : [])]) {
    snapshot.collections[collection] = (await list(client, project, collection)).filter(doc => doc.fields);
  }
  for (const stockCollection of ["locationStock", ...(project === DESTINATION_PROJECT ? ["warehouseStock"] : [])]) {
    const parents = await list(client, project, stockCollection);
    const ids = new Set([...parents.map(documentId), ...(snapshot.collections[stockCollection === "warehouseStock" ? "warehouses" : "locations"] || []).map(documentId)]);
    snapshot.collections[stockCollection] = [];
    for (const id of ids) snapshot.collections[stockCollection].push(...(await list(client, project, `${stockCollection}/${encodeURIComponent(id)}/items`)).filter(doc => doc.fields));
  }
  if (project === DESTINATION_PROJECT) snapshot.protected = await protection(client);
  return snapshot;
}
const save = (name, value) => fs.writeFile(path.join(folder, name), JSON.stringify(value, null, 2));
const load = async name => JSON.parse(await fs.readFile(path.join(folder, name), "utf8"));
const report = plan => ({ operationId: plan.operationId, stats: plan.stats, groups: plan.groups.length,
  writes: plan.groups.reduce((sum, group) => sum + group.operations.length, 0), conflicts: plan.conflicts, warnings: plan.warnings || [] });

export function toFirestoreWrite(operation) {
  validateOperation(operation);
  return { update: { name: `projects/${DESTINATION_PROJECT}/databases/(default)/documents/${operation.path}`, fields: operation.fields },
    ...(operation.updateMask ? { updateMask: { fieldPaths: operation.updateMask } } : {}), currentDocument: operation.precondition };
}

async function verifyOperations(client, groups) {
  // Read only affected collections once; verify full fields or the masked patch.
  const collections = new Set(groups.flatMap(group => group.operations.map(operation => operation.path.split("/").slice(0,-1).join("/"))));
  const actual = new Map();
  for (const collection of collections) for (const doc of await list(client, DESTINATION_PROJECT, collection)) if (doc.fields) actual.set(documentPath(doc), doc);
  const failures = [];
  for (const group of groups) for (const operation of group.operations) {
    const doc = actual.get(operation.path);
    const matches = doc && (operation.updateMask ? operation.updateMask.every(key => same(doc.fields[key], operation.fields[key])) : same(doc.fields, operation.fields));
    if (!matches) failures.push(operation.path);
  }
  if (failures.length) throw new Error(`La verificación no coincide en ${failures.length} documentos; se conserva el informe privado`);
  return actual;
}

async function apply(client, plan) {
  if (!/^[a-zA-Z0-9_-]+$/.test(plan.operationId)) throw new Error("ID de operación inválido");
  if (plan.conflicts.length) throw new Error("Hay conflictos sin resolver; no se realizan escrituras");
  const planHash = fingerprint(plan);
  const journalName = `journal-${plan.operationId}.json`;
  let journal = { operationId: plan.operationId, planHash, completedGroups: [] };
  try { journal = await load(journalName); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (journal.planHash !== planHash) throw new Error("El plan cambió respecto de su journal");
  for (const group of plan.groups) group.operations.forEach(validateOperation);
  const freshSource = await capture(client, SOURCE_PROJECT);
  if (plan.sourceDigest && sourceDigest(freshSource) !== plan.sourceDigest) throw new Error("El origen cambió: generá un nuevo plan antes de aplicar");
  if (plan.authorizedIds && freshSource.collections.sales.some(doc => plan.authorizedIds.includes(documentId(doc)))) throw new Error("La limpieza alcanzaría una venta original; se detiene");
  const beforeProtection = await protection(client);
  const completed = new Set(journal.completedGroups);
  if (completed.size) await verifyOperations(client, plan.groups.filter(group => completed.has(group.id)));
  const pending = plan.groups.filter(group => !completed.has(group.id));
  const batches = [];
  let batch = [], writes = 0;
  for (const group of pending) {
    if (group.operations.length > 500) throw new Error("Grupo atómico demasiado grande");
    if (batch.length && writes + group.operations.length > 100) { batches.push(batch); batch = []; writes = 0; }
    batch.push(group); writes += group.operations.length;
  }
  if (batch.length) batches.push(batch);
  for (let index = 0; index < batches.length; index++) {
    const groups = batches[index];
    try { await client.post(`${root(DESTINATION_PROJECT)}:commit`, { writes: groups.flatMap(group => group.operations.map(toFirestoreWrite)) }); }
    catch (error) {
      // A lost response may follow a successful atomic commit. Verify before retrying anything.
      try { await verifyOperations(client, groups); } catch { throw error; }
    }
    groups.forEach(group => completed.add(group.id));
    journal.completedGroups = [...completed];
    await save(journalName, journal);
    if ((index + 1) % 5 === 0 || index === batches.length - 1) console.log(JSON.stringify({ committedBatches: index + 1, totalBatches: batches.length, completedGroups: completed.size }));
  }
  await verifyOperations(client, plan.groups);
  const afterProtection = await protection(client);
  if (!same(beforeProtection, afterProtection)) throw new Error("Cambió metadata de una colección protegida durante la operación; revisar informe");
  const result = { ...report(plan), verified: true, protectedCollectionsUnchanged: true, completedAt: new Date().toISOString() };
  await save(`result-${plan.operationId}.json`, result);
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  await fs.mkdir(folder, { recursive: true });
  const client = await runtime();
  if (mode === "audit" || mode === "audit-destination") {
    for (const project of mode === "audit-destination" ? [DESTINATION_PROJECT] : [SOURCE_PROJECT, DESTINATION_PROJECT]) {
      const snapshot = await capture(client, project);
      await save(`${project}-snapshot.json`, snapshot);
      console.log(JSON.stringify({ project, counts: Object.fromEntries(Object.entries(snapshot.collections).map(([collection, docs]) => [collection, docs.length])) }));
    }
  } else if (mode === "plan") {
    const source = await load(`${SOURCE_PROJECT}-snapshot.json`), destination = await load(`${DESTINATION_PROJECT}-snapshot.json`);
    const operationId = option("--operation") || `legacy-sync-${Date.now()}`;
    const plan = buildPlan(source, destination, { operationId });
    await save("plan.json", plan);
    console.log(JSON.stringify(report(plan), null, 2));
    if (plan.conflicts.length) process.exitCode = 2;
  } else if (mode === "cleanup-plan") {
    const ids = await load("authorized-cleanup-ids.json");
    const destination = await load(`${DESTINATION_PROJECT}-snapshot.json`);
    const plan = buildCleanupPlan(destination, ids, { operationId: option("--operation") || `cleanup-own-sales-${Date.now()}` });
    await save("cleanup-plan.json", plan);
    console.log(JSON.stringify(report(plan), null, 2));
  } else if (mode === "apply") {
    const filename = option("--plan") || "plan.json";
    if (path.basename(filename) !== filename) throw new Error("El plan debe estar dentro de la carpeta privada");
    await apply(client, await load(filename));
  } else throw new Error("Modo válido: audit, audit-destination, plan, cleanup-plan o apply");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ error: error.message, code: error.status || error.code || "migration-failed" })); process.exitCode = 1; });
}
