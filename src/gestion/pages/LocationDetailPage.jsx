import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  FormField,
  Modal,
  PageHeader,
  Panel,
  SearchInput,
  Select,
  Skeleton,
  Tabs,
  Toast,
} from "../../design-system";
import { INVENTORY_TYPES, movementLabel } from "../../modules/inventory/domain/inventory";
import { isDiscountAvailable } from "../../modules/locations/domain/dashboard";
import { locationActivity, locationSchedule } from "../../modules/locations/domain/locations";
import { Link, useLocation, useNavigate } from "../../router";
import { useAuth } from "../AuthContext";
import HelpTooltip from "../components/HelpTooltip";
import LocationSalesPanel from "../components/LocationSalesPanel";
import { formatDate, formatMoney } from "../formatters";
import { useAsyncData } from "../hooks";
import { can, normalizedRole } from "../permissions";
import {
  addProductToLocation,
  addStockToInventory,
  listInventoryMovements,
  listLocationInventory,
  listMasterProductsForInventory,
  listProductCategoriesForInventory,
  saveLocationProductSettings,
} from "../services/inventoryService";
import {
  loadActiveLocationStock,
  saveValidatedLocationDiscounts,
} from "../services/locationEnhancementsService";
import {
  getLocation,
  listAssignableSellers,
  listDiscounts,
  saveLocationSellers,
} from "../services/locationManagementService";
import { locationTypeLabels } from "./LocationsPage";

const tabs = [
  { id: "stock", label: "Cargar stock" },
  { id: "sellers", label: "Vendedores" },
  { id: "discounts", label: "Descuentos" },
  { id: "sales", label: "Ventas" },
];
const tabIds = new Set(tabs.map((tab) => tab.id));

function ProductImage({ product }) {
  const source = product.thumbUrl || product.imageUrl;
  return source
    ? <img className="fm-product-thumb" src={source} alt={product.productName || product.name || "Producto"} loading="lazy" />
    : <span className="fm-product-thumb fm-product-thumb--empty" aria-label="Imagen pendiente">FM</span>;
}

function SellerAvatar({ seller }) {
  const source = seller.photoUrl || seller.avatarUrl || seller.imageUrl;
  const initials = String(seller.name || seller.email || "FM")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return source
    ? <img className="fm-seller-avatar" src={source} alt="" loading="lazy" />
    : <span className="fm-seller-avatar fm-seller-avatar--initials" aria-hidden="true">{initials}</span>;
}

function movementDate(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.valueOf())
    ? new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(date)
    : "Fecha pendiente";
}

