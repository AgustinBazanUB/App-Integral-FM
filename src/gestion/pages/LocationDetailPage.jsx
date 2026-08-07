import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  ConfirmationDialog,
  EmptyState,
  FilterBar,
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
import {
  isDiscountAvailable,
  joinMasterProducts,
} from "../../modules/locations/domain/dashboard";
import { locationActivity, locationSchedule } from "../../modules/locations/domain/locations";
import { Link, useLocation, useNavigate } from "../../router";
import { useAuth } from "../AuthContext";
import LocationProductForm from "../components/LocationProductForm";
import LocationSalesPanel from "../components/LocationSalesPanel";
import { Icon } from "../components/icons";
import { formatDate, formatMoney } from "../formatters";
import { useAsyncData } from "../hooks";
import { can, normalizedRole } from "../permissions";
import {
  loadActiveLocationStock,
  saveValidatedLocationDiscounts,
} from "../services/locationEnhancementsService";
import {
  getLocation,
  listAssignableSellers,
  listDiscounts,
  listLocationStockConfiguration,
  listMasterProducts,
  listProductCategories,
  saveLocationProductConfiguration,
  saveLocationSellers,
  setLocationLifecycle,
} from "../services/locationManagementService";
import { locationTypeLabels } from "./LocationsPage";

const tabs = [
  { id: "products", label: "Productos" },
  { id: "stock", label: "Cargar stock" },
  { id: "sellers", label: "Vendedores" },
  { id: "discounts", label: "Descuentos" },
  { id: "sales", label: "Ventas" },
];
const tabIds = new Set(tabs.map((tab) => tab.id));
const emptyConfig = { price: 0, yellowAlertQty: 0, redAlertQty: 0, active: true };

function ProductImage({ product }) {
  const source = product.thumbUrl || product.imageUrl;
  return source ? (
    <img className="fm-product-thumb" src={source} alt={product.imageAlt || product.productName || product.name || "Producto"} loading="lazy" />
  ) : (
    <span className="fm-product-thumb fm-product-thumb--empty" aria-label="Imagen pendiente">FM</span>
  );
}

function SellerAvatar({ seller }) {
  const source = seller.photoUrl || seller.avatarUrl || seller.imageUrl;
  const initials = String(seller.name || seller.email || "FM")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return source ? (
    <img className="fm-seller-avatar" src={source} alt="" loading="lazy" />
  ) : (
    <span className="fm-seller-avatar fm-seller-avatar--initials" aria-hidden="true">{initials}</span>
  );
}

function discountRestrictions(discount) {
  const restrictions = [];
  if (discount.allowedRoles?.length) restrictions.push(`Roles: ${discount.allowedRoles.join(", ")}`);
  if (discount.categoryIds?.length) restrictions.push(`${discount.categoryIds.length} categorías`);
  if (discount.productIds?.length) restrictions.push(`${discount.productIds.length} productos`);
  if (discount.locationIds?.length) restrictions.push(`${discount.locationIds.length} ubicaciones específicas`);
  return restrictions.length ? restrictions.join(" · ") : "Sin restricciones adicionales";
}

function stockFinal(product, value, mode) {
  if (String(value ?? "").trim() === "") return Number(product.currentStock || 0);
  const requested = Number(value || 0);
  if (mode === "add") return Number(product.currentStock || 0) + requested;
  if (mode === "adjust") return requested;
  return Number(product.currentStock || 0) + requested - Number(product.initialStock || 0);
}

