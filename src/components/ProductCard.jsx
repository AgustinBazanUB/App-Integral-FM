import { useEffect, useState } from "react";
import { Check, Plus } from "lucide-react";
import { Link } from "../router";
import { categoryById } from "../data/categories";
import { getProductAsset } from "../data/assetsManifest";
import { useCart } from "../context/CartContext";
import { useCommerceCatalog } from "../context/CommerceCatalogContext";
import { formatPrice } from "../utils/format";

export default function ProductCard({ product, compact = false }) {
  const { addItem } = useCart();
  const { resolveProduct } = useCommerceCatalog();
  const [added, setAdded] = useState(false);
  const commercial = resolveProduct(product);
  const display = commercial || product;
  const category = categoryById[display.categoryId];
  const imageAsset = getProductAsset(display.editorialId || display.id);
  const price = formatPrice(commercial?.price);
  const compareAtPrice = formatPrice(commercial?.compareAtPrice);
  const hasPromotion = Boolean(commercial?.promotionName && compareAtPrice && commercial.compareAtPrice > commercial.price);
  const unavailable = !commercial || commercial.commercialReady !== true || commercial.active === false;
  const unavailableLabel = commercial?.stockState === "out" ? "SIN STOCK" : "NO DISPONIBLE";
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
          <>
            <img
              className="product-card__image"
              src={display.image}
              width={display.imageWidth ?? imageAsset?.width ?? 900}
              height={display.imageHeight ?? imageAsset?.height ?? 900}
              alt={display.imageAlt ?? display.name}
              loading="lazy"
              decoding="async"
            />
            {display.imageHover && display.imageHover !== display.image ? (
              <img
                className="product-card__image product-card__image--hover"
                src={display.imageHover}
                width={display.imageWidth ?? imageAsset?.width ?? 900}
                height={display.imageHeight ?? imageAsset?.height ?? 900}
                alt=""
                loading="lazy"
                decoding="async"
              />
            ) : null}
          </>
        ) : (
          <span className="product-card__image-missing" role="img" aria-label={`Sin fotografía disponible para ${display.name}`}>
            Imagen pendiente
          </span>
        )}
      </Link>

      <div className="product-card__content">
        {compact ? (
          <span className="product-card__category">
            {category?.name ?? display.categoryName ?? display.subcategory}
          </span>
        ) : null}
        <h3>
          <Link to={`/producto/${commercial?.slug || display.slug}`}>{display.name}</Link>
        </h3>
        {compact ? <p className="product-card__description">{display.description}</p> : null}

        {format ? <span className="product-card__format-text">{format}</span> : null}
        {hasPromotion ? <span className="product-card__promotion">{commercial.promotionName}</span> : null}

        <div className="product-card__purchase">
          <div className="product-card__pricing">
            {price ? <strong>{price}</strong> : <span className="product-card__price-pending">Precio no disponible</span>}
            {hasPromotion ? <s>{compareAtPrice}</s> : null}
          </div>
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
            {unavailable ? unavailableLabel : added ? "AGREGADO" : "AGREGAR"}
          </button>
        </div>
      </div>
    </article>
  );
}
