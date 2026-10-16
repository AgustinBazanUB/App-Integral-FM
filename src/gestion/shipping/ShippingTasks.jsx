import { useEffect, useRef, useState } from "react";
import { Button, EmptyState, Panel, Badge, Skeleton } from "../../design-system";
import LabelPreview from "./LabelPreview";
import { SHIPPING_STATES } from "../../shared/shippingDomain.mjs";
import { subscribeShipments, shippingAction } from "../services/shippingService";
import { formatDateTime } from "../formatters";
import "./shipping.css";

export default function ShippingTasks({ profile, onDetail }) {
  const [rows, setRows] = useState(null), [selected, setSelected] = useState([]), [error, setError] = useState(""), [busy, setBusy] = useState(false), [preview, setPreview] = useState(null);
  const busyRef = useRef(false);
  useEffect(() => subscribeShipments(profile, setRows, error => setError(error.message), true), [profile.id]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const eligible = (rows || []).filter(row => row.stockCommitState === "committed" && !["rechazado", "cancelado"].includes(row.status));
  const toggle = id => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const generate = async () => {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError("");
    try {
      const shipments = [];
      for (const row of eligible.filter(row => selected.includes(row.id))) { const result = await shippingAction(row.id, "labels"); shipments.push(result.shipment); }
      const { buildShippingLabelPdf } = await import("./shippingLabels.mjs");
      const pdf = await buildShippingLabelPdf(shipments, import.meta.env.VITE_PUBLIC_APP_BASE_URL || window.location.origin);
      setPreview(URL.createObjectURL(pdf.output("blob")));
    } catch (error) { setError(error.message); } finally { busyRef.current = false; setBusy(false); }
  };
  return <Panel title="Mis preparaciones y etiquetas" description="Sólo los pedidos asignados a tu usuario. Un solo PDF A4 con las etiquetas seleccionadas." action={<Button icon="Printer" disabled={!selected.some(id => eligible.some(row => row.id === id))} loading={busy} onClick={generate}>Generar PDF A4</Button>}>
    {error && <p role="alert" className="fm-shipping-error">{error}</p>}
    {rows === null && !error ? <Skeleton /> : !eligible.length ? <EmptyState icon="PackageCheck" title="No tenés pedidos asignados" description="Las asignaciones aparecerán acá cuando gestión confirme el origen y los preparadores." /> : <>
      <label className="fm-shipping-check"><input type="checkbox" checked={eligible.length > 0 && eligible.every(row => selected.includes(row.id))} onChange={event => setSelected(event.target.checked ? eligible.map(row => row.id) : [])} />Seleccionar todas las asignadas</label>
      <div className="fm-shipping-task-grid">{eligible.map(row => <article className={`fm-shipping-task ${row.incident ? "has-incident" : ""}`} key={row.id}>
        <label className="fm-shipping-check"><input type="checkbox" checked={selected.includes(row.id)} onChange={() => toggle(row.id)} /><strong>{row.publicCode}</strong></label>
        <Badge tone={row.incident ? "error" : "warning"}>{row.incident ? `Incidencia: ${row.incident.reason}` : SHIPPING_STATES[row.status]}</Badge>
        <h3>{row.customerSnapshot.name}</h3><p>{row.destination.displayAddress}</p><small>{formatDateTime(row.createdAt)}</small>
        <ul>{row.itemsSnapshot.map(item => <li key={item.productId}>{item.qty} × {item.name}</li>)}</ul>
        <div className="fm-shipping-actions"><Button variant="secondary" onClick={() => onDetail(row.id)}>Ver ficha</Button><a className="fm-button fm-button--primary" href={`/e/${row.publicLookupId}?role=internal`}>Abrir preparación</a></div>
      </article>)}</div>
    </>}
    <LabelPreview url={preview} onClose={() => setPreview(null)} />
  </Panel>;
}
