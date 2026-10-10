import { useMemo, useState } from "react";
import { Button, EmptyState, Panel, Skeleton } from "../../design-system";
import { summarizeRemainingStock } from "../../modules/inventory/domain/remainingStock";
import { formatMoney } from "../formatters";
import { useAsyncData } from "../hooks";
import { can } from "../permissions";
import { listRemainingStock } from "../services/remainingStockService";
import "../../styles/business-metrics.css";

function Ranking({ rows, products = false }) {
  const [expanded, setExpanded] = useState(false);
  const max = Math.max(...rows.map(row => products ? row.items : row.total), 1);
  if (!rows.length) return <EmptyState title="Todavía no hay datos" description="No hay ventas activas para estos filtros." />;
  return <>
    <ol className="fm-business-ranking">
      {(expanded ? rows : rows.slice(0, 6)).map((row, index) => <li key={row.key}>
        <div className="fm-business-ranking__line"><span><small>{index + 1}.</small> {row.name}</span><strong>{products ? `${row.items} u.` : formatMoney(row.total)}</strong></div>
        <div className="fm-business-ranking__track" aria-hidden="true"><span style={{ width: `${Math.max(1, (products ? row.items : row.total) / max * 100)}%` }} /></div>
        <small>{products ? `${formatMoney(row.total)} de subtotal` : `${row.sales} ventas · ${row.items} u.`}</small>
      </li>)}
    </ol>
    {rows.length > 6 ? <Button variant="secondary" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>{expanded ? "Ver menos" : `Ver todos (${rows.length})`}</Button> : null}
  </>;
}

function HourlySales({ rows }) {
  const [details, setDetails] = useState(false);
  const max = Math.max(...rows.map(row => row.total), 1);
  if (!rows.some(row => row.sales)) return <EmptyState title="Todavía no hay datos" description="No hay ventas activas para estos filtros." />;
  return <>
    <div className="fm-business-hours" role="img" aria-label="Total vendido por hora de Argentina; consultá el detalle para ver los importes.">
      {rows.map(row => <div key={row.key} className="fm-business-hours__column" title={`${row.name}: ${formatMoney(row.total)} · ${row.sales} ventas`}>
        <span className="fm-business-hours__bar" style={{ height: `${row.sales ? Math.max(3, row.total / max * 100) : 1}%` }} />
        <small>{Number(row.key) % 4 === 0 ? row.name.slice(0, 2) : ""}</small>
      </div>)}
    </div>
    <Button variant="secondary" aria-expanded={details} onClick={() => setDetails(value => !value)}>{details ? "Ocultar detalle por hora" : "Ver detalle por hora"}</Button>
    {details ? <div className="fm-business-scroll"><table className="fm-business-hour-table"><caption>Ventas por hora · Argentina</caption><thead><tr><th>Hora</th><th>Ventas</th><th>Total</th></tr></thead><tbody>{rows.map(row => <tr key={row.key}><th scope="row">{row.name}</th><td>{row.sales}</td><td>{formatMoney(row.total)}</td></tr>)}</tbody></table></div> : null}
  </>;
}

function RemainingStock({ profile, locations, includeWarehouses, filters }) {
  const [expanded, setExpanded] = useState(false);
  const scope = locations.map(location => location.id).sort().join(",");
  const allowed = can(profile, "locations", "viewStock") || (includeWarehouses && can(profile, "warehouse", "view"));
  const queryKey = `${profile.id}|${scope}|${includeWarehouses}|${allowed}`;
  const result = useAsyncData(async () => ({ queryKey, origins: allowed ? await listRemainingStock({ profile, locations, includeWarehouses }) : [] }), [profile, queryKey]);
  const current = result.data?.queryKey === queryKey;
  const rows = useMemo(() => current ? summarizeRemainingStock(result.data.origins, filters) : [], [current, result.data, filters]);
  const count = result.status === "ready" && current && allowed ? `${rows.length} productos` : "";
  return <Panel title="Stock restante" className="fm-business-card" action={count ? <span className="fm-business-count">{count}</span> : null}
    description={`Saldo actual de ${includeWarehouses && can(profile, "warehouse", "view") ? "ubicaciones y depósitos permitidos" : "ubicaciones seleccionadas"}. No depende del período de ventas.`}>
    {!allowed ? <EmptyState title="Sin permiso para consultar stock" /> : result.status === "error" ? <EmptyState title="No pudimos consultar todo el stock" description="Revisá la conexión o los permisos. No se muestra un saldo parcial." action={<Button variant="secondary" onClick={() => result.refresh().catch(() => {})}>Reintentar</Button>} /> : result.status === "loading" || !current ? <Skeleton lines={6} /> : !rows.length ? <EmptyState title="Sin productos en este inventario" /> : <>
      <Button variant="secondary" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Ver menos stock" : "Ver todo el stock"}</Button>
      <ul className={`fm-business-stock ${expanded ? "fm-business-scroll" : ""}`}>
        {(expanded ? rows : rows.slice(0, 6)).map(row => <li key={row.key}>
          <div><strong>{row.abbreviation || row.name}</strong><small>{row.abbreviation ? row.name : ""}</small>{expanded ? <small>{row.origins.map(origin => `${origin.name}: ${origin.quantity} u.`).join(" · ")}</small> : null}</div>
          <strong className={row.quantity < 0 ? "fm-business-stock__negative" : ""}>{row.quantity} u.</strong>
        </li>)}
      </ul>
      {filters?.productIds?.length || filters?.categoryIds?.length ? <p className="fm-safe-note">Filtrado por productos y categorías. Vendedor, pago, descuento y canal filtran las ventas.</p> : null}
    </>}
  </Panel>;
}

export default function BusinessMetricsCards({ metrics, profile, locations, includeWarehouses = false, stockFilters }) {
  return <section className="fm-business-metrics" aria-label="Productos, vendedores, horarios y stock">
    <Panel title="Productos más vendidos" description="Ordenados por unidades de las ventas filtradas. Importes antes de descuentos generales." className="fm-business-card"><Ranking rows={metrics.byProduct} products /></Panel>
    <Panel title="Ventas por vendedor" description="Ordenadas por el total vendido con los filtros elegidos." className="fm-business-card"><Ranking rows={metrics.bySeller} /></Panel>
    <Panel title="Ventas por hora" description="Total por hora del día, acumulado en el período. Hora de Argentina." className="fm-business-card"><HourlySales rows={metrics.byHour} /></Panel>
    <RemainingStock profile={profile} locations={locations} includeWarehouses={includeWarehouses} filters={stockFilters} />
  </section>;
}
