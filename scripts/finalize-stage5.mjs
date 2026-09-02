import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, content) {
  fs.writeFileSync(path, content, "utf8");
}

function replaceRequired(content, search, replacement, label) {
  if (!content.includes(search)) throw new Error(`No se encontró patrón requerido: ${label}`);
  return content.replace(search, replacement);
}

// 1) Unificar el helper Firebase backend y aceptar el nombre de credencial ya usado por el proyecto.
{
  const path = "netlify/functions/_lib/serverFirestore.mjs";
  let content = read(path);
  content = replaceRequired(
    content,
    "  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;",
    "  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_APP_INTEGRAL_FM || \"\";",
    "service account fallback",
  );
  content = content.replace(
    "Falta FIREBASE_SERVICE_ACCOUNT_JSON en Netlify.",
    "Falta una cuenta de servicio Firebase server-side en Netlify.",
  );
  content = content.replace(
    "FIREBASE_SERVICE_ACCOUNT_JSON no tiene un formato válido.",
    "La cuenta de servicio Firebase server-side no tiene un formato válido.",
  );
  content = replaceRequired(
    content,
    "export function backendFirebaseProjectId() {\n  return PROJECT_ID;\n}\n",
    "export function backendFirebaseConfigured() {\n  try {\n    serviceAccount();\n    return true;\n  } catch {\n    return false;\n  }\n}\n\nexport function backendFirebaseProjectId() {\n  return PROJECT_ID;\n}\n",
    "backendFirebaseConfigured export",
  );
  write(path, content);
}

// 2) Health honesto y una toma adicional fallida no invalida una toma ya seleccionada.
{
  const path = "netlify/functions/google-drive.mjs";
  let content = read(path);
  content = replaceRequired(
    content,
    'import { adminDelete, adminGet, adminList, adminPatch, adminSet } from "./_lib/serverFirestore.mjs";',
    'import { adminDelete, adminGet, adminList, adminPatch, adminSet, backendFirebaseConfigured } from "./_lib/serverFirestore.mjs";',
    "serverFirestore import",
  );
  content = replaceRequired(
    content,
    "firebaseBackendConfigured: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),",
    "firebaseBackendConfigured: backendFirebaseConfigured(),",
    "Drive health Firebase config",
  );
  const start = content.indexOf("async function reportUploadError");
  const end = content.indexOf("async function selectAsset", start);
  if (start < 0 || end < 0) throw new Error("No se encontró reportUploadError.");
  const before = content.slice(0, start);
  let block = content.slice(start, end);
  block = replaceRequired(
    block,
    '      status: "error",',
    '      status: task.selectedAssetId ? "ready_for_validation" : "error",',
    "upload error task status",
  );
  content = before + block + content.slice(end);
  write(path, content);
}

// 3) OAuth callback: validar proveedor de state y no persistir token antes de comprobar la conexión.
{
  const path = "netlify/functions/google-drive-callback.mjs";
  let content = read(path);
  content = replaceRequired(
    content,
    "  exchangeAuthorizationCode,\n",
    "  exchangeAuthorizationCode,\n  clearGoogleDriveSecret,\n",
    "callback clear secret import",
  );
  content = replaceRequired(
    content,
    "    if (!stateRecord) return redirect(`${fallbackOrigin}/gestion/settings?drive=oauth_state_invalid`);\n    const createdAt",
    "    if (!stateRecord) return redirect(`${fallbackOrigin}/gestion/settings?drive=oauth_state_invalid`);\n    if (stateRecord.provider !== \"google_drive\" || !stateRecord.uid) {\n      await adminDelete(`integrationOauthStates/${state}`);\n      return redirect(`${fallbackOrigin}/gestion/settings?drive=oauth_state_invalid`);\n    }\n    const createdAt",
    "OAuth state provider validation",
  );
  const oldBlock = `    await storeGoogleDriveSecret(tokens.refresh_token, { connectedBy: stateRecord.uid });\n    const [about, previous] = await Promise.all([\n      getDriveAbout(tokens.access_token),\n      adminGet(\"integrationConnections/googleDrive\", { optional: true }),\n    ]);\n    const rootFolder = await ensureDriveRootFolder({ accessToken: tokens.access_token });\n    await saveDriveConnection({\n      account: about.user || {},\n      rootFolder,\n      connectedBy: stateRecord.uid,\n      previous,\n    });`;
  const newBlock = `    const [about, previous] = await Promise.all([\n      getDriveAbout(tokens.access_token),\n      adminGet(\"integrationConnections/googleDrive\", { optional: true }),\n    ]);\n    const rootFolder = await ensureDriveRootFolder({ accessToken: tokens.access_token });\n    await storeGoogleDriveSecret(tokens.refresh_token, { connectedBy: stateRecord.uid });\n    try {\n      await saveDriveConnection({\n        account: about.user || {},\n        rootFolder,\n        connectedBy: stateRecord.uid,\n        previous,\n      });\n    } catch (error) {\n      await clearGoogleDriveSecret().catch(() => {});\n      throw error;\n    }`;
  content = replaceRequired(content, oldBlock, newBlock, "OAuth token persistence order");
  write(path, content);
}

// 4) Ampliar tests focalizados de los ajustes finales.
{
  const path = "tests/meta-ads-drive-contract.test.mjs";
  let content = read(path);
  if (!content.includes("una toma adicional fallida conserva")) {
    content += `\n\ntest(\"una toma adicional fallida conserva una tarea que ya tenía toma preferida\", () => {\n  const backend = fs.readFileSync(\"netlify/functions/google-drive.mjs\", \"utf8\");\n  const start = backend.indexOf(\"async function reportUploadError\");\n  const end = backend.indexOf(\"async function selectAsset\", start);\n  const block = backend.slice(start, end);\n  assert.match(block, /status:\\s*task\\.selectedAssetId\\s*\\?\\s*\"ready_for_validation\"\\s*:\\s*\"error\"/);\n});\n\ntest(\"health reconoce ambos nombres server-side de la cuenta Firebase\", () => {\n  const helper = fs.readFileSync(\"netlify/functions/_lib/serverFirestore.mjs\", \"utf8\");\n  assert.match(helper, /FIREBASE_SERVICE_ACCOUNT_JSON/);\n  assert.match(helper, /FIREBASE_SERVICE_ACCOUNT_APP_INTEGRAL_FM/);\n  assert.match(helper, /backendFirebaseConfigured/);\n});\n\ntest(\"OAuth callback valida que el state pertenezca a Google Drive\", () => {\n  const callback = fs.readFileSync(\"netlify/functions/google-drive-callback.mjs\", \"utf8\");\n  assert.match(callback, /stateRecord\\.provider !== \"google_drive\"/);\n  assert.ok(callback.indexOf(\"ensureDriveRootFolder\") < callback.indexOf(\"storeGoogleDriveSecret\"));\n});\n`;
  }
  write(path, content);
}

// 5) Eliminar helper duplicado que no tiene consumidores.
fs.rmSync("netlify/functions/_lib/firebaseAdminRest.mjs", { force: true });

console.log("Stage 5 final light fixes applied.");
