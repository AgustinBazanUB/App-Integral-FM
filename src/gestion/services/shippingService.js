import { collection, doc, onSnapshot, query, where, orderBy, limit } from "firebase/firestore";
import { auth, db } from "./firebase";
import { can } from "../permissions";
const mutationModes = new Set(["create_sale", "create_courier_session", "activate_courier_qr", "approve", "start_preparing", "ready", "incident", "resolve", "reject", "review", "retry", "cancel", "return", "undelivered", "address", "assign", "issue_access", "revoke_access", "delivery_exception", "courier_action", "read_notification"]);
const changesChannel = typeof window !== "undefined" && typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("flor-mia-shipping-changes") : null;
if (changesChannel) changesChannel.onmessage = event => window.dispatchEvent(new CustomEvent("shipping-changed", { detail: event.data }));
const changed = inventoryChanged => { const detail = { inventoryChanged }; window.dispatchEvent(new CustomEvent("shipping-changed", { detail })); changesChannel?.postMessage(detail); };

export async function shippingRequest(body, { publicAccess = false, signal, keepalive = false } = {}) {
  const token = !publicAccess && auth.currentUser ? await auth.currentUser.getIdToken() : null;
  const response = await fetch("/.netlify/functions/shipping", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal, keepalive });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) throw Object.assign(new Error(payload.message || "No se pudo consultar el módulo de envíos."), { code: payload.code, status: response.status });
  if (mutationModes.has(body.mode)) changed(body.mode === "approve" || body.mode === "create_sale" && body.administrative === true);
  return payload.result;
}
export const shippingAction = (shipmentId, mode, data = {}) => shippingRequest({ shipmentId, mode, requestId: crypto.randomUUID(), ...data });
function subscribeWithFallback(reference, body, notify, onError) {
  let stopped = false, timer, loading = false;
  const refresh = async () => {
    if (stopped || loading || document.visibilityState === "hidden") return;
    loading = true;
    try { const rows = await shippingRequest(body); if (!stopped) notify(rows); }
    catch (error) { if (!stopped) onError?.(error); }
    finally { loading = false; }
  };
  const stopSnapshot = onSnapshot(reference, snapshot => notify(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }))), error => {
    if (!["permission-denied", "failed-precondition"].includes(error.code)) return onError?.(error);
    refresh(); timer = setInterval(refresh, 60000);
    window.addEventListener("shipping-changed", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
  });
  return () => { stopped = true; stopSnapshot(); clearInterval(timer); window.removeEventListener("shipping-changed", refresh); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh); };
}
export function subscribeShipments(profile, notify, onError, assigned = false) {
  const constraints = assigned ? [where("assignedPreparerIds", "array-contains", profile.id)] : can(profile, "shipping", "view") ? [] : [where("createdBy", "==", profile.id)];
  return subscribeWithFallback(query(collection(db, "shipments"), where("shippingSchemaVersion", "==", 1), ...constraints, orderBy("updatedAt", "desc"), limit(250)), { mode: "feed", assigned }, notify, onError);
}
export function subscribeShippingShipment(shipmentId, notify, onError) {
  let live = true, data = null, fallbackTimer = null, refreshTimer = null, refreshing = false;
  const refresh = async () => {
    if (!live || refreshing || document.visibilityState === "hidden") return;
    refreshing = true;
    try {
      const serverData = await shippingRequest({ mode: "detail", shipmentId });
      if (!live) return;
      data = { ...(data || {}), ...serverData, events: serverData.events || data?.events || [] };
      notify(data);
    } catch (error) { if (live) onError?.(error); }
    finally { refreshing = false; }
  };
  const startFallback = () => {
    if (fallbackTimer) return;
    void refresh(); fallbackTimer = setInterval(refresh, 15000);
    window.addEventListener("shipping-changed", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
  };
  const stopSnapshot = onSnapshot(doc(db, "shipments", shipmentId), snapshot => {
    if (!live) return;
    if (!snapshot.exists()) { notify(null); return; }
    data = { ...(data || {}), ...snapshot.data(), id: snapshot.id, events: data?.events || [] };
    notify(data);
  }, error => {
    if (["permission-denied", "failed-precondition", "unavailable"].includes(error.code)) startFallback();
    else onError?.(error);
  });
  void refresh();
  refreshTimer = setInterval(refresh, 60000);
  return () => {
    live = false; stopSnapshot(); clearInterval(refreshTimer); clearInterval(fallbackTimer);
    window.removeEventListener("shipping-changed", refresh);
    document.removeEventListener("visibilitychange", refresh);
    window.removeEventListener("focus", refresh);
  };
}
export function subscribeCourierSession(sessionId, notify, onError) {
  if (!sessionId) return () => {};
  let live = true, fallbackTimer = null, refreshing = false;
  const refresh = async () => {
    if (!live || refreshing || document.visibilityState === "hidden") return;
    refreshing = true;
    try { const value = await shippingRequest({ mode: "courier_session_detail", sessionId }); if (live) notify(value); }
    catch (error) { if (live) onError?.(error); }
    finally { refreshing = false; }
  };
  const startFallback = () => {
    if (fallbackTimer) return;
    void refresh(); fallbackTimer = setInterval(refresh, 15000);
    window.addEventListener("shipping-changed", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
  };
  const stopSnapshot = onSnapshot(doc(db, "deliverySessions", sessionId), snapshot => {
    if (snapshot.exists()) notify({ ...snapshot.data(), id: snapshot.id });
    else notify(null);
  }, error => {
    if (["permission-denied", "failed-precondition", "unavailable"].includes(error.code)) startFallback();
    else onError?.(error);
  });
  return () => {
    live = false; stopSnapshot(); clearInterval(fallbackTimer);
    window.removeEventListener("shipping-changed", refresh);
    document.removeEventListener("visibilitychange", refresh);
    window.removeEventListener("focus", refresh);
  };
}
export async function createCourierRouteAccess({ shipmentIds, leg, sessionId, token, requestId }) {
  const result = await shippingRequest({ mode: "create_courier_session", shipmentIds, leg, sessionId, newToken: token, requestId });
  return { ...result, kind: "courier_route", url: `${window.location.origin}/reparto#${token}` };
}
export async function createCourierQrAccess({ lookupId, sessionId, token, requestId }) {
  const result = await shippingRequest({ mode: "activate_courier_qr", lookupId, sessionId, newToken: token, requestId }, { publicAccess: true });
  const grantHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return { ...result, grantHash: [...new Uint8Array(grantHash)].map(n => n.toString(16).padStart(2, "0")).join(""), token };
}
export const subscribeShippingNotifications = (profile, notify, onError) => subscribeWithFallback(query(collection(db, "alerts"), where("source", "==", "shipping"), where("responsibleId", "==", profile.id), where("active", "==", true)), { mode: "notifications" }, notify, onError);
export const readShippingNotification = alertId => shippingRequest({ mode: "read_notification", alertId });
const pendingKey = uid => `flor-mia-shipping-sale-pending:${uid}`;
export function readPendingShippingSale(uid) { try { return JSON.parse(sessionStorage.getItem(pendingKey(uid)) || "null"); } catch { return null; } }
export async function createShippingSaleRequest(sale, administrative = false) {
  if (!navigator.onLine) throw new Error("Los envíos requieren conexión. Las ventas presenciales mantienen su cola offline.");
  const { profile, ...payload } = sale;
  let requestId = sale.requestId;
  if (!administrative) {
    const existing = readPendingShippingSale(profile.id);
    if (existing && JSON.stringify(existing.sale) !== JSON.stringify(payload)) throw new Error("Hay un envío pendiente de confirmación. Recuperá esa venta antes de cargar otra.");
    requestId = existing?.requestId || crypto.randomUUID();
    sessionStorage.setItem(pendingKey(profile.id), JSON.stringify({ requestId, sale: payload }));
    window.dispatchEvent(new Event("shipping-intent"));
  }
  try {
    const result = await shippingRequest({ mode: "create_sale", administrative, requestId, sale: payload });
    if (!administrative) { sessionStorage.removeItem(pendingKey(profile.id)); window.dispatchEvent(new Event("shipping-intent")); }
    return result;
  } catch (error) {
    // A validation/authorization response confirms no write; network/server errors
    // keep the immutable intent so a lost confirmation can be recovered.
    if (!administrative && ([400, 403].includes(error.status) || error.status === 409 && error.code === "shipping/blocked")) { sessionStorage.removeItem(pendingKey(profile.id)); window.dispatchEvent(new Event("shipping-intent")); }
    throw error;
  }
}
export async function issueShippingAccess(shipmentId, kind, leg) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const result = await shippingAction(shipmentId, "issue_access", { kind, leg, newToken: token });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const grantHash = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, "0")).join("");
  return { ...result, grantHash, url: `${window.location.origin}/${kind === "tracking" ? "seguimiento" : "reparto"}#${token}` };
}
