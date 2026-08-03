import { useMemo, useState } from "react";
import {
  ChartContainer,
  DataTable,
  EmptyState,
  FilterBar,
  FormField,
  PageHeader,
  Panel,
  Select,
  Skeleton,
  StatCard,
} from "../../design-system";
import { calculateMetrics } from "../../modules/locations/domain/metrics";
import {
  addArgentinaDays,
  argentinaDateFromKey,
  argentinaDateKey,
  argentinaMonthKey,
  argentinaMonthRange,
  argentinaParts,
  lastSevenArgentinaDays,
} from "../../modules/locations/domain/time";
import { useAuth } from "../AuthContext";
import { formatMoney } from "../formatters";
import { useAsyncData } from "../hooks";
import { can } from "../permissions";
import { listSalesByRange } from "../services/dashboardService";
import { listLocations } from "../services/managementService";

function selectedRange(period, values) {
  if (period === "seven") return { ...lastSevenArgentinaDays(), period: "custom", label: "Últimos siete días" };
  if (period === "month") return { ...argentinaMonthRange(values.month), period: "month", label: values.month };
  if (period === "year") {
    const year = Number(values.year);
    return {
      start: argentinaDateFromKey(`${year}-01-01`),
      end: argentinaDateFromKey(`${year + 1}-01-01`),
      period: "year",
      label: String(year),
    };
  }
  if (!values.from || !values.to) throw new Error("Elegí las fechas desde y hasta.");
  const start = argentinaDateFromKey(values.from);
  const end = addArgentinaDays(argentinaDateFromKey(values.to), 1);
  if (start >= end) throw new Error("La fecha final debe ser posterior a la inicial.");
  return { start, end, period: "custom", label: `${values.from} a ${values.to}` };
}

function salesDate(value) {
  return value?.toDate?.() || (value ? new Date(value) : null);
}

function buildDailySeries(sales, range) {
  const points = [];
  for (let date = new Date(range.start); date < range.end && points.length < 370; date = addArgentinaDays(date, 1)) {
    points.push({ key: argentinaDateKey(date), label: new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(date), total: 0, sales: 0 });
  }
  const byKey = new Map(points.map((point) => [point.key, point]));
  sales.forEach((sale) => {
    const date = salesDate(sale.createdAt);
    const point = date && byKey.get(argentinaDateKey(date));
    if (point) { point.total += Number(sale.total || 0); point.sales += 1; }
  });
  return points;
}

function MetricBars({ points }) {
  const visible = points.length > 62 ? points.filter((_, index) => index % Math.ceil(points.length / 31) === 0 || index === points.length - 1) : points;
  const max = Math.max(...visible.map((point) => point.total), 1);
  return <div className="fm-metric-bars">{visible.map((point) => <div key={point.key}><span style={{ height: `${point.total ? Math.max(5, point.total / max * 100) : 2}%` }} title={`${point.label}: ${formatMoney(point.total)} · ${point.sales} ventas`} /><small>{point.label}</small></div>)}</div>;
}

