import { useCallback, useEffect, useState } from "react";
import { Button, Badge, Panel, Skeleton } from "../../design-system";
import { AuthProvider, useAuth } from "../AuthContext";
import LoginPage from "../pages/LoginPage";
import { ShipmentContent } from "./ShipmentDetail";
import { shippingRequest } from "../services/shippingService";
import CourierPortal from "./CourierPortal";
import { formatDateTime } from "../formatters";
import "./shipping.css";

function InternalPreparation({ lookupId }) {
  const { status, profile } = useAuth(), [shipment, setShipment] = useState(null), [error, setError] = useState("");
  const reload = useCallback(async () => setShipment(await shippingRequest({ mode: "detail", lookupId })), [lookupId]);
  useEffect(() => { if (status === "ready") reload().catch(error => setError(error.message)); }, [status, reload]);
  if (status === "loading") return <Skeleton />;
  if (status !== "ready") return <LoginPage />;
  if (error) return <p role="alert" className="fm-shipping-error">{error}</p>;
  if (!shipment) return <Skeleton />;
  if (!shipment.assignedPreparerIds.includes(profile.id)) return <p role="alert">Este pedido no está asignado a tu usuario. Gestión debe asignarte antes de que puedas prepararlo.</p>;
  return <><h1>Preparar pedido</h1><p>{shipment.publicCode}</p><ShipmentContent shipment={shipment} profile={profile} reload={reload} internal /></>;
}
function CustomerTracking() {
  const token = window.location.hash.slice(1), [data, setData] = useState(null), [error, setError] = useState("");
  useEffect(() => { let live = true; const refresh = () => shippingRequest({ mode: "tracking", token }, { publicAccess: true }).then(data => { if (live) { setData(data); setError(""); } }).catch(error => { if (live) { setError(error.message); setData(null); } }); refresh(); const timer = setInterval(refresh, 20000); return () => { live = false; clearInterval(timer); }; }, [token]);
  return <><h1>Seguimiento de tu pedido</h1>{error && <p role="alert">{error}</p>}{data ? <Panel title={data.code}><Badge tone={data.status === "entregado" ? "success" : "warning"}>{data.label}</Badge><p>Última actualización: {formatDateTime(data.updatedAt)}</p><p>{data.locationMessage}</p>{data.position ? <><p>Última ubicación: {formatDateTime(data.position.observedAt)} · precisión ±{Math.round(data.position.accuracy)} m</p><a className="fm-button fm-button--secondary" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${data.position.lat},${data.position.lng}`}>Ver ubicación real en Google Maps</a></> : <p>Ubicación GPS no disponible.</p>}<p className="fm-shipping-muted">Mapa integrado pendiente de configuración. No se estima una hora de llegada.</p></Panel> : !error && <Skeleton />}</>;
}
export default function ShippingPublicApp() {
  const path = window.location.pathname, lookupId = path.startsWith("/e/") ? path.split("/")[2] || "" : null;
  const [role, setRole] = useState(new URLSearchParams(window.location.search).get("role") === "internal" ? "internal" : "courier");
  const [accessHash, setAccessHash] = useState(() => window.location.hash);
  useEffect(() => {
    const changed = () => setAccessHash(window.location.hash);
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => { document.body.classList.add("fm-management-body"); const meta = document.createElement("meta"); meta.name = "referrer"; meta.content = "no-referrer"; document.head.appendChild(meta); return () => { document.body.classList.remove("fm-management-body"); meta.remove(); }; }, []);
  useEffect(() => {
    // The shared skip link must preserve the access credential in the fragment.
    const skip = event => { if (event.target.closest?.('a[href="#main-content"]')) { event.preventDefault(); document.getElementById("main-content")?.focus(); } };
    document.addEventListener("click", skip);
    return () => document.removeEventListener("click", skip);
  }, []);
  if (lookupId !== null && !/^[A-Za-z0-9_-]{12,200}$/.test(lookupId)) return <main className="fm-shipping-public"><Panel title="QR inválido" description="Revisá el código de la etiqueta o pedí a gestión que vuelva a imprimirla." /></main>;
  return <main id="main-content" tabIndex={-1} className="fm-shipping-public"><a href="/gestion" aria-label="Flor Mía"><img className="fm-shipping-logo" src="/images/flor-mia/logo-flor-mia.svg" alt="Flor Mía" /></a>
    {lookupId ? role === "internal" ? <AuthProvider><InternalPreparation lookupId={lookupId} /></AuthProvider> : <CourierPortal key={accessHash} lookupId={lookupId} /> : path === "/reparto" ? <CourierPortal key={accessHash} /> : <CustomerTracking key={accessHash} />}
    {lookupId && <Button variant="secondary" onClick={() => setRole(role === "internal" ? "courier" : "internal")}>{role === "internal" ? "Volver al panel del repartidor" : "Soy personal de Flor Mía · Preparar pedido"}</Button>}
  </main>;
}
