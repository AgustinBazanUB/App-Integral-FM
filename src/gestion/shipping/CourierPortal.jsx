import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, FormField, Panel, Select, Skeleton } from "../../design-system";
import { shippingRequest } from "../services/shippingService";
import { COURIER_PROBLEMS, SHIPPING_STATES, CLOSED_SHIPPING_STATES } from "../../shared/shippingDomain.mjs";
import { formatDateTime } from "../formatters";
import { createCourierGps } from "./courierGps.mjs";

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

export default function CourierPortal({ lookupId }) {
  const [token, setToken] = useState(() => { const value = window.location.hash.slice(1); return validToken(value) ? value : ""; });
  const [input, setInput] = useState(""), [shipment, setShipment] = useState(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [issue, setIssue] = useState(false), [reason, setReason] = useState(""), [note, setNote] = useState("");
  const [gpsState, setGpsState] = useState({ phase: "stopped", message: "No estás compartiendo tu ubicación.", active: false });
  const mounted = useRef(true), operation = useRef(null), busyRef = useRef(false);
  const request = useCallback((body, options) => shippingRequest({ ...body, token, ...(lookupId ? { lookupId } : {}) }, { publicAccess: true, ...options }), [token, lookupId]);
  const gps = useMemo(() => createCourierGps({ request, geolocation: navigator.geolocation, secure: window.isSecureContext, onChange: state => { if (mounted.current) setGpsState(state); } }), [request]);
  const refresh = useCallback(async () => { const result = await request({ mode: "detail" }); if (mounted.current) setShipment(result); return result; }, [request]);
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
      if ([400, 401, 403, 409].includes(error.status)) { setShipment(null); void gps.stop("Tu acceso dejó de estar disponible."); }
    });
    update(); const timer = setInterval(update, 20000);
    return () => { live = false; clearInterval(timer); };
  }, [token, refresh, gps]);
  useEffect(() => { if (shipment && !shipment.gpsAllowed) void gps.stop(); }, [shipment?.gpsAllowed, gps]);
  const execute = async (mode, data = {}) => {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError("");
    const key = JSON.stringify({ mode, data });
    if (operation.current?.key !== key) operation.current = { key, requestId: crypto.randomUUID() };
    try { await request({ mode, requestId: operation.current.requestId, ...data }); operation.current = null; setIssue(false); await refresh(); }
    catch (error) { setError(error.message); } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const authorize = () => {
    const value = input.includes("#") ? input.split("#").at(-1).trim() : input.trim();
    if (!validToken(value)) { setError("Ingresá el enlace o código temporal que te entregó Flor Mía."); return; }
    setError(""); window.location.hash = value; setToken(value);
  };
  return <div className="fm-courier-panel">
    <header><p className="fm-courier-eyebrow">Flor Mía · Reparto</p><h1>Panel del repartidor</h1><p>Recibí el pedido, confirmá cada tramo y compartí tu ubicación cuando vayas al cliente.</p></header>
    {error && <p role="alert" className="fm-shipping-error">{error}</p>}
    {!token ? <Panel title="Autorizar este reparto" description="Pedile a Flor Mía el enlace o código temporal de tu tramo. El QR de la etiqueta abre este panel; el código habilita las acciones del pedido.">
      <FormField label="Enlace o código temporal"><input autoComplete="off" autoCapitalize="none" spellCheck={false} value={input} onChange={event => setInput(event.target.value)} /></FormField>
      <Button onClick={authorize}>Abrir mi reparto</Button>
      <p className="fm-shipping-muted">Si recibiste un enlace autorizado o su QR, abrilo directamente desde este teléfono.</p>
    </Panel> : shipment ? <>
      <Panel title={shipment.publicCode} description={shipment.leg === "origin" ? "Tramo 1 · Del origen al repositorio" : shipment.leg === "final" ? "Tramo 2 · Del repositorio al cliente" : "Del origen al cliente"}>
        <Badge tone={shipment.status === "entregado" ? "success" : shipment.incident ? "error" : "warning"}>{SHIPPING_STATES[shipment.status]}</Badge>
        {!CLOSED_SHIPPING_STATES.includes(shipment.status) && <Journey shipment={shipment} />}
        <h2>{shipment.leg === "origin" ? "Destino: repositorio" : "Domicilio de entrega"}</h2>
        <p className="fm-courier-address">{shipment.destination?.displayAddress || shipment.destination?.displayName || "Flor Mía debe completar el destino."}</p>
        {shipment.destination?.notes && <p><strong>Para la entrega:</strong> {shipment.destination.notes}</p>}
        {shipment.customerPhone && <a className="fm-button fm-button--secondary" href={`tel:${shipment.customerPhone}`}>Llamar al cliente</a>}
        {shipment.destination?.displayAddress && <a className="fm-button fm-button--secondary" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shipment.destination.displayAddress)}`} target="_blank" rel="noreferrer">Cómo llegar con Google Maps</a>}
        {shipment.incident && <p className="fm-shipping-incident">Incidencia: {shipment.incident.reason}. Esperá la intervención de Flor Mía.</p>}
        {shipment.action ? <div className="fm-shipping-portal-actions"><Button loading={busy} onClick={() => execute("courier_action", { action: shipment.action.action })}>{actionLabels[shipment.action.action] || shipment.action.label}</Button><Button variant="secondary" onClick={() => setIssue(!issue)}>Tengo un problema</Button></div>
          : shipment.status === "entregado" ? <p className="fm-courier-completed" role="status">Entrega confirmada. Gracias por completar el reparto. El GPS se detuvo.</p>
          : !CLOSED_SHIPPING_STATES.includes(shipment.status) && !shipment.incident && <p role="status">{shipment.leg === "origin" && shipment.status === "recibido_repositorio" ? "Paquete recibido en el repositorio. Este tramo terminó; el próximo repartidor usará su acceso de reparto final." : shipment.leg === "final" ? "Esperá a que el paquete quede recibido en el repositorio para iniciar tu tramo." : "Esperá a que Flor Mía marque el pedido listo para retirar."}</p>}
        {issue && <div className="fm-shipping-form"><FormField label="Motivo"><Select value={reason} onChange={event => setReason(event.target.value)}><option value="">Elegí un motivo</option>{COURIER_PROBLEMS.map(reason => <option key={reason}>{reason}</option>)}</Select></FormField><FormField label="Detalle"><textarea maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></FormField><Button loading={busy} disabled={!reason} onClick={() => execute("incident", { reason, note })}>Informar problema a Flor Mía</Button></div>}
      </Panel>
      {!CLOSED_SHIPPING_STATES.includes(shipment.status) && <Panel title="Mi ubicación" description="Se comparte con Flor Mía y con el seguimiento de este pedido únicamente durante el camino al cliente.">
        {shipment.gpsAllowed ? <section className={`fm-courier-gps is-${gpsState.phase}`}>
          <div role="status" aria-live="polite"><Badge tone={gpsState.phase === "sharing" ? "success" : gpsState.phase === "error" ? "error" : "warning"}>{gpsState.phase === "sharing" ? "Ubicación compartida" : gpsState.phase === "error" ? "Ubicación sin confirmar" : gpsState.active ? "Esperando ubicación" : "GPS apagado"}</Badge><p>{gpsState.message}</p>
            {gpsState.confirmedAt && <p>Último envío confirmado: {formatDateTime(gpsState.confirmedAt)} · precisión ±{Math.round(gpsState.accuracy)} m</p>}
          </div>
          <Button variant={gpsState.active ? "secondary" : "primary"} onClick={() => gpsState.active ? void gps.stop() : void gps.start()}>{gpsState.active ? "Dejar de compartir ubicación" : gpsState.phase === "error" ? "Reintentar compartir ubicación" : "Compartir mi ubicación"}</Button>
          <p className="fm-shipping-muted">Permití Ubicación cuando el teléfono lo solicite. Mantené este panel abierto y la pantalla encendida durante el reparto. Al entregar, el seguimiento se detiene automáticamente.</p>
          <details><summary>Ayuda con la ubicación</summary><p>Abrí el enlace en Chrome o Safari. Activá Ubicación en el teléfono y permití el acceso para este sitio desde los ajustes del navegador. Si no hay señal, probá al aire libre. Si persiste el problema, avisá a Flor Mía.</p></details>
        </section> : <p role="status">{shipment.leg === "origin" ? "En el tramo hacia el repositorio no se comparte ubicación con el cliente." : "El GPS se habilita cuando confirmes que saliste hacia el cliente."}</p>}
      </Panel>}
      <p className="fm-shipping-muted">Acceso válido hasta {formatDateTime(shipment.accessExpiresAt)}. Si necesitás otro tramo, pedile un nuevo acceso a Flor Mía.</p>
    </> : !error && <Skeleton />}
  </div>;
}
