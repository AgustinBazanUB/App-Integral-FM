import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://example.com/.netlify/functions/google-drive-callback";
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef";

const drive = await import("../netlify/functions/_lib/googleDrive.mjs");
const callback = await import("../netlify/functions/google-drive-callback.mjs");

test("OAuth usa scope drive.file, offline access y state", () => {
  const url = new URL(drive.buildGoogleAuthorizationUrl({ state: "state-test" }));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.file");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("state"), "state-test");
  assert.equal(url.searchParams.get("redirect_uri"), process.env.GOOGLE_OAUTH_REDIRECT_URI);
});

test("refresh token se cifra con AES-GCM y no queda plaintext", () => {
  const original = "refresh-token-super-secreto";
  const encrypted = drive.encryptRefreshToken(original);
  assert.equal(encrypted.algorithm, "aes-256-gcm");
  assert.notEqual(encrypted.ciphertext, original);
  assert.equal(JSON.stringify(encrypted).includes(original), false);
  assert.equal(drive.decryptRefreshToken(encrypted), original);
});

test("backend inicia Google Drive resumable upload y no recibe binario", () => {
  const backend = fs.readFileSync("netlify/functions/google-drive.mjs", "utf8");
  const helper = fs.readFileSync("netlify/functions/_lib/googleDrive.mjs", "utf8");
  assert.match(helper, /uploadType:\s*"resumable"/);
  assert.match(helper, /X-Upload-Content-Length/);
  assert.match(backend, /originalFileName:\s*local\.value\.originalFileName/);
  assert.doesNotMatch(backend, /arrayBuffer\(\)|formData\(\)|request\.body\.getReader/);
});

