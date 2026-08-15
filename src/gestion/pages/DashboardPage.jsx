import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  ChartContainer,
  EmptyState,
  HeroBanner,
  Modal,
  Panel,
  Skeleton,
  StatCard,
} from "../../design-system";
import {
  buildPeriodSalesSeries,
  summarizeSales,
} from "../../modules/locations/domain/dashboard";
import { locationActivity } from "../../modules/locations/domain/locations";
import {
  argentinaDateKey,
  argentinaPeriodLabel,
  argentinaPeriodRange,
} from "../../modules/locations/domain/time";
import { Link, useNavigate } from "../../router";
import { useAuth } from "../AuthContext";
import { getActivityPresentation, getActivityTypeGroups } from "../activity/activityPresentation";
import DashboardFilters from "../components/DashboardFilters";
import { Icon } from "../components/icons";
import { formatDateTime, formatMoney } from "../formatters";
import { useAsyncData } from "../hooks";
import { getManagementPath } from "../modules";
import { can, visibleBusinessModules } from "../permissions";
import {
  listActivityPage,
  listSalesByRange,
} from "../services/dashboardService";
import { listLocationsShared } from "../services/sharedResources";

const SESSION_FORMAT_KEY = "fm-dashboard-period-format";
const VALID_FORMATS = new Set(["year", "month", "week", "day"]);

