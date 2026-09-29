import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { auth, db } from "./firebase";

async function authenticatedPost(payload) {
  const user = auth.currentUser;
  if (!user) throw new Error("Iniciá sesión para usar la integración ARCA.");
  const token = await user.getIdToken();
  const response = await fetch("/.netlify/functions/arca-taxpayer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) {
    const error = new Error(data?.message || "No se pudo completar la operación ARCA.");
    error.code = data?.code || "arca-request-error";
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function getArcaSafeStatus() {
  const data = await authenticatedPost({ mode: "status" });
  return data.status;
}

export async function getArcaWsaaCacheStatus() {
  const data = await authenticatedPost({ mode: "wsaa-cache-status" });
  return data.cache;
}

export async function runArcaWsaaSharedSmoke() {
  const data = await authenticatedPost({ mode: "wsaa-shared-smoke" });
  return data.smoke;
}

export async function runArcaWsaaRegistrySharedSmoke() {
  const data = await authenticatedPost({ mode: "wsaa-registry-shared-smoke" });
  return data.smoke;
}

export async function runArcaDiagnostics() {
  const data = await authenticatedPost({ mode: "diagnostics" });
  return data.diagnostics;
}

export async function lookupArcaTaxpayer(cuit) {
  const data = await authenticatedPost({ cuit: String(cuit || "").trim() });
  return data;
}


export async function requestPendingArcaInvoice({ sourceType, sourceId, receiver = null }) {
  const user = auth.currentUser;
  if (!user) throw new Error("Iniciá sesión para preparar la facturación.");
  const token = await user.getIdToken();
  const response = await fetch("/.netlify/functions/arca-invoice", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ sourceType, sourceId, receiver }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) {
    const error = new Error(data?.message || "No se pudo preparar la solicitud de factura.");
    error.code = data?.code || "arca-invoice-request-error";
    error.status = response.status;
    throw error;
  }
  return data.invoice;
}


export async function dryRunArcaInvoice({ invoiceId, receiver = null }) {
  const user = auth.currentUser;
  if (!user) throw new Error("Iniciá sesión para validar la facturación.");
  const token = await user.getIdToken();
  const response = await fetch("/.netlify/functions/arca-authorize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      mode: "dry-run",
      invoiceId,
      ...(receiver ? { receiver } : {}),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) {
    const error = new Error(data?.message || "No se pudo validar la factura.");
    error.code = data?.code || "arca-dry-run-error";
    error.status = response.status;
    throw error;
  }
  return data.result;
}


export async function listRecentArcaInvoices({ pageSize = 10 } = {}) {
  const safePageSize = Math.min(25, Math.max(1, Number(pageSize) || 10));
  const snapshot = await getDocs(query(
    collection(db, "invoices"),
    orderBy("createdAt", "desc"),
    limit(safePageSize),
  ));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function arcaAuthorizationPost(payload) {
  const user = auth.currentUser;
  if (!user) throw new Error("Iniciá sesión para usar la autorización fiscal.");
  const token = await user.getIdToken();
  const response = await fetch("/.netlify/functions/arca-authorize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) {
    const error = new Error(data?.message || "No se pudo completar la operación fiscal.");
    error.code = data?.code || "arca-authorize-error";
    error.status = response.status;
    throw error;
  }
  return data.result;
}

export async function authorizeArcaInvoice({ invoiceId, receiver = null }) {
  return arcaAuthorizationPost({
    mode: "authorize",
    invoiceId,
    ...(receiver ? { receiver } : {}),
  });
}

export async function reconcileArcaInvoice({ invoiceId }) {
  return arcaAuthorizationPost({
    mode: "reconcile",
    invoiceId,
  });
}


export async function recoverPreCaeArcaInvoice({ invoiceId }) {
  return arcaAuthorizationPost({
    mode: "recover-pre-cae",
    invoiceId,
  });
}


export async function verifyAuthorizedArcaInvoice({ invoiceId }) {
  return arcaAuthorizationPost({
    mode: "verify-authorized",
    invoiceId,
  });
}
