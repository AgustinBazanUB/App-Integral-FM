import { Star } from "lucide-react";
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
    platform: "whatsapp",
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
    platform: "instagram",
    text: "Las almendras son perfectas para la merienda de los chicos. Naturales y crocantes.",
  },
  {
    name: "Diego Sánchez",
    rating: 5,
    platform: "whatsapp",
    text: "El vino Bazán es espectacular. Malbec auténtico de Mendoza, muy bien presentado.",
  },
  {
    name: "Patricia Rossi",
    rating: 5,
    platform: "google",
    text: "Las mermeladas tienen fruta real, no como otras marcas. La de pera es mi favorita.",
  },
  {
    name: "Jorge Ramírez",
    rating: 5,
    platform: "instagram",
    text: "Envío rápido y productos bien embalados. Flor Mía ya es mi lugar de confianza.",
  },
  {
    name: "Sofía Blanco",
    rating: 5,
    platform: "whatsapp",
    text: "El aceite Blend IG es perfecto para todo: cocinar y finalizar. Intensidad ideal.",
  },
  {
    name: "Miguel Ángel Torres",
    rating: 5,
    platform: "google",
    text: "Las aceitunas griegas son excelentes. Muy buenas para picadas y ensaladas.",
  },
  {
    name: "Valentina Castro",
    rating: 5,
    platform: "instagram",
    text: "Compré el pack de 2 bidones de 5L para mi restaurant. Precio y calidad imbatibles.",
  },
  {
    name: "Federico García",
    rating: 5,
    platform: "whatsapp",
    text: "El Coratina tiene un picante que me encanta. Ideal para carnes a la parrilla.",
  },
  {
    name: "Carolina Méndez",
    rating: 5,
    platform: "google",
    text: "Las almendras de 1kg son súper crocantes. Las uso para repostería y quedan ricas.",
  },
  {
    name: "Alejandro Ruiz",
    rating: 5,
    platform: "instagram",
    text: "El Picual es muy estable al calor. Lo uso para freír y no pierde sabor.",
  },
  {
    name: "Mónica Suárez",
    rating: 5,
    platform: "whatsapp",
    text: "El Arauco tiene un sabor único, muy argentino. Me encanta en ensaladas.",
  },
  {
    name: "Gustavo Flores",
    rating: 5,
    platform: "google",
    text: "Pack de picada fue un éxito en mi cumpleaños. Todos preguntaron dónde lo compré.",
  },
];

const platformLogos = {
  whatsapp: "/images/flor-mia/whatsapp-logo.png",
  instagram: "/images/flor-mia/instagram-logo.png",
  google: "/images/flor-mia/google-logo.png",
};

export default function ReviewsCarousel() {
  const duplicatedReviews = [...reviews, ...reviews, ...reviews, ...reviews];

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
                  <img
                    className="fm-review-card__platform"
                    src={platformLogos[review.platform]}
                    alt={review.platform}
                    width={20}
                    height={20}
                  />
                </div>
              </div>
              <blockquote className="fm-review-card__quote">
                "{review.text}"
              </blockquote>
            </article>
          ))}
        </div>
      </div>
    </Reveal>
  );
}
