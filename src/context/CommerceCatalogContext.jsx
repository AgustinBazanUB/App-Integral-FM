import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { products as editorialProducts } from "../data/products";
import { fetchEcommerceCatalog } from "../services/ecommerceService";

const CommerceCatalogContext = createContext(null);
const editorialById = Object.fromEntries(editorialProducts.map((product) => [product.id, product]));
const editorialBySlug = Object.fromEntries(editorialProducts.map((product) => [product.slug, product]));

function mergeEditorial(commercial) {
  const editorial =
    (commercial.editorialId && editorialById[commercial.editorialId])
    || editorialById[commercial.id]
    || editorialBySlug[commercial.slug]
    || null;

  return {
    ...(editorial || {}),
    ...commercial,
    editorialId: editorial?.id || commercial.editorialId || null,
    image: editorial?.image || commercial.image || commercial.thumb || "",
    imageAlt: editorial?.imageAlt || commercial.name,
    description: editorial?.description || commercial.description || "",
    formats: editorial?.formats?.length ? editorial.formats : [commercial.abbreviation].filter(Boolean),
    attributes: editorial?.attributes || {},
    tags: editorial?.tags || [],
    uses: editorial?.uses || [],
    occasions: editorial?.occasions || [],
    editorialFeatured: editorial?.editorialFeatured === true,
    stock:
      commercial.stockState === "out"
        ? "out"
        : commercial.stockState === "available"
          ? commercial.stock
          : "unknown",
  };
}

export function CommerceCatalogProvider({ children }) {
  const [state, setState] = useState({
    status: "loading",
    error: null,
    catalog: null,
  });

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, status: "loading", error: null }));
    try {
      const catalog = await fetchEcommerceCatalog();
      setState({ status: "ready", error: null, catalog });
      return catalog;
    } catch (error) {
      setState({ status: "error", error, catalog: null });
      throw error;
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const products = useMemo(
    () => (state.catalog?.products || []).map(mergeEditorial),
    [state.catalog],
  );

  const byId = useMemo(
    () => Object.fromEntries(products.map((product) => [product.id, product])),
    [products],
  );

  const bySlug = useMemo(
    () => Object.fromEntries(products.map((product) => [product.slug, product])),
    [products],
  );

  const byEditorialId = useMemo(
    () => Object.fromEntries(
      products
        .filter((product) => product.editorialId)
        .map((product) => [product.editorialId, product]),
    ),
    [products],
  );

  const resolveProduct = useCallback(
    (candidate) => {
      if (!candidate) return null;
      if (typeof candidate === "string") {
        return byId[candidate] || bySlug[candidate] || byEditorialId[candidate] || null;
      }
      return (
        byId[candidate.id]
        || bySlug[candidate.slug]
        || (candidate.editorialId ? byEditorialId[candidate.editorialId] : null)
        || byEditorialId[candidate.id]
        || null
      );
    },
    [byEditorialId, byId, bySlug],
  );

  const value = useMemo(() => ({
    status: state.status,
    error: state.error,
    ready: state.catalog?.ready === true,
    pending: state.catalog?.pending || [],
    location: state.catalog?.location || null,
    config: state.catalog?.config || {
      pickupEnabled: false,
      deliveryEnabled: false,
      paymentProvider: "pending_payway",
    },
    products,
    byId,
    bySlug,
    byEditorialId,
    resolveProduct,
    refresh,
  }), [
    state.status,
    state.error,
    state.catalog,
    products,
    byId,
    bySlug,
    byEditorialId,
    resolveProduct,
    refresh,
  ]);

  return (
    <CommerceCatalogContext.Provider value={value}>
      {children}
    </CommerceCatalogContext.Provider>
  );
}

export function useCommerceCatalog() {
  const context = useContext(CommerceCatalogContext);
  if (!context) {
    throw new Error("useCommerceCatalog debe usarse dentro de CommerceCatalogProvider");
  }
  return context;
}
