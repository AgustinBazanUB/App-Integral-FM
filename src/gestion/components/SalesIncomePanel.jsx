import { useMemo, useState } from "react";
import { DataTable, EmptyState, FormField, Panel, Select, Skeleton, StatCard } from "../../design-system";
import { buildMetricsDateRange, calculateMetrics } from "../../modules/locations/domain/metrics";
import { argentinaDateKey, argentinaMonthKey } from "../../modules/locations/domain/time";
import { saleChannelLabel } from "../../modules/locations/domain/channels";
import { useAuth } from "../AuthContext";
import { formatMoney } from "../formatters";
import { useAsyncData } from "../hooks";
import { listSalesByRange } from "../services/dashboardService";

export default function SalesIncomePanel() {
  const { profile } = useAuth();
  const [period, setPeriod] = useState("month");
  const range = useMemo(() => buildMetricsDateRange(period, period === "day" ? argentinaDateKey() : argentinaMonthKey()), [period]);
  const result = useAsyncData(() => listSalesByRange({ profile, ...range, useCache: false }), [profile.id, range]);
  const metrics = useMemo(() => calculateMetrics(result.data || [], range), [result.data, range]);
  return <Panel title="Ingresos por ventas" description="Ventas confirmadas del período. El comprobante fiscal está asociado a cada venta; su emisión conserva el mismo ingreso.">
    <FormField label="Período de ingresos"><Select value={period} onChange={event => setPeriod(event.target.value)}><option value="day">Hoy</option><option value="month">Mes actual</option></Select></FormField>
    {result.status === "loading" ? <Skeleton lines={4} /> : null}
    {result.status === "error" ? <EmptyState title="No se pudieron cargar los ingresos" description={result.error.message} /> : null}
    {result.status === "ready" ? <>
      <StatCard label="Ingreso confirmado por ventas" value={formatMoney(metrics.total)} hint={`${metrics.salesCount} ventas · importe final cobrado`} icon="CircleDollarSign" />
      <DataTable rows={metrics.active.slice(0, 100)} columns={[
        { key: "saleCode", label: "Venta" },
        { key: "sourceChannel", label: "Canal", render: row => saleChannelLabel(row.sourceChannel) },
        { key: "stockOriginName", label: "Origen físico", render: row => row.stockOriginName || row.locationName || row.warehouseName || "Sin informar" },
        { key: "total", label: "Ingreso", render: row => formatMoney(row.total) },
      ]} empty={<EmptyState title="Sin ventas confirmadas en este período" />} />
      {metrics.salesCount > 100 ? <p>Se muestran las últimas 100 ventas; el total incluye todo el período.</p> : null}
    </> : null}
  </Panel>;
}
