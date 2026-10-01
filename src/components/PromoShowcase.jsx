import { CreditCard, HeartHandshake, Sprout, Truck } from "lucide-react";
import Reveal from "./Reveal";
import { Link } from "../router";
import { trustItems } from "../data/brand";
import { productById } from "../data/products";
import { promoShowcase } from "../data/promotions";
import { formatPrice } from "../utils/format";

const benefitIcons = {
  truck: Truck,
  "credit-card": CreditCard,
  sprout: Sprout,
  "heart-handshake": HeartHandshake,
};

export default function PromoShowcase() {
  const offers = promoShowcase.offers
    .map((offer) => ({ ...offer, product: productById[offer.productId] }))
    .filter(
      ({ product, promoPrice }) =>
        product &&
        product.active !== false &&
        typeof product.price === "number" &&
        typeof promoPrice === "number" &&
        promoPrice < product.price,
    );
  const campaigns = promoShowcase.campaigns.filter(
    (campaign) => campaign.active,
  );

  return (
    <Reveal
      as="section"
      className="fm-promo-showcase"
      id="promociones"
      aria-labelledby="promo-showcase-title"
    >
      <div className="fm-page">
        <div className="fm-rule-heading">
          <span aria-hidden="true" />
          <h2 id="promo-showcase-title">NUESTRAS PROMOCIONES</h2>
          <span aria-hidden="true" />
        </div>
        <p className="fm-promo-showcase__intro">
          Beneficios vigentes y ofertas seleccionadas para tu mesa mendocina.
        </p>

        <Reveal className="fm-promo-benefits" stagger>
          {trustItems.map(({ id, icon, title, subtitle, detail }) => {
            const Icon = benefitIcons[icon] ?? Sprout;
            return (
              <article className="fm-promo-benefit" key={id}>
                <span className="fm-promo-benefit__icon" aria-hidden="true">
                  <Icon size={24} strokeWidth={1.4} />
                </span>
                <div className="fm-promo-benefit__content">
                  <h3>{title}</h3>
                  <strong>{subtitle}</strong>
                  <p>{detail}</p>
                </div>
              </article>
            );
          })}
        </Reveal>

        {offers.length ? (
          <Reveal className="fm-promo-offers" stagger>
            {offers.map(({ product, promoPrice, label, endsAt }) => (
              <article className="fm-promo-offer" key={product.id}>
                <Link
                  className="fm-promo-offer__media"
                  to={`/producto/${product.slug}`}
                  aria-label={`Ver ${product.name}`}
                >
                  <img
                    src={product.image}
                    alt={product.imageAlt ?? product.name}
                    loading="lazy"
                    decoding="async"
                  />
                </Link>
                <div className="fm-promo-offer__content">
                  {label ? (
                    <span className="fm-promo-offer__badge">{label}</span>
                  ) : null}
                  <h3>
                    <Link to={`/producto/${product.slug}`}>{product.name}</Link>
                  </h3>
                  <div className="fm-promo-offer__prices">
                    <strong>{formatPrice(promoPrice)}</strong>
                    <s>{formatPrice(product.price)}</s>
                  </div>
                  {endsAt ? (
                    <small className="fm-promo-offer__ends">
                      Vigente hasta {endsAt}
                    </small>
                  ) : null}
                </div>
              </article>
            ))}
          </Reveal>
        ) : null}

        {campaigns.map(
          ({ id, badge, title, body, ctaLabel, ctaTo }) => (
            <article className="fm-promo-campaign" key={id}>
              {badge ? (
                <span className="fm-promo-campaign__badge">{badge}</span>
              ) : null}
              <div className="fm-promo-campaign__copy">
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
              {ctaLabel && ctaTo ? (
                <Link className="fm-button fm-button--gold" to={ctaTo}>
                  {ctaLabel}
                </Link>
              ) : null}
            </article>
          ),
        )}
      </div>
    </Reveal>
  );
}
