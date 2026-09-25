import assert from "node:assert/strict";
import test from "node:test";
import { assertValidCuit, cuitCheckDigit, formatCuit, isValidCuit, normalizeCuit } from "../netlify/functions/_lib/arca/cuit.mjs";
import { ARCA_ENVIRONMENTS, arcaSafeStatus, loadArcaPublicConfig } from "../netlify/functions/_lib/arca/config.mjs";
import { buildLoginCmsEnvelope, buildLoginTicketRequest, parseLoginTicketResponse } from "../netlify/functions/_lib/arca/wsaa.mjs";
import { buildCaeDetail } from "../netlify/functions/_lib/arca/wsfe.mjs";
import { escapeXml, xmlTag, xmlTags } from "../netlify/functions/_lib/arca/xml.mjs";

test("CUIT del emisor informado es válido", () => {
  assert.equal(normalizeCuit("20-12345678-6"), "20123456786");
  assert.equal(cuitCheckDigit("2012345678"), 6);
  assert.equal(isValidCuit("20-12345678-6"), true);
  assert.equal(formatCuit("20123456786"), "20-12345678-6");
  assert.equal(assertValidCuit("20-12345678-6"), "20123456786");
});

test("configuración ARCA arranca en homologación y exige punto de venta cuando corresponde", () => {
  const env = { ARCA_ISSUER_CUIT: "20-12345678-6", ARCA_ENVIRONMENT: "homologation", ARCA_POINT_OF_SALE: "12" };
  const config = loadArcaPublicConfig(env);
  assert.equal(config.environment, "homologation");
  assert.equal(config.issuerCuit, "20123456786");
  assert.equal(config.pointOfSale, 12);
  assert.equal(config.wsfeUrl, ARCA_ENVIRONMENTS.homologation.wsfeUrl);
  assert.equal(arcaSafeStatus({ ARCA_ISSUER_CUIT: "20-12345678-6" }).issuerConfigured, true);
});

test("TRA WSAA es corto, temporal y específico por servicio", () => {
  const now = new Date("2026-09-25T14:00:00.000Z");
  const xml = buildLoginTicketRequest("wsfe", now);
  assert.match(xml, /<service>wsfe<\/service>/);
  assert.match(xml, /<generationTime>2026-09-25T13:50:00Z<\/generationTime>/);
  assert.match(xml, /<expirationTime>2026-09-25T14:10:00Z<\/expirationTime>/);
});

test("envelope LoginCms escapa CMS y parser recupera token/sign", () => {
  const envelope = buildLoginCmsEnvelope("abc+/=&");
  assert.match(envelope, /abc\+\/=\&amp;/);
  const response = `<soap:Envelope><soap:Body><loginCmsResponse><loginCmsReturn>&lt;loginTicketResponse&gt;&lt;header&gt;&lt;expirationTime&gt;2026-09-26T02:00:00-03:00&lt;/expirationTime&gt;&lt;/header&gt;&lt;credentials&gt;&lt;token&gt;TOKEN&lt;/token&gt;&lt;sign&gt;SIGN&lt;/sign&gt;&lt;/credentials&gt;&lt;/loginTicketResponse&gt;</loginCmsReturn></loginCmsResponse></soap:Body></soap:Envelope>`;
  const ticket = parseLoginTicketResponse(response);
  assert.equal(ticket.token, "TOKEN");
  assert.equal(ticket.sign, "SIGN");
  assert.equal(ticket.expiresAt.toISOString(), "2026-09-26T05:00:00.000Z");
});

test("helpers XML soportan namespace y múltiples bloques", () => {
  assert.equal(escapeXml(`<a x="1">&`), "&lt;a x=&quot;1&quot;&gt;&amp;");
  const xml = "<x:Root><x:Code>1</x:Code><Err><Code>2</Code></Err><Err><Code>3</Code></Err></x:Root>";
  assert.equal(xmlTag(xml, "Code"), "1");
  assert.equal(xmlTags(xml, "Err").length, 2);
});

test("detalle CAE incluye condición IVA del receptor y totales", () => {
  const xml = buildCaeDetail({
    concept: 1,
    docType: 99,
    docNumber: 0,
    voucherFrom: 1,
    voucherDate: "20260925",
    total: 22000,
    net: 18181.82,
    vat: 3818.18,
    receiverVatConditionId: 5,
    vatBreakdown: [{ id: 5, base: 18181.82, amount: 3818.18 }],
  });
  assert.match(xml, /<ar:CondicionIVAReceptorId>5<\/ar:CondicionIVAReceptorId>/);
  assert.match(xml, /<ar:ImpTotal>22000\.00<\/ar:ImpTotal>/);
  assert.match(xml, /<ar:Id>5<\/ar:Id>/);
});
