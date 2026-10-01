import { ArrowLeft, Check, ShoppingBag } from "lucide-react";
import { Link, useParams } from "../router";
import PageMeta from "../components/PageMeta";
import PlaceholderImage from "../components/PlaceholderImage";
import ProductCard from "../components/ProductCard";
import { useCart } from "../context/CartContext";
import { useCommerceCatalog } from "../context/CommerceCatalogContext";
import { categoryById } from "../data/categories";
import { getProductAsset } from "../data/assetsManifest";
import { trackEvent } from "../utils/analytics";
import { useEffect } from "react";

const crossSellByCategory = {
  olive_oil: ["olives", "nuts", "seasoned_salts"],
  nuts: ["olive_oil", "jams"],
  olives: ["olive_oil", "seasoned_salts", "nuts"],
  jams: ["nuts", "olive_oil"],
  seasoned_salts: ["olive_oil", "olives"],
};

function formatPrice(price) {
  if (typeof price !== "number") return "Precio no disponible";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(price);
}

export default function ProductPage() {
  const { slug } = useParams();
  const { bySlug, products, status } = useCommerceCatalog();
  const product = bySlug[slug] || null;
  const { addItem, openCart } = useCart();

  useEffect(() => {
    if (!product) return;
    trackEvent("view_item", {
      item_id: product.id,
      item_name: product.name,
      item_category: product.categoryId,
      price: product.price,
    });
  }, [product]);

  if (status === "loading") {
    return (
      <main id="main-content" className="page-shell">
        <section className="section"><div className="container pending-panel">Cargando producto…</div></section>
      </main>
    );
  }

  if (!product) {
    return (
      <main id="main-content" className="page-shell">
        <section className="section">
          <div className="container empty-state">
            <h1>Ese producto no está disponible en el catálogo comercial.</h1>
            <Link className="button" to="/productos">Volver a productos</Link>
          </div>
        </section>
      </main>
    );
  }

  const category = categoryById[product.categoryId] || {
    id: product.categoryId,
    name: product.categoryName || "Producto",
  };
  const productAsset = getProductAsset(product.editorialId || product.id);
  const relatedCategories = crossSellByCategory[product.categoryId] ?? [];
  const relatedProducts = products
    .filter((item) => item.id !== product.id && relatedCategories.includes(item.categoryId))
    .slice(0, 3);

  const addAndOpen = () => {
    if (addItem(product)) openCart();
  };

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    image: product.image ? `${window.location.origin}${product.image}` : undefined,
    category: category.name,
    sku: product.id,
    brand: { "@type": "Brand", name: "Flor Mía" },
    ...(typeof product.price === "number" ? {
      offers: {
        "@type": "Offer",
        priceCurrency: "ARS",
        price: product.price,
        availability: product.commercialReady
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
      },
    } : {}),
  };

  return (
    <main id="main-content" className="page-shell product-page">
      <PageMeta title={`${product.name} | Flor Mía`} description={product.description} />
      <script type="application/ld+json">{JSON.stringify(structuredData)}</script>

      <div className="container breadcrumbs" aria-label="Migas de pan">
        <Link to="/productos"><ArrowLeft size={16} aria-hidden="true" />Productos</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/productos?categoria=${category.id}`}>{category.name}</Link>
        <span aria-hidden="true">/</span>
        <span>{product.name}</span>
      </div>

      <section className="container product-detail">
        <PlaceholderImage
          src={product.image}
          alt={product.imageAlt ?? `Fotografía de ${product.name}`}
          className="product-detail__media"
          aspectRatio="4 / 5"
          eager
          sizes="(max-width: 900px) 100vw, 50vw"
          width={productAsset?.width}
          height={productAsset?.height}
        />
        <div className="product-detail__content">
          <p className="eyebrow">{category.name.toUpperCase()}</p>
          <h1>{product.name}</h1>
          <p className="product-detail__description">{product.description}</p>
          <strong className="product-detail__price">{formatPrice(product.price)}</strong>

          {!product.commercialReady ? (
            <div className="pending-panel">
              <strong>Producto no disponible para checkout</strong>
              <p>Precio, stock o dato fiscal todavía no están completamente configurados.</p>
            </div>
          ) : null}

          <dl className="product-facts">
            <div><dt>Categoría</dt><dd>{category.name}</dd></div>
            {Object.entries(product.attributes || {}).map(([key, value]) => (
              <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{value}</dd></div>
            ))}
            <div><dt>Stock disponible</dt><dd>{Number.isInteger(product.stock) ? product.stock : "No disponible"}</dd></div>
          </dl>

          <button
            className="button button--gold button--block"
            type="button"
            onClick={addAndOpen}
            disabled={!product.commercialReady}
          >
            <ShoppingBag size={19} aria-hidden="true" />
            {product.commercialReady ? "Agregar al carrito" : "No disponible"}
          </button>
          <ul className="product-assurances">
            <li><Check size={16} aria-hidden="true" />Precio y stock se validan nuevamente al confirmar</li>
            <li><Check size={16} aria-hidden="true" />El checkout no emite factura ARCA</li>
          </ul>
        </div>
      </section>

      <section className="section related-products">
        <div className="container">
          <div className="section-heading">
            <p className="eyebrow">PARA COMBINAR</p>
            <h2>Otros sabores para tu mesa.</h2>
          </div>
          <div className="catalog-grid catalog-grid--three">
            {relatedProducts.map((item) => <ProductCard product={item} key={item.id} />)}
          </div>
        </div>
      </section>
    </main>
  );
}
