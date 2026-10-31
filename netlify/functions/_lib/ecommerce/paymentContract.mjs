import { commerceError } from "./commerceDomain.mjs";

export const PAYMENT_PROVIDERS = Object.freeze({
  SIMULATION: "simulation",
  PAYWAY: "payway",
});

export const PAYMENT_STATUSES = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
  SIMULATED_APPROVED: "simulated_approved",
});

function isTrue(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

export function isLocalEcommerceRuntime(env = process.env) {
  const context = String(env.CONTEXT || "").trim().toLowerCase();
  if (["production", "deploy-preview", "branch-deploy"].includes(context)) return false;
  return (
    context === "dev"
    || isTrue(env.NETLIFY_DEV)
    || isTrue(env.NETLIFY_LOCAL)
  );
}

export function ecommerceSimulatedPaymentEnabled(env = process.env) {
  const isolated = env.NODE_ENV === "test" || (env.FIREBASE_PROJECT_ID === "app-integral-fm-pruebas" && env.VITE_PREVIEW_FIREBASE_PROJECT_ID === "app-integral-fm-pruebas" && env.ARCA_ENVIRONMENT === "homologation");
  return isolated && isTrue(env.ECOMMERCE_SIMULATED_PAYMENT_ENABLED) && (isLocalEcommerceRuntime(env) || isolatedPreview(env));
}

function isolatedPreview(env) {
  return ["deploy-preview", "branch-deploy"].includes(env.CONTEXT)
    && env.FIREBASE_PROJECT_ID === "app-integral-fm-pruebas"
    && env.VITE_PREVIEW_FIREBASE_PROJECT_ID === "app-integral-fm-pruebas"
    && env.ARCA_ENVIRONMENT === "homologation";
}

export function assertEcommerceSimulationEnabled(env = process.env) {
  if (!isTrue(env.ECOMMERCE_SIMULATED_PAYMENT_ENABLED)) {
    throw commerceError(
      "ecommerce-simulated-payment-disabled",
      "La simulación de pago está deshabilitada.",
      409,
    );
  }
  if (!isLocalEcommerceRuntime(env) && !isolatedPreview(env)) {
    throw commerceError(
      "ecommerce-simulated-payment-local-only",
      "La simulación de pago sólo puede utilizarse desde un entorno local autorizado.",
      403,
    );
  }
  if (env.NODE_ENV !== "test" && (env.FIREBASE_PROJECT_ID !== "app-integral-fm-pruebas" || env.VITE_PREVIEW_FIREBASE_PROJECT_ID !== "app-integral-fm-pruebas" || env.ARCA_ENVIRONMENT !== "homologation")) throw commerceError("ecommerce-simulation-isolation-required", "Las simulaciones requieren Firebase de pruebas y ARCA homologación.", 403);
  return true;
}

function cleanReference(value) {
  const reference = String(value || "").trim();
  if (!reference || reference.length > 180) {
    throw commerceError(
      "ecommerce-payment-reference-invalid",
      "La referencia del pago no es válida.",
      400,
    );
  }
  return reference;
}

export function confirmPayment({ provider, status, reference } = {}, { env = process.env } = {}) {
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  const normalizedStatus = String(status || "").trim().toLowerCase();
  const normalizedReference = cleanReference(reference);

  if (normalizedProvider === PAYMENT_PROVIDERS.SIMULATION) {
    assertEcommerceSimulationEnabled(env);
    if (normalizedStatus !== PAYMENT_STATUSES.APPROVED) {
      throw commerceError(
        "ecommerce-simulation-status-invalid",
        "La simulación local sólo admite la transición explícita approved.",
        400,
      );
    }
    return {
      paymentProvider: PAYMENT_PROVIDERS.SIMULATION,
      paymentStatus: PAYMENT_STATUSES.SIMULATED_APPROVED,
      providerStatus: PAYMENT_STATUSES.APPROVED,
      reference: normalizedReference,
      simulated: true,
    };
  }

  if (normalizedProvider === PAYMENT_PROVIDERS.PAYWAY) {
    if (![PAYMENT_STATUSES.PENDING, PAYMENT_STATUSES.APPROVED, PAYMENT_STATUSES.REJECTED, PAYMENT_STATUSES.CANCELLED].includes(normalizedStatus)) {
      throw commerceError(
        "ecommerce-payway-status-invalid",
        "El estado informado por el proveedor de pago no es válido.",
        400,
      );
    }
    return {
      paymentProvider: PAYMENT_PROVIDERS.PAYWAY,
      paymentStatus: normalizedStatus,
      providerStatus: normalizedStatus,
      reference: normalizedReference,
      simulated: false,
    };
  }

  throw commerceError(
    "ecommerce-payment-provider-invalid",
    "El proveedor de pago no es válido.",
    400,
  );
}
