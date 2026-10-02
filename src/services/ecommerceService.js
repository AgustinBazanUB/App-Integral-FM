import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../gestion/services/firebase";

function safeJson(response) {
  return response.json().catch(() => ({}));
}

export async function fetchEcommerceCatalog({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl("/.netlify/functions/ecommerce-catalog", {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const data = await safeJson(response);
  if (!response.ok || data?.ok !== true) {
    const error = new Error(data?.message || "No se pudo cargar el catálogo comercial.");
    error.code = data?.code || "ecommerce-catalog-error";
    error.status = response.status;
    throw error;
  }
  return data.catalog;
}

export async function createEcommerceOrder(payload, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl("/.netlify/functions/ecommerce-checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await safeJson(response);
  if (!response.ok || data?.ok !== true) {
    const error = new Error(data?.message || "No se pudo crear el pedido.");
    error.code = data?.code || "ecommerce-checkout-error";
    error.status = response.status;
    throw error;
  }
  return data;
}


async function simulatedPaymentPost(payload) {
  const user = auth.currentUser;
  if (!user) {
    const error = new Error("Iniciá sesión como administrador para usar la simulación local.");
    error.code = "unauthenticated";
    error.status = 401;
    throw error;
  }
  const token = await user.getIdToken();
  const response = await fetch("/.netlify/functions/ecommerce-simulated-payment", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await safeJson(response);
  if (!response.ok || data?.ok !== true) {
    const error = new Error(data?.message || "No se pudo completar la simulación Ecommerce.");
    error.code = data?.code || "ecommerce-simulation-error";
    error.status = response.status;
    error.phase = data?.phase || null;
    error.payment = data?.payment || null;
    error.orderId = data?.orderId || null;
    throw error;
  }
  return data;
}

export async function fetchEcommerceSimulationCapability() {
  const data = await simulatedPaymentPost({ mode: "status" });
  return data.capability;
}

export function observeEcommerceSimulationCapability(callback) {
  let cancelled = false;
  const unsubscribe = onAuthStateChanged(auth, async (user) => {
    if (!user) {
      if (!cancelled) callback({ enabled: false, localRuntime: false, adminRequired: true });
      return;
    }
    try {
      const capability = await fetchEcommerceSimulationCapability();
      if (!cancelled) callback(capability);
    } catch {
      if (!cancelled) callback({ enabled: false, localRuntime: false, adminRequired: true });
    }
  });
  return () => {
    cancelled = true;
    unsubscribe();
  };
}

export async function simulateApprovedEcommercePayment({
  orderId,
  idempotencyKey,
  receiverCuit = "",
}) {
  return simulatedPaymentPost({
    mode: "simulate-approved",
    orderId,
    idempotencyKey,
    receiverCuit,
  });
}
