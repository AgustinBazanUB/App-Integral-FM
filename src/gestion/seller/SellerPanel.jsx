import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Badge,
  Button,
  ConfirmationDialog,
  Dropdown,
  EmptyState,
  Modal,
  Panel,
  Skeleton,
  Toast,
} from "../../design-system";
import { calculateDiscountSummary } from "../../modules/locations/domain/discounts";
import { isDiscountAvailable } from "../../modules/locations/domain/dashboard";
import {
  completeRemainingPayment,
  PAYMENT_LABELS,
  PAYMENT_OPTIONS,
  paymentAllocationSummary,
  salePaymentParts,
  SINGLE_PAYMENT_METHODS,
} from "../../modules/locations/domain/payments";
import { useNavigate } from "../../router";
import { useAuth } from "../AuthContext";
import { Icon } from "../components/icons";
import {
  formatDateTime,
  formatMoney,
  statusTone,
} from "../formatters";
import { useAsyncData, useOnlineStatus } from "../hooks";
import {
  can,
  canAccessAdminPanel,
} from "../permissions";
import {
  cancelSellerSale,
  createSellerSale,
  loadSellerResources,
  updateSellerSale,
} from "../services/sellerService";
import DiscountDialog from "./DiscountDialog";
import {
  deleteSellerPendingSale,
  markSellerPendingError,
  markSellerPendingSynced,
  saveSellerPendingSale,
} from "./offlineSales";
import {
  useSellerDailySales,
  useSellerKeyboard,
  useSellerLocations,
  useSellerLocationStock,
  useSellerPendingSales,
} from "./hooks";
import {
  cartItems,
  cartQuantity,
  cartSubtotal,
  groupSellerProducts,
  pendingReservedQuantities,
  SELLER_ACTION_SHORTCUTS,
  SELLER_VIEWS,
  sellerImage,
  sellerStockStatus,
} from "./sellerDomain";

const friendlyPayment = {
  credit: "Crédito",
  debit: "Débito",
  alias: "Alias",
  cash: "Efectivo",
  multiple: "+2 pagos",
};

function SellerHeader({
  profile,
  location,
  online,
  syncing,
  pendingCount,
  view,
  setView,
  keyboardActive,
  setKeyboardActive,
  canReturnAdmin,
  onReturnAdmin,
  onLogout,
}) {
  return (
    <>
      <header className="fm-seller-header">
        <div className="fm-seller-brand">
          <img src="/images/flor-mia/logo-flor-mia.svg" alt="Flor Mía" />
          <div>
            <strong>Panel Vendedor</strong>
            <span>{location?.name || "Elegí una ubicación"}</span>
          </div>
        </div>
        <div className="fm-seller-header__status">
          <Badge tone={syncing ? "warning" : online ? "success" : "warning"} icon={syncing ? "RefreshCw" : online ? "Wifi" : "WifiOff"}>
            {syncing ? "Sincronizando" : online ? "Online" : "Sin conexión"}
          </Badge>
          <button type="button" className={`fm-seller-pending-chip ${pendingCount ? "has-pending" : ""}`} onClick={() => setView("pending")}>
            Pendientes <strong>{pendingCount}</strong>
          </button>
          <Dropdown label={<span className="fm-profile-trigger"><span className="fm-avatar">{(profile.name || profile.email || "V").slice(0, 1).toUpperCase()}</span><span><strong>{profile.name || "Usuario"}</strong><small>Panel Vendedor</small></span><Icon name="ChevronDown" /></span>}>
            <div className="fm-profile-menu">
              <button type="button" onClick={() => setKeyboardActive((value) => !value)}><Icon name="Keyboard" />{keyboardActive ? "Desactivar botonera" : "Activar botonera"}</button>
              {canReturnAdmin ? <button type="button" onClick={onReturnAdmin}><Icon name="LayoutDashboard" />Volver al Panel Administrador</button> : null}
              <button type="button" onClick={onLogout}><Icon name="LogOut" />Cerrar sesión</button>
            </div>
          </Dropdown>
        </div>
      </header>
      <nav className="fm-seller-nav" aria-label="Secciones del Panel Vendedor">
        {SELLER_VIEWS.map((item) => (
          <button key={item.id} type="button" className={view === item.id ? "is-active" : ""} aria-current={view === item.id ? "page" : undefined} onClick={() => setView(item.id)}>
            <Icon name={item.icon} /><span>{item.label}</span>
            {item.id === "pending" && pendingCount ? <b>{pendingCount}</b> : null}
          </button>
        ))}
      </nav>
    </>
  );
}

