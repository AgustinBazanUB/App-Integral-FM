import { useEffect, useMemo } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Link, useSearchParams } from "../router";
import OccasionBuilder from "../components/OccasionBuilder";
import OliveOilGuide from "../components/OliveOilGuide";
import PageMeta from "../components/PageMeta";
import ProductCard from "../components/ProductCard";
import SectionHeading from "../components/SectionHeading";
import SensoryComparison from "../components/SensoryComparison";
import { categories, categoryById } from "../data/categories";
import {
  catalogCollections,
  virtualCatalogCategories,
} from "../data/catalogViews";
import { oliveProfiles } from "../data/oliveProfiles";
import { giftOccasions, products } from "../data/products";
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

const oliveVarietyOrder = oliveProfiles.map((profile) => profile.productId);
const oliveFormatOrder = { "500 cc": 0, "2 L": 1, "5 L": 2 };

function oliveSortKey(product) {
  const varietyIndex = oliveVarietyOrder.indexOf(product.id);
  if (varietyIndex !== -1) return varietyIndex;
  const formatIndex = oliveFormatOrder[product.formats?.[0]] ?? 90;
  return 100 + formatIndex;
}

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

  const isOliveOilView = categoryId === "olive_oil";
  const isGiftsView = categoryId === "gifts";

  const filteredProducts = useMemo(
    () => {
      const matches = products.filter((product) => {
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
      });
      return isOliveOilView
        ? [...matches].sort((a, b) => oliveSortKey(a) - oliveSortKey(b))
        : matches;
    },
    [activeCollection, categoryId, collectionCategoryIds, isOliveOilView, occasion, query],
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
        title={
          isOliveOilView
            ? "Aceite de oliva | Flor Mía"
            : isGiftsView
              ? "Regalos | Flor Mía"
              : `${activeCollection?.name ?? activeCategory?.name ?? "Productos"} | Flor Mía`
        }
        description={
          isOliveOilView
            ? "Guía de intensidad y varietales de aceite de oliva Flor Mía para elegir según gusto, intensidad o uso."
            : isGiftsView
              ? "Regalos Flor Mía para cada ocasión: selecciones individuales de productos mendocinos."
              : "Explorá la selección editable de aceites, frutos secos, aceitunas, mermeladas y sales de Flor Mía."
        }
      />

      {isOliveOilView ? (
        <OliveOilGuide
          id="guia-aceites"
          introCta={false}
          titleAs="h1"
        />
      ) : isGiftsView ? (
        <section className="page-hero page-hero--gifts">
          <div className="container">
            <p className="eyebrow">REGALOS FLOR MÍA</p>
            <h1>Regalos con sabor a Mendoza.</h1>
            <p>
              Aceites, frutos secos, aceitunas y mermeladas pensados para
              regalar: detalles empresariales, cumpleaños, agradecimientos,
              reuniones y fechas especiales.
            </p>
          </div>
        </section>
      ) : (
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
      )}

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

      {isOliveOilView ? (
        <section
          className="section comparison-section"
          aria-labelledby="comparison-title"
        >
          <div className="container">
            <SectionHeading
              eyebrow="COMPARÁ VARIETALES"
              title="Encontrá tu perfil."
              body="Elegí hasta tres varietales y comparalos por frutado, amargor, picor, intensidad y uso sugerido."
              as="h2"
            />
            <SensoryComparison />
          </div>
        </section>
      ) : null}

      {isGiftsView ? (
        <section
          className="section occasion-section"
          aria-labelledby="occasion-title"
        >
          <div className="container">
            <SectionHeading
              eyebrow="PARA CADA OCASIÓN"
              title="¿Qué querés regalar?"
              body="Elegí la ocasión y te mostramos una selección de productos reales para armar tu regalo."
              as="h2"
            />
            <OccasionBuilder
              occasions={giftOccasions}
              note="Selección individual de productos reales; no es un pack comercial. Los formatos y la presentación del regalo se coordinan al comprar."
            />
          </div>
        </section>
      ) : null}

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