import { useEffect, useState } from "react";
import { Check, Plus } from "lucide-react";
import { Link } from "../router";
import { categoryById } from "../data/categories";
import { getProductAsset } from "../data/assetsManifest";
import { useCart } from "../context/CartContext";
import { useCommerceCatalog } from "../context/CommerceCatalogContext";

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
  const { resolveProduct } = useCommerceCatalog();
  const [added, setAdded] = useState(false);
  const commercial = resolveProduct(product);
  const display = commercial || product;
  const category = categoryById[display.categoryId];
  const imageAsset = getProductAsset(display.editorialId || display.id);
  const price = formatPrice(commercial?.price);
  const unavailable = !commercial || commercial.commercialReady !== true || commercial.active === false;
  const format = display.formats?.[0] ?? "";

  useEffect(() => {
    if (!added) return undefined;
    const timeout = window.setTimeout(() => setAdded(false), 1600);
    return () => window.clearTimeout(timeout);
  }, [added]);

  const onAdd = () => {
    if (unavailable) return;
    if (addItem(commercial)) setAdded(true);
  };

  return (
    <article className={`product-card${compact ? " product-card--compact" : ""}`}>
      <Link
        to={`/producto/${commercial?.slug || display.slug}`}
        className="product-card__image-link"
        aria-label={`Ver ${display.name}`}
      >
        {display.image ? (
          <img
            className="product-card__image"
            src={display.image}
            width={display.imageWidth ?? imageAsset?.width ?? 900}
            height={display.imageHeight ?? imageAsset?.height ?? 900}
            alt={display.imageAlt ?? display.name}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="product-card__image-missing" role="img" aria-label={`Sin fotografía disponible para ${display.name}`}>
            Imagen pendiente
          </span>
        )}
      </Link>

      <div className="product-card__content">
        <span className="product-card__category">
          {category?.name ?? display.categoryName ?? display.subcategory}
        </span>
        <h3>
          <Link to={`/producto/${commercial?.slug || display.slug}`}>{display.name}</Link>
        </h3>
        <p className="product-card__description">{display.description}</p>

        {format ? <span className="product-card__format-text">{format}</span> : null}

        <div className="product-card__purchase">
          {price ? <strong>{price}</strong> : <span>Precio no disponible</span>}
          <button
            className={`product-card__add${added ? " is-added" : ""}`}
            type="button"
            onClick={onAdd}
            disabled={unavailable}
            aria-label={
              unavailable
                ? `${display.name} no está disponible`
                : `Agregar ${display.name} al carrito`
            }
          >
            {added ? <Check size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
            {unavailable ? "NO DISPONIBLE" : added ? "AGREGADO" : "AGREGAR"}
          </button>
        </div>
      </div>
    </article>
  );
}
