import { Plus } from "lucide-react";
import Reveal from "./Reveal";
import { Link } from "../router";
import { products } from "../data/products";
import { useCart } from "../context/CartContext";
import { formatPrice } from "../utils/format";

export default function PromoShowcase() {
  const { addItem, openCart } = useCart();
  const bundleProducts = products.filter(
    (product) =>
      product.categoryId === "bundles" &&
      product.active !== false &&
      typeof product.promoPrice === "number" &&
      product.promoPrice < product.price,
  );

  const onAdd = (product) => {
    addItem(product);
    openCart();
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

        <div className="fm-promo-carousel__grid">
          {bundleProducts.map((product) => (
            <article className="fm-promo-card" key={product.id}>
              <div className="fm-promo-card__media">
                <span className="fm-promo-card__sticker">PROMO</span>
                <Link
                  to={`/producto/${product.slug}`}
                  aria-label={`Ver ${product.name}`}
                >
                  <img
                    src={product.image}
                    alt={product.imageAlt ?? product.name}
                    loading="lazy"
                    decoding="async"
                  />
                  {product.imageHover ? (
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
                  <strong>{formatPrice(product.promoPrice)}</strong>
                  <s>{formatPrice(product.price)}</s>
                </div>
                <button
                  className="fm-button fm-button--gold fm-button--block"
                  type="button"
                  onClick={() => onAdd(product)}
                  aria-label={`Agregar ${product.name} al carrito`}
                >
                  <Plus size={16} aria-hidden="true" />
                  Agregar
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </Reveal>
  );
}
