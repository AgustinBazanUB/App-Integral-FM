import { useEffect, useMemo } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Link, useSearchParams } from "../router";
import PageMeta from "../components/PageMeta";
import ProductCard from "../components/ProductCard";
import SectionHeading from "../components/SectionHeading";
import { categories, categoryById } from "../data/categories";
import {
  catalogCollections,
  virtualCatalogCategories,
} from "../data/catalogViews";
import { products } from "../data/products";
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
          !occasion || product.occasions.includes(occasion);
        const matchesQuery = matchesSearch(
          product,
          categoryById[product.categoryId],
          query,
        );
        return (
          matchesCategory &&
          matchesCollection &&
          matchesOccasion &&
          matchesQuery
        );
      }),
    [activeCollection, categoryId, collectionCategoryIds, occasion, query],
  );

  useEffect(() => {
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
  }, [activeCategory, activeCollection, filteredProducts]);

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
    "Productos de distintas categorías preparados para una compra combinada.";
  const isEmptyWineCategory = activeCategory?.id === "wines";

  return (
    <main id="main-content" className="page-shell catalog-page">
      <PageMeta
        title={`${activeCollection?.name ?? activeCategory?.name ?? "Productos"} | Flor Mía`}
        description="Explorá la selección editable de aceites, frutos secos, aceitunas, mermeladas y sales de Flor Mía."
      />

      <section className="page-hero page-hero--catalog">
        <div className="container">
          <p className="eyebrow">CATÁLOGO FLOR MÍA</p>
          <h1>Sabores mendocinos para elegir a tu manera.</h1>
          <p>
            Buscá por producto, categoría u ocasión. Las fotografías y
            presentaciones visibles corresponden al catálogo recibido; los
            precios y el stock siguen pendientes.
          </p>
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
            <button
              type="button"
              className={!categoryId && !collectionId ? "is-selected" : ""}
              onClick={clearCatalogView}
            >
              Todo
            </button>
            {categories.map((category) => (
              <button
                type="button"
                className={categoryId === category.id ? "is-selected" : ""}
                onClick={() => updateCategory(category.id)}
                key={category.id}
              >
                {category.shortName}
              </button>
            ))}
          </div>

          <div className="catalog-secondary-filter">
            <SlidersHorizontal size={18} aria-hidden="true" />
            <label htmlFor="occasion-filter">Ocasión</label>
            <select
              id="occasion-filter"
              value={occasion}
              onChange={(event) => updateParam("ocasion", event.target.value)}
            >
              {occasions.map(([value, label]) => (
                <option value={value} key={value || "all"}>
                  {label}
                </option>
              ))}
            </select>
            {hasFilters ? (
              <button
                type="button"
                className="clear-filters"
                onClick={() => setSearchParams({}, { replace: true })}
              >
                <X size={16} aria-hidden="true" />
                Limpiar
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="section catalog-results">
        <div className="container">
          <div className="catalog-results__header">
            <SectionHeading
              eyebrow={`${filteredProducts.length} RESULTADOS`}
              title={catalogHeading}
              body={catalogDescription}
            />
            <span className="badge">DATOS COMERCIALES PENDIENTES</span>
          </div>

          {filteredProducts.length ? (
            <div className="catalog-grid">
              {filteredProducts.map((product) => (
                <ProductCard product={product} key={product.id} />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <h2>
                {isEmptyWineCategory
                  ? "Los vinos todavía no están cargados."
                  : "No encontramos productos con esos filtros."}
              </h2>
              <p>
                {isEmptyWineCategory
                  ? "La categoría está preparada para incorporar vinos cuando se confirmen sus datos comerciales, sin inventar productos, precios ni stock."
                  : "Probá otra categoría o limpiá la búsqueda. Las categorías vacías no se muestran como si tuvieran stock."}
              </p>
              <button
                className="button"
                type="button"
                onClick={() => setSearchParams({}, { replace: true })}
              >
                Ver todo el catálogo
              </button>
            </div>
          )}

          <div className="catalog-note">
            <h2>¿Falta un producto?</h2>
            <p>
              El catálogo fue preparado para crecer sin cambiar el diseño.
              Sabores de mermelada, packs, tamaños, precios y stock se cargarán
              desde los archivos de datos cuando Flor Mía los confirme.
            </p>
            <Link to="/nosotros">Ver cómo se administra el contenido</Link>
          </div>
        </div>
      </section>
    </main>
  );
}