function MultiplePaymentDialog({ open, total, initialPayments, onClose, onConfirm }) {
  const [values, setValues] = useState({});
  useEffect(() => {
    if (!open) return;
    setValues(Object.fromEntries(
      SINGLE_PAYMENT_METHODS.map((method) => [
        method,
        initialPayments.find((payment) => payment.method === method)?.amount || "",
      ]),
    ));
  }, [open, initialPayments]);
  const entries = SINGLE_PAYMENT_METHODS.map((method) => ({
    method,
    label: PAYMENT_LABELS[method],
    amount: values[method] === "" ? 0 : Number(values[method]),
  }));
  const summary = paymentAllocationSummary(entries, total);
  const valid = !summary.invalid && summary.difference === 0 && summary.positiveCount >= 2;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="+2 pagos"
      description="Distribuí el total entre dos o más medios."
      footer={<div className="fm-dialog-actions"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button disabled={!valid} onClick={() => onConfirm(entries)}>Confirmar</Button></div>}
    >
      <div className="fm-seller-multiple-total"><span>Total de la venta</span><strong>{formatMoney(total)}</strong></div>
      <div className="fm-seller-payment-rows">
        {SINGLE_PAYMENT_METHODS.map((method) => (
          <label key={method}>
            <span>{friendlyPayment[method]}</span>
            <div>
              <input type="number" min="0" step="1" inputMode="numeric" value={values[method] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [method]: event.target.value }))} />
              <button type="button" onClick={() => {
                const completed = completeRemainingPayment(entries, method, total);
                setValues(Object.fromEntries(completed.map((entry) => [entry.method, entry.amount || ""])));
              }} disabled={summary.invalid || summary.difference <= 0}>Completar saldo</button>
            </div>
          </label>
        ))}
      </div>
      <div className={`fm-seller-payment-difference ${valid ? "is-valid" : ""}`} aria-live="polite">
        <span>Total cargado: {formatMoney(summary.loaded)}</span>
        <strong>{summary.invalid ? "Hay importes inválidos" : summary.difference > 0 ? `Faltan ${formatMoney(summary.difference)}` : summary.difference < 0 ? `Sobran ${formatMoney(Math.abs(summary.difference))}` : summary.positiveCount < 2 ? "Usá al menos dos medios" : "La suma coincide"}</strong>
      </div>
    </Modal>
  );
}

function sameManualDiscount(a, b) {
  return a?.source === "manual" && b?.source === "manual" && a.type === b.type && Number(a.value) === Number(b.value) && a.name === b.name;
}

