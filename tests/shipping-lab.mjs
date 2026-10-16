// Local acceptance environment. This entry is outside src/ and Netlify functions.
// It never loads .env or credentials and only connects to a demo Firestore emulator.
import { build } from "esbuild";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, getDocs, getDoc, doc, setDoc, runTransaction } from "firebase/firestore";
import { initialDocuments, admin, seller, preparer, manager } from "./helpers/shippingFixtures.mjs";
import { createShippingSale, shippingOperation, limitShippingPublic } from "../netlify/functions/_lib/shipping.mjs";
import { can, canAccessSellerPanel, canAccessAdministration } from "../src/gestion/permissions.js";

const host = "127.0.0.1", port = 5174, emulatorPort = 18081, projectId = "demo-flormia-shipping-lab";
if (!projectId.startsWith("demo-") || host !== "127.0.0.1") throw Error("El laboratorio requiere proyecto demo y loopback.");
const outdir = path.resolve("tmp/shipping-lab");
await mkdir(outdir, { recursive: true });
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["127.0.0.1", "localhost"].includes(target.hostname)) throw Error("El laboratorio bloqueó una conexión externa.");
  return nativeFetch(input, init);
};
let emulator;
try { await nativeFetch(`http://${host}:${emulatorPort}/`, { signal: AbortSignal.timeout(700) }); }
catch {
  const tools = path.join(tmpdir(), "flormia-shipping-tools");
  const installed = (await readdir(tools, { withFileTypes: true }).catch(() => [])).find(row => row.isDirectory() && row.name.endsWith("-jre"));
  const java = process.env.SHIPPING_LAB_JAVA || (installed ? path.join(tools, installed.name, "bin", "java.exe") : "java");
  const jar = path.join(homedir(), ".cache/firebase/emulators/cloud-firestore-emulator-v1.19.8.jar");
  emulator = spawn(java, ["-jar", jar, "--host", host, "--port", String(emulatorPort), "--project_id", projectId], { windowsHide: true, stdio: "ignore" });
  let startError;
  emulator.on("error", error => { startError = error; });
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (startError) throw startError;
    await new Promise(resolve => setTimeout(resolve, 200));
    try { await nativeFetch(`http://${host}:${emulatorPort}/`, { signal: AbortSignal.timeout(500) }); ready = true; break; } catch {}
  }
  if (!ready) throw Error("No arrancó Firestore Emulator. Revisá Java y el JAR local.");
}
const environment = await initializeTestEnvironment({ projectId, firestore: { host, port: emulatorPort, rules: await readFile("firestore.rules", "utf8") } });
const labProfiles = { admin, seller, preparer, manager };
const plain = value => value?.toDate ? value.toDate().toISOString() : value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(plain) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plain(child)])) : value;
const list = (db, name) => getDocs(collection(db, name)).then(snapshot => snapshot.docs.map(row => ({ ...plain(row.data()), id: row.id })));
const withAdmin = async work => {
  let result;
  await environment.withSecurityRulesDisabled(async context => { result = await work(context.firestore()); });
  return result;
};
const transactionAdapter = work => withAdmin(db => {
  return runTransaction(db, transaction => work({
    getDocument: async name => { const snapshot = await transaction.get(doc(db, name)); return snapshot.exists() ? { data: plain(snapshot.data()) } : null; },
    listDocuments: name => list(db, name),
    commitDocuments: async operations => { for (const operation of operations) { const reference = doc(db, operation.path); if (operation.type === "create") transaction.set(reference, operation.data); else if (operation.type === "update") transaction.update(reference, operation.data); else throw Error("Operación no permitida en laboratorio."); } },
  }));
});
async function reset() {
  if (environment.projectId !== projectId || !projectId.startsWith("demo-")) throw Error("Proyecto de laboratorio inválido.");
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const [name, original] of initialDocuments()) {
      const data = { ...original };
      if (name === "products/oil") Object.assign(data, { categoryId: "food", categoryName: "Almacén", abbreviation: "ACEITE QA", productFormat: "2 L", deleted: false });
      if (name.startsWith("locationStock/") || name.startsWith("warehouseStock/")) Object.assign(data, { productName: "Aceite de prueba", priceMode: "default", deleted: false, productDeleted: false });
      if (name === "locations/valle") Object.assign(data, { type: "store", deleted: false, assignedSellerIds: [seller.id, preparer.id] });
      await setDoc(doc(db, name), data);
    }
    await setDoc(doc(db, "productCategories/food"), { name: "Almacén", active: true, sortOrder: 1 });
    await setDoc(doc(db, "settings/keyboardShortcuts"), { sellerActions: {} });
  });
}
let stateInFlight, stateCached, stateCachedAt = 0;
async function state() {
  if (stateInFlight) return stateInFlight;
  if (stateCached && Date.now() - stateCachedAt < 250) return stateCached;
  stateInFlight = readState();
  try { stateCached = await stateInFlight; stateCachedAt = Date.now(); return stateCached; }
  finally { stateInFlight = null; }
}
async function readState() {
  return withAdmin(async db => {
    const [sales, shipments, movements, alerts, local, warehouse] = await Promise.all([
      list(db, "sales"), list(db, "shipments"), list(db, "stockMovements"), list(db, "alerts"), getDoc(doc(db, "locationStock/valle/items/oil")), getDoc(doc(db, "warehouseStock/infal/items/oil")),
    ]);
    return { projectId, sales, shipments, movements, alerts, stock: { valle: local.data()?.currentStock, infal: warehouse.data()?.currentStock }, fiscalCalls: 0, productionCalls: 0 };
  });
}
await reset();
const firebaseMock = `import{initializeApp}from'firebase/app';import{getFirestore,connectFirestoreEmulator}from'firebase/firestore';
  const config=window.__SHIPPING_LAB__;if(!config||config.projectId!==${JSON.stringify(projectId)})throw Error('Configuración de laboratorio inválida');
  const params=new URLSearchParams(location.search);if(params.has('qaRole'))sessionStorage.setItem('shipping-lab-role',params.get('qaRole'));const role=sessionStorage.getItem('shipping-lab-role')||'admin';
  const profiles=${JSON.stringify(labProfiles)};export const labProfile=profiles[role]||profiles.admin;
  export const firebaseConfig={projectId:config.projectId,apiKey:'demo-key',appId:'demo-app'};export const firebaseApp=initializeApp(firebaseConfig);export const db=getFirestore(firebaseApp);connectFirestoreEmulator(db,${JSON.stringify(host)},${emulatorPort},{mockUserToken:{sub:labProfile.id,user_id:labProfile.id,email:labProfile.id+'@shipping.test'}});
  export const auth={currentUser:{uid:labProfile.id,getIdToken:async()=>'lab:'+labProfile.id}};export const login=async()=>{throw Error('Usá los perfiles locales del laboratorio')};export const logout=async()=>location.assign('/gestion/shipping?qaRole=admin');`;