function AddLocationProductModal({ open, location, inventory, categories, profile, onClose, onSaved }) {
  const [state, setState] = useState({ busy: false, loading: false, error: "" });
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [initialStock, setInitialStock] = useState(0);
  const [useDefaultPrice, setUseDefaultPrice] = useState(true);
  const [priceOverride, setPriceOverride] = useState(0);
  const [requestId, setRequestId] = useState("");

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setCategoryId("");
    setSelectedId("");
    setInitialStock(0);
    setUseDefaultPrice(true);
    setPriceOverride(0);
    setRequestId(crypto.randomUUID());
    setState({ busy: false, loading: true, error: "" });
    listMasterProductsForInventory(profile, { includeInactive: false })
      .then((data) => {
        setProducts(data);
        setState({ busy: false, loading: false, error: "" });
      })
      .catch((error) => setState({ busy: false, loading: false, error: error.message }));
  }, [open, profile.id]);

  const assignedIds = useMemo(() => new Set(inventory.map((item) => item.productId || item.id)), [inventory]);
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es");
    return products.filter((product) => {
      if (term && !`${product.name} ${product.abbreviation || ""}`.toLocaleLowerCase("es").includes(term)) return false;
      if (categoryId && product.categoryId !== categoryId) return false;
      return true;
    });
  }, [categoryId, products, search]);
  const selected = products.find((product) => product.id === selectedId);

  const submit = async (event) => {
    event.preventDefault();
    if (!selected) {
      setState((current) => ({ ...current, error: "Elegí un producto del catálogo." }));
      return;
    }
    setState((current) => ({ ...current, busy: true, error: "" }));
    try {
      await addProductToLocation({
        location,
        product: selected,
        initialStock,
        useDefaultPrice,
        priceOverride,
        profile,
        requestId,
      });
      await onSaved?.();
      onClose?.();
    } catch (error) {
      setState((current) => ({ ...current, busy: false, error: error.message }));
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !state.busy && onClose?.()}
      title="Agregar producto"
      description={`Agrega a ${location?.name || "esta ubicación"} un producto que ya existe en el catálogo de Flor Mía.`}
    >
      <form className="fm-inventory-modal" onSubmit={submit}>
        <div className="fm-inventory-picker-filters">
          <SearchInput label="Buscar producto" value={search} onChange={(event) => setSearch(event.target.value)} />
          <Select aria-label="Filtrar por categoría" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">Todas las categorías</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </Select>
        </div>
        {state.loading ? <Skeleton lines={4} /> : null}
        {!state.loading ? (
          <div className="fm-product-select-list" role="radiogroup" aria-label="Productos del catálogo">
            {filtered.map((product) => {
              const assigned = assignedIds.has(product.id);
              return (
                <label key={product.id} className={`${selectedId === product.id ? "is-selected" : ""} ${assigned ? "is-disabled" : ""}`.trim()}>
                  <input type="radio" name="location-product" value={product.id} checked={selectedId === product.id} disabled={assigned} onChange={() => {
                    setSelectedId(product.id);
                    setPriceOverride(Number(product.defaultPrice || 0));
                  }} />
                  <ProductImage product={product} />
                  <span><strong>{product.name}</strong><small>{product.categoryName || "Sin categoría"} · {formatMoney(product.defaultPrice || 0)}</small></span>
                  {assigned ? <Badge tone="neutral">Ya agregado</Badge> : null}
                </label>
              );
            })}
          </div>
        ) : null}
        {!state.loading && !filtered.length ? <EmptyState icon="Boxes" title="No hay productos con estos filtros" /> : null}

        {selected ? (
          <section className="fm-inventory-selection-config">
            <FormField label="Stock inicial" hint="Cuántas unidades hay físicamente ahora en esta ubicación." required>
              <input type="number" min="0" step="1" inputMode="numeric" value={initialStock} onChange={(event) => setInitialStock(event.target.value)} />
            </FormField>
            <div className="fm-price-choice">
              <p><strong>Precio predeterminado del producto:</strong> {formatMoney(selected.defaultPrice || 0)}</p>
              <label className="fm-check-row">
                <input type="checkbox" checked={useDefaultPrice} onChange={(event) => setUseDefaultPrice(event.target.checked)} />
                <span>Usar precio predeterminado</span>
              </label>
              <p className="fm-field__hint">Usa automáticamente el precio definido en Productos. Si ese precio cambia, esta ubicación también se actualiza.</p>
              {!useDefaultPrice ? (
                <FormField label={`Precio especial en ${location.name}`} required>
                  <input type="number" min="0" step="1" inputMode="numeric" value={priceOverride} onChange={(event) => setPriceOverride(event.target.value)} />
                </FormField>
              ) : null}
            </div>
          </section>
        ) : null}

        {state.error ? <Toast tone="error">{state.error}</Toast> : null}
        <div className="fm-dialog-actions">
          <HelpTooltip label="Cierra esta ventana sin agregar ningún producto."><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button></HelpTooltip>
          <HelpTooltip label="Agrega el producto a esta ubicación con el stock inicial y el precio elegidos."><Button type="submit" loading={state.busy} disabled={!selected}>Agregar producto</Button></HelpTooltip>
        </div>
      </form>
    </Modal>
  );
}

