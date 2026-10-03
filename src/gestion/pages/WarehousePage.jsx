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
  Toast,
} from "../../design-system";
import {
  INVENTORY_TYPES,
  movementLabel,
} from "../../modules/inventory/domain/inventory";
import { Link, useNavigate } from "../../router";
import { useAuth } from "../AuthContext";
import HelpTooltip from "../components/HelpTooltip";
import InventoryAdjustmentModal from "../components/InventoryAdjustmentModal";
import InventoryTransferModal from "../components/InventoryTransferModal";
import { useAsyncData } from "../hooks";
import { can } from "../permissions";
import {
  addProductToWarehouse,
  addStockToInventory,
  createWarehouse,
  getWarehouse,
  listInventoryMovements,
  listMasterProductsForInventory,
  listProductCategoriesForInventory,
  listWarehouseInventory,
  listWarehouses,
} from "../services/inventoryService";
import { listLocations } from "../services/managementService";

function ProductImage({ product }) {
  const source = product.thumbUrl || product.imageUrl;
  return source
    ? <img className="fm-product-thumb" src={source} alt={product.productName || product.name || "Producto"} loading="lazy" />
    : <span className="fm-product-thumb fm-product-thumb--empty" aria-label="Imagen pendiente">FM</span>;
}

function movementDate(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.valueOf())
    ? new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(date)
    : "Fecha pendiente";
}

function NewWarehouseModal({ open, profile, onClose, onSaved }) {
  const [form, setForm] = useState({ name: "", description: "", address: "", active: true });
  const [state, setState] = useState({ busy: false, error: "" });
  useEffect(() => {
    if (!open) return;
    setForm({ name: "", description: "", address: "", active: true });
    setState({ busy: false, error: "" });
  }, [open]);
  const submit = async (event) => {
    event.preventDefault();
    setState({ busy: true, error: "" });
    try {
      const id = await createWarehouse({ values: form, profile });
      await onSaved?.(id);
      onClose?.();
    } catch (error) {
      setState({ busy: false, error: error.message });
    }
  };
  return (
    <Modal open={open} onClose={() => !state.busy && onClose?.()} title="Nuevo depósito" description="Creá un lugar donde Flor Mía guarda mercadería. Un depósito tiene stock, pero no precios de venta.">
      <form className="fm-inventory-modal" onSubmit={submit}>
        <FormField label="Nombre del depósito" required><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Depósito San Martín" /></FormField>
        <FormField label="Descripción" hint="Opcional."><textarea rows="3" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></FormField>
        <FormField label="Dirección o referencia" hint="Opcional. Usala si ayuda a identificar el lugar."><input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></FormField>
        <label className="fm-check-row"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /><span>Depósito activo</span></label>
        {state.error ? <Toast tone="error">{state.error}</Toast> : null}
        <div className="fm-dialog-actions">
          <HelpTooltip label="Cierra esta ventana sin crear el depósito."><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button></HelpTooltip>
          <HelpTooltip label="Crea este depósito vacío. Después vas a poder agregarle productos y stock."><Button type="submit" loading={state.busy}>Crear depósito</Button></HelpTooltip>
        </div>
      </form>
    </Modal>
  );
}

