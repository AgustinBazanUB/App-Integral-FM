import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  confirmPayment,
  ecommerceSimulatedPaymentEnabled,
  isLocalEcommerceRuntime,
} from "../netlify/functions/_lib/ecommerce/paymentContract.mjs";

const localEnv = {
  NODE_ENV: "test",
  CONTEXT: "dev",
  ECOMMERCE_SIMULATED_PAYMENT_ENABLED: "true",
};

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Etapa 6: flag off bloquea simulation", () => {
  const env = { ...localEnv, ECOMMERCE_SIMULATED_PAYMENT_ENABLED: "false" };
  assert.equal(ecommerceSimulatedPaymentEnabled(env), false);
  assert.throws(
    () => confirmPayment({ provider: "simulation", status: "approved", reference: "sim-1" }, { env }),
    (error) => error?.code === "ecommerce-simulated-payment-disabled",
  );
});

test("Etapa 6: simulation sólo habilita runtime local", () => {
  assert.equal(ecommerceSimulatedPaymentEnabled(localEnv), true);
  assert.equal(isLocalEcommerceRuntime({ NODE_ENV: "production", CONTEXT: "production" }), false);
  assert.equal(
    ecommerceSimulatedPaymentEnabled({
      ECOMMERCE_SIMULATED_PAYMENT_ENABLED: "true",
      NODE_ENV: "production",
      CONTEXT: "deploy-preview",
    }),
    false,
  );
});

test("Etapa 6: payment contract no mezcla simulation con Payway", () => {
  const simulation = confirmPayment(
    { provider: "simulation", status: "approved", reference: "sim-2" },
    { env: localEnv },
  );
  const payway = confirmPayment(
    { provider: "payway", status: "approved", reference: "pw-2" },
    { env: localEnv },
  );
  assert.equal(simulation.paymentProvider, "simulation");
  assert.equal(simulation.paymentStatus, "simulated_approved");
  assert.equal(payway.paymentProvider, "payway");
  assert.equal(payway.paymentStatus, "approved");
});

test("Etapa 6: simulation no admite pending ni rejected", () => {
  for (const status of ["pending", "rejected"]) {
    assert.throws(
      () => confirmPayment({ provider: "simulation", status, reference: `sim-${status}` }, { env: localEnv }),
      (error) => error?.code === "ecommerce-simulation-status-invalid",
    );
  }
});

test("Etapa 6: endpoint local exige admin y usa contrato simulation", async () => {
  const source = await read("../netlify/functions/ecommerce-simulated-payment.mjs");
  assert.match(source, /requireFirebaseAdmin/);
  assert.match(source, /provider: "simulation"/);
  assert.match(source, /status: "approved"/);
  assert.match(source, /prepareEcommerceInvoiceFiscal/);
});

test("Etapa 6: flujo fiscal Ecommerce no contiene transporte FECAESolicitar", async () => {
  const source = [
    await read("../netlify/functions/_lib/ecommerce/fiscalService.mjs"),
    await read("../netlify/functions/ecommerce-simulated-payment.mjs"),
  ].join("\n");
  assert.doesNotMatch(
    source,
    /FECAESolicitar|requestCae\s*\(|allowCaeRequest\s*:\s*true|authorizeInvoice\s*\(/,
  );
  assert.match(source, /buildAuthorizationPlan/);
  assert.match(source, /caeRequested: false/);
  assert.match(source, /transport: "blocked"/);
});

test("Etapa 6: invoicePersistence sólo acepta Ecommerce con pago confiable", async () => {
  const source = await read("../netlify/functions/_lib/arca/invoicePersistence.mjs");
  assert.match(source, /status === "simulated_approved" && provider === "simulation"/);
  assert.match(source, /status === "approved" && provider === "payway"/);
  assert.match(source, /ecommerce-payment-not-approved/);
});

test("Etapa 6: Firestore mantiene payment/fiscal authority fuera del navegador", async () => {
  const rules = await read("../firestore.rules");
  assert.match(rules, /match \/orders\/\{orderId\}[\s\S]*allow create, update, delete: if false/);
  assert.match(rules, /match \/payments\/\{paymentId\}[\s\S]*allow create, update, delete: if false/);
  assert.match(rules, /match \/invoices\/\{invoiceId\}[\s\S]*allow create, update, delete: if false/);
  assert.match(rules, /sourceType != "ecommerce"/);
});

test("Etapa 6: UI advierte pago simulado y no usa VITE para habilitar backend", async () => {
  const [checkout, service, env] = await Promise.all([
    read("../src/pages/CheckoutPage.jsx"),
    read("../src/services/ecommerceService.js"),
    read("../.env.example"),
  ]);
  assert.match(checkout, /Este checkout no procesa un pago real/);
  assert.match(checkout, /La acción simulará un pago aprobado/);
  assert.match(checkout, /La factura fiscal puede ser real si la emisión productiva está habilitada/);
  assert.match(service, /ecommerce-simulated-payment/);
  assert.match(env, /^ECOMMERCE_SIMULATED_PAYMENT_ENABLED=false$/m);
  assert.doesNotMatch(checkout + service + env, /VITE_.*SIMULATED_PAYMENT/);
});

test("Etapa 6: allowlist productiva por default sigue limitada a admin_quick_sale", async () => {
  const [config, env] = await Promise.all([
    read("../netlify/functions/_lib/arca/config.mjs"),
    read("../.env.example"),
  ]);
  assert.match(config, /ARCA_AUTO_AUTHORIZE_PRODUCTION_SOURCES \?\? "admin_quick_sale"/);
  assert.match(env, /^ARCA_AUTO_AUTHORIZE_PRODUCTION_SOURCES=admin_quick_sale$/m);
  assert.doesNotMatch(env, /^ARCA_AUTO_AUTHORIZE_PRODUCTION_SOURCES=.*ecommerce/m);
});
