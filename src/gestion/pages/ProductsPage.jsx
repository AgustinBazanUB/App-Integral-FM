import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  FilterBar,
  PageHeader,
  Panel,
  SearchInput,
  Select,
  Skeleton,
  Toast,
} from "../../design-system";
import { useAuth } from "../AuthContext";
import HelpTooltip from "../components/HelpTooltip";
import ProductForm from "../components/ProductForm";
import { formatMoney } from "../formatters";
import { useAsyncData } from "../hooks";
import { can } from "../permissions";
import {
  listMasterProductsForInventory,
  listProductCategoriesForInventory,
} from "../services/inventoryService";

function ProductImage({ product }) {
  const source = product.thumbUrl || product.imageUrl;
  return source
    ? <img className="fm-product-thumb" src={source} alt={product.imageAlt || product.name || "Producto"} loading="lazy" />
    : <span className="fm-product-thumb fm-product-thumb--empty" aria-label="Imagen pendiente">FM</span>;
}

export default function ProductsPage() {
  const { profile } = useAuth();
  const result = useAsyncData(async () => {
    const [products, categories] = await Promise.all([
      listMasterProductsForInventory(profile, { includeInactive: true }),
      listProductCategoriesForInventory(profile),
    ]);
    return { products, categories };
  }, [profile.id]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [message, setMessage] = useState("");

  const products = result.data?.products || [];
  const categories = result.data?.categories || [];
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es");
    return products.filter((product) => {
      if (term && !`${product.name || ""} ${product.abbreviation || ""} ${product.description || ""}`.toLocaleLowerCase("es").includes(term)) return false;
      if (categoryId && product.categoryId !== categoryId) return false;
      if (status === "active" && product.active === false) return false;
      if (status === "inactive" && product.active !== false) return false;
      return true;
    });
  }, [categoryId, products, search, status]);

  const openNew = () => {
    setEditingProduct(null);
    setFormOpen(true);
  };
  const openEdit = (product) => {
    setEditingProduct(product);
    setFormOpen(true);
  };

  if (result.status === "loading") return <div className="fm-page-enter"><Skeleton lines={8} /></div>;
  if (result.status === "error") return <div className="fm-page-enter"><Panel><EmptyState icon="AlertTriangle" title="No se pudo abrir Productos" description={result.error.message} /></Panel></div>;

  const canCreate = can(profile, "products", "create");
  const canEdit = can(profile, "products", "edit");

  return (
    <div className="fm-page-enter fm-products-page">
      <PageHeader
        eyebrow="Catálogo general"
        title="Productos"
        description="Acá administrás el catálogo general de Flor Mía. El stock de cada lugar se carga después desde Ubicaciones o Depósitos."
        actions={canCreate ? (
          <HelpTooltip label="Crea un producto nuevo en el catálogo general de Flor Mía.">
            <Button icon="Plus" onClick={openNew}>Nuevo producto</Button>
          </HelpTooltip>
        ) : null}
      />

      <Panel title="Catálogo maestro" description="Cada producto existe una sola vez. Buscar o editar acá no modifica el stock de ningún lugar.">
        <FilterBar search={<SearchInput label="Buscar producto" value={search} onChange={(event) => setSearch(event.target.value)} />}>
          <Select aria-label="Filtrar por categoría" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">Todas las categorías</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </Select>
          <Select aria-label="Filtrar por estado" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">Todos</option>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
          </Select>
        </FilterBar>

        {message ? <Toast tone="success">{message}</Toast> : null}
        {filtered.length ? (
          <div className="fm-inventory-card-grid">
            {filtered.map((product) => (
              <article className="fm-inventory-card" key={product.id}>
                <header className="fm-inventory-card__identity">
                  <ProductImage product={product} />
                  <div>
                    <h3>{product.name}</h3>
                    <p>{product.categoryName || "Sin categoría"}{product.abbreviation ? ` · ${product.abbreviation}` : ""}</p>
                  </div>
                  <Badge tone={product.active === false ? "neutral" : "success"}>{product.active === false ? "Inactivo" : "Activo"}</Badge>
                </header>
                {product.description ? <p className="fm-inventory-card__description">{product.description}</p> : null}
                <dl className="fm-inventory-card__stats">
                  <div><dt>Precio predeterminado</dt><dd>{formatMoney(product.defaultPrice || 0)}</dd></div>
                  <div><dt>Alertas</dt><dd>{Number(product.yellowAlertQty || 0)} / {Number(product.redAlertQty || 0)}</dd></div>
                </dl>
                {canEdit ? (
                  <footer className="fm-inventory-card__actions">
                    <HelpTooltip label="Edita los datos generales de este producto, incluido su precio predeterminado.">
                      <Button variant="secondary" onClick={() => openEdit(product)}>Editar producto</Button>
                    </HelpTooltip>
                  </footer>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="Boxes"
            title={products.length ? "No hay productos con estos filtros" : "Todavía no hay productos"}
            description={products.length ? "Probá cambiar la búsqueda o la categoría." : "Creá el primer producto del catálogo general."}
            action={canCreate && !products.length ? (
              <HelpTooltip label="Crea el primer producto del catálogo general de Flor Mía.">
                <Button onClick={openNew}>Nuevo producto</Button>
              </HelpTooltip>
            ) : null}
          />
        )}
      </Panel>

      <ProductForm
        open={formOpen}
        product={editingProduct}
        categories={categories}
        profile={profile}
        onClose={() => setFormOpen(false)}
        onSaved={async () => {
          await result.refresh();
          setMessage(editingProduct ? "Producto actualizado." : "Producto creado en el catálogo general.");
        }}
      />
    </div>
  );
}
