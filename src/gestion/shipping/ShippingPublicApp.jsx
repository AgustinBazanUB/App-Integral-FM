import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Badge, FormField, Panel, Select, Skeleton } from "../../design-system";
import { AuthProvider, useAuth } from "../AuthContext";
import LoginPage from "../pages/LoginPage";
import { ShipmentContent } from "./ShipmentDetail";
import { shippingRequest } from "../services/shippingService";
import { COURIER_PROBLEMS, SHIPPING_STATES } from "../../shared/shippingDomain.mjs";
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
function CourierPortal() {
  const [token, setToken] = useState(() => window.location.hash.slice(1)), [input, setInput] = useState(""), [shipment, setShipment] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [issue, setIssue] = useState(false), [reason, setReason] = useState(""), [note, setNote] = useState(""), [gps, setGps] = useState("Sin compartir ubicación"), [sharing, setSharing] = useState(false);
  const watch = useRef(null), lastSent = useRef(0), operation = useRef(null), busyRef = useRef(false);
  const request = useCallback(body => shippingRequest({ ...body, token }, { publicAccess: true }), [token]);
  const refresh = useCallback(async () => { const result = await request({ mode: "detail" }); setShipment(result); return result; }, [request]);
  const stop = useCallback(() => { if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current); watch.current = null; setSharing(false); }, []);
  useEffect(() => {
    if (!token) return;
    let live = true;
    const update = () => refresh().then(() => live && setError("")).catch(error => { if (live) { setError(error.message); if ([401, 403, 409].includes(error.status)) { setShipment(null); stop(); } } });
    update(); const timer = setInterval(update, 20000);
    return () => { live = false; clearInterval(timer); stop(); };
  }, [token, refresh, stop]);
  useEffect(() => { if (shipment && !shipment.gpsAllowed) stop(); }, [shipment?.gpsAllowed, stop]);
  const startGps = () => {
    if (!window.isSecureContext || !navigator.geolocation) { setGps("GPS no disponible. Usá HTTPS y un navegador compatible, o pedí una excepción a gestión."); return; }
    if (watch.current !== null || !shipment?.gpsAllowed) return;
    setSharing(true); setGps("Esperando permiso y ubicación…");
    watch.current = navigator.geolocation.watchPosition(async position => {
      if (Date.now() - lastSent.current < 15000) return; lastSent.current = Date.now();
      try { await request({ mode: "position", point: { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, observedAt: new Date(position.timestamp).toISOString() } }); setGps(`Ubicación compartida · precisión ±${Math.round(position.coords.accuracy)} m`); }
      catch (error) { setGps(error.message); if ([401, 403].includes(error.status)) stop(); }
    }, () => { setGps("No se pudo acceder al GPS. Podés volver a permitir ubicación o pedir una excepción supervisada."); stop(); }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
  };
  const execute = async (mode, data = {}) => {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError("");
    const key = JSON.stringify({ mode, data });
    if (operation.current?.key !== key) operation.current = { key, requestId: crypto.randomUUID() };
    try { await request({ mode, requestId: operation.current.requestId, ...data }); operation.current = null; setIssue(false); await refresh(); } catch (error) { setError(error.message); } finally { busyRef.current = false; setBusy(false); }
  };
  if (!token) return <Panel title="Acceso de repartidor" description="Necesitás una autorización temporal de gestión. El QR impreso identifica el pedido y no habilita operaciones."><FormField label="Enlace o credencial temporal"><input value={input} onChange={event => setInput(event.target.value)} autoComplete="off" /></FormField><Button onClick={() => { const value = input.includes("#") ? input.split("#").at(-1) : input.trim(); window.location.hash = value; setToken(value); }}>Abrir pedido autorizado</Button></Panel>;
  return <><h1>Reparto Flor Mía</h1>{error && <p role="alert" className="fm-shipping-error">{error}</p>}{shipment ? <Panel title={shipment.publicCode}>
    <Badge tone={shipment.incident ? "error" : "warning"}>{SHIPPING_STATES[shipment.status]}</Badge>
    <h2>Destino del tramo</h2><p>{shipment.destination?.displayAddress || "Gestión debe completar el destino."}</p>{shipment.customerPhone && <p><a href={`tel:${shipment.customerPhone}`}>{shipment.customerPhone}</a></p>}
    {shipment.destination?.displayAddress && <a className="fm-button fm-button--secondary" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shipment.destination.displayAddress)}`} target="_blank" rel="noreferrer">Cómo llegar con Google Maps</a>}
    {shipment.incident && <p className="fm-shipping-incident">Incidencia abierta: {shipment.incident.reason}. Esperá la intervención de gestión.</p>}
    {shipment.gpsAllowed && <section className="fm-shipping-gps"><p>Para compartir el recorrido, permití ubicación.</p><small>El navegador debe mantener esta página abierta; no garantiza seguimiento en segundo plano. Mapa integrado sin proveedor configurado.</small><p role="status">{gps}</p><Button variant="secondary" onClick={sharing ? () => { stop(); setGps("Dejaste de compartir ubicación"); } : startGps}>{sharing ? "Dejar de compartir" : "Permitir ubicación"}</Button></section>}
    {shipment.action && <div className="fm-shipping-portal-actions"><Button loading={busy} onClick={() => execute("courier_action", { action: shipment.action.action })}>{shipment.action.label}</Button><Button variant="secondary" onClick={() => setIssue(!issue)}>Tengo un problema</Button></div>}
    {shipment.status === "entregado" && <p>Entrega confirmada. El seguimiento se detuvo.</p>}
    {issue && <div className="fm-shipping-form"><FormField label="Motivo"><Select value={reason} onChange={event => setReason(event.target.value)}><option value="">Elegí un motivo</option>{COURIER_PROBLEMS.map(reason => <option key={reason}>{reason}</option>)}</Select></FormField><FormField label="Detalle"><textarea maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></FormField><Button loading={busy} disabled={!reason} onClick={() => execute("incident", { reason, note })}>Informar problema a gestión</Button></div>}
  </Panel> : !error && <Skeleton />}</>;
}
function CustomerTracking() {
  const token = window.location.hash.slice(1), [data, setData] = useState(null), [error, setError] = useState("");
  useEffect(() => { let live = true; const refresh = () => shippingRequest({ mode: "tracking", token }, { publicAccess: true }).then(data => { if (live) { setData(data); setError(""); } }).catch(error => { if (live) { setError(error.message); setData(null); } }); refresh(); const timer = setInterval(refresh, 20000); return () => { live = false; clearInterval(timer); }; }, [token]);
  return <><h1>Seguimiento de tu pedido</h1>{error && <p role="alert">{error}</p>}{data ? <Panel title={data.code}><Badge tone={data.status === "entregado" ? "success" : "warning"}>{data.label}</Badge><p>Última actualización: {formatDateTime(data.updatedAt)}</p><p>{data.locationMessage}</p>{data.position ? <><p>Última ubicación: {formatDateTime(data.position.observedAt)} · precisión ±{Math.round(data.position.accuracy)} m</p><a className="fm-button fm-button--secondary" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${data.position.lat},${data.position.lng}`}>Ver ubicación real en Google Maps</a></> : <p>Ubicación GPS no disponible.</p>}<p className="fm-shipping-muted">Mapa integrado pendiente de configuración. No se estima una hora de llegada.</p></Panel> : !error && <Skeleton />}</>;
}
export default function ShippingPublicApp() {
  const path = window.location.pathname, lookupId = path.startsWith("/e/") ? path.split("/")[2] || "" : null;
  const [role, setRole] = useState(new URLSearchParams(window.location.search).get("role") === "internal" ? "internal" : "");
  useEffect(() => { document.body.classList.add("fm-management-body"); const meta = document.createElement("meta"); meta.name = "referrer"; meta.content = "no-referrer"; document.head.appendChild(meta); return () => { document.body.classList.remove("fm-management-body"); meta.remove(); }; }, []);
  if (lookupId !== null && !/^[A-Za-z0-9_-]{12,200}$/.test(lookupId)) return <main className="fm-shipping-public"><Panel title="QR inválido" description="Revisá el código de la etiqueta o pedí a gestión que vuelva a imprimirla." /></main>;
  return <main className="fm-shipping-public"><a href="/gestion" aria-label="Flor Mía"><img className="fm-shipping-logo" src="/images/flor-mia/logo-flor-mia.svg" alt="Flor Mía" /></a>
    {lookupId ? role === "internal" ? <AuthProvider><InternalPreparation lookupId={lookupId} /></AuthProvider> : role === "courier" ? <CourierPortal /> : <Panel title="¿Cómo querés continuar?" description="El acceso al pedido requiere autorización."><div className="fm-shipping-portal-actions"><Button onClick={() => setRole("internal")}>Soy personal de Flor Mía</Button><Button variant="secondary" onClick={() => setRole("courier")}>Soy repartidor</Button></div></Panel> : path === "/reparto" ? <CourierPortal /> : <CustomerTracking />}
  </main>;
}
