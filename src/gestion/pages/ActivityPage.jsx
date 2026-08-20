
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  Panel,
  Select,
  Skeleton,
} from "../../design-system";
import { addArgentinaDays, argentinaDateFromKey } from "../../modules/locations/domain/time";
import { getActivityPresentation, getActivityTypeGroups } from "../activity/activityPresentation";
import { useAuth } from "../AuthContext";
import { Icon } from "../components/icons";
import { formatDateTime, formatMoney } from "../formatters";
import { businessModules } from "../modules";
import { can } from "../permissions";
import { listActivityPage } from "../services/dashboardService";
import { listLocationsShared } from "../services/sharedResources";
import { useAsyncData } from "../hooks";

const emptyFilters = { from: "", to: "", locationId: "", userId: "", moduleId: "", action: "" };

export default function ActivityPage() {
  const { profile } = useAuth();
  const locationsResult = useAsyncData(() => listLocationsShared(profile), [profile.id]);
  const [filters, setFilters] = useState(emptyFilters);
  const [state, setState] = useState({ status: "loading", items: [], cursor: {}, hasMore: false, error: null });
  const locations = locationsResult.data || [];
  const locationIdsKey = locations.map((location) => location.id).join(",");

  const load = useCallback(async ({ append = false } = {}) => {
    if (locationsResult.status !== "ready") return;
    setState((current) => ({ ...current, status: append ? "loading-more" : "loading", error: null }));
    try {
      const from = filters.from ? argentinaDateFromKey(filters.from) : null;
      const to = filters.to ? addArgentinaDays(argentinaDateFromKey(filters.to), 1) : null;
      const page = await listActivityPage({
        profile,
        locationIds: filters.locationId ? [filters.locationId] : can(profile, "locations", "viewAllLocations") ? undefined : locations.map((location) => location.id),
        from,
        to,
        filters: { userId: filters.userId, moduleId: filters.moduleId, action: filters.action },
        pageSize: 20,
        cursor: append ? state.cursor : {},
      });
      setState((current) => ({
        status: "ready",
        items: append ? [...current.items, ...page.items] : page.items,
        cursor: page.cursor,
        hasMore: page.hasMore,
        error: null,
      }));
    } catch (error) {
      setState((current) => ({ ...current, status: "error", error }));
    }
  }, [filters, locationIdsKey, locationsResult.status, profile, state.cursor]);

  useEffect(() => {
    if (locationsResult.status === "ready") load();
    // El cursor no debe reiniciar la primera página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, locationIdsKey, locationsResult.status, profile.id]);

  const users = useMemo(() => {
    const map = new Map();
    state.items.forEach((item) => {
      if (item.userId) map.set(item.userId, item.userName || "Usuario");
    });
    return [...map].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [state.items]);
  const activityTypeGroups = useMemo(() => getActivityTypeGroups(state.items), [state.items]);
  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

  return (
    <div className="fm-page-enter">
      <PageHeader eyebrow="Actividad operativa" title="Toda la actividad" description="Ventas, movimientos de stock y acciones administrativas, ordenadas desde la más reciente." />
      <Panel title="Filtros" description="Las consultas se realizan por páginas y solamente sobre ubicaciones autorizadas.">
        <FilterBar actions={Object.values(filters).some(Boolean) ? <Button variant="ghost" icon="RotateCcw" onClick={() => setFilters(emptyFilters)}>Limpiar filtros</Button> : null}>
          <label className="fm-compact-field"><span>Desde</span><input type="date" value={filters.from} onChange={(event) => updateFilter("from", event.target.value)} /></label>
          <label className="fm-compact-field"><span>Hasta</span><input type="date" value={filters.to} onChange={(event) => updateFilter("to", event.target.value)} /></label>
          <Select aria-label="Filtrar por ubicación" value={filters.locationId} onChange={(event) => updateFilter("locationId", event.target.value)}><option value="">Todas las ubicaciones</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</Select>
          <Select aria-label="Filtrar por módulo" value={filters.moduleId} onChange={(event) => updateFilter("moduleId", event.target.value)}><option value="">Todos los módulos</option>{businessModules.map((module) => <option key={module.id} value={module.id}>{module.label}</option>)}</Select>
          <Select aria-label="Filtrar por usuario" value={filters.userId} onChange={(event) => updateFilter("userId", event.target.value)}><option value="">Todos los usuarios</option>{users.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select>
          <Select aria-label="Filtrar por tipo de actividad" value={filters.action} onChange={(event) => updateFilter("action", event.target.value)}><option value="">Todos los tipos</option>{activityTypeGroups.map((group) => <optgroup key={group.label} label={group.label}>{group.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</optgroup>)}</Select>
        </FilterBar>
      </Panel>

      <Panel title="Registro cronológico" description="Se cargan hasta 20 actividades por vez.">
        {(state.status === "loading" || locationsResult.status === "loading") ? <Skeleton lines={7} /> : null}
        {state.status === "error" ? <EmptyState icon="AlertTriangle" title="No se pudo consultar la actividad" description={state.error?.message || "Revisá la conexión y los permisos."} action={<Button variant="secondary" onClick={() => load()}>Reintentar</Button>} /> : null}
        {state.items.length ? <DataTable rows={state.items} columns={[
          { key: "action", label: "Actividad", render: (item) => { const presentation = getActivityPresentation(item); return <div className="fm-activity-cell"><span className={`fm-activity-list__icon is-${presentation.tone}`}><Icon name={presentation.icon} /></span><span><strong>{presentation.label}</strong><small>{item.description}</small></span></div>; } },
          { key: "moduleId", label: "Módulo", render: (item) => businessModules.find((module) => module.id === item.moduleId)?.shortLabel || "Sistema" },
          { key: "locationName", label: "Ubicación", render: (item) => item.locationName || "General" },
          { key: "userName", label: "Usuario" },
          { key: "status", label: "Estado", render: (item) => <Badge tone={item.status === "cancelled" ? "error" : "success"}>{item.amount != null ? formatMoney(item.amount) : "Registrada"}</Badge> },
          { key: "createdAt", label: "Fecha y hora", render: (item) => formatDateTime(item.createdAt) },
        ]} /> : null}
        {state.status === "ready" && !state.items.length ? <EmptyState icon="Activity" title="No hay actividad para estos filtros" description="Probá ampliar las fechas o quitar algún filtro." /> : null}
        {state.items.length && state.hasMore ? <div className="fm-load-more"><Button variant="secondary" loading={state.status === "loading-more"} onClick={() => load({ append: true })}>Cargar más actividad</Button></div> : null}
      </Panel>
    </div>
  );
}