function AddStockModal({ open, location, product, profile, onClose, onSaved }) {
  const [quantity, setQuantity] = useState(0);
  const [reason, setReason] = useState("");
  const [requestId, setRequestId] = useState("");
  const [state, setState] = useState({ busy: false, error: "" });
  useEffect(() => {
    if (!open) return;
    setQuantity(0);
    setReason("");
    setRequestId(crypto.randomUUID());
    setState({ busy: false, error: "" });
  }, [open, product?.productId]);
  const current = Number(product?.currentStock || 0);
  const next = current + Math.max(0, Number(quantity || 0));
  const submit = async (event) => {
    event.preventDefault();
    setState({ busy: true, error: "" });
    try {
      await addStockToInventory({
        type: INVENTORY_TYPES.LOCATION,
        inventory: location,
        product,
        quantity,
        reason,
        profile,
        requestId,
      });
      await onSaved?.();
      onClose?.();
    } catch (error) {
      setState({ busy: false, error: error.message });
    }
  };
  return (
    <Modal open={open} onClose={() => !state.busy && onClose?.()} title={`Agregar stock · ${product?.productName || "Producto"}`} description="Suma nuevas unidades y deja registrado el ingreso. El stock actual nunca se reemplaza silenciosamente.">
      <form className="fm-inventory-modal" onSubmit={submit}>
        <dl className="fm-stock-calculation">
          <div><dt>Stock actual</dt><dd>{current}</dd></div>
          <div><dt>Nuevo stock</dt><dd>{next}</dd></div>
        </dl>
        <FormField label="Cantidad a agregar" required><input type="number" min="1" step="1" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></FormField>
        <FormField label="Observación" hint="Opcional. Ejemplo: Ingreso mercadería Mendoza."><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ingreso de mercadería" /></FormField>
        {state.error ? <Toast tone="error">{state.error}</Toast> : null}
        <div className="fm-dialog-actions">
          <HelpTooltip label="Cierra esta ventana sin modificar el stock."><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button></HelpTooltip>
          <HelpTooltip label="Suma esta cantidad al stock actual y registra el movimiento."><Button type="submit" loading={state.busy} disabled={Number(quantity || 0) <= 0}>Confirmar ingreso</Button></HelpTooltip>
        </div>
      </form>
    </Modal>
  );
}

function ProductSettingsModal({ open, location, product, profile, onClose, onSaved }) {
  const [useDefaultPrice, setUseDefaultPrice] = useState(true);
  const [priceOverride, setPriceOverride] = useState(0);
  const [yellowAlertQty, setYellowAlertQty] = useState(0);
  const [redAlertQty, setRedAlertQty] = useState(0);
  const [active, setActive] = useState(true);
  const [state, setState] = useState({ busy: false, error: "" });
  useEffect(() => {
    if (!open || !product) return;
    setUseDefaultPrice(product.usesDefaultPrice !== false);
    setPriceOverride(Number(product.priceOverride ?? product.effectivePrice ?? 0));
    setYellowAlertQty(Number(product.yellowAlertQty || 0));
    setRedAlertQty(Number(product.redAlertQty || 0));
    setActive(product.active !== false);
    setState({ busy: false, error: "" });
  }, [open, product?.productId]);
  const submit = async (event) => {
    event.preventDefault();
    setState({ busy: true, error: "" });
    try {
      await saveLocationProductSettings({
        location,
        productId: product.productId,
        values: { useDefaultPrice, priceOverride, yellowAlertQty, redAlertQty, active },
        profile,
      });
      await onSaved?.();
      onClose?.();
    } catch (error) {
      setState({ busy: false, error: error.message });
    }
  };
  return (
    <Modal open={open} onClose={() => !state.busy && onClose?.()} title={`Configuración · ${product?.productName || "Producto"}`} description={`Define cómo funciona este producto solamente en ${location?.name || "esta ubicación"}.`}>
      <form className="fm-inventory-modal" onSubmit={submit}>
        <div className="fm-price-choice">
          <p><strong>Precio predeterminado:</strong> {formatMoney(product?.defaultPrice || 0)}</p>
          <label className="fm-check-row"><input type="checkbox" checked={useDefaultPrice} onChange={(event) => setUseDefaultPrice(event.target.checked)} /><span>Usar precio predeterminado</span></label>
          <p className="fm-field__hint">Si el precio cambia en Productos, esta ubicación toma el nuevo valor automáticamente.</p>
          {!useDefaultPrice ? <FormField label={`Precio especial en ${location.name}`} required><input type="number" min="0" step="1" inputMode="numeric" value={priceOverride} onChange={(event) => setPriceOverride(event.target.value)} /></FormField> : null}
        </div>
        <div className="fm-form-grid">
          <FormField label="Alerta amarilla" required><input type="number" min="0" step="1" inputMode="numeric" value={yellowAlertQty} onChange={(event) => setYellowAlertQty(event.target.value)} /></FormField>
          <FormField label="Alerta roja" required><input type="number" min="0" step="1" inputMode="numeric" value={redAlertQty} onChange={(event) => setRedAlertQty(event.target.value)} /></FormField>
        </div>
        <label className="fm-check-row"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /><span>Producto habilitado en esta ubicación</span></label>
        {state.error ? <Toast tone="error">{state.error}</Toast> : null}
        <div className="fm-dialog-actions">
          <HelpTooltip label="Cierra esta ventana sin guardar cambios."><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button></HelpTooltip>
          <HelpTooltip label="Guarda el precio y las alertas que usa este producto en esta ubicación."><Button type="submit" loading={state.busy}>Guardar configuración</Button></HelpTooltip>
        </div>
      </form>
    </Modal>
  );
}

