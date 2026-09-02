import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  customerDocumentId,
  normalizeCustomerPhone,
} from "../src/gestion/customers/customerDomain.js";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("WhatsApp phone variants resolve to the same existing CRM identity", async () => {
  const variants = [
    "+54 9 11 1234-5678",
    "5491112345678",
    "11-1234-5678",
  ];
  const normalized = variants.map(normalizeCustomerPhone);
  assert.deepEqual(normalized, ["1112345678", "1112345678", "1112345678"]);
  const ids = await Promise.all(variants.map(customerDocumentId));
  assert.equal(new Set(ids).size, 1);
});

test("Inbox uses its own bounded Web App channel instead of the campaign channel", async () => {
  const bridge = await source("src/gestion/social/whatsapp/inboxBridge.js");
  assert.match(bridge, /flor_mia_whatsapp_inbox_extension/);
  assert.doesNotMatch(bridge, /FLORMIA_CAMPAIGN_PREPARE/);
  assert.match(bridge, /4096/);
  assert.match(bridge, /INBOX_BRIDGE_NOT_AVAILABLE/);
});

test("Inbox CRM reuses the existing customer services and does not import Firebase directly", async () => {
  const page = await source("src/gestion/pages/WhatsAppInboxPage.jsx");
  assert.match(page, /findCustomerByPhone/);
  assert.match(page, /saveCustomerFromAdmin/);
  assert.match(page, /updateCustomerFromAdmin/);
  assert.match(page, /listActiveCustomerZones/);
  assert.doesNotMatch(page, /from ["']firebase\//);
  assert.doesNotMatch(page, /collection\([^)]*messages/i);
});

test("Redes Sociales routes WhatsApp separately from mass campaigns", async () => {
  const router = await source("src/gestion/ManagementApp.jsx");
  const preload = await source("src/gestion/routePreload.js");
  const socialPage = await source("src/gestion/pages/GenericModulePage.jsx");
  assert.match(router, /socialWhatsappPath/);
  assert.match(router, /<WhatsAppInboxPage/);
  assert.match(preload, /socialWhatsapp/);
  assert.match(socialPage, /\/gestion\/social\/whatsapp/);
  assert.match(router, /<WhatsAppCampaignsPage/);
  assert.match(socialPage, /\/gestion\/marketing\/whatsapp/);
});

test("Inbox filters are local and include unread, no-zone and new contacts", async () => {
  const page = await source("src/gestion/pages/WhatsAppInboxPage.jsx");
  assert.match(page, /id: "unread"/);
  assert.match(page, /id: "no-zone"/);
  assert.match(page, /id: "new"/);
  assert.match(page, /customerZoneLabel/);
  assert.doesNotMatch(page, /setInterval\s*\(/);
});
