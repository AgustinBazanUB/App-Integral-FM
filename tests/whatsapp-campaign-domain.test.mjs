
import test from "node:test";
import assert from "node:assert/strict";
import {
  CAMPAIGN_STATUS_LABELS,
  analyzeRecipientCandidates,
  campaignValidation,
  customerCommunicationAllowed,
  customerMatchesCampaignFilters,
  extensionPrimaryStatus,
  extensionCampaignCounters,
  progressPercentage,
  userFacingWhatsAppProblem,
} from "../src/gestion/marketing/whatsapp/campaignDomain.js";
import { detectExcelMapping, mapExcelRows } from "../src/gestion/marketing/whatsapp/excelImport.js";

const flor = { source: "flor_mia", clientId: "c1", name: "Ana", phone: "11 5757-1979", zone: "Microcentro", category: "Premium" };
const excel = { source: "excel", clientId: null, name: "Otro nombre", phone: "+54 9 11 5757 1979", zone: "", category: "", notes: "Excel" };

test("deduplica Flor Mía + Excel por teléfono WhatsApp canónico y prioriza datos maestros", () => {
  const result = analyzeRecipientCandidates([excel, flor]);
  assert.equal(result.valid, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(result.recipients[0].source, "flor_mia");
  assert.equal(result.recipients[0].clientId, "c1");
  assert.equal(result.recipients[0].name, "Ana");
  assert.equal(result.recipients[0].whatsappPhone, "5491157571979");
});

test("formatos 0/15 y +54 9 del mismo móvil no generan destinatarios duplicados", () => {
  const result = analyzeRecipientCandidates([
    { source: "excel", phone: "011 15 5757-1979" },
    { source: "excel", phone: "+54 9 11 5757-1979" },
  ]);
  assert.equal(result.valid, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(result.recipients[0].whatsappPhone, "5491157571979");
});

test("contabiliza sin teléfono e inválidos sin mezclarlos con válidos", () => {
  const result = analyzeRecipientCandidates([{ source: "excel", phone: "" }, { source: "excel", phone: "123" }, flor]);
  assert.equal(result.missingPhone, 1);
  assert.equal(result.invalid, 1);
  assert.equal(result.valid, 1);
});

test("un teléfono ambiguo no se completa silenciosamente para la extensión", () => {
  const result = analyzeRecipientCandidates([{ source: "excel", phone: "5757-1979" }]);
  assert.equal(result.valid, 0);
  assert.equal(result.invalid, 1);
  assert.match(result.invalidRows[0].reason, /ambiguo/i);
});

test("respeta bloqueos explícitos pero no inventa consentimiento cuando el campo no existe", () => {
  assert.equal(customerCommunicationAllowed({ active: true, deleted: false }), true);
  assert.equal(customerCommunicationAllowed({ active: true, marketingEnabled: false }), false);
  assert.equal(customerCommunicationAllowed({ active: true, whatsappOptIn: false }), false);
  assert.equal(customerCommunicationAllowed({ active: true, doNotContact: true }), false);
});

test("combina zona, categoría, nombre y teléfono", () => {
  const customer = { active: true, name: "Ana Pérez", phoneNormalized: "1157571979", zoneId: "z1", zoneName: "Microcentro", segment: "Premium" };
  assert.equal(customerMatchesCampaignFilters(customer, { zoneId: "z1", category: "Premium", search: "ana" }), true);
  assert.equal(customerMatchesCampaignFilters(customer, { zoneId: "z1", category: "Premium", search: "5757" }), true);
  assert.equal(customerMatchesCampaignFilters(customer, { zoneId: "z2" }), false);
});

test("mapping Excel detecta teléfono y deja nombre opcional", () => {
  const headers = ["Celular", "Zona", "Observaciones"];
  const mapping = detectExcelMapping(headers);
  assert.equal(mapping.phone, "Celular");
  assert.equal(mapping.name, "");
  const rows = mapExcelRows({ headers, rows: [[1157571979, "Centro", "OK"]] }, mapping);
  assert.equal(rows[0].phone, "1157571979");
  assert.equal(rows[0].name, "");
});

test("validación final exige extensión operativa, destinatario canónico y contenido", () => {
  const invalid = campaignValidation({ name: "Campaña", recipients: [], message: "", images: [], extensionStatus: { operational: false, message: "Extensión no detectada" } });
  assert.equal(invalid.valid, false);
  const recipient = analyzeRecipientCandidates([flor]).recipients;
  const valid = campaignValidation({ name: "Campaña", recipients: recipient, message: "Hola 👋\nhttps://flormia.com", images: [], extensionStatus: { operational: true } });
  assert.equal(valid.valid, true);
});

test("estado de conexión usa vocabulario simple", () => {
  assert.deepEqual(extensionPrimaryStatus({ operational: true, message: "Listo" }), {
    operational: true,
    label: "Conectado",
    tone: "success",
    message: "Listo",
  });
  assert.equal(extensionPrimaryStatus({ operational: false }).label, "Necesita revisión");
});

test("la detención conserva un estado distinto de la cancelación previa", () => {
  assert.equal(CAMPAIGN_STATUS_LABELS.stopped, "Campaña detenida");
  assert.equal(CAMPAIGN_STATUS_LABELS.cancelled, "Campaña cancelada");
});

test("CONTACT_CONTEXT_UNVERIFIED se presenta como pausa de seguridad y no como capability", () => {
  assert.equal(
    userFacingWhatsAppProblem({ code: "CONTACT_CONTEXT_UNVERIFIED" }),
    "No pudimos confirmar que WhatsApp abrió el contacto correcto. La campaña se pausó para evitar enviar el mensaje a otra persona.",
  );
});

test("progreso deriva porcentaje sin superar 100", () => {
  assert.equal(progressPercentage(487, 240), 49);
  assert.equal(progressPercentage(10, 99), 100);
});

test("progreso de la extensión usa el contrato público sent/progress.completed", () => {
  assert.deepEqual(
    extensionCampaignCounters({ sent: 1, progress: { completed: 1 }, finalSummary: { failed: 0 } }, { totalRecipients: 1, sentCount: 0, errorCount: 0 }),
    { total: 1, sent: 1, errors: 0, progress: 100 },
  );
});

import { can } from "../src/gestion/permissions.js";

test("permissionDeny específico bloquea envío aunque el rol pueda editar Marketing", () => {
  const profile = {
    id: "marketing-1",
    active: true,
    role: "marketing_manager",
    permissionDeny: { marketing: ["whatsappSendToExtension"] },
  };
  assert.equal(can(profile, "marketing", "edit"), true);
  assert.equal(can(profile, "marketing", "whatsappSendToExtension"), false);
  assert.equal(can(profile, "marketing", "whatsappCreateCampaign"), true);
});
