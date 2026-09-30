import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { formatCuit, isValidCuit, normalizeCuit } from "../src/shared/fiscal/cuit.js";
import { resolveFiscalReceiver } from "../netlify/functions/_lib/arca/fiscalReceiverResolver.mjs";
import { toPublicArcaError } from "../netlify/functions/_lib/arca/publicError.mjs";

const productionEnv = {
  ARCA_ENVIRONMENT: "production",
  ARCA_ALLOW_PRODUCTION_TAXPAYER_LOOKUP: "true",
  ARCA_CONSUMER_FINAL_ID_THRESHOLD: "10000000",
};

test("helper CUIT compartido conserva normalización, validación y formato", () => {
  assert.equal(normalizeCuit("20-12345678-6"), "20123456786");
  assert.equal(isValidCuit("20-12345678-6"), true);
  assert.equal(formatCuit("20123456786"), "20-12345678-6");
  assert.equal(isValidCuit("20-12345678-0"), false);
});

test("Consumidor Final devuelve receiver normalizado sin lookup ARCA", async () => {
  let lookupCalls = 0;
  const result = await resolveFiscalReceiver({
    mode: "consumer_final",
    saleTotal: 5000,
    env: productionEnv,
    lookupTaxpayer: async () => {
      lookupCalls += 1;
      throw new Error("no debe ejecutarse");
    },
  });
  assert.deepEqual(result.receiver, {
    vatConditionId: 5,
    documentType: 99,
    documentNumber: "0",
    anonymousConsumerFinal: true,
    concept: 1,
  });
  assert.equal(result.lookupPerformed, false);
  assert.equal(lookupCalls, 0);
});

test("Consumidor Final respeta el umbral configurado de identificación", async () => {
  await assert.rejects(
    resolveFiscalReceiver({
      mode: "consumer_final",
      saleTotal: 10000000,
      env: productionEnv,
    }),
    (error) => error?.code === "consumer-final-identification-required",
  );
});

test("Consumidor Final no inventa umbral si falta configuración", async () => {
  await assert.rejects(
    resolveFiscalReceiver({
      mode: "consumer_final",
      saleTotal: 1000,
      env: { ARCA_ENVIRONMENT: "production" },
    }),
    (error) => error?.code === "arca-config-missing",
  );
});

test("CUIT válido resuelve padrón e infiere IVA Responsable Inscripto", async () => {
  const result = await resolveFiscalReceiver({
    mode: "cuit",
    cuit: "20-12345678-6",
    env: productionEnv,
    lookupTaxpayer: async (cuit) => ({
      cuit,
      found: true,
      businessName: "EMPRESA DEMO SA",
      firstName: null,
      lastName: null,
      personType: "JURIDICA",
      keyStatus: "ACTIVO",
      fiscalAddress: {
        address: "CALLE 123",
        locality: "CABA",
        postalCode: "1000",
        province: "CIUDAD AUTONOMA BUENOS AIRES",
      },
      taxes: [{ id: 30, status: "AC", description: "IVA" }],
      monotributo: false,
      monotributoData: null,
    }),
  });
  assert.deepEqual(result.receiver, {
    vatConditionId: 1,
    documentType: 80,
    documentNumber: "20123456786",
    anonymousConsumerFinal: false,
    concept: 1,
  });
  assert.equal(result.review.displayName, "EMPRESA DEMO SA");
  assert.equal(result.review.vatCondition.id, 1);
  assert.equal(result.review.keyStatus, "ACTIVO");
});

test("CUIT inválido falla antes de llamar al padrón", async () => {
  let lookupCalls = 0;
  await assert.rejects(
    resolveFiscalReceiver({
      mode: "cuit",
      cuit: "20-12345678-0",
      env: productionEnv,
      lookupTaxpayer: async () => {
        lookupCalls += 1;
      },
    }),
    (error) => error?.code === "arca-cuit-invalid",
  );
  assert.equal(lookupCalls, 0);
});

test("contribuyente no encontrado se diferencia de una caída técnica", async () => {
  await assert.rejects(
    resolveFiscalReceiver({
      mode: "cuit",
      cuit: "20-12345678-6",
      env: productionEnv,
      lookupTaxpayer: async (cuit) => ({ cuit, found: false }),
    }),
    (error) => error?.code === "fiscal-taxpayer-not-found",
  );

  const technical = new Error("SOAP con TOKEN-SUPER-SECRETO");
  technical.code = "arca-network-error";
  technical.status = 502;
  const safe = toPublicArcaError(technical);
  assert.equal(safe.category, "TEMPORARY_UPSTREAM_ERROR");
  assert.equal(safe.message.includes("TOKEN-SUPER-SECRETO"), false);
});

test("condición fiscal no resoluble devuelve error específico", async () => {
  await assert.rejects(
    resolveFiscalReceiver({
      mode: "cuit",
      cuit: "20-12345678-6",
      env: productionEnv,
      lookupTaxpayer: async (cuit) => ({
        cuit,
        found: true,
        keyStatus: "ACTIVO",
        taxes: [],
        monotributo: false,
        monotributoData: null,
      }),
    }),
    (error) => error?.code === "fiscal-vat-condition-unresolved",
  );
});

test("lookup productivo apagado se informa como configuración y no consulta ARCA", async () => {
  let lookupCalls = 0;
  await assert.rejects(
    resolveFiscalReceiver({
      mode: "cuit",
      cuit: "20-12345678-6",
      env: {
        ARCA_ENVIRONMENT: "production",
        ARCA_ALLOW_PRODUCTION_TAXPAYER_LOOKUP: "false",
        ARCA_CONSUMER_FINAL_ID_THRESHOLD: "10000000",
      },
      lookupTaxpayer: async () => {
        lookupCalls += 1;
      },
    }),
    (error) => error?.code === "arca-production-taxpayer-lookup-disabled",
  );
  assert.equal(lookupCalls, 0);
});

test("catálogo público clasifica configuración sin reflejar secretos", () => {
  const error = new Error("SENSITIVE_SENTINEL_VALUE");
  error.code = "arca-config-missing";
  error.status = 409;
  const safe = toPublicArcaError(error);
  assert.equal(safe.category, "CONFIGURATION_ERROR");
  assert.equal(JSON.stringify(safe).includes("SENSITIVE_SENTINEL_VALUE"), false);
});

test("resolver y endpoint compartido no contienen caminos de emisión CAE", async () => {
  const resolverSource = await readFile(new URL("../netlify/functions/_lib/arca/fiscalReceiverResolver.mjs", import.meta.url), "utf8");
  const endpointSource = await readFile(new URL("../netlify/functions/arca-receiver.mjs", import.meta.url), "utf8");
  const source = resolverSource + "\n" + endpointSource;
  assert.doesNotMatch(source, /requestCae|authorizeInvoice|FECAESolicitar/);
  assert.doesNotMatch(source, /arca-authorize/);
});
