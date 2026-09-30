import assert from "node:assert/strict";
import test from "node:test";
import { buildArcaOperationalStatus } from "../netlify/functions/_lib/arca/readiness.mjs";

function readySafeStatus(overrides = {}) {
  return {
    environment: "production",
    issuerConfigured: true,
    pointOfSaleConfigured: true,
    certificateConfigured: true,
    privateKeyConfigured: true,
    credentialsReady: true,
    certificateValidNow: true,
    certificateKeyMatch: true,
    certificateValidFrom: "2026-01-01T00:00:00.000Z",
    certificateValidTo: "2027-01-01T00:00:00.000Z",
    credentialErrorCode: null,
    issuerVatConditionConfigured: true,
    invoicePdfIssuerReady: true,
    invoicePdfIssuerMissingFields: [],
    caeHomologationEnabled: false,
    taSharedCacheConfigured: true,
    taSharedCacheRequiredInProduction: true,
    productionReadonlyEnabled: true,
    productionInvoicePreparationEnabled: true,
    productionTaxpayerLookupEnabled: true,
    productionCaeEnabled: true,
    productionAutoAuthorizeEnabled: true,
    productionAutoAuthorizeSources: ["admin_quick_sale"],
    productionCaeTargetSaleCode: null,
    publicConfigError: null,
    ...overrides,
  };
}

function readyRuntime(overrides = {}) {
  return {
    wsaa: { status: "ok", message: "ok" },
    wsfe: { status: "ok", message: "ok" },
    firebaseAdmin: { status: "ok", message: "ok" },
    pointOfSale: { status: "ok", selected: 8, found: true, operational: true, message: "ok" },
    taxpayerLookup: { status: "ok", message: "ok" },
    ...overrides,
  };
}

const baseEnv = { ARCA_ENVIRONMENT: "production", ARCA_POINT_OF_SALE: "8" };

test("readiness productivo completo distingue configurado, operativo y emisión habilitada", () => {
  const status = buildArcaOperationalStatus({
    env: baseEnv,
    safeStatus: readySafeStatus(),
    pdfStatus: { ready: true, missing: [] },
    runtime: readyRuntime(),
    now: new Date("2026-09-30T12:00:00.000Z"),
  });
  assert.equal(status.environment, "production");
  assert.equal(status.configured, true);
  assert.equal(status.operational, true);
  assert.equal(status.productionReady, true);
  assert.equal(status.emissionEnabled, true);
  assert.equal(status.taxpayerLookupEnabled, true);
  assert.equal(status.pdfReady, true);
  assert.equal(status.pointOfSale, 8);
  assert.deepEqual(status.automaticSources, ["admin_quick_sale"]);
  assert.equal(status.blockers.length, 0);
});

test("readiness informa campos faltantes de forma específica", () => {
  const status = buildArcaOperationalStatus({
    env: baseEnv,
    safeStatus: readySafeStatus({ pointOfSaleConfigured: false }),
    pdfStatus: { ready: false, missing: ["commercialAddress"] },
    runtime: readyRuntime({
      pointOfSale: { status: "unknown", selected: null, found: false, operational: false },
    }),
  });
  assert.equal(status.configured, false);
  assert.equal(status.operational, false);
  assert.equal(status.pdfReady, false);
  assert.equal(status.blockers.some((item) => item.message === "Falta: domicilio comercial del emisor."), true);
  assert.equal(status.blockers.some((item) => item.code === "arca-point-of-sale-missing"), true);
});

