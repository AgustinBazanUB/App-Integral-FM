import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, EmptyState, Panel, Badge, Skeleton, Modal } from "../../design-system";
import LabelPreview from "./LabelPreview";
import ShippingLabelSheet, { ShipmentQrImage } from "./ShippingLabelSheet";
import { SHIPPING_STATES, TRANSPORTS } from "../../shared/shippingDomain.mjs";
import { subscribeShipments, shippingAction } from "../services/shippingService";
import { normalizedRole } from "../permissions";
import "./shipping.css";

export default function ShippingTasks({ profile, onDetail, heading = true, context = "management" }) {
  const [rows, setRows] = useState(null), [selected, setSelected] = useState([]), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [preview, setPreview] = useState(null), [qr, setQr] = useState(null);
  const busyRef = useRef(false);
  useEffect(() => subscribeShipments(profile, setRows, error => setError(error.message), true), [profile.id]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const eligible = (rows || []).filter(row => row.stockCommitState === "committed" && !["rechazado", "cancelado"].includes(row.status));
  const chosen = eligible.filter(row => selected.includes(row.id));
  const toggle = id => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const generate = async () => {
    if (busyRef.current || !chosen.length) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const shipments = [];
      for (const row of chosen) { const result = await shippingAction(row.id, "labels"); shipments.push(result.shipment); }
      const { buildShippingLabelPdf } = await import("./shippingLabels.mjs");
      const pdf = await buildShippingLabelPdf(shipments, import.meta.env.VITE_PUBLIC_APP_BASE_URL || window.location.origin);
      setPreview(URL.createObjectURL(pdf.output("blob")));
    } catch (error) { setError(error.message); } finally { busyRef.current = false; setBusy(false); }
  };
  return <section className="fm-shipping-tasks">
    {heading && <header className="fm-shipping-view-heading"><div><p className="fm-shipping-eyebrow">{context === "seller" ? "Panel Vendedor" : "Gestión de envíos / Equipo interno"}</p><h1>Mis preparaciones y etiquetas</h1><p>Pedidos asignados a tu usuario. Seleccioná uno o varios para reunir sus etiquetas en una hoja A4.</p></div><Badge>{profile.name || profile.displayName || "Tu usuario"} · {normalizedRole(profile) === "admin" ? "Administrador" : normalizedRole(profile) === "seller" ? "Vendedor" : "Preparación"}</Badge></header>}
    {error && <p role="alert" className="fm-shipping-error">{error}</p>}
    <div className="fm-shipping-tasks-layout">
      <Panel title="Envíos asignados" description="Preparación y etiquetas individuales o agrupadas." action={<Badge tone="warning">{eligible.length} asignados</Badge>}>
        {rows === null && !error ? <Skeleton /> : !eligible.length ? <EmptyState icon="PackageCheck" title="No tenés pedidos asignados" description="Aparecerán acá cuando gestión confirme el origen y los preparadores." /> : <>
          <div className="fm-shipping-sheet-tools"><label className="fm-shipping-check"><input type="checkbox" checked={eligible.length > 0 && eligible.every(row => selected.includes(row.id))} onChange={event => setSelected(event.target.checked ? eligible.map(row => row.id) : [])} />Seleccionar todas las asignadas</label><small>{chosen.length} seleccionados</small></div>
          <div className="fm-shipping-task-list">{eligible.map(row => <article className={`fm-shipping-task-row ${row.incident ? "has-incident" : ""}`} key={row.id}>
            <input aria-label={`Seleccionar ${row.publicCode}`} type="checkbox" checked={selected.includes(row.id)} onChange={() => toggle(row.id)} />
            <div><button className="fm-shipping-text-button fm-shipping-task-title" onClick={() => onDetail(row.id)}><strong>Envío para {row.customerSnapshot.name}</strong><small>{row.publicCode} · {row.saleCode}</small></button><p>{row.destination.displayAddress}</p><div className="fm-shipping-row-badges"><Badge tone={row.incident ? "error" : row.status === "entregado" ? "success" : row.status === "reparto_final" ? "info" : "warning"}>{row.incident ? `Incidencia: ${row.incident.reason}` : SHIPPING_STATES[row.status]}</Badge><Badge>{TRANSPORTS[row.deliveryType] || "Por definir"}</Badge></div></div>
            <Button variant="secondary" onClick={() => setQr(row)}>Ver QR</Button>
          </article>)}</div>
          <footer className="fm-shipping-task-footer"><div className="fm-shipping-actions"><Button icon="Printer" disabled={!chosen.length} loading={busy} onClick={generate}>Imprimir selección en A4</Button><Button variant="secondary" icon="QrCode" disabled={chosen.length !== 1} onClick={() => setQr(chosen[0])}>Confirmar preparación por QR</Button></div><small>Para preparar un pedido, abrí su QR con tu cuenta asignada. La impresión no modifica el inventario.</small></footer>
        </>}
      </Panel>
      <Panel title="Vista previa de impresión" description="Un archivo PDF para las etiquetas seleccionadas." action={<Badge tone="warning">A4</Badge>}>
        {chosen.length ? <ShippingLabelSheet shipments={chosen} /> : <EmptyState icon="Printer" title="Seleccioná tus pedidos" description="Las etiquetas aparecerán acá antes de generar el PDF A4." />}
      </Panel>
    </div>
    <LabelPreview url={preview} onClose={() => setPreview(null)} />
    {qr && createPortal(<div className="fm-management-body"><Modal open title={`QR · Envío para ${qr.customerSnapshot.name}`} onClose={() => setQr(null)} footer={<a className="fm-button fm-button--primary" href={`/e/${qr.publicLookupId}?role=internal`}>Abrir preparación</a>}><div className="fm-shipping-qr-preview"><ShipmentQrImage lookupId={qr.publicLookupId} /><strong>Envío para {qr.customerSnapshot.name}</strong><small>{qr.publicCode}</small><p>Escaneá para elegir el acceso interno o de repartidor. Las acciones requieren la autorización correspondiente.</p></div></Modal></div>, document.body)}
  </section>;
}
