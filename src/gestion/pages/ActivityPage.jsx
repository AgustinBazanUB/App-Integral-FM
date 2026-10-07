import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, DataTable, EmptyState, PageHeader, Panel, Select, Skeleton } from "../../design-system";
import { addArgentinaDays, argentinaDateFromKey } from "../../modules/locations/domain/time";
import { getActivityPresentation, getActivityTypeGroups } from "../activity/activityPresentation";
import { activityUserOptions, activityValueLabel } from "../activity/activityDetails";
import ActivityDetail from "../components/ActivityDetail";
import { useAuth } from "../AuthContext";
import { Icon } from "../components/icons";
import { formatDateTime, formatMoney } from "../formatters";
import { businessModules } from "../modules";
import { can, canAccessAdministration } from "../permissions";
import { listActivityPage } from "../services/dashboardService";
import { listActivityUsers, loadActivityDetail } from "../services/activityService";
import { listLocationsShared } from "../services/sharedResources";
import { useAsyncData } from "../hooks";
import "../styles/activity.css";

const emptyFilters = { from: "", to: "", locationId: "", userId: "", moduleId: "", action: "" };
const emptyDetail = { status: "idle", data: null, error: null };
export default function ActivityPage() {
  const { profile } = useAuth();
  const locationsResult = useAsyncData(() => listLocationsShared(profile), [profile.id]);
  const usersResult = useAsyncData(() => listActivityUsers(profile), [profile.id]);
  const [filters, setFilters] = useState(emptyFilters);
  const [state, setState] = useState({ status: "loading", items: [], cursor: {}, hasMore: false, error: null });
  const [actors, setActors] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(emptyDetail);
  const sequence = useRef(0), detailSequence = useRef(0), appendBusy = useRef(false);
  const locations = locationsResult.data || [];
  const locationIdsKey = locations.map(location => location.id).join(",");

  const load = useCallback(async ({ append = false } = {}) => {
    if (locationsResult.status !== "ready" || (append && appendBusy.current)) return;
    const request = ++sequence.current;
    appendBusy.current = append;
    setState(current => ({ ...current, ...(!append ? { items: [], cursor: {}, hasMore: false } : {}), status: append ? "loading-more" : "loading", error: null }));
    try {
      if (filters.from && filters.to && filters.from > filters.to) throw new Error("La fecha Desde debe ser anterior o igual a Hasta.");
      const page = await listActivityPage({
        profile,
        locationIds: filters.locationId ? [filters.locationId] : can(profile, "locations", "viewAllLocations") ? undefined : locations.map(location => location.id),
        from: filters.from ? argentinaDateFromKey(filters.from) : null,
        to: filters.to ? addArgentinaDays(argentinaDateFromKey(filters.to), 1) : null,
        filters: { userId: filters.userId, moduleId: filters.moduleId, action: filters.action },
        pageSize: 20, cursor: append ? state.cursor : {},
      });
      if (request !== sequence.current) return;
      setActors(current => activityUserOptions(current, page.items).map(({ id, name }) => ({ id, name })));
      setState(current => ({ status: "ready", items: append ? [...current.items, ...page.items] : page.items, cursor: page.cursor, hasMore: page.hasMore, error: null }));
    } catch (error) {
      if (request === sequence.current) setState(current => ({ ...current, status: "error", error }));
    } finally { if (request === sequence.current) appendBusy.current = false; }
  }, [filters, locationIdsKey, locationsResult.status, profile, state.cursor]);
  useEffect(() => {
    if (locationsResult.status === "ready") load();
    return () => { sequence.current++; appendBusy.current = false; };
    // Cursor updates continue the current page; they must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, locationIdsKey, locationsResult.status, profile.id]);
  useEffect(() => () => { detailSequence.current++; }, []);

  const users = useMemo(() => activityUserOptions([...(actors || []), ...(usersResult.data || [])], [], profile), [actors, usersResult.data, profile]);
  const activityTypeGroups = useMemo(() => getActivityTypeGroups([...state.items, ...(filters.action ? [{ action: filters.action }] : [])]), [state.items, filters.action]);
  const selectedUser = users.find(user => user.id === filters.userId);
  const updateFilter = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  const openDetail = async item => {
    const request = ++detailSequence.current;
    setSelected(item); setDetail({ status: "loading", data: null, error: null });
    try { const data = await loadActivityDetail(item, profile); if (request === detailSequence.current) setDetail({ status: "ready", data, error: null }); }
    catch (error) { if (request === detailSequence.current) setDetail({ status: "error", data: null, error }); }
  };
  const closeDetail = () => { detailSequence.current++; setSelected(null); setDetail(emptyDetail); };

  return <div className="fm-page-enter fm-activity-page">
    <PageHeader eyebrow="Actividad operativa" title="Toda la actividad" description="Un registro cronológico de ventas, stock y cambios del sistema, desde el más reciente." />
    <Panel title="Filtros" description="Elegí un usuario, un período o el tipo de cambio que querés revisar.">
      <div className="fm-activity-filters">
        <label className={filters.from ? "is-applied" : ""}><span>Desde</span><input aria-label="Desde" type="date" value={filters.from} onChange={event => updateFilter("from", event.target.value)} /></label>
        <label className={filters.to ? "is-applied" : ""}><span>Hasta</span><input aria-label="Hasta" type="date" value={filters.to} onChange={event => updateFilter("to", event.target.value)} /></label>
        <label className={filters.locationId ? "is-applied" : ""}><span>Ubicación</span><Select aria-label="Filtrar por ubicación" value={filters.locationId} onChange={event => updateFilter("locationId", event.target.value)}><option value="">Todas las ubicaciones</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</Select></label>
        <label className={filters.moduleId ? "is-applied" : ""}><span>Módulo</span><Select aria-label="Filtrar por módulo" value={filters.moduleId} onChange={event => updateFilter("moduleId", event.target.value)}><option value="">Todos los módulos</option>{businessModules.map(module => <option key={module.id} value={module.id}>{module.label}</option>)}</Select></label>
        <label className={filters.userId ? "is-applied" : ""}><span>Usuario</span><Select aria-label="Filtrar por usuario" value={filters.userId} onChange={event => updateFilter("userId", event.target.value)}><option value="">Todos los usuarios</option>{users.map(user => <option key={user.id} value={user.id}>{user.label}</option>)}</Select></label>
        <label className={filters.action ? "is-applied" : ""}><span>Tipo de actividad</span><Select aria-label="Filtrar por tipo de actividad" value={filters.action} onChange={event => updateFilter("action", event.target.value)}><option value="">Todos los tipos</option>{activityTypeGroups.map(group => <optgroup key={group.label} label={group.label}>{group.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</optgroup>)}</Select></label>
      </div>
      <div className="fm-activity-filter-actions"><span>{Object.values(filters).some(Boolean) ? "Filtros aplicados" : "Mostrando toda la actividad autorizada"}</span><Button variant="secondary" icon="RotateCcw" onClick={() => setFilters(emptyFilters)}>Limpiar filtros</Button></div>
      {usersResult.status === "loading" && canAccessAdministration(profile) ? <p role="status">Cargando usuarios…</p> : null}
      {usersResult.status === "error" ? <p className="fm-activity-detail__error" role="alert">No pude cargar todos los usuarios. <button type="button" onClick={() => usersResult.refresh().catch(() => {})}>Reintentar usuarios</button></p> : null}
    </Panel>
    <Panel title="Registro cronológico" description="Tocá una actividad para ver su desglose. Se muestran hasta 20 registros por página.">
      {state.status === "loading" || locationsResult.status === "loading" ? <div role="status" aria-label="Cargando actividades"><Skeleton lines={7} /></div> : null}
      {locationsResult.status === "error" ? <EmptyState icon="AlertTriangle" title="No pude cargar las ubicaciones" description={locationsResult.error?.message} action={<Button variant="secondary" onClick={() => locationsResult.refresh().catch(() => {})}>Reintentar ubicaciones</Button>} /> : null}
      {state.status === "error" ? <EmptyState icon="AlertTriangle" title="No pude consultar la actividad" description={state.error?.message || "Revisá tu conexión y permisos."} action={<Button variant="secondary" onClick={() => load()}>Reintentar</Button>} /> : null}
      {state.items.length ? <DataTable rows={state.items} onRowClick={openDetail} columns={[
        { key: "action", label: "Actividad", render: item => { const presentation = getActivityPresentation(item); return <button type="button" className="fm-activity-open" aria-haspopup="dialog" aria-label={`Ver detalle: ${presentation.label} · ${item.description}`} onClick={event => { event.stopPropagation(); openDetail(item); }}><span className={`fm-activity-list__icon is-${presentation.tone}`}><Icon name={presentation.icon} /></span><span><strong>{presentation.label}</strong><small>{item.description}</small><span className="fm-activity-open__hint">Ver detalle <Icon name="ChevronRight" /></span></span></button>; } },
        { key: "moduleId", label: "Módulo", render: item => businessModules.find(module => module.id === item.moduleId)?.shortLabel || "Sistema" },
        { key: "locationName", label: "Ubicación", render: item => item.locationName || "General" },
        { key: "userName", label: "Usuario" },
        { key: "amount", label: "Importe", render: item => item.amount != null ? formatMoney(item.amount) : "—" },
        { key: "status", label: "Estado", render: item => <Badge tone={item.status === "cancelled" ? "error" : "gold"}>{activityValueLabel(item.status)}</Badge> },
        { key: "createdAt", label: "Fecha y hora", render: item => formatDateTime(item.createdAt) },
      ]} /> : null}
      {state.status === "ready" && !state.items.length ? <EmptyState icon="Activity" title={state.hasMore ? "Todavía no encontré coincidencias" : selectedUser ? `Sin actividad de ${selectedUser.name || selectedUser.label}` : "No hay registros cronológicos para estos filtros"} description={state.hasMore ? "Hay registros anteriores por revisar. Continuá la búsqueda para comprobar todo el período." : "No se registraron actividades con esta selección. Podés ampliar las fechas o limpiar los filtros."} /> : null}
      {state.hasMore ? <div className="fm-load-more"><Button variant="secondary" loading={state.status === "loading-more"} onClick={() => load({ append: true })}>{state.items.length ? "Cargar más actividad" : "Buscar registros anteriores"}</Button></div> : null}
    </Panel>
    <ActivityDetail selected={selected} state={detail} onClose={closeDetail} onRetry={() => selected && openDetail(selected)} />
  </div>;
}
