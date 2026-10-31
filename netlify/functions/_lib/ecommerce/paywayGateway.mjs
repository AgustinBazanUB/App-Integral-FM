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
      paymentMethods: [{ id: 104, name: "Mastercard crédito Payway" }, { id: 1, name: "Visa crédito Sandbox" }], installments: [1] };
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
  // 1.0.8's retail mapper omits the documented device identifier. Preserve it
  // when adapting the official SDK; otherwise token and risk assessment diverge.
  const retail = require("sdk-node-payway/lib/services/fraud_detection/cs_retail.js");
  const originalRetail = retail.generateRetailData;
  retail.generateRetailData = args => ({ ...originalRetail(args), device_unique_id: args.device_unique_id });
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
      || Number(response.payment_method_id) !== Number(expected.paymentMethodId || 104) || Number(response.installments) !== 1
      || !/^[0-9]{1,30}$/.test(String(response.id || "")))
    throw commerceError("payway-response-mismatch", "La respuesta de Payway necesita conciliación administrativa.", 409);
  const status = String(response.status || "").toLowerCase();
  const mapped = ({ approved: "approved", rejected: "rejected", cancelled: "cancelled", canceled: "cancelled" })[status] || "pending";
  return { verified: true, environment: "sandbox", siteId: String(response.site_id), operationId: response.site_transaction_id,
    providerId: String(response.id), amount: Number(response.amount), currency: "ARS",
    status: mapped, providerStatus: status, paymentMethodId: Number(response.payment_method_id), installments: 1,
    errorType: /^[a-z_]{1,60}$/.test(response.status_details?.error?.type || "") ? response.status_details.error.type : null };
}

export function paywayRetailRisk(order, { payerAddress, fingerprint, clientIp } = {}) {
  const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
  const address = { street: clean(payerAddress?.street, 100), city: clean(payerAddress?.city, 50),
    provinceCode: clean(payerAddress?.provinceCode, 1), postalCode: clean(payerAddress?.postalCode, 10) };
  if (!address.street || !address.city || !address.postalCode || !/^[ABCDEFGHJKLMNPQRSTUVWXYZ]$/.test(address.provinceCode)
      || !/^[A-Za-z0-9_-]{16,80}$/.test(fingerprint || "") || !clientIp)
    throw commerceError("payway-risk-data-required", "Completá el domicilio de facturación y esperá a que cargue la validación segura.", 400);
  const names = String(order.customer.fullName).trim().split(/\s+/);
  const billTo = { city: address.city, country: "AR", customer_id: order.idempotencyKey,
    email: order.customer.email, first_name: names[0], last_name: names.slice(1).join(" ") || names[0],
    phone_number: order.customer.phone.replace(/\D/g,""), postal_code: address.postalCode,
    state: address.provinceCode, street1: address.street };
  const destination = order.shipping.method === "delivery" ? order.shipping.address : null;
  const items = order.items.map(item => ({ code: item.productId, name: item.name, description: item.name,
    sku: item.productId, total_amount: paywayAmount(item.subtotal), quantity: item.quantity, unit_price: paywayAmount(item.unitPrice) }));
  if (order.shippingAmount > 0) items.push({ code: "shipping", name: "Envio", description: "Envio", sku: "shipping", total_amount: paywayAmount(order.shippingAmount), quantity: 1, unit_price: paywayAmount(order.shippingAmount) });
  return { send_to_cs: true, channel: "web", device_unique_id: fingerprint, bill_to: billTo,
    purchase_totals: { currency: "ARS", amount: paywayAmount(order.total) },
    customer_in_site: { days_in_site: 0, is_guest: true, num_of_transactions: 0 },
    retail_transaction_data: { dispatch_method: destination ? "homeDelivery" : "click and collect", days_to_delivery: "3",
      tax_voucher_required: order.billing?.mode === "fiscal", items,
      ship_to: destination ? { ...billTo, city: destination.city, postal_code: destination.postalCode,
        street1: `${destination.street} ${destination.number}`, state: address.provinceCode } : billTo },
  };
}
