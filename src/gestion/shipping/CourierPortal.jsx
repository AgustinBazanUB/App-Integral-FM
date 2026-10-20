import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, FormField, Panel, Select, Skeleton } from "../../design-system";
import { createCourierQrAccess, shippingRequest } from "../services/shippingService";
import { COURIER_PROBLEMS, SHIPPING_STATES, CLOSED_SHIPPING_STATES } from "../../shared/shippingDomain.mjs";
import { formatDateTime } from "../formatters";
import { createCourierGps } from "./courierGps.mjs";
import ShippingMap from "./ShippingMap";

const validToken = value => /^[A-Za-z0-9_-]{32,128}$/.test(value);
const actionLabels = { pickup: "Confirmar que recibí el paquete", repository_receive: "Confirmar que lo dejé en el repositorio", repository_depart: "Salir del repositorio hacia el cliente", deliver: "Confirmar entrega al cliente" };

function Journey({ shipment }) {
  const origin = shipment.leg === "origin", repository = shipment.deliveryType === "repository";
  const steps = origin ? ["Recibir paquete", "Hacia repositorio", "Dejar en repositorio"]
    : repository ? ["En repositorio", "En camino al cliente", "Entregado al cliente"] : ["Recibir paquete", "En camino al cliente", "Entregado al cliente"];
  const current = shipment.status === "entregado" || origin && shipment.status === "recibido_repositorio" ? 2
    : ["hacia_repositorio", "reparto_final"].includes(shipment.status) ? 1 : 0;
  return <ol className="fm-courier-steps" aria-label="Etapas de tu reparto">{steps.map((step, index) => <li key={step} aria-current={index === current ? "step" : undefined} className={index <= current ? "is-reached" : ""}><span aria-hidden="true">{index + 1}</span>{step}</li>)}</ol>;
}

function randomCourierToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export default function CourierPortal({ lookupId }) {
  const [token, setToken] = useState(() => { const value = window.location.hash.slice(1); return validToken(value) ? value : ""; });
  const [input, setInput] = useState(""), [shipment, setShipment] = useState(null), [route, setRoute] = useState(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [issue, setIssue] = useState(false), [reason, setReason] = useState(""), [note, setNote] = useState("");
  const [activationRetry, setActivationRetry] = useState(0);
  const [gpsState, setGpsState] = useState({ phase: "stopped", message: "No estás compartiendo tu ubicación.", active: false });
  const mounted = useRef(true), operation = useRef(null), busyRef = useRef(false), activationAttempt = useRef(null);
  const request = useCallback((body, options) => shippingRequest({ ...body, token, ...(lookupId ? { lookupId } : {}) }, { publicAccess: true, ...options }), [token, lookupId]);
  const gps = useMemo(() => createCourierGps({ request, geolocation: navigator.geolocation, secure: window.isSecureContext, onChange: state => { if (mounted.current) setGpsState(state); } }), [request]);
  useEffect(() => {
    if (!lookupId || token) return undefined;
    activationAttempt.current ||= { sessionId: crypto.randomUUID(), requestId: crypto.randomUUID(), token: randomCourierToken() };
    let live = true;
    setError("");
    createCourierQrAccess({ lookupId, ...activationAttempt.current }).then(result => {
      if (!live) return;
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${result.token}`);
      setToken(result.token);
    }).catch(error => { if (live) setError(error.message); });
    return () => { live = false; };
  }, [lookupId, token, activationRetry]);
  const refresh = useCallback(async () => {
    const result = await request({ mode: "detail" });
    if (mounted.current) {
      if (result?.kind === "courier_route") { setRoute(result); setShipment(null); }
      else { setRoute(null); setShipment(result); }
    }
    return result;
  }, [request]);
  useEffect(() => {
    mounted.current = true;
    const leave = () => { void gps.stop("", false); };
    window.addEventListener("pagehide", leave);
    return () => { mounted.current = false; window.removeEventListener("pagehide", leave); leave(); };
  }, [gps]);
  useEffect(() => {
    if (!token) return;
    let live = true;
    const update = () => refresh().then(() => live && setError("")).catch(error => {
      if (!live) return;
      setError(error.message);
      if ([400, 401, 403, 409].includes(error.status)) { setShipment(null); setRoute(null); void gps.stop("Tu acceso dejó de estar disponible."); }
    });
    update(); const timer = setInterval(update, 20000);
    return () => { live = false; clearInterval(timer); };
  }, [token, refresh, gps]);
  useEffect(() => { if (shipment && !shipment.gpsAllowed || route && !route.gpsAllowed) void gps.stop("", false); }, [shipment?.gpsAllowed, route?.gpsAllowed, gps]);
  const execute = async (mode, data = {}, onSuccess = null, onFailure = null) => {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError("");
    const key = JSON.stringify({ mode, data });
    if (operation.current?.key !== key) operation.current = { key, requestId: crypto.randomUUID() };
    try { await request({ mode, requestId: operation.current.requestId, ...data }); operation.current = null; setIssue(false); await refresh(); if (onSuccess) void onSuccess(); return true; }
    catch (error) { if (onFailure) onFailure(); setError(error.message); return false; } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const runCourierAction = (action, leg, extra = {}) => {
    if (busyRef.current) return;
    const beginsCustomerTrip = action === "repository_depart" || (action === "pickup" && leg === "direct");
    if (beginsCustomerTrip) gps.prepare();
    void execute("courier_action", { ...extra, action }, beginsCustomerTrip ? () => gps.start() : null,
      beginsCustomerTrip ? () => gps.stop("La salida no se confirmó; la ubicación quedó detenida.") : null);
  };
  const authorize = () => {
    const value = input.includes("#") ? input.split("#").at(-1).trim() : input.trim();
    if (!validToken(value)) { setError("Ingresá el enlace o código temporal que te entregó Flor Mía."); return; }
    setError(""); window.location.hash = value; setToken(value);
  };
  return <div className="fm-courier-panel">
    <header><p className="fm-shipping-eyebrow">Portal de reparto · {route ? "Recorrido compartido" : shipment?.deliveryType === "repository" ? "Repositorio" : "Entrega al cliente"}</p><h1>{route ? `Recorrido · ${route.shipments.length} envíos` : shipment ? shipment.leg === "origin" ? "Envío hacia el repositorio" : `Envío para ${shipment.customerName || "el cliente"}` : "Panel del repartidor"}</h1>{shipment && <p className="fm-shipping-courier-code">{shipment.publicCode}</p>}{route ? <Badge tone={route.status === "completed" ? "success" : "info"}>{route.status === "completed" ? "Recorrido completado" : `${route.shipments.filter(item => item.action).length} entregas con acción disponible`}</Badge> : shipment ? <Badge tone={shipment.status === "entregado" ? "success" : shipment.incident ? "error" : "info"}>{SHIPPING_STATES[shipment.status]}</Badge> : <p>Recibí el paquete y confirmá cada etapa. El teléfono activa el seguimiento al salir hacia el cliente.</p>}</header>
    {error && <p role="alert" className="fm-shipping-error">{error}</p>}
    {!token && lookupId ? <Panel title="Abriendo el reparto" description="El QR de esta etiqueta habilita las acciones del próximo tramo sin ingresar códigos.">
      <p>El acceso queda limitado a este envío, a la siguiente etapa permitida y vence automáticamente.</p>
      {error && <Button variant="secondary" onClick={() => setActivationRetry(value => value + 1)}>Reintentar abrir el reparto</Button>}
    </Panel> : !token ? <Panel title="Abrir un recorrido" description="Pegá el enlace temporal del recorrido que te compartió Flor Mía.">
      <FormField label="Enlace o código temporal"><input autoComplete="off" autoCapitalize="none" spellCheck={false} value={input} onChange={event => setInput(event.target.value)} /></FormField>
      <Button onClick={authorize}>Abrir mi reparto</Button>
      <p className="fm-shipping-muted">Al escanear la etiqueta de un pedido no hace falta ingresar un código.</p>
    </Panel> : route ? <>
      <div className="fm-shipping-public-card"><strong>Una sesión para toda la ruta</strong><p>Tramo: {route.leg === "origin" ? "Origen → repositorio" : route.leg === "final" ? "Repositorio → clientes" : "Entrega directa → clientes"} · {route.shipments.length} pedidos asignados.</p><p>La ubicación se activa al confirmar la salida hacia el cliente. Acceso válido hasta {formatDateTime(route.accessExpiresAt)}.</p></div>
      {route.shipments.map(item => <Panel key={item.id} title={route.leg === "origin" ? "Envío hacia el repositorio" : `Envío para ${item.customerName || "el cliente"}`} description={`Código ${item.publicCode}`} action={<Badge tone={item.status === "entregado" ? "success" : item.incident ? "error" : "info"}>{SHIPPING_STATES[item.status]}</Badge>}>
        {item.destination?.displayAddress && <p className="fm-courier-address">{item.destination.displayAddress}</p>}
        {item.destination?.notes && <p><strong>Para la entrega:</strong> {item.destination.notes}</p>}
        {item.customerPhone && <a className="fm-button fm-button--secondary" href={`tel:${item.customerPhone}`}>Llamar al cliente</a>}
        {item.destination?.displayAddress && <a className="fm-button fm-button--secondary" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.destination.displayAddress)}`} target="_blank" rel="noreferrer">Cómo llegar con Google Maps</a>}
        {item.incident && <p className="fm-shipping-incident">Incidencia: {item.incident.reason}. Esperá a Flor Mía.</p>}
        {item.action ? <Button loading={busy} icon="Check" onClick={() => runCourierAction(item.action.action, route.leg, { shipmentId: item.id })}>{actionLabels[item.action.action] || item.action.label}</Button> : !CLOSED_SHIPPING_STATES.includes(item.status) && <p role="status">Esperá a que este paquete alcance la siguiente etapa del recorrido.</p>}
      </Panel>)}
      {route.gpsAllowed && <Panel title="Ubicación del recorrido" description="Una sola posición se comparte para los pedidos activos de esta ruta. Cada cliente sólo recibe el punto durante su propia entrega final.">
        <section className={`fm-courier-gps is-${gpsState.phase}`}><div role="status" aria-live="polite"><Badge tone={gpsState.phase === "sharing" ? "success" : gpsState.phase === "error" ? "error" : "warning"}>{gpsState.phase === "sharing" ? "Ubicación compartida" : gpsState.phase === "error" ? "Ubicación sin confirmar" : gpsState.active ? "Esperando ubicación" : "GPS apagado"}</Badge><p>{gpsState.message}</p>{gpsState.confirmedAt && <p>Último envío confirmado: {formatDateTime(gpsState.confirmedAt)} · precisión ±{Math.round(gpsState.accuracy)} m</p>}</div>
          <ShippingMap className="fm-courier-live-map" position={gpsState.position || route.position} trail={gpsState.trail?.length ? gpsState.trail : route.trail} destinations={route.shipments.filter(item => item.status === "reparto_final" && item.destination?.verified).map(item => ({ ...item.destination, id: item.id, label: item.publicCode }))} active={gpsState.phase === "sharing"} label="Ubicación de la ruta" />
          {gpsState.active && gpsState.phase !== "error" ? <Button variant="secondary" onClick={() => void gps.stop()}>Dejar de compartir ubicación</Button> : <Button variant="secondary" onClick={() => void gps.start({ retry: true })}>{gpsState.phase === "error" ? "Reintentar ubicación" : "Reanudar ubicación de la ruta"}</Button>}
          <p className="fm-shipping-muted">El GPS requiere tu permiso. Mantené el panel abierto y la pantalla encendida; el navegador puede pausar la ubicación en segundo plano.</p>
        </section>
      </Panel>}
      {route.status === "completed" && <p className="fm-courier-completed" role="status">Todas las entregas de este recorrido terminaron. El seguimiento GPS está detenido.</p>}
    </> : shipment ? <>
      <Panel className="fm-courier-destination-card" title={shipment.leg === "origin" ? "Destino: repositorio" : "Domicilio de entrega"} description={shipment.leg === "origin" ? "Tramo 1 · Del origen al repositorio" : shipment.leg === "final" ? "Tramo 2 · Del repositorio al cliente" : "Del origen al cliente"}>
        <p className="fm-courier-address">{shipment.destination?.displayAddress || shipment.destination?.displayName || "Flor Mía debe completar el destino."}</p>
        {shipment.destination?.notes && <p><strong>Para la entrega:</strong> {shipment.destination.notes}</p>}
        {shipment.customerPhone && <a className="fm-button fm-button--secondary" href={`tel:${shipment.customerPhone}`}>Llamar al cliente</a>}
        {shipment.destination?.displayAddress && <a className="fm-button fm-button--secondary" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shipment.destination.displayAddress)}`} target="_blank" rel="noreferrer">Cómo llegar con Google Maps</a>}
        {shipment.incident && <p className="fm-shipping-incident">Incidencia: {shipment.incident.reason}. Esperá la intervención de Flor Mía.</p>}
        {!shipment.action && (shipment.status === "entregado" ? <p className="fm-courier-completed" role="status">Entrega confirmada. Gracias por completar el reparto. El GPS se detuvo.</p>
          : !CLOSED_SHIPPING_STATES.includes(shipment.status) && !shipment.incident && <p role="status">{shipment.leg === "origin" && shipment.status === "recibido_repositorio" ? "Paquete recibido en el repositorio. Este tramo terminó; el próximo repartidor usará su acceso de reparto final." : shipment.leg === "final" ? "Esperá a que el paquete quede recibido en el repositorio para iniciar tu tramo." : "Esperá a que Flor Mía marque el pedido listo para retirar."}</p>
        )}
        {issue && <div className="fm-shipping-form"><FormField label="Motivo"><Select value={reason} onChange={event => setReason(event.target.value)}><option value="">Elegí un motivo</option>{COURIER_PROBLEMS.map(reason => <option key={reason}>{reason}</option>)}</Select></FormField><FormField label="Detalle"><textarea maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></FormField><Button loading={busy} disabled={!reason} onClick={() => execute("incident", { reason, note })}>Informar problema a Flor Mía</Button></div>}
      </Panel>
      {!CLOSED_SHIPPING_STATES.includes(shipment.status) && <div className="fm-shipping-public-card fm-courier-stage"><small className="fm-shipping-eyebrow">Etapa del envío</small><Journey shipment={shipment} /><strong>{shipment.action ? actionLabels[shipment.action.action] : "Esperando el siguiente tramo"}</strong><p>Sólo verás la próxima acción permitida para tu tramo.</p></div>}
      {!CLOSED_SHIPPING_STATES.includes(shipment.status) && <Panel title="Mi ubicación" description="Se comparte con Flor Mía y con el seguimiento de este pedido únicamente durante el camino al cliente.">
        {shipment.gpsAllowed ? <section className={`fm-courier-gps is-${gpsState.phase}`}>
          <div role="status" aria-live="polite"><Badge tone={gpsState.phase === "sharing" ? "success" : gpsState.phase === "error" ? "error" : "warning"}>{gpsState.phase === "sharing" ? "Ubicación compartida" : gpsState.phase === "error" ? "Ubicación sin confirmar" : gpsState.active ? "Esperando ubicación" : "GPS apagado"}</Badge><p>{gpsState.message}</p>
            {gpsState.confirmedAt && <p>Último envío confirmado: {formatDateTime(gpsState.confirmedAt)} · precisión ±{Math.round(gpsState.accuracy)} m</p>}
          </div>
          <ShippingMap className="fm-courier-live-map" position={gpsState.position || shipment.lastPosition} trail={gpsState.trail?.length ? gpsState.trail : shipment.gpsTrail} destination={shipment.destination} active={gpsState.phase === "sharing"} label="Tu ubicación para este reparto" />
          {gpsState.active && gpsState.phase !== "error" ? <Button variant="secondary" onClick={() => void gps.stop()}>Dejar de compartir ubicación</Button> : <Button variant="secondary" onClick={() => void gps.start({ retry: true })}>{gpsState.phase === "error" ? "Reintentar ubicación" : "Reanudar ubicación de este tramo"}</Button>}
          <p className="fm-shipping-muted">Al salir hacia el cliente, el teléfono solicita permiso automáticamente. Mantené este panel abierto y la pantalla encendida; al entregar, el seguimiento se detiene.</p>
          <details><summary>Ayuda con la ubicación</summary><p>Abrí el enlace en Chrome o Safari. Activá Ubicación en el teléfono y permití el acceso para este sitio desde los ajustes del navegador. Si no hay señal, probá al aire libre. Si persiste el problema, avisá a Flor Mía.</p></details>
        </section> : <p role="status">{shipment.leg === "origin" ? "En el tramo hacia el repositorio no se comparte ubicación con el cliente." : "El GPS se habilita cuando confirmes que saliste hacia el cliente."}</p>}
      </Panel>}
      {shipment.action && <div className="fm-shipping-public-actions"><Button loading={busy} icon="Check" onClick={() => runCourierAction(shipment.action.action, shipment.leg)}>{actionLabels[shipment.action.action] || shipment.action.label}</Button><Button variant="destructive" icon="CircleAlert" onClick={() => setIssue(!issue)}>Tengo un problema</Button></div>}
      <p className="fm-shipping-muted">Acceso válido hasta {formatDateTime(shipment.accessExpiresAt)}. Si necesitás otro tramo, pedile un nuevo acceso a Flor Mía.</p>
    </> : !error && <Skeleton />}
  </div>;
}
