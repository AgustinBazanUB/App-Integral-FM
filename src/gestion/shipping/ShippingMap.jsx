import { useEffect, useRef } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./shipping-map.css";

const DEFAULT_CENTER = [-34.6037, -58.3816];
const TILE_URL = import.meta.env.VITE_SHIPPING_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

function validCoordinate(point) {
  return Number.isFinite(point?.lat) && Math.abs(point.lat) <= 90 && Number.isFinite(point?.lng) && Math.abs(point.lng) <= 180;
}

function destinationIcon() {
  return L.divIcon({
    className: "fm-shipping-leaflet-destination-icon",
    html: '<span aria-hidden="true"></span>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

export default function ShippingMap({ destination, selectDestination = false, onDestinationChange }) {
  const host = useRef(null), map = useRef(null), marker = useRef(null), selected = useRef(null);
  selected.current = destination;

  useEffect(() => {
    if (!host.current || map.current) return undefined;
    const initial = validCoordinate(selected.current) ? [selected.current.lat, selected.current.lng] : DEFAULT_CENTER;
    const instance = L.map(host.current, { zoomControl: false, scrollWheelZoom: false, preferCanvas: true }).setView(initial, validCoordinate(selected.current) ? 15 : 12);
    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
      updateWhenIdle: true,
      keepBuffer: 1,
    }).addTo(instance);
    L.control.zoom({ position: "bottomright" }).addTo(instance);
    map.current = instance;
    const resize = window.requestAnimationFrame(() => instance.invalidateSize());
    return () => {
      window.cancelAnimationFrame(resize);
      marker.current = null;
      instance.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const hasDestination = validCoordinate(destination);
    if (hasDestination) {
      const coordinates = [destination.lat, destination.lng];
      if (marker.current) marker.current.setLatLng(coordinates);
      else marker.current = L.marker(coordinates, { icon: destinationIcon(), title: "Punto de entrega", alt: "Punto de entrega" }).addTo(instance);
      if (selectDestination) instance.setView(coordinates, Math.max(instance.getZoom(), 15), { animate: false });
    } else if (marker.current) {
      marker.current.remove();
      marker.current = null;
    }
  }, [destination?.lat, destination?.lng, selectDestination]);

  useEffect(() => {
    const instance = map.current;
    if (!selectDestination || !onDestinationChange || !instance) return undefined;
    const choose = event => onDestinationChange({ lat: Number(event.latlng.lat.toFixed(6)), lng: Number(event.latlng.lng.toFixed(6)) });
    instance.on("click", choose);
    host.current?.classList.add("is-selectable");
    return () => { instance.off("click", choose); host.current?.classList.remove("is-selectable"); };
  }, [selectDestination, onDestinationChange]);

  const recenter = () => {
    const instance = map.current;
    if (!instance) return;
    instance.setView(validCoordinate(destination) ? [destination.lat, destination.lng] : DEFAULT_CENTER, validCoordinate(destination) ? 15 : 12, { animate: true });
  };

  return <section className="fm-shipping-map-card fm-shipping-address-map" aria-label="Selector del punto de entrega">
    <div className="fm-shipping-map-frame">
      <div ref={host} className="fm-shipping-leaflet-map" role="application" aria-label="Mapa para ubicar manualmente el domicilio" />
      <button type="button" className="fm-shipping-map-center" onClick={recenter}>Centrar punto</button>
    </div>
    <p className="fm-shipping-map-info"><strong>Punto del domicilio</strong><span>{selectDestination ? "Tocá el mapa para ubicar el destino. No se consulta la ubicación del repartidor." : "Marcador de destino guardado."}</span></p>
    <small className="fm-shipping-map-attribution">Mapa © OpenStreetMap contributors · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Informar un problema</a></small>
  </section>;
}