function MovementsModal({ open, location, product, onClose }) {
  const [pageSize, setPageSize] = useState(30);
  const result = useAsyncData(
    () => open && product ? listInventoryMovements({ type: INVENTORY_TYPES.LOCATION, inventoryId: location.id, productId: product.productId, pageSize }) : Promise.resolve([]),
    [open, product?.productId, location?.id, pageSize],
  );
  useEffect(() => { if (open) setPageSize(30); }, [open, product?.productId]);
  const movements = result.data || [];
  return (
    <Modal open={open} onClose={onClose} title={`Movimientos · ${product?.productName || "Producto"}`} description="Muestra los ingresos, transferencias y cambios de stock de este producto.">
      {result.status === "loading" ? <Skeleton lines={5} /> : null}
      {result.status === "error" ? <Toast tone="error">{result.error.message}</Toast> : null}
      {result.status === "ready" && !movements.length ? <EmptyState icon="ClipboardList" title="Todavía no hay movimientos registrados" /> : null}
      {movements.length ? <div className="fm-movement-list">{movements.map((movement) => (
        <article key={movement.id}>
          <div><strong>{Number(movement.qty || 0) > 0 ? "+" : ""}{Number(movement.qty || 0)} · {movementLabel(movement)}</strong><small>{movementDate(movement.createdAt)}</small></div>
          <span>{movement.reason || "Sin observación"}</span>
        </article>
      ))}</div> : null}
      {movements.length >= pageSize && pageSize < 120 ? (
        <div className="fm-load-more"><HelpTooltip label="Carga más movimientos anteriores de este producto."><Button variant="secondary" onClick={() => setPageSize((value) => Math.min(120, value + 30))}>Cargar más</Button></HelpTooltip></div>
      ) : null}
    </Modal>
  );
}

