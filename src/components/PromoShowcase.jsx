import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Reveal from "./Reveal";
import { Link } from "../router";
import { useCommerceCatalog } from "../context/CommerceCatalogContext";
import { useCart } from "../context/CartContext";
import { formatPrice } from "../utils/format";

export default function PromoShowcase({ promoType = null }) {
  const { addItem, openCart } = useCart();
  const { products } = useCommerceCatalog();
  const carouselRef = useRef(null);
  const [canScroll, setCanScroll] = useState({ left: false, right: false });
  const promotedProducts = products.filter(
    (product) =>
      product.active !== false &&
      product.promotionName &&
      typeof product.compareAtPrice === "number" &&
      typeof product.price === "number" &&
      product.compareAtPrice > product.price &&
      (!promoType || (product.promoType || (product.categoryId === "olive_oil" ? "oil" : "products")) === promoType),
  );

  useEffect(() => {
    const viewport = carouselRef.current;
    if (!viewport) return undefined;
    const update = () => setCanScroll({
      left: viewport.scrollLeft > 1,
      right: viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 1,
    });
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    viewport.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", update);
    };
  }, [promotedProducts.length]);

  if (!promotedProducts.length) return null;

  const scroll = (direction) => {
    const viewport = carouselRef.current;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    viewport.scrollBy({ left: direction * viewport.clientWidth, behavior: reduceMotion ? "auto" : "smooth" });
  };

  const onAdd = (product) => {
    if (addItem(product)) openCart();
  };

  return (
    <Reveal
      as="section"
      className="fm-promo-carousel"
      id="promociones"
      aria-labelledby="promo-carousel-title"
    >
      <div className="fm-page">
        <div className="fm-rule-heading">
          <span aria-hidden="true" />
          <h2 id="promo-carousel-title">NUESTRAS PROMOCIONES</h2>
          <span aria-hidden="true" />
        </div>

        <div className="fm-promo-carousel__wrapper">
          <button
            className="fm-promo-carousel__nav fm-promo-carousel__nav--left"
            type="button"
            onClick={() => scroll(-1)}
            disabled={!canScroll.left}
            aria-label="Ver promociones anteriores"
          >
            <ChevronLeft size={24} aria-hidden="true" />
          </button>

          <div className="fm-promo-carousel__grid" ref={carouselRef}>
            <div className="fm-promo-carousel__track">
              {promotedProducts.map((product) => (
                <article className="fm-promo-card" key={product.id}>
                  <div className="fm-promo-card__media">
                    <span className="fm-promo-card__sticker">{product.promotionName}</span>
                    <Link
                      to={`/producto/${product.slug}`}
                      aria-label={`Ver ${product.name}`}
                    >
                      {product.image ? <img
                        src={product.image}
                        alt={product.imageAlt ?? product.name}
                        loading="lazy"
                        decoding="async"
                      /> : null}
                      {product.imageHover && product.imageHover !== product.image ? (
                        <img
                          className="fm-promo-card__media--hover"
                          src={product.imageHover}
                          alt=""
                          aria-hidden="true"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : null}
                    </Link>
                  </div>
                  <div className="fm-promo-card__content">
                    <h3>
                      <Link to={`/producto/${product.slug}`}>{product.name}</Link>
                    </h3>
                    <div className="fm-promo-card__prices">
                      <strong>{formatPrice(product.price)}</strong>
                      <s>{formatPrice(product.compareAtPrice)}</s>
                    </div>
                    <button
                      className="fm-button fm-button--gold fm-button--block"
                      type="button"
                      onClick={() => onAdd(product)}
                      disabled={!product.commercialReady}
                      aria-label={`Agregar ${product.name} al carrito`}
                    >
                      <Plus size={16} aria-hidden="true" />
                      {product.commercialReady ? "Agregar" : "No disponible"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <button
            className="fm-promo-carousel__nav fm-promo-carousel__nav--right"
            type="button"
            onClick={() => scroll(1)}
            disabled={!canScroll.right}
            aria-label="Ver más promociones"
          >
            <ChevronRight size={24} aria-hidden="true" />
          </button>
        </div>
      </div>
    </Reveal>
  );
}
