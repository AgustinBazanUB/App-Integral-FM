import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, DataTable, EmptyState, FilterBar, FormField, PageHeader, Panel, SearchInput, Select, Skeleton, StatCard, Tabs } from "../../design-system";
import { useAuth } from "../AuthContext";
import { Link, useLocation, useNavigate } from "../../router";
import { subscribeShipments, createCourierRouteAccess } from "../services/shippingService";
import { SHIPPING_STATES, TRANSPORTS, shippingBucket } from "../../shared/shippingDomain.mjs";
import { argentinaDateKey } from "../../modules/locations/domain/time.js";
import { formatDateTime } from "../formatters";
import ShippingTasks from "../shipping/ShippingTasks";
import ShipmentDetail from "../shipping/ShipmentDetail";
import ShippingRequests from "../shipping/ShippingRequests";
import ShippingAccessQr from "../shipping/ShippingAccessQr";
import { can } from "../permissions";
import "../shipping/shipping.css";

export default function ShippingPage() {
  const { profile } = useAuth(), location = useLocation(), navigate = useNavigate();
  const [rows, setRows] = useState(null), [error, setError] = useState(""), [tab, setTab] = useState("board"), [bucket, setBucket] = useState("pending"), [filters, setFilters] = useState({});
  const [routeLeg, setRouteLeg] = useState("direct"), [selectedRouteIds, setSelectedRouteIds] = useState([]), [routeAccess, setRouteAccess] = useState(null), [routeError, setRouteError] = useState(""), [routeBusy, setRouteBusy] = useState(false);
  const routeAttempt = useRef(null), canManage = can(profile, "shipping", "edit");
  const selected = new URLSearchParams(location.search).get("shipment");
  useEffect(() => subscribeShipments(profile, setRows, error => setError(error.message)), [profile.id]);
  const open = id => navigate(`/gestion/shipping${id ? `?shipment=${encodeURIComponent(id)}` : ""}`);
  const set = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  const counts = useMemo(() => (rows || []).reduce((result, row) => { const group = shippingBucket(row); result[group]++; if (row.incident) result.critical++; if (row.deliveredAt && argentinaDateKey(row.deliveredAt?.toDate?.() || row.deliveredAt) === argentinaDateKey()) result.today++; return result; }, { pending: 0, transit: 0, completed: 0, exceptions: 0, critical: 0, today: 0 }), [rows]);
  const visible = (rows || []).filter(row => {
    if (tab === "requests" && row.status !== "solicitud_pendiente") return false;
    if (tab === "board" && bucket !== "all" && shippingBucket(row) !== bucket) return false;
    const term = (filters.search || "").trim().toLocaleLowerCase("es");
    const haystack = `${row.publicCode} ${row.id} ${row.saleId} ${row.saleCode} ${row.customerSnapshot.name} ${row.customerSnapshot.phone} ${row.destination.displayAddress}`.toLocaleLowerCase("es");
    const date = argentinaDateKey(row.createdAt?.toDate?.() || row.createdAt);
    return (!term || haystack.includes(term)) && (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to) && (!filters.transport || row.deliveryType === filters.transport) && (!filters.status || row.status === filters.status) && (!filters.origin || `${row.stockOriginType}:${row.stockOriginId}` === filters.origin) && (!filters.preparer || row.assignedPreparerIds.includes(filters.preparer));
  });
  const origins = [...new Map((rows || []).filter(row => row.stockOriginId).map(row => [`${row.stockOriginType}:${row.stockOriginId}`, row.stockOriginName])).entries()];
  const people = [...new Map((rows || []).flatMap(row => row.assignedPreparerIds.map((id, index) => [id, row.preparerNames[index]]))).entries()];
  const routeEligible = row => Boolean(row && row.stockCommitState === "committed" && !row.incident && (
    routeLeg === "direct" ? row.deliveryType !== "repository" && ["listo_retirar", "reparto_final"].includes(row.status)
      : routeLeg === "origin" ? row.deliveryType === "repository" && ["listo_retirar", "hacia_repositorio"].includes(row.status)
        : row.deliveryType === "repository" && ["recibido_repositorio", "reparto_final"].includes(row.status)
  ));
  const createRoute = async () => {
    const shipmentIds = selectedRouteIds.filter(id => routeEligible((rows || []).find(row => row.id === id)));
    if (!shipmentIds.length || routeBusy) return;
    const signature = JSON.stringify({ shipmentIds: [...shipmentIds].sort(), routeLeg });
    if (routeAttempt.current?.signature !== signature) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      routeAttempt.current = { signature, shipmentIds, leg: routeLeg, sessionId: crypto.randomUUID(), requestId: crypto.randomUUID(), token: btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "") };
    }
    setRouteBusy(true); setRouteError("");
    try {
      const access = await createCourierRouteAccess(routeAttempt.current);
      setRouteAccess(access); setSelectedRouteIds([]); routeAttempt.current = null;
    } catch (error) { setRouteError(error.message); }
    finally { setRouteBusy(false); }
  };
  const requests = (rows || []).filter(row => row.status === "solicitud_pendiente");
  const columns = [
    ...(canManage ? [{ key: "route", label: "Ruta", render: row => <input type="checkbox" aria-label={`Incluir ${row.publicCode} en el recorrido`} disabled={!routeEligible(row)} checked={selectedRouteIds.includes(row.id)} onChange={event => setSelectedRouteIds(current => event.target.checked ? [...new Set([...current, row.id])] : current.filter(id => id !== row.id))} /> }] : []),
    { key: "issue", label: "!", render: row => row.incident ? <span className="fm-shipping-issue-mark" title={row.incident.reason} aria-label={`Incidencia: ${row.incident.reason}`}>!</span> : <span className="fm-shipping-neutral-dot" aria-label="Sin incidencia" /> },
    { key: "code", label: "Envío y venta", render: row => <div><strong>{row.publicCode}</strong><small>{row.saleCode}</small></div> },
    { key: "customer", label: "Cliente", render: row => <div>{row.customerSnapshot.name}<small>{row.customerSnapshot.phone}</small></div> },
    { key: "destination", label: "Destino y zona", render: row => <div>{row.destination.displayAddress}<small>{row.destination.verified ? row.destination.neighborhoodOrLocality || "Marcador verificado" : "Zona por confirmar"}</small></div> },
    { key: "transport", label: "Transporte", render: row => TRANSPORTS[row.deliveryType] || "Por definir" },
    { key: "status", label: "Estado", render: row => <Badge tone={row.incident ? "error" : row.status === "entregado" ? "success" : ["reparto_final", "hacia_repositorio", "recibido_repositorio"].includes(row.status) ? "info" : "warning"}>{row.incident ? "Incidencia crítica" : SHIPPING_STATES[row.status]}</Badge> },
    { key: "people", label: "Preparadores", render: row => row.preparerNames.join(", ") || "Por asignar" },
    { key: "updatedAt", label: "Actualizado", render: row => formatDateTime(row.updatedAt) },
    { key: "action", label: "Acción", render: row => <Button variant="secondary" onClick={() => open(row.id)}>Ver detalle</Button> },
  ];
  return <div className="fm-shipping-page">
    <nav className="fm-shipping-module-nav" aria-label="Gestión de envíos"><Tabs tabs={[{ id: "board", label: "Tablero" }, { id: "requests", label: <>Solicitudes del vendedor {requests.length > 0 && <span className="fm-shipping-tab-count">{requests.length}</span>}</> }, { id: "tasks", label: "Mis preparaciones y etiquetas" }]} active={tab} onChange={id => { setTab(id); if (selected) open(null); }} /><Link className="fm-button fm-button--primary" to="/gestion/quick-sales">Cargar un envío · Venta Rápida</Link></nav>
    {error && <p role="alert" className="fm-shipping-error">No se pudieron cargar los envíos: {error}</p>}
    {selected ? <ShipmentDetail shipmentId={selected} profile={profile} presentation="page" revision={(rows || []).find(row => row.id === selected)?.revision} onClose={() => open(null)} /> : tab === "tasks" ? <ShippingTasks profile={profile} onDetail={open} /> : <>
    <PageHeader eyebrow={tab === "requests" ? "GESTIÓN DE ENVÍOS / AUTORIZACIÓN" : "MÓDULO 11 · LOGÍSTICA"} title={tab === "requests" ? "Solicitudes del vendedor" : "Gestión de envíos"} description={tab === "requests" ? "Aprobá las solicitudes y elegí el origen real antes de descontar stock." : "Supervisá pedidos pendientes, entregas en curso y el historial. Las alertas críticas llegan a Notificaciones."} />
    {tab === "requests" ? rows === null ? <Skeleton /> : <ShippingRequests rows={requests} profile={profile} onDetail={open} /> : <>
    <div className="fm-shipping-stats"><StatCard label="Pendientes" value={counts.pending} hint="En preparación, listos y por revisar" icon="Package" /><StatCard label="En camino" value={counts.transit} hint="Incluye los tramos por repositorio" icon="Truck" tone="olive" /><StatCard label="Realizados hoy" value={counts.today} hint="Entregas completadas" icon="PackageCheck" tone="olive" /></div>
    <Panel title="Envíos registrados" description="Abrí un pedido para ver su detalle, estado y seguimiento.">
      {tab === "board" && <Tabs tabs={[{ id: "pending", label: "Pendientes" }, { id: "transit", label: "En camino" }, { id: "completed", label: "Realizados" }, { id: "all", label: "Todos" }]} active={bucket} onChange={setBucket} />}
      <FilterBar search={<SearchInput label="ID, venta, cliente, teléfono o dirección" value={filters.search || ""} onChange={event => set("search", event.target.value)} />}>
        <FormField label="Desde"><input type="date" value={filters.from || ""} onChange={event => set("from", event.target.value)} /></FormField><FormField label="Hasta"><input type="date" value={filters.to || ""} onChange={event => set("to", event.target.value)} /></FormField>
        <FormField label="Origen físico"><Select aria-label="Origen físico" value={filters.origin || ""} onChange={event => set("origin", event.target.value)}><option value="">Todos los orígenes</option>{origins.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select></FormField>
        <FormField label="Transporte"><Select aria-label="Transporte" value={filters.transport || ""} onChange={event => set("transport", event.target.value)}><option value="">Todos los transportes</option>{Object.entries(TRANSPORTS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select></FormField>
        <FormField label="Preparador"><Select aria-label="Preparador" value={filters.preparer || ""} onChange={event => set("preparer", event.target.value)}><option value="">Todos los preparadores</option>{people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select></FormField>
        <FormField label="Estado"><Select aria-label="Estado" value={filters.status || ""} onChange={event => set("status", event.target.value)}><option value="">Todos los estados</option>{Object.entries(SHIPPING_STATES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select></FormField>
      </FilterBar>
      {canManage && <Panel title="Recorrido del repartidor" description="Seleccioná pedidos compatibles para generar un QR temporal. El repartidor comparte una sola ubicación para toda la ruta.">
        <div className="fm-shipping-route-tools"><FormField label="Tramo"><Select value={routeLeg} onChange={event => { setRouteLeg(event.target.value); setSelectedRouteIds(current => current.filter(id => { const row = (rows || []).find(item => item.id === id); return event.target.value === "direct" ? row?.deliveryType !== "repository" && ["listo_retirar", "reparto_final"].includes(row?.status) : event.target.value === "origin" ? row?.deliveryType === "repository" && ["listo_retirar", "hacia_repositorio"].includes(row?.status) : row?.deliveryType === "repository" && ["recibido_repositorio", "reparto_final"].includes(row?.status); })); setRouteAccess(null); routeAttempt.current = null; }}><option value="direct">Entrega directa · cliente</option><option value="origin">Repositorio · origen a repositorio</option><option value="final">Repositorio · repositorio a cliente</option></Select></FormField><Button loading={routeBusy} disabled={!selectedRouteIds.some(id => routeEligible((rows || []).find(row => row.id === id)))} onClick={createRoute}>Crear QR de {selectedRouteIds.filter(id => routeEligible((rows || []).find(row => row.id === id))).length} envío(s)</Button></div>
        {routeError && <p role="alert" className="fm-shipping-error">{routeError}</p>}
        {routeAccess && <div className="fm-shipping-route-access"><p role="status">QR de recorrido válido hasta {formatDateTime(routeAccess.expiresAt)}. El acceso reúne {routeAccess.shipmentIds?.length || selectedRouteIds.length} envío(s).</p><input readOnly aria-label="Enlace temporal del recorrido" value={routeAccess.url} /><Button variant="secondary" onClick={() => navigator.clipboard.writeText(routeAccess.url).catch(() => setRouteError("Seleccioná y copiá el enlace manualmente."))}>Copiar enlace</Button><ShippingAccessQr url={routeAccess.url} title="Abrir el recorrido en el teléfono" description="Escaneá una vez para ver los pedidos asignados y compartir una única ubicación GPS durante las entregas." /></div>}
      </Panel>}
      {rows === null && !error ? <Skeleton lines={6} /> : <DataTable columns={columns} rows={visible} empty={<EmptyState icon="Truck" title="No hay envíos para estos filtros" description="Los envíos se generan al confirmar ventas con envío en Venta Rápida o en el Panel Vendedor." />} />}
    </Panel><p className="fm-shipping-muted">Las incidencias se marcan en rojo dentro del pedido. Las excepciones se consultan en Todos y no cuentan como entregados.</p></>}
    </>}
  </div>;
}
