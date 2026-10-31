import { Button, DataTable, EmptyState, Panel, StatCard } from "../../design-system";
import { summarizeEcommerceMetrics } from "../../modules/locations/domain/ecommerceMetrics";
import { formatMoney } from "../formatters";

export default function EcommerceMetricsPanel({ metrics, selected, onSelect }) {
  const web = summarizeEcommerceMetrics(metrics);
  return <Panel title="Ventas de la página web / E-commerce"
    description="Comparte el período y los filtros del informe. Sólo cuenta ventas confirmadas; los pedidos pendientes y las simulaciones no generan ingresos."
    action={<Button variant="secondary" aria-pressed={selected} onClick={onSelect}>{selected ? "Ver todos los canales" : "Ver sólo ventas web"}</Button>}>
    <section className="fm-stat-grid fm-metrics-summary" aria-label="Indicadores de ventas web">
      <StatCard label="Total vendido web" value={formatMoney(web.total)} hint="Incluye los cargos de envío" icon="CircleDollarSign" tone="olive" />
      <StatCard label="Ventas web" value={web.count} hint="Sin duplicar pedidos o comprobantes" icon="ReceiptText" />
      <StatCard label="Unidades web" value={web.units} hint="Productos vendidos" icon="Boxes" tone="gold" />
      <StatCard label="Ticket promedio web" value={formatMoney(web.ticket)} hint="Total web / ventas web" icon="ChartNoAxesCombined" tone="wood" />
      <StatCard label="Participación web" value={`${web.share.toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`} hint="Del total de los canales filtrados" icon="Percent" />
    </section>
    {web.count ? <DataTable rows={web.byDelivery} columns={[
      { key: "name", label: "Modalidad de compra" },
      { key: "sales", label: "Ventas" },
      { key: "units", label: "Unidades" },
      { key: "productsTotal", label: "Productos después de descuentos", render: row => row.productsTotal == null ? "Sin desglose histórico" : formatMoney(row.productsTotal) },
      { key: "shippingTotal", label: "Cargos de envío", render: row => row.missingShipping ? "Sin desglose histórico" : formatMoney(row.shippingTotal) },
      { key: "total", label: "Total vendido", render: row => formatMoney(row.total) },
    ]} /> : <EmptyState icon="ReceiptText" title="Sin ventas web confirmadas para estos filtros" description="Los pedidos pendientes de pago y las compras simuladas no se incluyen. Seleccioná otro período o revisá los filtros." />}
    <p className="fm-safe-note">Al elegir sólo ventas web, los gráficos, productos, categorías, pagos y orígenes del informe también muestran ese canal. La modalidad indica cómo se compró, no el estado de la entrega.</p>
  </Panel>;
}
