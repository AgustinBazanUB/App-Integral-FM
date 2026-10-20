import { useEffect, useRef, useState } from "react";
import { Badge, Button, Drawer, FormField, Panel, Select, Skeleton } from "../../design-system";
import { SHIPPING_STATES, TRANSPORTS, CLOSED_SHIPPING_STATES, PREPARATION_PROBLEMS } from "../../shared/shippingDomain.mjs";
import { can } from "../permissions";
import { shippingRequest, issueShippingAccess, subscribeShippingShipment, subscribeCourierSession } from "../services/shippingService";
import { listLocationsShared } from "../services/sharedResources";
import { listWarehouses } from "../services/inventoryService";
import { formatDateTime } from "../formatters";
import { ShippingFields } from "./ShippingFields";
import LabelPreview from "./LabelPreview";
import ShippingAccessQr from "./ShippingAccessQr";
import ShippingProgress from "./ShippingProgress";
import ShippingMap from "./ShippingMap";
import "./shipping.css";

export function ShipmentContent({ shipment, profile, reload, internal = false, review = false }) {
  const [mode, setMode] = useState(review && can(profile, "shipping", "approve") ? "approve" : ""), [form, setForm] = useState(() => review ? { ...shipment.destination, deliveryType: shipment.deliveryType || "manual", assignedPreparerIds: shipment.assignedPreparerIds, reason: "", origin: "" } : {}), [people, setPeople] = useState([]), [origins, setOrigins] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState(""), [access, setAccess] = useState(null), [actionsOpen, setActionsOpen] = useState(false);
  const operationRef = useRef(null), busyRef = useRef(false);
  const [preview, setPreview] = useState(null), [liveSession, setLiveSession] = useState(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    setLiveSession(null);
    if (!shipment.courierSessionId || !can(profile, "shipping", "view")) return undefined;
    return subscribeCourierSession(shipment.courierSessionId, setLiveSession, error => { setLiveSession(null); setError(error.message); });
  }, [shipment.courierSessionId, profile.id]);
  const isEditor = can(profile, "shipping", "edit"), canApprove = can(profile, "shipping", "approve"), assigned = shipment.assignedPreparerIds.includes(profile.id), closed = CLOSED_SHIPPING_STATES.includes(shipment.status);
  useEffect(() => { if (!isEditor && !canApprove) return; let active = true;
    shippingRequest({ mode: "resources" }).then(rows => active && setPeople(rows)).catch(error => active && setError(error.message));
    if (canApprove) Promise.all([listLocationsShared(profile), can(profile, "warehouse", "view") ? listWarehouses(profile) : []]).then(([locations, warehouses]) => active && setOrigins([...locations.map(row => ({ ...row, type: "location" })), ...warehouses.map(row => ({ ...row, type: "warehouse" }))])).catch(error => active && setError(error.message));
    return () => { active = false; };
  }, [profile.id, canApprove, isEditor]);
  const execute = async (action, data = {}) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    const identity = JSON.stringify({ action, data });
    if (operationRef.current?.identity !== identity) operationRef.current = { identity, requestId: crypto.randomUUID() };
    try { await shippingRequest({ mode: action, shipmentId: shipment.id, requestId: operationRef.current.requestId, ...data }); operationRef.current = null; setMode(""); await reload(); } catch (error) { setError(error.message); } finally { busyRef.current = false; setBusy(false); }
  };
  const open = action => { setMode(action); setActionsOpen(false); setError(""); setForm({ ...shipment.destination, deliveryType: shipment.deliveryType || "manual", assignedPreparerIds: shipment.assignedPreparerIds, reason: "", origin: "", verified: shipment.destination.verified === true, lat: shipment.destination.lat ?? "", lng: shipment.destination.lng ?? "" }); };
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const generateAccess = async (kind, leg) => { if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(""); try {
    const result = await issueShippingAccess(shipment.id, kind, leg);
    const url = kind === "courier" ? `${window.location.origin}/e/${shipment.publicLookupId}?role=courier${new URL(result.url).hash}` : result.url;
    setAccess({ ...result, kind, url }); await reload();
  } catch (error) { setError(error.message); } finally { busyRef.current = false; setBusy(false); } };
  const print = async () => { if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(""); try { const data = await shippingRequest({ mode: "labels", shipmentId: shipment.id, requestId: crypto.randomUUID() }); const { buildShippingLabelPdf } = await import("./shippingLabels.mjs"); const pdf = await buildShippingLabelPdf([data.shipment], import.meta.env.VITE_PUBLIC_APP_BASE_URL || window.location.origin); setPreview(URL.createObjectURL(pdf.output("blob"))); await reload(); } catch (error) { setError(error.message); } finally { busyRef.current = false; setBusy(false); } };
  const verify = () => {
    if (mode === "approve") { const origin = origins.find(row => `${row.type}:${row.id}` === form.origin); if (!origin) { setError("Elegí el origen real."); return; } execute("approve", { ...form, originType: origin.type, originId: origin.id }); }
    else if (mode === "address") execute("address", { ...form, lat: form.lat === "" ? null : Number(form.lat), lng: form.lng === "" ? null : Number(form.lng) });
    else if (mode === "delivery_exception") execute(mode, { reason: form.reason, grantHash: shipment.courierGrantHashes?.[shipment.deliveryType === "repository" ? "final" : "direct"] || "" });
    else execute(mode, form);
  };
  const operationForm = mode && <Panel title={{ approve: "Origen real y preparación", address: "Corregir dirección", assign: "Preparadores", incident: "Informar problema", resolve: "Resolver incidencia", review: "Solicitud en revisión", retry: "Reintentar entrega", reject: "Rechazar solicitud", cancel: "Cancelar envío", return: "Registrar devolución", undelivered: "No entregado", delivery_exception: "Excepción supervisada" }[mode]}>
      {mode === "retry" && <><FormField label="Ubicación actual del pedido"><Select value={form.retryFrom || ""} onChange={event => set("retryFrom", event.target.value)}><option value="">Elegí su ubicación física</option><option value="origin">En origen, listo para retirar</option>{shipment.deliveryType === "repository" && <option value="repository">Recibido en repositorio</option>}<option value="final">Con el repartidor, durante reparto final</option></Select></FormField><label className="fm-shipping-check"><input type="checkbox" checked={form.physicalPositionConfirmed || false} onChange={event => set("physicalPositionConfirmed", event.target.checked)} />Confirmé físicamente dónde está el pedido</label><p>El stock ya está imputado. El reintento no genera otra venta ni otra salida de inventario.</p></>}
      {mode === "approve" && <FormField label="Origen físico real" required><Select value={form.origin} onChange={event => set("origin", event.target.value)}><option value="">Elegí ubicación o depósito</option>{origins.map(row => <option key={`${row.type}:${row.id}`} value={`${row.type}:${row.id}`}>{row.type === "warehouse" ? "Depósito" : "Local"} · {row.name}</option>)}</Select></FormField>}
      {["approve", "address"].includes(mode) && <ShippingFields value={form} onChange={setForm} administrative={mode !== "address"} people={people} />}
      {mode === "assign" && <fieldset className="fm-shipping-people"><legend>Personas que preparan</legend>{people.map(person => <label key={person.id}><input type="checkbox" checked={form.assignedPreparerIds.includes(person.id)} onChange={event => set("assignedPreparerIds", event.target.checked ? [...form.assignedPreparerIds, person.id] : form.assignedPreparerIds.filter(id => id !== person.id))} />{person.label || person.name}</label>)}</fieldset>}
      {mode === "address" && <><p>Buscá el domicilio en el mapa y tocá su ubicación. También podés ingresar las coordenadas. Flor Mía no comparte la dirección con un servicio externo de geocodificación.</p><ShippingMap selectDestination onDestinationChange={({ lat, lng }) => setForm(current => ({ ...current, lat, lng, verified: false }))} destination={{ lat: Number(form.lat), lng: Number(form.lng), verified: false }} /><label className="fm-shipping-check"><input type="checkbox" checked={form.verified} onChange={event => set("verified", event.target.checked)} />Verifiqué que el marcador señala el domicilio correcto</label><div className="fm-shipping-detail-grid"><FormField label="Latitud"><input type="number" step="any" value={form.lat} onChange={event => set("lat", event.target.value)} /></FormField><FormField label="Longitud"><input type="number" step="any" value={form.lng} onChange={event => set("lng", event.target.value)} /></FormField><FormField label="Provincia o CABA"><input maxLength={100} value={form.provinceOrCaba || ""} onChange={event => set("provinceOrCaba", event.target.value)} /></FormField><FormField label="Barrio o localidad"><input maxLength={100} value={form.neighborhoodOrLocality || ""} onChange={event => set("neighborhoodOrLocality", event.target.value)} /></FormField></div></>}
      {mode === "incident" ? <><FormField label="Motivo"><Select value={form.reason} onChange={event => set("reason", event.target.value)}><option value="">Elegí motivo</option>{[...PREPARATION_PROBLEMS, "Cliente ausente", "Dirección incorrecta", "Problema de transporte"].map(reason => <option key={reason}>{reason}</option>)}</Select></FormField><FormField label="Detalle"><textarea maxLength={1000} value={form.note || ""} onChange={event => set("note", event.target.value)} /></FormField></> : mode !== "approve" && <FormField label="Motivo" required><textarea maxLength={1000} value={form.reason} onChange={event => set("reason", event.target.value)} /></FormField>}
      {["return", "cancel", "undelivered"].includes(mode) && <p>No repone stock ni devuelve dinero. Esos movimientos requieren registro y revisión por separado.</p>}
      {mode === "delivery_exception" && <p>Permite al repartidor vigente confirmar una entrega sin geocerca durante 30 minutos. Quedan registrados tu usuario, motivo y la versión del domicilio.</p>}
      <div className="fm-shipping-actions"><Button loading={busy} onClick={verify}>Confirmar</Button><Button variant="secondary" onClick={() => setMode("")}>Volver</Button></div>
    </Panel>;
  const position = shipment.courierSessionId ? liveSession?.lastPosition : shipment.lastPosition;
  const gpsTrail = shipment.courierSessionId ? liveSession?.gpsTrail : shipment.gpsTrail;
  const actionOptions = [
    ...(assigned && !closed && !shipment.incident && ["aprobado", "en_preparacion"].includes(shipment.status) ? [
      ...(shipment.status === "aprobado" ? [{ key: "start", title: "Comenzar preparación", description: "Marca que empezaste a preparar este pedido.", label: "Comenzar preparación", run: () => execute("start_preparing"), secondary: true }] : []),
      { key: "ready", title: "Pedido preparado y listo para retirar", description: "Avisa a Gestión y al Panel Vendedor que el paquete puede retirarse.", label: "Marcar listo", run: () => execute("ready") },
      { key: "preparation-issue", title: "No puedo preparar el pedido", description: "Informa a Gestión qué impide preparar el pedido.", label: "Informar problema", run: () => open("incident"), secondary: true },
    ] : []),
    ...(canApprove && shipment.status === "solicitud_pendiente" ? [
      { key: "approve", title: "Aprobar origen y preparación", description: "Confirma el origen físico y descuenta el stock correspondiente.", label: "Aprobar envío", run: () => open("approve") },
      { key: "review", title: "Solicitar corrección", description: "Deja la solicitud en revisión sin descontar stock.", label: "Pedir corrección", run: () => open("review"), secondary: true },
      { key: "reject", title: "Rechazar solicitud", description: "Cierra la solicitud de envío del Panel Vendedor con un motivo.", label: "Rechazar", run: () => open("reject"), secondary: true },
    ] : []),
    ...(isEditor && !internal && !closed ? [
      { key: "address", title: "Corregir dirección y verificar el punto", description: "Actualiza el domicilio y el marcador usado para el seguimiento.", label: "Revisar domicilio", run: () => open("address"), secondary: true },
      ...(["aprobado", "en_preparacion", "listo_retirar"].includes(shipment.status) ? [{ key: "assign", title: "Asignar preparadores", description: "Elige qué usuarios pueden preparar este pedido desde su panel.", label: "Asignar personal", run: () => open("assign"), secondary: true }] : []),
      ...(!shipment.incident ? [{ key: "incident", title: "Informar una incidencia", description: "Registra un problema y pausa las acciones de reparto.", label: "Informar incidencia", run: () => open("incident"), secondary: true }] : []),
      { key: "undelivered", title: "Marcar como no entregado", description: "Registra que el intento de entrega no se completó.", label: "No entregado", run: () => open("undelivered"), secondary: true },
      { key: "return", title: "Registrar devolución", description: "Deja constancia del paquete devuelto para su revisión.", label: "Registrar devolución", run: () => open("return"), secondary: true },
      { key: "cancel", title: "Cancelar envío", description: "Cierra el envío con un motivo. No devuelve stock ni dinero.", label: "Cancelar envío", run: () => open("cancel"), secondary: true },
    ] : []),
    ...(isEditor && shipment.incident ? [{ key: "resolve", title: "Resolver incidencia", description: "Cierra el problema y revisa el próximo paso del envío.", label: "Resolver incidencia", run: () => open("resolve"), secondary: true }] : []),
    ...(isEditor && shipment.status === "no_entregado" ? [{ key: "retry", title: "Reintentar entrega", description: "Confirma dónde está físicamente el paquete antes de habilitar otro recorrido.", label: "Preparar reintento", run: () => open("retry") }] : []),
    ...(canApprove && shipment.status === "reparto_final" ? [{ key: "delivery-exception", title: "Autorizar excepción de entrega", description: "Permite una confirmación supervisada cuando falta la geocerca del domicilio.", label: "Revisar excepción", run: () => open("delivery_exception"), secondary: true }] : []),
  ];
  if (review) return <div className="fm-shipping-review">
    <Panel title={`Revisión · ${shipment.publicCode}`} description="El local que realizó la venta se conserva en sus métricas." action={<Badge tone="warning">{shipment.stockCommitState === "committed" ? "Stock imputado" : "Aún sin descuento de stock"}</Badge>}>
      <div className="fm-shipping-review-summary"><div><small>VENTA REGISTRADA EN</small><strong>{shipment.commercialLocationName || "Venta administrativa"}</strong><p>Atribución comercial: no se modifica.</p></div><div><small>CLIENTE Y DESTINO</small><strong>{shipment.customerSnapshot.name}</strong><p>{shipment.destination.displayAddress}</p></div></div>
      <ul className="fm-shipping-review-items">{shipment.itemsSnapshot.map(item => <li key={item.productId}>{item.qty} × {item.name}</li>)}</ul>
      {shipment.approvalReview && <p className="fm-shipping-muted">En revisión: {shipment.approvalReview.reason}</p>}
      {operationForm}
      {actionOptions.length > 0 && <Panel className="fm-shipping-actions-panel" title="Acciones del envío" description="Cada acción explica el cambio antes de abrir su formulario." action={<Button variant="secondary" aria-expanded={actionsOpen} onClick={() => setActionsOpen(value => !value)}>{actionsOpen ? "Ocultar acciones" : "Ver acciones"}</Button>}>
        {actionsOpen && <div className="fm-shipping-action-list">{actionOptions.map(option => <article key={option.key}><div><strong>{option.title}</strong><p>{option.description}</p></div><Button variant={option.secondary ? "secondary" : "primary"} loading={busy} onClick={option.run}>{option.label}</Button></article>)}</div>}
      </Panel>}
      {!canApprove && <p>Tu usuario puede consultar esta solicitud. La aprobación del origen requiere autorización administrativa.</p>}
      {shipment.status !== "solicitud_pendiente" && <p role="status">{SHIPPING_STATES[shipment.status]}</p>}
      {error && <p role="alert" className="fm-shipping-error">{error}</p>}
    </Panel>
  </div>;
  return <div className="fm-shipping-detail">
    <div className="fm-shipping-detail-toolbar"><Badge tone={shipment.incident ? "error" : shipment.status === "entregado" ? "success" : "warning"}>{SHIPPING_STATES[shipment.status]}</Badge><span>{shipment.saleCode}</span><a className="fm-button fm-button--secondary" href={`/e/${shipment.publicLookupId}`}>Abrir QR</a>
    {(isEditor || assigned) && shipment.stockCommitState === "committed" && <Button variant="secondary" icon="Printer" loading={busy} onClick={print}>Imprimir etiqueta</Button>}
    </div>
    <LabelPreview url={preview} onClose={() => setPreview(null)} />
    {shipment.incident && <div className="fm-shipping-incident" role="status"><strong>Incidencia: {shipment.incident.reason}</strong><p>{shipment.incident.note}</p></div>}
    {shipment.approvalReview && shipment.status === "solicitud_pendiente" && <p role="status">En revisión: {shipment.approvalReview.reason}</p>}
    <Panel className="fm-shipping-customer-card" title="Datos del pedido"><dl className="fm-shipping-key-values"><div><dt>Cliente</dt><dd>{shipment.customerSnapshot.name}</dd></div><div><dt>Teléfono</dt><dd><a href={`tel:${shipment.customerSnapshot.phone}`}>{shipment.customerSnapshot.phone}</a></dd></div><div><dt>Dirección</dt><dd>{shipment.destination.displayAddress}</dd></div><div><dt>Zona</dt><dd>{shipment.destination.verified ? `${shipment.destination.provinceOrCaba || ""} · ${shipment.destination.neighborhoodOrLocality || "Marcador verificado"}` : "Zona por confirmar"}</dd></div><div><dt>Observaciones</dt><dd>{shipment.destination.notes || "No hay observaciones"}</dd></div></dl><p><a target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shipment.destination.displayAddress)}`}>Cómo llegar con Google Maps</a></p></Panel>
    <div className="fm-shipping-detail-grid"><Panel title="Pedido"><ul>{shipment.itemsSnapshot.map(item => <li key={item.productId}>{item.qty} × {item.name}</li>)}</ul><p>Preparan: {shipment.preparerNames.join(", ") || "Por asignar"}</p><p>Transporte: {TRANSPORTS[shipment.deliveryType] || "Por definir"}</p></Panel><Panel title="Origen de la operación"><p>Local comercial: {shipment.commercialLocationName || "Venta administrativa"}</p><p>Salida física: {shipment.stockOriginName || "Pendiente de aprobación"}</p><p>Stock: {shipment.stockCommitState === "committed" ? "Imputado una vez" : "Sin descontar"}</p>{shipment.repository && <p>Etapa intermedia: {shipment.repository.displayAddress || shipment.repository.displayName || "Repositorio de Flor Mía"}</p>}</Panel></div>
    {!internal && <Panel className="fm-shipping-tracking-card" title="Seguimiento del recorrido" description={shipment.deliveryType === "repository" ? "Repositorio · Última ubicación permitida durante el tramo al cliente." : "Reparto directo · Última ubicación compartida."}><ShippingMap position={position} trail={gpsTrail} destination={shipment.destination} active={shipment.courierSessionId ? Boolean(liveSession?.gpsEnabled) : shipment.status === "reparto_final"} /><p className="fm-shipping-muted fm-shipping-geofence-note">{shipment.geofenceConfigured ? "Geocerca configurada en servidor." : "La entrega sin geocerca requiere una excepción supervisada."}</p></Panel>}
    {actionOptions.length > 0 && <Panel className="fm-shipping-actions-panel" title="Acciones del envío" description="Cada acción explica el cambio antes de abrir su formulario." action={<Button variant="secondary" aria-expanded={actionsOpen} onClick={() => setActionsOpen(value => !value)}>{actionsOpen ? "Ocultar acciones" : "Ver acciones"}</Button>}>
      {actionsOpen && <div className="fm-shipping-action-list">{actionOptions.map(option => <article key={option.key}><div><strong>{option.title}</strong><p>{option.description}</p></div><Button variant={option.secondary ? "secondary" : "primary"} loading={busy && ["ready", "start"].includes(option.key)} onClick={option.run}>{option.label}</Button></article>)}</div>}
    </Panel>}
    {isEditor && !closed && !internal && <Panel title="Accesos limitados" description="Cada nuevo enlace revoca el anterior de ese tipo/tramo. Compartilos manualmente sólo con la persona correspondiente.">
      <div className="fm-shipping-actions">{shipment.stockCommitState === "committed" && (shipment.deliveryType === "repository" ? <><Button variant="secondary" loading={busy} onClick={() => generateAccess("courier", "origin")}>Acceso · origen a repositorio</Button><Button variant="secondary" loading={busy} onClick={() => generateAccess("courier", "final")}>Acceso · reparto final</Button></> : <Button variant="secondary" loading={busy} onClick={() => generateAccess("courier", "direct")}>Autorizar repartidor</Button>)}<Button variant="secondary" loading={busy} onClick={() => generateAccess("tracking")}>Crear enlace para cliente</Button><Button variant="secondary" loading={busy} onClick={() => execute("revoke_access")}>Revocar accesos</Button></div>
      {access && <div><p role="status">Vence: {formatDateTime(access.expiresAt)}. El enlace se muestra en esta sesión.</p><input readOnly aria-label="Enlace autorizado" value={access.url} /><Button variant="secondary" onClick={() => navigator.clipboard.writeText(access.url).catch(() => setError("Seleccioná y copiá el enlace manualmente."))}>Copiar enlace</Button>{access.kind === "courier" && <ShippingAccessQr url={access.url} />}</div>}
    </Panel>}
    {operationForm}
    {error && <p role="alert" className="fm-shipping-error">{error}</p>}
    <Panel className="fm-shipping-events-card" title="Eventos" description="Traza de cada cambio de estado."><ol className="fm-shipping-timeline">{(shipment.events || []).map(event => <li key={event.id}><strong>{({ created: "Venta y envío registrados", approve: "Origen aprobado y stock imputado", start_preparing: "Preparación iniciada", ready: "Listo para retirar", incident: "Incidencia registrada", labels: "Etiquetas generadas", courier_action: SHIPPING_STATES[event.status], address: "Dirección actualizada", resolve: "Incidencia resuelta", assign: "Preparadores actualizados", review: "Solicitud en revisión", reject: "Solicitud rechazada", retry: "Reintento autorizado", issue_access: "Acceso temporal generado", revoke_access: "Accesos revocados", delivery_exception: "Excepción de entrega autorizada", cancel: "Envío cancelado", return: "Devolución registrada", undelivered: "Entrega no realizada" })[event.action] || "Operación registrada"}</strong><span>{formatDateTime(event.createdAt)} · {event.actorRole === "external_courier" ? "Repartidor" : event.actorId === profile.id ? "Tu usuario" : "Equipo de Flor Mía"}</span>{event.reason && <p>{event.reason}</p>}</li>)}</ol></Panel>
  </div>;
}
export default function ShipmentDetail({ shipmentId, profile, onClose, revision, presentation = "drawer" }) {
  const [shipment, setShipment] = useState(null), [error, setError] = useState("");
  const reload = async () => { if (shipmentId) setShipment(await shippingRequest({ mode: "detail", shipmentId })); };
  useEffect(() => { setShipment(null); setError(""); }, [shipmentId]);
  useEffect(() => {
    let live = true;
    if (!shipmentId) return () => { live = false; };
    const unsubscribe = subscribeShippingShipment(shipmentId, row => { if (live) { setShipment(row); setError(""); } }, error => live && setError(error.message));
    return () => { live = false; unsubscribe(); };
  }, [shipmentId, revision]);
  const current = shipment?.id === shipmentId ? shipment : null;
  if (presentation !== "drawer") return <section className={`fm-shipping-detail-page is-${presentation}`}>
    {presentation === "page" && <><button className="fm-shipping-back" onClick={onClose}>← Gestión de envíos <span> / {current?.publicCode || "Detalle"}</span></button>{current && <><header className="fm-shipping-view-heading"><div><p className="fm-shipping-eyebrow">Detalle del envío · Seguimiento</p><h1>{current.customerSnapshot.name}</h1><p>{current.saleCode} · {TRANSPORTS[current.deliveryType]} · Origen: {current.stockOriginName || "Por aprobar"}</p></div><Badge tone={current.status === "entregado" ? "success" : "warning"}>{SHIPPING_STATES[current.status]}</Badge></header><ShippingProgress status={current.status} repository={current.deliveryType === "repository"} /></>}</>}
    {error && <p role="alert" className="fm-shipping-error">{error}</p>}{current ? <ShipmentContent key={`${shipmentId}-${presentation}`} shipment={current} profile={profile} reload={reload} review={presentation === "review"} /> : !error && <Skeleton />}
    {presentation === "review" && <Button variant="secondary" onClick={onClose}>Ver detalle del envío</Button>}
  </section>;
  return <Drawer open={Boolean(shipmentId)} onClose={onClose} title={current?.publicCode || "Ficha de envío"}>{error && <p role="alert">{error}</p>}{current ? <ShipmentContent key={shipmentId} shipment={current} profile={profile} reload={reload} /> : !error && <Skeleton />}</Drawer>;
}
