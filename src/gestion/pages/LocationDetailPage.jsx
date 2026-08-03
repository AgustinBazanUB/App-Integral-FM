import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  ConfirmationDialog,
  DataTable,
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
import { Link } from "../../router";
import { useAuth } from "../AuthContext";
import { formatDate, formatMoney } from "../formatters";
import { useAsyncData } from "../hooks";
import { can, normalizedRole } from "../permissions";
import {
  getLocation,
  listAssignableSellers,
  listDiscounts,
  listLocationStockConfiguration,
  listMasterProducts,
  listProductCategories,
  loadLocationStock,
  saveLocationDiscounts,
  saveLocationProductConfiguration,
  saveLocationSellers,
} from "../services/locationManagementService";
import { locationTypeLabels } from "./LocationsPage";

const tabs = [
  { id: "products", label: "Productos" },
  { id: "stock", label: "Cargar stock" },
  { id: "sellers", label: "Vendedores" },
  { id: "discounts", label: "Descuentos" },
];

const emptyConfig = { price: 0, yellowAlertQty: 0, redAlertQty: 0, active: true };

function ProductImage({ product }) {
  const source = product.thumbUrl || product.imageUrl;
  return source ? <img className="fm-product-thumb" src={source} alt="" loading="lazy" /> : <span className="fm-product-thumb fm-product-thumb--empty" aria-hidden="true">FM</span>;
}

