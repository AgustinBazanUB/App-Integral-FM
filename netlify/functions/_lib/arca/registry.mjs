import { assertValidCuit } from "./cuit.mjs";
import { loadArcaPublicConfig } from "./config.mjs";
import { escapeXml, soapRequest, xmlTag, xmlTags } from "./xml.mjs";
import { requestAccessTicket } from "./wsaa.mjs";

const NS = "http://a5.soap.ws.server.puc.sr/";

function envelope(operation, payload = "") {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a5="${NS}">`,
    "<soapenv:Header/>",
    "<soapenv:Body>",
    `<a5:${operation}>${payload}</a5:${operation}>`,
    "</soapenv:Body>",
    "</soapenv:Envelope>",
  ].join("");
}

export async function registryDummy({ env = process.env, fetchImpl = fetch } = {}) {
  const config = loadArcaPublicConfig(env, { requirePointOfSale: false });
  const xml = await soapRequest({
    url: config.registryUrl,
    body: envelope("dummy"),
    timeoutMs: 15000,
    fetchImpl,
  });
  return {
    appServer: xmlTag(xml, "appserver"),
    dbServer: xmlTag(xml, "dbserver"),
    authServer: xmlTag(xml, "authserver"),
  };
}

function parseAddress(generalXml) {
  const block = xmlTag(generalXml, "domicilioFiscal");
  if (!block) return null;
  return {
    address: xmlTag(block, "direccion") || null,
    locality: xmlTag(block, "localidad") || null,
    postalCode: xmlTag(block, "codPostal") || null,
    province: xmlTag(block, "descripcionProvincia") || null,
    provinceId: Number(xmlTag(block, "idProvincia") || 0) || null,
  };
}

function parseTaxes(xml) {
  const regime = xmlTag(xml, "datosRegimenGeneral") || "";
  return xmlTags(regime, "impuesto").map((block) => ({
    id: Number(xmlTag(block, "idImpuesto") || 0) || null,
    description: xmlTag(block, "descripcionImpuesto") || "",
    status: xmlTag(block, "estadoImpuesto") || null,
    period: xmlTag(block, "periodo") || null,
  }));
}

export async function getTaxpayer(targetCuit, {
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const config = loadArcaPublicConfig(env, { requirePointOfSale: false });
  const idPersona = assertValidCuit(targetCuit, "CUIT consultado");
  const ticket = await requestAccessTicket("ws_sr_constancia_inscripcion", { env, fetchImpl });
  const payload = [
    `<token>${escapeXml(ticket.token)}</token>`,
    `<sign>${escapeXml(ticket.sign)}</sign>`,
    `<cuitRepresentada>${config.issuerCuit}</cuitRepresentada>`,
    `<idPersona>${idPersona}</idPersona>`,
  ].join("");
  const xml = await soapRequest({
    url: config.registryUrl,
    body: envelope("getPersona_v2", payload),
    timeoutMs: 25000,
    fetchImpl,
  });
  const person = xmlTag(xml, "personaReturn", { required: true });
  const general = xmlTag(person, "datosGenerales") || "";

  return {
    cuit: idPersona,
    firstName: xmlTag(general, "nombre") || null,
    lastName: xmlTag(general, "apellido") || null,
    personType: xmlTag(general, "tipoPersona") || null,
    keyType: xmlTag(general, "tipoClave") || null,
    keyStatus: xmlTag(general, "estadoClave") || null,
    fiscalAddress: parseAddress(general),
    taxes: parseTaxes(person),
    monotributo: Boolean(xmlTag(person, "datosMonotributo")),
    errorConstancia: xmlTag(person, "errorConstancia") || null,
    errorRegimenGeneral: xmlTag(person, "errorRegimenGeneral") || null,
    errorMonotributo: xmlTag(person, "errorMonotributo") || null,
  };
}
