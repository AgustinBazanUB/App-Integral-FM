import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BULK_WHATSAPP_CONTACT_FILTERS,
  BULK_WHATSAPP_COOLDOWN_DAYS,
  customerBulkWhatsAppContactState,
  customerMatchesCampaignFilters,
} from "../src/gestion/marketing/whatsapp/campaignDomain.js";

const NOW = new Date("2026-09-03T15:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

test("el cooldown de campañas es dinámico y no necesita booleano ni cron", () => {
  assert.equal(BULK_WHATSAPP_COOLDOWN_DAYS, 14);

  const never = customerBulkWhatsAppContactState({}, { now: NOW });
  assert.equal(never.state, "never");
  assert.equal(never.available, true);

  const recent = customerBulkWhatsAppContactState({
    lastBulkWhatsAppConfirmedAt: new Date(NOW.getTime() - 7 * DAY),
  }, { now: NOW });
  assert.equal(recent.state, "recent");
  assert.equal(recent.available, false);
  assert.equal(recent.recentlyContacted, true);

  const expired = customerBulkWhatsAppContactState({
    lastBulkWhatsAppConfirmedAt: new Date(NOW.getTime() - 14 * DAY),
  }, { now: NOW });
  assert.equal(expired.state, "available");
  assert.equal(expired.available, true);
  assert.equal(expired.recentlyContacted, false);
});

test("los filtros separan disponibles, recientes y todos", () => {
  const originalNow = Date.now;
  Date.now = () => NOW.getTime();
  try {
    const recentCustomer = {
      active: true,
      phone: "11 1234 5678",
      lastBulkWhatsAppConfirmedAt: new Date(NOW.getTime() - 3 * DAY),
    };
    const availableCustomer = {
      active: true,
      phone: "11 8765 4321",
      lastBulkWhatsAppConfirmedAt: new Date(NOW.getTime() - 20 * DAY),
    };

    assert.equal(customerMatchesCampaignFilters(recentCustomer, {
      bulkWhatsAppContact: BULK_WHATSAPP_CONTACT_FILTERS.available,
    }), false);
    assert.equal(customerMatchesCampaignFilters(recentCustomer, {
      bulkWhatsAppContact: BULK_WHATSAPP_CONTACT_FILTERS.recent,
    }), true);
    assert.equal(customerMatchesCampaignFilters(recentCustomer, {
      bulkWhatsAppContact: BULK_WHATSAPP_CONTACT_FILTERS.all,
    }), true);
    assert.equal(customerMatchesCampaignFilters(availableCustomer, {
      bulkWhatsAppContact: BULK_WHATSAPP_CONTACT_FILTERS.available,
    }), true);
  } finally {
    Date.now = originalNow;
  }
});

test("el circuito confirmado usa recipientId persistido y sólo confirmed actualiza el cliente", async () => {
  const service = await readFile(new URL("../src/gestion/marketing/whatsapp/campaignService.js", import.meta.url), "utf8");

  assert.match(service, /lastRecipientResult/);
  assert.match(service, /EXTENSION_RECIPIENT_OUTCOMES = new Set\(\["confirmed", "unverified", "failed"\]\)/);
  assert.match(service, /recipientData\?\.clientId && recipientResult\.outcome === "confirmed"/);
  assert.match(service, /lastBulkWhatsAppConfirmedAt: recipientResult\.completedAt/);
  assert.match(service, /lastBulkWhatsAppCampaignId: message\.campaignId/);
  assert.match(service, /lastBulkWhatsAppRecipientId: recipientResult\.recipientId/);
  assert.match(service, /recipientResult\.completedAtMillis > existingCustomerMillis/);
  assert.match(service, /recipientId: await recipientDocumentId\(recipient\.phoneNormalized \|\| recipient\.phone\)/);
  assert.match(service, /prepareCampaignSnapshotWithCooldown/);
  assert.match(service, /guardRecipientsWithCurrentCustomerState/);
});

test("la UI usa descanso de 14 días por defecto y vuelve a validar al preparar", async () => {
  const page = await readFile(new URL("../src/gestion/pages/WhatsAppCampaignsPage.jsx", import.meta.url), "utf8");
  const customerPage = await readFile(new URL("../src/gestion/pages/LoyalCustomersPage.jsx", import.meta.url), "utf8");

  assert.match(page, /bulkWhatsAppContact: BULK_WHATSAPP_CONTACT_FILTERS\.available/);
  assert.match(page, /Contacto por campañas/);
  assert.match(page, /Disponibles para contactar/);
  assert.match(page, /Contactados recientemente/);
  assert.match(page, /Todos · ignorar descanso/);
  assert.match(page, /prepareCampaignSnapshotWithCooldown/);
  assert.match(page, /await campaignSummaryForExtension/);
  assert.match(customerPage, /Último mensaje masivo confirmado/);
  assert.match(customerPage, /Disponible nuevamente/);
  assert.match(customerPage, /Estado para campañas/);
});

test("las reglas versionadas restringen el cambio técnico del cooldown al resultado confirmado", async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /whatsappCustomerCooldownUpdate/);
  assert.match(rules, /lastBulkWhatsAppConfirmedAt/);
  assert.match(rules, /lastBulkWhatsAppCampaignId/);
  assert.match(rules, /lastBulkWhatsAppRecipientId/);
  assert.match(rules, /getAfter\(recipientPath\)/);
  assert.match(rules, /extensionResultOutcome == "confirmed"/);
});
