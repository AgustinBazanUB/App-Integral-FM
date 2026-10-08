import { groupProductSubcategories } from "../../shared/productSubcategories.mjs";
import { Icon } from "../components/icons";
import ProductImage from "../components/ProductImage";
import { Badge } from "../../design-system";
import { formatMoney } from "../formatters";
import { sellerStockStatus } from "./sellerDomain";

export default function SellerCatalogList({ groups, categories, mode }) {
  const stock = mode === "stock";
  return <div className="fm-seller-reference-list">{groups.map(group => <details open key={group.id} className="fm-seller-reference-category">
    <summary><h2>{group.name}</h2><Icon name="ChevronDown" /></summary>
    {groupProductSubcategories(group.items, categories.find(category => category.id === group.id) || { name: group.name }).map(subcategory => <section className="fm-seller-reference-subcategory" key={subcategory.id}>
      {subcategory.name ? <h3>{subcategory.name}</h3> : null}
      {subcategory.items.length ? <div className={stock ? "fm-seller-stock-grid" : "fm-seller-price-category"}>{subcategory.items.map(product => {
        if (!stock) return <article key={product.id}><div><strong>{product.productName}</strong><span>{product.abbreviation}</span></div><div><strong>{formatMoney(product.price)}</strong><small>Stock {product.availableStock}</small></div></article>;
        const status = sellerStockStatus({ ...product, currentStock: product.availableStock });
        return <article key={product.id}><ProductImage product={product} /><div><strong>{product.productName}</strong><span>{product.abbreviation}</span><Badge tone={status.tone}>{status.label}</Badge></div><b aria-label={`Stock de ${product.productName}`}>{product.availableStock}</b></article>;
      })}</div> : <p className="fm-subcategory-empty">Sin productos en esta ubicación.</p>}
    </section>)}
  </details>)}</div>;
}
