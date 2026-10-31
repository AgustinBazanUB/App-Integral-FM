import { MessageCircle, Star } from "lucide-react";
import Reveal from "./Reveal";

const reviews = [
  {
    name: "María González",
    rating: 5,
    platform: "whatsapp",
    text: "El aceite de oliva es increíble, nunca había probado algo tan fresco. Ya es el tercer pedido que hago.",
  },
  {
    name: "Carlos Pérez",
    rating: 5,
    platform: "instagram",
    text: "Los pistachos son una delicia. Muy frescos y con el punto justo de sal. Recomendado 100%.",
  },
  {
    name: "Ana López",
    rating: 5,
    platform: "facebook",
    text: "El pack de aceites es ideal para regalar. Mi familia quedó encantada con la calidad.",
  },
  {
    name: "Roberto Martínez",
    rating: 5,
    platform: "google",
    text: "La sal de Malbec le da un toque especial a mis carnes. Excelente producto mendocino.",
  },
  {
    name: "Laura Fernández",
    rating: 5,
    platform: "whatsapp",
    text: "Las almendras son perfectas para la merienda de los chicos. Naturales y crocantes.",
  },
  {
    name: "Diego Sánchez",
    rating: 5,
    platform: "instagram",
    text: "El vino Bazán es espectacular. Malbec auténtico de Mendoza, muy bien presentado.",
  },
  {
    name: "Patricia Rossi",
    rating: 5,
    platform: "facebook",
    text: "Las mermeladas tienen fruta real, no como otras marcas. La de pera es mi favorita.",
  },
  {
    name: "Jorge Ramírez",
    rating: 5,
    platform: "google",
    text: "Envío rápido y productos bien embalados. Flor Mía ya es mi lugar de confianza.",
  },
];

const platformIcons = {
  whatsapp: "💬",
  instagram: "📷",
  facebook: "📘",
  google: "⭐",
};

export default function ReviewsCarousel() {
  const duplicatedReviews = [...reviews, ...reviews, ...reviews];

  return (
    <Reveal
      as="section"
      className="fm-reviews-carousel"
      aria-labelledby="reviews-title"
    >
      <div className="fm-page">
        <div className="fm-rule-heading">
          <span aria-hidden="true" />
          <h2 id="reviews-title">LO QUE DICEN NUESTROS CLIENTES</h2>
          <span aria-hidden="true" />
        </div>

        <div className="fm-reviews-carousel__track">
          {duplicatedReviews.map((review, index) => (
            <article className="fm-review-card" key={`${review.name}-${index}`}>
              <div className="fm-review-card__header">
                <span className="fm-review-card__name">{review.name}</span>
                <div className="fm-review-card__meta">
                  <div className="fm-review-card__stars">
                    {[...Array(review.rating)].map((_, i) => (
                      <Star key={i} size={14} fill="#d4af37" aria-hidden="true" />
                    ))}
                  </div>
                  <span className="fm-review-card__platform" aria-label={`Publicado en ${review.platform}`}>
                    {platformIcons[review.platform]}
                  </span>
                </div>
              </div>
              <blockquote className="fm-review-card__quote">
                <MessageCircle size={14} className="fm-review-card__quote-icon" aria-hidden="true" />
                "{review.text}"
              </blockquote>
            </article>
          ))}
        </div>
      </div>
    </Reveal>
  );
}