export default function SellerPanel() {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const locationsResult = useSellerLocations(profile);
  const resourcesResult = useAsyncData(() => loadSellerResources(profile), [profile.id]);
  const [locationId, setLocationId] = useState("");
  const [view, setView] = useState("sale");
  const [cart, setCart] = useState({});
  const [discountIds, setDiscountIds] = useState([]);
  const [manualDiscounts, setManualDiscounts] = useState([]);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [payments, setPayments] = useState([]);
  const [ticketRequested, setTicketRequested] = useState(false);
  const [keyboardActive, setKeyboardActive] = useState(true);
  const [lastProductId, setLastProductId] = useState("");
  const [editSale, setEditSale] = useState(null);
  const [submitState, setSubmitState] = useState({ busy: false, message: "", tone: "info" });
  const [multipleOpen, setMultipleOpen] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [detailSale, setDetailSale] = useState(null);
  const [locationToApply, setLocationToApply] = useState("");
  const [clearRequested, setClearRequested] = useState(false);
  const [editRequested, setEditRequested] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [deletePendingTarget, setDeletePendingTarget] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const autoSyncAttempted = useRef(false);

  const closeCancelDialog = useCallback(() => {
    setCancelTarget(null);
    setCancelReason("");
  }, []);

  const locations = locationsResult.data || [];
  const selectedLocation = locations.find((location) => location.id === locationId) || null;
  const stockResult = useSellerLocationStock(profile, locationId);
  const dailySales = useSellerDailySales(profile, locationId);
  const pendingSales = useSellerPendingSales(profile);
  const resources = resourcesResult.data || { categories: [], discounts: [], shortcuts: { sellerActions: {} } };

  useEffect(() => {
    if (!locations.length) {
      setLocationId("");
      return;
    }
    const remembered = localStorage.getItem(`flor-mia-seller-location-${profile.id}`);
    if (locations.some((location) => location.id === locationId)) return;
    const next = locations.find((location) => location.id === remembered)?.id || locations[0].id;
    setLocationId(next);
  }, [locations, locationId, profile.id]);

  useEffect(() => {
    if (!locationId) return;
    localStorage.setItem(`flor-mia-seller-location-${profile.id}`, locationId);
  }, [locationId, profile.id]);

  useEffect(() => {
    localStorage.setItem(`flor-mia-preferred-panel-${profile.id}`, "seller");
  }, [profile.id]);

  const reserved = useMemo(
    () => pendingReservedQuantities(pendingSales.data || [], locationId),
    [pendingSales.data, locationId],
  );
  const products = useMemo(() => (stockResult.data || []).map((item) => ({
    ...item,
    availableStock: Math.max(
      0,
      Number(item.currentStock || 0) - Number(reserved[item.id] || 0) +
      Number(editSale?.items?.find((old) => old.productId === item.id)?.qty || 0),
    ),
  })), [stockResult.data, reserved, editSale]);
  const productGroups = useMemo(
    () => groupSellerProducts(products, resources.categories),
    [products, resources.categories],
  );

  useEffect(() => {
    setCart((current) => Object.fromEntries(Object.entries(current).map(([id, item]) => {
      const product = products.find((entry) => entry.id === id);
      return [id, product ? { ...item, stock: product.availableStock, imageUrl: sellerImage(product) } : item];
    })));
  }, [products]);

  const currentItems = useMemo(() => cartItems(cart), [cart]);
  const subtotal = useMemo(() => cartSubtotal(cart), [cart]);
  const availableDiscounts = useMemo(() => (resources.discounts || []).filter((discount) =>
    isDiscountAvailable(discount, selectedLocation, new Date(), { profile, items: currentItems }),
  ), [resources.discounts, selectedLocation, profile, currentItems]);
  const savedDiscounts = availableDiscounts
    .filter((discount) => discountIds.includes(discount.id))
    .map((discount) => ({ ...discount, discountId: discount.id, source: "saved" }));
  const appliedDiscounts = [...savedDiscounts, ...manualDiscounts];
  const summary = useMemo(
    () => calculateDiscountSummary(appliedDiscounts, subtotal),
    [appliedDiscounts, subtotal],
  );
  const hasStockConflict = currentItems.some((item) => Number(item.qty) > Number(item.stock));
  const manualDiscountAllowed = can(profile, "quick-sales", "useManualDiscounts");
  const multiplePaymentAllowed = can(profile, "quick-sales", "useMultiplePayments");
  const ticketAllowed = can(profile, "quick-sales", "requestTicket");

  useEffect(() => {
    setDiscountIds((current) => current.filter((id) => availableDiscounts.some((discount) => discount.id === id)));
  }, [availableDiscounts]);

  useEffect(() => {
    if (paymentMethod === "multiple" && payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0) !== summary.total) {
      setPaymentMethod("");
      setPayments([]);
      setSubmitState({ busy: false, tone: "error", message: "El total cambió. Volvé a cargar +2 pagos." });
    }
  }, [summary.total, paymentMethod, payments]);

  const resetSale = useCallback(() => {
    setCart({});
    setDiscountIds([]);
    setManualDiscounts([]);
    setDiscountOpen(false);
    setPaymentMethod("");
    setPayments([]);
    setTicketRequested(false);
    setLastProductId("");
    setEditSale(null);
  }, []);

  const changeQuantity = useCallback((product, amount) => {
    setCart((current) => {
      const existing = current[product.id];
      const nextQty = Number(existing?.qty || 0) + amount;
      if (nextQty <= 0) {
        const next = { ...current };
        delete next[product.id];
        return next;
      }
      if (nextQty > Number(product.availableStock || 0)) {
        setSubmitState({ busy: false, tone: "error", message: `${product.productName || product.name}: sólo quedan ${product.availableStock ?? product.stock} unidades disponibles.` });
        return current;
      }
      return {
        ...current,
        [product.id]: {
          id: product.id,
          productId: product.id,
          name: product.productName || product.name,
          abbreviation: product.abbreviation || "",
          price: Number(product.price || 0),
          unitPrice: Number(product.price || 0),
          qty: nextQty,
          stock: Number(product.availableStock ?? product.stock ?? 0),
          imageUrl: product.imageUrl || sellerImage(product),
        },
      };
    });
    setLastProductId(product.id);
  }, []);

  const addProduct = useCallback((product) => changeQuantity(product, 1), [changeQuantity]);
  const subtractLast = useCallback(() => {
    const product = products.find((item) => item.id === lastProductId);
    if (product) changeQuantity(product, -1);
  }, [products, lastProductId, changeQuantity]);

  const removeDiscount = (discount) => {
    if (discount.source === "manual") {
      let removed = false;
      setManualDiscounts((current) => current.filter((candidate) => {
        if (!removed && sameManualDiscount(candidate, discount)) {
          removed = true;
          return false;
        }
        return true;
      }));
      return;
    }
    setDiscountIds((current) => current.filter((id) => id !== discount.discountId));
  };

  const savePending = useCallback(async () => {
    const random = crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const localId = `local_${random.replace(/[^A-Za-z0-9_-]/g, "")}`;
    await saveSellerPendingSale({
      localId,
      localCode: `PEND-${Date.now().toString().slice(-8)}`,
      status: "pending",
      createdLocallyAt: new Date().toISOString(),
      locationId: selectedLocation.id,
      locationName: selectedLocation.name,
      locationPrefix: selectedLocation.codePrefix || "LOC",
      sellerId: profile.id,
      sellerName: profile.name || profile.email,
      items: currentItems,
      discounts: appliedDiscounts,
      total: summary.total,
      paymentMethod,
      paymentMethodLabel: PAYMENT_LABELS[paymentMethod],
      payments,
      ticketRequested,
    });
    await pendingSales.refresh();
    resetSale();
    setSubmitState({ busy: false, tone: "success", message: "Venta guardada en este dispositivo. Todavía no está confirmada en Firestore." });
  }, [selectedLocation, profile, currentItems, appliedDiscounts, summary.total, paymentMethod, payments, ticketRequested, pendingSales, resetSale]);

  const submitSale = useCallback(async () => {
    if (submitState.busy) return;
    if (!selectedLocation) {
      setSubmitState({ busy: false, tone: "error", message: "Elegí una ubicación activa." });
      return;
    }
    if (!currentItems.length) {
      setSubmitState({ busy: false, tone: "error", message: "La venta está vacía." });
      return;
    }
    if (hasStockConflict) {
      setSubmitState({ busy: false, tone: "error", message: "El stock cambió. Corregí los productos marcados." });
      return;
    }
    if (!paymentMethod) {
      setSubmitState({ busy: false, tone: "error", message: "Elegí una forma de pago." });
      return;
    }
    if (paymentMethod === "multiple") {
      const paymentSummary = paymentAllocationSummary(payments, summary.total);
      if (paymentSummary.invalid || paymentSummary.difference !== 0 || paymentSummary.positiveCount < 2) {
        setSubmitState({ busy: false, tone: "error", message: "Revisá +2 pagos: la suma debe coincidir exactamente con el total." });
        return;
      }
    }
    if (ticketRequested && !ticketAllowed) {
      setSubmitState({ busy: false, tone: "error", message: "Tu perfil no puede solicitar ticket." });
      return;
    }
    if (!online && editSale) {
      setSubmitState({ busy: false, tone: "error", message: "Necesitás conexión para editar una venta confirmada." });
      return;
    }
    setSubmitState({ busy: true, tone: "info", message: online ? "Registrando venta…" : "Guardando pendiente…" });
    try {
      if (!online) {
        await savePending();
        return;
      }
      const result = editSale
        ? await updateSellerSale({ profile, saleId: editSale.id, items: currentItems, discounts: appliedDiscounts, paymentMethod, paymentMethodLabel: PAYMENT_LABELS[paymentMethod], payments, ticketRequested })
        : await createSellerSale({ profile, location: selectedLocation, items: currentItems, discounts: appliedDiscounts, paymentMethod, paymentMethodLabel: PAYMENT_LABELS[paymentMethod], payments, ticketRequested });
      resetSale();
      await dailySales.refresh();
      setReceipt(result);
      setSubmitState({ busy: false, tone: "success", message: `${result.saleCode} registrada correctamente.` });
    } catch (error) {
      setSubmitState({ busy: false, tone: "error", message: error.message });
    }
  }, [submitState.busy, selectedLocation, currentItems, hasStockConflict, paymentMethod, payments, summary.total, ticketRequested, ticketAllowed, online, editSale, savePending, profile, appliedDiscounts, resetSale, dailySales]);

  const actionShortcuts = useMemo(() => SELLER_ACTION_SHORTCUTS.map((action) => ({
    ...action,
    ...(resources.shortcuts?.sellerActions?.[action.id] || {}),
  })), [resources.shortcuts]);

  useSellerKeyboard({
    enabled: keyboardActive && view === "sale",
    products,
    discounts: availableDiscounts,
    actionShortcuts,
    onProduct: addProduct,
    onDiscount: (discount) => setDiscountIds((current) => current.includes(discount.id) ? current : [...current, discount.id]),
    onShortcut: (shortcut) => {
      if (shortcut.paymentMethod) {
        if (shortcut.paymentMethod === "multiple" && !multiplePaymentAllowed) return;
        setPaymentMethod(shortcut.paymentMethod);
        setPayments([]);
      }
    },
    onContinue: submitSale,
    onAdd: () => {
      const product = products.find((item) => item.id === lastProductId);
      if (product) addProduct(product);
    },
    onSubtract: subtractLast,
  });

  const syncPending = useCallback(async ({ manual = false } = {}) => {
    if (syncing || !online) {
      if (manual && !online) setSubmitState({ busy: false, tone: "error", message: "No hay conexión para sincronizar." });
      return;
    }
    const queue = await pendingSales.refresh();
    if (!queue.length) {
      if (manual) setSubmitState({ busy: false, tone: "success", message: "No hay ventas pendientes." });
      return;
    }
    setSyncing(true);
    let synced = 0;
    let failed = 0;
    for (const sale of queue) {
      try {
        const result = await createSellerSale({
          profile,
          location: { id: sale.locationId, name: sale.locationName, codePrefix: sale.locationPrefix },
          items: sale.items,
          discounts: sale.discounts,
          paymentMethod: sale.paymentMethod,
          paymentMethodLabel: sale.paymentMethodLabel,
          payments: sale.payments,
          ticketRequested: sale.ticketRequested === true,
          offlineSale: { localId: sale.localId, createdLocallyAt: sale.createdLocallyAt },
        });
        await markSellerPendingSynced(sale.localId, result.id);
        await deleteSellerPendingSale(sale.localId);
        synced += 1;
      } catch (error) {
        await markSellerPendingError(sale.localId, error.message).catch(() => {});
        failed += 1;
      }
    }
    setSyncing(false);
    await pendingSales.refresh();
    await dailySales.refresh().catch(() => {});
    setSubmitState({ busy: false, tone: failed ? "error" : "success", message: failed ? `${synced} sincronizadas y ${failed} pendientes con error. El stock no se modificó para las fallidas.` : `${synced} venta${synced === 1 ? "" : "s"} sincronizada${synced === 1 ? "" : "s"}.` });
  }, [syncing, online, pendingSales, profile, dailySales]);

  useEffect(() => {
    if (!online) {
      autoSyncAttempted.current = false;
      return;
    }
    if (autoSyncAttempted.current || !(pendingSales.data || []).length) return;
    autoSyncAttempted.current = true;
    syncPending().catch(() => {});
  }, [online, pendingSales.data, syncPending]);

  const applyLocation = (nextId) => {
    setLocationId(nextId);
    resetSale();
    setView("sale");
  };

  const requestLocation = (nextId) => {
    if (nextId === locationId) return;
    if (currentItems.length) setLocationToApply(nextId);
    else applyLocation(nextId);
  };

  const startEdit = (sale) => {
    setLocationId(sale.locationId);
    setCart(Object.fromEntries((sale.items || []).map((item) => [item.productId, {
      id: item.productId,
      productId: item.productId,
      name: item.name,
      abbreviation: item.abbreviation || "",
      price: Number(item.unitPrice || 0),
      unitPrice: Number(item.unitPrice || 0),
      qty: Number(item.qty || 0),
      stock: Number(item.qty || 0),
      imageUrl: "/images/flor-mia/logo-flor-mia.svg",
    }])));
    const discounts = sale.discounts || [];
    setDiscountIds(discounts.filter((discount) => discount.source !== "manual" && discount.discountId !== "manual").map((discount) => discount.discountId || discount.id).filter(Boolean));
    setManualDiscounts(discounts.filter((discount) => discount.source === "manual" || discount.discountId === "manual").map((discount) => ({ ...discount, source: "manual", discountId: "manual" })));
    setPaymentMethod(sale.paymentMethod || "");
    setPayments(salePaymentParts(sale));
    setTicketRequested(sale.ticketRequested === true);
    setEditSale(sale);
    setDetailSale(null);
    setView("sale");
  };

  const confirmCancelSale = async () => {
    if (!cancelTarget) return;
    setSubmitState({ busy: true, tone: "info", message: "Anulando venta…" });
    try {
      await cancelSellerSale({ profile, saleId: cancelTarget.id, reason: cancelReason });
      closeCancelDialog();
      setDetailSale(null);
      await dailySales.refresh();
      setSubmitState({ busy: false, tone: "success", message: "Venta anulada y stock restituido." });
    } catch (error) {
      setSubmitState({ busy: false, tone: "error", message: error.message });
    }
  };

  const canReturnAdmin = canAccessAdminPanel(profile);
  const returnAdmin = () => {
    localStorage.setItem(`flor-mia-preferred-panel-${profile.id}`, "admin");
    navigate("/gestion");
  };

  if (locationsResult.status === "loading") {
    return <main className="fm-seller-loading" id="main-content"><img src="/images/flor-mia/logo-flor-mia.svg" alt="Flor Mía" /><Skeleton lines={4} /></main>;
  }

  if (!locations.length) {
    return (
      <main className="fm-seller-blocked" id="main-content">
        <section>
          <img src="/images/flor-mia/logo-flor-mia.svg" alt="Flor Mía" />
          <Icon name="MapPin" />
          <h1>No tenés ubicaciones asignadas para vender</h1>
          <p>Solicitá al administrador que te asigne una ubicación activa.</p>
          {canReturnAdmin ? <Button icon="LayoutDashboard" onClick={returnAdmin}>Volver al Panel Administrador</Button> : null}
          <Button variant="secondary" icon="LogOut" onClick={logout}>Cerrar sesión</Button>
        </section>
      </main>
    );
  }

  const saleView = (
    <div className="fm-seller-sale-layout">
      <section className="fm-seller-catalog">
        <div className="fm-seller-location-row">
          <label><span>Ubicación</span><select value={locationId} onChange={(event) => requestLocation(event.target.value)}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
          <Badge tone={keyboardActive ? "success" : "neutral"} icon="Keyboard">Botonera {keyboardActive ? "activa" : "desactivada"}</Badge>
        </div>
        {!online ? <div className="fm-seller-offline-note"><Icon name="WifiOff" /><span>Sin conexión. La venta quedará pendiente en este dispositivo y no se mostrará como confirmada.</span></div> : null}
        {editSale ? <div className="fm-seller-edit-note"><span>Editando <strong>{editSale.saleCode}</strong></span><button type="button" onClick={resetSale}>Cancelar edición</button></div> : null}
        {stockResult.status === "loading" || resourcesResult.status === "loading" ? <Skeleton lines={6} /> : null}
        {stockResult.status === "error" ? <EmptyState icon="AlertTriangle" title="No se pudo leer el stock" description={stockResult.error.message} /> : null}
        {stockResult.status === "ready" && !productGroups.length ? <EmptyState icon="Boxes" title="No hay productos habilitados" description="La ubicación no tiene productos disponibles para vender." /> : null}
        {productGroups.map((group) => (
          <section key={group.id} className="fm-seller-category">
            <h2>{group.name}</h2>
            <div className="fm-seller-products">
              {group.items.map((product) => {
                const qty = Number(cart[product.id]?.qty || 0);
                return (
                  <button key={product.id} type="button" className={qty ? "is-selected" : ""} onClick={() => addProduct(product)} disabled={qty >= Number(product.availableStock || 0)}>
                    {product.buttonKey || product.buttonLabel ? <span className="fm-seller-key">{product.buttonLabel || product.buttonKey}</span> : null}
                    <img src={sellerImage(product)} alt="" loading="lazy" />
                    <strong>{product.abbreviation || product.productName}</strong>
                    <span>{product.productName}</span>
                    <small>{formatMoney(product.price)} · Stock {product.availableStock}</small>
                    {qty ? <b>{qty}</b> : null}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </section>
      <aside className="fm-seller-cart">
        <Panel title="Venta actual" description={`${cartQuantity(cart)} producto${cartQuantity(cart) === 1 ? "" : "s"}`} action={<button type="button" className="fm-text-button" disabled={!currentItems.length} onClick={() => setClearRequested(true)}>Vaciar</button>}>
          <div className="fm-seller-cart-lines">
            {currentItems.length ? currentItems.map((item) => (
              <article key={item.id} className={item.qty > item.stock ? "has-error" : ""}>
                <img src={item.imageUrl} alt="" />
                <div><strong>{item.abbreviation || item.name}</strong><small>{formatMoney(item.price)} c/u · {formatMoney(item.qty * item.price)}</small></div>
                <div className="fm-quantity-control"><button type="button" aria-label={`Quitar una unidad de ${item.name}`} onClick={() => changeQuantity(products.find((product) => product.id === item.id) || item, -1)}><Icon name="Minus" /></button><output aria-label={`Cantidad de ${item.name}`}>{item.qty}</output><button type="button" aria-label={`Agregar una unidad de ${item.name}`} onClick={() => changeQuantity(products.find((product) => product.id === item.id) || item, 1)} disabled={item.qty >= item.stock}><Icon name="Plus" /></button></div>
                <button type="button" className="fm-seller-line-remove" aria-label={`Eliminar ${item.name} del carrito`} onClick={() => setCart((current) => { const next = { ...current }; delete next[item.id]; return next; })}><Icon name="X" /></button>
              </article>
            )) : <p className="fm-seller-cart-empty">Tocá un producto o usá la botonera para comenzar.</p>}
          </div>

          <div className="fm-seller-discount-summary">
            <div className="fm-seller-section-head"><strong>Descuentos</strong><button type="button" onClick={() => setDiscountOpen(true)}><Icon name="Percent" />Agregar descuento</button></div>
            {summary.discounts.length ? summary.discounts.map((discount, index) => <div key={`${discount.discountId}-${discount.type}-${discount.value}-${index}`} className="fm-seller-applied-discount"><span><strong>{discount.name}</strong><small>{discount.type === "percent" ? `${discount.value} %` : "Monto fijo"}</small></span><strong>− {formatMoney(discount.amountApplied)}</strong><button type="button" aria-label={`Quitar ${discount.name}`} onClick={() => removeDiscount(discount)}><Icon name="X" /></button></div>) : <span className="fm-seller-no-discount">Sin descuentos aplicados</span>}
            {summary.discounts.length ? <div className="fm-seller-discount-total"><span>Total descuentos</span><strong>− {formatMoney(summary.discountTotal)}</strong></div> : null}
          </div>

          <div className="fm-seller-totals"><div><span>Subtotal</span><strong>{formatMoney(subtotal)}</strong></div><div className="is-grand"><span>Total final</span><strong>{formatMoney(summary.total)}</strong></div></div>

          <fieldset className="fm-seller-payments"><legend>Forma de pago *</legend>{PAYMENT_OPTIONS.filter((option) => option.value !== "multiple" || multiplePaymentAllowed).map((option) => { const selected = paymentMethod === option.value; return <button key={option.value} type="button" className={selected ? "is-selected" : ""} aria-pressed={selected} onClick={() => option.value === "multiple" ? setMultipleOpen(true) : (setPaymentMethod(option.value), setPayments([]))}>{selected ? <Icon name="Check" /> : null}<span>{friendlyPayment[option.value]}</span></button>; })}</fieldset>
          {paymentMethod === "multiple" ? <p className="fm-seller-payment-summary">{payments.map((payment) => `${friendlyPayment[payment.method]} ${formatMoney(payment.amount)}`).join(" · ")}</p> : null}

          <label className={`fm-seller-ticket-option ${ticketRequested ? "is-selected" : ""}`}>
            <input type="checkbox" checked={ticketRequested} disabled={!ticketAllowed} onChange={(event) => setTicketRequested(event.target.checked)} />
            <Icon name="ReceiptText" />
            <span><strong>Agregar ticket</strong><small>{ticketRequested ? "Solicitud pendiente al registrar" : "Preparado para futura integración ARCA"}</small></span>
          </label>

          {submitState.message ? <Toast tone={submitState.tone}>{submitState.message}</Toast> : null}
          <div className="fm-seller-sticky-action"><div><span>Total</span><strong>{formatMoney(summary.total)}</strong></div><Button icon="Check" loading={submitState.busy} disabled={!currentItems.length || !paymentMethod || hasStockConflict} onClick={submitSale} className="fm-seller-confirm">{editSale ? "Guardar cambios" : online ? "Continuar" : "Guardar pendiente"}</Button></div>
        </Panel>
      </aside>
    </div>
  );

  const salesView = (
    <div className="fm-seller-view">
      <div className="fm-seller-view-head"><div><h1>Mis ventas de hoy</h1><p>{selectedLocation?.name}</p></div><Button icon="ShoppingCart" onClick={() => setView("sale")}>Nueva venta</Button></div>
      {dailySales.status === "loading" ? <Skeleton lines={5} /> : null}
      {dailySales.status === "error" ? <Toast tone="error">{dailySales.error.message}</Toast> : null}
      <div className="fm-seller-sales-summary"><span>Monto activo</span><strong>{formatMoney((dailySales.data || []).filter((sale) => sale.status === "active").reduce((sum, sale) => sum + Number(sale.total || 0), 0))}</strong><small>{(dailySales.data || []).filter((sale) => sale.status === "active").length} ventas activas</small></div>
      <div className="fm-seller-sale-list">{(dailySales.data || []).map((sale) => <button key={sale.id} type="button" onClick={() => setDetailSale(sale)}><div><strong>{sale.saleCode}</strong><Badge tone={statusTone(sale.status)}>{sale.status === "active" ? "Activa" : "Anulada"}</Badge></div><div><span>{formatDateTime(sale.createdAt)}</span><strong>{formatMoney(sale.total)}</strong></div><small>{sale.totalItems} productos · {sale.paymentMethodLabel || "Sin forma de pago"}{sale.ticketRequested ? ` · Ticket ${sale.ticketStatus || "pending"}` : ""}</small></button>)}</div>
      {dailySales.status === "ready" && !(dailySales.data || []).length ? <EmptyState icon="ReceiptText" title="Todavía no registraste ventas hoy" description="Las ventas confirmadas de esta ubicación aparecerán aquí." /> : null}
    </div>
  );

  const pendingView = (
    <div className="fm-seller-view">
      <div className="fm-seller-view-head"><div><h1>Ventas pendientes</h1><p>Existen solamente en este dispositivo hasta sincronizarse.</p></div><Button icon="RefreshCw" loading={syncing} disabled={!online || !(pendingSales.data || []).length} onClick={() => syncPending({ manual: true })}>Sincronizar</Button></div>
      {!online ? <div className="fm-seller-offline-note"><Icon name="WifiOff" /><span>La sincronización se habilitará al recuperar internet.</span></div> : null}
      <div className="fm-seller-pending-list">{(pendingSales.data || []).map((sale) => <article key={sale.localId}><header><strong>{sale.localCode}</strong><Badge tone={sale.status === "sync_error" ? "error" : "warning"}>{sale.status === "sync_error" ? "Error" : "Pendiente"}</Badge></header><div><span>{formatDateTime(sale.createdLocallyAt)}</span><strong>{formatMoney(sale.total)}</strong></div><small>{sale.locationName} · {sale.totalItems} productos{sale.ticketRequested ? " · Ticket pendiente" : ""}</small>{sale.syncError ? <p>{sale.syncError}</p> : null}<button type="button" onClick={() => setDeletePendingTarget(sale)}><Icon name="Trash2" />Eliminar pendiente</button></article>)}</div>
      {pendingSales.status === "ready" && !(pendingSales.data || []).length ? <EmptyState icon="RefreshCw" title="No hay ventas pendientes" description="Todas las operaciones de este dispositivo están sincronizadas." /> : null}
    </div>
  );

  const stockView = (
    <div className="fm-seller-view"><div className="fm-seller-view-head"><div><h1>Stock disponible</h1><p>{selectedLocation?.name} · consulta de solo lectura</p></div></div><div className="fm-seller-stock-grid">{products.map((item) => { const status = sellerStockStatus({ ...item, currentStock: item.availableStock }); return <article key={item.id}><img src={sellerImage(item)} alt="" /><div><strong>{item.productName}</strong><span>{item.categoryName || "Sin categoría"}</span><Badge tone={status.tone}>{status.label}</Badge></div><b>{item.availableStock} u.</b></article>; })}</div></div>
  );

  const pricesView = (
    <div className="fm-seller-view"><div className="fm-seller-view-head"><div><h1>Lista de precios</h1><p>{selectedLocation?.name}</p></div></div>{productGroups.map((group) => <section key={group.id} className="fm-seller-price-category"><h2>{group.name}</h2>{group.items.map((item) => <article key={item.id}><div><strong>{item.abbreviation || item.productName}</strong><span>{item.productName}</span></div><div><strong>{formatMoney(item.price)}</strong><small>{item.availableStock > 0 ? "Disponible" : "Sin stock"}</small></div></article>)}</section>)}</div>
  );

  const helpView = (
    <div className="fm-seller-view"><div className="fm-seller-view-head"><div><h1>Ayuda rápida</h1><p>Flujo recomendado para registrar una venta.</p></div></div><ol className="fm-seller-help"><li><Icon name="MapPin" /><div><strong>Elegí la ubicación</strong><span>Verificá el local, feria o evento activo.</span></div></li><li><Icon name="ShoppingCart" /><div><strong>Agregá productos</strong><span>Usá las tarjetas táctiles o la botonera Bluetooth.</span></div></li><li><Icon name="Boxes" /><div><strong>Revisá cantidades</strong><span>El sistema vuelve a validar stock al confirmar.</span></div></li><li><Icon name="Percent" /><div><strong>Aplicá descuentos</strong><span>Los montos fijos se calculan antes de los porcentajes.</span></div></li><li><Icon name="CreditCard" /><div><strong>Elegí el pago</strong><span>Podés usar un medio o distribuir con +2 pagos.</span></div></li><li><Icon name="Check" /><div><strong>Continuá</strong><span>Venta, stock, movimientos y auditoría se guardan juntos.</span></div></li></ol></div>
  );

  return (
    <div className="fm-seller-shell">
      <SellerHeader profile={profile} location={selectedLocation} online={online} syncing={syncing} pendingCount={(pendingSales.data || []).length} view={view} setView={setView} keyboardActive={keyboardActive} setKeyboardActive={setKeyboardActive} canReturnAdmin={canReturnAdmin} onReturnAdmin={returnAdmin} onLogout={logout} />
      <main className="fm-seller-main" id="main-content">{view === "sale" ? saleView : view === "sales" ? salesView : view === "pending" ? pendingView : view === "stock" ? stockView : view === "prices" ? pricesView : helpView}</main>
      <DiscountDialog open={discountOpen} availableDiscounts={availableDiscounts} selectedDiscountIds={discountIds} manualAllowed={manualDiscountAllowed} onClose={() => setDiscountOpen(false)} onSelectSaved={(discount) => setDiscountIds((current) => current.includes(discount.id) ? current.filter((id) => id !== discount.id) : [...current, discount.id])} onAddManual={(discount) => setManualDiscounts((current) => [...current, discount])} />
      <MultiplePaymentDialog open={multipleOpen} total={summary.total} initialPayments={payments} onClose={() => setMultipleOpen(false)} onConfirm={(entries) => { setPayments(entries.filter((entry) => entry.amount > 0)); setPaymentMethod("multiple"); setMultipleOpen(false); }} />
      <ConfirmationDialog open={Boolean(locationToApply)} title="Cambiar ubicación" description="El carrito actual se vaciará para no mezclar productos ni stock entre ubicaciones." onClose={() => setLocationToApply("")} onConfirm={() => { applyLocation(locationToApply); setLocationToApply(""); }} />
      <ConfirmationDialog open={clearRequested} title="Vaciar carrito" description="Se eliminarán productos, descuentos, ticket y forma de pago de la venta actual." onClose={() => setClearRequested(false)} onConfirm={() => { resetSale(); setClearRequested(false); }} />
      <ConfirmationDialog open={Boolean(editRequested)} title="Editar otra venta" description="La venta actual se descartará para cargar la operación seleccionada." onClose={() => setEditRequested(null)} onConfirm={() => { startEdit(editRequested); setEditRequested(null); }} />
      <ConfirmationDialog open={Boolean(deletePendingTarget)} title="Eliminar venta pendiente" description="Esta operación se borrará solamente de este dispositivo y no podrá recuperarse." onClose={() => setDeletePendingTarget(null)} onConfirm={async () => { await deleteSellerPendingSale(deletePendingTarget.localId); setDeletePendingTarget(null); await pendingSales.refresh(); }} />
      <Modal open={Boolean(receipt)} onClose={() => setReceipt(null)} title="Venta registrada"><div className="fm-seller-receipt"><img src="/images/flor-mia/logo-flor-mia.svg" alt="Flor Mía" /><strong>{receipt?.saleCode}</strong><span>{formatMoney(receipt?.total)}</span><p>{receipt?.paymentMethodLabel}</p>{receipt?.ticketRequested ? <Badge tone="warning">Ticket solicitado · pendiente</Badge> : null}<Button onClick={() => setReceipt(null)}>Nueva venta</Button></div></Modal>
      <Modal open={Boolean(detailSale)} onClose={() => setDetailSale(null)} title={detailSale?.saleCode || "Detalle de venta"} footer={detailSale?.status === "active" ? <div className="fm-dialog-actions"><Button variant="destructive" onClick={() => { const sale = detailSale; setDetailSale(null); setCancelReason(""); setCancelTarget(sale); }}>Anular</Button><Button variant="secondary" onClick={() => currentItems.length ? setEditRequested(detailSale) : startEdit(detailSale)}>Editar</Button></div> : null}><div className="fm-seller-sale-detail"><p>{formatDateTime(detailSale?.createdAt)} · {detailSale?.paymentMethodLabel}</p>{(detailSale?.items || []).map((item) => <div key={item.productId}><span>{item.qty} × {item.name}</span><strong>{formatMoney(item.subtotal)}</strong></div>)}{(detailSale?.discounts || []).map((discount, index) => <div key={`${discount.discountId}-${index}`}><span>{discount.name}</span><strong>− {formatMoney(discount.amountApplied)}</strong></div>)}<div className="is-total"><span>Total</span><strong>{formatMoney(detailSale?.total)}</strong></div>{detailSale?.ticketRequested ? <div><span>Ticket</span><strong>{detailSale.ticketStatus || "pending"}</strong></div> : null}</div></Modal>
      <Modal
        open={Boolean(cancelTarget)}
        onClose={closeCancelDialog}
        title="Anular venta"
        description="Las unidades volverán al stock y la venta conservará su historial."
        footer={<div className="fm-dialog-actions"><Button variant="secondary" onClick={closeCancelDialog}>Cancelar</Button><Button variant="destructive" icon="Trash2" loading={submitState.busy} onClick={confirmCancelSale}>Anular venta</Button></div>}
      >
        <label className="fm-field">
          <span>Motivo de anulación (opcional)</span>
          <textarea rows="3" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Ej.: cliente cambió el producto" />
          <small className="fm-field__hint">Si es posible, indicá brevemente por qué se anula la venta.</small>
        </label>
      </Modal>
    </div>
  );
}
