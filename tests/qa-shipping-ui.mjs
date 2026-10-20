// Isolated UI QA with actual React views and synthetic adapters. Never connects
// to production Firebase, ARCA, messaging or shipping services.
import { build } from "esbuild";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const require = createRequire(path.resolve(process.env.SHIPPING_QA_NODE_MODULES || "node_modules", "package.json"));
const directory = path.resolve("tmp/shipping-qa/ui");
await mkdir(directory, { recursive: true });
const fixtureNow = new Date().toISOString();
const fixtures = Array.from({ length: 5 }, (_, index) => ({ id: `shipment_${index}`, shippingSchemaVersion: 1, publicCode: `FM-E-PRUEBA${index}`, publicLookupId: `synthetic_lookup_${index}`, saleId: `sale_${index}`, saleCode: `FM-VAL-20261020-000${index}`, createdBy: "seller", customerSnapshot: { name: index ? "Destinatario de prueba" : "Cliente con solicitud pendiente", phone: "11 0000-0000" }, itemsSnapshot: [{ productId: "oil", name: "Aceite de oliva 2 L", qty: 2 }], commercialLocationId: "valle", commercialLocationName: "Local Valle", stockOriginId: index ? "infal" : null, stockOriginType: index ? "warehouse" : null, stockOriginName: index ? "Depósito Infal" : null, stockCommitState: index ? "committed" : "pending", stockCommitMode: "deferred", assignedPreparerIds: index ? ["admin"] : [], preparerNames: index ? ["Preparador de prueba"] : [], status: ["solicitud_pendiente", "en_preparacion", "reparto_final", "entregado", "aprobado"][index], destination: { displayAddress: "Avenida de prueba 1234, piso 2, departamento B, CABA", notes: "Tocar el timbre al llegar", verified: false }, deliveryType: index % 2 ? "manual" : "repository", repository: { displayAddress: "Calle de prueba 321, CABA" }, incident: index === 4 ? { reason: "No hay bolsas/cajas", note: "Caso sintético" } : null, lastPosition: null, events: [{ id: "created", action: "created", createdAt: fixtureNow, actorId: "seller" }], createdAt: fixtureNow, saleCreatedAt: fixtureNow, updatedAt: fixtureNow, deliveredAt: index === 3 ? new Date().toISOString() : null, revision: 0 }));
const mocks = {
  AuthContext: `export const profile={id:'admin',name:'Administración QA',active:true,role:'admin'};export const useAuth=()=>({status:'ready',profile,logout:()=>{}});export const AuthProvider=({children})=>children;`,
  shippingService: `const rows=${JSON.stringify(fixtures)}; const listeners=new Set();const emit=()=>listeners.forEach(fn=>fn());export const subscribeShipments=(profile,notify,onError,assigned)=>{const fn=()=>notify(rows.filter(row=>!assigned||row.assignedPreparerIds.includes(profile.id)));listeners.add(fn);fn();return()=>listeners.delete(fn)};
    export const shippingRequest=async body=>{if(body.mode==='resources')return[{id:'admin',name:'Preparador de prueba'}];const row=rows.find(row=>row.id===body.shipmentId||body.lookupId&&row.publicLookupId===body.lookupId)||(body.token?rows[2]:rows[1]);if(body.mode==='tracking'){if(window.__failTrackingRefresh)throw Error('Tracking refresh unavailable');if(window.__invalidateTracking)throw Object.assign(Error('Tracking access expired'),{status:403});const status=window.__trackingStatus||rows[2].status;const hasIncident=window.__trackingIncident===true;return{code:rows[2].publicCode,status,deliveryType:window.__trackingDeliveryType||rows[2].deliveryType,label:hasIncident?'Flor Mía está revisando una incidencia del envío.':status==='entregado'?'Entregado':status==='reparto_final'?'En camino a tu domicilio':'Estado de prueba',hasIncident,updatedAt:new Date().toISOString(),illustrationMessage:'La ilustración muestra etapas confirmadas y no una ubicación real.'};}
if(body.mode==='detail'){if(body.token)return{...structuredClone(row),customerName:row.customerSnapshot.name,leg:row.deliveryType==='repository'?'final':'direct',accessExpiresAt:new Date(Date.now()+3600000).toISOString(),action:row.status==='listo_retirar'?{action:'pickup',label:'Confirmar recepción'}:row.status==='reparto_final'?{action:'deliver',label:'Confirmar entrega'}:null};return structuredClone(row);}
if(body.mode==='ready'){row.status='listo_retirar';row.revision++;emit();return{id:row.id};}
if(body.mode==='incident'){row.incident={reason:body.reason,note:body.note};row.revision++;emit();return{id:row.id};}
if(body.mode==='courier_action'){row.status=body.action==='pickup'?'reparto_final':'entregado';row.revision++;emit();return{id:row.id};}if(['gps_start','gps_stop','position'].includes(body.mode))throw Error('GPS endpoint disabled in QA');if(body.mode==='labels')return{shipment:structuredClone(row)};if(body.mode==='approve'){row.status='aprobado';row.stockCommitState='committed';row.stockOriginName='Depósito Infal';row.assignedPreparerIds=['admin'];row.preparerNames=['Preparador de prueba'];row.deliveryType=body.deliveryType;row.revision++;emit();return{id:row.id}};return{id:row.id}};export const shippingAction=(shipmentId,mode,data={})=>shippingRequest({shipmentId,mode,...data});export const issueShippingAccess=async()=>({url:location.origin+'/reparto#synthetic',expiresAt:'2026-10-16T22:00:00Z'});export const createCourierRouteAccess=async()=>({url:location.origin+'/reparto#synthetic',expiresAt:'2026-10-16T22:00:00Z',shipmentIds:[]});export const createCourierQrAccess=async({sessionId,token})=>{rows[1].status='listo_retirar';return{sessionId,shipmentIds:['shipment_1'],expiresAt:new Date(Date.now()+3600000).toISOString(),token}};export const subscribeShippingShipment=(shipmentId,notify)=>{notify(structuredClone(rows.find(row=>row.id===shipmentId)));return()=>{}};export const subscribeCourierSession=(sessionId,notify)=>{notify(null);return()=>{}};`,
  sharedResources: `export const listLocationsShared=async()=>[{id:'valle',name:'Local Valle',active:true}];export const listMasterProductsShared=async()=>[{id:'oil',name:'Aceite de oliva 2 L',active:true,defaultPrice:1000,categoryId:'food',categoryName:'Almacén'}];export const listDiscountsShared=async()=>[];export const listProductCategoriesShared=async()=>[{id:'food',name:'Almacén'}];`,
  inventoryService: `export const listWarehouses=async()=>[{id:'infal',name:'Depósito Infal',active:true}];export const listQuickSaleStock=async()=>[{id:'oil',productId:'oil',productName:'Aceite de oliva 2 L',currentStock:10,active:true,price:1000}];`,
  managementService: `export const createQuickSale=async()=>({id:'sale-qa',saleCode:'FM-QA',shipmentId:'shipment_1',total:2000});`,
  customerService: `export const listActiveCustomerZones=async()=>[];export const findCustomerByPhone=async()=>null;`,
  arcaService: `export const lookupArcaBillingReceiver=async()=>null;export const validateArcaInvoiceDraft=async()=>{throw Error('ARCA deshabilitada en QA')};export const requestPendingArcaInvoice=async()=>{throw Error('ARCA deshabilitada en QA')};`,
  SaleInvoicePanel: `export default()=>null;`, ArcaInvoicePrintAction: `export default()=>null;`,
};
  await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{RouterProvider}from'./src/router';import ShippingPage from './src/gestion/pages/ShippingPage';import QuickSalesPage from './src/gestion/pages/QuickSalesPage';import ShippingPublicApp from './src/gestion/shipping/ShippingPublicApp';import '@fontsource/inter/latin-400.css';import '@fontsource/inter/latin-600.css';import '@fontsource/cormorant-garamond/latin-600.css';import './src/styles.css';import './src/styles/tokens.css';import './src/styles/theme.css';import './src/styles/management.css';import './src/styles/responsive.css';import './src/gestion/styles/quick-sales.css';document.body.className='fm-management-body';createRoot(document.getElementById('root')).render(<RouterProvider><div style={{padding:24,maxWidth:1500,margin:'auto'}}><p>QA LOCAL · DATOS SINTÉTICOS · SIN SERVICIOS PRODUCTIVOS</p>{location.pathname.includes('quick-sales')?<QuickSalesPage/>:location.pathname.startsWith('/e/')||location.pathname==='/reparto'||location.pathname==='/seguimiento'?<ShippingPublicApp/>:<ShippingPage/>}</div></RouterProvider>);`, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, external: ["/images/*"], outdir: directory, entryNames: "app", format: "esm", jsx: "automatic", define: { "import.meta.env": "{}" }, loader: { ".woff": "dataurl", ".woff2": "dataurl", ".png": "dataurl" }, plugins: [{ name: "shipping-qa-mocks", setup(builder) {
  builder.onResolve({ filter: /(?:AuthContext|shippingService|sharedResources|inventoryService|managementService|customerService|arcaService|SaleInvoicePanel|ArcaInvoicePrintAction)$/ }, args => ({ path: args.path.split("/").at(-1), namespace: "mock" }));
  builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "jsx" }));
} }] });
const html = '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script></html>';
if (process.argv.includes("--build-only")) { console.log("Shipping UI laboratory bundle ready; no browser started."); process.exit(0); }
const server = createServer(async (req, res) => { try { const pathname = new URL(req.url, "http://localhost").pathname; if (pathname === "/app.js" || pathname === "/app.css") { res.setHeader("Content-Type", pathname.endsWith("css") ? "text/css" : "text/javascript"); res.end(await readFile(path.join(directory, pathname.slice(1)))); } else if (pathname.startsWith("/images/")) { const target = path.resolve("public", pathname.slice(1)); if (!target.startsWith(path.resolve("public") + path.sep)) throw Error(); res.setHeader("Content-Type", "image/svg+xml"); res.end(await readFile(target)); } else { res.setHeader("Content-Type", "text/html"); res.end(html); } } catch { res.statusCode = 404; res.end(); } });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
if (process.argv.includes("--serve")) { console.log(JSON.stringify({ base, data: "synthetic", productionWrites: 0 })); await new Promise(() => {}); }
const { chromium } = require("playwright");
const browser = await chromium.launch({ executablePath: process.env.SHIPPING_QA_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [], checks = []; let tileRequests = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => { Object.defineProperty(navigator, "geolocation", { configurable: true, value: { watchPosition(success) { window.__gpsCalls = (window.__gpsCalls || 0) + 1; window.__gpsWatchCalls = (window.__gpsWatchCalls || 0) + 1; setTimeout(() => success({ coords: { latitude: -34.6, longitude: -58.4, accuracy: 12 }, timestamp: Date.now() }), 50); return 1; }, clearWatch() { window.__gpsCalls = (window.__gpsCalls || 0) + 1; }, getCurrentPosition(success) { window.__gpsCalls = (window.__gpsCalls || 0) + 1; setTimeout(() => success({ coords: { latitude: -34.6, longitude: -58.4, accuracy: 12 }, timestamp: Date.now() }), 50); } } }); });
  await page.route("https://tile.openstreetmap.org/**", route => { tileRequests++; return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Z9sAAAAASUVORK5CYII=", "base64") }); });
  await page.goto(`${base}/gestion/shipping`); await page.getByRole("heading", { name: "Gestión de envíos", exact: true }).waitFor();
  assert.equal(await page.getByRole("tab", { name: "Todos", exact: true }).getAttribute("aria-selected"), "true");
  assert.equal(await page.locator(".fm-data-table tbody tr").count(), 5); checks.push("dashboard_defaults_to_all_shipments_this_week");
  await page.screenshot({ path: path.join(directory, "desktop.png"), fullPage: true });
  assert.equal(await page.getByRole("button", { name: "Ver detalle" }).count(), 0);
  await page.getByRole("button", { name: /Filtrar envíos/ }).click();
  assert.equal(await page.getByLabel("Período").evaluate(element => element.value), "week");
  await page.getByLabel("Período").selectOption("all"); assert.equal(await page.locator(".fm-data-table tbody tr").count(), 5);
  await page.getByRole("button", { name: "Restablecer filtros" }).click(); checks.push("dashboard_collapsible_date_and_address_filters");
  await page.getByRole("button", { name: /Filtrar envíos/ }).click();
  await page.getByRole("row").filter({ hasText: "FM-E-PRUEBA2" }).click();
  await page.getByRole("heading", { name: "Envío para Destinatario de prueba", exact: true }).waitFor();
  await page.getByRole("button", { name: "Ver acciones" }).click();
  await page.getByText("Marcar como no entregado", { exact: true }).waitFor();
  assert.equal(await page.locator(".fm-delivery-journey").count(), 1);
  assert.equal(await page.locator(".leaflet-container").count(), 0);
  await page.screenshot({ path: path.join(directory, "detail-actions.png"), fullPage: true });
  checks.push("admin_detail_shows_state_illustration_without_map");
  await page.getByRole("button", { name: /Gestión de envíos/ }).click();
  await page.getByRole("tab", { name: /^Solicitudes del vendedor/ }).click();
  await page.getByLabel("Origen físico real").selectOption("warehouse:infal");
  await page.getByLabel("Tipo de envío").selectOption("manual");
  await page.getByLabel("Preparador de prueba", { exact: true }).check();
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await page.getByRole("heading", { name: "Todo al día", exact: true }).waitFor(); checks.push("approve_actual_origin_form");
  await page.getByRole("tab", { name: "Mis preparaciones y etiquetas", exact: true }).click();
  await page.getByLabel("Seleccionar todas las asignadas").check();
  await page.getByRole("button", { name: "Imprimir selección en A4" }).click();
  await page.getByRole("heading", { name: "Vista previa · Etiquetas A4" }).waitFor(); checks.push("assigned_batch_pdf_preview");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0); checks.push("dialog_escape");
  await page.getByRole("tab", { name: "Tablero", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(directory, "mobile.png"), fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); checks.push("mobile_no_page_overflow");
  await page.goto(`${base}/gestion/quick-sales`); await page.getByRole("button", { name: "Con envío", exact: true }).click();
  await page.getByLabel("Tipo de envío").selectOption("manual"); await page.getByLabel("Preparador de prueba", { exact: true }).check();
  await page.getByLabel("Dirección de entrega", { exact: false }).fill("Calle de prueba 123, CABA");
  await page.screenshot({ path: path.join(directory, "quick-sale-modal-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Guardar envío" }).click(); await page.getByRole("button", { name: "Con envío · editar" }).waitFor(); checks.push("existing_quick_sale_shipping_modal");
  await page.goto(`${base}/e/synthetic_lookup_1`); await page.getByRole("heading", { name: "¿Cómo querés continuar?" }).waitFor();
  await page.screenshot({ path: path.join(directory, "qr-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: /Soy repartidor/ }).click(); await page.getByRole("heading", { name: "Envío para Destinatario de prueba" }).waitFor();
  assert.equal(await page.getByLabel("Enlace o código temporal").count(), 0); checks.push("printed_courier_qr_needs_no_manual_code");
  await page.getByRole("button", { name: "Confirmar que recibí el paquete" }).click();
  await page.getByText("El pedido salió de Flor Mía y va hacia tu domicilio.").waitFor();
  assert.equal(await page.evaluate(() => window.__gpsWatchCalls || 0), 0);
  assert.equal(await page.getByRole("button", { name: /ubicación|GPS/i }).count(), 0);
  checks.push("courier_confirms_stage_without_requesting_gps");
  await page.goto(`${base}/seguimiento#synthetic_tracking_credential_12345678901234567890`);
  await page.getByRole("heading", { name: "Tu pedido está en camino" }).waitFor();
  await page.locator(".fm-delivery-journey").waitFor();
  assert.equal(await page.locator(".leaflet-container").count(), 0);
  assert.equal(await page.getByText(/Precisión GPS|Ubicación en vivo|última ubicación/i).count(), 0);
  assert.equal(await page.evaluate(() => window.__gpsWatchCalls || 0), 0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await page.locator(".fm-delivery-journey__scene").count(), 1);
  const stageShots = [
    ["manual", "aprobado", "received", 0], ["manual", "en_preparacion", "preparing", 25], ["manual", "listo_retirar", "ready", 50], ["manual", "reparto_final", "to-customer", 75], ["manual", "entregado", "delivered", 100],
    ["repository", "hacia_repositorio", "to-repository", 50], ["repository", "recibido_repositorio", "at-repository", 67], ["repository", "reparto_final", "to-customer", 83], ["repository", "entregado", "delivered", 100],
  ];
  for (const [type, status, scene, progress] of stageShots) {
    await page.evaluate(([deliveryType, nextStatus]) => { window.__trackingDeliveryType = deliveryType; window.__trackingStatus = nextStatus; window.dispatchEvent(new Event("focus")); }, [type, status]);
    const journey = page.locator(`.fm-delivery-journey[data-stage="${scene}"]`);
    await journey.waitFor();
    assert.equal(await journey.getByRole("progressbar").getAttribute("aria-valuenow"), String(progress));
    await journey.screenshot({ path: path.join(directory, `journey-${type}-${status}.png`) });
  }
  await page.evaluate(() => { window.__trackingDeliveryType = "manual"; window.__trackingStatus = "reparto_final"; window.dispatchEvent(new Event("focus")); });
  await page.getByRole("heading", { name: "Tu pedido está en camino" }).waitFor();
  await page.screenshot({ path: path.join(directory, "customer-journey-mobile.png"), fullPage: true });
  await page.evaluate(() => { window.__trackingDeliveryType = "manual"; window.__trackingStatus = "reparto_final"; window.__trackingIncident = true; window.dispatchEvent(new Event("focus")); });
  await page.getByRole("heading", { name: "Estamos revisando tu envío" }).waitFor();
  assert.equal(await page.locator('.fm-delivery-journey[data-exception="true"]').count(), 1);
  assert.equal(await page.locator(".fm-journey__motorcycle.is-moving").count(), 0);
  await page.locator(".fm-delivery-journey").screenshot({ path: path.join(directory, "journey-incident-paused.png") });
  await page.evaluate(() => { window.__trackingIncident = false; window.__trackingStatus = "no_entregado"; window.dispatchEvent(new Event("focus")); });
  await page.getByRole("heading", { name: "No pudimos entregar tu pedido" }).waitFor();
  assert.equal(await page.locator(".fm-delivery-journey[data-stage=\"paused\"] .fm-journey__motorcycle.is-moving").count(), 0);
  await page.screenshot({ path: path.join(directory, "journey-delivery-failed-mobile.png"), fullPage: true });
  checks.push("customer_tracking_updates_confirmed_direct_and_repository_stages");
  checks.push("customer_tracking_pauses_on_incidents_and_delivery_failures");
  await page.evaluate(() => { window.__failTrackingRefresh = true; window.dispatchEvent(new Event("focus")); });
  await page.getByText("No pudimos actualizar el seguimiento. Te mostramos el último estado confirmado.").waitFor();
  assert.equal(await page.locator(".fm-delivery-journey").count(), 1, "the last confirmed journey should remain visible during a refresh failure");
  await page.evaluate(() => { window.__failTrackingRefresh = false; window.dispatchEvent(new Event("focus")); });
  await page.getByText("No pudimos actualizar el seguimiento. Te mostramos el último estado confirmado.").waitFor({ state: "detached" });
  await page.evaluate(() => { window.__invalidateTracking = true; window.dispatchEvent(new Event("focus")); });
  await page.getByText("Tracking access expired").waitFor();
  assert.equal(await page.locator(".fm-delivery-journey").count(), 0, "a revoked or expired public link must clear cached shipment data");
  assert.equal(await page.evaluate(() => window.__gpsCalls || 0), 0, "customer and courier views must not call any geolocation method");
  assert(tileRequests === 0, "tracking and admin status views must not load map tiles");
  checks.push("customer_state_illustration_has_no_map_or_gps_and_supports_reduced_motion");
  checks.push("customer_tracking_keeps_last_confirmed_state_when_refresh_fails");
  checks.push("customer_tracking_clears_state_when_public_access_is_revoked");
  assert.deepEqual(errors, []);
  const result = { checks, browserErrors: errors, output: directory };
  await writeFile(path.join(directory, "results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
