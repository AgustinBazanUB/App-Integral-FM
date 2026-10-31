import { createRequire } from "node:module";
import { commerceError } from "./commerceDomain.mjs";
import { configuredFirebaseProjectId, assertFirebaseServiceAccountProject } from "../firebaseProject.mjs";

export const PAYWAY_TOKEN_URL = "https://developers.decidir.com/api/v2";
export const PAYWAY_SCRIPT_URL = "https://ventasonline.payway.com.ar/static/v2.6.4/decidir.js";

export function paywayConfig(env = process.env) {
  if (env.PAYWAY_ENVIRONMENT !== "sandbox" || env.PAYWAY_ENABLED !== "true")
    throw commerceError("payway-disabled", "Payway Sandbox no está habilitado.", 503);
  if (configuredFirebaseProjectId(env) !== "app-integral-fm-pruebas"
      || env.VITE_PREVIEW_FIREBASE_PROJECT_ID !== "app-integral-fm-pruebas"
      || env.ARCA_ENVIRONMENT !== "homologation" || env.CONTEXT === "production")
    throw commerceError("payway-isolation-required", "Payway Sandbox requiere Firebase de pruebas y ARCA homologación.", 403);
  // Check the actual credential, not just the project label. No production fallback.
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    let account;
    try { account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON); } catch { throw commerceError("payway-isolation-required", "Credencial de pruebas inválida.", 503); }
    if (account.project_id !== "app-integral-fm-pruebas") throw commerceError("payway-isolation-required", "Credencial de otro proyecto.", 403);
    assertFirebaseServiceAccountProject(account.project_id, account.client_email);
    if (!account.private_key) throw commerceError("payway-isolation-required", "La credencial de pruebas está incompleta.", 503);
  } else {
    assertFirebaseServiceAccountProject("app-integral-fm-pruebas", env.FIREBASE_ADMIN_CLIENT_EMAIL);
    if (!env.FIREBASE_ADMIN_PRIVATE_KEY) throw commerceError("payway-isolation-required", "Falta la credencial exclusiva de pruebas.", 503);
  }
  if (env.FIREBASE_ADMIN_CLIENT_EMAIL) assertFirebaseServiceAccountProject("app-integral-fm-pruebas", env.FIREBASE_ADMIN_CLIENT_EMAIL);
  const siteId = String(env.PAYWAY_SANDBOX_SITE_ID || "");
  const publicKey = String(env.PAYWAY_SANDBOX_PUBLIC_KEY || "");
  const privateKey = String(env.PAYWAY_SANDBOX_PRIVATE_KEY || "");
  if (!/^\d{1,12}$/.test(siteId) || !/^[\w-]{20,200}$/.test(publicKey) || !/^[\w-]{20,200}$/.test(privateKey))
    throw commerceError("payway-config-missing", "Falta completar la configuración segura de Payway Sandbox.", 503);
  return { siteId, publicKey, privateKey, environment: "sandbox" };
}

export function paywayPublicConfig(env = process.env) {
  try {
    const { siteId, publicKey } = paywayConfig(env);
    return { enabled: true, environment: "sandbox", siteId, publicKey, tokenUrl: PAYWAY_TOKEN_URL, scriptUrl: PAYWAY_SCRIPT_URL,
      isolation: { firebaseProjectId: "app-integral-fm-pruebas", credentialProjectVerified: true, authDomain: env.VITE_PREVIEW_FIREBASE_AUTH_DOMAIN || "", arcaEnvironment: "homologation" },
      paymentMethods: [{ id: 104, name: "Mastercard crédito Payway" }], installments: [1] };
  } catch { return { enabled: false, environment: "sandbox" }; }
}

export function paywayAmount(pesos) {
  const cents = Math.round(Number(pesos) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || Math.abs(cents / 100 - Number(pesos)) > 0.000001)
    throw commerceError("payway-amount-invalid", "Importe inválido para Payway.", 409);
  return cents;
}

let sdkConstructor;
function safeSdk() {
  if (sdkConstructor) return sdkConstructor;
  const require = createRequire(import.meta.url);
  // The pinned vendor SDK logs API keys and complete payloads. Disable ONLY its
  // private logger before loading it; never replace the application's console.
  const logger = require("sdk-node-payway/lib/utils/logger.js");
  for (const key of Object.keys(logger)) logger[key] = () => {};
  const transport = require("node-rest-client");
  const OriginalClient = transport.Client;
  transport.Client = function SafePaywayClient() {
    const client = new OriginalClient({ requestConfig: { timeout: 9000 }, responseConfig: { timeout: 9000 } });
    for (const verb of ["get", "post"]) {
      const original = client[verb].bind(client);
      client[verb] = (url, args, callback) => {
        let settled = false;
        const done = (data) => { if (!settled) { settled = true; callback(data); } };
        const fail = () => done({ transport_error: true });
        client.on("error", fail);
        const request = original(url, args, done);
        request.on("error", fail);
        request.on("requestTimeout", (req) => { fail(); req.destroy(); });
        request.on("responseTimeout", (res) => { fail(); res.destroy(); });
        return request;
      };
    }
    return client;
  };
  sdkConstructor = require("sdk-node-payway").sdk;
  return sdkConstructor;
}

export function createPaywayGateway(env = process.env) {
  const config = paywayConfig(env);
  const Sdk = safeSdk();
  const sdk = new Sdk("developer", config.publicKey, config.privateKey, "", "");
  const call = (method, ...args) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(commerceError("payway-uncertain", "El resultado se está verificando. No vuelvas a pagar.", 503)), 11000);
    try {
      sdk[method](...args, (data) => {
        clearTimeout(timer);
        if (!data || data.transport_error) reject(commerceError("payway-uncertain", "El resultado se está verificando. No vuelvas a pagar.", 503));
        else resolve(data);
      });
    } catch { clearTimeout(timer); reject(commerceError("payway-uncertain", "No se pudo verificar la respuesta de Payway.", 503)); }
  });
  return {
    charge: (payload) => call("payment", payload),
    find: async (operationId) => {
      const result = await call("getAllPayments", 0, 50, operationId, config.siteId);
      // Never turn an auth error, invalid response, or absent result into a new POST.
      if (!Array.isArray(result.results)) throw commerceError("payway-uncertain", "Payway todavía no confirmó la consulta.", 503);
      return result.results.filter((row) => row.site_transaction_id === operationId);
    },
    info: (paymentId) => call("paymentInfo", paymentId),
  };
}

export function verifiedPaywayReceipt(response, expected) {
  if (!response || response.site_transaction_id !== expected.operationId
      || String(response.site_id) !== String(expected.siteId)
      || Number(response.amount) !== expected.amount || String(response.currency).toUpperCase() !== "ARS"
      || Number(response.payment_method_id) !== 104 || Number(response.installments) !== 1
      || !/^[0-9]{1,30}$/.test(String(response.id || "")))
    throw commerceError("payway-response-mismatch", "La respuesta de Payway necesita conciliación administrativa.", 409);
  const status = String(response.status || "").toLowerCase();
  const mapped = ({ approved: "approved", rejected: "rejected", cancelled: "cancelled", canceled: "cancelled" })[status] || "pending";
  return { verified: true, environment: "sandbox", siteId: String(response.site_id), operationId: response.site_transaction_id,
    providerId: String(response.id), amount: Number(response.amount), currency: "ARS",
    status: mapped, providerStatus: status, paymentMethodId: 104, installments: 1 };
}
