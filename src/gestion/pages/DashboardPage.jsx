import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  ChartContainer,
  EmptyState,
  HeroBanner,
  IconButton,
  Panel,
  Select,
  Skeleton,
  StatCard,
} from "../../design-system";
import {
  buildSevenDaySalesSeries,
  summarizeSales,
} from "../../modules/locations/domain/dashboard";
import {
  argentinaMonthKey,
  argentinaMonthLabel,
  argentinaMonthRange,
  lastSevenArgentinaDays,
  shiftMonthKey,
} from "../../modules/locations/domain/time";
import { Link } from "../../router";
import { useAuth } from "../AuthContext";
import { Icon } from "../components/icons";
import { formatDateTime, formatMoney } from "../formatters";
import { useAsyncData } from "../hooks";
import { getManagementPath } from "../modules";
import { can, visibleBusinessModules } from "../permissions";
import {
  listActivityPage,
  listSalesByRange,
} from "../services/dashboardService";
import { listLocations } from "../services/managementService";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function SalesBars({ data }) {
  const max = Math.max(...data.map((item) => item.value), 1);
  return (
    <div className="fm-bars">
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

function MonthSelector({ value, onChange, busy }) {
  const current = argentinaMonthKey();
  const [selectedYear, selectedMonth] = value.split("-").map(Number);
  const currentYear = Number(current.slice(0, 4));
  const oldestYear = Math.min(currentYear - 7, selectedYear);
  const years = Array.from({ length: currentYear - oldestYear + 1 }, (_, index) => currentYear - index);
  const choose = (year, month) => {
    const candidate = `${year}-${String(month).padStart(2, "0")}`;
    onChange(candidate > current ? current : candidate);
  };
  return (
    <div className="fm-month-picker" aria-label="Período de las métricas" aria-busy={busy || undefined}>
      <IconButton label="Mes anterior" icon="ChevronLeft" onClick={() => onChange(shiftMonthKey(value, -1))} />
      <div className="fm-month-picker__label">
        <Icon name="CalendarDays" />
        <strong>{argentinaMonthLabel(value)}</strong>
      </div>
      <IconButton label="Mes siguiente" icon="ChevronRight" disabled={value >= current} onClick={() => onChange(shiftMonthKey(value, 1))} />
      <Select aria-label="Mes" value={selectedMonth} onChange={(event) => choose(selectedYear, Number(event.target.value))}>
        {MONTHS.map((month, index) => {
          const disabled = selectedYear === currentYear && index + 1 > Number(current.slice(5));
          return <option key={month} value={index + 1} disabled={disabled}>{month}</option>;
        })}
      </Select>
      <Select aria-label="Año" value={selectedYear} onChange={(event) => choose(Number(event.target.value), selectedMonth)}>
        {years.map((year) => <option key={year} value={year}>{year}</option>)}
      </Select>
      {value !== current ? <Button variant="ghost" icon="RotateCcw" onClick={() => onChange(current)}>Mes actual</Button> : null}
    </div>
  );
}

function ActivityList({ activities }) {
  return (
    <ul className="fm-activity-list">
      {activities.map((activity) => (
        <li key={activity.id}>
          <div className="fm-activity-list__icon"><Icon name={activity.source === "sales" ? "ReceiptText" : activity.source === "stockMovements" ? "PackagePlus" : "Activity"} /></div>
          <div>
            <strong>{activity.title}</strong>
            <span>{activity.description || activity.locationName || "Sistema"} · {formatDateTime(activity.createdAt)}</span>
            <small>{activity.userName || "Sistema"}{activity.locationName ? ` · ${activity.locationName}` : ""}</small>
          </div>
          <Badge tone={activity.status === "cancelled" ? "error" : "success"}>
            {activity.amount != null ? formatMoney(activity.amount) : "Registrada"}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const [monthKey, setMonthKey] = useState(() => argentinaMonthKey());
  const locationsResult = useAsyncData(() => listLocations(profile), [profile.id]);
  const locations = locationsResult.data || [];
  const locationIdsKey = locations.map((location) => location.id).sort().join(",");
  const scopedLocationIds = can(profile, "locations", "viewAllLocations") ? undefined : locations.map((location) => location.id);
  const monthResult = useAsyncData(async () => {
    if (!locationsResult.data) return [];
    const range = argentinaMonthRange(monthKey);
    return listSalesByRange({ profile, locationIds: scopedLocationIds, ...range });
  }, [profile.id, locationIdsKey, monthKey]);
  const weekResult = useAsyncData(async () => {
    if (!locationsResult.data) return [];
    const range = lastSevenArgentinaDays();
    return listSalesByRange({ profile, locationIds: scopedLocationIds, ...range });
  }, [profile.id, locationIdsKey]);
  const activityResult = useAsyncData(async () => {
    if (!locationsResult.data) return [];
    const page = await listActivityPage({ profile, locationIds: scopedLocationIds, pageSize: 6 });
    return page.items;
  }, [profile.id, locationIdsKey]);
  const modules = visibleBusinessModules(profile);
  const summary = useMemo(() => summarizeSales(monthResult.data || []), [monthResult.data]);
  const chart = useMemo(() => buildSevenDaySalesSeries(weekResult.data || []), [weekResult.data]);
  const weekSummary = useMemo(() => summarizeSales(weekResult.data || []), [weekResult.data]);
  const initialLoading = locationsResult.status === "loading" || (monthResult.status === "loading" && !monthResult.data);
  const hasError = locationsResult.status === "error" || monthResult.status === "error" || weekResult.status === "error" || activityResult.status === "error";

  return (
    <div className="fm-page-enter">
      <HeroBanner
        eyebrow="Panel general"
        title={`Buen día, ${profile.name?.split(" ")[0] || "equipo"}.`}
        description="Resumen del negocio para las ubicaciones que podés consultar. Los períodos respetan la hora operativa de Argentina."
        action={modules.some((module) => module.id === "quick-sales") ? (
          <Link className="fm-button fm-button--primary" to="/gestion/quick-sales">
            <Icon name="Zap" />
            <span>Venta Rápida</span>
          </Link>
        ) : null}
      >
        <div className="fm-hero-banner__quote">
          <span>Flor Mía</span>
          <strong>gestión con raíces</strong>
        </div>
      </HeroBanner>

      <Panel className="fm-period-panel">
        <MonthSelector value={monthKey} onChange={setMonthKey} busy={monthResult.status === "loading"} />
      </Panel>

      {initialLoading ? <Skeleton lines={4} /> : null}
      {hasError ? (
        <Panel>
          <EmptyState
            icon="WifiOff"
            title="No pudimos actualizar todo el panel"
            description="La sesión sigue activa. Reintentá las consultas cuando tengas conexión o revisá tus permisos."
            action={<Button variant="secondary" onClick={() => { locationsResult.refresh(); monthResult.refresh(); weekResult.refresh(); activityResult.refresh(); }}>Reintentar</Button>}
          />
        </Panel>
      ) : null}

      {locationsResult.data ? (
        <>
          <section className="fm-stat-grid" aria-label={`Resumen de ${argentinaMonthLabel(monthKey)}`} aria-live="polite" aria-busy={monthResult.status === "loading" || undefined}>
            <StatCard label="Ventas del mes" value={summary.count} hint={summary.count ? argentinaMonthLabel(monthKey) : "Sin ventas activas"} icon="ReceiptText" />
            <StatCard label="Facturación del mes" value={formatMoney(summary.total)} hint="Total vendido, con descuentos" icon="CircleDollarSign" tone="olive" />
            <StatCard label="Ticket promedio" value={formatMoney(summary.average)} hint={summary.count ? `${summary.count} ventas activas` : "Sin división por cero"} icon="ChartNoAxesCombined" tone="wood" />
            <StatCard label="Ubicaciones visibles" value={locations.length} hint="Según tus permisos" icon="MapPin" tone="gold" />
          </section>
          {monthResult.status === "loading" && monthResult.data ? <p className="fm-refresh-note" role="status"><Icon name="RefreshCw" className="fm-spinner" /> Actualizando {argentinaMonthLabel(monthKey)}…</p> : null}

          <section className="fm-two-column-grid">
            <Panel
              title="Ritmo de ventas"
              description="Facturación total de los últimos siete días, incluido hoy."
              action={can(profile, "metrics", "view") ? <Link className="fm-button fm-button--secondary" to="/gestion/metrics/sales"><Icon name="Maximize2" /><span>Ver análisis completo</span></Link> : null}
            >
              {weekResult.status === "loading" && !weekResult.data ? <Skeleton lines={4} /> : null}
              {weekResult.data ? (
                <ChartContainer
                  title="Ventas de los últimos siete días"
                  summary={`Siete días, ${weekSummary.count} ventas activas y ${formatMoney(weekSummary.total)} vendidos. Los días sin ventas tienen valor cero.`}
                >
                  <SalesBars data={chart} />
                </ChartContainer>
              ) : null}
            </Panel>
            <Panel
              title="Actividad reciente"
              description="Operaciones más nuevas dentro de tus permisos."
              action={<Link className="fm-button fm-button--secondary" to="/gestion/actividad"><Icon name="Activity" /><span>Ver toda la actividad</span></Link>}
            >
              {activityResult.status === "loading" ? <Skeleton lines={5} /> : null}
              {activityResult.data?.length ? <ActivityList activities={activityResult.data} /> : null}
              {activityResult.status === "ready" && !activityResult.data?.length ? <EmptyState icon="Activity" title="Sin actividad reciente" description="Las nuevas ventas, cargas de stock y acciones administrativas aparecerán aquí." /> : null}
            </Panel>
          </section>

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
    </div>
  );
}
