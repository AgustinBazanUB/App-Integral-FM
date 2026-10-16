import { useEffect, useMemo, useState } from "react";
import { Badge, Button, DataTable, EmptyState, FilterBar, FormField, PageHeader, Panel, SearchInput, Select, Skeleton, StatCard, Tabs } from "../../design-system";
import { useAuth } from "../AuthContext";
import { Link, useLocation, useNavigate } from "../../router";
import { subscribeShipments } from "../services/shippingService";
import { SHIPPING_STATES, TRANSPORTS, shippingBucket } from "../../shared/shippingDomain.mjs";
import { argentinaDateKey } from "../../modules/locations/domain/time.js";
import { formatDateTime } from "../formatters";
import ShippingTasks from "../shipping/ShippingTasks";
import ShipmentDetail from "../shipping/ShipmentDetail";
import "../shipping/shipping.css";

export default function ShippingPage() {
  const { profile } = useAuth(), location = useLocation(), navigate = useNavigate();
  const [rows, setRows] = useState(null), [error, setError] = useState(""), [tab, setTab] = useState("board"), [bucket, setBucket] = useState("pending"), [filters, setFilters] = useState({});
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
  const columns = [
    { key: "issue", label: "Incidencia", render: row => row.incident ? <Badge tone="error" icon="CircleAlert">{row.incident.reason}</Badge> : "—" },
    { key: "code", label: "Envío y venta", render: row => <div><strong>{row.publicCode}</strong><small>{row.saleCode}</small></div> },
    { key: "customer", label: "Cliente", render: row => <div>{row.customerSnapshot.name}<small>{row.customerSnapshot.phone}</small></div> },
    { key: "destination", label: "Destino y zona", render: row => <div>{row.destination.displayAddress}<small>{row.destination.verified ? row.destination.neighborhoodOrLocality || "Marcador verificado" : "Zona por confirmar"}</small></div> },
    { key: "transport", label: "Transporte", render: row => TRANSPORTS[row.deliveryType] || "Por definir" },
    { key: "status", label: "Estado", render: row => <Badge tone={row.incident ? "error" : row.status === "entregado" ? "success" : "warning"}>{SHIPPING_STATES[row.status]}</Badge> },
    { key: "people", label: "Preparadores", render: row => row.preparerNames.join(", ") || "Por asignar" },
    { key: "updatedAt", label: "Actualizado", render: row => formatDateTime(row.updatedAt) },
    { key: "action", label: "Acción", render: row => <Button variant="secondary" onClick={() => open(row.id)}>Ver detalle</Button> },
  ];
  return <div className="fm-shipping-page">
    <PageHeader eyebrow="MÓDULO 11 · LOGÍSTICA" title="Gestión de envíos" description="Solicitudes, preparación y reparto de los pedidos de Flor Mía." actions={<Link className="fm-button fm-button--primary" to="/gestion/quick-sales">Cargar un envío · Venta Rápida</Link>} />
    <div className="fm-shipping-stats"><StatCard label="Pendientes" value={counts.pending} icon="Package" /><StatCard label="En camino" value={counts.transit} icon="Truck" tone="olive" /><StatCard label="Realizados hoy" value={counts.today} icon="PackageCheck" tone="olive" /><StatCard label="Incidencias críticas" value={counts.critical} icon="CircleAlert" tone="error" /></div>
    <Tabs tabs={[{ id: "board", label: "Tablero" }, { id: "requests", label: "Solicitudes del vendedor" }, { id: "tasks", label: "Mis preparaciones y etiquetas" }]} active={tab} onChange={setTab} />
    {error && <p role="alert" className="fm-shipping-error">No se pudieron cargar los envíos: {error}</p>}
    {tab === "tasks" ? <ShippingTasks profile={profile} onDetail={open} /> : <Panel title={tab === "requests" ? "Solicitudes del vendedor" : "Pedidos y entregas"} description="Hasta 250 envíos actualizados recientemente. Las excepciones se consultan en Todos y nunca cuentan como entregados.">
      {tab === "board" && <Tabs tabs={[{ id: "pending", label: "Pendientes" }, { id: "transit", label: "En camino" }, { id: "completed", label: "Realizados" }, { id: "all", label: "Todos" }]} active={bucket} onChange={setBucket} />}
      <FilterBar search={<SearchInput label="ID, venta, cliente, teléfono o dirección" value={filters.search || ""} onChange={event => set("search", event.target.value)} />}>
        <FormField label="Desde"><input type="date" value={filters.from || ""} onChange={event => set("from", event.target.value)} /></FormField><FormField label="Hasta"><input type="date" value={filters.to || ""} onChange={event => set("to", event.target.value)} /></FormField>
        <FormField label="Origen físico"><Select aria-label="Origen físico" value={filters.origin || ""} onChange={event => set("origin", event.target.value)}><option value="">Todos los orígenes</option>{origins.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select></FormField>
        <FormField label="Transporte"><Select aria-label="Transporte" value={filters.transport || ""} onChange={event => set("transport", event.target.value)}><option value="">Todos los transportes</option>{Object.entries(TRANSPORTS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select></FormField>
        <FormField label="Preparador"><Select aria-label="Preparador" value={filters.preparer || ""} onChange={event => set("preparer", event.target.value)}><option value="">Todos los preparadores</option>{people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select></FormField>
        <FormField label="Estado"><Select aria-label="Estado" value={filters.status || ""} onChange={event => set("status", event.target.value)}><option value="">Todos los estados</option>{Object.entries(SHIPPING_STATES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select></FormField>
      </FilterBar>
      {rows === null && !error ? <Skeleton lines={6} /> : <DataTable columns={columns} rows={visible} empty={<EmptyState icon="Truck" title="No hay envíos para estos filtros" description="Los envíos se generan al confirmar ventas con envío en Venta Rápida o en el Panel Vendedor." />} />}
    </Panel>}
    <ShipmentDetail shipmentId={selected} profile={profile} revision={(rows || []).find(row => row.id === selected)?.revision} onClose={() => open(null)} />
  </div>;
}