function AddWarehouseProductModal({ open, warehouse, inventory, categories, profile, onClose, onSaved }) {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [initialStock, setInitialStock] = useState(0);
  const [requestId, setRequestId] = useState("");
  const [state, setState] = useState({ busy: false, loading: false, error: "" });
  useEffect(() => {
    if (!open) return;
    setSearch("");
    setCategoryId("");
    setSelectedId("");
    setInitialStock(0);
    setRequestId(crypto.randomUUID());
    setState({ busy: false, loading: true, error: "" });
    listMasterProductsForInventory(profile, { includeInactive: false })
      .then((data) => { setProducts(data); setState({ busy: false, loading: false, error: "" }); })
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
    if (!selected) return setState((current) => ({ ...current, error: "Elegí un producto del catálogo." }));
    setState((current) => ({ ...current, busy: true, error: "" }));
    try {
      await addProductToWarehouse({ warehouse, product: selected, initialStock, profile, requestId });
      await onSaved?.();
      onClose?.();
    } catch (error) {
      setState((current) => ({ ...current, busy: false, error: error.message }));
    }
  };
  return (
    <Modal open={open} onClose={() => !state.busy && onClose?.()} title="Agregar producto" description={`Agrega a ${warehouse?.name || "este depósito"} un producto que ya existe en el catálogo de Flor Mía.`}>
      <form className="fm-inventory-modal" onSubmit={submit}>
        <div className="fm-inventory-picker-filters">
          <SearchInput label="Buscar producto" value={search} onChange={(event) => setSearch(event.target.value)} />
          <Select aria-label="Filtrar por categoría" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Todas las categorías</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Select>
        </div>
        {state.loading ? <Skeleton lines={4} /> : null}
        {!state.loading ? <div className="fm-product-select-list" role="radiogroup" aria-label="Productos del catálogo">{filtered.map((product) => {
          const assigned = assignedIds.has(product.id);
          return <label key={product.id} className={`${selectedId === product.id ? "is-selected" : ""} ${assigned ? "is-disabled" : ""}`.trim()}><input type="radio" name="warehouse-product" value={product.id} checked={selectedId === product.id} disabled={assigned} onChange={() => setSelectedId(product.id)} /><ProductImage product={product} /><span><strong>{product.name}</strong><small>{product.categoryName || "Sin categoría"}</small></span>{assigned ? <Badge tone="neutral">Ya agregado</Badge> : null}</label>;
        })}</div> : null}
        {selected ? <FormField label="Stock inicial" hint="Cuántas unidades hay físicamente ahora en este depósito." required><input type="number" min="0" step="1" inputMode="numeric" value={initialStock} onChange={(event) => setInitialStock(event.target.value)} /></FormField> : null}
        <p className="fm-safe-note">Los depósitos no tienen precio de venta. El precio se define únicamente cuando el producto está en una ubicación de venta.</p>
        {state.error ? <Toast tone="error">{state.error}</Toast> : null}
        <div className="fm-dialog-actions"><HelpTooltip label="Cierra esta ventana sin agregar ningún producto."><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button></HelpTooltip><HelpTooltip label="Agrega el producto a este depósito con el stock inicial indicado."><Button type="submit" loading={state.busy} disabled={!selected}>Agregar producto</Button></HelpTooltip></div>
      </form>
    </Modal>
  );
}

function AddWarehouseStockModal({ open, warehouse, product, profile, onClose, onSaved }) {
  const [quantity, setQuantity] = useState(0);
  const [reason, setReason] = useState("");
  const [requestId, setRequestId] = useState("");
  const [state, setState] = useState({ busy: false, error: "" });
  useEffect(() => {
    if (!open) return;
    setQuantity(0); setReason(""); setRequestId(crypto.randomUUID()); setState({ busy: false, error: "" });
  }, [open, product?.productId]);
  const current = Number(product?.currentStock || 0);
  const submit = async (event) => {
    event.preventDefault();
    setState({ busy: true, error: "" });
    try {
      await addStockToInventory({ type: INVENTORY_TYPES.WAREHOUSE, inventory: warehouse, product, quantity, reason, profile, requestId });
      await onSaved?.(); onClose?.();
    } catch (error) { setState({ busy: false, error: error.message }); }
  };
  return (
    <Modal open={open} onClose={() => !state.busy && onClose?.()} title={`Agregar stock · ${product?.productName || "Producto"}`} description="Suma nuevas unidades y registra el ingreso en el historial del depósito.">
      <form className="fm-inventory-modal" onSubmit={submit}>
        <dl className="fm-stock-calculation"><div><dt>Stock actual</dt><dd>{current}</dd></div><div><dt>Nuevo stock</dt><dd>{current + Math.max(0, Number(quantity || 0))}</dd></div></dl>
        <FormField label="Cantidad a agregar" required><input type="number" min="1" step="1" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></FormField>
        <FormField label="Observación" hint="Opcional."><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ingreso de mercadería" /></FormField>
        {state.error ? <Toast tone="error">{state.error}</Toast> : null}
        <div className="fm-dialog-actions"><HelpTooltip label="Cierra esta ventana sin modificar el stock."><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button></HelpTooltip><HelpTooltip label="Suma esta cantidad al stock actual del depósito y registra el movimiento."><Button type="submit" loading={state.busy} disabled={Number(quantity || 0) <= 0}>Confirmar ingreso</Button></HelpTooltip></div>
      </form>
    </Modal>
  );
}

function WarehouseMovementsModal({ open, warehouse, product, onClose }) {
  const [pageSize, setPageSize] = useState(30);
  useEffect(() => { if (open) setPageSize(30); }, [open, product?.productId]);
  const result = useAsyncData(
    () => open && warehouse && product ? listInventoryMovements({ type: INVENTORY_TYPES.WAREHOUSE, inventoryId: warehouse.id, productId: product.productId, pageSize }) : Promise.resolve([]),
    [open, warehouse?.id, product?.productId, pageSize],
  );
  const movements = result.data || [];
  return (
    <Modal open={open} onClose={onClose} title={`Movimientos · ${product?.productName || "Producto"}`} description="Muestra los ingresos y transferencias de este producto en el depósito.">
      {result.status === "loading" ? <Skeleton lines={5} /> : null}
      {result.status === "error" ? <Toast tone="error">{result.error.message}</Toast> : null}
      {result.status === "ready" && !movements.length ? <EmptyState icon="ClipboardList" title="Todavía no hay movimientos registrados" /> : null}
      {movements.length ? <div className="fm-movement-list">{movements.map((movement) => <article key={movement.id}><div><strong>{Number(movement.qty || 0) > 0 ? "+" : ""}{Number(movement.qty || 0)} · {movementLabel(movement)}</strong><small>{movementDate(movement.createdAt)}</small></div><span>{movement.reason || "Sin observación"}</span></article>)}</div> : null}
      {movements.length >= pageSize && pageSize < 120 ? <div className="fm-load-more"><HelpTooltip label="Carga más movimientos anteriores de este producto."><Button variant="secondary" onClick={() => setPageSize((value) => Math.min(120, value + 30))}>Cargar más</Button></HelpTooltip></div> : null}
    </Modal>
  );
}

function WarehouseDetail({ warehouseId, profile, warehouses, locations, onWarehousesRefresh }) {
  const navigate = useNavigate();
  const result = useAsyncData(async () => {
    const warehouse = await getWarehouse(warehouseId);
    if (!warehouse) throw new Error("El depósito no existe o ya no está disponible.");
    const [inventory, categories] = await Promise.all([
      listWarehouseInventory(warehouseId),
      listProductCategoriesForInventory(profile),
    ]);
    return { warehouse, inventory, categories };
  }, [warehouseId, profile.id]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [stockProduct, setStockProduct] = useState(null);
  const [movementProduct, setMovementProduct] = useState(null);
  const [adjustProduct, setAdjustProduct] = useState(null);
  const [transferProduct, setTransferProduct] = useState(null);

  if (result.status === "loading") return <Skeleton lines={8} />;
  if (result.status === "error") return <Panel><EmptyState icon="AlertTriangle" title="No se pudo abrir el depósito" description={result.error.message} action={<HelpTooltip label="Vuelve al listado de depósitos."><Button variant="secondary" onClick={() => navigate("/gestion/warehouse")}>Volver a Depósitos</Button></HelpTooltip>} /></Panel>;

  const warehouse = result.data.warehouse;
  const inventory = result.data.inventory;
  const term = search.trim().toLocaleLowerCase("es");
  const visible = inventory.filter((product) => (!term || `${product.productName} ${product.abbreviation || ""}`.toLocaleLowerCase("es").includes(term)) && (!categoryId || product.categoryId === categoryId));
  const canEdit = can(profile, "warehouse", "edit");
  const canTransfer = can(profile, "warehouse", "transferStock");

  return (
    <div className="fm-page-enter">
      <Link className="fm-back-link" to="/gestion/warehouse">← Volver a Depósitos</Link>
      <PageHeader eyebrow="Depósito" title={warehouse.name} description="Los depósitos guardan mercadería, pero no tienen precios de venta." actions={<Badge tone={warehouse.active === false ? "warning" : "success"}>{warehouse.active === false ? "Inactivo" : "Activo"}</Badge>} />
      <Panel title="Stock del depósito" description="Acá ves solamente los productos que realmente forman parte de este depósito." action={canEdit ? <HelpTooltip label="Agrega a este depósito un producto que ya existe en el catálogo."><Button icon="Plus" onClick={() => setAddProductOpen(true)}>Agregar producto</Button></HelpTooltip> : null}>
        {inventory.length ? <><div className="fm-inventory-picker-filters"><SearchInput label="Buscar en este depósito" value={search} onChange={(event) => setSearch(event.target.value)} /><Select aria-label="Filtrar por categoría" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Todas las categorías</option>{result.data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Select></div>{visible.length ? <div className="fm-inventory-card-grid">{visible.map((product) => <article className="fm-inventory-card" key={product.productId}><header className="fm-inventory-card__identity"><ProductImage product={product} /><div><h3>{product.productName}</h3><p>{product.categoryName || "Sin categoría"}</p></div><Badge tone={product.active ? "success" : "neutral"}>{product.active ? "Activo" : "Inactivo"}</Badge></header><dl className="fm-inventory-card__stats"><div><dt>Stock actual</dt><dd>{product.currentStock}</dd></div></dl><footer className="fm-inventory-card__actions">{canEdit ? <HelpTooltip label="Suma nuevas unidades al stock actual de este producto."><Button onClick={() => setStockProduct(product)}>Agregar stock</Button></HelpTooltip> : null}{canEdit && can(profile, "warehouse", "adjustStock") ? <Button variant="secondary" onClick={() => setAdjustProduct(product)}>Ajustar inventario</Button> : null}{canTransfer ? <HelpTooltip label="Inicia una transferencia de este producto hacia una ubicación u otro depósito."><Button variant="secondary" onClick={() => setTransferProduct(product)}>Transferir</Button></HelpTooltip> : null}<HelpTooltip label="Muestra los ingresos y transferencias de este producto."><Button variant="ghost" onClick={() => setMovementProduct(product)}>Movimientos</Button></HelpTooltip></footer></article>)}</div> : <EmptyState icon="Search" title="No hay productos con estos filtros" />}</> : <EmptyState icon="Boxes" title="Este depósito todavía no tiene productos" description="Elegí un producto del catálogo y cargá cuántas unidades hay actualmente." action={canEdit ? <HelpTooltip label="Agrega el primer producto a este depósito desde el catálogo general."><Button onClick={() => setAddProductOpen(true)}>Agregar primer producto</Button></HelpTooltip> : null} />}
      </Panel>
      <AddWarehouseProductModal open={addProductOpen} warehouse={warehouse} inventory={inventory} categories={result.data.categories} profile={profile} onClose={() => setAddProductOpen(false)} onSaved={result.refresh} />
      <AddWarehouseStockModal open={Boolean(stockProduct)} warehouse={warehouse} product={stockProduct} profile={profile} onClose={() => setStockProduct(null)} onSaved={result.refresh} />
      <WarehouseMovementsModal open={Boolean(movementProduct)} warehouse={warehouse} product={movementProduct} onClose={() => setMovementProduct(null)} />
      <InventoryAdjustmentModal open={Boolean(adjustProduct)} type={INVENTORY_TYPES.WAREHOUSE} inventory={warehouse} product={adjustProduct} profile={profile} onClose={() => setAdjustProduct(null)} onSaved={result.refresh} />
      <InventoryTransferModal open={Boolean(transferProduct)} warehouses={warehouses} locations={locations} initialOriginId={warehouse.id} initialProductId={transferProduct?.productId || ""} profile={profile} onClose={() => setTransferProduct(null)} onSaved={async () => { await result.refresh(); await onWarehousesRefresh?.(); }} />
    </div>
  );
}

export default function WarehousePage({ warehouseId = null }) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const result = useAsyncData(async () => {
    const [warehouses, locations] = await Promise.all([
      listWarehouses(profile, { includeInactive: true }),
      listLocations(profile),
    ]);
    return { warehouses, locations };
  }, [profile.id]);
  const [newOpen, setNewOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [message, setMessage] = useState("");

  if (result.status === "loading") return <div className="fm-page-enter"><Skeleton lines={8} /></div>;
  if (result.status === "error") return <div className="fm-page-enter"><Panel><EmptyState icon="AlertTriangle" title="No se pudo abrir Depósitos" description={result.error.message} /></Panel></div>;

  if (warehouseId) {
    return <WarehouseDetail warehouseId={warehouseId} profile={profile} warehouses={result.data.warehouses} locations={result.data.locations} onWarehousesRefresh={result.refresh} />;
  }

  const warehouses = result.data.warehouses;
  const canCreate = can(profile, "warehouse", "create");
  const canTransfer = can(profile, "warehouse", "transferStock");
  return (
    <div className="fm-page-enter fm-warehouse-page">
      <PageHeader
        eyebrow="Inventario central"
        title="Depósitos"
        description="Los depósitos son lugares donde Flor Mía guarda mercadería. Tienen stock, pero no precios de venta."
        actions={<div className="fm-header-action-row">{canCreate ? <HelpTooltip label="Crea un depósito nuevo y vacío para empezar a cargar mercadería."><Button icon="Plus" onClick={() => setNewOpen(true)}>Nuevo depósito</Button></HelpTooltip> : null}{canTransfer ? <HelpTooltip label="Mueve productos de un depósito a otra ubicación o depósito sin tener que cargar el stock dos veces."><Button variant="secondary" icon="Truck" onClick={() => setTransferOpen(true)}>Transferir stock</Button></HelpTooltip> : null}</div>}
      />
      {message ? <Toast tone="success">{message}</Toast> : null}
      <Panel title="Depósitos disponibles" description="Abrí un depósito para ver únicamente los productos que guarda y su stock actual.">
        {warehouses.length ? <div className="fm-warehouse-grid">{warehouses.map((warehouse) => <article key={warehouse.id} className="fm-warehouse-card"><div className="fm-warehouse-card__icon" aria-hidden="true">FM</div><div><h3>{warehouse.name}</h3><p>{warehouse.description || warehouse.address || "Sin descripción"}</p></div><Badge tone={warehouse.active === false ? "warning" : "success"}>{warehouse.active === false ? "Inactivo" : "Activo"}</Badge><footer><HelpTooltip label="Abre este depósito para ver productos, stock y movimientos."><Button variant="secondary" onClick={() => navigate(`/gestion/warehouse/${encodeURIComponent(warehouse.id)}`)}>Abrir depósito</Button></HelpTooltip></footer></article>)}</div> : <EmptyState icon="Warehouse" title="Todavía no hay depósitos" description="Creá el primer depósito. Va a comenzar vacío y después vas a poder agregar productos." action={canCreate ? <HelpTooltip label="Crea el primer depósito de Flor Mía."><Button onClick={() => setNewOpen(true)}>Nuevo depósito</Button></HelpTooltip> : null} />}
      </Panel>
      <NewWarehouseModal open={newOpen} profile={profile} onClose={() => setNewOpen(false)} onSaved={async (id) => { await result.refresh(); setMessage("Depósito creado. Empieza vacío, listo para agregar productos."); navigate(`/gestion/warehouse/${encodeURIComponent(id)}`); }} />
      <InventoryTransferModal open={transferOpen} warehouses={warehouses} locations={result.data.locations} profile={profile} onClose={() => setTransferOpen(false)} onSaved={async (transfer) => { await result.refresh(); setMessage(`Transferencia confirmada: ${transfer.itemCount} producto${transfer.itemCount === 1 ? "" : "s"}, ${transfer.receivedQuantity ?? transfer.totalQuantity} unidades recibidas.`); }} />
    </div>
  );
}
