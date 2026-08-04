import { Link } from "../router";
import PageMeta from "../components/PageMeta";

export default function NotFoundPage() {
  return (
    <main id="main-content" className="page-shell">
      <PageMeta title="Página no encontrada | Flor Mía" />
      <section className="section">
        <div className="container empty-state">
          <p className="eyebrow">ERROR 404</p>
          <h1>Este camino no lleva a la tienda.</h1>
          <p>Volvé al inicio o recorré la selección de productos.</p>
          <div className="button-row">
            <Link className="button" to="/tienda">
              Ir al inicio
            </Link>
            <Link className="button button--secondary" to="/productos">
              Ver productos
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
