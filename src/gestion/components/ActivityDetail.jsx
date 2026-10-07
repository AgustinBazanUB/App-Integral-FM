import { Badge, Button, DataTable, Modal, Skeleton } from "../../design-system";
import { activityChangeRows, activityFieldRows, activityStockMovements, activityValueLabel } from "../activity/activityDetails";
import { getActivityPresentation } from "../activity/activityPresentation";
import { formatDateTime, formatMoney } from "../formatters";
import { businessModules } from "../modules";

function Fields({ record }) {
  const rows = activityFieldRows(record);
  return rows.length ? <dl className="fm-activity-detail__fields">{rows.map(row => <div key={row.key}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl> : null;
}
export default function ActivityDetail({ selected, state, onClose, onRetry }) {
  const detail = state.data, raw = detail?.raw || selected?.raw || {}, record = detail?.record || raw.detailSnapshot || {};
  const sale = String(selected?.action).startsWith("sale.");
  const items = Array.isArray(record.items) ? record.items : Array.isArray(raw.items) ? raw.items : [], movements = activityStockMovements(record, detail?.movements);
  const names = Object.fromEntries([...items, ...(Array.isArray(record.lines) ? record.lines : [])].map(item => [item.productId, item.name || item.productName]));
  const changes = activityChangeRows(raw.before || raw.previous || raw.previousSettings, raw.after || raw.next || raw.newSettings, names);
  const fields = { ...raw, ...record };
  return <Modal open={Boolean(selected)} title={getActivityPresentation(selected).label} description={selected?.description} onClose={onClose}>
    <div className="fm-activity-detail">
      <div className="fm-activity-detail__summary"><span>{selected?.userName || "Sistema"}</span><span>{formatDateTime(selected?.createdAt)}</span><span>{businessModules.find(module => module.id === selected?.moduleId)?.shortLabel || "Sistema"}</span><Badge tone={selected?.status === "cancelled" ? "error" : "gold"}>{activityValueLabel(selected?.status)}</Badge></div>
      {state.status === "loading" ? <div role="status" aria-label="Cargando detalle"><Skeleton lines={5} /></div> : null}
      {state.status === "error" ? <div className="fm-activity-detail__error" role="alert"><p>{state.error?.message || "No pude cargar el detalle. Revisá tu conexión."}</p><Button variant="secondary" onClick={onRetry}>Reintentar detalle</Button></div> : null}
      {state.status === "ready" ? <>
        {detail.warning ? <p className="fm-activity-detail__notice" role="note">{detail.warning}</p> : null}
        {detail.recorded ? <p className="fm-activity-detail__recorded">Detalle guardado cuando se realizó la actividad.</p> : null}
        {sale && fields.total != null ? <p className="fm-activity-detail__total">Total de la venta: <strong>{formatMoney(fields.total)}</strong></p> : null}
        {movements.length ? <section><h3>Movimientos de stock</h3><DataTable rows={movements} columns={[{ key: "productName", label: "Producto" }, { key: "qty", label: "Variación" }, { key: "previousStock", label: "Antes" }, { key: "newStock", label: "Después" }, { key: "reason", label: "Motivo" }]} /></section> : null}
        {items.length ? <section><h3>{sale ? "Productos de la venta" : "Productos de la operación"}</h3><DataTable rows={items} rowKey="productId" columns={[
          { key: "name", label: "Producto", render: item => item.name || item.productName || "Producto" },
          { key: "qty", label: "Cantidad", render: item => item.qty ?? item.quantity ?? item.receivedQuantity ?? "—" },
          ...(sale ? [{ key: "unitPrice", label: "Precio unitario", render: item => formatMoney(item.unitPrice ?? item.price) }, { key: "subtotal", label: "Importe", render: item => formatMoney(item.subtotal ?? Number(item.qty ?? item.quantity ?? 0) * Number(item.unitPrice ?? item.price ?? 0)) }] : [
            { key: "preparedQuantity", label: "Preparada" }, { key: "receivedQuantity", label: "Recibida" }, { key: "missingQuantity", label: "Faltante" }, { key: "lostQuantity", label: "Perdida" },
          ]),
        ]} /></section> : null}
        {Array.isArray(record.discounts) && record.discounts.length ? <section><h3>Descuentos aplicados</h3><ul>{record.discounts.map((discount, index) => <li key={index}>{discount.name || "Descuento"} · {discount.type === "percent" ? `${discount.value}%` : formatMoney(discount.value ?? discount.amount)}{discount.amount != null && discount.type === "percent" ? ` · ${formatMoney(discount.amount)}` : ""}</li>)}</ul></section> : null}
        {Array.isArray(record.payments) && record.payments.some(payment => Number(payment.amount) > 0) ? <section><h3>Desglose del pago</h3><dl className="fm-activity-detail__fields">{record.payments.filter(payment => Number(payment.amount) > 0).map((payment, index) => <div key={index}><dt>{activityValueLabel(payment.method || payment.label)}</dt><dd>{formatMoney(payment.amount)}</dd></div>)}</dl></section> : null}
        <Fields record={fields} />
        {changes.length ? <section><h3>Qué cambió</h3><DataTable rows={changes} rowKey="key" columns={[{ key: "label", label: "Dato" }, { key: "before", label: "Antes" }, { key: "after", label: "Después" }]} /></section> : null}
        {raw.after && !changes.length ? <Fields record={Array.isArray(raw.after) ? {} : raw.after} /> : null}
        {!activityFieldRows(fields).length && !items.length && !movements.length && !changes.length ? <p>Esta actividad conserva la descripción y las referencias, pero no guardó un desglose adicional.</p> : null}
        <small className="fm-activity-detail__reference">Referencia: {selected?.sourceId}</small>
      </> : null}
    </div>
  </Modal>;
}
