import { useId, useMemo, useRef, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { Link } from "../router";
import { categories, categoryById } from "../data/categories";
import { products } from "../data/products";
import {
  filterProducts,
  groupProductsByCategory,
  normalizeText,
} from "../utils/search";
import { trackEvent } from "../utils/analytics";

const suggestions = [
  "Aceite suave",
  "Aceite intenso",
  "Pistachos",
  "Almendras",
  "Aceitunas descarozadas",
  "Mermeladas",
  "Para una picada",
  "Para regalar",
];

export default function SearchExperience({
  autofocus = false,
  onNavigate,
  showQuickFilters = true,
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);
  const searchId = useId();
  const resultsId = `${searchId}-results`;
  const normalizedQuery = normalizeText(query);

  const matchingProducts = useMemo(() => {
    if (!normalizedQuery) return [];
    return filterProducts(products, categoryById, normalizedQuery);
  }, [normalizedQuery]);

  const grouped = useMemo(
    () => groupProductsByCategory(matchingProducts),
    [matchingProducts],
  );

  const chooseQuery = (value) => {
    setQuery(value);
    trackEvent("search", { search_term: value });
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      document.querySelector(".search-results a")?.focus();
    }
  };

  return (
    <div className="search-experience">
      <label className="field-label search-experience__label" htmlFor={searchId}>
        Buscar productos
      </label>
      <div className="search-field">
        <Search size={22} aria-hidden="true" />
        <input
          ref={inputRef}
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Buscá aceite, pistachos, aceitunas, mermeladas…"
          autoComplete="off"
          autoFocus={autofocus}
          aria-controls={resultsId}
          aria-expanded={Boolean(normalizedQuery)}
        />
      </div>

      {showQuickFilters ? (
        <div className="search-suggestions" aria-label="Búsquedas sugeridas">
          {suggestions.map((suggestion) => (
            <button
              type="button"
              className="pill-button"
              onClick={() => chooseQuery(suggestion)}
              key={suggestion}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}

      {normalizedQuery ? (
        <div
          className="search-results"
          id={resultsId}
          aria-live="polite"
        >
          {matchingProducts.length ? (
            categories.map((category) => {
              const categoryProducts = grouped[category.id];
              if (!categoryProducts?.length) return null;

              return (
                <section className="search-result-group" key={category.id}>
                  <h3>{category.name}</h3>
                  <div>
                    {categoryProducts.slice(0, 4).map((product) => (
                      <Link
                        to={`/producto/${product.slug}`}
                        key={product.id}
                        onClick={onNavigate}
                      >
                        <span>
                          <strong>{product.name}</strong>
                          <small>
                            {product.formats?.[0]} ·{" "}
                            {product.uses?.[0] ?? "Uso pendiente"}
                          </small>
                        </span>
                        <ArrowRight size={18} aria-hidden="true" />
                      </Link>
                    ))}
                  </div>
                </section>
              );
            })
          ) : (
            <div className="empty-state empty-state--compact">
              <p>No encontramos resultados para “{query}”.</p>
              <button type="button" onClick={() => setQuery("")}>
                Limpiar búsqueda
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
