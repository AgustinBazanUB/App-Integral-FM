import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Badge, FormField, Panel, Select, Skeleton } from "../../design-system";
import { Icon } from "../components/icons";
import { AuthProvider, useAuth } from "../AuthContext";
import LoginPage from "../pages/LoginPage";
import { shippingRequest } from "../services/shippingService";
import { PREPARATION_PROBLEMS, SHIPPING_STATES } from "../../shared/shippingDomain.mjs";
import CourierPortal from "./CourierPortal";
import ShippingProgress from "./ShippingProgress";
import ShippingLocation from "./ShippingLocation";
import ShippingMap from "./ShippingMap";
import { formatDateTime } from "../formatters";
import "./shipping.css";

function InternalPreparation({ lookupId }) {
  const { status, profile } = useAuth(), [shipment, setShipment] = useState(null), [error, setError] = useState("");
  const [problem, setProblem] = useState(false), [reason, setReason] = useState(""), [note, setNote] = useState(""), [busy, setBusy] = useState(false);
  const busyRef = useRef(false), operation = useRef(null);
  const reload = useCallback(async () => setShipment(await shippingRequest({ mode: "detail", lookupId })), [lookupId]);
  useEffect(() => { if (status === "ready") reload().catch(error => setError(error.message)); }, [status, reload]);
  const execute = async (mode, extra = {}) => {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError("");
    const key = JSON.stringify({ mode, extra });
    if (operation.current?.key !== key) operation.current = { key, requestId: crypto.randomUUID() };
    try { await shippingRequest({ mode, lookupId, requestId: operation.current.requestId, ...extra }); operation.current = null; setProblem(false); await reload(); }
    catch (error) { setError(error.message); } finally { busyRef.current = false; setBusy(false); }
  };
  if (status === "loading") return <Skeleton />;
  if (status !== "ready") return <LoginPage />;
  if (!shipment) return error ? <p role="alert" className="fm-shipping-error">{error}</p> : <Skeleton />;
  if (!shipment.assignedPreparerIds.includes(profile.id)) return <p role="alert">Este pedido no está asignado a tu usuario. Gestión debe asignarte antes de que puedas prepararlo.</p>;
  const preparing = !shipment.incident && ["aprobado", "en_preparacion"].includes(shipment.status);
  return <section className="fm-shipping-internal-portal">
    <header><p className="fm-shipping-eyebrow">Usuario Flor Mía · Preparación</p><h1>Preparar pedido</h1><Badge tone={shipment.incident ? "error" : "warning"}>{SHIPPING_STATES[shipment.status]}</Badge></header>
    {error && <p role="alert" className="fm-shipping-error">{error}</p>}
    <div className="fm-shipping-public-card"><p className="fm-shipping-session">Sesión: {profile.name || profile.displayName || "Usuario de Flor Mía"} · Pedido asignado a tu cuenta.</p><div className="fm-shipping-public-divider"><strong>Envío {shipment.publicCode}</strong><p>Cliente: {shipment.customerSnapshot.name}</p><p>Destino: {shipment.destination.displayAddress}</p></div><div className="fm-shipping-public-divider"><strong>Productos a preparar</strong><ul>{shipment.itemsSnapshot.map(item => <li key={item.productId}>{item.qty} × {item.name}</li>)}</ul>{shipment.destination.notes && <p>{shipment.destination.notes}</p>}</div></div>
    {shipment.incident && <p role="status" className="fm-shipping-incident">Incidencia: {shipment.incident.reason}. Esperá la intervención de gestión.</p>}
    {preparing && <div className="fm-shipping-public-actions"><Button icon="Check" loading={busy} onClick={() => execute("ready")}>Pedido preparado y listo para retirar</Button><Button variant="destructive" icon="CircleAlert" onClick={() => setProblem(!problem)}>No puedo preparar el pedido</Button></div>}
    {problem && <Panel title="Informar problema"><FormField label="Motivo"><Select value={reason} onChange={event => setReason(event.target.value)}><option value="">Elegí un motivo</option>{PREPARATION_PROBLEMS.map(value => <option key={value}>{value}</option>)}</Select></FormField><FormField label="Detalle"><textarea maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></FormField><Button disabled={!reason} loading={busy} onClick={() => execute("incident", { reason, note })}>Informar problema a gestión</Button></Panel>}
    <p className="fm-shipping-muted">Esta pantalla confirma la preparación o informa un problema. El inventario y el origen se administran desde Gestión.</p>
  </section>;
}