export default function LocationDetailPage({ locationId }) {
  const { profile } = useAuth();
  const routeLocation = useLocation();
  const navigate = useNavigate();
  const requestedTab = routeLocation.pathname.split("/").filter(Boolean)[3] || "products";
  const canAssignSellers = ["admin", "general_admin"].includes(normalizedRole(profile));
  const result = useAsyncData(async () => {
    const location = await getLocation(locationId);
    if (!location) throw new Error("La ubicación no existe o ya no está disponible.");
    const [products, stock, categories, discounts, sellers] = await Promise.all([
      listMasterProducts(profile),
      listLocationStockConfiguration(locationId),
      listProductCategories(profile),
      listDiscounts(profile),
      canAssignSellers ? listAssignableSellers() : Promise.resolve([]),
    ]);
    return { location, products, stock, categories, discounts, sellers };
  }, [locationId, profile.id, canAssignSellers]);
  const [activeTab, setActiveTab] = useState(tabIds.has(requestedTab) ? requestedTab : "products");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [productStatus, setProductStatus] = useState("all");
  const [stockMode, setStockMode] = useState("initial");
  const [stockReason, setStockReason] = useState("");
  const [stockValues, setStockValues] = useState({});
  const [stockState, setStockState] = useState({ busy: false, error: "", success: "", operationId: "" });
  const [pendingStock, setPendingStock] = useState(null);
  const [sellerIds, setSellerIds] = useState([]);
  const [sellerSearch, setSellerSearch] = useState("");
  const [sellerModalOpen, setSellerModalOpen] = useState(false);
  const [pendingSellerIds, setPendingSellerIds] = useState([]);
  const [sellerState, setSellerState] = useState({ busy: false, error: "", success: "" });
  const [discountIds, setDiscountIds] = useState([]);
  const [discountState, setDiscountState] = useState({ busy: false, error: "", success: "" });
  const [configProduct, setConfigProduct] = useState(null);
  const [configValues, setConfigValues] = useState(emptyConfig);
  const [configState, setConfigState] = useState({ busy: false, error: "" });
  const [productFormOpen, setProductFormOpen] = useState(false);
  const [editingMasterProduct, setEditingMasterProduct] = useState(null);
  const [lifecycleState, setLifecycleState] = useState({ busy: false, error: "" });

  const location = result.data?.location;
  const products = useMemo(() => joinMasterProducts(result.data?.products || [], result.data?.stock || []), [result.data]);

  useEffect(() => {
    const next = tabIds.has(requestedTab) ? requestedTab : "products";
    setActiveTab(next);
  }, [requestedTab]);
  useEffect(() => {
    if (!location) return;
    setSellerIds(location.assignedSellerIds || []);
    setDiscountIds(location.enabledDiscountIds || []);
  }, [location]);

  const changeTab = (tabId) => {
    setActiveTab(tabId);
    setSearch("");
    navigate(`/gestion/locations/${encodeURIComponent(locationId)}/${tabId}`);
  };

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es");
    return products.filter((product) => {
      if (term && !`${product.productName} ${product.abbreviation || ""}`.toLocaleLowerCase("es").includes(term)) return false;
      if (categoryFilter && product.categoryId !== categoryFilter) return false;
      if (productStatus === "configured" && !product.configured) return false;
      if (productStatus === "unconfigured" && product.configured) return false;
      if (productStatus === "active" && !product.active) return false;
      if (productStatus === "inactive" && product.active) return false;
      return true;
    });
  }, [categoryFilter, productStatus, products, search]);

  const productGroups = useMemo(() => {
    const categoryMap = new Map((result.data?.categories || []).map((category) => [category.id, { ...category, items: [] }]));
    const uncategorized = { id: "uncategorized", name: "Sin categoría", items: [] };
    visibleProducts.forEach((product) => {
      const group = categoryMap.get(product.categoryId) || uncategorized;
      group.items.push(product);
    });
    return [...categoryMap.values(), uncategorized].filter((group) => group.items.length);
  }, [result.data?.categories, visibleProducts]);

  const updateStockValue = (product, key, value) => setStockValues((current) => ({
    ...current,
    [product.id]: {
      price: product.price,
      yellowAlertQty: product.yellowAlertQty || 0,
      redAlertQty: product.redAlertQty || 0,
      active: product.active,
      ...current[product.id],
      [key]: value,
    },
  }));
  const preparedStockEntries = () => products
    .filter((product) => String(stockValues[product.id]?.quantity ?? "").trim() !== "")
    .map((product) => ({ product, ...stockValues[product.id] }));
  const wouldReduceStock = (entries) => entries.some((entry) => stockFinal(entry.product, entry.quantity, stockMode) < Number(entry.product.currentStock || 0));
  const executeStock = async (entries) => {
    const operationId = stockState.operationId || crypto.randomUUID();
    setStockState({ busy: true, error: "", success: "", operationId });
    try {
      const operation = await loadActiveLocationStock({ location, entries, mode: stockMode, reason: stockReason, profile, operationId });
      setStockValues({});
      setStockReason("");
      setPendingStock(null);
      setStockState({ busy: false, error: "", success: `Operación ${operation.operationId} confirmada para ${operation.itemCount} productos.`, operationId: "" });
      await result.refresh();
    } catch (error) {
      setPendingStock(null);
      setStockState({ busy: false, error: `${error.message} Podés reintentar sin duplicar la operación.`, success: "", operationId });
    }
  };
  const handleStockSubmit = (event) => {
    event.preventDefault();
    const entries = preparedStockEntries();
    if (!entries.length) {
      setStockState((current) => ({ ...current, error: "Ingresá al menos una cantidad.", success: "" }));
      return;
    }
    if (wouldReduceStock(entries)) setPendingStock(entries);
    else executeStock(entries);
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
  const removeSeller = (sellerId) => saveSellerSelection(sellerIds.filter((id) => id !== sellerId), "El vendedor fue removido de esta ubicación.");
  const assignSelectedSellers = () => saveSellerSelection([...new Set([...sellerIds, ...pendingSellerIds])], "Los vendedores seleccionados fueron asignados.");

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

  const openProductConfig = (product) => {
    setConfigProduct(product);
    setConfigValues({ price: product.price || 0, yellowAlertQty: product.yellowAlertQty || 0, redAlertQty: product.redAlertQty || 0, active: product.active !== false });
    setConfigState({ busy: false, error: "" });
  };
  const handleProductConfig = async (event) => {
    event.preventDefault();
    setConfigState({ busy: true, error: "" });
    try {
      await saveLocationProductConfiguration({ location, product: configProduct, values: configValues, profile });
      setConfigProduct(null);
      await result.refresh();
    } catch (error) {
      setConfigState({ busy: false, error: error.message });
    }
  };
  const openNewProduct = () => {
    setEditingMasterProduct(null);
    setProductFormOpen(true);
  };
  const openEditProduct = (product) => {
    setEditingMasterProduct(product);
    setProductFormOpen(true);
  };
  const activateLocation = async () => {
    setLifecycleState({ busy: true, error: "" });
    try {
      await setLocationLifecycle(location, "activate", profile);
      await result.refresh();
      setLifecycleState({ busy: false, error: "" });
    } catch (error) {
      setLifecycleState({ busy: false, error: error.message });
    }
  };

  if (result.status === "loading") return <div className="fm-page-enter"><Skeleton lines={8} /></div>;
  if (result.status === "error") return <div className="fm-page-enter"><Panel><EmptyState icon="AlertTriangle" title="No se pudo abrir la ubicación" description={result.error.message} action={<Link className="fm-button fm-button--secondary" to="/gestion/locations">Volver a ubicaciones</Link>} /></Panel></div>;

  const state = locationActivity(location);
  const schedule = locationSchedule(location);
  const canConfigure = can(profile, "locations", "configureLocationProducts");
  const canCreateProducts = can(profile, "locations", "createLocationProducts");
  const canEditMasterProducts = can(profile, "locations", "editMasterProducts");
  const canLoad = can(profile, "locations", stockMode === "adjust" ? "adjustStock" : "loadStock");
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

      {activeTab === "products" ? (
        <Panel title="Productos" description="Catálogo maestro único, organizado por categoría y unido a la configuración local." action={canCreateProducts ? <Button icon="Plus" onClick={openNewProduct}>Agregar nuevo producto</Button> : null}>
          <FilterBar search={<SearchInput label="Buscar producto" value={search} onChange={(event) => setSearch(event.target.value)} />}>
            <Select aria-label="Filtrar por categoría" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">Todas las categorías</option>{result.data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Select>
            <Select aria-label="Filtrar por estado" value={productStatus} onChange={(event) => setProductStatus(event.target.value)}><option value="all">Todos</option><option value="configured">Con stock configurado</option><option value="unconfigured">Sin configurar</option><option value="active">Activos</option><option value="inactive">Inactivos</option></Select>
          </FilterBar>
          {productGroups.length ? <div className="fm-product-category-groups">{productGroups.map((group) => (
            <details className="fm-product-category" key={group.id} open={Boolean(search || categoryFilter) || undefined}>
              <summary><span><Icon name="Boxes" /><strong>{group.name}</strong></span><Badge tone="neutral">{group.items.length} productos</Badge></summary>
              <div className="fm-location-product-grid">{group.items.map((product) => (
                <article className="fm-location-product-card" key={product.id}>
                  <ProductImage product={product} />
                  <div className="fm-location-product-card__main"><h3>{product.productName}</h3><p>{product.abbreviation || "Sin abreviación"}</p><div><Badge tone={!product.configured ? "warning" : product.active ? "success" : "neutral"}>{!product.configured ? "Sin configurar" : product.active ? "Activo" : "Inactivo"}</Badge>{product.imageStatus === "pending" ? <Badge tone="warning">Imagen pendiente</Badge> : null}</div></div>
                  <dl><div><dt>Precio local</dt><dd>{formatMoney(product.price)}</dd></div><div><dt>Stock actual</dt><dd>{product.currentStock}</dd></div><div><dt>Alertas</dt><dd>{product.yellowAlertQty || 0} / {product.redAlertQty || 0}</dd></div></dl>
                  <footer>{canConfigure ? <Button variant="secondary" onClick={() => openProductConfig(product)}>Configurar ubicación</Button> : null}{canEditMasterProducts ? <Button variant="ghost" onClick={() => openEditProduct(product)}>Editar producto</Button> : null}</footer>
                </article>
              ))}</div>
            </details>
          ))}</div> : <EmptyState icon="Boxes" title="No hay productos con estos filtros" />}
        </Panel>
      ) : null}

      {activeTab === "stock" ? (
        <Panel title="Cargar stock" description="La operación es atómica, valida el estado actual de la ubicación y registra un movimiento por producto.">
          {!state.active ? <Toast tone="error"><span>Esta ubicación debe estar activa para cargar stock.</span>{can(profile, "locations", "edit") ? <Button variant="secondary" loading={lifecycleState.busy} onClick={activateLocation}>Activar ubicación</Button> : null}</Toast> : null}
          {lifecycleState.error ? <Toast tone="error">{lifecycleState.error}</Toast> : null}
          <form onSubmit={handleStockSubmit}>
            <div className="fm-stock-mode-row">
              <FormField label="Modo de carga" required><Select value={stockMode} onChange={(event) => { setStockMode(event.target.value); setStockState({ busy: false, error: "", success: "", operationId: "" }); }}><option value="initial">Configurar stock inicial</option><option value="add">Agregar mercadería</option><option value="adjust">Ajustar inventario</option></Select></FormField>
              <FormField label="Motivo" hint={stockMode === "adjust" ? "Obligatorio para justificar el ajuste." : "Quedará registrado en el movimiento."}><input className="fm-stock-reason-input" value={stockReason} onChange={(event) => setStockReason(event.target.value)} required={stockMode === "adjust"} placeholder={stockMode === "add" ? "Reposición depósito" : "Motivo de la operación"} /></FormField>
            </div>
            <div className="fm-stock-filter-row">
              <SearchInput label="Buscar producto para cargar" value={search} onChange={(event) => setSearch(event.target.value)} />
              <Select aria-label="Filtrar stock por categoría" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">Todas las categorías</option>{result.data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Select>
            </div>
            <div className="fm-stock-load-list">
              {visibleProducts.filter((product) => product.masterActive).map((product) => {
                const value = stockValues[product.id]?.quantity ?? "";
                const finalValue = stockFinal(product, value, stockMode);
                return <label key={product.id} className="fm-stock-load-row">
                  <ProductImage product={product} />
                  <span className="fm-stock-load-row__identity"><strong>{product.productName}</strong><small>Stock actual: <b>{product.currentStock}</b> · Inicial: <b>{product.initialStock || 0}</b></small></span>
                  <span className="fm-stock-load-row__field"><small>{stockMode === "add" ? "Cantidad a agregar" : stockMode === "adjust" ? "Nuevo stock real" : "Stock inicial"}</small><input type="number" min="0" step="1" inputMode="numeric" disabled={!state.active} value={value} onChange={(event) => updateStockValue(product, "quantity", event.target.value)} placeholder="0" /></span>
                  <span className="fm-stock-final"><small>Stock final</small><strong>{finalValue}</strong><span>{finalValue < Number(product.currentStock || 0) ? "Disminuye" : finalValue > Number(product.currentStock || 0) ? "Aumenta" : "Sin cambios"}</span></span>
                </label>;
              })}
            </div>
            {stockState.error ? <Toast tone="error">{stockState.error}</Toast> : null}
            {stockState.success ? <Toast tone="success">{stockState.success}</Toast> : null}
            {canLoad ? <Button type="submit" icon="PackagePlus" loading={stockState.busy} disabled={!state.active}>Confirmar carga</Button> : <p className="fm-permission-note">Tu perfil puede consultar stock, pero no modificarlo.</p>}
          </form>
        </Panel>
      ) : null}

      {activeTab === "sellers" ? (
        <Panel title="Vendedores" description="La lista principal muestra únicamente vendedores asignados a esta ubicación." action={canAssignSellers ? <Button icon="UserRoundCheck" onClick={() => { setPendingSellerIds([]); setSellerModalOpen(true); }}>Asignar vendedor</Button> : null}>
          {assignedSellers.length ? <div className="fm-assigned-sellers">{assignedSellers.map((seller) => (
            <article className="fm-seller-card" key={seller.id}><SellerAvatar seller={seller} /><div><h3>{seller.name || "Vendedor"}</h3><p>{seller.email || seller.id}</p><Badge tone={seller.active === true ? "success" : "warning"}>{seller.active === true ? "Activo" : "Inactivo"}</Badge></div>{canAssignSellers ? <Button variant="ghost" loading={sellerState.busy} onClick={() => removeSeller(seller.id)}>Quitar</Button> : null}</article>
          ))}</div> : <EmptyState icon="UsersRound" title="Todavía no hay vendedores asignados" description="Asigná usuarios existentes sin crear cuentas duplicadas." action={canAssignSellers ? <Button onClick={() => setSellerModalOpen(true)}>Asignar vendedor</Button> : null} />}
          {sellerState.error ? <Toast tone="error">{sellerState.error}</Toast> : null}{sellerState.success ? <Toast tone="success">{sellerState.success}</Toast> : null}
        </Panel>
      ) : null}

      {activeTab === "discounts" ? (
        <Panel title="Descuentos" description="Las definiciones siguen siendo globales; aquí sólo se guardan sus IDs habilitados para esta ubicación.">
          <div className="fm-location-discounts">{result.data.discounts.map((discount) => {
            const available = isDiscountAvailable(discount, location, new Date(), { ignoreAssignment: true });
            const enabled = discountIds.includes(discount.id);
            return <label className={!available ? "is-disabled" : ""} key={discount.id}>
              <input type="checkbox" role="switch" checked={enabled} onChange={() => toggleDiscount(discount.id)} disabled={!canAssignDiscounts || !available} />
              <span><strong>{discount.name}</strong><small>{discount.type === "percent" ? `${discount.value}%` : formatMoney(discount.value)}{discount.validUntil ? ` · hasta ${formatDate(discount.validUntil)}` : " · sin vencimiento"}</small><small>{discountRestrictions(discount)}</small></span>
              <Badge tone={!available ? "error" : enabled ? "success" : "neutral"}>{!available ? "No vigente" : enabled ? "Habilitado" : "Disponible"}</Badge>
            </label>;
          })}</div>
          {!result.data.discounts.length ? <EmptyState icon="Tags" title="No hay descuentos configurados en el sistema" /> : null}
          {discountState.error ? <Toast tone="error">{discountState.error}</Toast> : null}{discountState.success ? <Toast tone="success">{discountState.success}</Toast> : null}
          {canAssignDiscounts ? <Button icon="Save" loading={discountState.busy} onClick={handleDiscountSave}>Guardar descuentos</Button> : <p className="fm-permission-note">Podés consultar los descuentos habilitados, pero no modificarlos.</p>}
        </Panel>
      ) : null}

      {activeTab === "sales" ? (
        <Panel title="Ventas" description="Registro operativo de las ventas asociadas a esta ubicación. No se crean copias de los documentos.">
          <LocationSalesPanel profile={profile} location={location} products={products} />
        </Panel>
      ) : null}

      <ConfirmationDialog open={Boolean(pendingStock)} onClose={() => !stockState.busy && setPendingStock(null)} onConfirm={() => executeStock(pendingStock)} busy={stockState.busy} title="Confirmar reducción de stock" description="Uno o más productos quedarán con menos unidades. El ajuste se registrará con su cantidad anterior y posterior." />

      <Modal open={Boolean(configProduct)} onClose={() => !configState.busy && setConfigProduct(null)} title={`Configurar ${configProduct?.productName || "producto"}`} description={`Los datos maestros no se modifican; estos valores corresponden únicamente a ${location.name}.`}>
        <form className="fm-form-grid" onSubmit={handleProductConfig}>
          <FormField label="Precio local" required><input type="number" min="0" step="1" value={configValues.price} onChange={(event) => setConfigValues({ ...configValues, price: event.target.value })} /></FormField>
          <FormField label="Alerta amarilla" required><input type="number" min="0" step="1" value={configValues.yellowAlertQty} onChange={(event) => setConfigValues({ ...configValues, yellowAlertQty: event.target.value })} /></FormField>
          <FormField label="Alerta roja" required><input type="number" min="0" step="1" value={configValues.redAlertQty} onChange={(event) => setConfigValues({ ...configValues, redAlertQty: event.target.value })} /></FormField>
          <label className="fm-check-row fm-form-grid__full"><input type="checkbox" checked={configValues.active} onChange={(event) => setConfigValues({ ...configValues, active: event.target.checked })} /><span>Producto activo en esta ubicación</span></label>
          {configState.error ? <p className="fm-form-error fm-form-grid__full" role="alert">{configState.error}</p> : null}
          <div className="fm-dialog-actions fm-form-grid__full"><Button variant="secondary" onClick={() => setConfigProduct(null)}>Cancelar</Button><Button type="submit" loading={configState.busy}>Guardar configuración</Button></div>
        </form>
      </Modal>

      <Modal open={sellerModalOpen} onClose={() => !sellerState.busy && setSellerModalOpen(false)} title="Asignar vendedor" description="Seleccioná uno o varios usuarios existentes que todavía no están asignados.">
        <SearchInput label="Buscar vendedor disponible" value={sellerSearch} onChange={(event) => setSellerSearch(event.target.value)} />
        <div className="fm-seller-picker">{availableSellers.map((seller) => <label key={seller.id}><input type="checkbox" checked={pendingSellerIds.includes(seller.id)} onChange={() => setPendingSellerIds((current) => current.includes(seller.id) ? current.filter((id) => id !== seller.id) : [...current, seller.id])} /><SellerAvatar seller={seller} /><span><strong>{seller.name || "Vendedor"}</strong><small>{seller.email || seller.id}</small></span></label>)}</div>
        {!availableSellers.length ? <EmptyState icon="UserRoundCheck" title="No hay vendedores disponibles" description="Todos los vendedores activos ya están asignados o no coinciden con la búsqueda." /> : null}
        <div className="fm-dialog-actions"><Link className="fm-button fm-button--secondary" to="/gestion/administration">Crear nuevo vendedor</Link><Button loading={sellerState.busy} disabled={!pendingSellerIds.length} onClick={assignSelectedSellers}>Confirmar asignación</Button></div>
      </Modal>

      <LocationProductForm open={productFormOpen} product={editingMasterProduct} categories={result.data.categories} location={location} profile={profile} onClose={() => setProductFormOpen(false)} onSaved={result.refresh} />
    </div>
  );
}