const disabledFiscal = `const blocked=async()=>{throw Object.assign(Error('Facturación real deshabilitada en laboratorio. Usá Continuar sin factura.'),{code:'lab/fiscal-disabled'})};export const validateArcaInvoiceDraft=blocked;export const requestPendingArcaInvoice=blocked;export const lookupArcaBillingReceiver=blocked;export const cancelSaleWithInvoice=blocked;export const getArcaInvoiceForSale=async()=>null;export {arcaSourceTypeForSale}from'${path.resolve("src/shared/arcaSourceType.mjs").replaceAll("\\", "/")}';`;
const mocks = {
  firebase: firebaseMock,
  AuthContext: `import{labProfile,auth,login,logout}from'lab:firebase';export const useAuth=()=>({status:'ready',profile:labProfile,user:auth.currentUser,login,logout});export const AuthProvider=({children})=>children;`,
  ScreenContext: `export const useOliviaVisibility=()=>({assistantOpen:false});export const useOliviaScreenContext=()=>{};export const useOliviaRefresh=()=>{};`,
  LauncherHost: `export const OliviaLauncherSlot=()=>null;`,
  routePreload: `export const preloadManagementRoute=()=>{};`,
  arcaService: disabledFiscal,
  SaleInvoicePanel: `export default()=>null;`,
  ArcaInvoicePrintAction: `export default()=>null;`,
};
await build({ entryPoints: ["tests/shipping-lab-client.jsx"], bundle: true, outdir, entryNames: "app", format: "esm", jsx: "automatic", sourcemap: true, external: ["/images/*"], define: { "import.meta.env": "{}" }, loader: { ".woff": "dataurl", ".woff2": "dataurl" }, plugins: [{ name: "lab-boundaries", setup(builder) {
  builder.onResolve({ filter: /^lab:firebase$/ }, () => ({ path: "firebase", namespace: "lab" }));
  builder.onResolve({ filter: /(?:^|\/)(firebase|AuthContext|ScreenContext|LauncherHost|routePreload|arcaService|SaleInvoicePanel|ArcaInvoicePrintAction)$/ }, args => args.path.startsWith(".") ? ({ path: args.path.split("/").at(-1), namespace: "lab" }) : undefined);
  builder.onLoad({ filter: /.*/, namespace: "lab" }, args => ({ contents: mocks[args.path], loader: "jsx", resolveDir: process.cwd() }));
} }] });
const html = '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Flor Mía · Laboratorio de envíos</title><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/__lab/config.js"></script><script type="module" src="/app.js"></script></html>';
const labEnv = { SHIPPING_REPOSITORY_ADDRESS: "Repositorio de prueba · Calle de prueba 321, CABA", SHIPPING_COURIER_TTL_HOURS: "4" };
const send = (response, payload, status = 200) => { response.statusCode = status; response.setHeader("Content-Type", "application/json; charset=utf-8"); response.setHeader("Cache-Control", "no-store"); response.end(JSON.stringify(plain(payload))); };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${host}:${port}`);
    const origin = request.headers.origin;
    if (origin && origin !== `http://${host}:${port}` && origin !== `http://localhost:${port}`) return send(response, { message: "Origen de laboratorio inválido" }, 403);
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Permissions-Policy", "geolocation=(self)");
    response.setHeader("Content-Security-Policy", `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' http://${host}:${emulatorPort} ws://${host}:${emulatorPort}; frame-src 'self' blob:; base-uri 'self'; form-action 'self'`);
    if (url.pathname === "/__lab/state") return send(response, await state());
    if (url.pathname === "/__lab/reset" && request.method === "POST") { await reset(); return send(response, { ok: true }); }
    if (url.pathname === "/__lab/config.js") { response.setHeader("Content-Type", "text/javascript"); return response.end(`window.__SHIPPING_LAB__=${JSON.stringify({ projectId, emulatorPort })};`); }
    if (url.pathname === "/.netlify/functions/shipping" && request.method === "POST") {
      let raw = ""; for await (const chunk of request) { raw += chunk; if (raw.length > 120000) return send(response, { ok: false, message: "Solicitud demasiado grande" }, 413); }
      const body = JSON.parse(raw), uid = String(request.headers.authorization || "").replace(/^Bearer lab:/, "");
      const profile = Object.values(labProfiles).find(profile => profile.id === uid);
      const session = profile ? { uid, profile } : null;
      let result;
      if (body.mode === "create_sale") {
        if (!session) return send(response, { ok: false }, 401);
        result = await createShippingSale({ sale: body.sale, requestId: body.requestId, administrative: body.administrative === true, session, runTransaction: transactionAdapter, env: labEnv });
      } else if (body.mode === "resources") {
        if (!session || (!can(profile, "quick-sales", "create") && !can(profile, "shipping", "view"))) return send(response, { ok: false }, 403);
        result = Object.values(labProfiles).filter(person => person.active && (canAccessSellerPanel(person) || canAccessAdministration(person))).map(person => ({ id: person.id, name: person.name }));
      } else {
        if (!session) await limitShippingPublic("lab-loopback", { runTransaction: transactionAdapter, env: labEnv });
        result = await shippingOperation({ body, session, runTransaction: transactionAdapter, env: labEnv });
      }
      return send(response, { ok: true, result });
    }
    if (url.pathname.startsWith("/.netlify/functions/")) return send(response, { ok: false, message: "Servicio externo deshabilitado en laboratorio." }, 403);
    if (["/app.js", "/app.js.map", "/app.css", "/app.css.map"].includes(url.pathname)) { response.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : url.pathname.endsWith("map") ? "application/json" : "text/javascript"); return response.end(await readFile(path.join(outdir, url.pathname.slice(1)))); }
    if (url.pathname.startsWith("/images/")) { const target = path.resolve("public", url.pathname.slice(1)); if (!target.startsWith(path.resolve("public") + path.sep)) return send(response, {}, 403); response.setHeader("Content-Type", target.endsWith("svg") ? "image/svg+xml" : target.endsWith("jpeg") || target.endsWith("jpg") ? "image/jpeg" : "image/png"); return response.end(await readFile(target)); }
    response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html);
  } catch (error) { send(response, { ok: false, code: error.code || "lab/error", message: error.message }, Number(error.status) || 500); }
});
await new Promise(resolve => server.listen(port, host, resolve));
console.log(JSON.stringify({ ready: true, url: `http://${host}:${port}/gestion/shipping?qaRole=admin`, projectId, emulatorPort, productionConnections: "blocked", fiscal: "disabled" }));
await writeFile(path.join(outdir, "server.json"), JSON.stringify({ url: `http://${host}:${port}`, projectId, emulatorPort }));
const shutdown = async () => { server.close(); await environment.cleanup(); emulator?.kill(); process.exit(0); };
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
