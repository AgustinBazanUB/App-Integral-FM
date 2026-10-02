import { useEffect, useMemo, useState } from "react";
import {
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
import DashboardFilters from "../components/DashboardFilters";
import DashboardPayments from "../components/DashboardPayments";
import DashboardAlerts, { DashboardAlertsBell } from "../components/DashboardAlerts";
import { dashboardGreeting, summarizeDashboardPayments } from "../dashboardPresentation";
import { Icon } from "../components/icons";
import { formatMoney } from "../formatters";
import { useAsyncData } from "../hooks";
import { getManagementPath } from "../modules";
import { canAccessAdministration, can, visibleBusinessModules } from "../permissions";
import {
  invalidateDashboardSales,
  listSalesByRange,
} from "../services/dashboardService";
import { invalidateSharedLocations, listLocationsShared } from "../services/sharedResources";
import { listActiveAlerts } from "../services/alertsService";

const SESSION_FORMAT_KEY = "fm-dashboard-period-format";
const VALID_FORMATS = new Set(["year", "month", "week", "day"]);

function SalesBars({ data }) {
  const max = Math.max(...data.map((item) => item.value), 1);
  const labelStep = Math.max(1, Math.ceil(data.length / 8));
  return (
    <div className={`fm-bars ${data.length > 16 ? "fm-bars--dense" : ""}`}>
      {data.map((item, index) => (
        <div key={item.key} className="fm-bars__item">
          <span
            className="fm-bars__bar"
            style={{ height: `${item.value ? Math.max(7, (item.value / max) * 100) : 3}%` }}
            title={`${item.label}: ${formatMoney(item.value)} · ${item.sales} ventas`}
          />
          <span aria-hidden="true" style={{ visibility: index % labelStep === 0 || index === data.length - 1 ? "visible" : "hidden" }}>{item.label}</span>
          <span className="sr-only">{item.label}: {formatMoney(item.value)} · {item.sales} ventas</span>
        </div>
      ))}
    </div>
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
    try {
      const saved = window.sessionStorage.getItem(SESSION_FORMAT_KEY);
      return VALID_FORMATS.has(saved) ? saved : "month";
    } catch { return "month"; }
  });
  const [referenceKey, setReferenceKey] = useState(() => argentinaDateKey());
  const [selectedLocationIds, setSelectedLocationIds] = useState(null);
  const [stockPickerOpen, setStockPickerOpen] = useState(false);

  useEffect(() => {
    try { window.sessionStorage.setItem(SESSION_FORMAT_KEY, format); } catch { /* Preferencia opcional. */ }
  }, [format]);

  const locationsResult = useAsyncData(() => listLocationsShared(profile), [profile]);
  const alertsResult = useAsyncData(() => listActiveAlerts(profile), [profile]);
  const locations = useMemo(() => locationsResult.data || [], [locationsResult.data]);
  const activeLocations = useMemo(
    () => locations.filter((location) => locationActivity(location).active),
    [locations],
  );
  const allowedLocationIds = useMemo(() => locations.map((location) => location.id), [locations]);

  useEffect(() => {
    if (selectedLocationIds == null) return;
    const allowed = new Set(allowedLocationIds);
    setSelectedLocationIds((current) => {
      const cleaned = (current || []).filter((id) => allowed.has(id));
      return cleaned.length === (current || []).length ? current : cleaned;
    });
  }, [allowedLocationIds, selectedLocationIds]);

  const effectiveLocationIds = useMemo(() => {
    if (selectedLocationIds == null) return allowedLocationIds;
    const allowed = new Set(allowedLocationIds);
    return selectedLocationIds.filter((id) => allowed.has(id));
  }, [allowedLocationIds, selectedLocationIds]);
  const selectedLocationIdsKey = effectiveLocationIds.slice().sort().join(",");
  const range = useMemo(() => argentinaPeriodRange(format, referenceKey), [format, referenceKey]);
  const periodLabel = useMemo(() => argentinaPeriodLabel(format, referenceKey), [format, referenceKey]);

  const allStockOrigins = canAccessAdministration(profile) && selectedLocationIds == null;
  const salesQueryKey = `${profile.id}|${allStockOrigins ? "all-origins" : selectedLocationIdsKey}|${range.start.toISOString()}|${range.end.toISOString()}`;
  const salesResult = useAsyncData(async () => {
    const sales = locationsResult.data && (allStockOrigins || effectiveLocationIds.length) ? await listSalesByRange({
      profile,
      locationIds: allStockOrigins ? undefined : effectiveLocationIds,
      start: range.start,
      end: range.end,
    }) : [];
    return { queryKey: salesQueryKey, sales };
  }, [profile, locationsResult.data, selectedLocationIdsKey, range, salesQueryKey, allStockOrigins]);

  const modules = visibleBusinessModules(profile);
  const periodSales = useMemo(() => salesResult.data?.queryKey === salesQueryKey ? salesResult.data.sales : [], [salesResult.data, salesQueryKey]);
  const summary = useMemo(() => summarizeSales(periodSales), [periodSales]);
  const chart = useMemo(() => buildPeriodSalesSeries(periodSales, range, format), [periodSales, range, format]);
  const payments = useMemo(() => summarizeDashboardPayments(periodSales), [periodSales]);
  const metricsReady = locationsResult.status === "ready" && salesResult.status === "ready" && salesResult.data?.queryKey === salesQueryKey;
  const metricsLoading = locationsResult.status === "loading" || salesResult.status === "loading" || (salesResult.status === "ready" && !metricsReady && locationsResult.status !== "error");
  const hasError = locationsResult.status === "error" || salesResult.status === "error";

  const retryMetrics = () => {
    invalidateDashboardSales();
    invalidateSharedLocations();
    void Promise.allSettled([locationsResult.refresh(), salesResult.refresh()]);
  };

  const handleFormatChange = (nextFormat) => {
    if (!VALID_FORMATS.has(nextFormat)) return;
    setFormat(nextFormat);
  };

  const openStockLocation = (locationId) => {
    if (!activeLocations.some((location) => location.id === locationId && locationActivity(location).active)) return;
    setStockPickerOpen(false);
    navigate(`/gestion/locations/${encodeURIComponent(locationId)}/stock`);
  };

  const canQuickSale = modules.some((module) => module.id === "quick-sales");
  const canLoadStock = can(profile, "locations", "loadStock") || can(profile, "locations", "adjustStock");

  return (
    <div className="fm-page-enter fm-dashboard-page">
      {allStockOrigins ? <p className="fm-safe-note">Resumen de todos los canales, incluidas ventas con salida de depósitos.</p> : null}
      <HeroBanner
        eyebrow="Panel general"
        title={dashboardGreeting(profile.name)}
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
        <DashboardAlertsBell profile={profile} allowedLocationIds={allowedLocationIds} result={alertsResult} />
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
            action={<Button variant="secondary" onClick={retryMetrics}>Reintentar</Button>}
          />
        </Panel>
      ) : null}

      {metricsLoading ? <DashboardMetricsSkeleton /> : null}

      {metricsReady ? (
        <>
          <section className="fm-stat-grid" aria-label={`Resumen de ${periodLabel}`} aria-live="polite">
            <StatCard label="Ventas" value={summary.count} hint={summary.count ? periodLabel : "Sin ventas activas"} icon="ReceiptText" />
            <StatCard label="Facturación" value={formatMoney(summary.total)} hint="Total vendido, con descuentos" icon="CircleDollarSign" tone="olive" />
            <StatCard label="Ticket promedio" value={formatMoney(summary.average)} hint={summary.count ? `${summary.count} ventas activas` : "Sin ventas en este período"} icon="ChartNoAxesCombined" tone="wood" />
            <StatCard label="Ubicaciones incluidas" value={effectiveLocationIds.length} hint={`${allowedLocationIds.length} permitidas para tu usuario`} icon="MapPin" tone="gold" />
          </section>
        </>
      ) : null}

      {metricsReady ? (
        <>
          <section className="fm-two-column-grid">
            <Panel
              title="Ritmo de ventas"
              description={`Facturación del período seleccionado: ${periodLabel}.`}
              action={can(profile, "metrics", "view") ? <Link className="fm-button fm-button--secondary" to="/gestion/metrics/sales"><Icon name="Maximize2" /><span>Ver todas las métricas</span></Link> : null}
            >
              {!summary.count ? <EmptyState icon="ChartNoAxesCombined" title="Sin ventas en este período" description="Elegí otro período o revisá las ubicaciones incluidas." /> : <ChartContainer
                title={`Ritmo de ventas de ${periodLabel}`}
                summary={`${summary.count} ventas activas y ${formatMoney(summary.total)} vendidos. Los intervalos sin ventas tienen valor cero.`}
              >
                <SalesBars data={chart} />
              </ChartContainer>}
            </Panel>
            <Panel title="Formas de pago" description={`Participación sobre el total vendido de ${periodLabel}, con los mismos filtros del resumen.`}>
              <DashboardPayments breakdown={payments} />
            </Panel>
          </section>

          {!effectiveLocationIds.length ? (
            <Panel><EmptyState icon="MapPin" title="No hay ubicaciones seleccionadas" description="Abrí el filtro de Ubicaciones y elegí al menos una para actualizar las métricas." /></Panel>
          ) : null}
        </>
      ) : null}

      <DashboardAlerts profile={profile} allowedLocationIds={allowedLocationIds} result={alertsResult} />

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

      <Modal
        open={stockPickerOpen}
        onClose={() => setStockPickerOpen(false)}
        title="Cargar Stock"
        description="¿En qué ubicación querés cargar el stock?"
      >
        <div className="fm-dashboard-location-picker">
          {locationsResult.status === "loading" ? <Skeleton lines={3} /> : null}
          {locationsResult.status === "error" ? <EmptyState icon="WifiOff" title="No pudimos consultar las ubicaciones" action={<Button onClick={retryMetrics}>Reintentar</Button>} /> : null}
          {locationsResult.status === "ready" ? activeLocations.map((location) => (
            <button key={location.id} type="button" onClick={() => openStockLocation(location.id)}>
              <Icon name="MapPin" />
              <span><strong>{location.name}</strong><small>{location.type || "Ubicación activa"}</small></span>
              <Icon name="ChevronRight" />
            </button>
          )) : null}
          {locationsResult.status === "ready" && !activeLocations.length ? (
            <EmptyState icon="MapPin" title="No hay ubicaciones activas" description="Activá una ubicación antes de cargar stock." />
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
