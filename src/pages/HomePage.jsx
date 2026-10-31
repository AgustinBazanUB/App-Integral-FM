import { Grape, HeartHandshake, Sprout, UsersRound } from "lucide-react";
import { Link } from "../router";
import { assetsManifest } from "../data/assetsManifest";
import { brand } from "../data/brand";
import OliveOilGuide from "../components/OliveOilGuide";
import PageMeta from "../components/PageMeta";
import PromoShowcase from "../components/PromoShowcase";
import Reveal from "../components/Reveal";
import ReviewsCarousel from "../components/ReviewsCarousel";

const storyValues = [
  { label: "Productos mendocinos", Icon: Grape },
  { label: "Selección cuidada", Icon: UsersRound },
  { label: "Tradición y calidad", Icon: Sprout },
  { label: "Pasión por lo natural", Icon: HeartHandshake },
];

const tableProducts = [
  [assetsManifest.products.oliveOil2L, "fm-table-scene__oil"],
  [assetsManifest.products.greekOlives, "fm-table-scene__olives"],
  [assetsManifest.products.almonds500g, "fm-table-scene__almonds"],
  [assetsManifest.products.bazanWine, "fm-table-scene__wine"],
  [assetsManifest.products.pearJam, "fm-table-scene__jam"],
  [assetsManifest.products.malbecSalt, "fm-table-scene__salt"],
];

function ResponsiveStorefront({ className = "", story = false }) {
  const asset = story ? assetsManifest.local.story : assetsManifest.local.hero;

  if (story) {
    return (
      <img
        className={className}
        src={asset.src}
        width={asset.width}
        height={asset.height}
        alt={asset.alt}
        loading="lazy"
        decoding="async"
      />
    );
  }

  return (
    <picture className={className}>
      <source srcSet={asset.srcSet} sizes={asset.sizes} type="image/webp" />
      <img
        src={asset.fallback}
        width={asset.width}
        height={asset.height}
        alt={asset.alt}
        fetchpriority="high"
        decoding="async"
      />
    </picture>
  );
}

export default function HomePage() {
  const handleOilGuideScroll = () => {
    const oilGuide = document.getElementById("guia-aceites");
    if (!oilGuide) return;
    const prefersReducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    oilGuide.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start",
    });
  };

  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: brand.name,
        url: window.location.origin,
        logo: `${window.location.origin}${assetsManifest.brand.logo.src}`,
        ...(brand.instagram ? { sameAs: [brand.instagram] } : {}),
      },
      {
        "@type": "WebSite",
        name: brand.name,
        url: window.location.origin,
        potentialAction: {
          "@type": "SearchAction",
          target: `${window.location.origin}/productos?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "CollectionPage",
        name: "Productos regionales de Mendoza",
        url: window.location.href,
      },
    ],
  };

  return (
    <>
      <PageMeta
        title="Flor Mía | Productos Regionales de Mendoza"
        description="Descubrí aceites de oliva, frutos secos, aceitunas, mermeladas, sales y otros productos regionales mendocinos seleccionados por Flor Mía."
      />
      <script type="application/ld+json">
        {JSON.stringify(structuredData)}
      </script>

      <main id="main-content" className="fm-home">
        <section className="fm-hero" aria-labelledby="hero-title">
          <ResponsiveStorefront className="fm-hero__media" />
          <div className="fm-hero__shade" aria-hidden="true" />
          <div className="fm-page fm-hero__inner">
            <div className="fm-hero__copy">
              <p className="fm-kicker fm-kicker--line">DE MENDOZA A TU MESA</p>
              <h1 id="hero-title">
                Los sabores de <span>Mendoza</span>, en un solo lugar.
              </h1>
              <p className="fm-hero__description">
                Seleccionamos lo mejor de nuestra tierra: aceites de oliva,
                frutos secos, aceitunas, mermeladas, sales y vinos para
                disfrutar la esencia de Mendoza todos los días.
              </p>
              <div className="fm-hero__actions">
                <button
                  className="fm-button fm-button--gold"
                  type="button"
                  onClick={handleOilGuideScroll}
                >
                  CONOCÉ TU AOVE
                </button>
                <Link className="fm-button fm-button--black" to="/productos">
                  CONOCER MÁS PRODUCTOS
                </Link>
              </div>
            </div>
          </div>
        </section>

        <PromoShowcase />

        <OliveOilGuide />

        <ReviewsCarousel />

        <Reveal
          as="section"
          className="fm-table"
          id="mesa-mendocina"
          aria-labelledby="table-title"
        >
          <div className="fm-page fm-table__layout">
            <div className="fm-table__copy">
              <h2 id="table-title">
                ARMÁ TU
                <br />
                MESA MENDOCINA
              </h2>
              <p>
                Combiná lo mejor de nuestra tierra y convertí cada comida en
                una experiencia única. Descubrí sabores que se disfrutan y se
                comparten.
              </p>
              <Link className="fm-button fm-button--dark" to="/productos">
                VER SUGERENCIAS
              </Link>
            </div>
            <div
              className="fm-table-scene"
              aria-label="Selección de productos reales Flor Mía"
            >
              {tableProducts.map(([asset, className]) => (
                <img
                  className={className}
                  src={asset.src}
                  width={asset.width}
                  height={asset.height}
                  alt={asset.alt}
                  loading="lazy"
                  decoding="async"
                  key={className}
                />
              ))}
              <span className="fm-table-scene__branch" aria-hidden="true">
                ❧
              </span>
            </div>
          </div>
        </Reveal>

        <Reveal
          as="section"
          className="fm-story"
          id="historia"
          aria-labelledby="story-title"
        >
          <div className="fm-page fm-story__layout">
            <ResponsiveStorefront className="fm-story__image" story />
            <div className="fm-story__copy">
              <p className="fm-kicker">NUESTRA HISTORIA</p>
              <h2 id="story-title">De nuestra tienda a tu mesa.</h2>
              <p>
                Flor Mía acerca los sabores de Mendoza a través de una
                selección cuidada de productos regionales.
              </p>
              <ul className="fm-story-values">
                {storyValues.map(({ label, Icon }) => (
                  <li key={label}>
                    <Icon size={31} strokeWidth={1.25} aria-hidden="true" />
                    <span>{label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Reveal>
      </main>
    </>
  );
}