export default function LocationDetailPage({ locationId }) {
  const { profile } = useAuth();
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
  const [activeTab, setActiveTab] = useState("products");
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
  const [sellerState, setSellerState] = useState({ busy: false, error: "", success: "" });
  const [discountIds, setDiscountIds] = useState([]);
  const [discountState, setDiscountState] = useState({ busy: false, error: "", success: "" });
  const [configProduct, setConfigProduct] = useState(null);
  const [configValues, setConfigValues] = useState(emptyConfig);
  const [configState, setConfigState] = useState({ busy: false, error: "" });

  const location = result.data?.location;
  const products = useMemo(() => joinMasterProducts(result.data?.products || [], result.data?.stock || []), [result.data]);
  useEffect(() => {
    if (!location) return;
    setSellerIds(location.assignedSellerIds || []);
    setDiscountIds(location.enabledDiscountIds || []);
  }, [location]);

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
  const wouldReduceStock = (entries) => entries.some((entry) => {
    const requested = Number(entry.quantity || 0);
    if (stockMode === "adjust") return requested < Number(entry.product.currentStock || 0);
    if (stockMode === "initial") return Number(entry.product.currentStock || 0) + requested - Number(entry.product.initialStock || 0) < Number(entry.product.currentStock || 0);
    return false;
  });
  const executeStock = async (entries) => {
    const operationId = stockState.operationId || crypto.randomUUID();
    setStockState({ busy: true, error: "", success: "", operationId });
    try {
      const operation = await loadLocationStock({ location, entries, mode: stockMode, reason: stockReason, profile, operationId });
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

  const toggleSeller = (sellerId) => setSellerIds((current) => current.includes(sellerId) ? current.filter((id) => id !== sellerId) : [...current, sellerId]);
  const handleSellersSave = async () => {
    setSellerState({ busy: true, error: "", success: "" });
    try {
      await saveLocationSellers(location, sellerIds, profile);
      setSellerState({ busy: false, error: "", success: "Las asignaciones se actualizaron en la ubicación y en los perfiles." });
      await result.refresh();
    } catch (error) { setSellerState({ busy: false, error: error.message, success: "" }); }
  };
  const toggleDiscount = (discountId) => setDiscountIds((current) => current.includes(discountId) ? current.filter((id) => id !== discountId) : [...current, discountId]);
  const handleDiscountSave = async () => {
    setDiscountState({ busy: true, error: "", success: "" });
    try {
      await saveLocationDiscounts(location, discountIds, profile);
      setDiscountState({ busy: false, error: "", success: "Los descuentos quedaron habilitados solamente para esta ubicación." });
      await result.refresh();
    } catch (error) { setDiscountState({ busy: false, error: error.message, success: "" }); }
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
    } catch (error) { setConfigState({ busy: false, error: error.message }); }
  };

  if (result.status === "loading") return <div className="fm-page-enter"><Skeleton lines={8} /></div>;
  if (result.status === "error") return <div className="fm-page-enter"><Panel><EmptyState icon="AlertTriangle" title="No se pudo abrir la ubicación" description={result.error.message} action={<Link className="fm-button fm-button--secondary" to="/gestion/locations">Volver a ubicaciones</Link>} /></Panel></div>;

  const state = locationActivity(location);
  const schedule = locationSchedule(location);
  const sellers = (result.data?.sellers || []).filter((seller) => !sellerSearch || `${seller.name} ${seller.email}`.toLocaleLowerCase("es").includes(sellerSearch.toLocaleLowerCase("es")));
  const canConfigure = can(profile, "locations", "configureLocationProducts");
  const canLoad = can(profile, "locations", stockMode === "adjust" ? "adjustStock" : "loadStock");
  const canAssignDiscounts = can(profile, "locations", "assignDiscounts");

  return (
    <div className="fm-page-enter fm-location-detail">
      <Link className="fm-back-link" to="/gestion/locations">← Volver a Ubicaciones y eventos</Link>
      <PageHeader
        eyebrow="Configuración operativa"
        title={`Ubicación · ${location.name}`}
        description={`${locationTypeLabels[location.type] || "Ubicación"}${schedule.startAt || schedule.endAt ? ` · ${schedule.startAt ? formatDate(schedule.startAt) : "Sin inicio"} a ${schedule.endAt ? formatDate(schedule.endAt) : "Sin fin"}` : " · Operación permanente"}`}
        actions={<Badge tone={state.active ? "success" : state.reason === "deleted" ? "error" : "warning"}>{state.label}</Badge>}
      />
      <div className="fm-location-tabs-desktop"><Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} /></div>
      <label className="fm-location-tabs-mobile"><span>Sección</span><Select value={activeTab} onChange={(event) => setActiveTab(event.target.value)}>{tabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}</Select></label>

      {activeTab === "products" ? <Panel title="Productos" description="Catálogo maestro unido al stock local; los productos nuevos aparecen automáticamente sin duplicarse.">
        <FilterBar search={<SearchInput label="Buscar producto" value={search} onChange={(event) => setSearch(event.target.value)} />}>
          <Select aria-label="Filtrar por categoría" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">Todas las categorías</option>{result.data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Select>
          <Select aria-label="Filtrar por estado" value={productStatus} onChange={(event) => setProductStatus(event.target.value)}><option value="all">Todos</option><option value="configured">Con stock configurado</option><option value="unconfigured">Sin configurar</option><option value="active">Activos</option><option value="inactive">Inactivos</option></Select>
        </FilterBar>
        <DataTable rows={visibleProducts} columns={[
          { key: "image", label: "Imagen", render: (product) => <ProductImage product={product} /> },
          { key: "productName", label: "Producto", render: (product) => <><strong>{product.productName}</strong><small>{product.abbreviation || "Sin abreviación"}</small></> },
          { key: "categoryName", label: "Categoría", render: (product) => product.categoryName || result.data.categories.find((category) => category.id === product.categoryId)?.name || "Sin categoría" },
          { key: "price", label: "Precio local", render: (product) => formatMoney(product.price) },
          { key: "currentStock", label: "Stock" },
          { key: "status", label: "Estado", render: (product) => <Badge tone={!product.configured ? "warning" : product.active ? "success" : "neutral"}>{!product.configured ? "Sin configurar" : product.active ? "Activo" : "Inactivo"}</Badge> },
          { key: "actions", label: "Acción", render: (product) => canConfigure ? <Button variant="secondary" onClick={() => openProductConfig(product)}>Configurar</Button> : "Sólo lectura" },
        ]} empty={<EmptyState icon="Boxes" title="No hay productos con estos filtros" />} />
      </Panel> : null}

      {activeTab === "stock" ? <Panel title="Cargar stock" description="La operación completa se confirma de forma atómica y deja stock anterior, variación, stock final, usuario y motivo.">
        {!state.active ? <Toast tone="error">La ubicación debe estar activa para cargar stock.</Toast> : null}
        <form onSubmit={handleStockSubmit}>
          <div className="fm-stock-toolbar">
            <FormField label="Modo de carga" required><Select value={stockMode} onChange={(event) => { setStockMode(event.target.value); setStockState({ busy: false, error: "", success: "", operationId: "" }); }}><option value="initial">Configurar stock inicial</option><option value="add">Agregar mercadería</option><option value="adjust">Ajustar inventario</option></Select></FormField>
            <FormField label="Motivo" hint={stockMode === "adjust" ? "Obligatorio para justificar el ajuste." : "Quedará en el movimiento."}><input value={stockReason} onChange={(event) => setStockReason(event.target.value)} required={stockMode === "adjust"} placeholder={stockMode === "add" ? "Ingreso de mercadería" : "Motivo de la operación"} /></FormField>
            <SearchInput label="Buscar producto para cargar" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <div className="fm-stock-load-list">
            {visibleProducts.filter((product) => product.masterActive).map((product) => <label key={product.id} className="fm-stock-load-row">
              <ProductImage product={product} />
              <span><strong>{product.productName}</strong><small>Actual: {product.currentStock} · Inicial: {product.initialStock || 0}</small></span>
              <span className="fm-stock-load-row__field"><small>{stockMode === "add" ? "Cantidad a agregar" : stockMode === "adjust" ? "Nuevo stock real" : "Stock inicial"}</small><input type="number" min="0" step="1" inputMode="numeric" value={stockValues[product.id]?.quantity ?? ""} onChange={(event) => updateStockValue(product, "quantity", event.target.value)} placeholder="0" /></span>
            </label>)}
          </div>
          {stockState.error ? <Toast tone="error">{stockState.error}</Toast> : null}
          {stockState.success ? <Toast tone="success">{stockState.success}</Toast> : null}
          {canLoad ? <Button type="submit" icon="PackagePlus" loading={stockState.busy} disabled={!state.active}>Confirmar carga</Button> : <p className="fm-permission-note">Tu perfil puede consultar stock, pero no modificarlo.</p>}
        </form>
      </Panel> : null}

      {activeTab === "sellers" ? <Panel title="Vendedores" description="La asignación reutiliza usuarios existentes y mantiene sincronizados el perfil y la ubicación.">
        {canAssignSellers ? <>
          <SearchInput label="Buscar vendedor" value={sellerSearch} onChange={(event) => setSellerSearch(event.target.value)} />
          <div className="fm-choice-list">{sellers.map((seller) => <label key={seller.id}><input type="checkbox" checked={sellerIds.includes(seller.id)} onChange={() => toggleSeller(seller.id)} disabled={seller.active !== true} /><span><strong>{seller.name || "Vendedor"}</strong><small>{seller.email || seller.id} · {seller.active === true ? "Activo" : "Inactivo"}</small></span><Badge tone={sellerIds.includes(seller.id) ? "success" : "neutral"}>{sellerIds.includes(seller.id) ? "Asignado" : "Disponible"}</Badge></label>)}</div>
          {(result.data.sellers || []).some((seller) => !sellerIds.includes(seller.id) && (seller.allowedLocationIds || []).length === 1 && seller.allowedLocationIds.includes(location.id)) ? <Toast tone="warning">Al quitar la última ubicación, ese vendedor dejará de tener un punto habilitado para operar.</Toast> : null}
          {sellerState.error ? <Toast tone="error">{sellerState.error}</Toast> : null}{sellerState.success ? <Toast tone="success">{sellerState.success}</Toast> : null}
          <Button icon="UserRoundCheck" loading={sellerState.busy} onClick={handleSellersSave}>Guardar vendedores</Button>
        </> : <EmptyState icon="UsersRound" title={`${location.assignedSellerIds?.length || 0} vendedores asignados`} description="La información personal y las asignaciones sólo están disponibles para administración autorizada." />}
      </Panel> : null}

      {activeTab === "discounts" ? <Panel title="Descuentos" description="La definición continúa en el catálogo maestro; aquí sólo se guardan los descuentos habilitados para esta ubicación.">
        <div className="fm-choice-list">{result.data.discounts.map((discount) => {
          const available = isDiscountAvailable(discount, location, new Date(), { ignoreAssignment: true });
          return <label key={discount.id}><input type="checkbox" checked={discountIds.includes(discount.id)} onChange={() => toggleDiscount(discount.id)} disabled={!canAssignDiscounts || !available} /><span><strong>{discount.name}</strong><small>{discount.type === "percent" ? `${discount.value}%` : formatMoney(discount.value)}{discount.validUntil ? ` · hasta ${formatDate(discount.validUntil)}` : " · sin vencimiento"}</small></span><Badge tone={!available ? "error" : discountIds.includes(discount.id) ? "success" : "neutral"}>{!available ? "No vigente" : discountIds.includes(discount.id) ? "Habilitado" : "Disponible"}</Badge></label>;
        })}</div>
        {!result.data.discounts.length ? <EmptyState icon="Tags" title="No hay descuentos activos en el sistema" /> : null}
        {discountState.error ? <Toast tone="error">{discountState.error}</Toast> : null}{discountState.success ? <Toast tone="success">{discountState.success}</Toast> : null}
        {canAssignDiscounts ? <Button icon="Save" loading={discountState.busy} onClick={handleDiscountSave}>Guardar descuentos</Button> : <p className="fm-permission-note">Podés consultar los descuentos habilitados, pero no modificarlos.</p>}
      </Panel> : null}

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
    </div>
  );
}
