import { effectiveLocationPrice } from "../../modules/inventory/domain/inventory";
import { saleStockDiscrepancies } from "../../modules/locations/domain/saleStock";
import SaleStockWarning from "../components/SaleStockWarning";
import { getArcaInvoiceForSale, arcaSourceTypeForSale } from "../services/arcaService";
import { fiscalPresentation } from "../../shared/fiscalRecovery.mjs";
import ArcaInvoicePrintAction from "../components/ArcaInvoicePrintAction";
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
  normalizePayment,
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
import { useOnlineStatus } from "../hooks";
import {
  can,
  canAccessAdminPanel,
} from "../permissions";
import {
  cancelSellerSale,
  createSellerSale,
  updateSellerSale,
} from "../services/sellerService";
import CustomerDialog from "./CustomerDialog";
import DiscountDialog from "./DiscountDialog";
import { sellerErrorMessage, sellerProblem, sellerProductProblem, sellerSaleProblem } from "./sellerValidation";
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
  useSellerResources,
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

const customerZone = (customer = {}) => customer.zoneName || customer.customZone || customer.zone || "";
const asArray = (value) => Array.isArray(value) ? value : [];

function SellerHeader({
  profile,
  location,
  online,
  syncing,
  pendingCount,
  view,
  setView,
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
          <Dropdown label={<span className="fm-profile-trigger"><span className="fm-avatar">{String(profile.name || profile.email || "V").slice(0, 1).toUpperCase()}</span><span><strong>{profile.name || "Usuario"}</strong><small>Panel Vendedor</small></span><Icon name="ChevronDown" /></span>}>
            <div className="fm-profile-menu">
              {canReturnAdmin ? <button type="button" onClick={onReturnAdmin}><Icon name="LayoutDashboard" />Volver al Panel Administrador</button> : null}
              <button type="button" onClick={onLogout}><Icon name="LogOut" />Cerrar sesión</button>
            </div>
          </Dropdown>
        </div>
      </header>
      <nav className="fm-seller-nav" aria-label="Secciones del Panel Vendedor">
        {SELLER_VIEWS.map((item) => (
          <button key={item.id} type="button" aria-label={item.label} className={view === item.id ? "is-active" : ""} aria-current={view === item.id ? "page" : undefined} onClick={() => setView(item.id)}>
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
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setError("");
    setValues(Object.fromEntries(
      SINGLE_PAYMENT_METHODS.map((method) => [
        method,
        asArray(initialPayments).find((payment) => payment.method === method)?.amount || "",
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
      footer={<div><div className="fm-dialog-actions"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => {
        try { normalizePayment("multiple", PAYMENT_LABELS.multiple, entries, total); onConfirm(entries); }
        catch (problem) { setError(sellerProblem("PAGO-DESGLOSE", problem.message)); }
      }}>Confirmar</Button></div>{error ? <p className="fm-form-error" role="alert">{error}</p> : null}</div>}
    >
      <div className="fm-seller-multiple-total"><span>Total de la venta</span><strong>{formatMoney(total)}</strong></div>
      <div className="fm-seller-payment-rows">
        {SINGLE_PAYMENT_METHODS.map((method) => (
          <label key={method}>
            <span>{friendlyPayment[method]}</span>
            <div>
              <input aria-label={`Monto en ${friendlyPayment[method]}`} type="number" min="0" step="1" inputMode="numeric" value={values[method] ?? ""} onChange={(event) => { setError(""); setValues((current) => ({ ...current, [method]: event.target.value })); }} />
              <button type="button" onClick={() => {
                if (summary.invalid || summary.difference <= 0) { setError(sellerProblem("PAGO-SALDO", summary.invalid ? "Corregí los importes inválidos antes de completar el saldo." : "No queda saldo para completar. Revisá los importes cargados.")); return; }
                const completed = completeRemainingPayment(entries, method, total);
                setError("");
                setValues(Object.fromEntries(completed.map((entry) => [entry.method, entry.amount || ""])));
              }}>Completar saldo</button>
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
  const resourcesResult = useSellerResources(profile);
  const [locationId, setLocationId] = useState("");
  const [view, setView] = useState("sale");
  const [cart, setCart] = useState({});
  const [discountIds, setDiscountIds] = useState([]);
  const [manualDiscounts, setManualDiscounts] = useState([]);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [suggestedDiscountId, setSuggestedDiscountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [payments, setPayments] = useState([]);
  const [ticketRequested, setTicketRequested] = useState(false);
  const [keyboardActive, setKeyboardActive] = useState(true);
  const [openCategoryId, setOpenCategoryId] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [lastProductId, setLastProductId] = useState("");
  const [editSale, setEditSale] = useState(null);
  const submitRef = useRef(false);
  const [submitState, setSubmitState] = useState({ busy: false, message: "", tone: "info" });
  const [multipleOpen, setMultipleOpen] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [detailSale, setDetailSale] = useState(null);
  const [fiscalDetail, setFiscalDetail] = useState({ ready: false, invoice: null, error: "" });
  useEffect(() => {
    if (!detailSale?.id) return;
    let active = true;
    setFiscalDetail({ ready: false, invoice: null, error: "" });
    getArcaInvoiceForSale({ saleId: detailSale.id, sourceType: arcaSourceTypeForSale(detailSale) })
      .then((invoice) => { if (active) setFiscalDetail({ ready: true, invoice, error: "" }); })
      .catch((error) => { if (active) setFiscalDetail({ ready: error.code === "arca-invoice-not-found", invoice: null, error: error.code === "arca-invoice-not-found" ? "" : "No se pudo revisar el vínculo fiscal. Solicitá revisión administrativa." }); });
    return () => { active = false; };
  }, [detailSale?.id]);
  const [locationToApply, setLocationToApply] = useState("");
  const [clearRequested, setClearRequested] = useState(false);
  const [editRequested, setEditRequested] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [deletePendingTarget, setDeletePendingTarget] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const autoSyncAttempted = useRef(false);
  const syncRef = useRef(false);

  const closeCancelDialog = useCallback(() => {
    setCancelTarget(null);
    setCancelReason("");
  }, []);

  const locations = asArray(locationsResult.data);
  const selectedLocation = locations.find((location) => location.id === locationId) || null;
  const stockResult = useSellerLocationStock(profile, locationId);
  const dailySales = useSellerDailySales(profile, locationId);
  const pendingSales = useSellerPendingSales(profile);
  const resources = resourcesResult.data && typeof resourcesResult.data === "object"
    ? resourcesResult.data
    : {};
  const categories = asArray(resources.categories);
  const discounts = asArray(resources.discounts);
  const customerZones = asArray(resources.zones);

  useEffect(() => {
    if (!locations.length) {
      setLocationId("");
      return;
    }
    let remembered = "";
    try {
      remembered = localStorage.getItem(`flor-mia-seller-location-${profile.id}`) || "";
    } catch {
      remembered = "";
    }
    if (locations.some((location) => location.id === locationId)) return;
    const next = locations.find((location) => location.id === remembered)?.id || locations[0].id;
    setLocationId(next);
  }, [locations, locationId, profile.id]);

  useEffect(() => {
    if (!locationId) return;
    try {
      localStorage.setItem(`flor-mia-seller-location-${profile.id}`, locationId);
    } catch {
      // La selección sigue funcionando aunque el navegador bloquee localStorage.
    }
  }, [locationId, profile.id]);

  useEffect(() => {
    try {
      localStorage.setItem(`flor-mia-preferred-panel-${profile.id}`, "seller");
    } catch {
      // La preferencia es opcional y nunca debe impedir abrir el panel.
    }
  }, [profile.id]);

  const pendingData = asArray(pendingSales.data);
  const stockData = asArray(stockResult.data);
  const reserved = useMemo(
    () => pendingReservedQuantities(pendingData, locationId),
    [pendingData, locationId],
  );
  const masterById = useMemo(() => new Map((resourcesResult.data?.products || []).map((product) => [product.id, product])), [resourcesResult.data?.products]);
  const products = useMemo(() => stockData.map((item) => ({
    ...item,
    price: effectiveLocationPrice(masterById.get(item.productId || item.id) || { defaultPrice: item.masterDefaultPrice ?? item.price ?? 0 }, item),
    availableStock: Number(item.currentStock || 0) - Number(reserved[item.id] || 0) +
      Number(editSale?.items?.find((old) => old.productId === item.id)?.qty || 0),
  })), [stockData, reserved, editSale, masterById]);
  const productGroups = useMemo(
    () => groupSellerProducts(products, categories),
    [products, categories],
  );

  useEffect(() => {
    if (openCategoryId && !productGroups.some((group) => group.id === openCategoryId)) {
      setOpenCategoryId("");
    }
  }, [openCategoryId, productGroups]);

  useEffect(() => {
    if (stockResult.status !== "ready") return;
    setCart((current) => Object.fromEntries(Object.entries(current).map(([id, item]) => {
      const product = products.find((entry) => entry.id === id);
      return [id, product ? { ...item, categoryId: product.categoryId || null, stock: product.availableStock, imageUrl: sellerImage(product), unavailable: false } : { ...item, unavailable: true }];
    })));
  }, [products, stockResult.status]);

  const currentItems = useMemo(() => cartItems(cart), [cart]);
  const subtotal = useMemo(() => cartSubtotal(cart), [cart]);
  const availableDiscounts = useMemo(() => {
    // Durante el primer render las ubicaciones pueden estar cargadas pero el
    // effect que elige la ubicación todavía no corrió. Nunca se evalúan
    // descuentos contra una ubicación nula.
    if (!selectedLocation) return [];
    return discounts.filter((discount) =>
      isDiscountAvailable(discount, selectedLocation, new Date(), { profile, items: currentItems }),
    );
  }, [discounts, selectedLocation, profile, currentItems]);
  const savedDiscounts = availableDiscounts
    .filter((discount) => discountIds.includes(discount.id))
    .map((discount) => ({ ...discount, discountId: discount.id, source: "saved" }));
  const appliedDiscounts = [...savedDiscounts, ...manualDiscounts];
  const summary = useMemo(
    () => calculateDiscountSummary(appliedDiscounts, subtotal),
    [appliedDiscounts, subtotal],
  );
  const stockDiscrepancies = saleStockDiscrepancies(currentItems);
  const discountAllowed = can(profile, "quick-sales", "useDiscounts");
  const manualDiscountAllowed = discountAllowed && can(profile, "quick-sales", "useManualDiscounts");
  const multiplePaymentAllowed = can(profile, "quick-sales", "useMultiplePayments");
  const ticketAllowed = can(profile, "quick-sales", "requestTicket");

  useEffect(() => {
    const removed = discountIds.filter(id => !availableDiscounts.some(discount => discount.id === id));
    if (removed.length && !submitRef.current) {
      const names = removed.map(id => discounts.find(discount => discount.id === id)?.name || id).join(", ");
      setSubmitState({ busy: false, tone: "error", message: sellerProblem("DESCUENTO-NO-DISPONIBLE", `${names} dejó de estar disponible para esta venta y se quitó del total. Revisá los descuentos antes de continuar.`) });
    }
    setDiscountIds((current) => current.filter((id) => availableDiscounts.some((discount) => discount.id === id)));
  }, [availableDiscounts]);

  useEffect(() => {
    if (paymentMethod === "multiple" && payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0) !== summary.total) {
      if (submitRef.current) return;
      setSubmitState({ busy: false, tone: "error", message: sellerProblem("PAGO-TOTAL-CAMBIO", "El total cambió. Tocá +2 pagos para ajustar los importes; conservamos lo que ya cargaste.") });
    }
  }, [summary.total, paymentMethod, payments]);

  const resetSale = useCallback(() => {
    setCart({});
    setDiscountIds([]);
    setManualDiscounts([]);
    setDiscountOpen(false);
    setSuggestedDiscountId("");
    setPaymentMethod("");
    setPayments([]);
    setTicketRequested(false);
    setSelectedCustomer(null);
    setCustomerOpen(false);
    setLastProductId("");
    setEditSale(null);
    setSubmitState({ busy: false, message: "", tone: "info" });
  }, []);

  const changeQuantity = useCallback((product, amount) => {
    if (submitRef.current) return;
    if (amount > 0) {
      const problem = stockResult.status !== "ready"
        ? sellerProblem("VENTA-CARGANDO", "Todavía estamos cargando los productos de esta ubicación. Esperá un momento.")
        : sellerProductProblem(product);
      if (problem) { setSubmitState({ busy: false, tone: "error", message: problem }); return; }
    }
    setSubmitState({ busy: false, message: "", tone: "info" });
    setCart((current) => {
      const existing = current[product.id];
      const nextQty = Number(existing?.qty || 0) + amount;
      if (nextQty <= 0) {
        const next = { ...current };
        delete next[product.id];
        return next;
      }
      return {
        ...current,
        [product.id]: {
          id: product.id,
          productId: product.id,
          name: product.productName || product.name,
          abbreviation: product.abbreviation || "",
          categoryId: product.categoryId || null,
          price: Number(product.price || 0),
          unitPrice: Number(product.price || 0),
          qty: nextQty,
          stock: Number(product.availableStock ?? product.stock ?? 0),
          imageUrl: product.imageUrl || sellerImage(product),
          unavailable: product.unavailable === true,
        },
      };
    });
    setLastProductId(product.id);
  }, [stockResult.status]);

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
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
      customer: selectedCustomer,
      ticketRequested,
    });
    resetSale();
    setSubmitState({ busy: false, tone: "success", message: "Venta guardada en este dispositivo. Todavía no está confirmada en Firestore." });
    await pendingSales.refresh().catch((error) => setSubmitState({ busy: false, tone: "warning", message: `La venta quedó guardada en este dispositivo, pero no pudimos actualizar la lista. No la cargues de nuevo. ${sellerErrorMessage(error)}` }));
  }, [selectedLocation, profile, currentItems, appliedDiscounts, summary.total, paymentMethod, payments, selectedCustomer, ticketRequested, pendingSales, resetSale]);

  const submitSale = useCallback(async () => {
    if (submitRef.current || submitState.busy) return;
    const problem = sellerSaleProblem({ profile, location: selectedLocation, items: currentItems, paymentMethod, payments, total: summary.total, discounts: appliedDiscounts, online, editing: Boolean(editSale), stockStatus: stockResult.status, stockError: stockResult.error, pendingStatus: pendingSales.status, pendingError: pendingSales.error, ticketRequested });
    if (problem) {
      setSubmitState({ busy: false, tone: "error", message: problem });
      return;
    }
    submitRef.current = true;
    setSubmitState({ busy: true, tone: "info", message: online ? "Registrando venta…" : "Guardando pendiente…" });
    try {
      if (!online) {
        await savePending();
        return;
      }
      const common = {
        profile,
        items: currentItems,
        discounts: appliedDiscounts,
        paymentMethod,
        paymentMethodLabel: PAYMENT_LABELS[paymentMethod],
        payments,
        customer: selectedCustomer,
        ticketRequested,
      };
      const result = editSale
        ? await updateSellerSale({ ...common, saleId: editSale.id })
        : await createSellerSale({ ...common, location: selectedLocation });
      resetSale();
      setReceipt(result);
      setSubmitState({ busy: false, tone: result.stockDiscrepancies?.length ? "warning" : "success", message: `${result.saleCode} registrada correctamente.${result.stockDiscrepancies?.length ? " Stock negativo pendiente de revisión." : ""}` });
      dailySales.refresh().catch((error) => setSubmitState({ busy: false, tone: "warning", message: `${result.saleCode} quedó registrada, pero no pudimos actualizar Mis ventas. No la cargues de nuevo. ${sellerErrorMessage(error)}` }));
    } catch (error) {
      setSubmitState({ busy: false, tone: "error", message: sellerErrorMessage(error) });
    } finally {
      submitRef.current = false;
    }
  }, [submitState.busy, selectedLocation, currentItems, paymentMethod, payments, summary.total, selectedCustomer, ticketRequested, online, editSale, savePending, profile, appliedDiscounts, resetSale, dailySales, stockResult.status, stockResult.error, pendingSales.status, pendingSales.error]);

  const actionShortcuts = useMemo(() => SELLER_ACTION_SHORTCUTS.map((action) => ({
    ...action,
    ...(resources.shortcuts?.sellerActions?.[action.id] || {}),
  })), [resources.shortcuts]);

  useSellerKeyboard({
    enabled: keyboardActive && view === "sale" && !submitState.busy,
    products,
    discounts: availableDiscounts,
    actionShortcuts,
    onProduct: addProduct,
    onDiscount: (discount) => {
      if (!discountAllowed) { setSubmitState({ busy: false, tone: "error", message: sellerProblem("DESCUENTO-PERMISO", "Tu usuario no puede aplicar descuentos. Pedile permiso al administrador.") }); return; }
      setSuggestedDiscountId(discount.id);
      setDiscountOpen(true);
    },
    onShortcut: (shortcut) => {
      if (shortcut.paymentMethod) {
        if (shortcut.paymentMethod === "multiple") {
          if (!multiplePaymentAllowed) { setSubmitState({ busy: false, tone: "error", message: sellerProblem("PAGO-PERMISO", "Tu usuario no puede combinar pagos. Elegí un solo medio o pedí permiso al administrador.") }); return; }
          setMultipleOpen(true);
          return;
        }
        setPaymentMethod(shortcut.paymentMethod);
        setPayments([]);
        setSubmitState({ busy: false, tone: "info", message: "" });
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
    if (syncRef.current || syncing || !online) {
      if (manual && !online) setSubmitState({ busy: false, tone: "error", message: sellerProblem("PENDIENTES-SIN-CONEXION", "No hay conexión para sincronizar. Las ventas siguen guardadas en este dispositivo.") });
      return;
    }
    syncRef.current = true;
    setSyncing(true);
    try {
      const queue = await pendingSales.refresh();
      if (!queue.length) {
        if (manual) setSubmitState({ busy: false, tone: "success", message: "No hay ventas pendientes." });
        return;
      }
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
            customer: sale.customer || null,
            ticketRequested: sale.ticketRequested === true,
            offlineSale: { localId: sale.localId, createdLocallyAt: sale.createdLocallyAt },
          });
          await markSellerPendingSynced(sale.localId, result.id);
          await deleteSellerPendingSale(sale.localId);
          synced += 1;
        } catch (error) {
          await markSellerPendingError(sale.localId, sellerErrorMessage(error)).catch(() => {});
          failed += 1;
        }
      }
      await pendingSales.refresh();
      await dailySales.refresh().catch(() => {});
      setSubmitState({ busy: false, tone: failed ? "error" : "success", message: failed ? sellerProblem("PENDIENTES-REVISAR", `${synced} sincronizadas y ${failed} pendientes de revisar. Mirá el motivo en cada venta antes de reintentar.`) : `${synced} venta${synced === 1 ? "" : "s"} sincronizada${synced === 1 ? "" : "s"}.` });
    } catch (error) {
      setSubmitState({ busy: false, tone: "error", message: sellerErrorMessage(error) });
    } finally {
      syncRef.current = false;
      setSyncing(false);
    }
  }, [syncing, online, pendingSales, profile, dailySales]);

  useEffect(() => {
    if (!online) {
      autoSyncAttempted.current = false;
      return;
    }
    if (autoSyncAttempted.current || !pendingData.length) return;
    autoSyncAttempted.current = true;
    syncPending().catch(() => {});
  }, [online, pendingData, syncPending]);

  const applyLocation = (nextId) => {
    setLocationId(nextId);
    resetSale();
    setView("sale");
  };

  const requestLocation = (nextId) => {
    if (submitRef.current) return;
    if (nextId === locationId) return;
    if (currentItems.length) setLocationToApply(nextId);
    else applyLocation(nextId);
  };

  const startEdit = (sale) => {
    setLocationId(sale.locationId);
    setCart(Object.fromEntries(asArray(sale.items).map((item) => [item.productId, {
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
    const saleDiscounts = asArray(sale.discounts);
    setDiscountIds(saleDiscounts.filter((discount) => discount.source !== "manual" && discount.discountId !== "manual").map((discount) => discount.discountId || discount.id).filter(Boolean));
    setManualDiscounts(saleDiscounts.filter((discount) => discount.source === "manual" || discount.discountId === "manual").map((discount) => ({ ...discount, source: "manual", discountId: "manual" })));
    setPaymentMethod(sale.paymentMethod || "");
    setPayments(salePaymentParts(sale));
    setTicketRequested(sale.ticketRequested === true);
    setSelectedCustomer(sale.customerId && sale.customerPhoneSnapshot ? {
      id: sale.customerId,
      phone: sale.customerPhoneSnapshot,
      phoneNormalized: sale.customerPhoneSnapshot,
      name: sale.customerNameSnapshot || "",
      zoneName: sale.customerZoneSnapshot || "",
      persisted: true,
    } : null);
    setEditSale(sale);
    setDetailSale(null);
    setView("sale");
  };

  const confirmCancelSale = async () => {
    if (!cancelTarget || submitRef.current) return;
    submitRef.current = true;
    setSubmitState({ busy: true, tone: "info", message: "Anulando venta…" });
    try {
      await cancelSellerSale({ profile, saleId: cancelTarget.id, reason: cancelReason });
      closeCancelDialog();
      setDetailSale(null);
      setSubmitState({ busy: false, tone: "success", message: "Venta anulada y stock restituido." });
      await dailySales.refresh().catch(error => setSubmitState({ busy: false, tone: "warning", message: `La venta quedó anulada, pero no pudimos actualizar la lista. ${sellerErrorMessage(error)}` }));
    } catch (error) {
      setSubmitState({ busy: false, tone: "error", message: sellerErrorMessage(error) });
    } finally {
      submitRef.current = false;
    }
  };

  const confirmDeletePending = async () => {
    if (!deletePendingTarget || submitRef.current) return;
    submitRef.current = true;
    const target = deletePendingTarget;
    setDeletePendingTarget(null);
    setSubmitState({ busy: true, tone: "info", message: "Descartando venta pendiente…" });
    try {
      await deleteSellerPendingSale(target.localId);
      setSubmitState({ busy: false, tone: "success", message: "Venta pendiente descartada de este dispositivo." });
      await pendingSales.refresh().catch(error => setSubmitState({ busy: false, tone: "warning", message: `La venta pendiente se descartó, pero no pudimos actualizar la lista. ${sellerErrorMessage(error)}` }));
    } catch (error) {
      setSubmitState({ busy: false, tone: "error", message: sellerErrorMessage(error) });
    } finally {
      submitRef.current = false;
    }
  };

  const canReturnAdmin = canAccessAdminPanel(profile);
  const returnAdmin = () => {
    try {
      localStorage.setItem(`flor-mia-preferred-panel-${profile.id}`, "admin");
    } catch {
      // La preferencia no es crítica para la navegación.
    }
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
          <h1>{locationsResult.error ? "No pudimos cargar tus ubicaciones" : "No tenés ubicaciones asignadas para vender"}</h1>
          {locationsResult.error ? <><p className="fm-form-error" role="alert">{sellerErrorMessage(locationsResult.error)}</p><Button onClick={() => locationsResult.refresh().catch(() => {})}>Reintentar</Button></> : <p>Solicitá al administrador que te asigne una ubicación activa.</p>}
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
          <button
            type="button"
            className={`fm-seller-keyboard-toggle ${keyboardActive ? "is-active" : "is-inactive"}`}
            aria-pressed={keyboardActive}
            aria-label={keyboardActive ? "Botonera activa. Desactivar botonera" : "Botonera desactivada. Activar botonera"}
            onClick={() => setKeyboardActive((value) => !value)}
          >
            <Icon name="Keyboard" />
            <span><strong>Botonera {keyboardActive ? "activa" : "desactivada"}</strong><small>{keyboardActive ? "Atajos habilitados" : "Atajos pausados"}</small></span>
          </button>
        </div>
        {!online ? <div className="fm-seller-offline-note"><Icon name="WifiOff" /><span>Sin conexión. La venta quedará pendiente en este dispositivo y no se mostrará como confirmada.</span></div> : null}
        {editSale ? <div className="fm-seller-edit-note"><span>Editando <strong>{editSale.saleCode}</strong></span><button type="button" onClick={resetSale}>Cancelar edición</button></div> : null}
        {resourcesResult.error ? <Toast tone="error">No se pudieron actualizar algunos recursos. {sellerErrorMessage(resourcesResult.error)}</Toast> : null}
        <div className="fm-seller-catalog-scroll" aria-label="Catálogo de productos por categoría">
          {stockResult.status === "loading" || resourcesResult.status === "loading" ? <Skeleton lines={6} /> : null}
          {stockResult.error ? <EmptyState icon="AlertTriangle" title="No se pudo actualizar el stock" description={sellerErrorMessage(stockResult.error)} /> : null}
          {stockResult.status === "ready" && !productGroups.length ? <EmptyState icon="Boxes" title="No hay productos habilitados" description="La ubicación no tiene productos disponibles para vender." /> : null}
          {productGroups.map((group) => {
            const open = openCategoryId === group.id;
            const controlId = `seller-category-${String(group.id).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
            return (
              <section key={group.id} className={`fm-seller-category ${open ? "is-open" : ""}`}>
                <h2>
                  <button type="button" aria-expanded={open} aria-controls={controlId} onClick={() => setOpenCategoryId((current) => current === group.id ? "" : group.id)}>
                    <span><strong>{group.name}</strong><small>{group.items.length} producto{group.items.length === 1 ? "" : "s"}</small></span>
                    <Icon name="ChevronDown" />
                  </button>
                </h2>
                {open ? (
                  <div className="fm-seller-products" id={controlId}>
                    {group.items.map((product) => {
                      const qty = Number(cart[product.id]?.qty || 0);
                      return (
                        <button key={product.id} type="button" className={qty ? "is-selected" : ""} onClick={() => addProduct(product)}>
                          {product.buttonKey || product.buttonLabel ? <span className="fm-seller-key">{product.buttonLabel || product.buttonKey}</span> : null}
                          <img src={sellerImage(product)} alt="" loading="lazy" decoding="async" />
                          <strong>{product.abbreviation || product.productName}</strong>
                          <span>{product.productName}</span>
                          <small>{formatMoney(product.price)} · Stock {product.availableStock}</small>
                          {qty ? <b>{qty}</b> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </section>
      <aside className="fm-seller-cart">
        <fieldset className="fm-seller-sale-controls" disabled={submitState.busy}>
        <Panel title="Venta actual" description={`${cartQuantity(cart)} producto${cartQuantity(cart) === 1 ? "" : "s"}`} action={<button type="button" className="fm-text-button" onClick={() => currentItems.length ? setClearRequested(true) : setSubmitState({ busy: false, tone: "error", message: sellerProblem("VENTA-VACIA", "La venta ya está vacía. Agregá un producto para empezar.") })}>Vaciar</button>}>
          <div className="fm-seller-cart-lines">
            {currentItems.length ? currentItems.map((item) => (
              <article key={item.id} className={item.qty > item.stock ? "has-stock-warning" : ""}>
                <img src={item.imageUrl} alt="" loading="lazy" decoding="async" />
                <div><strong>{item.abbreviation || item.name}</strong><small>{formatMoney(item.price)} c/u · {formatMoney(item.qty * item.price)}</small></div>
                <div className="fm-quantity-control"><button type="button" aria-label={`Quitar una unidad de ${item.name}`} onClick={() => changeQuantity(products.find((product) => product.id === item.id) || item, -1)}><Icon name="Minus" /></button><output aria-label={`Cantidad de ${item.name}`}>{item.qty}</output><button type="button" aria-label={`Agregar una unidad de ${item.name}`} onClick={() => changeQuantity(products.find((product) => product.id === item.id) || item, 1)}><Icon name="Plus" /></button></div>
                <button type="button" className="fm-seller-line-remove" aria-label={`Eliminar ${item.name} del carrito`} onClick={() => setCart((current) => { const next = { ...current }; delete next[item.id]; return next; })}><Icon name="X" /></button>
              </article>
            )) : <p className="fm-seller-cart-empty">Tocá un producto o usá la botonera para comenzar.</p>}
          </div>

          <SaleStockWarning discrepancies={stockDiscrepancies} />
          <div className="fm-seller-discount-summary">
            <div className="fm-seller-section-head"><strong>Descuentos</strong><button type="button" onClick={() => { if (!discountAllowed) { setSubmitState({ busy: false, tone: "error", message: sellerProblem("DESCUENTO-PERMISO", "Tu usuario no puede aplicar descuentos. Pedile permiso al administrador.") }); return; } setSuggestedDiscountId(""); setDiscountOpen(true); }}><Icon name="Percent" />Agregar descuento</button></div>
            {summary.discounts.length ? summary.discounts.map((discount, index) => <div key={`${discount.discountId}-${discount.type}-${discount.value}-${index}`} className="fm-seller-applied-discount"><span><strong>{discount.name}</strong><small>{discount.type === "percent" ? `${discount.value} %` : "Monto fijo"}</small></span><strong>− {formatMoney(discount.amountApplied)}</strong><button type="button" aria-label={`Quitar ${discount.name}`} onClick={() => removeDiscount(discount)}><Icon name="X" /></button></div>) : <span className="fm-seller-no-discount">Sin descuentos aplicados</span>}
            {summary.discounts.length ? <div className="fm-seller-discount-total"><span>Total descuentos</span><strong>− {formatMoney(summary.discountTotal)}</strong></div> : null}
          </div>

          <div className="fm-seller-totals"><div><span>Subtotal</span><strong>{formatMoney(subtotal)}</strong></div><div className="is-grand"><span>Total final</span><strong>{formatMoney(summary.total)}</strong></div></div>

          <fieldset className="fm-seller-payments"><legend>Forma de pago *</legend>{PAYMENT_OPTIONS.filter((option) => option.value !== "multiple" || multiplePaymentAllowed).map((option) => { const selected = paymentMethod === option.value; return <button key={option.value} type="button" className={selected ? "is-selected" : ""} aria-pressed={selected} onClick={() => option.value === "multiple" ? setMultipleOpen(true) : (setPaymentMethod(option.value), setPayments([]), setSubmitState({ busy: false, tone: "info", message: "" }))}>{selected ? <Icon name="Check" /> : null}<span>{friendlyPayment[option.value]}</span></button>; })}</fieldset>
          {paymentMethod === "multiple" ? <p className="fm-seller-payment-summary">{payments.map((payment) => `${friendlyPayment[payment.method]} ${formatMoney(payment.amount)}`).join(" · ")}</p> : null}

          <div className="fm-seller-customer-section">
            {selectedCustomer ? (
              <div className="fm-seller-customer-selected">
                <div className="fm-seller-customer-selected__icon"><Icon name="UserRoundCheck" /></div>
                <div>
                  <small>Cliente</small>
                  <strong>{selectedCustomer.phone || selectedCustomer.phoneNormalized}</strong>
                  {customerZone(selectedCustomer) ? <span>{customerZone(selectedCustomer)}</span> : null}
                  {selectedCustomer.name ? <span>{selectedCustomer.name}</span> : null}
                </div>
                <div className="fm-seller-customer-selected__actions">
                  <button type="button" onClick={() => setCustomerOpen(true)}>Cambiar</button>
                  <button type="button" onClick={() => setSelectedCustomer(null)}>Quitar</button>
                </div>
              </div>
            ) : (
              <button type="button" className="fm-seller-add-customer" onClick={() => setCustomerOpen(true)}>
                <Icon name="UserPlus" />
                <span><strong>Agregar cliente</strong><small>Teléfono · zona · nombre opcional</small></span>
                <Icon name="ChevronRight" />
              </button>
            )}
          </div>

          <label className={`fm-seller-ticket-option ${ticketRequested ? "is-selected" : ""}`}>
            <input type="checkbox" checked={ticketRequested} onChange={(event) => { if (!ticketAllowed) { setSubmitState({ busy: false, tone: "error", message: sellerProblem("TICKET-PERMISO", "Tu usuario no puede solicitar un ticket. Pedile permiso al administrador.") }); return; } setTicketRequested(event.target.checked); }} />
            <Icon name="ReceiptText" />
            <span><strong>Agregar ticket</strong><small>{ticketRequested ? "Solicitud pendiente al registrar" : "Preparar solicitud fiscal ARCA después de guardar la venta"}</small></span>
          </label>

          <div className="fm-seller-sticky-action"><div><span>Total</span><strong>{formatMoney(summary.total)}</strong></div><Button icon="Check" loading={submitState.busy} onClick={submitSale} className="fm-seller-confirm">{editSale ? "Guardar cambios" : online ? "Continuar" : "Guardar pendiente"}</Button></div>
          {submitState.message ? <div className="fm-seller-action-feedback" role={submitState.tone === "error" ? "alert" : "status"}>{submitState.tone === "error" ? <p className="fm-form-error">{submitState.message}</p> : <Toast tone={submitState.tone}>{submitState.message}</Toast>}</div> : null}
        </Panel>
        </fieldset>
      </aside>
    </div>
  );

  const salesData = asArray(dailySales.data);
  const salesView = (
    <div className="fm-seller-view">
      <div className="fm-seller-view-head"><div><h1>Mis ventas de hoy</h1><p>{selectedLocation?.name || "Ubicación"}</p></div><Button icon="ShoppingCart" onClick={() => setView("sale")}>Nueva venta</Button></div>
      {dailySales.status === "loading" ? <Skeleton lines={5} /> : null}
      {dailySales.error ? <Toast tone="error">{sellerErrorMessage(dailySales.error)}</Toast> : null}
      <div className="fm-seller-sales-summary"><span>Monto activo</span><strong>{formatMoney(salesData.filter((sale) => sale.status === "active").reduce((sum, sale) => sum + Number(sale.total || 0), 0))}</strong><small>{salesData.filter((sale) => sale.status === "active").length} ventas activas</small></div>
      <div className="fm-seller-sale-list">{salesData.length ? salesData.map((sale) => <button key={sale.id} type="button" onClick={() => setDetailSale(sale)}><div><strong>{sale.saleCode}</strong><Badge tone={statusTone(sale.status)}>{sale.status === "cancelled" ? "Anulada" : "Activa"}</Badge></div><span>{formatMoney(sale.total)}</span><small>{formatDateTime(sale.createdAt)}</small></button>) : <EmptyState icon="ReceiptText" title="Todavía no registraste ventas" description="Las ventas confirmadas de esta ubicación aparecerán aquí." />}</div>
    </div>
  );

  const pendingView = (
    <div className="fm-seller-view">
      <div className="fm-seller-view-head"><div><h1>Ventas pendientes</h1><p>Se guardan sólo en este dispositivo hasta sincronizar.</p></div><Button icon="RefreshCw" loading={syncing} onClick={() => syncPending({ manual: true })}>Sincronizar ahora</Button></div>
      {pendingSales.error ? <Toast tone="error">{sellerErrorMessage(pendingSales.error)}</Toast> : null}
      <div className="fm-seller-pending-list">{pendingData.length ? pendingData.map((sale) => <article key={sale.localId}><header><strong>{sale.localCode}</strong><Badge tone={sale.status === "sync_error" ? "error" : "warning"}>{sale.status === "sync_error" ? "Error" : "Pendiente"}</Badge></header><div><span>{sale.locationName}</span><strong>{formatMoney(sale.total)}</strong></div><small>{formatDateTime(sale.createdLocallyAt)}</small>{sale.syncError ? <p>{sale.syncError}</p> : null}<button type="button" onClick={() => setDeletePendingTarget(sale)}><Icon name="Trash2" />Descartar</button></article>) : <EmptyState icon="RefreshCw" title="No hay ventas pendientes" description="Si se corta internet, las ventas guardadas aparecerán aquí." />}</div>
    </div>
  );

  const stockView = (
    <div className="fm-seller-view"><div className="fm-seller-view-head"><div><h1>Stock restante</h1><p>{selectedLocation?.name || "Ubicación"}</p></div></div><div className="fm-seller-stock-grid">{products.map((product) => { const status = sellerStockStatus({ ...product, currentStock: product.availableStock }); return <article key={product.id}><img src={sellerImage(product)} alt="" loading="lazy" decoding="async" /><div><strong>{product.productName}</strong><span>{product.abbreviation}</span><Badge tone={status.tone}>{status.label}</Badge></div><b>{product.availableStock}</b></article>; })}</div></div>
  );

  const pricesView = (
    <div className="fm-seller-view"><div className="fm-seller-view-head"><div><h1>Lista de precios</h1><p>Consulta rápida por categorías</p></div></div>{productGroups.map((group) => <section key={group.id} className="fm-seller-price-category"><h2>{group.name}</h2>{group.items.map((product) => <article key={product.id}><div><strong>{product.productName}</strong><span>{product.abbreviation}</span></div><div><strong>{formatMoney(product.price)}</strong><small>Stock {product.availableStock}</small></div></article>)}</section>)}</div>
  );

  const helpView = (
    <div className="fm-seller-view"><div className="fm-seller-view-head"><div><h1>Ayuda</h1><p>Atajos rápidos de operación</p></div></div><ul className="fm-seller-help"><li><Icon name="Keyboard" /><div><strong>Botonera</strong><span>Los códigos configurados agregan productos y aplican pagos.</span></div></li><li><Icon name="Plus" /><div><strong>+</strong><span>Agrega otra unidad del último producto.</span></div></li><li><Icon name="Minus" /><div><strong>−</strong><span>Quita una unidad del último producto.</span></div></li><li><Icon name="WifiOff" /><div><strong>Sin internet</strong><span>Guardá la venta pendiente y sincronizala al volver la conexión.</span></div></li></ul></div>
  );

  const currentView = view === "sales" ? salesView : view === "pending" ? pendingView : view === "stock" ? stockView : view === "prices" ? pricesView : view === "help" ? helpView : saleView;

  return (
    <div className="fm-seller-shell">
      <SellerHeader profile={profile} location={selectedLocation} online={online} syncing={syncing} pendingCount={pendingData.length} view={view} setView={setView} canReturnAdmin={canReturnAdmin} onReturnAdmin={returnAdmin} onLogout={logout} />
      <main className="fm-seller-main" id="main-content">{currentView}</main>
      {view !== "sale" && submitState.message ? <div className="fm-seller-global-feedback" role={submitState.tone === "error" ? "alert" : "status"}><Toast tone={submitState.tone}>{submitState.message}</Toast></div> : null}

      <DiscountDialog open={discountOpen} availableDiscounts={availableDiscounts} selectedDiscountIds={discountIds} initialManualDiscounts={manualDiscounts} suggestedDiscountId={suggestedDiscountId} manualAllowed={manualDiscountAllowed} onClose={() => setDiscountOpen(false)} onApply={({ savedIds, manual }) => { setDiscountIds(savedIds); setManualDiscounts(manual); setDiscountOpen(false); setSuggestedDiscountId(""); setSubmitState({ busy: false, message: "", tone: "info" }); }} />
      <CustomerDialog open={customerOpen} zones={customerZones} initialCustomer={selectedCustomer} online={online} onClose={() => setCustomerOpen(false)} onSelect={(customer) => { setSelectedCustomer(customer); setCustomerOpen(false); }} />
      <MultiplePaymentDialog open={multipleOpen} total={summary.total} initialPayments={payments} onClose={() => setMultipleOpen(false)} onConfirm={(entries) => { setPayments(entries.filter((entry) => entry.amount > 0)); setPaymentMethod("multiple"); setMultipleOpen(false); setSubmitState({ busy: false, tone: "info", message: "" }); }} />
      <ConfirmationDialog open={Boolean(locationToApply)} title="Cambiar ubicación" description="El carrito actual se vaciará al cambiar de ubicación." busy={submitState.busy} onClose={() => setLocationToApply("")} onConfirm={() => { const next = locationToApply; setLocationToApply(""); applyLocation(next); }} />
      <ConfirmationDialog open={clearRequested} title="Vaciar venta" description="Se quitarán todos los productos, descuentos, cliente y forma de pago de la venta actual." busy={submitState.busy} onClose={() => setClearRequested(false)} onConfirm={() => { setClearRequested(false); resetSale(); }} />
      <ConfirmationDialog open={Boolean(deletePendingTarget)} title="Descartar venta pendiente" description="Esta venta todavía no llegó a Firestore. Si la descartás se elimina sólo de este dispositivo." busy={submitState.busy} onClose={() => setDeletePendingTarget(null)} onConfirm={confirmDeletePending} />
      <ConfirmationDialog open={Boolean(editRequested)} title="Editar venta confirmada" description="El stock se recalculará en una transacción segura y quedará registro en auditoría." busy={submitState.busy} onClose={() => setEditRequested(null)} onConfirm={() => { const sale = editRequested; setEditRequested(null); startEdit(sale); }} />
      <Modal
  open={Boolean(cancelTarget)}
  onClose={closeCancelDialog}
  title="Anular venta"
  description="Las unidades volverán al stock y la venta conservará su historial."
  footer={<div><div className="fm-dialog-actions"><Button variant="secondary" onClick={closeCancelDialog}>Cancelar</Button><Button variant="destructive" icon="Trash2" loading={submitState.busy} onClick={confirmCancelSale}>Anular venta</Button></div>{submitState.tone === "error" ? <p className="fm-form-error" role="alert">{submitState.message}</p> : null}</div>}
>
  <label className="fm-field">
    <span>Motivo de anulación (opcional)</span>
    <textarea rows={3} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Ej.: cliente cambió el producto" />
    <small className="fm-field__hint">Si es posible, indicá brevemente por qué se anula la venta.</small>
  </label>
</Modal>
      <Modal open={Boolean(detailSale)} onClose={() => setDetailSale(null)} title={detailSale?.saleCode || "Detalle de venta"} description={detailSale ? `${formatDateTime(detailSale.createdAt)} · ${detailSale.locationName}` : ""} footer={null}>
        {detailSale ? (
          <div className="fm-seller-detail">
            <div className="fm-seller-detail__summary">
              <Badge tone={statusTone(detailSale.status)}>{detailSale.status === "cancelled" ? "Anulada" : "Activa"}</Badge>
              <strong>{formatMoney(detailSale.total)}</strong>
            </div>
            <div>{asArray(detailSale.items).map((item) => <p key={item.productId}><span>{item.qty} × {item.name}</span><strong>{formatMoney(item.subtotal)}</strong></p>)}</div>
            {detailSale.customerPhoneSnapshot ? (
              <div className="fm-seller-detail__customer">
                <small>Cliente</small>
                <strong>{detailSale.customerPhoneSnapshot}</strong>
                {detailSale.customerZoneSnapshot ? <span>{detailSale.customerZoneSnapshot}</span> : null}
                {detailSale.customerNameSnapshot ? <span>{detailSale.customerNameSnapshot}</span> : null}
              </div>
            ) : null}
            {fiscalDetail.invoice ? (
              <div className="fm-seller-detail__fiscal">
                <p><strong>{fiscalPresentation(fiscalDetail.invoice).label}</strong><br />{fiscalPresentation(fiscalDetail.invoice).message}</p>
                {detailSale.status !== "cancelled" ? (
                  <ArcaInvoicePrintAction
                    saleId={detailSale.id}
                    sourceType={arcaSourceTypeForSale(detailSale)}
                    invoiceId={fiscalDetail.invoice.id}
                    invoice={fiscalDetail.invoice}
                  />
                ) : null}
                {fiscalDetail.invoice.pdf?.ready !== true ? <small>Para revisar o recuperar la factura, contactá administración.</small> : null}
              </div>
            ) : null}
            {fiscalDetail.error ? <p role="alert">{fiscalDetail.error}</p> : null}
            <div className="fm-seller-detail__actions">
              {detailSale.status !== "cancelled" && fiscalDetail.ready && !fiscalDetail.invoice && !detailSale.fiscalInvoiceId && !detailSale.fiscalInvoice ? <>
                <Button variant="secondary" icon="Pencil" onClick={() => setEditRequested(detailSale)}>Editar</Button>
                <Button variant="danger" icon="Ban" onClick={() => { setSubmitState({ busy: false, tone: "info", message: "" }); setCancelTarget(detailSale); }}>Anular</Button>
              </> : null}
            </div>
          </div>
        ) : null}
      </Modal>
      <Modal open={Boolean(receipt)} onClose={() => setReceipt(null)} title="Venta registrada" description={receipt?.saleCode || ""} footer={null}>
        {receipt ? (
          <div className="fm-seller-receipt">
            <Icon name="CircleCheck" />
            <strong>{formatMoney(receipt.total)}</strong>
            <span>{receipt.saleCode}</span>
            {receipt.stockDiscrepancies?.length ? <p>El stock quedó negativo. Revisá el inventario de esta ubicación.</p> : null}
            {receipt.customerPhoneSnapshot ? <small>Cliente: {receipt.customerPhoneSnapshot}</small> : null}
            {receipt.ticketRequested ? (
              <>
                <small>{receipt.fiscalPreparationStatus === "error"
                  ? "La venta quedó registrada. La solicitud fiscal requiere revisión de administración."
                  : "La solicitud fiscal quedó registrada; la impresión estará disponible cuando la factura esté autorizada y verificada."}</small>
                {receipt.fiscalInvoiceId ? (
                  <ArcaInvoicePrintAction
                    saleId={receipt.id}
                    sourceType="seller_sale"
                    invoiceId={receipt.fiscalInvoiceId}
                  />
                ) : null}
              </>
            ) : null}
            <Button onClick={() => setReceipt(null)}>Nueva venta</Button>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
