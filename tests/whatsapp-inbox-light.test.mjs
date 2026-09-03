import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  customerDocumentId,
  isValidCustomerPhone,
  normalizeCustomerPhone,
} from "../src/gestion/customers/customerDomain.js";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("Argentine WhatsApp phone variants resolve to the same existing CRM identity", async () => {
  const variants = [
    "+54 9 11 1234-5678",
    "+5491112345678",
    "11 1234 5678",
    "011 1234-5678",
    "+54 11 1234 5678",
    "(11) 1234-5678",
  ];
  const normalized = variants.map(normalizeCustomerPhone);
  assert.deepEqual(normalized, Array(variants.length).fill("1112345678"));
  const ids = await Promise.all(variants.map(customerDocumentId));
  assert.equal(new Set(ids).size, 1);
});

test("phone normalization keeps the existing CRM policy for invalid and foreign values", () => {
  assert.equal(normalizeCustomerPhone("---"), "");
  assert.equal(isValidCustomerPhone("11 12"), false);
  assert.equal(normalizeCustomerPhone("+1 212 555 1234"), "12125551234");
  assert.equal(isValidCustomerPhone("+1 212 555 1234"), true);
});

test("Inbox uses its own bounded Web App channel instead of the campaign channel", async () => {
  const bridge = await source("src/gestion/social/whatsapp/inboxBridge.js");
  assert.match(bridge, /flor_mia_whatsapp_inbox_extension/);
  assert.doesNotMatch(bridge, /FLORMIA_CAMPAIGN_PREPARE/);
  assert.match(bridge, /4096/);
  assert.match(bridge, /INBOX_BRIDGE_NOT_AVAILABLE/);
});

test("Inbox CRM batches lookups and reuses concurrent-safe customer services", async () => {
  const page = await source("src/gestion/pages/WhatsAppInboxPage.jsx");
  const service = await source("src/gestion/services/customerService.js");
  assert.match(page, /findCustomersByPhones/);
  assert.match(page, /createCustomerFromAdminIfMissing/);
  assert.match(page, /updateCustomerFromAdmin/);
  assert.match(page, /listActiveCustomerZones/);
  assert.match(service, /where\(documentId\(\), "in", customerIds\)/);
  assert.match(service, /CUSTOMER_BATCH_LOOKUP_SIZE = 30/);
  assert.match(service, /createCustomerFromAdminIfMissing/);
  assert.match(service, /runTransaction/);
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

test("Inbox filters stay local, preserve observed unread state and avoid polling", async () => {
  const page = await source("src/gestion/pages/WhatsAppInboxPage.jsx");
  assert.match(page, /id: "unread"/);
  assert.match(page, /id: "no-zone"/);
  assert.match(page, /id: "new"/);
  assert.match(page, /unreadDisplay \|\| chat\.unreadCount/);
  assert.match(page, /Siguiente no leído/);
  assert.doesNotMatch(page, /unreadCount:\s*0/);
  assert.doesNotMatch(page, /setInterval\s*\(/);
});

test("unsupported WhatsApp chat types cannot contaminate CRM or send controls", async () => {
  const page = await source("src/gestion/pages/WhatsAppInboxPage.jsx");
  assert.match(page, /chatType !== "group"/);
  assert.match(page, /chatType !== "channel"/);
  assert.match(page, /chatType !== "community"/);
  assert.match(page, /Grupos, canales y comunidades no se convierten en clientes/);
  assert.ok(
    page.includes('disabled={!canRespond || !crmEligibleChat(selectedChat)}'),
    "send control must be disabled when the user cannot respond or the selected chat is not CRM-eligible",
  );
});

test("messages render as React text and the Inbox does not introduce unsafe HTML", async () => {
  const page = await source("src/gestion/pages/WhatsAppInboxPage.jsx");
  assert.match(page, /<p>\{message\.text\}<\/p>/);
  assert.doesNotMatch(page, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(page, /innerHTML/);
});

test("WhatsApp labels remain explicitly separate from the current CRM model", async () => {
  const page = await source("src/gestion/pages/WhatsAppInboxPage.jsx");
  assert.match(page, /Etiquetas de WhatsApp/);
  assert.match(page, /Clientes no posee hoy un modelo de etiquetas persistentes equivalente/);
  assert.doesNotMatch(page, /customer\?\.tags/);
});

test("reply permission follows the existing Social module permissions", async () => {
  const page = await source("src/gestion/pages/WhatsAppInboxPage.jsx");
  const permissions = await source("src/gestion/permissions.js");
  assert.match(page, /can\(profile, "social", "edit"\)/);
  assert.match(page, /can\(profile, "social", "create"\)/);
  assert.match(permissions, /marketing_manager/);
  assert.match(permissions, /social: operational/);
});
