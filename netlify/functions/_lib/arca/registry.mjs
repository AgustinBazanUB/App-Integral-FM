import { assertValidCuit } from "./cuit.mjs";
import { loadArcaPublicConfig } from "./config.mjs";
import { escapeXml, soapRequest, xmlTag, xmlTags } from "./xml.mjs";
import { requestAccessTicket } from "./wsaa.mjs";

const NS = "http://a5.soap.ws.server.puc.sr/";

async function registrySoapRequest({ config, body, timeoutMs, fetchImpl }) {
  const urls = [config.registryUrl, ...(config.registryFallbackUrls || [])];
  let lastError = null;
  for (const url of urls) {
    try {
      const xml = await soapRequest({ url, body, timeoutMs, fetchImpl });
      return { xml, url };
    } catch (error) {
      lastError = error;
      if (error?.code !== "arca-network-error") throw error;
    }
  }
  throw lastError || new Error("No se pudo conectar con el Padrón de ARCA.");
}

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
  const { xml, url } = await registrySoapRequest({
    config,
    body: envelope("dummy"),
    timeoutMs: 15000,
    fetchImpl,
  });
  return {
    endpoint: url,
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

function parseRegistryError(personXml, tagName) {
  const block = xmlTag(personXml, tagName);
  if (!block) return null;
  return {
    message: xmlTag(block, "error") || String(block).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null,
    personId: xmlTag(block, "idPersona") || null,
  };
}

export function parseTaxpayerResponse(xml, targetCuit) {
  const idPersona = assertValidCuit(targetCuit, "CUIT consultado");
  const person = xmlTag(xml, "personaReturn", { required: true });
  const general = xmlTag(person, "datosGenerales") || "";
  const errorConstancia = parseRegistryError(person, "errorConstancia");
  const errorRegimenGeneral = parseRegistryError(person, "errorRegimenGeneral");
  const errorMonotributo = parseRegistryError(person, "errorMonotributo");
  return {
    cuit: idPersona,
    found: Boolean(general),
    firstName: xmlTag(general, "nombre") || null,
    lastName: xmlTag(general, "apellido") || null,
    personType: xmlTag(general, "tipoPersona") || null,
    keyType: xmlTag(general, "tipoClave") || null,
    keyStatus: xmlTag(general, "estadoClave") || null,
    fiscalAddress: parseAddress(general),
    taxes: parseTaxes(person),
    monotributo: Boolean(xmlTag(person, "datosMonotributo")),
    errorConstancia,
    errorRegimenGeneral,
    errorMonotributo,
  };
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
  const { xml, url } = await registrySoapRequest({
    config,
    body: envelope("getPersona_v2", payload),
    timeoutMs: 25000,
    fetchImpl,
  });
  return { ...parseTaxpayerResponse(xml, idPersona), endpoint: url };
}
