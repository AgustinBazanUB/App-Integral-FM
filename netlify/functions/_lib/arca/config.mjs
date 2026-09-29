import { createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { assertValidCuit } from "./cuit.mjs";

export const ARCA_ENVIRONMENTS = Object.freeze({
  homologation: Object.freeze({
    id: "homologation",
    wsaaUrl: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    wsfeUrl: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
    registryUrl: "https://awshomo.arca.gob.ar/sr-padron/webservices/personaServiceA5",
    registryFallbackUrls: Object.freeze(["https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5"]),
  }),
  production: Object.freeze({
    id: "production",
    wsaaUrl: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    wsfeUrl: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
    registryUrl: "https://aws.arca.gob.ar/sr-padron/webservices/personaServiceA5",
    registryFallbackUrls: Object.freeze(["https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5"]),
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

export function assertArcaNetworkAccessAllowed(env = process.env) {
  const environment = arcaEnvironment(env);
  if (environment.id !== "production") return environment;

  const readonlyAllowed = String(env.ARCA_ALLOW_PRODUCTION_READONLY || "")
    .trim()
    .toLowerCase() === "true";
  const caeAllowed = String(env.ARCA_ALLOW_PRODUCTION_CAE || "")
    .trim()
    .toLowerCase() === "true";

  if (!readonlyAllowed && !caeAllowed) {
    const error = new Error(
      "Las conexiones ARCA de producción están bloqueadas. Habilitá explícitamente read-only o el gate controlado de CAE."
    );
    error.code = "arca-production-network-disabled";
    error.status = 409;
    throw error;
  }
  return environment;
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
    registryFallbackUrls: [...(environment.registryFallbackUrls || [])],
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


export function inspectArcaCredentialPair(env = process.env, { now = new Date() } = {}) {
  const certificatePem = String(env.ARCA_CERTIFICATE_PEM || "").trim().replace(/\\n/g, "\n");
  const privateKeyPem = String(env.ARCA_PRIVATE_KEY_PEM || "").trim().replace(/\\n/g, "\n");
  const result = {
    certificateConfigured: Boolean(certificatePem),
    privateKeyConfigured: Boolean(privateKeyPem),
    certificateParseable: false,
    privateKeyParseable: false,
    certificateValidNow: false,
    keyMatchesCertificate: false,
    validFrom: null,
    validTo: null,
    fingerprint256: null,
    ready: false,
    errorCode: null,
  };

  if (!certificatePem || !privateKeyPem) {
    result.errorCode = "arca-credentials-missing";
    return result;
  }

  let certificate;
  try {
    certificate = new X509Certificate(certificatePem);
    result.certificateParseable = true;
    result.validFrom = new Date(certificate.validFrom).toISOString();
    result.validTo = new Date(certificate.validTo).toISOString();
    result.fingerprint256 = certificate.fingerprint256 || null;
    const validFrom = new Date(certificate.validFrom).getTime();
    const validTo = new Date(certificate.validTo).getTime();
    const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
    result.certificateValidNow = Number.isFinite(nowMs)
      && Number.isFinite(validFrom)
      && Number.isFinite(validTo)
      && nowMs >= validFrom
      && nowMs <= validTo;
  } catch {
    result.errorCode = "arca-certificate-invalid";
    return result;
  }

  let privateKey;
  try {
    privateKey = createPrivateKey(privateKeyPem);
    result.privateKeyParseable = true;
  } catch {
    result.errorCode = "arca-private-key-invalid";
    return result;
  }

  try {
    const certificatePublicKey = certificate.publicKey.export({ type: "spki", format: "der" });
    const privatePublicKey = createPublicKey(privateKey).export({ type: "spki", format: "der" });
    result.keyMatchesCertificate = Buffer.compare(certificatePublicKey, privatePublicKey) === 0;
  } catch {
    result.keyMatchesCertificate = false;
  }

  if (!result.keyMatchesCertificate) {
    result.errorCode = "arca-certificate-key-mismatch";
    return result;
  }
  if (!result.certificateValidNow) {
    result.errorCode = "arca-certificate-not-currently-valid";
    return result;
  }

  result.ready = true;
  result.errorCode = null;
  return result;
}

export function assertArcaCredentialPairReady(env = process.env, options = {}) {
  const status = inspectArcaCredentialPair(env, options);
  if (status.ready) return status;

  const messages = {
    "arca-credentials-missing": "Falta configurar el certificado o la clave privada de ARCA.",
    "arca-certificate-invalid": "El certificado ARCA no es un X.509 válido.",
    "arca-private-key-invalid": "La clave privada ARCA no es válida.",
    "arca-certificate-key-mismatch": "La clave privada no corresponde al certificado ARCA configurado.",
    "arca-certificate-not-currently-valid": "El certificado ARCA está fuera de su período de vigencia.",
  };
  const error = new Error(messages[status.errorCode] || "Las credenciales ARCA no están listas.");
  error.code = status.errorCode || "arca-credentials-not-ready";
  error.status = 409;
  throw error;
}

export function arcaSafeStatus(env = process.env) {
  let publicConfig = null;
  let publicConfigError = null;
  try {
    publicConfig = loadArcaPublicConfig(env, { requirePointOfSale: false });
  } catch (error) {
    publicConfigError = error.field || error.code || "invalid";
  }
  const credentials = inspectArcaCredentialPair(env);

  return {
    environment: publicConfig?.environment || String(env.ARCA_ENVIRONMENT || "homologation"),
    issuerConfigured: Boolean(publicConfig?.issuerCuit),
    pointOfSaleConfigured: Boolean(String(env.ARCA_POINT_OF_SALE || "").trim()),
    certificateConfigured: credentials.certificateConfigured,
    privateKeyConfigured: credentials.privateKeyConfigured,
    credentialsReady: credentials.ready,
    certificateValidNow: credentials.certificateValidNow,
    certificateKeyMatch: credentials.keyMatchesCertificate,
    certificateValidFrom: credentials.validFrom,
    certificateValidTo: credentials.validTo,
    certificateFingerprint256: credentials.fingerprint256,
    credentialErrorCode: credentials.errorCode,
    issuerVatConditionConfigured: Boolean(String(env.ARCA_ISSUER_VAT_CONDITION || "").trim()),
    defaultProductVatRate: String(env.ARCA_DEFAULT_PRODUCT_VAT_RATE || "").trim() || null,
    consumerFinalIdThreshold: Number(env.ARCA_CONSUMER_FINAL_ID_THRESHOLD || 0) || null,
    caeHomologationEnabled: String(env.ARCA_ALLOW_CAE_HOMOLOGATION || "").trim().toLowerCase() === "true",
    taSharedCacheConfigured: Boolean(String(env.ARCA_TA_ENCRYPTION_KEY || "").trim()),
    taSharedCacheRequiredInProduction: true,
    productionReadonlyEnabled: String(env.ARCA_ALLOW_PRODUCTION_READONLY || "").trim().toLowerCase() === "true",
    productionInvoicePreparationEnabled: String(env.ARCA_ALLOW_PRODUCTION_INVOICE_PREPARE || "").trim().toLowerCase() === "true",
    productionTaxpayerLookupEnabled: String(env.ARCA_ALLOW_PRODUCTION_TAXPAYER_LOOKUP || "").trim().toLowerCase() === "true",
    productionCaeEnabled: String(env.ARCA_ALLOW_PRODUCTION_CAE || "").trim().toLowerCase() === "true",
    productionAutoAuthorizeEnabled: String(env.ARCA_AUTO_AUTHORIZE_PRODUCTION || "").trim().toLowerCase() === "true",
    productionCaeTargetSaleCode: String(env.ARCA_PRODUCTION_CAE_SALE_CODE || "").trim() || null,
    publicConfigError,
  };
}
