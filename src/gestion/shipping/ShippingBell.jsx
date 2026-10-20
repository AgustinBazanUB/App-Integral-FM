import { useEffect, useRef, useState } from "react";
import { subscribeShippingNotifications, readShippingNotification } from "../services/shippingService";
import { Icon } from "../components/icons";
import AnchoredPopover from "../components/AnchoredPopover";
import { Link } from "../../router";
import "./shipping.css";

export default function ShippingBell({ profile, seller = false }) {
  const [rows, setRows] = useState([]), [open, setOpen] = useState(false), [error, setError] = useState("");
  const trigger = useRef(null);
  useEffect(() => subscribeShippingNotifications(profile, rows => { setError(""); setRows(rows.sort((a, b) => Number(b.severity === "critical") - Number(a.severity === "critical") || new Date(b.createdAt?.toDate?.() || b.createdAt) - new Date(a.createdAt?.toDate?.() || a.createdAt))); }, error => setError(error.message)), [profile.id]);
  const unread = rows.filter(row => !row.read).length;
  return <div className="fm-shipping-bell"><button type="button" ref={trigger} className="fm-icon-button fm-icon-button--secondary" aria-label={`Notificaciones de envíos, ${unread} sin leer`} aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="Bell" />{unread > 0 && <b>{unread}</b>}</button>
    <AnchoredPopover open={open} onClose={() => setOpen(false)} triggerRef={trigger} ariaLabel="Notificaciones de envíos" className="fm-shipping-notifications">
      <h3>Notificaciones</h3>{error && <p role="alert">No se pudieron cargar los avisos.</p>}{!rows.length && !error && <p>No tenés novedades de envíos.</p>}
      {rows.slice(0, 60).map(row => <Link key={row.id} to={seller ? `/vendedor?view=shipping-tasks&shipment=${row.entityId}` : row.href} className={`${row.severity === "critical" ? "is-critical" : ""} ${!row.read ? "is-unread" : ""}`} onClick={() => { readShippingNotification(row.id).catch(error => setError(error.message)); setOpen(false); }}><strong>{row.title}</strong><small>{row.description}</small></Link>)}
    </AnchoredPopover>
  </div>;
}
