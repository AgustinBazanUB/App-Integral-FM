import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, DataTable, EmptyState, FilterBar, FormField, Modal, PageHeader, Panel, SearchInput, Select, Skeleton, StatCard, Tabs } from "../../design-system";
import { useAuth } from "../AuthContext";
import { Link, useLocation, useNavigate } from "../../router";
import { subscribeShipments, createCourierRouteAccess, shippingRequest } from "../services/shippingService";
import { SHIPPING_STATES, TRANSPORTS, shippingBucket } from "../../shared/shippingDomain.mjs";
import { addArgentinaDays, argentinaDateKey, argentinaPeriodRange } from "../../modules/locations/domain/time.js";
import { formatDateTime } from "../formatters";
import { assignPreparersToShipments, changeShippingStates } from "../shipping/bulkAssignments.mjs";
import ShippingTasks from "../shipping/ShippingTasks";
import ShipmentDetail from "../shipping/ShipmentDetail";
import ShippingRequests from "../shipping/ShippingRequests";
import ShippingAccessQr from "../shipping/ShippingAccessQr";
import { can } from "../permissions";
import "../shipping/shipping.css";

function presetDates(preset) {
  if (preset === "all" || preset === "custom") return { from: "", to: "" };
  const range = argentinaPeriodRange(preset === "today" ? "day" : preset);
  return { from: argentinaDateKey(range.start), to: argentinaDateKey(addArgentinaDays(range.end, -1)) };
}

function RoutePreview() {
  return <svg className="fm-shipping-route-preview" viewBox="0 0 44 32" aria-hidden="true" focusable="false">
    <path d="M3 6h38M3 15h38M3 25h38M11 2v28M25 2v28M36 2v28" />
    <path className="fm-shipping-route-preview__path" d="M5 25h9l5-10h9l5-9h7" />
    <circle cx="5" cy="25" r="2.5" /><circle cx="35" cy="6" r="2.5" />
  </svg>;
}

