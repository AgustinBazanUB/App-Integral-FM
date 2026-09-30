import { useEffect, useState } from "react";
import {
  BadgeCheck,
  Check,
  Grape,
  Leaf,
  MapPin,
  PackageCheck,
  Plus,
  Sprout,
} from "lucide-react";
import { Link } from "../router";
import { assetsManifest } from "../data/assetsManifest";
import { oliveProfileById } from "../data/oliveProfiles";
import { productById } from "../data/products";
import { useCart } from "../context/CartContext";

const intensityOptions = [
  {
    value: "Suave",
    label: "SUAVE",
    Icon: Leaf,
    profileIds: ["arbosana", "arbequina"],
  },
  {
    value: "Intermedio",
    label: "INTERMEDIO",
    Icon: Sprout,
    profileIds: ["blend", "picual"],
  },
  {
    value: "Intenso",
    label: "INTENSO",
    Icon: Grape,
    profileIds: ["coratina", "arauco"],
  },
];

function OilProfileCard({ profile }) {
  const { addItem } = useCart();
  const [feedbackVersion, setFeedbackVersion] = useState(0);
  const product = productById[profile.productId];
  const added = feedbackVersion > 0;
  const unavailable = !product || product.stock === "out" || product.active === false;

  useEffect(() => {
    if (!feedbackVersion) return undefined;
    const timeout = window.setTimeout(() => setFeedbackVersion(0), 1600);
    return () => window.clearTimeout(timeout);
  }, [feedbackVersion]);

  const handleAdd = () => {
    if (unavailable) return;
    addItem(product, {
      format: "500 cc",
      variant: product.attributes?.variety ?? profile.name,
    });
    setFeedbackVersion((current) => current + 1);
  };

  return (
    <article className="fm-variety-card">
      <img
        src={profile.image}
        alt={
          profile.imageStatus === "verified-product"
            ? `Botella real de aceite Flor Mía variedad ${profile.name}`
            : `Fotografía editorial de aceites Flor Mía; imagen específica de ${profile.name} pendiente`
        }
        width="900"
        height="1350"
        loading="lazy"
        decoding="async"
      />
      <div className="fm-variety-card__content">
        <h3>{profile.name}</h3>
        <p>{profile.descriptor ?? "Perfil por validar"}</p>
        <button
          className={`fm-variety-card__add${added ? " is-added" : ""}`}
          type="button"
          onClick={handleAdd}
          disabled={unavailable}
          aria-label={
            unavailable
              ? `${profile.name} no está disponible`
              : added
                ? `${profile.name} agregado al carrito`
                : `Agregar ${profile.name} de 500 cc al carrito`
          }
        >
          {added ? (
            <Check size={15} aria-hidden="true" />
          ) : (
            <Plus size={15} aria-hidden="true" />
          )}
          {unavailable
            ? "NO DISPONIBLE"
            : added
              ? "AGREGADO"
              : "AGREGAR AL CARRITO"}
        </button>
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {added ? `${profile.name} agregado al carrito.` : ""}
        </span>
      </div>
    </article>
  );
}

export default function OliveOilGuide({
  id = "guia-aceites",
  introCta = true,
}) {
  const [selectedIntensity, setSelectedIntensity] = useState("Suave");
  const titleId = `${id}-title`;
  const selectedOption =
    intensityOptions.find((option) => option.value === selectedIntensity) ??
    intensityOptions[0];
  const selectedProfiles = selectedOption.profileIds
    .map((profileId) => oliveProfileById[profileId])
    .filter(Boolean);

  return (
    <section className="fm-oil-guide" id={id} aria-labelledby={titleId}>
      <div className="fm-page fm-oil-guide__layout">
        <div className="fm-oil-guide__intro">
          <img
            className="fm-oil-guide__decor"
            src={assetsManifest.products.oliveOilTrio500cc.src}
            width={assetsManifest.products.oliveOilTrio500cc.width}
            height={assetsManifest.products.oliveOilTrio500cc.height}
            alt=""
            loading="lazy"
            decoding="async"
          />
          <div className="fm-oil-guide__copy">
            <p className="fm-kicker">ACEITES DE OLIVA SELECCIONADOS</p>
            <h2 id={titleId}>
              Elegí el oliva ideal para cada ocasión.
            </h2>
            <p>
              Descubrí nuestras variedades y encontrá el perfil ideal para cada
              momento.
            </p>
            {introCta ? (
              <Link
                className="fm-button fm-button--gold"
                to="/productos?categoria=olive_oil"
              >
                VER TODOS LOS ACEITES
              </Link>
            ) : null}
          </div>
        </div>

        <div className="fm-oil-guide__selector">
          <div className="fm-guide-title">
            <span>GUÍA DE INTENSIDAD</span>
            <i aria-hidden="true" />
          </div>
          <div
            className="fm-intensity"
            role="group"
            aria-label="Filtrar aceites por intensidad"
          >
            {intensityOptions.map(({ value, label, Icon }) => {
              const isActive = selectedIntensity === value;
              return (
                <button
                  className={`fm-intensity__button${isActive ? " is-active" : ""}`}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setSelectedIntensity(value)}
                  key={value}
                >
                  <span className="fm-intensity__label">
                    <Icon size={16} aria-hidden="true" />
                    {label}
                  </span>
                  {isActive ? (
                    <Check
                      className="fm-intensity__selected-icon"
                      size={14}
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            Mostrando aceites de intensidad {selectedIntensity}.
          </p>
          <div className="fm-variety-grid">
            {selectedProfiles.map((profile) => (
              <OilProfileCard profile={profile} key={profile.id} />
            ))}
          </div>
          <ul className="fm-guide-badges" aria-label="Características">
            <li>
              <PackageCheck size={19} aria-hidden="true" /> Productos reales
            </li>
            <li>
              <BadgeCheck size={19} aria-hidden="true" /> Perfiles editables
            </li>
            <li>
              <MapPin size={19} aria-hidden="true" /> Selección mendocina
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
