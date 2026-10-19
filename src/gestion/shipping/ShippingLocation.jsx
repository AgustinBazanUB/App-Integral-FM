import { Icon } from "../components/icons";
import { formatDateTime } from "../formatters";

export default function ShippingLocation({ position, final = false, customer = false }) {
  const observed = position?.observedAt?.toDate?.() || position?.observedAt;
  const fresh = final && observed && Date.now() - new Date(observed).valueOf() <= 120000;
  return <div className="fm-shipping-location">
    <div className={`fm-shipping-location-surface ${fresh ? "has-position" : ""}`}>
      <Icon name="MapPin" /><strong>{fresh ? "Última ubicación recibida" : final ? "Esperando ubicación del repartidor" : "Seguimiento del envío"}</strong>
      <p>{fresh ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}` : final ? "La posición aparecerá cuando el repartidor comparta su ubicación." : "La ubicación se comparte durante el camino al domicilio."}</p>
      {fresh && <a className="fm-button fm-button--secondary" href={`https://www.google.com/maps/search/?api=1&query=${position.lat},${position.lng}`} target="_blank" rel="noreferrer">Ver ubicación real en Google Maps</a>}
    </div>
    <div className="fm-shipping-position-stats"><div><strong>{fresh ? formatDateTime(observed) : "Sin señal activa"}</strong><small>Última posición</small></div><div><strong>{fresh ? `±${Math.round(position.accuracy)} m` : "—"}</strong><small>Precisión GPS</small></div><div><strong>{fresh ? "Ubicación disponible" : "Ubicación no disponible"}</strong><small>{customer ? "Sólo la ubicación permitida para tu pedido." : "Sólo se conserva la última posición compartida."}</small></div></div>
  </div>;
}
