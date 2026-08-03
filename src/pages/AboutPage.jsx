import { Link } from "../router";
import PageMeta from "../components/PageMeta";
import { assetsManifest } from "../data/assetsManifest";

export default function AboutPage() {
  return (
    <main id="main-content" className="page-shell about-page">
      <PageMeta
        title="Nuestra historia | Flor Mía"
        description="Conocé el enfoque de Flor Mía: una selección de productos regionales mendocinos con el aceite de oliva como especialidad."
      />

      <section className="page-hero page-hero--about">
        <div className="container">
          <p className="eyebrow">DE MENDOZA A TU MESA</p>
          <h1>Una selección cuidada, contada con honestidad.</h1>
          <p>
            Esta página está preparada para recibir la historia real de Flor
            Mía, su local y su relación verificable con cada producto.
          </p>
        </div>
      </section>

      <section className="section" id="origen">
        <div className="container story-grid">
          <img
            className="about-local-image"
            src={assetsManifest.local.story.src}
            width={assetsManifest.local.story.width}
            height={assetsManifest.local.story.height}
            alt={assetsManifest.local.story.alt}
            decoding="async"
          />
          <div className="story-content">
            <p className="eyebrow">NUESTRA HISTORIA</p>
            <h2>El local y las personas, antes que un relato inventado.</h2>
            <p>
              Flor Mía se presenta como una tienda de productos regionales de
              Mendoza. El aceite de oliva ocupa un lugar central, acompañado por
              frutos secos, aceitunas, mermeladas y sales.
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
      </section>

      <section className="section about-principles" id="local">
        <div className="container">
          <p className="eyebrow">LO QUE GUÍA ESTA EXPERIENCIA</p>
          <div className="principles-grid">
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
          </div>
        </div>
      </section>
    </main>
  );
}
