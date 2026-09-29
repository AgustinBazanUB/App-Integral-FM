import { randomUUID } from "node:crypto";
import { signCmsBase64 } from "./cms.mjs";
import { assertArcaNetworkAccessAllowed, loadArcaSecrets, arcaEnvironment } from "./config.mjs";
import { escapeXml, soapRequest, xmlTag } from "./xml.mjs";
import {
  acquireWsaaRenewalLease,
  readSharedWsaaTicket,
  storeSharedWsaaTicket,
  waitForSharedWsaaTicket,
  wsaaSharedCacheConfigured,
} from "./wsaaSharedCache.mjs";

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

async function requestFreshAccessTicket(service, {
  env = process.env,
  now = new Date(),
  fetchImpl = fetch,
} = {}) {
  const environment = arcaEnvironment(env);
  const secrets = loadArcaSecrets(env);
  const tra = buildLoginTicketRequest(service, now);
  const cmsBase64 = signCmsBase64(tra, secrets);
  const envelope = buildLoginCmsEnvelope(cmsBase64);
  let soap;
  try {
    soap = await soapRequest({
      url: environment.wsaaUrl,
      action: "urn:LoginCms",
      body: envelope,
      timeoutMs: 20000,
      fetchImpl,
    });
  } catch (error) {
    if (String(error?.code || "").includes("alreadyAuthenticated")) {
      const activeTicketError = new Error(
        "ARCA ya tiene un Ticket de Acceso vigente para este certificado y servicio. No se solicitará otro hasta que venza."
      );
      activeTicketError.code = "arca-wsaa-already-authenticated";
      activeTicketError.status = 409;
      activeTicketError.causeCode = error.code;
      throw activeTicketError;
    }
    throw error;
  }
  return parseLoginTicketResponse(soap);
}

function ticketIsReusable(ticket, now) {
  return Boolean(
    ticket?.expiresAt
    && ticket.expiresAt.getTime() - now.getTime() > 5 * 60 * 1000
  );
}

function sharedCacheRequired(environmentId) {
  return environmentId === "production";
}

export async function requestAccessTicket(service, {
  env = process.env,
  now = new Date(),
  fetchImpl = fetch,
  forceRefresh = false,
  sharedCache = {},
} = {}) {
  const environment = assertArcaNetworkAccessAllowed(env);
  const cacheKey = `${environment.id}:${service}`;
  const cached = ticketCache.get(cacheKey);

  if (!forceRefresh && ticketIsReusable(cached, now)) {
    return cached;
  }

  const sharedConfigured = wsaaSharedCacheConfigured(env);
  if (sharedCacheRequired(environment.id) && !sharedConfigured) {
    const error = new Error(
      "Producción exige ARCA_TA_ENCRYPTION_KEY para reutilizar Ticket de Acceso WSAA entre instancias."
    );
    error.code = "arca-wsaa-shared-cache-required";
    error.status = 503;
    throw error;
  }

  if (!sharedConfigured) {
    const fresh = await requestFreshAccessTicket(service, { env, now, fetchImpl });
    ticketCache.set(cacheKey, fresh);
    return fresh;
  }

  const getDocument = sharedCache.getDocument;
  const createDocument = sharedCache.createDocument;
  const patchDocument = sharedCache.patchDocument;
  const sleepImpl = sharedCache.sleepImpl;

  const shared = await readSharedWsaaTicket({
    environmentId: environment.id,
    service,
    env,
    now,
    ...(getDocument ? { getDocument } : {}),
  });
  if (shared.ticket) {
    ticketCache.set(cacheKey, shared.ticket);
    return shared.ticket;
  }

  const holder = `wsaa_${randomUUID()}`;
  let lease = await acquireWsaaRenewalLease({
    environmentId: environment.id,
    service,
    holder,
    env,
    now,
    ...(getDocument ? { getDocument } : {}),
    ...(createDocument ? { createDocument } : {}),
    ...(patchDocument ? { patchDocument } : {}),
  });

  if (!lease.acquired) {
    const waited = await waitForSharedWsaaTicket({
      environmentId: environment.id,
      service,
      env,
      now,
      ...(getDocument ? { getDocument } : {}),
      ...(sleepImpl ? { sleepImpl } : {}),
    });
    if (waited.ticket) {
      ticketCache.set(cacheKey, waited.ticket);
      return waited.ticket;
    }

    const retryNow = new Date(now.getTime() + 6500);
    lease = await acquireWsaaRenewalLease({
      environmentId: environment.id,
      service,
      holder,
      env,
      now: retryNow,
      ...(getDocument ? { getDocument } : {}),
      ...(createDocument ? { createDocument } : {}),
      ...(patchDocument ? { patchDocument } : {}),
    });

    if (!lease.acquired) {
      const latest = await readSharedWsaaTicket({
        environmentId: environment.id,
        service,
        env,
        now: retryNow,
        ...(getDocument ? { getDocument } : {}),
      });
      if (latest.ticket) {
        ticketCache.set(cacheKey, latest.ticket);
        return latest.ticket;
      }

      const error = new Error(
        "Otra instancia está renovando el Ticket de Acceso WSAA. Reintentá la operación en unos segundos."
      );
      error.code = "arca-wsaa-renewal-busy";
      error.status = 503;
      throw error;
    }
  }

  const fresh = await requestFreshAccessTicket(service, { env, now, fetchImpl });

  await storeSharedWsaaTicket({
    environmentId: environment.id,
    service,
    holder,
    ticket: fresh,
    expectedUpdateTime: lease.updateTime,
    env,
    now,
    ...(getDocument ? { getDocument } : {}),
    ...(patchDocument ? { patchDocument } : {}),
  });

  ticketCache.set(cacheKey, fresh);
  return fresh;
}

export function clearWsaaTicketCache() {
  ticketCache.clear();
}
