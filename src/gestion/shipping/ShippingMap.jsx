import { useEffect, useMemo, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./shipping-map.css";

const DEFAULT_CENTER = [-34.6037, -58.3816];
const TILE_URL = import.meta.env.VITE_SHIPPING_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const freshness = 120000;

function validCoordinate(point) {
  return Number.isFinite(point?.lat) && Math.abs(point.lat) <= 90 && Number.isFinite(point?.lng) && Math.abs(point.lng) <= 180;
}

function timestamp(value) {
  const normalized = value?.toDate?.() || value;
  const result = new Date(normalized).valueOf();
  return Number.isFinite(result) ? result : 0;
}

function pointIcon() {
  return L.divIcon({
    className: "fm-shipping-leaflet-icon",
    html: '<span aria-hidden="true">🛵</span>',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

function destinationIcon() {
  return L.divIcon({
    className: "fm-shipping-leaflet-destination-icon",
    html: '<span aria-hidden="true"></span>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

export default function ShippingMap({ position, destination, destinations = [], trail = [], active = false, label = "Ubicación del repartidor", className = "", selectDestination = false, onDestinationChange }) {
  const host = useRef(null), map = useRef(null), courierMarker = useRef(null), destinationMarkers = useRef(new Map()), routeLine = useRef(null), animation = useRef(0), framed = useRef(false), autoFollow = useRef(true);
  const [clock, setClock] = useState(Date.now());
  const current = useMemo(() => validCoordinate(position) && clock - timestamp(position.observedAt) <= freshness && clock - timestamp(position.observedAt) >= -10000, [position, clock]);
  const target = current ? [position.lat, position.lng] : null;
  const destinationPoints = (selectDestination ? [destination] : [destination, ...destinations])
    .filter(point => point && (selectDestination || point.verified === true) && validCoordinate(point));
  const destinationCoordinates = destinationPoints.map(point => [point.lat, point.lng]);
  const verifiedDestination = destinationCoordinates.length > 0;

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectDestination || !onDestinationChange || !map.current) return;
    const choose = event => onDestinationChange({ lat: Number(event.latlng.lat.toFixed(6)), lng: Number(event.latlng.lng.toFixed(6)) });
    map.current.on("click", choose);
    host.current?.classList.add("is-selectable");
    return () => { map.current?.off("click", choose); host.current?.classList.remove("is-selectable"); };
  }, [selectDestination, onDestinationChange]);

  useEffect(() => {
    if (!host.current || map.current) return;
    const instance = L.map(host.current, { zoomControl: false, scrollWheelZoom: false, preferCanvas: true }).setView(DEFAULT_CENTER, 12);
    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
      updateWhenIdle: true,
      keepBuffer: 1,
    }).addTo(instance);
    L.control.zoom({ position: "bottomright" }).addTo(instance);
    instance.on("dragstart", () => { autoFollow.current = false; });
    map.current = instance;
    const resize = window.requestAnimationFrame(() => instance.invalidateSize());
    return () => {
      window.cancelAnimationFrame(resize);
      window.cancelAnimationFrame(animation.current);
      courierMarker.current = null;
      destinationMarkers.current.clear();
      routeLine.current = null;
      framed.current = false;
      autoFollow.current = true;
      instance.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const expectedDestinations = new Set();
    destinationPoints.forEach((point, index) => {
      const key = point.id || `${point.lat}:${point.lng}:${index}`;
      expectedDestinations.add(key);
      const coordinates = [point.lat, point.lng];
      const marker = destinationMarkers.current.get(key);
      if (marker) marker.setLatLng(coordinates);
      else destinationMarkers.current.set(key, L.marker(coordinates, { icon: destinationIcon(), title: selectDestination && !point.verified ? "Punto a verificar" : point.label || "Destino de entrega", alt: point.label || "Destino de entrega" }).addTo(instance));
    });
    for (const [key, marker] of destinationMarkers.current) if (!expectedDestinations.has(key)) { marker.remove(); destinationMarkers.current.delete(key); }

    if (Array.isArray(trail) && trail.length > 1) {
      const coordinates = trail.filter(validCoordinate).slice(-120).map(point => [point.lat, point.lng]);
      if (routeLine.current) routeLine.current.setLatLngs(coordinates);
      else routeLine.current = L.polyline(coordinates, { color: "#718345", weight: 5, opacity: 0.82, lineCap: "round", lineJoin: "round" }).addTo(instance);
    } else if (routeLine.current) {
      routeLine.current.setLatLngs([]);
    }

    if (target) {
      const prior = courierMarker.current?.getLatLng();
      if (!courierMarker.current) courierMarker.current = L.marker(target, { icon: pointIcon(), title: label, alt: label, zIndexOffset: 1000 }).addTo(instance);
      else if (prior && (prior.lat !== target[0] || prior.lng !== target[1])) {
        window.cancelAnimationFrame(animation.current);
        const startedAt = performance.now(), duration = 650;
        const step = now => {
          const ratio = Math.min(1, (now - startedAt) / duration);
          courierMarker.current?.setLatLng([prior.lat + (target[0] - prior.lat) * ratio, prior.lng + (target[1] - prior.lng) * ratio]);
          if (ratio < 1) animation.current = window.requestAnimationFrame(step);
        };
        animation.current = window.requestAnimationFrame(step);
      }
    } else if (courierMarker.current) {
      courierMarker.current.remove();
      courierMarker.current = null;
    }

    const boundsPoints = [...destinationCoordinates, ...(trail || []).filter(validCoordinate).slice(-120).map(point => [point.lat, point.lng]), target].filter(Boolean);
    if (!framed.current && boundsPoints.length > 1) { instance.fitBounds(L.latLngBounds(boundsPoints), { padding: [28, 28], maxZoom: 16 }); framed.current = true; }
    else if (!framed.current && boundsPoints.length === 1) { instance.setView(boundsPoints[0], 15); framed.current = true; }
    else if (!framed.current) { instance.setView(DEFAULT_CENTER, 12); framed.current = true; }
    else if (target && active && autoFollow.current) instance.setView(target, Math.max(instance.getZoom(), 15), { animate: true, duration: 0.45 });
  }, [target?.[0], target?.[1], current, active, destinationPoints.map(point => `${point.id || ""}:${point.lat}:${point.lng}:${point.verified}`).join("|"), trail, label, selectDestination, destination?.verified]);

  const recenter = () => {
    const instance = map.current;
    if (!instance) return;
    const focus = target || destinationCoordinates[0];
    if (focus) { autoFollow.current = true; instance.setView(focus, Math.max(instance.getZoom(), 15), { animate: true }); }
    else instance.setView(DEFAULT_CENTER, 12, { animate: true });
  };

  const mapStatus = selectDestination
    ? ["Punto de entrega", "Tocá el mapa para ubicar el domicilio y confirmá el marcador."]
    : current
      ? [active ? "Ubicación en vivo" : "Última ubicación recibida", `Precisión ±${Math.round(position.accuracy || 0)} m · ${verifiedDestination ? "Destino verificado" : "Destino por confirmar"}`]
      : active
        ? ["Esperando ubicación actual", "La última posición superó los 2 minutos y no se muestra como actual."]
        : verifiedDestination
          ? ["Punto de entrega verificado", "Las coordenadas confirmadas aparecen en el mapa."]
          : ["Punto de entrega pendiente", "El domicilio todavía no tiene coordenadas verificadas."];

  return <section className={`fm-shipping-map-card ${active && current ? "is-live" : ""} ${className}`} aria-label="Mapa de seguimiento">
    <div className="fm-shipping-map-frame">
      <div ref={host} className="fm-shipping-leaflet-map" role="application" aria-label="Mapa interactivo de la entrega" />
      <button type="button" className="fm-shipping-map-center" onClick={recenter}>Centrar mapa</button>
    </div>
    <p className="fm-shipping-map-info" role="status"><strong>{mapStatus[0]}</strong><span>{mapStatus[1]}</span></p>
    <small className="fm-shipping-map-attribution">Mapa © OpenStreetMap contributors · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Informar un problema</a></small>
  </section>;
}
