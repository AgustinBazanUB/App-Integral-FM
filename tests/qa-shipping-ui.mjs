// Isolated UI QA with actual React views and synthetic adapters. Never connects
// to production Firebase, ARCA, messaging or shipping services.
import { build } from "esbuild";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const require = createRequire(path.join(process.env.SHIPPING_QA_NODE_MODULES || "../node_modules", "package.json"));
const { chromium } = require("playwright");
const directory = path.resolve("tmp/shipping-qa/ui");
await mkdir(directory, { recursive: true });
const fixtures = Array.from({ length: 5 }, (_, index) => ({ id: `shipment_${index}`, shippingSchemaVersion: 1, publicCode: `FM-E-PRUEBA${index}`, publicLookupId: `synthetic_lookup_${index}`, saleId: `sale_${index}`, saleCode: `FM-VAL-20261016-000${index}`, createdBy: "seller", customerSnapshot: { name: index ? "Destinatario de prueba" : "Cliente con solicitud pendiente", phone: "11 0000-0000" }, itemsSnapshot: [{ productId: "oil", name: "Aceite de oliva 2 L", qty: 2 }], commercialLocationId: "valle", commercialLocationName: "Local Valle", stockOriginId: index ? "infal" : null, stockOriginType: index ? "warehouse" : null, stockOriginName: index ? "Depósito Infal" : null, stockCommitState: index ? "committed" : "pending", stockCommitMode: "deferred", assignedPreparerIds: index ? ["admin"] : [], preparerNames: index ? ["Preparador de prueba"] : [], status: ["solicitud_pendiente", "en_preparacion", "reparto_final", "entregado", "aprobado"][index], destination: { displayAddress: "Avenida de prueba 1234, piso 2, departamento B, CABA", notes: "Tocar el timbre al llegar", verified: false }, deliveryType: index % 2 ? "manual" : "repository", repository: { displayAddress: "Calle de prueba 321, CABA" }, incident: index === 4 ? { reason: "No hay bolsas/cajas", note: "Caso sintético" } : null, lastPosition: null, events: [{ id: "created", action: "created", createdAt: "2026-10-16T15:00:00Z", actorId: "seller" }], createdAt: "2026-10-16T15:00:00Z", saleCreatedAt: "2026-10-16T15:00:00Z", updatedAt: "2026-10-16T15:00:00Z", deliveredAt: index === 3 ? new Date().toISOString() : null, revision: 0 }));
const mocks = {
  AuthContext: `export const profile={id:'admin',name:'Administración QA',active:true,role:'admin'};export const useAuth=()=>({status:'ready',profile,logout:()=>{}});export const AuthProvider=({children})=>children;`,
  shippingService: `const rows=${JSON.stringify(fixtures)}; const listeners=new Set();const emit=()=>listeners.forEach(fn=>fn());export const subscribeShipments=(profile,notify,onError,assigned)=>{const fn=()=>notify(rows.filter(row=>!assigned||row.assignedPreparerIds.includes(profile.id)));listeners.add(fn);fn();return()=>listeners.delete(fn)};
    export const shippingRequest=async body=>{if(body.mode==='resources')return[{id:'admin',name:'Preparador de prueba'}];const row=rows.find(row=>row.id===body.shipmentId)||rows[1];if(body.mode==='detail')return structuredClone(row);if(body.mode==='labels')return{shipment:structuredClone(row)};if(body.mode==='approve'){row.status='aprobado';row.stockCommitState='committed';row.stockOriginName='Depósito Infal';row.assignedPreparerIds=['admin'];row.preparerNames=['Preparador de prueba'];row.deliveryType=body.deliveryType;row.revision++;emit();return{id:row.id}};return{id:row.id}};export const shippingAction=(shipmentId,mode,data={})=>shippingRequest({shipmentId,mode,...data});export const issueShippingAccess=async()=>({url:location.origin+'/reparto#synthetic',expiresAt:'2026-10-16T22:00:00Z'});`,
  sharedResources: `export const listLocationsShared=async()=>[{id:'valle',name:'Local Valle',active:true}];export const listMasterProductsShared=async()=>[{id:'oil',name:'Aceite de oliva 2 L',active:true,defaultPrice:1000,categoryId:'food',categoryName:'Almacén'}];export const listDiscountsShared=async()=>[];export const listProductCategoriesShared=async()=>[{id:'food',name:'Almacén'}];`,
  inventoryService: `export const listWarehouses=async()=>[{id:'infal',name:'Depósito Infal',active:true}];export const listQuickSaleStock=async()=>[{id:'oil',productId:'oil',productName:'Aceite de oliva 2 L',currentStock:10,active:true,price:1000}];`,
  managementService: `export const createQuickSale=async()=>({id:'sale-qa',saleCode:'FM-QA',shipmentId:'shipment_1',total:2000});`,
  customerService: `export const listActiveCustomerZones=async()=>[];export const findCustomerByPhone=async()=>null;`,
  arcaService: `export const lookupArcaBillingReceiver=async()=>null;export const validateArcaInvoiceDraft=async()=>{throw Error('ARCA deshabilitada en QA')};export const requestPendingArcaInvoice=async()=>{throw Error('ARCA deshabilitada en QA')};`,
  SaleInvoicePanel: `export default()=>null;`, ArcaInvoicePrintAction: `export default()=>null;`,
};
await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{RouterProvider}from'./src/router';import ShippingPage from './src/gestion/pages/ShippingPage';import QuickSalesPage from './src/gestion/pages/QuickSalesPage';import ShippingPublicApp from './src/gestion/shipping/ShippingPublicApp';import '@fontsource/inter/latin-400.css';import '@fontsource/inter/latin-600.css';import '@fontsource/cormorant-garamond/latin-600.css';import './src/styles.css';import './src/styles/tokens.css';import './src/styles/theme.css';import './src/styles/management.css';import './src/styles/responsive.css';import './src/gestion/styles/quick-sales.css';document.body.className='fm-management-body';createRoot(document.getElementById('root')).render(<RouterProvider><div style={{padding:24,maxWidth:1500,margin:'auto'}}><p>QA LOCAL · DATOS SINTÉTICOS · SIN SERVICIOS PRODUCTIVOS</p>{location.pathname.includes('quick-sales')?<QuickSalesPage/>:location.pathname.startsWith('/e/')||location.pathname==='/reparto'?<ShippingPublicApp/>:<ShippingPage/>}</div></RouterProvider>);`, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, external: ["/images/*"], outdir: directory, entryNames: "app", format: "esm", jsx: "automatic", define: { "import.meta.env": "{}" }, loader: { ".woff": "dataurl", ".woff2": "dataurl" }, plugins: [{ name: "shipping-qa-mocks", setup(builder) {
  builder.onResolve({ filter: /(?:AuthContext|shippingService|sharedResources|inventoryService|managementService|customerService|arcaService|SaleInvoicePanel|ArcaInvoicePrintAction)$/ }, args => ({ path: args.path.split("/").at(-1), namespace: "mock" }));
  builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "jsx" }));
} }] });
const html = '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script></html>';
const server = createServer(async (req, res) => { try { const pathname = new URL(req.url, "http://localhost").pathname; if (pathname === "/app.js" || pathname === "/app.css") { res.setHeader("Content-Type", pathname.endsWith("css") ? "text/css" : "text/javascript"); res.end(await readFile(path.join(directory, pathname.slice(1)))); } else if (pathname.startsWith("/images/")) { const target = path.resolve("public", pathname.slice(1)); if (!target.startsWith(path.resolve("public") + path.sep)) throw Error(); res.setHeader("Content-Type", "image/svg+xml"); res.end(await readFile(target)); } else { res.setHeader("Content-Type", "text/html"); res.end(html); } } catch { res.statusCode = 404; res.end(); } });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.SHIPPING_QA_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [], checks = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/gestion/shipping`); await page.getByRole("heading", { name: "Gestión de envíos", exact: true }).waitFor();
  await page.screenshot({ path: path.join(directory, "desktop.png"), fullPage: true });
  await page.getByRole("tab", { name: "Solicitudes del vendedor", exact: true }).click();
  await page.getByRole("button", { name: "Ver detalle" }).first().click();
  await page.getByRole("button", { name: "Aprobar origen y descontar stock", exact: true }).click();
  await page.getByLabel("Origen físico real").selectOption("warehouse:infal");
  await page.getByLabel("Tipo de envío").selectOption("manual");
  await page.getByLabel("Preparador de prueba", { exact: true }).check();
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await page.getByText("Imputado una vez", { exact: false }).waitFor(); checks.push("approve_actual_origin_form");
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.getByRole("tab", { name: "Mis preparaciones y etiquetas", exact: true }).click();
  await page.getByLabel("Seleccionar todas las asignadas").check();
  await page.getByRole("button", { name: "Generar PDF A4" }).click();
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
  await page.goto(`${base}/e/synthetic_lookup_1`); await page.getByRole("heading", { name: "Panel del repartidor" }).waitFor();
  await page.screenshot({ path: path.join(directory, "qr-mobile.png"), fullPage: true });
  await page.getByRole("heading", { name: "Autorizar este reparto" }).waitFor(); checks.push("qr_requires_courier_credential");
  assert.deepEqual(errors, []);
  const result = { checks, browserErrors: errors, output: directory };
  await writeFile(path.join(directory, "results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
