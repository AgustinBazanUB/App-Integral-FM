import { useEffect, useState } from "react";
import { TRANSPORTS } from "../../shared/shippingDomain.mjs";

export function ShipmentQrImage({ lookupId, className = "" }) {
  const [src, setSrc] = useState("");
  useEffect(() => { let live = true; setSrc("");
    import("qrcode").then(module => (module.default || module).toDataURL(`${window.location.origin}/e/${lookupId}`, { width: 240, margin: 4, errorCorrectionLevel: "M" })).then(value => live && setSrc(value)).catch(() => {});
    return () => { live = false; };
  }, [lookupId]);
  return src ? <img className={className} src={src} width="120" height="120" alt="QR del pedido" /> : <span className="fm-shipping-muted">Cargando QR…</span>;
}
export default function ShippingLabelSheet({ shipments }) {
  return <div className="fm-label-sheet" aria-label="Vista previa de las etiquetas seleccionadas">{shipments.map(row => <article key={row.id} className="fm-label-sample">
    <div className="fm-label-zone"><strong>{row.destination.verified ? `${row.destination.provinceOrCaba || ""} (${row.destination.neighborhoodOrLocality || "Zona verificada"})` : "ZONA POR CONFIRMAR"}</strong><ShipmentQrImage lookupId={row.publicLookupId} /><span className="fm-label-code">{row.publicCode}</span></div>
    <div className="fm-label-data"><strong>{row.customerSnapshot.name}</strong><p>Tel: {row.customerSnapshot.phone}</p><p>Dirección: {row.destination.displayAddress}</p><p>Observaciones: {row.destination.notes || "No hay observaciones"}</p><p>Pedido: {row.itemsSnapshot.map(item => `${item.qty} × ${item.name}`).join("; ")}</p></div>
    <div className="fm-label-meta"><strong>{new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(row.saleCreatedAt?.toDate?.() || row.saleCreatedAt || row.createdAt?.toDate?.() || row.createdAt))}</strong><p>Prepara: {row.preparerNames.join(", ")}</p><p>{TRANSPORTS[row.deliveryType] || "Por asignar"}</p><strong>FLOR MÍA</strong></div>
  </article>)}<p className="fm-shipping-muted">Vista de la selección. El PDF ajusta los tamaños y los saltos de página al generar las etiquetas.</p></div>;
}
