import { Link } from "../router";
import PageMeta from "../components/PageMeta";
import Reveal from "../components/Reveal";
import { assetsManifest } from "../data/assetsManifest";

export default function AboutPage() {
  const { local, editorial } = assetsManifest;

  return (
    <main id="main-content" className="page-shell about-page">
      <PageMeta
        title="Nuestra historia | Flor Mía"
        description="Conocé el enfoque de Flor Mía: una selección de productos regionales mendocinos con el aceite de oliva como especialidad."
      />

      <section className="page-hero page-hero--about">
        <div className="container">
          <p className="eyebrow">DE MENDOZA A TU MESA</p>
          <h1>Productos de la tierra mendocina, elegidos de a uno.</h1>
          <p>
            Flor Mía nace en Mendoza con una idea simple: acercar a tu mesa
            productos regionales seleccionados con cuidado, con el aceite de
            oliva como especialidad.
          </p>
        </div>
      </section>

      <Reveal as="section" className="section" id="origen">
        <div className="container story-grid">
          <img
            className="about-local-image"
            src={local.story.src}
            width={local.story.width}
            height={local.story.height}
            alt={local.story.alt}
            decoding="async"
          />
          <div className="story-content">
            <p className="eyebrow">NUESTRA HISTORIA</p>
            <h2>El local y las personas, antes que un relato inventado.</h2>
            <p>
              Flor Mía es una tienda de productos regionales de Mendoza. El
              aceite de oliva ocupa un lugar central, acompañado por frutos
              secos, aceitunas, mermeladas y sales que seleccionamos de
              productores de la región.
            </p>
            <p>
              Todavía faltan la historia fundacional completa, la dirección,
              los horarios y la información real sobre productores. Por eso
              esta versión no afirma producción propia, finca, premios ni
              certificaciones.
            </p>
            <Link className="button" to="/productos">
              Explorar la selección
            </Link>
          </div>
        </div>
      </Reveal>

      <Reveal as="section" className="section about-editorial" aria-labelledby="about-editorial-title">
        <div className="container">
          <p className="eyebrow">MENDOZA, EN IMÁGENES</p>
          <h2 id="about-editorial-title">Del productor a tu mesa.</h2>
          <p className="about-editorial__lead">
            Acercamos una selección de productos mendocinos directamente de
            sus productores, cuidando el origen y la elección de cada uno.
          </p>
          <Reveal className="about-editorial__grid" stagger>
            <img
              src={local.hero.src}
              srcSet={local.hero.srcSet}
              sizes="(max-width: 768px) 100vw, 33vw"
              width={local.hero.width}
              height={local.hero.height}
              alt={local.hero.alt}
              loading="lazy"
              decoding="async"
            />
            <img
              src={editorial.table.src}
              width={editorial.table.width}
              height={editorial.table.height}
              alt={editorial.table.alt}
              loading="lazy"
              decoding="async"
            />
            <img
              src={assetsManifest.oliveVarieties.arbequina.src}
              width={assetsManifest.oliveVarieties.arbequina.width}
              height={assetsManifest.oliveVarieties.arbequina.height}
              alt={assetsManifest.oliveVarieties.arbequina.alt}
              loading="lazy"
              decoding="async"
            />
          </Reveal>
          <p className="about-editorial__note">
            Esta fila está preparada para sumar fotografía editorial de la
            próxima sesión (origen, proceso y presentación de regalos).
          </p>
        </div>
      </Reveal>

      <Reveal as="section" className="section about-principles" id="local">
        <div className="container">
          <p className="eyebrow">LO QUE GUÍA ESTA EXPERIENCIA</p>
          <Reveal className="principles-grid" stagger>
            <article>
              <span>01</span>
              <h2>Origen claro</h2>
              <p>
                La procedencia se publica producto por producto y solo cuando
                está verificada.
              </p>
            </article>
            <article>
              <span>02</span>
              <h2>Selección amplia</h2>
              <p>
                El aceite es protagonista, mientras las demás categorías
                conservan visibilidad propia.
              </p>
            </article>
            <article>
              <span>03</span>
              <h2>Compra honesta</h2>
              <p>
                Sin precios, reseñas, stock, promociones ni políticas
                inventadas.
              </p>
            </article>
          </Reveal>
        </div>
      </Reveal>

      <Reveal as="section" className="section about-cta">
        <div className="container">
          <h2>Empezá por el aceite de oliva.</h2>
          <p>
            Nuestra especialidad: varietales de distinta intensidad para cada
            gusto y cada uso.
          </p>
          <Link className="button button--gold" to="/productos?categoria=olive_oil">
            Conocer los varietales
          </Link>
        </div>
      </Reveal>
    </main>
  );
}
