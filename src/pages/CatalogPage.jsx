import { useEffect, useMemo } from "react";
import { Search, X } from "lucide-react";
import { useSearchParams } from "../router";
import PageMeta from "../components/PageMeta";
import ProductCard from "../components/ProductCard";
import { categories, categoryById } from "../data/categories";
import {
  catalogCollections,
  virtualCatalogCategories,
} from "../data/catalogViews";
import { useCommerceCatalog } from "../context/CommerceCatalogContext";
import { matchesSearch } from "../utils/search";
import { trackEvent } from "../utils/analytics";

const categoryAliases = {
  aceites: "olive_oil",
  "frutos-secos": "nuts",
  aceitunas: "olives",
  mermeladas: "jams",
  sales: "seasoned_salts",
  regalos: "gifts",
  vinos: "wines",
};

const occasions = [
  ["", "Todas las ocasiones"],
  ["picada", "Para una picada"],
  ["breakfast", "Desayuno o merienda"],
  ["gift", "Para regalar"],
  ["everyday", "Todos los días"],
];

export default function CatalogPage() {
  const { products, status, error, ready, pending, location } = useCommerceCatalog();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawCategory = searchParams.get("categoria") ?? "";
  const categoryId = categoryAliases[rawCategory] ?? rawCategory;
  const collectionId = searchParams.get("coleccion") ?? "";
  const query = searchParams.get("q") ?? "";
  const occasion = searchParams.get("ocasion") ?? "";
  const activeCategory =
    categoryById[categoryId] ?? virtualCatalogCategories[categoryId];
  const activeCollection = catalogCollections[collectionId];
  const collectionCategoryIds = activeCollection?.categoryIds ?? [];

  const filteredProducts = useMemo(
    () =>
      products.filter((product) => {
        const matchesCategory =
          !categoryId || product.categoryId === categoryId;
        const matchesCollection =
          !activeCollection || collectionCategoryIds.includes(product.categoryId);
        const matchesOccasion =
          !occasion || (product.occasions || []).includes(occasion);
        const matchesQuery = matchesSearch(
          product,
          categoryById[product.categoryId],
          query,
        );
        return matchesCategory && matchesCollection && matchesOccasion && matchesQuery;
      }),
    [activeCollection, categoryId, collectionCategoryIds, occasion, products, query],
  );

  useEffect(() => {
    if (status !== "ready") return;
    trackEvent("view_item_list", {
      item_list_name:
        activeCollection?.name ??
        activeCategory?.name ??
        "Todos los productos",
      items: filteredProducts.map((product) => ({
        item_id: product.id,
        item_name: product.name,
        item_category: product.categoryId,
        price: product.price,
      })),
    });
  }, [activeCategory, activeCollection, filteredProducts, status]);

  const updateParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const updateCategory = (value) => {
    const next = new URLSearchParams(searchParams);
    next.delete("coleccion");
    if (value) next.set("categoria", value);
    else next.delete("categoria");
    setSearchParams(next, { replace: true });
  };

  const clearCatalogView = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("categoria");
    next.delete("coleccion");
    setSearchParams(next, { replace: true });
  };

  const hasFilters = Boolean(categoryId || collectionId || query || occasion);
  const catalogHeading =
    activeCollection?.name ?? activeCategory?.name ?? "Toda la selección.";
  const catalogDescription =
    activeCollection?.description ??
    activeCategory?.description ??
    "Productos del catálogo maestro de Flor Mía con precio y stock validados por el backend.";

  return (
    <main id="main-content" className="page-shell catalog-page">
      <PageMeta
        title={`${activeCollection?.name ?? activeCategory?.name ?? "Productos"} | Flor Mía`}
        description="Explorá el catálogo comercial de Flor Mía con precio y disponibilidad actualizados."
      />

      <section className="page-hero page-hero--catalog">
        <div className="container">
          <p className="eyebrow">CATÁLOGO FLOR MÍA</p>
          <h1>Productos reales, con precio y stock comercial.</h1>
          <p>
            Las descripciones e imágenes pueden ser editoriales. El ID, precio,
            disponibilidad y dato fiscal provienen del catálogo maestro y de la
            ubicación Ecommerce configurada.
          </p>
          {!ready ? (
            <div className="pending-panel">
              <strong>Configuración comercial incompleta</strong>
              <p>
                {pending.includes("ECOMMERCE_LOCATION_ID")
                  ? "La ubicación de stock Ecommerce está PENDIENTE DE DEFINIR."
                  : "Algunas decisiones comerciales siguen pendientes."}
              </p>
            </div>
          ) : location ? (
            <p className="catalog-source-note">Stock Ecommerce: {location.name}</p>
          ) : null}
        </div>
      </section>

      <section className="catalog-controls" aria-label="Filtros del catálogo">
        <div className="container">
          <div className="catalog-search">
            <label className="field-label" htmlFor="catalog-search">
              Buscar en el catálogo
            </label>
            <div className="search-field">
              <Search size={20} aria-hidden="true" />
              <input
                id="catalog-search"
                type="search"
                value={query}
                onChange={(event) => updateParam("q", event.target.value)}
                placeholder="Aceite, pistachos, aceitunas…"
              />
            </div>
          </div>

          <div className="catalog-category-pills" aria-label="Categorías">
            <button type="button" className={!categoryId && !collectionId ? "is-active" : ""} onClick={clearCatalogView}>
              Todos
            </button>
            {categories.map((category) => (
              <button
                type="button"
                className={categoryId === category.id ? "is-active" : ""}
                onClick={() => updateCategory(category.id)}
                key={category.id}
              >
                {category.shortName ?? category.name}
              </button>
            ))}
          </div>

          <div className="catalog-secondary-filters">
            <label className="field-label">
              Ocasión
              <select value={occasion} onChange={(event) => updateParam("ocasion", event.target.value)}>
                {occasions.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}
              </select>
            </label>
            {hasFilters ? (
              <button className="text-button" type="button" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}>
                <X size={16} aria-hidden="true" />
                Limpiar filtros
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-heading">
            <p className="eyebrow">SELECCIÓN COMERCIAL</p>
            <h2>{catalogHeading}</h2>
            <p className="section-heading__body">{catalogDescription}</p>
          </div>

          {status === "loading" ? <div className="pending-panel"><strong>Cargando catálogo comercial…</strong></div> : null}
          {status === "error" ? (
            <div className="pending-panel">
              <strong>No se pudo cargar el catálogo comercial.</strong>
              <p>{error?.message || "Reintentá cuando el backend esté disponible."}</p>
            </div>
          ) : null}

          {status === "ready" && filteredProducts.length ? (
            <div className="catalog-grid">
              {filteredProducts.map((product) => <ProductCard product={product} key={product.id} />)}
            </div>
          ) : null}

          {status === "ready" && !filteredProducts.length ? (
            <div className="empty-state">
              <h3>No encontramos productos con esos filtros.</h3>
              <p>Probá otra categoría o búsqueda.</p>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
