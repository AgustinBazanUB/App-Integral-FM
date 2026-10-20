import { useEffect, useId, useState } from "react";
import { deliveryJourney } from "./deliveryJourney.mjs";
import "./shipping-journey.css";

const bikePosition = (repository, scene) => {
  const positions = repository
    ? { received: 145, preparing: 145, ready: 155, "to-repository": 310, "at-repository": 540, "to-customer": 585, delivered: 575, paused: 155 }
    : { preparing: 145, ready: 155, "to-customer": 500, delivered: 575, paused: 155 };
  return positions[scene] ?? positions.preparing;
};

function Motorcycle({ x, moving, delivered, showParcel }) {
  return <g className={`fm-journey__motorcycle ${moving ? "is-moving" : ""}`} transform={`translate(${x} 259)`} aria-hidden="true">
    <circle className="fm-journey__wheel" cx="-22" cy="0" r="17" />
    <circle className="fm-journey__wheel" cx="35" cy="0" r="17" />
    <circle cx="-22" cy="0" r="7" fill="#e9dfce" />
    <circle cx="35" cy="0" r="7" fill="#e9dfce" />
    <path d="M-22 0l19-25 23 2 15 23H-22l17-22m25 0 9-18 12 1" fill="none" stroke="#475550" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M-4-20l18 0 7 17H-15z" fill="#bc8a36" />
    <path d="M2-25l-5-21 21-2 12 24" fill="none" stroke="#a56f59" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="-4" cy="-56" r="12" fill="#e9b18b" />
    <path d="M-16-59q2-18 19-14 11 3 9 15z" fill="#9e6d59" />
    <path d="M1-28l19 8 9 20" fill="none" stroke="#e9b18b" strokeWidth="8" strokeLinecap="round" />
    {showParcel && <g className="fm-journey__parcel"><rect x="10" y="-49" width="25" height="25" rx="4" fill="#c89453" /><path d="M14-44h17m-9-5v25" stroke="#f1d8ae" strokeWidth="2" /></g>}
  </g>;
}

