
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Marketing enlaza la ruta canónica de WhatsApp y no automatiza WhatsApp Web", async () => {
  const [router, generic, page] = await Promise.all([
    read("src/gestion/ManagementApp.jsx"),
    read("src/gestion/pages/GenericModulePage.jsx"),
    read("src/gestion/pages/WhatsAppCampaignsPage.jsx"),
  ]);
  assert.match(router, /marketing.*whatsapp/s);
  assert.match(generic, /\/gestion\/marketing\/whatsapp/);
  assert.match(page, /Campañas y mensajes masivos/);
  assert.doesNotMatch(page, /querySelector\(|WhatsApp Web.*selector/i);
});

test("contrato es versionado, valida origen y no usa wildcard", async () => {
  const bridge = await read("src/gestion/marketing/whatsapp/extensionBridge.js");
  assert.match(bridge, /WHATSAPP_PROTOCOL_VERSION/);
  assert.match(bridge, /event\.origin !== window\.location\.origin/);
  assert.match(bridge, /window\.postMessage\(envelope, window\.location\.origin/);
  assert.doesNotMatch(bridge, /postMessage\([^\n]+["']\*["']/);
});

test("imágenes se serializan como dataBase64 para la extensión y no se persisten", async () => {
  const [bridge, service] = await Promise.all([
    read("src/gestion/marketing/whatsapp/extensionBridge.js"),
    read("src/gestion/marketing/whatsapp/campaignService.js"),
  ]);
  assert.match(bridge, /arrayBuffer\(\)/);
  assert.match(bridge, /dataBase64:\s*arrayBufferToBase64/);
  assert.doesNotMatch(service, /base64|imageData|ArrayBuffer/i);
  assert.match(service, /imageMetadata/);
});

test("recipients vive en subcolección y usa batches acotados", async () => {
  const service = await read("src/gestion/marketing/whatsapp/campaignService.js");
  assert.match(service, /"whatsappCampaigns", campaignId, "recipients"/);
  assert.match(service, /CHUNK_SIZE = 350/);
  assert.doesNotMatch(service, /recipients:\s*input\.recipients/);
});

test("Excel se procesa localmente y sólo acepta xlsx", async () => {
  const importer = await read("src/gestion/marketing/whatsapp/excelImport.js");
  assert.match(importer, /read-excel-file\/browser/);
  assert.match(importer, /\.xlsx/);
  assert.doesNotMatch(importer, /Firebase|Storage|uploadBytes/);
});

test("permisos WhatsApp están integrados al módulo marketing", async () => {
  const permissions = await read("src/gestion/permissions.js");
  for (const action of ["whatsappView", "whatsappCreateCampaign", "whatsappSendToExtension", "whatsappCancelCampaign", "whatsappViewHistory", "whatsappImportExcel"]) {
    assert.match(permissions, new RegExp(action));
  }
});


test("WhatsApp no hereda permisos genéricos de create/edit y el Excel tiene vista previa", async () => {
  const [service, page, generic] = await Promise.all([
    read("src/gestion/marketing/whatsapp/campaignService.js"),
    read("src/gestion/pages/WhatsAppCampaignsPage.jsx"),
    read("src/gestion/pages/GenericModulePage.jsx"),
  ]);
  assert.doesNotMatch(service, /whatsappCreateCampaign[^\n]+marketing\", \"create/);
  assert.doesNotMatch(service, /whatsappSendToExtension[^\n]+marketing\", \"edit/);
  assert.match(page, /fm-wa-excel-preview/);
  assert.match(generic, /whatsappView/);
});

test("progreso repetido no crea auditoría en cada tick y existe evento started explícito", async () => {
  const [service, bridge] = await Promise.all([
    read("src/gestion/marketing/whatsapp/campaignService.js"),
    read("src/gestion/marketing/whatsapp/extensionBridge.js"),
  ]);
  assert.match(service, /const statusChanged = current\.status !== status/);
  assert.match(service, /if \(statusChanged\)/);
  assert.match(bridge, /FLORMIA_CAMPAIGN_STARTED/);
  assert.match(bridge, /FLORMIA_CAMPAIGN_START/);
  assert.match(service, /extensionCampaignCounters\(message\.payload, current\)/);
});