test("readiness nunca expone certificado, private key, TA ni service account", () => {
  const env = {
    ...baseEnv,
    ARCA_CERTIFICATE_PEM: "CERTIFICADO_SUPER_SECRETO",
    ARCA_PRIVATE_KEY_PEM: "PRIVATE_KEY_SUPER_SECRETA",
    ARCA_TA_ENCRYPTION_KEY: "TA_KEY_SUPER_SECRETA",
    FIREBASE_SERVICE_ACCOUNT_JSON: "{\"private_key\":\"FIREBASE_SUPER_SECRETO\"}",
  };
  const status = buildArcaOperationalStatus({
    env,
    safeStatus: readySafeStatus(),
    pdfStatus: { ready: true, missing: [] },
    runtime: readyRuntime(),
  });
  const serialized = JSON.stringify(status);
  assert.equal(serialized.includes("CERTIFICADO_SUPER_SECRETO"), false);
  assert.equal(serialized.includes("PRIVATE_KEY_SUPER_SECRETA"), false);
  assert.equal(serialized.includes("TA_KEY_SUPER_SECRETA"), false);
  assert.equal(serialized.includes("FIREBASE_SUPER_SECRETO"), false);
});

test("production auto off no vuelve no-operativa la integración ni habilita automatización", () => {
  const status = buildArcaOperationalStatus({
    env: baseEnv,
    safeStatus: readySafeStatus({ productionAutoAuthorizeEnabled: false }),
    pdfStatus: { ready: true, missing: [] },
    runtime: readyRuntime(),
  });
  assert.equal(status.operational, true);
  assert.equal(status.emissionEnabled, true);
  assert.equal(status.automaticBillingEnabled, false);
  assert.equal(status.services.automaticBilling.status, "disabled");
});

test("production CAE off mantiene readiness pero informa emisión deshabilitada", () => {
  const status = buildArcaOperationalStatus({
    env: baseEnv,
    safeStatus: readySafeStatus({ productionCaeEnabled: false }),
    pdfStatus: { ready: true, missing: [] },
    runtime: readyRuntime(),
  });
  assert.equal(status.operational, true);
  assert.equal(status.emissionEnabled, false);
  assert.equal(status.automaticBillingEnabled, false);
});

test("PDF readiness forma parte de la operatividad sin confundirse con emisión", () => {
  const status = buildArcaOperationalStatus({
    env: baseEnv,
    safeStatus: readySafeStatus(),
    pdfStatus: { ready: false, missing: ["legalName", "activityStart"] },
    runtime: readyRuntime(),
  });
  assert.equal(status.configured, true);
  assert.equal(status.operational, false);
  assert.equal(status.emissionEnabled, true);
  assert.equal(status.services.pdf.status, "error");
  assert.equal(status.blockers.some((item) => item.message.includes("razón social")), true);
});

test("taxpayer lookup readiness distingue deshabilitado, error temporal y listo", () => {
  const disabled = buildArcaOperationalStatus({
    env: baseEnv,
    safeStatus: readySafeStatus({ productionTaxpayerLookupEnabled: false }),
    pdfStatus: { ready: true, missing: [] },
    runtime: readyRuntime(),
  });
  assert.equal(disabled.taxpayerLookupEnabled, false);
  assert.equal(disabled.taxpayerLookupReady, false);
  assert.equal(disabled.services.taxpayerLookup.status, "disabled");
  assert.equal(disabled.productionReady, true);

  const unavailable = buildArcaOperationalStatus({
    env: baseEnv,
    safeStatus: readySafeStatus(),
    pdfStatus: { ready: true, missing: [] },
    runtime: readyRuntime({
      taxpayerLookup: {
        status: "error",
        error: { code: "arca-network-error", status: 503, message: "Servicio temporalmente no disponible." },
      },
    }),
  });
  assert.equal(unavailable.taxpayerLookupEnabled, true);
  assert.equal(unavailable.taxpayerLookupReady, false);
  assert.equal(unavailable.services.taxpayerLookup.temporary, true);
  assert.equal(unavailable.productionReady, true);

  const ready = buildArcaOperationalStatus({
    env: baseEnv,
    safeStatus: readySafeStatus(),
    pdfStatus: { ready: true, missing: [] },
    runtime: readyRuntime(),
  });
  assert.equal(ready.taxpayerLookupReady, true);
  assert.equal(ready.productionReady, true);
});
