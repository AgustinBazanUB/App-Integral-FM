import { useEffect, useState } from "react";
import { Badge, EmptyState, Panel } from "../../design-system";
import ShipmentDetail from "./ShipmentDetail";
import { formatDateTime } from "../formatters";

export default function ShippingRequests({ rows, profile, onDetail }) {
  const [selected, setSelected] = useState(null);
  useEffect(() => { if (!rows.some(row => row.id === selected)) setSelected(rows[0]?.id || null); }, [rows, selected]);
  return <div className="fm-shipping-requests-layout"><Panel title="Por aprobar" description="Ventas registradas desde el Panel Vendedor.">
    {rows.length ? <div className="fm-shipping-request-list">{rows.map(row => <button key={row.id} className={selected === row.id ? "is-selected" : ""} aria-pressed={selected === row.id} onClick={() => setSelected(row.id)}><Badge tone="warning">{row.approvalReview ? "En revisión" : "Pendiente de aprobación"}</Badge><strong>{row.publicCode} · {row.customerSnapshot.name}</strong><small>{row.saleCode} · {row.commercialLocationName}</small><small>{row.itemsSnapshot.length} productos · {formatDateTime(row.createdAt)}</small></button>)}</div> : <EmptyState icon="PackageCheck" title="No hay solicitudes pendientes" description="Las nuevas ventas con envío del vendedor aparecerán acá." />}
  </Panel>{selected ? <div><ShipmentDetail shipmentId={selected} profile={profile} presentation="review" revision={rows.find(row => row.id === selected)?.revision} onClose={() => onDetail(selected)} /></div> : <Panel title="Revisión de la solicitud"><EmptyState icon="ClipboardList" title="Todo al día" description="Seleccioná una solicitud para confirmar su origen físico y asignar la preparación." /></Panel>}</div>;
}
