import { lazy, Suspense, useEffect, useId, useState } from "react";
import { Bike, Check, Clock3, House, Package, PackageCheck, Store, Warehouse } from "lucide-react";
import { deliveryJourney } from "./deliveryJourney.mjs";
import sceneImage from "./assets/shipping-scene.webp";
import "./shipping-journey.css";

const RiderAnimation = lazy(() => import("./DeliveryRiderAnimation.jsx"));
const CHECKPOINT_ICONS = { store: Store, package: PackageCheck, bike: Bike, warehouse: Warehouse, home: House };
const RIDER_POSITION = { ready: 29, "to-repository": 53, "to-customer": 77, delivered: 87 };
const RIDER_SCENES = new Set(Object.keys(RIDER_POSITION));

function useMotionPreferences() {
  const [preferences, setPreferences] = useState({ visible: true, reduced: false });
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPreferences({ visible: document.visibilityState !== "hidden", reduced: query.matches });
    update();
    document.addEventListener("visibilitychange", update);
    query.addEventListener?.("change", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      query.removeEventListener?.("change", update);
    };
  }, []);
  return preferences;
}

function Checkpoint({ checkpoint, done }) {
  const Icon = CHECKPOINT_ICONS[checkpoint.icon] || Package;
  return <li className={done ? "is-done" : "is-pending"} data-checkpoint={checkpoint.id}>
    <span className="fm-delivery-journey__checkpoint-icon" aria-hidden="true">{done ? <Check /> : <Icon />}</span>
    <span className="fm-delivery-journey__checkpoint-label">{checkpoint.label}</span>
  </li>;
}

export default function AnimatedDeliveryJourney({ status, deliveryType = "manual", incident = false, className = "" }) {
  const id = useId();
  const { visible, reduced } = useMotionPreferences();
  const repository = deliveryType === "repository";
  const journey = deliveryJourney(deliveryType, status);
  if (incident && !journey.exception) {
    journey.message = "El envío está en pausa mientras Flor Mía resuelve una incidencia.";
    journey.activePhase = null;
    journey.inMotion = false;
    journey.exception = true;
  }

  const showCourier = RIDER_SCENES.has(journey.scene);
  const riderPlaying = visible && !reduced && !journey.exception && journey.scene !== "delivered";
  const riderPosition = RIDER_POSITION[journey.scene] ?? RIDER_POSITION.ready;
  const packageAt = journey.packageAt || (journey.scene === "preparing" ? "store" : journey.scene === "waiting-courier" ? "repository" : null);
  const hasActivePhase = Boolean(journey.activePhase) && !journey.exception;

  return <section className={`fm-delivery-journey ${className}`} data-stage={journey.scene} data-visible={visible ? "true" : "false"} data-exception={journey.exception ? "true" : "false"} aria-label="Seguimiento ilustrativo del envío">
    <header className="fm-delivery-journey__heading">
      <div><span className="fm-delivery-journey__eyebrow">Seguimiento de tu pedido</span><strong>{journey.message}</strong></div>
      <span className="fm-delivery-journey__brand" aria-hidden="true"><span>F</span><span>Flor Mía</span></span>
    </header>

    <div className={`fm-delivery-journey__scene ${journey.inMotion ? "is-moving" : ""}`} aria-labelledby={`${id}-scene-title`}>
      <img className="fm-delivery-journey__backdrop" src={sceneImage} alt="" aria-hidden="true" draggable="false" />
      <span id={`${id}-scene-title`} className="sr-only">Ilustración del local Flor Mía, el barrio y el domicilio del cliente</span>
      <span className="fm-delivery-journey__place place-store">Flor Mía</span>
      {repository && <span className="fm-delivery-journey__place place-repository"><Warehouse aria-hidden="true" /> Repositorio</span>}
      <span className="fm-delivery-journey__place place-home"><House aria-hidden="true" /> Tu domicilio</span>
      {["store", "repository", "home"].includes(packageAt) && <span className={`fm-delivery-journey__parcel at-${packageAt} ${journey.scene === "preparing" ? "is-preparing" : ""}`} aria-hidden="true"><Package /></span>}
      {showCourier && <div className={`fm-delivery-journey__courier ${journey.inMotion ? "is-moving" : "is-parked"}`} style={{ "--rider-position": `${riderPosition}%` }} aria-hidden="true">
        <Suspense fallback={<span className="fm-delivery-journey__courier-fallback" />}>
          <RiderAnimation key={`${journey.inMotion ? "ride" : "idle"}-${journey.scene}`} playing={riderPlaying} speed={journey.inMotion ? 1.2 : 0.72} />
        </Suspense>
      </div>}
      {journey.scene === "delivered" && <span className="fm-delivery-journey__arrival" aria-hidden="true"><Check /></span>}
      <span className="fm-delivery-journey__scene-wash" aria-hidden="true" />
    </div>

    <ol className={`fm-delivery-journey__checkpoints ${repository ? "is-repository" : "is-direct"}`} aria-label="Hitos confirmados del envío">
      {journey.checkpoints.map((checkpoint, index) => <Checkpoint key={checkpoint.id} checkpoint={checkpoint} done={index < journey.completedCount} />)}
    </ol>

    <div className={`fm-delivery-journey__active ${journey.exception ? "is-paused" : hasActivePhase ? "is-active" : "is-complete"}`} role="status" aria-live="polite">
      <span className="fm-delivery-journey__active-icon" aria-hidden="true">{journey.exception ? <Clock3 /> : hasActivePhase ? <Package /> : <Check />}</span>
      <div className="fm-delivery-journey__active-copy">
        <span className="fm-delivery-journey__active-kicker">{journey.exception ? "Atención" : hasActivePhase ? "Ahora" : "Estado final"}</span>
        <strong>{journey.exception ? "En pausa" : journey.activePhase?.label || "Pedido entregado"}</strong>
        <span>{journey.exception ? journey.message : journey.activePhase?.detail || "La entrega quedó confirmada."}</span>
      </div>
      {hasActivePhase && <div className="fm-delivery-journey__loading" role="progressbar" aria-label={journey.activePhase.label} aria-valuetext="En progreso"><span /></div>}
    </div>

    <p className="fm-delivery-journey__caption">Los hitos avanzan cuando Flor Mía registra cada etapa. La ilustración no representa una ubicación real ni utiliza GPS.</p>
  </section>;
}