export default function ShippingPage() {
  const { profile } = useAuth(), location = useLocation(), navigate = useNavigate();
  const [rows, setRows] = useState(null), [error, setError] = useState(""), [tab, setTab] = useState("board"), [bucket, setBucket] = useState("all"), [filters, setFilters] = useState(() => ({ preset: "week", ...presetDates("week") })), [filtersOpen, setFiltersOpen] = useState(false);
  const [routeLeg, setRouteLeg] = useState("direct"), [routeAccess, setRouteAccess] = useState(null), [routeError, setRouteError] = useState(""), [routeBusy, setRouteBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]), [actionRow, setActionRow] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false), [bulkPeople, setBulkPeople] = useState([]), [bulkPerson, setBulkPerson] = useState(""), [bulkReason, setBulkReason] = useState(""), [bulkBusy, setBulkBusy] = useState(false), [bulkNotice, setBulkNotice] = useState("");
  const [stateMode, setStateMode] = useState(""), [stateBusy, setStateBusy] = useState(false), [stateNotice, setStateNotice] = useState("");
  const [replaceOpen, setReplaceOpen] = useState(false), [replaceLeg, setReplaceLeg] = useState("direct"), [replaceReason, setReplaceReason] = useState(""), [replaceBusy, setReplaceBusy] = useState(false), [replaceError, setReplaceError] = useState(""), [replaceAccess, setReplaceAccess] = useState(null);
  const replacementAttempt = useRef(null);
  const stateAttempt = useRef(null);
  const bulkAttempt = useRef(null);
  const routeAttempt = useRef(null), canManage = can(profile, "shipping", "edit");
  const selected = new URLSearchParams(location.search).get("shipment");
  useEffect(() => subscribeShipments(profile, setRows, error => setError(error.message)), [profile.id]);
  const open = id => navigate(`/gestion/shipping${id ? `?shipment=${encodeURIComponent(id)}` : ""}`);
  const set = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  const setPeriod = preset => setFilters(current => ({ ...current, preset, ...presetDates(preset) }));
  const counts = useMemo(() => (rows || []).reduce((result, row) => { const group = shippingBucket(row); result[group]++; if (row.incident) result.critical++; if (row.deliveredAt && argentinaDateKey(row.deliveredAt?.toDate?.() || row.deliveredAt) === argentinaDateKey()) result.today++; return result; }, { pending: 0, transit: 0, completed: 0, exceptions: 0, critical: 0, today: 0 }), [rows]);
  const visible = (rows || []).filter(row => {
    if (tab === "web" && (row.creationSource !== "ecommerce" || row.assignedPreparerIds.length || row.status !== "aprobado")) return false;
    if (tab === "requests" && row.status !== "solicitud_pendiente") return false;
    if (tab === "board" && bucket !== "all" && shippingBucket(row) !== bucket) return false;
    const term = (filters.search || "").trim().toLocaleLowerCase("es");
    const addressTerm = (filters.address || "").trim().toLocaleLowerCase("es");
    const haystack = `${row.publicCode} ${row.id} ${row.saleId} ${row.saleCode} ${row.customerSnapshot.name} ${row.customerSnapshot.phone} ${row.destination.displayAddress}`.toLocaleLowerCase("es");
    const address = row.destination.displayAddress.toLocaleLowerCase("es");
    const date = argentinaDateKey(row.createdAt?.toDate?.() || row.createdAt);
    return (!term || haystack.includes(term)) && (!addressTerm || address.includes(addressTerm)) && (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to) && (!filters.transport || row.deliveryType === filters.transport) && (!filters.status || row.status === filters.status) && (!filters.origin || `${row.stockOriginType}:${row.stockOriginId}` === filters.origin) && (!filters.preparer || row.assignedPreparerIds.includes(filters.preparer));
  });
  const activeFilterCount = [filters.search, filters.address, filters.origin, filters.transport, filters.preparer, filters.status].filter(Boolean).length + (filters.preset === "custom" ? 1 : filters.preset === "all" ? 0 : 1);
  const periodLabels = { today: "Hoy", week: "Esta semana", month: "Este mes", all: "Todo el historial", custom: "Período personalizado" };
  const origins = [...new Map((rows || []).filter(row => row.stockOriginId).map(row => [`${row.stockOriginType}:${row.stockOriginId}`, row.stockOriginName])).entries()];
  const people = [...new Map((rows || []).flatMap(row => row.assignedPreparerIds.map((id, index) => [id, row.preparerNames[index]]))).entries()];
  const routeEligible = row => Boolean(row && row.fulfillmentType !== "pickup" && row.stockCommitState === "committed" && !row.incident && (
    routeLeg === "direct" ? row.deliveryType !== "repository" && ["listo_retirar", "reparto_final"].includes(row.status)
      : routeLeg === "origin" ? row.deliveryType === "repository" && ["listo_retirar", "hacia_repositorio"].includes(row.status)
        : row.deliveryType === "repository" && ["recibido_repositorio", "reparto_final"].includes(row.status)
  ));
  const createRoute = async () => {
    const shipmentIds = [...selectedIds];
    if (!shipmentIds.length || routeBusy) return;
    if (shipmentIds.length > 25) { setRouteError("Seleccioná hasta 25 envíos para el recorrido."); return; }
    const incompatible = shipmentIds.filter(id => !routeEligible((rows || []).find(row => row.id === id)));
    if (incompatible.length) { setRouteError(`${incompatible.length} envío(s) seleccionado(s) no corresponden al tramo o no están listos. Revisá la selección.`); return; }
    const signature = JSON.stringify({ shipmentIds: [...shipmentIds].sort(), routeLeg });
    if (routeAttempt.current?.signature !== signature) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      routeAttempt.current = { signature, shipmentIds, leg: routeLeg, sessionId: crypto.randomUUID(), requestId: crypto.randomUUID(), token: btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "") };
    }
    setRouteBusy(true); setRouteError("");
    try {
      const access = await createCourierRouteAccess(routeAttempt.current);
      setRouteAccess(access); setSelectedIds(current => current.filter(id => !shipmentIds.includes(id))); routeAttempt.current = null;
    } catch (error) { setRouteError(error.message); }
    finally { setRouteBusy(false); }
  };
  const openBulkAssign = async (row) => {
    setActionRow(null); setBulkPerson(""); setBulkReason(""); setBulkNotice(""); setBulkOpen(true);
    const ids = selectedIds.length > 1 ? selectedIds : [row.id];
    bulkAttempt.current = { ids, requests: Object.fromEntries(ids.map(id => [id, crypto.randomUUID()])), signature: null };
    try { setBulkPeople(await shippingRequest({ mode: "resources" })); }
    catch (error) { setBulkPeople([]); setBulkNotice(error.message); }
  };
  const applyBulkAssign = async () => {
    if (bulkBusy || !bulkPerson || bulkReason.trim().length < 4 || !bulkAttempt.current) return;
    const attempt = bulkAttempt.current, signature = JSON.stringify([bulkPerson, bulkReason.trim()]);
    if (attempt.signature && attempt.signature !== signature) attempt.requests = Object.fromEntries(attempt.ids.map(id => [id, crypto.randomUUID()]));
    attempt.signature = signature; setBulkBusy(true); setBulkNotice("");
    const { failures, successes } = await assignPreparersToShipments(attempt.ids, attempt.requests, bulkPerson, bulkReason.trim(), shippingRequest);
    setSelectedIds(current => current.filter(id => !successes.includes(id)));
    attempt.ids = failures.map(item => item.id);
    setBulkNotice(`${successes.length} envío(s) actualizado(s). ${failures.length} con error.` + (failures.length ? ` ${failures.map(item => `${(rows || []).find(row => row.id === item.id)?.publicCode || item.id}: ${item.message}`).join(" · ")}` : ""));
    setBulkBusy(false);
  };
  const openBulkState = (row, mode) => {
    const ids = selectedIds.length > 1 ? selectedIds : [row.id];
    stateAttempt.current = { ids, requests: Object.fromEntries(ids.map(id => [id, crypto.randomUUID()])) };
    setActionRow(null); setStateNotice(""); setStateMode(mode);
  };
  const applyBulkState = async () => {
    if (stateBusy || !stateAttempt.current?.ids.length) return;
    setStateBusy(true); setStateNotice("");
    const attempt = stateAttempt.current;
    const { successes, failures } = await changeShippingStates(attempt.ids, attempt.requests, stateMode, shippingRequest);
    setSelectedIds(current => current.filter(id => !successes.includes(id)));
    attempt.ids = failures.map(item => item.id);
    setStateNotice(`${successes.length} envío(s) actualizado(s). ${failures.length} con error.` + (failures.length ? ` ${failures.map(item => `${(rows || []).find(row => row.id === item.id)?.publicCode || item.id}: ${item.message}`).join(" · ")}` : ""));
    setStateBusy(false);
  };
  const openCourierReplacement = row => {
    const ids = selectedIds.length > 1 ? [...selectedIds] : [row.id];
    replacementAttempt.current = { ids }; setReplaceLeg("direct"); setReplaceReason(""); setReplaceError(""); setReplaceAccess(null); setActionRow(null); setReplaceOpen(true);
  };
  const replaceCouriers = async () => {
    if (replaceBusy || !replacementAttempt.current || replaceReason.trim().length < 4) return;
    const ids = replacementAttempt.current.ids;
    if (!ids.length || ids.length > 25) { setReplaceError("Seleccioná entre 1 y 25 envíos."); return; }
    const signature = JSON.stringify({ ids: [...ids].sort(), leg: replaceLeg, reason: replaceReason.trim() });
    if (replacementAttempt.current.signature !== signature) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      replacementAttempt.current = { ids, signature, shipmentIds: ids, leg: replaceLeg, reason: replaceReason.trim(), replaceExisting: true, sessionId: crypto.randomUUID(), requestId: crypto.randomUUID(), token: btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "") };
    }
    setReplaceBusy(true); setReplaceError("");
    try { const access = await createCourierRouteAccess(replacementAttempt.current); setReplaceAccess(access); setSelectedIds(current => current.filter(id => !ids.includes(id))); }
    catch (error) { setReplaceError(error.message); }
    finally { setReplaceBusy(false); }
  };
  const requests = (rows || []).filter(row => row.status === "solicitud_pendiente");
  const columns = [
    ...(canManage ? [{ key: "select", label: "Seleccionar", render: row => <input className="fm-shipping-select-checkbox" type="checkbox" aria-label={`Seleccionar ${row.publicCode}`} checked={selectedIds.includes(row.id)} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onChange={event => setSelectedIds(current => event.target.checked ? [...new Set([...current, row.id])] : current.filter(id => id !== row.id))} /> }] : []),
    ...(canManage ? [{ key: "route", label: "Ruta", render: () => <div className="fm-shipping-route-cell"><RoutePreview /></div> }] : []),
    { key: "issue", label: "!", render: row => row.incident ? <span className="fm-shipping-issue-mark" title={row.incident.reason} aria-label={`Incidencia: ${row.incident.reason}`}>!</span> : <span className="fm-shipping-neutral-dot" aria-label="Sin incidencia" /> },
    { key: "code", label: "Envío", render: row => <div className="fm-shipping-row-title"><strong>{row.fulfillmentType === "pickup" ? "Retiro para" : "Envío para"} {row.customerSnapshot.name}</strong><small>{row.publicCode} · {row.saleCode}</small>{row.creationSource === "ecommerce" && <small>Página web · {row.simulated ? "PAGO SIMULADO" : row.paymentStatus} · Fiscal: {row.invoiceStatus} · {row.total}</small>}</div> },
    { key: "destination", label: "Destino y zona", render: row => <div>{row.destination.displayAddress}<small>{row.destination.verified ? row.destination.neighborhoodOrLocality || "Marcador verificado" : "Zona por confirmar"}</small></div> },
    { key: "transport", label: "Transporte", render: row => row.fulfillmentType === "pickup" ? "Retiro por cliente" : TRANSPORTS[row.deliveryType] || "Por definir" },
    { key: "status", label: "Estado", render: row => <Badge tone={row.incident ? "error" : row.status === "entregado" ? "success" : ["reparto_final", "hacia_repositorio", "recibido_repositorio"].includes(row.status) ? "info" : "warning"}>{row.incident ? "Incidencia crítica" : SHIPPING_STATES[row.status]}</Badge> },
    { key: "people", label: "Preparadores", render: row => row.preparerNames.join(", ") || "Por asignar" },
    { key: "updatedAt", label: "Actualizado", render: row => formatDateTime(row.updatedAt) },
    ...(canManage ? [{ key: "actions", label: "Acciones", render: row => <div className="fm-shipping-row-actions" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}><button className="fm-shipping-row-actions__trigger" type="button" aria-label={`Acciones de ${row.publicCode}`} aria-expanded={actionRow === row.id} onClick={() => setActionRow(current => current === row.id ? null : row.id)}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg></button>{actionRow === row.id && <div className="fm-shipping-row-actions__menu"><button type="button" onClick={() => openBulkAssign(row)}>Asignar preparador{selectedIds.length > 1 ? ` a ${selectedIds.length} envíos` : ""}</button><button type="button" onClick={() => openCourierReplacement(row)}>Reemplazar repartidor{selectedIds.length > 1 ? ` en ${selectedIds.length} envíos` : ""}</button><button type="button" onClick={() => openBulkState(row, "start_preparing")}>Comenzar preparación{selectedIds.length > 1 ? ` de ${selectedIds.length} envíos` : ""}</button><button type="button" onClick={() => openBulkState(row, "ready")}>Marcar listo para retiro{selectedIds.length > 1 ? ` (${selectedIds.length} envíos)` : ""}</button></div>}</div> }] : []),
  ];
  return <div className="fm-shipping-page">
    <nav className="fm-shipping-module-nav" aria-label="Gestión de envíos"><Tabs tabs={[{ id: "board", label: "Tablero" }, { id: "web", label: "Pedidos web sin asignar" }, { id: "requests", label: <>Solicitudes del vendedor {requests.length > 0 && <span className="fm-shipping-tab-count">{requests.length}</span>}</> }, { id: "tasks", label: "Mis preparaciones y etiquetas" }]} active={tab} onChange={id => { setTab(id); if (selected) open(null); }} /><Link className="fm-button fm-button--primary" to="/gestion/quick-sales">Cargar un envío · Venta Rápida</Link></nav>
    {error && <p role="alert" className="fm-shipping-error">No se pudieron cargar los envíos: {error}</p>}
    {selected ? <ShipmentDetail shipmentId={selected} profile={profile} presentation="page" revision={(rows || []).find(row => row.id === selected)?.revision} onClose={() => open(null)} /> : tab === "tasks" ? <ShippingTasks profile={profile} onDetail={open} /> : <>
    <PageHeader eyebrow={tab === "requests" ? "GESTIÓN DE ENVÍOS / AUTORIZACIÓN" : "MÓDULO 11 · LOGÍSTICA"} title={tab === "requests" ? "Solicitudes del vendedor" : "Gestión de envíos"} description={tab === "requests" ? "Aprobá las solicitudes y elegí el origen real antes de descontar stock." : "Supervisá pedidos pendientes, entregas en curso y el historial. Las alertas críticas llegan a Notificaciones."} />
    {tab === "requests" ? rows === null ? <Skeleton /> : <ShippingRequests rows={requests} profile={profile} onDetail={open} /> : <>
    <div className="fm-shipping-stats"><StatCard label="Pendientes" value={counts.pending} hint="En preparación, listos y por revisar" icon="Package" /><StatCard label="En camino" value={counts.transit} hint="Incluye los tramos por repositorio" icon="Truck" tone="olive" /><StatCard label="Realizados hoy" value={counts.today} hint="Entregas completadas" icon="PackageCheck" tone="olive" /></div>
    <Panel title="Envíos registrados" description="Abrí un pedido para ver su detalle, estado y seguimiento.">
      {tab === "board" && <Tabs tabs={[{ id: "pending", label: "Pendientes" }, { id: "transit", label: "En camino" }, { id: "completed", label: "Realizados" }, { id: "all", label: "Todos" }]} active={bucket} onChange={setBucket} />}
      <div className="fm-shipping-filter-toolbar"><Button variant="secondary" icon="Filter" aria-expanded={filtersOpen} aria-controls="fm-shipping-filters" onClick={() => setFiltersOpen(value => !value)}>Filtrar envíos <span className="fm-shipping-filter-count">{activeFilterCount}</span></Button><p>{periodLabels[filters.preset] || "Período personalizado"} · {visible.length} de {(rows || []).length} envíos</p></div>
      {filtersOpen && <section className="fm-shipping-filter-panel" id="fm-shipping-filters" aria-label="Filtros de envíos"><div className="fm-shipping-filter-panel__intro"><strong>Buscar y filtrar envíos</strong><span>Elegí un período y combiná los filtros que necesites.</span></div>
        <FilterBar search={<SearchInput label="Código, venta, cliente o teléfono" value={filters.search || ""} onChange={event => set("search", event.target.value)} />}>
          <FormField label="Período"><Select aria-label="Período" value={filters.preset || "week"} onChange={event => setPeriod(event.target.value)}><option value="today">Hoy</option><option value="week">Esta semana</option><option value="month">Este mes</option><option value="custom">Elegir fechas</option><option value="all">Todo el historial</option></Select></FormField>
          {filters.preset === "custom" && <><FormField label="Desde"><input type="date" value={filters.from || ""} onChange={event => set("from", event.target.value)} /></FormField><FormField label="Hasta"><input type="date" value={filters.to || ""} onChange={event => set("to", event.target.value)} /></FormField></>}
          <FormField label="Domicilio"><input aria-label="Domicilio" placeholder="Calle, localidad o zona" value={filters.address || ""} onChange={event => set("address", event.target.value)} /></FormField>
          <FormField label="Origen físico"><Select aria-label="Origen físico" value={filters.origin || ""} onChange={event => set("origin", event.target.value)}><option value="">Todos los orígenes</option>{origins.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select></FormField>
          <FormField label="Transporte"><Select aria-label="Transporte" value={filters.transport || ""} onChange={event => set("transport", event.target.value)}><option value="">Todos los transportes</option>{Object.entries(TRANSPORTS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select></FormField>
          <FormField label="Preparador"><Select aria-label="Preparador" value={filters.preparer || ""} onChange={event => set("preparer", event.target.value)}><option value="">Todos los preparadores</option>{people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select></FormField>
          <FormField label="Estado"><Select aria-label="Estado" value={filters.status || ""} onChange={event => set("status", event.target.value)}><option value="">Todos los estados</option>{Object.entries(SHIPPING_STATES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select></FormField>
        </FilterBar>
        <div className="fm-shipping-filter-actions"><Button variant="secondary" onClick={() => { setFilters({ preset: "week", ...presetDates("week") }); setBucket("all"); }}>Restablecer filtros</Button><Button onClick={() => setFiltersOpen(false)}>Ver {visible.length} envíos</Button></div>
      </section>}
      {canManage && <div className="fm-shipping-filter-toolbar"><label className="fm-shipping-select-all"><input className="fm-shipping-select-checkbox" type="checkbox" checked={visible.length > 0 && visible.every(row => selectedIds.includes(row.id))} onChange={event => setSelectedIds(current => event.target.checked ? [...new Set([...current, ...visible.map(row => row.id)])] : current.filter(id => !visible.some(row => row.id === id)))} /> Seleccionar todos los envíos visibles</label><p role="status">{selectedIds.length} seleccionado(s), incluidos los que quedaron fuera del filtro.</p></div>}
      {rows === null && !error ? <Skeleton lines={6} /> : <DataTable columns={columns} rows={visible} onRowClick={row => open(row.id)} empty={<EmptyState icon="Truck" title="No hay envíos para estos filtros" description="Los envíos se generan al confirmar ventas con envío en Venta Rápida o en el Panel Vendedor." />} />}
    </Panel>
    {canManage && <Panel title="Recorrido del repartidor" description="Seleccioná pedidos compatibles para generar un QR temporal. Cada pedido avanza con sus confirmaciones de etapa; no se utiliza GPS.">
      <div className="fm-shipping-route-tools"><FormField label="Tramo"><Select value={routeLeg} onChange={event => { setRouteLeg(event.target.value); setRouteAccess(null); setRouteError(""); routeAttempt.current = null; }}><option value="direct">Entrega directa · cliente</option><option value="origin">Repositorio · origen a repositorio</option><option value="final">Repositorio · repositorio a cliente</option></Select></FormField><Button loading={routeBusy} disabled={!selectedIds.length} onClick={createRoute}>Crear QR de {selectedIds.length} envío(s)</Button></div>
      <p>El recorrido usa los envíos marcados en la columna Seleccionar. Todos deben ser compatibles con el tramo elegido.</p>
      {routeError && <p role="alert" className="fm-shipping-error">{routeError}</p>}
      {routeAccess && <div className="fm-shipping-route-access"><p role="status">QR de recorrido válido hasta {formatDateTime(routeAccess.expiresAt)}. El acceso reúne {routeAccess.shipmentIds?.length || 0} envío(s).</p><input readOnly aria-label="Enlace temporal del recorrido" value={routeAccess.url} /><Button variant="secondary" onClick={() => navigator.clipboard.writeText(routeAccess.url).catch(() => setRouteError("Seleccioná y copiá el enlace manualmente."))}>Copiar enlace</Button><ShippingAccessQr url={routeAccess.url} title="Abrir el recorrido en el teléfono" description="Escaneá una vez para consultar los pedidos asignados y confirmar sus etapas." /></div>}
    </Panel>}
    <Modal open={replaceOpen} onClose={() => { if (!replaceBusy) setReplaceOpen(false); }} title="Reemplazar repartidor" description={`Se actualizarán ${replacementAttempt.current?.ids.length || 0} envío(s) en una sola operación. Los accesos anteriores dejarán de servir para estos pedidos; los demás envíos de sus recorridos se conservan.`}>
      {!replaceAccess ? <><p>Se creará un enlace y QR temporal para entregar al nuevo repartidor. El QR no identifica personalmente a quien lo recibe.</p><FormField label="Tramo" required><Select value={replaceLeg} disabled={replaceBusy} onChange={event => setReplaceLeg(event.target.value)}><option value="direct">Entrega directa al cliente</option><option value="origin">Origen a repositorio</option><option value="final">Repositorio al cliente</option></Select></FormField><FormField label="Motivo del reemplazo" required><textarea maxLength={1000} value={replaceReason} disabled={replaceBusy} onChange={event => setReplaceReason(event.target.value)} /></FormField></> : <><p role="status">Reemplazo guardado para {replaceAccess.shipmentIds.length} envío(s). Acceso válido hasta {formatDateTime(replaceAccess.expiresAt)}.</p><input readOnly aria-label="Enlace del nuevo repartidor" value={replaceAccess.url} /><ShippingAccessQr url={replaceAccess.url} title="QR para el nuevo repartidor" description="Compartí este acceso solo con el repartidor autorizado." /></>}
      {replaceError && <p className="fm-shipping-error" role="alert">{replaceError} Si se interrumpió la conexión, reintentá con el mismo tramo y motivo para recuperar el resultado sin duplicar la operación.</p>}
      <div className="fm-shipping-actions">{!replaceAccess && <Button loading={replaceBusy} disabled={replaceReason.trim().length < 4} onClick={replaceCouriers}>Confirmar {replacementAttempt.current?.ids.length || 0} envío(s)</Button>}<Button variant="secondary" disabled={replaceBusy} onClick={() => setReplaceOpen(false)}>Cerrar</Button></div>
    </Modal>
    <Modal open={Boolean(stateMode)} onClose={() => { if (!stateBusy) setStateMode(""); }} title={stateMode === "ready" ? "Marcar listo para retiro" : "Comenzar preparación"} description={`Se intentará actualizar ${stateAttempt.current?.ids.length || 0} envío(s). Solo se modifican pedidos compatibles asignados a tu usuario; cada uno se valida por separado.`}>
      {stateNotice && <p role="status">{stateNotice}</p>}
      <div className="fm-shipping-actions"><Button loading={stateBusy} disabled={!stateAttempt.current?.ids.length} onClick={applyBulkState}>Confirmar {stateAttempt.current?.ids.length || 0} envío(s)</Button><Button variant="secondary" disabled={stateBusy} onClick={() => setStateMode("")}>Cerrar</Button></div>
    </Modal>
    <Modal open={bulkOpen} onClose={() => { if (!bulkBusy) setBulkOpen(false); }} title="Asignar preparador" description={`Se intentará actualizar ${bulkAttempt.current?.ids.length || 0} envío(s). Cada envío se valida por separado y se conserva su historial.`}>
      <FormField label="Preparador activo" required><Select value={bulkPerson} onChange={event => setBulkPerson(event.target.value)} disabled={bulkBusy}><option value="">Elegí un preparador</option>{bulkPeople.map(person => <option key={person.id} value={person.id}>{person.label || person.name}</option>)}</Select></FormField>
      <FormField label="Motivo del cambio" required><textarea value={bulkReason} maxLength={1000} disabled={bulkBusy} onChange={event => setBulkReason(event.target.value)} /></FormField>
      {bulkNotice && <p role="status">{bulkNotice}</p>}
      <div className="fm-shipping-actions"><Button loading={bulkBusy} disabled={!bulkAttempt.current?.ids.length || !bulkPerson || bulkReason.trim().length < 4} onClick={applyBulkAssign}>Confirmar {bulkAttempt.current?.ids.length || 0} envío(s)</Button><Button variant="secondary" disabled={bulkBusy} onClick={() => setBulkOpen(false)}>Cerrar</Button></div>
    </Modal>
    <p className="fm-shipping-muted">Las incidencias se marcan en rojo dentro del pedido. Las excepciones se consultan en Todos y no cuentan como entregados.</p></>}
    </>}
  </div>;
}