test("browser sube chunks a sessionUrl y Netlify sólo recibe metadata", () => {
  const client = fs.readFileSync("src/gestion/marketing/metaAds/googleDriveService.js", "utf8");
  assert.match(client, /xhrPut\(sessionUrl, chunk/);
  assert.match(client, /Content-Range/);
  const start = client.indexOf('authorizedRequest("createUpload", {');
  const end = client.indexOf("  });", start) + 5;
  const createPayload = client.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(createPayload, /originalFileName:/);
  assert.match(createPayload, /mimeType:/);
  assert.match(createPayload, /sizeBytes:/);
  assert.doesNotMatch(createPayload, /\bfile\s*[:,]/);
});

test("sesiones resumibles no se persisten con URL y secrets quedan backend-only", () => {
  const backend = fs.readFileSync("netlify/functions/google-drive.mjs", "utf8").replace(/\r\n/g, "\n");
  const rules = fs.readFileSync("firestore.rules", "utf8");
  const sessionStart = backend.indexOf("await adminSet(`creativeUploadSessions/${uploadId}`, {");
  const sessionEnd = backend.indexOf("\n  });", sessionStart);
  assert.notEqual(sessionStart, -1, "debe existir la escritura de la sesión");
  assert.notEqual(sessionEnd, -1, "debe poder delimitarse la escritura de la sesión");
  const sessionWrite = backend.slice(sessionStart, sessionEnd);
  assert.equal(sessionWrite.includes("sessionUrl"), false);
  assert.match(rules, /match \/integrationSecrets\/\{secretId\} \{ allow read,write: if false; \}/);
  assert.match(rules, /match \/integrationOauthStates\/\{stateId\} \{ allow read,write: if false; \}/);
  assert.match(rules, /match \/creativeUploadSessions\/\{sessionId\} \{ allow read,write: if false; \}/);
});

test("cliente no puede escribir RecordingTasks ni CreativeAssets", () => {
  const rules = fs.readFileSync("firestore.rules", "utf8");
  assert.match(rules, /match \/recordingTasks\/\{taskId\}[\s\S]*?allow create,update,delete: if false;/);
  assert.match(rules, /match \/creativeAssets\/\{assetId\}[\s\S]*?allow create,update,delete: if false;/);
});

test("marketing_manager puede usar workspace pero no administrar OAuth por defecto", () => {
  const permissions = fs.readFileSync("src/gestion/permissions.js", "utf8");
  const authHelper = fs.readFileSync("netlify/functions/_lib/firebaseAuth.mjs", "utf8");
  const marketingBlock = permissions.slice(permissions.indexOf("const metaAdsMarketingActions"), permissions.indexOf("const sellerSalesActions"));
  assert.match(marketingBlock, /metaAdsViewCreativeWorkspace/);
  assert.match(marketingBlock, /metaAdsUploadCreative/);
  assert.doesNotMatch(marketingBlock, /metaAdsManageDrive/);
  const whitelist = authHelper.slice(authHelper.indexOf("MARKETING_MANAGER_META_ADS_ACTIONS"), authHelper.indexOf("function allowedAction"));
  assert.match(whitelist, /metaAdsUploadCreative/);
  assert.doesNotMatch(whitelist, /metaAdsManageDrive/);
});


test("una toma adicional fallida conserva una tarea que ya tenía toma preferida", () => {
  const backend = fs.readFileSync("netlify/functions/google-drive.mjs", "utf8");
  const start = backend.indexOf("async function reportUploadError");
  const end = backend.indexOf("async function selectAsset", start);
  const block = backend.slice(start, end);
  assert.match(block, /status:\s*task\.selectedAssetId\s*\?\s*"ready_for_validation"\s*:\s*"error"/);
});

test("health reconoce ambos nombres server-side de la cuenta Firebase", () => {
  const helper = fs.readFileSync("netlify/functions/_lib/serverFirestore.mjs", "utf8");
  assert.match(helper, /FIREBASE_SERVICE_ACCOUNT_JSON/);
  assert.match(helper, /FIREBASE_SERVICE_ACCOUNT_APP_INTEGRAL_FM/);
  assert.match(helper, /backendFirebaseConfigured/);
});

test("OAuth callback valida que el state pertenezca a Google Drive", () => {
  const callback = fs.readFileSync("netlify/functions/google-drive-callback.mjs", "utf8");
  assert.match(callback, /record\.provider !== "google_drive"/);
  assert.match(callback, /validateOAuthStateRecord\(stateRecord\)/);
  assert.ok(callback.indexOf("ensureDriveRootFolder") < callback.indexOf("storeGoogleDriveSecret"));
});

test("OAuth state rechaza registros ausentes, inválidos y vencidos", () => {
  const now = Date.now();
  assert.equal(callback.validateOAuthStateRecord(null, now), "invalid");
  assert.equal(callback.validateOAuthStateRecord({ provider: "otro", uid: "admin" }, now), "invalid");
  assert.equal(callback.validateOAuthStateRecord({
    provider: "google_drive",
    uid: "admin",
    createdAt: new Date(now - 11 * 60 * 1000),
    expiresAt: new Date(now + 60 * 1000),
  }, now), "expired");
  assert.equal(callback.validateOAuthStateRecord({
    provider: "google_drive",
    uid: "admin",
    createdAt: new Date(now - 60 * 1000),
    expiresAt: new Date(now - 1),
  }, now), "expired");
  assert.equal(callback.validateOAuthStateRecord({
    provider: "google_drive",
    uid: "admin",
    createdAt: new Date(now - 60 * 1000),
    expiresAt: new Date(now + 60 * 1000),
  }, now), "valid");
});

test("OAuth state es one-time y callback sin code falla de forma segura", () => {
  const source = fs.readFileSync("netlify/functions/google-drive-callback.mjs", "utf8");
  const deleteState = source.indexOf("await adminDelete(`integrationOauthStates/${state}`);");
  const exchangeCode = source.indexOf("await exchangeAuthorizationCode(code)");
  assert.ok(deleteState >= 0 && deleteState < exchangeCode);
  assert.match(source, /if \(providerError \|\| !code\)/);
  assert.match(source, /providerError === "access_denied" \? "oauth_cancelled" : "oauth_error"/);
});