export default function LocationDetailPage({ locationId }) {
  const { profile } = useAuth();
  const routeLocation = useLocation();
  const navigate = useNavigate();
  const requestedTab = routeLocation.pathname.split("/").filter(Boolean)[3] || "stock";
  const canAssignSellers = ["admin", "general_admin"].includes(normalizedRole(profile));
  const result = useAsyncData(async () => {
    const location = await getLocation(locationId);
    if (!location) throw new Error("La ubicación no existe o ya no está disponible.");
    const [inventory, categories, discounts, sellers] = await Promise.all([
      listLocationInventory(locationId),
      listProductCategoriesForInventory(profile),
      listDiscounts(profile),
      canAssignSellers ? listAssignableSellers() : Promise.resolve([]),
    ]);
    return { location, inventory, categories, discounts, sellers };
  }, [locationId, profile.id, canAssignSellers]);
  const [activeTab, setActiveTab] = useState(tabIds.has(requestedTab) ? requestedTab : "stock");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [stockProduct, setStockProduct] = useState(null);
  const [settingsProduct, setSettingsProduct] = useState(null);
  const [movementProduct, setMovementProduct] = useState(null);
  const [sellerIds, setSellerIds] = useState([]);
  const [sellerSearch, setSellerSearch] = useState("");
  const [sellerModalOpen, setSellerModalOpen] = useState(false);
  const [pendingSellerIds, setPendingSellerIds] = useState([]);
  const [sellerState, setSellerState] = useState({ busy: false, error: "", success: "" });
  const [discountIds, setDiscountIds] = useState([]);
  const [discountState, setDiscountState] = useState({ busy: false, error: "", success: "" });

  const location = result.data?.location;
  const inventory = result.data?.inventory || [];
  useEffect(() => {
    const next = tabIds.has(requestedTab) ? requestedTab : "stock";
    setActiveTab(next);
  }, [requestedTab]);
  useEffect(() => {
    if (!location) return;
    setSellerIds(location.assignedSellerIds || []);
    setDiscountIds(location.enabledDiscountIds || []);
  }, [location]);

  const visibleInventory = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es");
    return inventory.filter((product) => {
      if (term && !`${product.productName} ${product.abbreviation || ""}`.toLocaleLowerCase("es").includes(term)) return false;
      if (categoryFilter && product.categoryId !== categoryFilter) return false;
      return true;
    });
  }, [categoryFilter, inventory, search]);

  const changeTab = (tabId) => {
    setSearch("");
    setCategoryFilter("");
    setActiveTab(tabId);
    navigate(`/gestion/locations/${encodeURIComponent(locationId)}/${tabId}`);
  };

  const saveSellerSelection = async (nextIds, successMessage) => {
    setSellerState({ busy: true, error: "", success: "" });
    try {
      await saveLocationSellers(location, nextIds, profile);
      setSellerIds(nextIds);
      setSellerModalOpen(false);
      setPendingSellerIds([]);
      setSellerState({ busy: false, error: "", success: successMessage });
      await result.refresh();
    } catch (error) {
      setSellerState({ busy: false, error: error.message, success: "" });
    }
  };

  const toggleDiscount = (discountId) => setDiscountIds((current) => current.includes(discountId) ? current.filter((id) => id !== discountId) : [...current, discountId]);
  const handleDiscountSave = async () => {
    setDiscountState({ busy: true, error: "", success: "" });
    try {
      await saveValidatedLocationDiscounts(location, discountIds, profile);
      setDiscountState({ busy: false, error: "", success: "Los descuentos quedaron habilitados solamente para esta ubicación." });
      await result.refresh();
    } catch (error) {
      setDiscountState({ busy: false, error: error.message, success: "" });
    }
  };

  if (result.status === "loading") return <div className="fm-page-enter"><Skeleton lines={8} /></div>;
  if (result.status === "error") return <div className="fm-page-enter"><Panel><EmptyState icon="AlertTriangle" title="No se pudo abrir la ubicación" description={result.error.message} action={<Link className="fm-button fm-button--secondary" to="/gestion/locations">Volver a ubicaciones</Link>} /></Panel></div>;

  const state = locationActivity(location);
  const schedule = locationSchedule(location);
  const canConfigure = can(profile, "locations", "configureLocationProducts");
  const canLoad = can(profile, "locations", "loadStock");
  const canAssignDiscounts = can(profile, "locations", "assignDiscounts");
  const allSellers = result.data?.sellers || [];
  const assignedSellers = allSellers.filter((seller) => sellerIds.includes(seller.id));
  const availableSellers = allSellers.filter((seller) => {
    if (sellerIds.includes(seller.id) || seller.active !== true || seller.deleted === true) return false;
    const term = sellerSearch.trim().toLocaleLowerCase("es");
    return !term || `${seller.name} ${seller.email}`.toLocaleLowerCase("es").includes(term);
  });

  return (
    <div className="fm-page-enter fm-location-detail">
      <Link className="fm-back-link" to="/gestion/locations">← Volver a Ubicaciones y eventos</Link>
      <PageHeader
        eyebrow="Configuración operativa"
        title={`Ubicación · ${location.name}`}
        description={`${locationTypeLabels[location.type] || "Ubicación"}${schedule.startAt || schedule.endAt ? ` · ${schedule.startAt ? formatDate(schedule.startAt) : "Sin inicio"} a ${schedule.endAt ? formatDate(schedule.endAt) : "Sin fin"}` : " · Operación permanente"}`}
        actions={<Badge tone={state.active ? "success" : state.reason === "deleted" ? "error" : "warning"}>{state.label}</Badge>}
      />
      <div className="fm-location-tabs-desktop"><Tabs tabs={tabs} active={activeTab} onChange={changeTab} /></div>
      <label className="fm-location-tabs-mobile"><span>Sección</span><Select value={activeTab} onChange={(event) => changeTab(event.target.value)}>{tabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}</Select></label>

      {activeTab === "stock" ? (
        <Panel
          title={`Stock de ${location.name}`}
          description="Acá ves solamente los productos disponibles en esta ubicación. Para sumar uno nuevo, elegilo desde el catálogo general."
          action={canConfigure ? <HelpTooltip label="Agrega a esta ubicación un producto que ya existe en el catálogo."><Button icon="Plus" onClick={() => setAddProductOpen(true)}>Agregar producto</Button></HelpTooltip> : null}
        >
          {!state.active ? <Toast tone="error">Esta ubicación no está activa. Podés consultar el stock, pero no ingresar mercadería hasta reactivarla.</Toast> : null}
          {inventory.length ? (
            <>
              <div className="fm-inventory-picker-filters">
                <SearchInput label="Buscar en esta ubicación" value={search} onChange={(event) => setSearch(event.target.value)} />
                <Select aria-label="Filtrar stock por categoría" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">Todas las categorías</option>{result.data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Select>
              </div>
              {visibleInventory.length ? <div className="fm-inventory-card-grid">{visibleInventory.map((product) => (
                <article className="fm-inventory-card" key={product.productId}>
                  <header className="fm-inventory-card__identity"><ProductImage product={product} /><div><h3>{product.productName}</h3><p>{product.categoryName || "Sin categoría"}</p></div><Badge tone={product.active ? "success" : "neutral"}>{product.active ? "Activo" : "Inactivo"}</Badge></header>
                  <dl className="fm-inventory-card__stats">
                    <div><dt>Stock actual</dt><dd>{product.currentStock}</dd></div>
                    <div><dt>Precio efectivo</dt><dd>{formatMoney(product.effectivePrice || 0)}</dd></div>
                  </dl>
                  <p className="fm-price-source">{product.usesDefaultPrice ? "Usa el precio de Productos" : product.legacyPrice ? "Precio local anterior (se conserva sin cambios)" : "Usa un precio especial en esta ubicación"}</p>
                  <footer className="fm-inventory-card__actions">
                    {canLoad ? <HelpTooltip label="Suma nuevas unidades al stock actual de este producto."><Button onClick={() => setStockProduct(product)} disabled={!state.active}>Agregar stock</Button></HelpTooltip> : null}
                    <HelpTooltip label="Muestra los ingresos, transferencias y cambios de stock de este producto."><Button variant="secondary" onClick={() => setMovementProduct(product)}>Movimientos</Button></HelpTooltip>
                    {canConfigure ? <HelpTooltip label="Cambia el precio que usa esta ubicación, las alertas o si el producto está habilitado."><Button variant="ghost" onClick={() => setSettingsProduct(product)}>Configuración</Button></HelpTooltip> : null}
                  </footer>
                </article>
              ))}</div> : <EmptyState icon="Search" title="No hay productos con estos filtros" />}
            </>
          ) : (
            <EmptyState
              icon="Boxes"
              title="Esta ubicación todavía no tiene productos cargados"
              description="Elegí un producto del catálogo y cargá cuántas unidades hay actualmente."
              action={canConfigure ? <HelpTooltip label="Agrega el primer producto a esta ubicación desde el catálogo general."><Button onClick={() => setAddProductOpen(true)}>Agregar producto</Button></HelpTooltip> : null}
            />
          )}
        </Panel>
      ) : null}

      {activeTab === "sellers" ? (
        <Panel title="Vendedores" description="La lista principal muestra únicamente vendedores asignados a esta ubicación." action={canAssignSellers ? <HelpTooltip label="Asigna a esta ubicación uno o más vendedores que ya tienen usuario."><Button icon="UserRoundCheck" onClick={() => { setPendingSellerIds([]); setSellerModalOpen(true); }}>Asignar vendedor</Button></HelpTooltip> : null}>
          {assignedSellers.length ? <div className="fm-assigned-sellers">{assignedSellers.map((seller) => (
            <article className="fm-seller-card" key={seller.id}><SellerAvatar seller={seller} /><div><h3>{seller.name || "Vendedor"}</h3><p>{seller.email || seller.id}</p><Badge tone={seller.active === true ? "success" : "warning"}>{seller.active === true ? "Activo" : "Inactivo"}</Badge></div>{canAssignSellers ? <HelpTooltip label="Quita a este vendedor de la ubicación sin borrar su usuario."><Button variant="ghost" loading={sellerState.busy} onClick={() => saveSellerSelection(sellerIds.filter((id) => id !== seller.id), "El vendedor fue removido de esta ubicación.")}>Quitar</Button></HelpTooltip> : null}</article>
          ))}</div> : <EmptyState icon="UsersRound" title="Todavía no hay vendedores asignados" description="Asigná usuarios existentes sin crear cuentas duplicadas." action={canAssignSellers ? <HelpTooltip label="Elige vendedores existentes para esta ubicación."><Button onClick={() => setSellerModalOpen(true)}>Asignar vendedor</Button></HelpTooltip> : null} />}
          {sellerState.error ? <Toast tone="error">{sellerState.error}</Toast> : null}{sellerState.success ? <Toast tone="success">{sellerState.success}</Toast> : null}
        </Panel>
      ) : null}

      {activeTab === "discounts" ? (
        <Panel title="Descuentos" description="Los descuentos se definen una sola vez; acá elegís cuáles se pueden usar en esta ubicación.">
          <div className="fm-location-discounts">{result.data.discounts.map((discount) => {
            const available = isDiscountAvailable(discount, location, new Date(), { ignoreAssignment: true });
            const enabled = discountIds.includes(discount.id);
            return <label className={!available ? "is-disabled" : ""} key={discount.id}><input type="checkbox" role="switch" checked={enabled} onChange={() => toggleDiscount(discount.id)} disabled={!canAssignDiscounts || !available} /><span><strong>{discount.name}</strong><small>{discount.type === "percent" ? `${discount.value}%` : formatMoney(discount.value)}</small></span><Badge tone={!available ? "error" : enabled ? "success" : "neutral"}>{!available ? "No vigente" : enabled ? "Habilitado" : "Disponible"}</Badge></label>;
          })}</div>
          {!result.data.discounts.length ? <EmptyState icon="Tags" title="No hay descuentos configurados en el sistema" /> : null}
          {discountState.error ? <Toast tone="error">{discountState.error}</Toast> : null}{discountState.success ? <Toast tone="success">{discountState.success}</Toast> : null}
          {canAssignDiscounts ? <HelpTooltip label="Guarda qué descuentos pueden usarse en esta ubicación."><Button icon="Save" loading={discountState.busy} onClick={handleDiscountSave}>Guardar descuentos</Button></HelpTooltip> : <p className="fm-permission-note">Podés consultar los descuentos habilitados, pero no modificarlos.</p>}
        </Panel>
      ) : null}

      {activeTab === "sales" ? <Panel title="Ventas" description="Registro operativo de las ventas asociadas a esta ubicación."><LocationSalesPanel profile={profile} location={location} products={inventory} /></Panel> : null}

      <AddLocationProductModal open={addProductOpen} location={location} inventory={inventory} categories={result.data.categories} profile={profile} onClose={() => setAddProductOpen(false)} onSaved={result.refresh} />
      <AddStockModal open={Boolean(stockProduct)} location={location} product={stockProduct} profile={profile} onClose={() => setStockProduct(null)} onSaved={result.refresh} />
      <ProductSettingsModal open={Boolean(settingsProduct)} location={location} product={settingsProduct} profile={profile} onClose={() => setSettingsProduct(null)} onSaved={result.refresh} />
      <MovementsModal open={Boolean(movementProduct)} location={location} product={movementProduct} onClose={() => setMovementProduct(null)} />

      <Modal open={sellerModalOpen} onClose={() => !sellerState.busy && setSellerModalOpen(false)} title="Asignar vendedores" description="Elegí usuarios existentes. No se crean cuentas nuevas desde acá.">
        <SearchInput label="Buscar vendedor" value={sellerSearch} onChange={(event) => setSellerSearch(event.target.value)} />
        <div className="fm-seller-picker">{availableSellers.map((seller) => <label key={seller.id}><input type="checkbox" checked={pendingSellerIds.includes(seller.id)} onChange={(event) => setPendingSellerIds((current) => event.target.checked ? [...current, seller.id] : current.filter((id) => id !== seller.id))} /><SellerAvatar seller={seller} /><span><strong>{seller.name || "Vendedor"}</strong><small>{seller.email}</small></span></label>)}</div>
        {!availableSellers.length ? <EmptyState icon="UserRound" title="No hay otros vendedores activos disponibles" /> : null}
        {sellerState.error ? <Toast tone="error">{sellerState.error}</Toast> : null}
        <div className="fm-dialog-actions"><HelpTooltip label="Cierra esta ventana sin cambiar vendedores."><Button variant="secondary" onClick={() => setSellerModalOpen(false)}>Cancelar</Button></HelpTooltip><HelpTooltip label="Asigna a esta ubicación los vendedores seleccionados."><Button loading={sellerState.busy} disabled={!pendingSellerIds.length} onClick={() => saveSellerSelection([...new Set([...sellerIds, ...pendingSellerIds])], "Los vendedores seleccionados fueron asignados.")}>Asignar seleccionados</Button></HelpTooltip></div>
      </Modal>
    </div>
  );
}