export default function SalesMetricsPage() {
  const { profile } = useAuth();
  const currentParts = argentinaParts();
  const [period, setPeriod] = useState("seven");
  const [values, setValues] = useState({
    month: argentinaMonthKey(),
    year: String(currentParts.year),
    from: argentinaDateKey(addArgentinaDays(new Date(), -6)),
    to: argentinaDateKey(),
  });
  const [filters, setFilters] = useState({ locationId: "", sellerId: "", paymentMethod: "" });
  const rangeState = useMemo(() => {
    try { return { range: selectedRange(period, values), error: null }; }
    catch (error) { return { range: null, error }; }
  }, [period, values]);
  const locationsResult = useAsyncData(() => listLocations(profile), [profile.id]);
  const locations = locationsResult.data || [];
  const locationIdsKey = locations.map((location) => location.id).join(",");
  const salesResult = useAsyncData(async () => {
    if (!locationsResult.data) return [];
    if (!rangeState.range) throw rangeState.error;
    return listSalesByRange({ profile, locationIds: can(profile, "locations", "viewAllLocations") ? undefined : locations.map((location) => location.id), start: rangeState.range.start, end: rangeState.range.end });
  }, [profile.id, locationIdsKey, period, values.month, values.year, values.from, values.to]);

  const sellers = useMemo(() => {
    const map = new Map();
    (salesResult.data || []).forEach((sale) => { if (sale.sellerId) map.set(sale.sellerId, sale.sellerName || "Vendedor"); });
    return [...map].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [salesResult.data]);
  const filteredSales = useMemo(() => (salesResult.data || []).filter((sale) => {
    if (filters.locationId && sale.locationId !== filters.locationId) return false;
    if (filters.sellerId && sale.sellerId !== filters.sellerId) return false;
    if (filters.paymentMethod && sale.paymentMethod !== filters.paymentMethod && !(sale.payments || []).some((payment) => payment.method === filters.paymentMethod)) return false;
    return true;
  }), [filters, salesResult.data]);
  const metrics = useMemo(() => rangeState.range ? calculateMetrics(filteredSales, { ...rangeState.range, period: rangeState.range.period === "custom" ? "year" : rangeState.range.period }) : null, [filteredSales, rangeState.range]);
  const daily = useMemo(() => rangeState.range ? buildDailySeries(filteredSales, rangeState.range) : [], [filteredSales, rangeState.range]);
  const monthly = useMemo(() => {
    const rows = new Map();
    filteredSales.forEach((sale) => {
      const date = salesDate(sale.createdAt);
      if (!date) return;
      const parts = argentinaParts(date);
      const key = `${parts.year}-${String(parts.month).padStart(2, "0")}`;
      if (!rows.has(key)) rows.set(key, { id: key, name: new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" }).format(date), total: 0, sales: 0 });
      const row = rows.get(key); row.total += Number(sale.total || 0); row.sales += 1;
    });
    return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
  }, [filteredSales]);

  const setValue = (key, value) => setValues((current) => ({ ...current, [key]: value }));
  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

  return (
    <div className="fm-page-enter">
      <PageHeader eyebrow="Métricas generales" title="Análisis completo de ventas" description="Comparaciones por período, ubicación, vendedor y forma de pago sobre ventas reales autorizadas." />
      <Panel title="Período y filtros" description="Cada cambio realiza una consulta acotada por fecha; nunca se descarga todo el historial.">
        <FilterBar>
          <FormField label="Período"><Select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="seven">Últimos siete días</option><option value="month">Mes</option><option value="custom">Rango personalizado</option><option value="year">Año</option></Select></FormField>
          {period === "month" ? <FormField label="Mes"><input type="month" max={argentinaMonthKey()} value={values.month} onChange={(event) => setValue("month", event.target.value)} /></FormField> : null}
          {period === "year" ? <FormField label="Año"><input type="number" min="2020" max={currentParts.year} value={values.year} onChange={(event) => setValue("year", event.target.value)} /></FormField> : null}
          {period === "custom" ? <><FormField label="Desde"><input type="date" max={values.to || argentinaDateKey()} value={values.from} onChange={(event) => setValue("from", event.target.value)} /></FormField><FormField label="Hasta"><input type="date" min={values.from} max={argentinaDateKey()} value={values.to} onChange={(event) => setValue("to", event.target.value)} /></FormField></> : null}
          <FormField label="Ubicación"><Select value={filters.locationId} onChange={(event) => setFilter("locationId", event.target.value)}><option value="">Todas</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</Select></FormField>
          <FormField label="Vendedor"><Select value={filters.sellerId} onChange={(event) => setFilter("sellerId", event.target.value)}><option value="">Todos</option>{sellers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select></FormField>
          <FormField label="Forma de pago"><Select value={filters.paymentMethod} onChange={(event) => setFilter("paymentMethod", event.target.value)}><option value="">Todas</option><option value="cash">Efectivo</option><option value="debit">Débito</option><option value="credit">Crédito</option><option value="alias">Transferencia / alias</option></Select></FormField>
        </FilterBar>
      </Panel>
      {salesResult.status === "loading" || locationsResult.status === "loading" ? <Skeleton lines={5} /> : null}
      {salesResult.status === "error" ? <Panel><EmptyState icon="AlertTriangle" title="No se pudo cargar el análisis" description={salesResult.error?.message || "Revisá el período y los permisos."} /></Panel> : null}
      {salesResult.status === "ready" && metrics ? <>
        <section className="fm-stat-grid" aria-live="polite">
          <StatCard label="Ventas activas" value={metrics.salesCount} hint="Sin anuladas ni duplicadas" icon="ReceiptText" />
          <StatCard label="Total vendido" value={formatMoney(metrics.total)} hint="Total final guardado" icon="CircleDollarSign" tone="olive" />
          <StatCard label="Ticket promedio" value={formatMoney(metrics.ticket)} hint={metrics.salesCount ? "Sobre ventas activas" : "Sin ventas"} icon="ChartNoAxesCombined" tone="wood" />
          <StatCard label="Productos vendidos" value={metrics.totalItems} hint="Unidades del período" icon="Boxes" tone="gold" />
        </section>
        <Panel title="Evolución de ventas" description="Todos los días del rango aparecen, incluso cuando el total es cero.">
          {daily.length ? <ChartContainer title="Evolución diaria" summary={`${metrics.salesCount} ventas por ${formatMoney(metrics.total)} en el período seleccionado.`}><MetricBars points={daily} /></ChartContainer> : <EmptyState icon="ChartNoAxesCombined" title="Sin días para graficar" />}
        </Panel>
        {!metrics.salesCount ? <Panel><EmptyState icon="ReceiptText" title="No hay ventas activas en este período" description="Las métricas se muestran en cero y no se incluyen operaciones anuladas." /></Panel> : null}
        <section className="fm-analysis-grid">
          <Panel title="Comparación por meses"><DataTable rows={monthly} columns={[{ key: "name", label: "Mes" }, { key: "sales", label: "Ventas" }, { key: "total", label: "Total", render: (row) => formatMoney(row.total) }]} empty={<EmptyState icon="CalendarRange" title="Sin meses para comparar" />} /></Panel>
          <Panel title="Comparación por ubicaciones"><DataTable rows={metrics.byLocation} columns={[{ key: "name", label: "Ubicación" }, { key: "sales", label: "Ventas" }, { key: "total", label: "Total", render: (row) => formatMoney(row.total) }, { key: "ticket", label: "Ticket", render: (row) => formatMoney(row.ticket) }]} empty={<EmptyState icon="MapPin" title="Sin ubicaciones con ventas" />} /></Panel>
          <Panel title="Comparación por vendedores"><DataTable rows={metrics.bySeller} columns={[{ key: "name", label: "Vendedor" }, { key: "sales", label: "Ventas" }, { key: "total", label: "Total", render: (row) => formatMoney(row.total) }, { key: "ticket", label: "Ticket", render: (row) => formatMoney(row.ticket) }]} empty={<EmptyState icon="UsersRound" title="Sin vendedores con ventas" />} /></Panel>
          <Panel title="Métodos de pago"><DataTable rows={metrics.byPayment} columns={[{ key: "name", label: "Método" }, { key: "sales", label: "Operaciones" }, { key: "total", label: "Total", render: (row) => formatMoney(row.total) }]} empty={<EmptyState icon="CircleDollarSign" title="Sin pagos para comparar" />} /></Panel>
        </section>
      </> : null}
    </div>
  );
}