export default function AnimatedDeliveryJourney({ status, deliveryType = "manual", incident = false, className = "" }) {
  const id = useId();
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const updateVisibility = () => setVisible(document.visibilityState !== "hidden");
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);
  const repository = deliveryType === "repository";
  const journey = deliveryJourney(deliveryType, status);
  if (incident && !journey.exception) {
    journey.message = "El envío está en pausa mientras Flor Mía resuelve una incidencia.";
    journey.inMotion = false;
    journey.exception = true;
  }
  const progress = journey.index < 0 ? 0 : journey.steps.length <= 1 ? 0 : (journey.index / (journey.steps.length - 1)) * 100;
  const x = bikePosition(repository, journey.scene);
  const showParcelOnMotorcycle = ["ready", "to-repository", "to-customer"].includes(journey.scene);
  return <section className={`fm-delivery-journey ${className}`} data-stage={journey.scene} data-visible={visible ? "true" : "false"} data-exception={journey.exception ? "true" : "false"} aria-label="Seguimiento ilustrativo del envío">
    <header className="fm-delivery-journey__heading">
      <div><strong>{journey.message}</strong><span>Seguimiento ilustrativo del envío</span></div>
      <img className="fm-delivery-journey__logo" src="/images/flor-mia/logo-flor-mia.svg" alt="Flor Mía" />
    </header>
    <div className="fm-delivery-journey__scene">
      <svg viewBox="0 0 800 320" role="img" aria-labelledby={`${id}-title ${id}-description`} focusable="false">
        <title id={`${id}-title`}>Recorrido ilustrativo de Flor Mía al domicilio</title>
        <desc id={`${id}-description`}>Escena animada con el local Flor Mía, {repository ? "un repositorio intermedio y " : ""}una moto de reparto y el domicilio del cliente. La posición de la moto representa la etapa confirmada del pedido, no una ubicación GPS.</desc>
        <rect width="800" height="320" rx="28" fill="#f3ead8" />
        <circle cx="658" cy="67" r="25" fill="#f1ce78" />
        <path d="M0 225q42-28 82 0 38-30 77 0 38-22 77 0 43-25 82 0 43-22 82 0 48-23 96 0 40-26 82 0 53-23 122 0v39H0z" fill="#dfe4d3" />
        <g className="fm-journey__trees" fill="#9eae91">
          <circle cx="53" cy="194" r="23"/><circle cx="77" cy="180" r="29"/><circle cx="99" cy="198" r="21"/>
          <circle cx="711" cy="192" r="25"/><circle cx="739" cy="178" r="30"/><circle cx="763" cy="197" r="21"/>
        </g>
        <path d="M0 241h800v79H0z" fill="#cbbda5" />
        <path d="M0 274h800" stroke="#fffaf0" strokeWidth="6" strokeDasharray="42 32" />
        <g className="fm-journey__store">
          <rect x="55" y="143" width="160" height="116" rx="8" fill="#f5c99d" stroke="#c6946d" strokeWidth="3" />
          <path d="M43 143l24-52h136l24 52z" fill="#b87861" />
          <path d="M43 143h184v20H43z" fill="#e7a686" />
          <rect x="121" y="189" width="39" height="70" fill="#987254" />
          <rect x="75" y="182" width="25" height="25" rx="5" fill="#fff1dc" />
          <text x="135" y="126" textAnchor="middle" fill="#fffaf1" fontSize="20" fontWeight="700" fontFamily="Arial, sans-serif">FLOR MÍA</text>
          <text x="135" y="300" textAnchor="middle" fill="#4e493f" fontSize="13" fontWeight="600" fontFamily="Arial, sans-serif">Flor Mía</text>
        </g>
        {repository && <g className="fm-journey__repository">
          <rect x="386" y="169" width="135" height="90" rx="6" fill="#d4b07f" stroke="#ae895b" strokeWidth="3" />
          <path d="M374 169l79-47 80 47z" fill="#aa7958" />
          <rect x="435" y="206" width="34" height="53" fill="#8b6c4e" />
          <path d="M402 184h28v24h-28zM477 184h28v24h-28z" fill="#f5e5ca" />
          <text x="453" y="300" textAnchor="middle" fill="#4e493f" fontSize="13" fontWeight="600" fontFamily="Arial, sans-serif">Repositorio</text>
        </g>}
        <g className="fm-journey__home">
          <path d="M602 151l78-62 78 62-14 17-64-51-64 51z" fill="#a97d62" />
          <rect x="619" y="158" width="122" height="101" rx="9" fill="#ead2b7" />
          <rect x="649" y="205" width="34" height="54" fill="#a98568" />
          <rect x="699" y="179" width="22" height="22" fill="#adc4bc" />
          <text x="680" y="300" textAnchor="middle" fill="#4e493f" fontSize="13" fontWeight="600" fontFamily="Arial, sans-serif">Tu domicilio</text>
        </g>
        {["received", "preparing"].includes(journey.scene) && <g className={`fm-journey__preparing-parcel ${journey.scene === "preparing" ? "is-preparing" : ""}`} aria-hidden="true"><rect x="177" y="199" width="24" height="24" rx="4" fill="#c89453"/><path d="M181 204h16m-8-5v24" stroke="#f1d8ae" strokeWidth="2"/></g>}
        {journey.scene === "at-repository" && <g className="fm-journey__repository-parcel" aria-hidden="true"><rect x="473" y="230" width="21" height="21" rx="4" fill="#c89453"/><path d="M477 235h13m-6-5v21" stroke="#f1d8ae" strokeWidth="2"/></g>}
        <Motorcycle x={x} moving={journey.inMotion && visible} delivered={journey.scene === "delivered"} showParcel={showParcelOnMotorcycle} />
        {journey.scene === "delivered" && <><g className="fm-journey__delivered-package"><rect x="684" y="226" width="22" height="24" rx="4" fill="#c89453"/><path d="M688 232h14m-7-6v23" stroke="#f1d8ae" strokeWidth="2"/></g><g className="fm-journey__delivered-mark"><circle cx="720" cy="136" r="17" fill="#79a48c"/><path d="m712 136 6 6 11-13" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></g></>}
      </svg>
    </div>
    <div className="fm-delivery-journey__endpoints" aria-hidden="true"><span>Flor Mía</span><span>{repository ? "Repositorio · Domicilio" : "Tu domicilio"}</span></div>
    <div className="fm-delivery-journey__track" role="progressbar" aria-label="Avance confirmado del envío" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress)}>
      <span className="fm-delivery-journey__track-fill" style={{ width: `${progress}%` }} />
      <span className="fm-delivery-journey__track-bike" style={{ left: `${progress}%` }} aria-hidden="true"><svg viewBox="0 0 32 24"><circle cx="7" cy="17" r="5"/><circle cx="25" cy="17" r="5"/><path d="m7 17 7-9 5 9H7l7-9m5 0h4l2 4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/><circle cx="17" cy="4" r="3"/><path d="m16 8 5 3-2 5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
    </div>
    <ol className="fm-delivery-journey__steps" aria-label="Etapas del envío">
      {journey.steps.map((step, index) => <li key={step} className={journey.index < 0 ? "" : index < journey.index || status === "entregado" ? "is-done" : index === journey.index ? "is-current" : ""} aria-current={!journey.exception && index === journey.index ? "step" : undefined}><span aria-hidden="true" />{step}</li>)}
    </ol>
    <p className="fm-delivery-journey__caption">Ilustración de la etapa confirmada. No muestra una ubicación real ni utiliza GPS.</p>
  </section>;
}
