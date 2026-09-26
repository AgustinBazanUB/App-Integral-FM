import { signCmsBase64 } from "./cms.mjs";
import { loadArcaSecrets, arcaEnvironment } from "./config.mjs";
import { escapeXml, soapRequest, xmlTag } from "./xml.mjs";

const ticketCache = new Map();

function isoWithoutMillis(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function buildLoginTicketRequest(service, now = new Date()) {
  const uniqueId = Math.floor(now.getTime() / 1000) >>> 0;
  const generationTime = new Date(now.getTime() - 10 * 60 * 1000);
  const expirationTime = new Date(now.getTime() + 10 * 60 * 1000);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<loginTicketRequest version="1.0">',
    "<header>",
    `<uniqueId>${uniqueId}</uniqueId>`,
    `<generationTime>${isoWithoutMillis(generationTime)}</generationTime>`,
    `<expirationTime>${isoWithoutMillis(expirationTime)}</expirationTime>`,
    "</header>",
    `<service>${escapeXml(service)}</service>`,
    "</loginTicketRequest>",
  ].join("");
}

export function buildLoginCmsEnvelope(cmsBase64) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">',
    "<soapenv:Header/>",
    "<soapenv:Body>",
    "<wsaa:loginCms>",
    `<wsaa:in0>${escapeXml(cmsBase64)}</wsaa:in0>`,
    "</wsaa:loginCms>",
    "</soapenv:Body>",
    "</soapenv:Envelope>",
  ].join("");
}

export function parseLoginTicketResponse(soapXml) {
  const encodedResponse = xmlTag(soapXml, "loginCmsReturn", { required: true });
  const responseXml = encodedResponse.trim().startsWith("<") ? encodedResponse : String(encodedResponse);
  const token = xmlTag(responseXml, "token", { required: true });
  const sign = xmlTag(responseXml, "sign", { required: true });
  const expirationTime = xmlTag(responseXml, "expirationTime", { required: true });
  const expiresAt = new Date(expirationTime);
  if (Number.isNaN(expiresAt.valueOf())) {
    const error = new Error("WSAA devolvió una fecha de expiración inválida.");
    error.code = "arca-wsaa-invalid-expiration";
    throw error;
  }
  return { token, sign, expirationTime, expiresAt };
}

export async function requestAccessTicket(service, {
  env = process.env,
  now = new Date(),
  fetchImpl = fetch,
  forceRefresh = false,
} = {}) {
  const environment = arcaEnvironment(env);
  const cacheKey = `${environment.id}:${service}`;
  const cached = ticketCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAt.getTime() - now.getTime() > 5 * 60 * 1000) {
    return cached;
  }
  const secrets = loadArcaSecrets(env);
  const tra = buildLoginTicketRequest(service, now);
  const cmsBase64 = signCmsBase64(tra, secrets);
  const envelope = buildLoginCmsEnvelope(cmsBase64);
  const soap = await soapRequest({
    url: environment.wsaaUrl,
    action: "urn:LoginCms",
    body: envelope,
    timeoutMs: 20000,
    fetchImpl,
  });
  const ticket = parseLoginTicketResponse(soap);
  ticketCache.set(cacheKey, ticket);
  return ticket;
}

export function clearWsaaTicketCache() {
  ticketCache.clear();
}
