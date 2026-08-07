import { useMemo, useState } from "react";
import {
  DataTable,
  EmptyState,
  PageHeader,
  Panel,
  Skeleton,
  StatCard,
} from "../../design-system";
import {
  applyMetricsFilters,
  buildMetricsCustomRange,
  buildMetricsDateRange,
  calculateMetrics,
} from "../../modules/locations/domain/metrics";
import {
  addArgentinaDays,
  argentinaDateKey,
  argentinaMonthKey,
  argentinaParts,
} from "../../modules/locations/domain/time";
import { useAuth } from "../AuthContext";
import MetricsFiltersPanel from "../components/MetricsFiltersPanel";
import { PaymentDonut, SalesLineChart } from "../components/MetricsVisuals";
import { formatMoney } from "../formatters";
import { useAsyncData } from "../hooks";
import { can } from "../permissions";
import { listSalesByRange } from "../services/dashboardService";
import {
  listDiscountsShared,
  listLocationsShared,
  listMasterProductsShared,
  listProductCategoriesShared,
} from "../services/sharedResources";

const initialFilterState = () => {
  const parts = argentinaParts();
  return {
    periodType: "month",
    day: argentinaDateKey(),
    month: argentinaMonthKey(),
    year: String(parts.year),
    from: argentinaDateKey(addArgentinaDays(new Date(), -29)),
    to: argentinaDateKey(),
    locationIds: [],
    sellerIds: [],
    categoryIds: [],
    productIds: [],
    discountIds: [],
    paymentMethods: [],
  };
};

function rangeFromState(state) {
  if (state.periodType === "custom") return buildMetricsCustomRange(state.from, state.to);
  const value = state.periodType === "day" ? state.day : state.periodType === "year" ? state.year : state.month;
  return buildMetricsDateRange(state.periodType, value);
}