function CustomerTracking() {
  const token = window.location.hash.slice(1), [data, setData] = useState(null), [error, setError] = useState("");
  useEffect(() => { let live = true; const refresh = () => { if (document.visibilityState === "hidden") return; shippingRequest({ mode: "tracking", token }, { publicAccess: true }).then(data => { if (live) { setData(data); setError(""); } }).catch(error => { if (live) { setError(error.message); setData(null); } }); }; const timer = setInterval(refresh, 15000); const wake = () => { if (document.visibilityState === "visible") refresh(); }; refresh(); document.addEventListener("visibilitychange", wake); window.addEventListener("focus", refresh); return () => { live = false; clearInterval(timer); document.removeEventListener("visibilitychange", wake); window.removeEventListener("focus", refresh); }; }, [token]);
  const title = data?.status === "entregado" ? "Tu pedido fue entregado" : data?.status === "reparto_final" ? "Tu pedido está en camino" : data?.status === "recibido_repositorio" ? "Tu pedido está en repositorio" : "Seguimiento de tu pedido";
  return <section className="fm-shipping-customer-portal"><header><p className="fm-shipping-eyebrow">Enlace público · Sólo lectura</p><h1>{title}</h1><p>Podés consultar el estado y la última ubicación de tu envío.</p></header>
    {error && <p role="alert" className="fm-shipping-error">{error}</p>}
    {data ? <><div className="fm-shipping-public-card"><strong>Pedido {data.code}</strong><p>Estado: {data.label}</p><ShippingProgress status={data.status} customer /></div>{data.status === "reparto_final" && <ShippingMap position={data.position} trail={data.trail} destination={data.destination} active={Boolean(data.position)} label="Ubicación del repartidor" />}<ShippingLocation position={data.position} final={data.status === "reparto_final"} customer /><div className="fm-shipping-public-card"><strong>Información del envío</strong><p>{data.locationMessage}</p><p>Última actualización: {formatDateTime(data.updatedAt)}</p><p>Tiempo estimado: no disponible</p></div><p className="fm-shipping-muted">Este enlace muestra únicamente la información permitida para tu pedido. No permite modificar el envío.</p></> : !error && <Skeleton />}
  </section>;
}

export default function ShippingPublicApp() {
  const path = window.location.pathname, lookupId = path.startsWith("/e/") ? path.split("/")[2] || "" : null;
  const explicitRole = new URLSearchParams(window.location.search).get("role");
  const [role, setRole] = useState(explicitRole === "internal" ? "internal" : explicitRole === "courier" || /^[A-Za-z0-9_-]{32,128}$/.test(window.location.hash.slice(1)) ? "courier" : "");
  const [accessHash, setAccessHash] = useState(() => window.location.hash);
  useEffect(() => { const changed = () => { setAccessHash(window.location.hash); if (/^[A-Za-z0-9_-]{32,128}$/.test(window.location.hash.slice(1))) setRole("courier"); }; window.addEventListener("hashchange", changed); return () => window.removeEventListener("hashchange", changed); }, []);
  useEffect(() => { document.body.classList.add("fm-management-body"); const meta = document.createElement("meta"); meta.name = "referrer"; meta.content = "strict-origin-when-cross-origin"; document.head.appendChild(meta); return () => { document.body.classList.remove("fm-management-body"); meta.remove(); }; }, []);
  useEffect(() => { const skip = event => { if (event.target.closest?.('a[href="#main-content"]')) { event.preventDefault(); document.getElementById("main-content")?.focus(); } }; document.addEventListener("click", skip); return () => document.removeEventListener("click", skip); }, []);
  const invalid = lookupId !== null && !/^[A-Za-z0-9_-]{12,200}$/.test(lookupId);
  return <div className="fm-shipping-public-shell"><header className="fm-shipping-public-brand"><a href="/gestion" aria-label="Flor Mía">Flor Mía</a></header><main id="main-content" tabIndex={-1} className="fm-shipping-public">
    {invalid ? <Panel title="QR inválido" description="Revisá el código de la etiqueta o pedí a gestión que vuelva a imprimirla." /> : lookupId ? <>
      {role && <button className="fm-shipping-back" onClick={() => setRole("")}>← Elegir otro acceso</button>}
      {role === "internal" ? <AuthProvider><InternalPreparation lookupId={lookupId} /></AuthProvider> : role === "courier" ? <CourierPortal key={accessHash} lookupId={lookupId} /> : <section className="fm-shipping-qr-start"><p className="fm-shipping-eyebrow">Acceso al envío · Código QR</p><h1>¿Cómo querés continuar?</h1><p>Seleccioná el tipo de acceso. Cada usuario tendrá únicamente las acciones que le correspondan.</p><div className="fm-shipping-public-card"><strong>Pedido de Flor Mía</strong><p>Acceso al estado y operación del envío mediante QR.</p></div><div className="fm-shipping-qr-choices"><button onClick={() => setRole("internal")}><Icon name="UserRound" /><strong>Soy personal de Flor Mía</strong><span>Ingreso con mi cuenta de la empresa</span></button><button onClick={() => setRole("courier")}><Icon name="Truck" /><strong>Soy repartidor</strong><span>Acceso temporal autorizado para este envío</span></button></div><p className="fm-shipping-muted">Un QR por envío. El personal requiere autenticación; el repartidor, autorización temporal.</p></section>}
    </> : path === "/reparto" ? <CourierPortal key={accessHash} /> : <CustomerTracking key={accessHash} />}
  </main></div>;
}
