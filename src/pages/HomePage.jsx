import { Grape, HeartHandshake, Sprout, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "../router";
import { assetsManifest } from "../data/assetsManifest";
import { brand } from "../data/brand";
import OliveOilGuide from "../components/OliveOilGuide";
import PageMeta from "../components/PageMeta";
import ProductCard from "../components/ProductCard";
import PromoShowcase from "../components/PromoShowcase";
import Reveal from "../components/Reveal";
import ReviewsCarousel from "../components/ReviewsCarousel";
import { products } from "../data/products";

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

function ResponsiveStorefront({ className = "", story = false, heroImage = null }) {
  const asset = story ? assetsManifest.local.story : assetsManifest.local.hero;
  const src = heroImage || asset.src;
  const srcSet = heroImage ? null : asset.srcSet;
  const sizes = heroImage ? null : asset.sizes;

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
      {srcSet ? (
        <source srcSet={srcSet} sizes={sizes} type="image/webp" />
      ) : null}
      <img
        src={src || asset.fallback}
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
  const [currentHeroIndex, setCurrentHeroIndex] = useState(0);
  const heroImages = [
    "/images/flor-mia/hero-1.jpg",
    "/images/flor-mia/hero-2.jpg",
    "/images/flor-mia/hero-3.jpg",
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentHeroIndex((prev) => (prev + 1) % heroImages.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

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

  const heroTrackStyle = {
    transform: `translateX(-${currentHeroIndex * (100 / heroImages.length)}%)`,
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
          <div className="fm-hero__media">
            <div className="fm-hero__track" style={heroTrackStyle}>
              {heroImages.map((image, index) => (
                <ResponsiveStorefront
                  key={index}
                  className="fm-hero__slide"
                  heroImage={image}
                />
              ))}
            </div>
          </div>
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

        <Reveal as="section" className="section" aria-labelledby="home-products-title">
          <div className="fm-page">
            <div className="fm-rule-heading">
              <span aria-hidden="true" />
              <h2 id="home-products-title">PRODUCTOS DESTACADOS</h2>
              <span aria-hidden="true" />
            </div>
            <div className="catalog-grid">
              {products
                .filter((p) => p.active !== false && p.categoryId !== "bundles")
                .slice(0, 6)
                .map((product) => (
                  <ProductCard product={product} key={product.id} />
                ))}
            </div>
            <div style={{ textAlign: "center", marginTop: "32px" }}>
              <Link className="fm-button fm-button--gold" to="/productos">
                VER TODO EL CATÁLOGO
              </Link>
            </div>
          </div>
        </Reveal>

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