function sellerOptions(sales) {
  const sellers = new Map();
  (sales || []).forEach((sale) => {
    if (sale.sellerId) sellers.set(sale.sellerId, sale.sellerName || "Vendedor");
  });
  return [...sellers].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function sortableRows(rows, sortBy) {
  const field = sortBy === "sales" ? "sales" : sortBy === "items" ? "items" : "total";
  return [...rows].sort((a, b) => Number(b[field] || 0) - Number(a[field] || 0) || String(a.name).localeCompare(String(b.name), "es"));
}

export default function SalesMetricsPage() {
  const { profile } = useAuth();
  const [filters, setFilters] = useState(initialFilterState);
  const [locationSort, setLocationSort] = useState("total");
  const rangeState = useMemo(() => {
    try { return { range: rangeFromState(filters), error: null }; }
    catch (error) { return { range: null, error }; }
  }, [filters.periodType, filters.day, filters.month, filters.year, filters.from, filters.to]);

  const locationsResult = useAsyncData(() => listLocationsShared(profile), [profile.id]);
  const dimensionsResult = useAsyncData(async () => {
    const [products, categories, discounts] = await Promise.all([
      listMasterProductsShared(profile),
      listProductCategoriesShared(profile),
      listDiscountsShared(profile),
    ]);
    return { products, categories, discounts };
  }, [profile.id]);

  const locations = locationsResult.data || [];
  const locationIdsKey = locations.map((location) => location.id).sort().join(",");
  const selectedLocationKey = filters.locationIds.slice().sort().join(",");
  const salesResult = useAsyncData(async () => {
    if (!locationsResult.data) return [];
    if (!rangeState.range) throw rangeState.error;
    const selected = filters.locationIds.length ? filters.locationIds : null;
    const locationIds = selected || (can(profile, "locations", "viewAllLocations") ? undefined : locations.map((location) => location.id));
    return listSalesByRange({
      profile,
      locationIds,
      start: rangeState.range.start,
      end: rangeState.range.end,
    });
  }, [profile.id, locationIdsKey, selectedLocationKey, filters.periodType, filters.day, filters.month, filters.year, filters.from, filters.to]);

  const dimensions = dimensionsResult.data || { products: [], categories: [], discounts: [] };
  const sellers = useMemo(() => sellerOptions(salesResult.data), [salesResult.data]);
  const categoryProductIds = useMemo(() => {
    if (!filters.categoryIds.length) return [];
    const categories = new Set(filters.categoryIds);
    return dimensions.products.filter((product) => categories.has(product.categoryId)).map((product) => product.id);
  }, [filters.categoryIds, dimensions.products]);

  const filteredSales = useMemo(() => {
    if (!rangeState.range) return [];
    return applyMetricsFilters(salesResult.data || [], {
      locationIds: filters.locationIds,
      sellerIds: filters.sellerIds,
      productIds: filters.productIds,
      categoryProductIds,
      discountIds: filters.discountIds,
      paymentMethods: filters.paymentMethods,
    }, rangeState.range);
  }, [salesResult.data, rangeState.range, filters.locationIds, filters.sellerIds, filters.productIds, categoryProductIds, filters.discountIds, filters.paymentMethods]);

  const metrics = useMemo(
    () => rangeState.range ? calculateMetrics(filteredSales, rangeState.range) : null,
    [filteredSales, rangeState.range],
  );
  const locationRows = useMemo(() => metrics ? sortableRows(metrics.byLocation, locationSort) : [], [metrics, locationSort]);
  const productRows = metrics?.byProduct || [];
  const rankingRows = productRows.slice(0, 10).map((row, index) => ({ ...row, rank: index + 1 }));
  const loading = locationsResult.status === "loading" || dimensionsResult.status === "loading" || salesResult.status === "loading";
  const error = rangeState.error || locationsResult.error || dimensionsResult.error || salesResult.error;

  return (
    <div className="fm-page-enter fm-metrics-page">
      <PageHeader
        eyebrow="Métricas generales"
        title="Historial y análisis de ventas"
        description="Todos los paneles reaccionan al mismo conjunto de filtros y se calculan desde una única consulta de ventas acotada por período."
      />

      <Panel title="Filtros" description="Combiná período, ubicaciones, vendedores, productos, descuentos y formas de pago.">
        <MetricsFiltersPanel
          state={filters}
          onChange={setFilters}
          locations={locations}
          sellers={sellers}
          categories={dimensions.categories}
          products={dimensions.products}
          discounts={dimensions.discounts}
          busy={loading}
        />
      </Panel>

      {loading ? <div className="fm-metrics-loading"><Skeleton lines={5} /><Skeleton lines={6} /></div> : null}
      {error ? <Panel><EmptyState icon="AlertTriangle" title="No se pudo cargar el análisis" description={error.message || "Revisá el período, la conexión y tus permisos."} /></Panel> : null}

      {!loading && !error && metrics ? (
        <>
          <section className="fm-stat-grid fm-metrics-summary" aria-label="Resumen de ventas filtradas" aria-live="polite">
            <StatCard label="Total vendido" value={formatMoney(metrics.total)} hint="Monto final cobrado" icon="CircleDollarSign" tone="olive" />
            <StatCard label="Cantidad de ventas" value={metrics.salesCount} hint="Ventas activas filtradas" icon="ReceiptText" />
            <StatCard label="Unidades vendidas" value={metrics.totalItems} hint="Suma de cantidades" icon="Boxes" tone="gold" />
            <StatCard label="Ticket promedio" value={formatMoney(metrics.ticket)} hint={metrics.salesCount ? "Total / ventas" : "Sin ventas"} icon="ChartNoAxesCombined" tone="wood" />
            <StatCard label="Total descuentos" value={formatMoney(metrics.discountTotal)} hint={`${metrics.discountedSales} ventas con descuento`} icon="Percent" tone="gold" />
          </section>

          <Panel title="Evolución de ventas" description={`Granularidad automática: ${metrics.timelineMode === "hour" ? "hora" : metrics.timelineMode === "day" ? "día" : metrics.timelineMode === "week" ? "semana" : "mes"}.`}>
            {metrics.timeline.length ? <SalesLineChart points={metrics.timeline} label="Evolución de ventas según los filtros seleccionados" /> : <EmptyState icon="ChartNoAxesCombined" title="Sin puntos para graficar" />}
          </Panel>

          <section className="fm-analysis-grid fm-metrics-analysis-grid">
            <Panel title="Productos" description="Unidades vendidas según los filtros seleccionados.">
              <DataTable rows={productRows} columns={[
                { key: "name", label: "Producto" },
                { key: "items", label: "Unidades" },
                { key: "total", label: "Monto", render: (row) => formatMoney(row.total) },
              ]} empty={<EmptyState icon="Boxes" title="Sin productos vendidos" />} />
            </Panel>

            <Panel title="Formas de pago" description="Distribución por monto cobrado; +2 pagos se reparte entre sus partes reales.">
              {metrics.byPayment.length ? <PaymentDonut rows={metrics.byPayment} total={metrics.total} /> : <EmptyState icon="CircleDollarSign" title="Sin pagos para mostrar" />}
            </Panel>
          </section>

          <section className="fm-analysis-grid fm-metrics-analysis-grid">
            <Panel
              title="Detalle por ubicación"
              description="Monto, ventas y unidades por ubicación."
              action={<div className="fm-metrics-sort" role="group" aria-label="Ordenar ubicaciones">{[["total", "Monto"], ["sales", "Ventas"], ["items", "Unidades"]].map(([id, label]) => <button key={id} type="button" className={locationSort === id ? "is-active" : ""} aria-pressed={locationSort === id} onClick={() => setLocationSort(id)}>{label}</button>)}</div>}
            >
              <DataTable rows={locationRows} columns={[
                { key: "name", label: "Ubicación" },
                { key: "total", label: "Monto", render: (row) => formatMoney(row.total) },
                { key: "sales", label: "Ventas" },
                { key: "items", label: "Unidades" },
              ]} empty={<EmptyState icon="MapPin" title="Sin ubicaciones con ventas" />} />
            </Panel>

            <Panel title="Detalle por vendedor" description="Orden inicial por mayor total vendido.">
              <DataTable rows={metrics.bySeller} columns={[
                { key: "name", label: "Vendedor" },
                { key: "total", label: "Total", render: (row) => formatMoney(row.total) },
                { key: "sales", label: "Ventas" },
                { key: "items", label: "Unidades" },
                { key: "ticket", label: "Ticket", render: (row) => formatMoney(row.ticket) },
              ]} empty={<EmptyState icon="UsersRound" title="Sin vendedores con ventas" />} />
            </Panel>
          </section>

          <section className="fm-analysis-grid fm-metrics-analysis-grid">
            <Panel title="Ranking de productos" description="Reutiliza la misma agregación de Productos, sin volver a procesar las ventas.">
              <DataTable rows={rankingRows} columns={[
                { key: "rank", label: "#" },
                { key: "name", label: "Producto" },
                { key: "items", label: "Unidades" },
                { key: "total", label: "Monto", render: (row) => formatMoney(row.total) },
              ]} empty={<EmptyState icon="Boxes" title="Sin ranking disponible" />} />
            </Panel>

            <Panel title="Descuentos aplicados" description="Diferencia descuentos configurados y manuales cuando esa información existe en la venta.">
              <DataTable rows={metrics.byDiscount.map((row) => ({ ...row, percentage: metrics.salesCount ? row.sales / metrics.salesCount * 100 : 0 }))} columns={[
                { key: "name", label: "Descuento" },
                { key: "source", label: "Origen", render: (row) => row.source === "manual" ? "Manual" : "Guardado" },
                { key: "sales", label: "Usos" },
                { key: "salesTotal", label: "Vendido asociado", render: (row) => formatMoney(row.salesTotal || 0) },
                { key: "total", label: "Descontado", render: (row) => formatMoney(row.total) },
                { key: "percentage", label: "% ventas", render: (row) => `${row.percentage.toFixed(1)} %` },
              ]} empty={<EmptyState icon="Percent" title="Sin descuentos aplicados" />} />
            </Panel>
          </section>

          {!metrics.salesCount ? <Panel><EmptyState icon="ReceiptText" title="No hay ventas para estos filtros" description="Modificá el período o alguna dimensión para ampliar el conjunto analizado." /></Panel> : null}
        </>
      ) : null}
    </div>
  );
}
