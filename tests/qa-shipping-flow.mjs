import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(path.resolve(process.env.SHIPPING_QA_NODE_MODULES || "node_modules", "package.json"));
const { chromium } = require("playwright");
const base = "http://127.0.0.1:5174", directory = path.resolve("tmp/shipping-lab/evidence");
await mkdir(directory, { recursive: true });
const state = async () => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(`${base}/__lab/state`), data = await response.json();
    if (response.ok && data.stock) return data;
    if (attempt === 4) throw Error(data.message || "El emulador no devolvió su estado.");
    await new Promise(resolve => setTimeout(resolve, 250));
  }
};
const before = await state(); assert.equal(before.projectId, "demo-flormia-shipping-lab");
if (before.sales.length) throw Error("Reiniciá explícitamente los datos del laboratorio antes de repetir la prueba completa.");
const browser = await chromium.launch({ executablePath: process.env.SHIPPING_QA_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const contexts = [], pages = [], errors = [], externalRequests = [], steps = [];
const record = (step, evidence) => { steps.push({ step, ...evidence }); console.log(JSON.stringify({ step, ...evidence })); };
const actor = async (name, width = 1440) => {
  const context = await browser.newContext({ viewport: { width, height: width < 700 ? 844 : 1000 }, reducedMotion: "reduce" }); contexts.push(context);
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (["127.0.0.1", "localhost"].includes(url.hostname) || ["data:", "blob:"].includes(url.protocol)) return route.continue();
    externalRequests.push(url.origin); return route.abort();
  });
  const page = await context.newPage(); pages.push(page);
  page.on("pageerror", error => errors.push(`${name}: ${error.message}`));
  page.on("console", message => { if (message.type() === "error" && message.text().includes("Maximum update depth")) errors.push(`${name}: render loop`); });
  page.setDefaultTimeout(15000);
  return page;
};
const poll = async (predicate, label) => { for (let attempt = 0; attempt < 60; attempt++) { const result = await state(); if (predicate(result)) return result; await new Promise(resolve => setTimeout(resolve, 100)); } throw Error(`No se verificó: ${label}`); };
const customer = async (page, phone, name, seller = false) => {
  await page.getByRole("button", { name: seller ? "Agregar cliente" : "Cliente", exact: true }).click();
  await page.getByRole("dialog", { name: "Agregar cliente" }).waitFor();
  await page.getByLabel("Teléfono", { exact: false }).fill(phone);
  await page.getByLabel("Nombre (opcional)", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await page.getByRole("dialog", { name: "Agregar cliente" }).waitFor({ state: "hidden" });
};
const detail = async (page, shipmentId) => { await page.goto(`${base}/gestion/shipping?qaRole=admin&shipment=${shipmentId}`); await page.getByRole("dialog").waitFor(); await page.getByText("Local comercial:", { exact: false }).waitFor(); };
const generateAccess = async (page, label) => { await page.getByRole("button", { name: label, exact: true }).click(); const input = page.getByLabel("Enlace autorizado", { exact: true }); await input.waitFor(); const url = await input.inputValue(); assert(url.startsWith(base)); return url; };
let adminPage;
try {
  adminPage = await actor("admin");
  await adminPage.goto(`${base}/gestion/quick-sales?qaRole=admin`);
  await adminPage.getByRole("button", { name: "Canal", exact: true }).click();
  await adminPage.getByLabel("Canal comercial").selectOption("whatsapp");
  await adminPage.getByLabel("Tipo de origen").selectOption("location");
  await adminPage.getByLabel("Origen físico del stock").selectOption("valle");
  await adminPage.getByRole("button", { name: "Confirmar canal y origen" }).click();
  await adminPage.getByRole("button", { name: /Almacén/ }).click();
  await adminPage.getByRole("button", { name: "Agregar Aceite de prueba", exact: true }).click({ clickCount: 2 });
  await customer(adminPage, "11 0000-1001", "Cliente QA Venta Rápida");
  await adminPage.getByRole("button", { name: "Con envío", exact: true }).click();
  await adminPage.getByLabel("Tipo de envío").selectOption("manual");
  await adminPage.getByLabel("Preparación QA", { exact: true }).check();
  await adminPage.getByLabel("Dirección de entrega").fill("Calle de prueba 123, piso 2, CABA");
  await adminPage.getByLabel("Observaciones", { exact: true }).fill("Entrega de prueba. No despachar realmente.");
  await adminPage.screenshot({ path: path.join(directory, "01-venta-rapida-envio.png"), fullPage: true });
  await adminPage.getByRole("button", { name: "Guardar envío" }).click();
  await adminPage.getByRole("button", { name: "Efectivo", exact: true }).click();
  await adminPage.getByRole("button", { name: "Continuar", exact: true }).click();
  let snapshot = await poll(data => data.sales.length === 1 && data.shipments.length === 1, "alta rápida");
  const quick = snapshot.shipments[0];
  assert.deepEqual(snapshot.stock, { valle: 8, infal: 20 }); assert.equal(quick.status, "aprobado"); assert.equal(snapshot.movements.length, 1);
  await adminPage.getByRole("link", { name: "Ver ficha del envío generado" }).waitFor();
  record("venta_rapida_crea_venta_envio_y_descuenta_una_vez", { stock: snapshot.stock, sales: 1, shipments: 1 });

  const sellerPage = await actor("seller");
  await sellerPage.goto(`${base}/vendedor?qaRole=seller`);
  await sellerPage.getByRole("button", { name: /Almacén/ }).click();
  await sellerPage.getByRole("button", { name: /Agregar Aceite de prueba, stock/ }).click({ clickCount: 2 });
  await customer(sellerPage, "11 0000-1002", "Cliente QA Vendedor", true);
  await sellerPage.getByRole("button", { name: "Con envío", exact: true }).click();
  await sellerPage.getByLabel("Dirección de entrega").fill("Avenida de prueba 456, departamento A, CABA");
  await sellerPage.getByRole("button", { name: "Guardar envío" }).click();
  await sellerPage.getByRole("button", { name: "Efectivo", exact: true }).click();
  await sellerPage.screenshot({ path: path.join(directory, "02-panel-vendedor-envio.png"), fullPage: true });
  // A disconnected shipping sale cannot join the presencial offline queue.
  await sellerPage.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }); window.dispatchEvent(new Event("offline")); });
  await sellerPage.getByRole("button", { name: "Envío requiere conexión", exact: true }).click();
  await sellerPage.getByText("Los envíos requieren conexión.", { exact: false }).last().waitFor();
  assert.equal((await state()).sales.length, 1);
  await sellerPage.evaluate(() => { delete navigator.onLine; window.dispatchEvent(new Event("online")); });
  record("envio_vendedor_offline_bloqueado_sin_crear_venta", { sales: 1 });
  await sellerPage.getByRole("button", { name: "Continuar", exact: true }).click();
  await sellerPage.getByRole("dialog", { name: "Venta registrada", exact: true }).waitFor();
  snapshot = await poll(data => data.sales.length === 2 && data.shipments.length === 2, "solicitud vendedor");
  const request = snapshot.shipments.find(row => row.id !== quick.id);
  assert.deepEqual(snapshot.stock, { valle: 8, infal: 20 }); assert.equal(request.stockCommitState, "pending"); assert.equal(request.status, "solicitud_pendiente");
  record("vendedor_registra_solicitud_sin_descontar_stock", { stock: snapshot.stock, status: request.status });
  await sellerPage.getByRole("button", { name: "Ver solicitud de envío", exact: true }).click();
  assert.equal(await sellerPage.getByRole("button", { name: "Aprobar origen y descontar stock" }).count(), 0);
  await sellerPage.screenshot({ path: path.join(directory, "03-solicitud-vendedor-sin-permiso-aprobar.png"), fullPage: true });

  await detail(adminPage, request.id);
  await adminPage.getByRole("button", { name: "Aprobar origen y descontar stock" }).click();
  await adminPage.getByLabel("Origen físico real").selectOption("warehouse:infal");
  await adminPage.getByLabel("Tipo de envío").selectOption("repository");
  await adminPage.getByLabel("Preparación QA", { exact: true }).check();
  await adminPage.screenshot({ path: path.join(directory, "04-aprobacion-desde-infal.png"), fullPage: true });
  await adminPage.getByRole("button", { name: "Confirmar", exact: true }).click();
  snapshot = await poll(data => data.shipments.find(row => row.id === request.id)?.status === "aprobado", "aprobación");
  assert.deepEqual(snapshot.stock, { valle: 8, infal: 18 }); assert.equal(snapshot.movements.length, 2);
  assert.equal(snapshot.sales.find(row => row.id === request.saleId).locationId, "valle");
  assert.equal(snapshot.sales.find(row => row.id === request.saleId).stockOriginId, "infal");
  record("aprobacion_imputa_infal_y_conserva_venta_en_valle", { stock: snapshot.stock, movements: 2 });

  const prep = await actor("preparer", 390);
  await prep.goto(`${base}/vendedor?view=shipping-tasks&qaRole=preparer`);
  await prep.getByRole("heading", { name: "Mis preparaciones y etiquetas", exact: true }).waitFor();
  await prep.getByLabel("Seleccionar todas las asignadas").check();
  await prep.getByRole("button", { name: "Generar PDF A4" }).click();
  await prep.getByRole("heading", { name: "Vista previa · Etiquetas A4" }).waitFor();
  const downloadPromise = prep.waitForEvent("download"); await prep.getByRole("link", { name: "Descargar PDF" }).click();
  await (await downloadPromise).saveAs(path.join(directory, "etiquetas-lote-2.pdf"));
  await prep.keyboard.press("Escape");
  await prep.screenshot({ path: path.join(directory, "05-preparaciones-mobile.png"), fullPage: true });
  for (const shipment of [quick, request]) {
    await prep.goto(`${base}/e/${shipment.publicLookupId}?role=internal&qaRole=preparer`);
    await prep.getByRole("button", { name: "Pedido preparado y listo para retirar", exact: true }).click();
    await poll(data => data.shipments.find(row => row.id === shipment.id)?.status === "listo_retirar", "preparación");
  }
  snapshot = await state(); assert.deepEqual(snapshot.stock, { valle: 8, infal: 18 }); assert.equal(snapshot.movements.length, 2);
  record("preparador_imprime_lote_y_confirma_sin_otro_descuento", { labels: 2, stock: snapshot.stock });

  await detail(adminPage, quick.id);
  const directUrl = await generateAccess(adminPage, "Autorizar repartidor");
  const courier = await actor("courier", 390); await courier.goto(directUrl);
  await courier.getByRole("button", { name: "Confirmar retiro del local/depósito" }).click();
  await courier.getByRole("button", { name: "Confirmar entregado", exact: true }).click();
  await courier.getByText("La geocerca no está configurada.", { exact: false }).waitFor();
  assert.equal((await state()).shipments.find(row => row.id === quick.id).status, "reparto_final");
  await courier.screenshot({ path: path.join(directory, "06-entrega-bloqueada-sin-prueba.png"), fullPage: true });
  await detail(adminPage, quick.id);
  await adminPage.getByRole("button", { name: "Autorizar excepción de entrega" }).click();
  await adminPage.getByLabel(/^Motivo/).fill("Prueba local: recepción supervisada, GPS sin configurar.");
  await adminPage.getByRole("button", { name: "Confirmar", exact: true }).click();
  await courier.getByRole("button", { name: "Confirmar entregado", exact: true }).click();
  await courier.getByText("Entrega confirmada. El seguimiento se detuvo.").waitFor();
  record("reparto_manual_exige_prueba_y_cierra_con_excepcion_supervisada", { status: "entregado" });

  await detail(adminPage, request.id);
  assert(await adminPage.getByRole("button", { name: "Crear enlace para cliente" }).isDisabled());
  const originUrl = await generateAccess(adminPage, "Acceso · origen a repositorio");
  const originCourier = await actor("courier-origin", 390); await originCourier.goto(originUrl);
  assert.equal(await originCourier.getByRole("link", { name: "11 0000-1002", exact: true }).count(), 0);
  assert.equal(await originCourier.getByRole("button", { name: "Permitir ubicación" }).count(), 0);
  await originCourier.getByRole("button", { name: "Confirmar retiro del local/depósito" }).click();
  await originCourier.getByRole("button", { name: "Confirmar llegada al repositorio" }).click();
  await detail(adminPage, request.id);
  const finalUrl = await generateAccess(adminPage, "Acceso · reparto final");
  const finalCourier = await actor("courier-final", 390); await finalCourier.goto(finalUrl);
  await finalCourier.getByRole("button", { name: "Confirmar salida del repositorio" }).click();
  await finalCourier.getByRole("button", { name: "Confirmar entregado", exact: true }).waitFor();
  await detail(adminPage, request.id);
  const trackingUrl = await generateAccess(adminPage, "Crear enlace para cliente");
  const tracking = await actor("customer", 390); await tracking.goto(trackingUrl);
  await tracking.getByRole("heading", { name: "Seguimiento de tu pedido" }).waitFor();
  await tracking.getByText("En reparto", { exact: true }).waitFor();
  assert.equal(await tracking.getByRole("button", { name: /Confirmar/ }).count(), 0);
  await tracking.screenshot({ path: path.join(directory, "07-tracking-cliente-solo-lectura.png"), fullPage: true });
  record("repositorio_separa_dos_tramos_y_activa_tracking_al_salir", { status: "reparto_final", customerWrites: 0 });

  await finalCourier.getByRole("button", { name: "Tengo un problema" }).click();
  await finalCourier.getByLabel("Motivo", { exact: true }).selectOption("Cliente ausente");
  await finalCourier.getByLabel("Detalle", { exact: true }).fill("Incidencia sintética para verificar alerta crítica y recuperación.");
  await finalCourier.getByRole("button", { name: "Informar problema a gestión" }).click();
  snapshot = await poll(data => data.shipments.find(row => row.id === request.id)?.incident, "incidencia crítica");
  assert(snapshot.alerts.some(row => row.severity === "critical" && row.entityId === request.id));
  await detail(adminPage, request.id); await adminPage.screenshot({ path: path.join(directory, "08-incidencia-y-ficha.png"), fullPage: true });
  await adminPage.getByRole("button", { name: "Resolver y reintentar" }).click();
  await adminPage.getByLabel(/^Motivo/).fill("Prueba local: cliente confirmó recepción y se continúa el mismo reparto.");
  await adminPage.getByRole("button", { name: "Confirmar", exact: true }).click();
  await poll(data => data.shipments.find(row => row.id === request.id)?.incident === null, "resolución");
  await adminPage.getByRole("button", { name: "Autorizar excepción de entrega" }).click();
  await adminPage.getByLabel(/^Motivo/).fill("Prueba supervisada sin GPS físico. Cliente de prueba recibió el pedido.");
  await adminPage.getByRole("button", { name: "Confirmar", exact: true }).click();
  await finalCourier.reload(); await finalCourier.getByRole("button", { name: "Confirmar entregado", exact: true }).click();
  await finalCourier.getByText("Entrega confirmada. El seguimiento se detuvo.").waitFor();
  await tracking.reload(); await tracking.getByText("Entregado", { exact: true }).waitFor();
  snapshot = await state(); assert.deepEqual(snapshot.stock, { valle: 8, infal: 18 }); assert.equal(snapshot.movements.length, 2); assert.equal(snapshot.shipments.filter(row => row.status === "entregado").length, 2);
  assert.equal(snapshot.alerts.filter(row => row.severity === "critical" && row.active).length, 0);
  record("incidencia_se_resuelve_entrega_final_y_stock_no_se_repite", { stock: snapshot.stock, sales: 2, delivered: 2, movements: 2 });

  await adminPage.goto(`${base}/gestion/shipping?qaRole=admin`); await adminPage.getByRole("tab", { name: "Todos", exact: true }).click();
  await adminPage.screenshot({ path: path.join(directory, "09-tablero-final.png"), fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  const result = { environment: snapshot.projectId, steps, browserErrors: errors, externalRequests, stock: snapshot.stock, sales: snapshot.sales.length, shipments: snapshot.shipments.length, delivered: 2, stockMovements: snapshot.movements.length, realGpsTested: false, fiscal: "disabled", production: "not contacted" };
  await writeFile(path.join(directory, "full-flow-results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ completed: true, steps: steps.length, directory }));
} catch (error) {
  if (adminPage && !adminPage.isClosed()) { await adminPage.screenshot({ path: path.join(directory, "failure.png"), fullPage: true }).catch(() => {}); }
  await writeFile(path.join(directory, "failure.json"), JSON.stringify({ message: error.message, steps, errors, externalRequests, state: await state() }, null, 2));
  throw error;
} finally { await browser.close(); }
