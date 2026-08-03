import { useMemo } from "react";
import {
  Badge,
  Button,
  ChartContainer,
  EmptyState,
  HeroBanner,
  Panel,
  Skeleton,
  StatCard,
} from "../../design-system";
import { Link } from "../../router";
import { useAuth } from "../AuthContext";
import { formatDateTime, formatMoney, toDate } from "../formatters";
import { useAsyncData } from "../hooks";
import { getManagementPath } from "../modules";
import { visibleBusinessModules } from "../permissions";
import {
  listLocations,
  listRecentSales,
} from "../services/managementService";

function salesByDay(sales) {
  const days = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - offset));
    return {
      key: date.toISOString().slice(0, 10),
      label: new Intl.DateTimeFormat("es-AR", { weekday: "short" }).format(date),
      value: 0,
    };
  });
  const byKey = Object.fromEntries(days.map((day) => [day.key, day]));
  sales.forEach((sale) => {
    const date = toDate(sale.createdAt);
    if (!date || sale.status === "cancelled") return;
    const key = date.toISOString().slice(0, 10);
    if (byKey[key]) byKey[key].value += Number(sale.total || 0);
  });
  return days;
}

function SalesBars({ data }) {
  const max = Math.max(...data.map((item) => item.value), 1);
  return (
    <div className="fm-bars">
      {data.map((item) => (
        <div key={item.key} className="fm-bars__item">
          <span
            className="fm-bars__bar"
            style={{ height: `${Math.max(5, (item.value / max) * 100)}%` }}
          />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const result = useAsyncData(
    async () => {
      const [locations, sales] = await Promise.all([
        listLocations(profile),
        listRecentSales({ profile, pageSize: 80 }),
      ]);
      return { locations, sales };
    },
    [profile.id],
  );
  const modules = visibleBusinessModules(profile);
  const summary = useMemo(() => {
    const sales = result.data?.sales || [];
    const activeSales = sales.filter((sale) => sale.status !== "cancelled");
    const total = activeSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    const average = activeSales.length ? total / activeSales.length : 0;
    return {
      sales: activeSales,
      total,
      average,
      chart: salesByDay(activeSales),
    };
  }, [result.data]);

  return (
    <div className="fm-page-enter">
      <HeroBanner
        eyebrow="Panel general"
        title={`Buen día, ${profile.name?.split(" ")[0] || "equipo"}.`}
        description="Prioridades, resultados y accesos según tu función. Los datos se consultan en rangos acotados para cuidar el plan Firebase Spark."
        action={
          modules.some((module) => module.id === "quick-sales") ? (
            <Link className="fm-button fm-button--primary" to="/gestion/quick-sales">
              Nueva venta
            </Link>
          ) : null
        }
      >
        <div className="fm-hero-banner__quote">
          <span>Flor Mía</span>
          <strong>gestión con raíces</strong>
        </div>
      </HeroBanner>

      {result.status === "loading" ? <Skeleton lines={4} /> : null}

      {result.status === "error" ? (
        <Panel>
          <EmptyState
            icon="WifiOff"
            title="No pudimos actualizar el panel"
            description="La sesión está activa, pero Firestore rechazó o interrumpió la consulta. Reintentá cuando tengas conexión."
            action={<Button variant="secondary" onClick={result.refresh}>Reintentar</Button>}
          />
        </Panel>
      ) : null}

      {result.status === "ready" ? (
        <>
          <section className="fm-stat-grid" aria-label="Resumen operativo">
            <StatCard label="Ventas consultadas" value={summary.sales.length} hint="Últimos 80 registros" icon="ReceiptText" />
            <StatCard label="Facturación consultada" value={formatMoney(summary.total)} hint="Sin ventas anuladas" icon="CircleDollarSign" tone="olive" />
            <StatCard label="Ticket promedio" value={formatMoney(summary.average)} hint="Período consultado" icon="ChartNoAxesCombined" tone="wood" />
            <StatCard label="Ubicaciones visibles" value={result.data.locations.length} hint="Según tus permisos" icon="MapPinned" tone="gold" />
          </section>

          <section className="fm-two-column-grid">
            <Panel title="Ritmo de ventas" description="Facturación de los últimos siete días disponible en la consulta.">
              {summary.sales.length ? (
                <ChartContainer
                  title="Ventas de los últimos siete días"
                  summary={`Se muestran ${summary.sales.length} ventas activas con una facturación consultada de ${formatMoney(summary.total)}.`}
                >
                  <SalesBars data={summary.chart} />
                </ChartContainer>
              ) : (
                <EmptyState icon="ChartNoAxesCombined" title="Todavía no hay ventas en el rango" description="El gráfico aparecerá cuando existan operaciones autorizadas para tu usuario." />
              )}
            </Panel>
            <Panel title="Actividad reciente" description="Las operaciones más nuevas que podés consultar.">
              {summary.sales.length ? (
                <ul className="fm-activity-list">
                  {summary.sales.slice(0, 6).map((sale) => (
                    <li key={sale.id}>
                      <div className="fm-activity-list__mark" />
                      <div>
                        <strong>{sale.saleCode || "Venta registrada"}</strong>
                        <span>{sale.locationName || "Ubicación pendiente"} · {formatDateTime(sale.createdAt)}</span>
                      </div>
                      <Badge tone={sale.status === "cancelled" ? "error" : "success"}>{sale.status === "cancelled" ? "Anulada" : formatMoney(sale.total)}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon="ReceiptText" title="Sin actividad reciente" description="No hay operaciones visibles para mostrar." />
              )}
            </Panel>
          </section>

          <Panel title="Tus módulos" description="El menú y estos accesos se generan desde los permisos de tu perfil.">
            <div className="fm-module-grid">
              {modules.map((module) => (
                <Link key={module.id} to={getManagementPath(module.id)} className={`fm-module-card fm-module-card--${module.accent}`}>
                  <span className="fm-module-card__number">{module.number}</span>
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
