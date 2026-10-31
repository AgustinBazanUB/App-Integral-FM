import { Star } from "lucide-react";
import Reveal from "./Reveal";

const reviews = [
  {
    name: "María González",
    rating: 5,
    text: "El aceite de oliva es increíble, nunca había probado algo tan fresco. Ya es el tercer pedido que hago.",
  },
  {
    name: "Carlos Pérez",
    rating: 5,
    text: "Los pistachos son una delicia. Muy frescos y con el punto justo de sal. Recomendado 100%.",
  },
  {
    name: "Ana López",
    rating: 5,
    text: "El pack de aceites es ideal para regalar. Mi familia quedó encantada con la calidad.",
  },
  {
    name: "Roberto Martínez",
    rating: 5,
    text: "La sal de Malbec le da un toque especial a mis carnes. Excelente producto mendocino.",
  },
  {
    name: "Laura Fernández",
    rating: 5,
    text: "Las almendras son perfectas para la merienda de los chicos. Naturales y crocantes.",
  },
  {
    name: "Diego Sánchez",
    rating: 5,
    text: "El vino Bazán es espectacular. Malbec auténtico de Mendoza, muy bien presentado.",
  },
  {
    name: "Patricia Rossi",
    rating: 5,
    text: "Las mermeladas tienen fruta real, no como otras marcas. La de pera es mi favorita.",
  },
  {
    name: "Jorge Ramírez",
    rating: 5,
    text: "Envío rápido y productos bien embalados. Flor Mía ya es mi lugar de confianza.",
  },
];

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
              <div className="fm-review-card__stars">
                {[...Array(review.rating)].map((_, i) => (
                  <Star key={i} size={16} fill="#d4af37" aria-hidden="true" />
                ))}
              </div>
              <p className="fm-review-card__text">{review.text}</p>
              <p className="fm-review-card__author">{review.name}</p>
            </article>
          ))}
        </div>
      </div>
    </Reveal>
  );
}
