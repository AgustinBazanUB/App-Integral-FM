import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Marketing conserva WhatsApp y agrega acceso separado a Meta Ads", async () => {
  const source = await read("src/gestion/pages/GenericModulePage.jsx");
  assert.match(source, /\/gestion\/marketing\/whatsapp/);
  assert.match(source, /\/gestion\/marketing\/meta-ads/);
  assert.match(source, /Meta Ads/);
});

test("routing lazy incluye Meta Ads sin reemplazar WhatsApp", async () => {
  const [app, preload] = await Promise.all([
    read("src/gestion/ManagementApp.jsx"),
    read("src/gestion/routePreload.js"),
  ]);
  assert.match(app, /marketingMetaAds/);
  assert.match(app, /pathParts\[2\] === "meta-ads"/);
  assert.match(app, /WhatsAppCampaignsPage/);
  assert.match(preload, /MetaAdsPage/);
  assert.match(preload, /WhatsAppCampaignsPage/);
});

test("página Meta Ads expone flujo real de CampaignProject sin integración Meta ficticia", async () => {
  const source = await read("src/gestion/pages/MetaAdsPage.jsx");
  assert.match(source, /Nueva campaña/);
  assert.match(source, /Cargar más/);
  assert.match(source, /Meta todavía no está conectado/);
  assert.match(source, /Archivar campaña/);
});
