import { assertValidCuit } from "./cuit.mjs";

export const ARCA_ENVIRONMENTS = Object.freeze({
  homologation: Object.freeze({
    id: "homologation",
    wsaaUrl: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    wsfeUrl: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
    registryUrl: "https://awshomo.arca.gob.ar/sr-padron/webservices/personaServiceA5",
  }),
  production: Object.freeze({
    id: "production",
    wsaaUrl: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    wsfeUrl: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
    registryUrl: "https://aws.arca.gob.ar/sr-padron/webservices/personaServiceA5",
  }),
});

function required(name, env = process.env) {
  const value = String(env[name] ?? "").trim();
  if (!value) {
    const error = new Error(`Falta configurar ${name}.`);
    error.code = "arca-config-missing";
    error.field = name;
    throw error;
  }
  return value;
}

function pointOfSale(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 99999) {
    const error = new Error("ARCA_POINT_OF_SALE debe ser un punto de venta válido de 1 a 5 dígitos.");
    error.code = "arca-point-of-sale-invalid";
    throw error;
  }
  return number;
}

export function arcaEnvironment(env = process.env) {
  const id = String(env.ARCA_ENVIRONMENT || "homologation").trim().toLowerCase();
  const config = ARCA_ENVIRONMENTS[id];
  if (!config) {
    const error = new Error("ARCA_ENVIRONMENT debe ser homologation o production.");
    error.code = "arca-environment-invalid";
    throw error;
  }
  return config;
}

export function loadArcaPublicConfig(env = process.env, { requirePointOfSale = true } = {}) {
  const environment = arcaEnvironment(env);
  const issuerCuit = assertValidCuit(required("ARCA_ISSUER_CUIT", env), "CUIT del emisor");
  const result = {
    environment: environment.id,
    issuerCuit,
    wsaaUrl: environment.wsaaUrl,
    wsfeUrl: environment.wsfeUrl,
    registryUrl: environment.registryUrl,
  };
  if (requirePointOfSale) result.pointOfSale = pointOfSale(required("ARCA_POINT_OF_SALE", env));
  return result;
}

export function loadArcaSecrets(env = process.env) {
  return {
    certificatePem: required("ARCA_CERTIFICATE_PEM", env).replace(/\\n/g, "\n"),
    privateKeyPem: required("ARCA_PRIVATE_KEY_PEM", env).replace(/\\n/g, "\n"),
  };
}

export function arcaSafeStatus(env = process.env) {
  let publicConfig = null;
  let publicConfigError = null;
  try {
    publicConfig = loadArcaPublicConfig(env, { requirePointOfSale: false });
  } catch (error) {
    publicConfigError = error.field || error.code || "invalid";
  }
  return {
    environment: publicConfig?.environment || String(env.ARCA_ENVIRONMENT || "homologation"),
    issuerConfigured: Boolean(publicConfig?.issuerCuit),
    pointOfSaleConfigured: Boolean(String(env.ARCA_POINT_OF_SALE || "").trim()),
    certificateConfigured: Boolean(String(env.ARCA_CERTIFICATE_PEM || "").trim()),
    privateKeyConfigured: Boolean(String(env.ARCA_PRIVATE_KEY_PEM || "").trim()),
    publicConfigError,
  };
}
