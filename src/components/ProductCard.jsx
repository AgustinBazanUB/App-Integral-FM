import { useEffect, useState } from "react";
import { Check, Plus } from "lucide-react";
import { Link } from "../router";
import { categoryById } from "../data/categories";
import { getProductAsset } from "../data/assetsManifest";
import { useCart } from "../context/CartContext";

function formatPrice(price) {
  if (typeof price !== "number") return null;
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(price);
}

export default function ProductCard({ product, compact = false }) {
  const { addItem } = useCart();
  const [format, setFormat] = useState(product.formats?.[0] ?? "");
  const [added, setAdded] = useState(false);
  const category = categoryById[product.categoryId];
  const imageAsset = getProductAsset(product.id);
  const price = formatPrice(product.price);
  const unavailable = product.stock === "out" || product.active === false;

  useEffect(() => {
    if (!added) return undefined;
    const timeout = window.setTimeout(() => setAdded(false), 1600);
    return () => window.clearTimeout(timeout);
  }, [added]);

  const onAdd = () => {
    if (unavailable) return;
    addItem(product, {
      format,
      variant:
        product.attributes?.variety ?? product.attributes?.flavor ?? "",
    });
    setAdded(true);
  };

  return (
    <article className={`product-card${compact ? " product-card--compact" : ""}`}>
      <Link
        to={`/producto/${product.slug}`}
        className="product-card__image-link"
        aria-label={`Ver ${product.name}`}
      >
        {product.image ? (
          <img
            className="product-card__image"
            src={product.image}
            width={product.imageWidth ?? imageAsset?.width ?? 900}
            height={product.imageHeight ?? imageAsset?.height ?? 900}
            alt={product.imageAlt ?? product.name}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="product-card__image-missing" role="img" aria-label={`Sin fotografía disponible para ${product.name}`}>
            Imagen pendiente
          </span>
        )}
      </Link>

      <div className="product-card__content">
        <span className="product-card__category">
          {category?.name ?? product.subcategory}
        </span>
        <h3>
          <Link to={`/producto/${product.slug}`}>{product.name}</Link>
        </h3>
        <p className="product-card__description">{product.description}</p>

        {!compact && product.formats?.length > 1 ? (
          <label className="field-label product-card__format">
            Presentación
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value)}
              aria-label={`Presentación de ${product.name}`}
            >
              {product.formats.map((option) => (
                <option value={option} key={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        ) : format ? (
          <span className="product-card__format-text">{format}</span>
        ) : null}

        <div className="product-card__purchase">
          {price ? <strong>{price}</strong> : <span aria-hidden="true" />}
          <button
            className={`product-card__add${added ? " is-added" : ""}`}
            type="button"
            onClick={onAdd}
            disabled={unavailable}
            aria-label={
              unavailable
                ? `${product.name} no está disponible`
                : `Agregar ${product.name} al carrito`
            }
          >
            {added ? <Check size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
            {unavailable ? "SIN STOCK" : added ? "AGREGADO" : "AGREGAR"}
          </button>
        </div>
      </div>
    </article>
  );
}