function SalesBars({ data }) {
  const max = Math.max(...data.map((item) => item.value), 1);
  return (
    <div className={`fm-bars ${data.length > 16 ? "fm-bars--dense" : ""}`}>
      {data.map((item) => (
        <div key={item.key} className="fm-bars__item">
          <span
            className="fm-bars__bar"
            style={{ height: `${item.value ? Math.max(7, (item.value / max) * 100) : 3}%` }}
            title={`${item.label}: ${formatMoney(item.value)} · ${item.sales} ventas`}
          />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function ActivityList({ activities }) {
  return (
    <ul className="fm-activity-list">
      {activities.map((activity) => {
        const presentation = getActivityPresentation(activity);
        return (
          <li key={activity.id}>
            <div className={`fm-activity-list__icon is-${presentation.tone}`}><Icon name={presentation.icon} /></div>
            <div>
              <strong>{presentation.label}</strong>
              <span>{activity.description || activity.locationName || "Sistema"} · {formatDateTime(activity.createdAt)}</span>
              <small>{activity.userName || "Sistema"}{activity.locationName ? ` · ${activity.locationName}` : ""}</small>
            </div>
            <Badge tone={activity.status === "cancelled" ? "error" : "success"}>
              {activity.amount != null ? formatMoney(activity.amount) : "Registrada"}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

function DashboardMetricsSkeleton() {
  return (
    <div className="fm-dashboard-metrics-loading" role="status" aria-live="polite">
      <span className="sr-only">Actualizando métricas del panel</span>
      <section className="fm-stat-grid" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} lines={3} />)}
      </section>
      <section className="fm-two-column-grid" aria-hidden="true">
        <Panel><Skeleton lines={6} /></Panel>
        <Panel><Skeleton lines={6} /></Panel>
      </section>
    </div>
  );
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [format, setFormat] = useState(() => {
    const saved = window.sessionStorage.getItem(SESSION_FORMAT_KEY);
    return VALID_FORMATS.has(saved) ? saved : "month";
  });
  const [referenceKey, setReferenceKey] = useState(() => argentinaDateKey());
  const [selectedLocationIds, setSelectedLocationIds] = useState(null);
  const [stockPickerOpen, setStockPickerOpen] = useState(false);
  const [activityType, setActivityType] = useState("");

  useEffect(() => {
    window.sessionStorage.setItem(SESSION_FORMAT_KEY, format);
  }, [format]);

  const locationsResult = useAsyncData(() => listLocationsShared(profile), [profile.id]);
  const locations = locationsResult.data || [];
  const activeLocations = useMemo(
    () => locations.filter((location) => locationActivity(location).active),
    [locations],
  );
  const allowedLocationIds = useMemo(() => locations.map((location) => location.id), [locations]);
  const allowedLocationIdsKey = allowedLocationIds.slice().sort().join(",");

  useEffect(() => {
    if (selectedLocationIds == null) return;
    const allowed = new Set(allowedLocationIds);
    setSelectedLocationIds((current) => {
      const cleaned = (current || []).filter((id) => allowed.has(id));
      return cleaned.length === (current || []).length ? current : cleaned;
    });
  }, [allowedLocationIdsKey]);

  const effectiveLocationIds = useMemo(() => {
    if (selectedLocationIds == null) return allowedLocationIds;
    const allowed = new Set(allowedLocationIds);
    return selectedLocationIds.filter((id) => allowed.has(id));
  }, [allowedLocationIdsKey, selectedLocationIds]);
  const selectedLocationIdsKey = effectiveLocationIds.slice().sort().join(",");
  const range = useMemo(() => argentinaPeriodRange(format, referenceKey), [format, referenceKey]);
  const periodLabel = useMemo(() => argentinaPeriodLabel(format, referenceKey), [format, referenceKey]);

  const salesResult = useAsyncData(async () => {
    if (!locationsResult.data || !effectiveLocationIds.length) return [];
    return listSalesByRange({
      profile,
      locationIds: effectiveLocationIds,
      start: range.start,
      end: range.end,
    });
  }, [profile.id, allowedLocationIdsKey, selectedLocationIdsKey, format, referenceKey]);

  const activityResult = useAsyncData(async () => {
    if (!locationsResult.data || !effectiveLocationIds.length) return [];
    const page = await listActivityPage({
      profile,
      locationIds: effectiveLocationIds,
      from: range.start,
      to: range.end,
      filters: { action: activityType },
      pageSize: 6,
    });
    return page.items;
  }, [profile.id, allowedLocationIdsKey, selectedLocationIdsKey, format, referenceKey, activityType]);

  const activityTypeGroups = useMemo(() => getActivityTypeGroups(activityResult.data || []), [activityResult.data]);
  const modules = visibleBusinessModules(profile);
  const summary = useMemo(() => summarizeSales(salesResult.data || []), [salesResult.data]);
  const chart = useMemo(() => buildPeriodSalesSeries(salesResult.data || [], range, format), [salesResult.data, range, format]);
  const metricsLoading = locationsResult.status === "loading" || salesResult.status === "loading";
  const hasError = locationsResult.status === "error" || salesResult.status === "error" || activityResult.status === "error";

  const handleFormatChange = (nextFormat) => {
    if (!VALID_FORMATS.has(nextFormat)) return;
    setFormat(nextFormat);
  };

  const openStockLocation = (locationId) => {
    setStockPickerOpen(false);
    navigate(`/gestion/locations/${encodeURIComponent(locationId)}/stock`);
  };

  const canQuickSale = modules.some((module) => module.id === "quick-sales");
  const canLoadStock = can(profile, "locations", "loadStock") || can(profile, "locations", "adjustStock");

  return (
    <div className="fm-page-enter">
      <HeroBanner
        eyebrow="Panel general"
        title={`Buen día, ${profile.name?.split(" ")[0] || "equipo"}.`}
        description="Resumen del negocio para las ubicaciones que podés consultar. Los períodos respetan la hora operativa de Argentina."
        action={(canQuickSale || canLoadStock) ? (
          <div className="fm-dashboard-hero-actions">
            {canQuickSale ? (
              <Link className="fm-button fm-button--primary" to="/gestion/quick-sales">
                <Icon name="Zap" />
                <span>Venta Rápida</span>
              </Link>
            ) : null}
            {canLoadStock ? (
              <button type="button" className="fm-button fm-button--secondary" onClick={() => setStockPickerOpen(true)}>
                <Icon name="PackagePlus" />
                <span>Cargar Stock</span>
              </button>
            ) : null}
          </div>
        ) : null}
      >
        <div className="fm-hero-banner__quote">
          <span>Flor Mía</span>
          <strong>gestión con raíces</strong>
        </div>
      </HeroBanner>

      <Panel className="fm-period-panel fm-dashboard-filter-panel">
        <DashboardFilters
          format={format}
          referenceKey={referenceKey}
          locations={locations}
          selectedLocationIds={selectedLocationIds}
          onFormatChange={handleFormatChange}
          onReferenceChange={setReferenceKey}
          onLocationsChange={setSelectedLocationIds}
          busy={metricsLoading}
        />
      </Panel>

      {hasError ? (
        <Panel>
          <EmptyState
            icon="WifiOff"
            title="No pudimos actualizar todo el panel"
            description="La sesión sigue activa. Reintentá las consultas cuando tengas conexión o revisá tus permisos."
            action={<Button variant="secondary" onClick={() => { locationsResult.refresh(); salesResult.refresh(); activityResult.refresh(); }}>Reintentar</Button>}
          />
        </Panel>
      ) : null}

      {metricsLoading ? <DashboardMetricsSkeleton /> : null}

      {locationsResult.status === "ready" && salesResult.status === "ready" ? (
        <>
          <section className="fm-stat-grid" aria-label={`Resumen de ${periodLabel}`} aria-live="polite">
            <StatCard label="Ventas" value={summary.count} hint={summary.count ? periodLabel : "Sin ventas activas"} icon="ReceiptText" />
            <StatCard label="Facturación" value={formatMoney(summary.total)} hint="Total vendido, con descuentos" icon="CircleDollarSign" tone="olive" />
            <StatCard label="Ticket promedio" value={formatMoney(summary.average)} hint={summary.count ? `${summary.count} ventas activas` : "Sin división por cero"} icon="ChartNoAxesCombined" tone="wood" />
            <StatCard label="Ubicaciones incluidas" value={effectiveLocationIds.length} hint={`${allowedLocationIds.length} permitidas para tu usuario`} icon="MapPin" tone="gold" />
          </section>

          <section className="fm-two-column-grid">
            <Panel
              title="Ritmo de ventas"
              description={`Facturación del período seleccionado: ${periodLabel}.`}
              action={can(profile, "metrics", "view") ? <Link className="fm-button fm-button--secondary" to="/gestion/metrics/sales"><Icon name="Maximize2" /><span>Ver todas las métricas</span></Link> : null}
            >
              <ChartContainer
                title={`Ritmo de ventas de ${periodLabel}`}
                summary={`${summary.count} ventas activas y ${formatMoney(summary.total)} vendidos. Los intervalos sin ventas tienen valor cero.`}
              >
                <SalesBars data={chart} />
              </ChartContainer>
            </Panel>
            <Panel
              title="Actividad del período"
              description="Operaciones dentro del período y las ubicaciones seleccionadas."
              action={<div className="fm-dashboard-activity-actions">
                <label><span className="sr-only">Tipo de actividad</span><select value={activityType} onChange={(event) => setActivityType(event.target.value)} aria-label="Filtrar actividad del período por tipo"><option value="">Todas</option>{activityTypeGroups.map((group) => <optgroup key={group.label} label={group.label}>{group.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</optgroup>)}</select></label>
                <Link className="fm-button fm-button--secondary" to="/gestion/actividad"><Icon name="Activity" /><span>Ver toda la actividad</span></Link>
              </div>}
            >
              {activityResult.status === "loading" ? <Skeleton lines={5} /> : null}
              {activityResult.data?.length ? <ActivityList activities={activityResult.data} /> : null}
              {activityResult.status === "ready" && !activityResult.data?.length ? <EmptyState icon="Activity" title="Sin actividad en este período" description="Cambiá el período o las ubicaciones para consultar otras operaciones." /> : null}
            </Panel>
          </section>

          {!effectiveLocationIds.length ? (
            <Panel><EmptyState icon="MapPin" title="No hay ubicaciones seleccionadas" description="Abrí el filtro de Ubicaciones y elegí al menos una para actualizar las métricas." /></Panel>
          ) : null}

          <Panel title="Tus módulos" description="El menú y estos accesos se generan desde los permisos de tu perfil.">
            <div className="fm-module-grid">
              {modules.map((module) => (
                <Link key={module.id} to={getManagementPath(module.id)} className={`fm-module-card fm-module-card--${module.accent}`}>
                  <span className="fm-module-card__icon"><Icon name={module.icon} /></span>
                  <div><strong>{module.shortLabel}</strong><p>{module.description}</p></div>
                </Link>
              ))}
            </div>
          </Panel>
        </>
      ) : null}

      <Modal
        open={stockPickerOpen}
        onClose={() => setStockPickerOpen(false)}
        title="Cargar Stock"
        description="¿En qué ubicación querés cargar el stock?"
      >
        <div className="fm-dashboard-location-picker">
          {activeLocations.map((location) => (
            <button key={location.id} type="button" onClick={() => openStockLocation(location.id)}>
              <Icon name="MapPin" />
              <span><strong>{location.name}</strong><small>{location.type || "Ubicación activa"}</small></span>
              <Icon name="ChevronRight" />
            </button>
          ))}
          {!activeLocations.length ? (
            <EmptyState icon="MapPin" title="No hay ubicaciones activas" description="Activá una ubicación antes de cargar stock." />
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
