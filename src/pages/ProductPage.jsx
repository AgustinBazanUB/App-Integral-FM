import { ArrowLeft, Check, ShoppingBag } from "lucide-react";
import { Link, useParams } from "../router";
import PageMeta from "../components/PageMeta";
import PlaceholderImage from "../components/PlaceholderImage";
import ProductCard from "../components/ProductCard";
import { useCart } from "../context/CartContext";
import { categoryById } from "../data/categories";
import { products } from "../data/products";
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

export default function ProductPage() {
  const { slug } = useParams();
  const product = products.find((item) => item.slug === slug);
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

  if (!product) {
    return (
      <main id="main-content" className="page-shell">
        <section className="section">
          <div className="container empty-state">
            <h1>Ese producto todavía no está en el catálogo.</h1>
            <Link className="button" to="/productos">
              Volver a productos
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const category = categoryById[product.categoryId];
  const productAsset = getProductAsset(product.id);
  const relatedCategories = crossSellByCategory[product.categoryId] ?? [];
  const relatedProducts = products
    .filter(
      (item) =>
        item.id !== product.id && relatedCategories.includes(item.categoryId),
    )
    .slice(0, 3);

  const addAndOpen = () => {
    addItem(product);
    openCart();
  };

  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Productos",
            item: `${window.location.origin}/productos`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: category.name,
            item: `${window.location.origin}/productos?categoria=${category.id}`,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: product.name,
            item: window.location.href,
          },
        ],
      },
      {
        "@type": "Product",
        name: product.name,
        description: product.description,
        image: `${window.location.origin}${product.image}`,
        category: category.name,
        sku: product.id,
        brand: {
          "@type": "Brand",
          name: "Flor Mía",
        },
      },
    ],
  };

  return (
    <main id="main-content" className="page-shell product-page">
      <PageMeta
        title={`${product.name} | Flor Mía`}
        description={`${product.description} Datos comerciales pendientes de confirmación.`}
      />
      <script type="application/ld+json">
        {JSON.stringify(structuredData)}
      </script>

      <div className="container breadcrumbs" aria-label="Migas de pan">
        <Link to="/productos">
          <ArrowLeft size={16} aria-hidden="true" />
          Productos
        </Link>
        <span aria-hidden="true">/</span>
        <Link to={`/productos?categoria=${category.id}`}>{category.name}</Link>
        <span aria-hidden="true">/</span>
        <span>{product.name}</span>
      </div>

      <section className="container product-detail">
        <PlaceholderImage
          src={product.image}
          alt={product.imageAlt ?? `Fotografía real de ${product.name}`}
          className="product-detail__media"
          aspectRatio="4 / 5"
          eager
          sizes="(max-width: 900px) 100vw, 50vw"
          width={productAsset?.width}
          height={productAsset?.height}
        />
        <div className="product-detail__content">
          <p className="eyebrow">{category.name.toUpperCase()}</p>
          <span className="badge">{product.badge}</span>
          <h1>{product.name}</h1>
          <p className="product-detail__description">{product.description}</p>

          <div className="pending-panel">
            <strong>Ficha comercial pendiente</strong>
            <p>
              Precio, stock y datos técnicos deben ser confirmados por Flor Mía
              antes de vender.
            </p>
          </div>

          <dl className="product-facts">
            <div>
              <dt>Categoría</dt>
              <dd>{category.name}</dd>
            </div>
            {Object.entries(product.attributes).map(([key, value]) => (
              <div key={key}>
                <dt>{key.replaceAll("_", " ")}</dt>
                <dd>{value}</dd>
              </div>
            ))}
            <div>
              <dt>Presentación</dt>
              <dd>{product.formats[0]}</dd>
            </div>
            <div>
              <dt>Stock</dt>
              <dd>A confirmar</dd>
            </div>
          </dl>

          <button className="button button--gold button--block" type="button" onClick={addAndOpen}>
            <ShoppingBag size={19} aria-hidden="true" />
            Agregar a mi selección
          </button>
          <ul className="product-assurances">
            <li>
              <Check size={16} aria-hidden="true" />
              Se guarda en este dispositivo
            </li>
            <li>
              <Check size={16} aria-hidden="true" />
              No se procesa ningún pago todavía
            </li>
          </ul>
        </div>
      </section>

      <section className="section related-products">
        <div className="container">
          <div className="section-heading">
            <p className="eyebrow">PARA COMBINAR</p>
            <h2>Otros sabores para tu mesa.</h2>
            <p className="section-heading__body">
              Sugerencias configurables. Nada se agrega automáticamente.
            </p>
          </div>
          <div className="catalog-grid catalog-grid--three">
            {relatedProducts.map((item) => (
              <ProductCard product={item} key={item.id} />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
