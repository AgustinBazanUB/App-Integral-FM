import "../styles/quick-sales.css";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  EmptyState,
  FormField,
  PageHeader,
  Modal,
  Select,
  Skeleton,
  Toast,
} from "../../design-system";
import {
  PAYMENT_LABELS,
  PAYMENT_OPTIONS,
  SINGLE_PAYMENT_METHODS,
  paymentAllocationSummary,
  normalizePayment,
  completeRemainingPayment,
} from "../../modules/locations/domain/payments";
import { calculateOperationalDiscountSummary } from "../../modules/locations/domain/discounts";
import { SALES_CHANNELS } from "../../modules/locations/domain/channels";
import { globalStockByProduct, saleStockDiscrepancies } from "../../modules/locations/domain/saleStock";
import SaleStockWarning from "../components/SaleStockWarning";
import ArcaBillingDialog from "../components/ArcaBillingDialog";
import ProductImage from "../components/ProductImage";
import ProductSubcategoryRows from "../components/ProductSubcategoryRows";
import { can, effectiveSellerLocations } from "../permissions";
import { joinMasterProducts } from "../../modules/locations/domain/dashboard";
import { findCustomerByPhone, listActiveCustomerZones } from "../services/customerService";
import { buildCustomerDraft } from "../customers/customerDomain";
import { listLocationsShared, listMasterProductsShared, listDiscountsShared, listProductCategoriesShared } from "../services/sharedResources";
import { readQuickSaleIntent, saveQuickSaleIntent, clearQuickSaleIntent } from "../seller/quickSaleIntent";
import { isDiscountAvailable } from "../../modules/locations/domain/dashboard";
import { useAuth } from "../AuthContext";
import { formatMoney } from "../formatters";
import { useAsyncData } from "../hooks";
import {
  createQuickSale,
} from "../services/managementService";
import { listWarehouses } from "../services/inventoryService";
import { subscribeQuickSaleStock } from "../services/quickSaleStockService";
import { requestPendingArcaInvoice, validateArcaInvoiceDraft } from "../services/arcaService";
import SaleInvoicePanel from "../components/SaleInvoicePanel";
import ArcaInvoicePrintAction from "../components/ArcaInvoicePrintAction";

import CustomerDialog from "../seller/CustomerDialog";
import ShippingDialog from "../shipping/ShippingFields";
import { Link } from "../../router";
import DiscountDialog from "../seller/DiscountDialog";
import "../../styles/seller-customers.css";
import "../../styles/seller-stage2.css";

const friendlyPayments = {
  credit: "Crédito",
  debit: "Débito",
  alias: "Transferencia / alias",
  cash: "Efectivo",
  multiple: "Combinar pagos",
};

export default function QuickSalesPage() {
  const { profile } = useAuth();
  const [pendingIntent, setPendingIntent] = useState(() => readQuickSaleIntent(profile.id));
  const restored = pendingIntent?.sale;
  const locationsResult = useAsyncData(() => listLocationsShared(profile), [profile.id]);
  const warehousesResult = useAsyncData(() => listWarehouses(profile, { includeInactive: true }), [profile.id]);
  const productsResult = useAsyncData(() => listMasterProductsShared(profile), [profile.id]);
  const categoriesResult = useAsyncData(() => listProductCategoriesShared(profile), [profile.id]);
  const discountsResult = useAsyncData(() => listDiscountsShared(profile), [profile.id]);
  const [stockType, setStockType] = useState(restored?.stockOrigin?.type || "location");
  const [locationId, setLocationId] = useState(restored?.stockOrigin?.id || "");
  const [balances, setBalances] = useState(null);
  const [stockError, setStockError] = useState(null);
  const [stockReview, setStockReview] = useState(null);
  const [quantities, setQuantities] = useState(() => Object.fromEntries((restored?.items || []).map(item => [item.id, item.qty])));
  const [prices, setPrices] = useState(() => Object.fromEntries((restored?.items || []).map(item => [item.id, item.unitPrice])));
  const [giftIds, setGiftIds] = useState(() => (restored?.items || []).filter(item => item.gift).map(item => item.id));
  const [paymentMethod, setPaymentMethod] = useState(restored?.paymentMethod || "");
  const [payments, setPayments] = useState(restored?.payments || SINGLE_PAYMENT_METHODS.map(method => ({ method, amount: "" })));
  const [customer, setCustomer] = useState(restored?.customer || { phone: "", name: "", zoneName: "" });
  const [, setCustomerState] = useState({ status: "idle" });
  const [dialog, setDialog] = useState("");
  const [priceItem, setPriceItem] = useState(null);
  const [priceDraft, setPriceDraft] = useState("");
  const zonesResult = useAsyncData(() => listActiveCustomerZones(), [profile.id]);
  const [search, setSearch] = useState("");
  const [openCategoryId, setOpenCategoryId] = useState(null);
  const [originDraft, setOriginDraft] = useState(null);
  const [originError, setOriginError] = useState("");
  const [manualDiscounts, setManualDiscounts] = useState((restored?.discounts || []).filter(d => d.source === "manual" || d.discountId === "manual"));
  const [channel, setChannel] = useState(restored?.channel || "");
  const [customerDni, setCustomerDni] = useState(restored?.customerDni || "");
  const [invoiceRequested, setInvoiceRequested] = useState(restored?.invoiceRequested || false);
  const [receiverVatConditionId, setReceiverVatConditionId] = useState(restored?.receiverVatConditionId || "5");
  const [receiverDocument, setReceiverDocument] = useState(restored?.receiverDocument || "");
  const [deliveryMethod, setDeliveryMethod] = useState(restored?.deliveryMethod || "pickup");
  const [shipping, setShipping] = useState(restored?.shipping || {});
  const [discountIds, setDiscountIds] = useState((restored?.discounts || []).filter(d => d.source !== "manual" && d.discountId !== "manual").map(d => d.discountId || d.id).filter(Boolean));
  const submitRef = useRef(false);
  const [submitState, setSubmitState] = useState({ busy: false, error: "", success: "" });
  const [registeredInvoice, setRegisteredInvoice] = useState(null);
  const [lastShipmentId, setLastShipmentId] = useState(null);

  const locations = effectiveSellerLocations(profile, locationsResult.data || []);
  const warehouses = (warehousesResult.data || []).filter(warehouse => warehouse.active !== false);
  const origins = stockType === "warehouse" ? warehouses : locations;
  const stockOrigin = { type: stockType, id: locationId };
  const locked = submitState.busy || Boolean(pendingIntent);
  useEffect(() => {
    if (!locationId && origins.length && !pendingIntent) setLocationId(origins[0].id);
  }, [locationId, origins, pendingIntent]);
  useEffect(() => {
    setBalances(null);
    setStockError(null);
    if (!locationsResult.data || !warehousesResult.data) return;
    return subscribeQuickSaleStock(locationsResult.data, warehousesResult.data, setBalances, setStockError);
  }, [locationsResult.data, warehousesResult.data]);

  const inventory = useMemo(() => {
    if (!balances) return { totals: null, error: null };
    try { return { totals: globalStockByProduct(balances.values()), error: null }; }
    catch (error) { return { totals: null, error }; }
  }, [balances]);
  const inventoryError = stockError || inventory.error || locationsResult.error || warehousesResult.error;
  const originStock = balances?.get(`${stockType === "warehouse" ? "warehouseStock" : "locationStock"}/${locationId}`);
  const stockReady = Boolean(originStock && inventory.totals && !inventoryError);
  const catalog = useMemo(() => joinMasterProducts(productsResult.data || [], originStock).filter(item => item.masterActive), [productsResult.data, originStock]);
  const visibleProducts = catalog.filter(item => item.productName.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es")));
  const cart = useMemo(
    () => pendingIntent ? pendingIntent.sale.items.map(item => ({ ...item, productName: item.name, price: item.unitPrice })) :
      catalog
        .filter((item) => Number(quantities[item.id] || 0) > 0)
        .map((item) => ({ ...item, price: prices[item.id] ?? item.price, qty: Number(quantities[item.id]), gift: giftIds.includes(item.id) })),
    [quantities, prices, catalog, pendingIntent, giftIds],
  );
  const selectedLocation = origins.find((item) => item.id === locationId);
  const manualAllowed = can(profile, "quick-sales", "useDiscounts") && can(profile, "quick-sales", "useManualDiscounts");
  const availableDiscounts = (discountsResult.data || []).filter((discount) => (manualAllowed || discount.type !== "percent" || Number(discount.value) !== 100) && isDiscountAvailable(discount, stockType === "warehouse" ? {} : selectedLocation || {}, new Date(), { profile, items: cart }));
  const appliedDiscounts = pendingIntent ? pendingIntent.sale.discounts : [...availableDiscounts.filter((discount) => discountIds.includes(discount.id)), ...manualDiscounts];
  const saleSummary = useMemo(() => calculateOperationalDiscountSummary(cart, appliedDiscounts, { paymentMethod, roundCashTotal: true }), [appliedDiscounts, cart, paymentMethod]);
  const fiscalReviewRequired = cart.length > 0 && (saleSummary.total === 0 || cart.some(item => item.gift));

  const allocation = paymentAllocationSummary(payments, saleSummary.total);
  const stockDiscrepancies = stockReady && !pendingIntent ? saleStockDiscrepancies(cart) : [];

  const changeQty = (item, amount) => {
    if (amount < 0 && Number(quantities[item.id]) === 1) setGiftIds(ids => ids.filter(id => id !== item.id));
    setQuantities((current) => {
      const requested = Math.max(0, Number(current[item.id] || 0) + amount);
      return { ...current, [item.id]: requested };
    });
  };

  const groups = Object.values(visibleProducts.reduce((result, item) => {
    const key = item.categoryId || item.categoryName || "uncategorized";
    result[key] ||= { id: key, name: item.categoryName || "Productos", items: [] };
    result[key].items.push(item);
    return result;
  }, {}));
  const canConfirm = Boolean(pendingIntent) || Boolean(stockReady && cart.length && selectedLocation && channel &&
    (saleSummary.total === 0 || paymentMethod && (paymentMethod !== "multiple" || (!allocation.invalid && allocation.difference === 0 && allocation.positiveCount >= 2))));
  const switchOrigin = (id, type = stockType) => {
    setStockType(type); setLocationId(id); setQuantities({}); setPrices({}); setDiscountIds([]); setGiftIds([]);
    setOpenCategoryId(null);
  };
  const openOriginDialog = () => { setOriginDraft({ channel, stockType, locationId }); setOriginError(""); setDialog("origin"); };
  const draftOrigins = originDraft?.stockType === "warehouse" ? warehouses : locations;
  const confirmOrigin = () => {
    if (!SALES_CHANNELS.some(option => option.value === originDraft?.channel) || !["location", "warehouse"].includes(originDraft?.stockType) || !draftOrigins.some(origin => origin.id === originDraft.locationId)) { setOriginError("Elegí el canal, el tipo de origen y la ubicación antes de confirmar."); return; }
    setChannel(originDraft.channel);
    if (originDraft.stockType !== stockType || originDraft.locationId !== locationId) switchOrigin(originDraft.locationId, originDraft.stockType);
    setDialog(""); setOriginError("");
  };
  const paymentStatus = allocation.invalid ? "Revisá los montos" : allocation.difference === 0 ? "Pagos completos" : allocation.difference > 0 ? `Falta ${formatMoney(allocation.difference)}` : `Excede ${formatMoney(-allocation.difference)}`;


  const handleSubmit = async (event, requestInvoice = invoiceRequested, receiverOverride = null, confirmation = null) => {
    event?.preventDefault();
    if (submitRef.current) return;
    if (!pendingIntent && stockDiscrepancies.length && !confirmation) {
      setStockReview({ discrepancies: stockDiscrepancies, requestInvoice, receiver: receiverOverride });
      setDialog("stock-review");
      return;
    }
    submitRef.current = true;
    let sent = false;
    setRegisteredInvoice(null);
    setLastShipmentId(null);
    setSubmitState({ busy: true, error: "", success: "" });
    try {
      const fiscalRequested = pendingIntent?.sale.invoiceRequested ?? requestInvoice;
      const receiverCondition = Number((pendingIntent?.sale.fiscalReceiver?.vatConditionId ?? pendingIntent?.sale.receiverVatConditionId ?? receiverOverride?.vatConditionId ?? receiverVatConditionId) || 0);
      const receiverDigits = String(pendingIntent ? (pendingIntent.sale.fiscalReceiver?.documentNumber || pendingIntent.sale.receiverDocument || pendingIntent.sale.customerDni || "") : (receiverOverride?.documentNumber || receiverDocument || customerDni || "")).replace(/\D/g, "");
      if (fiscalRequested && [1, 4, 6].includes(receiverCondition) && receiverDigits.length !== 11) {
        throw new Error("Para Responsable Inscripto, Monotributo o Exento ingresá la CUIT de 11 dígitos.");
      }
      let receiver = fiscalRequested ? (pendingIntent?.sale.fiscalReceiver || receiverOverride || {
        vatConditionId: receiverCondition,
        documentType: receiverCondition === 5 ? (receiverDigits ? 96 : 99) : 80,
        documentNumber: receiverCondition === 5 ? (receiverDigits || "0") : receiverDigits,
        anonymousConsumerFinal: receiverCondition === 5 && !receiverDigits,
        concept: 1,
      }) : null;
      let intent = pendingIntent;
      if (!intent) {
        if (deliveryMethod === "shipping" && (!customer.name?.trim() || !customer.phone?.trim())) throw new Error("Para el envío, completá nombre y teléfono en Cliente.");
        if (!SALES_CHANNELS.some(option => option.value === channel)) throw new Error("Elegí el canal comercial real.");
        if (!selectedLocation || !cart.length) throw new Error("Elegí un origen y agregá productos.");
        normalizePayment(paymentMethod, PAYMENT_LABELS[paymentMethod], payments, saleSummary.total);
        if(fiscalRequested) {
          const draft=await validateArcaInvoiceDraft({sourceType:"admin_quick_sale",items:cart.map(item=>({productId:item.productId || item.id,qty:item.qty,unitPrice:Number(item.price),gift:item.gift === true})),total:saleSummary.total,discountTotal:saleSummary.discountTotal,receiver});
          receiver=draft.receiver;
        }
        const existing = customer.phone.trim() ? await findCustomerByPhone(customer.phone) : null;
        const saleCustomer = customer.phone.trim() ? buildCustomerDraft({ ...customer, name: existing?.name || customer.name, zoneName: existing?.zoneName || existing?.customZone || customer.zoneName }) : null;
        const sale = {
          stockOrigin, items: cart.map(item => ({ id: item.id, productId: item.id, name: item.productName, categoryId: item.categoryId || null, unitPrice: Number(item.price), qty: item.qty, ...(item.gift ? { gift: true } : {}) })),
          ...(confirmation ? { stockConfirmation: confirmation } : {}),
          discounts: appliedDiscounts, paymentMethod, paymentMethodLabel: PAYMENT_LABELS[paymentMethod], payments,
          channel, customer: saleCustomer, customerDni, invoiceRequested: fiscalRequested, deliveryMethod, shipping: deliveryMethod === "shipping" ? shipping : null, receiverVatConditionId: receiverCondition, receiverDocument: receiverDigits, fiscalReceiver: receiver,
        };
        intent = saveQuickSaleIntent(profile.id, sale);
        setPendingIntent(intent);
      }
      sent = true;
      const result = await createQuickSale({ ...intent.sale, seller: profile, requestId: intent.requestId });
      setLastShipmentId(result.shipmentId || null);
      let invoiceNotice = "";
      let invoiceId = null;
      if (fiscalRequested) {
        try {
          const invoice = await requestPendingArcaInvoice({
            sourceType: "admin_quick_sale",
            sourceId: result.id,
            receiver,
          });
          invoiceId = invoice?.id || null;
          if (invoice?.fiscalReadiness?.ready === false) {
            invoiceNotice = " Solicitud fiscal creada; faltan datos fiscales de uno o más productos antes de autorizarla.";
          } else if (invoice?.autoAuthorization?.status === "authorized") {
            const auth = invoice.autoAuthorization.authorization || {};
            const verified = invoice.autoAuthorization.verification?.matched === true;
            invoiceNotice = ` Factura ${auth.voucherClass || ""} autorizada · PV ${auth.pointOfSale || "-"} · N° ${auth.voucherNumber || "-"}${verified ? " · verificada en ARCA" : " · pendiente de verificación"}.`;
          } else if (invoice?.autoAuthorization?.attempted) {
            invoiceNotice = ` Solicitud fiscal en estado ${invoice.autoAuthorization.status || invoice.status || "pendiente"}; revisar antes de continuar.`;
          } else {
            invoiceNotice = " La venta está guardada y la factura sigue pendiente. Completala desde esta venta sin volver a cargarla.";
          }
        } catch (invoiceError) {
          invoiceNotice = ` La venta quedó registrada, pero no se pudo preparar/validar la solicitud fiscal: ${invoiceError.message}`;
        }
      }
      if (fiscalRequested) setRegisteredInvoice({id:result.id,saleCode:result.saleCode,total:result.total,status:"active",sourceType:"admin_quick_sale",fiscalInvoiceId:invoiceId});
      clearQuickSaleIntent(profile.id);
      setPendingIntent(null);
      setQuantities({});
      setPrices({});
      setGiftIds([]);
      setPayments(SINGLE_PAYMENT_METHODS.map(method => ({ method, amount: "" })));
      setCustomer({ phone: "", name: "", zoneName: "" });
      setCustomerState({ status: "idle" });
      setShipping({});
      setDeliveryMethod("pickup");
      setManualDiscounts([]);
      setCustomerDni("");
      setPaymentMethod("");
      setInvoiceRequested(false);
      setReceiverVatConditionId("5");
      setReceiverDocument("");
      setDiscountIds([]);
      setDialog("");
      setStockReview(null);
      setSubmitState({ busy: false, error: "", success: `${result.saleCode} registrada por ${formatMoney(result.total)}.${result.shipmentId ? " Envío generado y stock imputado al origen elegido." : ""}${result.shippingLegacyReviewRequired ? " Se recuperó una venta anterior: gestión debe revisar y vincular su envío sin volver a descontar stock." : ""}${result.stockDiscrepancies?.length ? " Stock negativo pendiente de revisión." : ""}${invoiceNotice}` });
    } catch (error) {
      if (!sent || [400, 403].includes(error.status) || error.status === 409 && error.code === "shipping/blocked" || ["sale/stock-confirmation", "sale/validation", "permission-denied", "seller/insufficient-stock", "invalid-argument", "failed-precondition"].includes(error.code)) {
        clearQuickSaleIntent(profile.id);
        setPendingIntent(null);
      }
      if (error.code === "sale/stock-confirmation") {
        setStockReview({ discrepancies: error.stockDiscrepancies, requestInvoice: pendingIntent?.sale.invoiceRequested ?? requestInvoice, receiver: pendingIntent?.sale.fiscalReceiver ?? receiverOverride });
        setDialog("stock-review");
      }
      setSubmitState({ busy: false, error: error.message, success: "" });
    } finally {
      submitRef.current = false;
    }
  };


  return (
    <div className="fm-page-enter fm-quick-pos">
      <div className="fm-quick-pos__layout">
        <div className="fm-quick-pos__catalog-column">
        <PageHeader eyebrow="Administración" title="Venta rápida" />
        <section data-olivia="sale.catalog" className="fm-quick-pos__catalog" aria-label="Catálogo de productos">
          <FormField label="Buscar producto o catálogo"><input type="search" disabled={locked} value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar en catálogo" /></FormField>
          {[locationsResult, warehousesResult, productsResult].some(result => result.status === "error") ? <EmptyState icon="AlertTriangle" title="No se pudieron leer los recursos" description="Revisá conexión y permisos." /> : null}
          {productsResult.status === "loading" || !inventory.totals && !inventoryError ? <Skeleton lines={4} /> : null}
          {inventoryError ? <EmptyState icon="AlertTriangle" title="No se pudo leer el stock" description={inventoryError.message} /> : null}
          {!locationId ? <EmptyState icon="Box" title="Elegí de dónde sale la mercadería" description="Seleccioná una ubicación o un depósito activo." /> : null}
          {inventory.totals && !visibleProducts.length ? <EmptyState icon="Box" title="No hay productos disponibles" description="Revisá la búsqueda y los productos activos." /> : null}
          <div className="fm-quick-pos__categories">
            {inventory.totals && groups.map(group => <section key={group.id} className={`fm-quick-pos__category ${openCategoryId === group.id ? "is-open" : ""}`}>
              <button type="button" className="fm-quick-pos__category-toggle" aria-expanded={openCategoryId === group.id} aria-controls={`quick-category-${group.id}`} onClick={() => setOpenCategoryId(current => current === group.id ? null : group.id)}>{group.name}<span>{group.items.length}</span></button>
              {openCategoryId === group.id ? <div id={`quick-category-${group.id}`}>
              <ProductSubcategoryRows items={group.items} category={(categoriesResult.data || []).find(category => category.id === group.id) || { name: group.name }} className="fm-quick-pos__carousel" renderProduct={item => {
                const qty = Number(quantities[item.id] || 0);
                return <button key={item.id} type="button" className={`fm-quick-pos__tile ${qty ? "is-selected" : ""}`} aria-label={`Agregar ${item.productName}`} disabled={locked || !stockReady || item.active === false || item.productDeleted === true} onClick={() => changeQty(item, 1)}>
                  <ProductImage className="fm-quick-pos__product-mark" product={item} eager />
                  <strong>{item.productName}{item.presentation ? ` · ${item.presentation}` : ""}</strong><span>{formatMoney(item.price)}</span>
                  <small>Stock global: {inventory.totals.get(item.id) ?? 0}</small>
                  {selectedLocation ? <small>{selectedLocation.name}: {item.currentStock}{item.active === false ? " · deshabilitado" : ""}</small> : null}
                  {qty > 0 ? <b className="fm-quick-pos__count">{qty}</b> : null}
                </button>;
              }} />
              </div> : null}
            </section>)}
          </div>
        </section>
        </div>
        <section data-olivia="sale.cart" className="fm-quick-pos__sale" aria-label="Venta actual">
          <div className="fm-quick-pos__cart-head"><h2>Venta actual</h2><Button variant="ghost" disabled={locked || !cart.length} onClick={() => { setQuantities({}); setPrices({}); setGiftIds([]); }}>Vaciar</Button></div>
          <div className="fm-quick-pos__cart">
            {!cart.length ? <p className="fm-quick-pos__empty">Tocá un producto para agregarlo a la venta.</p> : cart.map(item => <article key={item.id} className="fm-quick-pos__line">
              <div><strong>{item.productName}</strong><button type="button" className="fm-quick-pos__price" disabled={locked || item.gift} aria-label={`Editar precio de ${item.productName}`} onClick={() => { setPriceItem(item); setPriceDraft(String(item.price)); setDialog("price"); }}>{formatMoney(item.price)} / unidad</button>
                {manualAllowed ? <label><input type="checkbox" disabled={locked} checked={item.gift === true} onChange={event => setGiftIds(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} /> Bonificar 100%</label> : null}
              </div>
              <div className="fm-quantity-control"><button type="button" aria-label={`Quitar ${item.productName}`} disabled={locked} onClick={() => changeQty(item, -1)}>−</button><output aria-live="polite">{item.qty}</output><button type="button" aria-label={`Sumar ${item.productName}`} disabled={locked || !stockReady || item.active === false || item.productDeleted === true} onClick={() => changeQty(item, 1)}>+</button></div>
              <strong>{formatMoney(item.gift ? 0 : item.qty * Number(item.price))}</strong>
            </article>)}
          </div>
          <SaleStockWarning discrepancies={stockDiscrepancies} />
          <div className="fm-quick-pos__extras">
            <Button variant="secondary" disabled={locked || discountsResult.status === "loading" || !can(profile, "quick-sales", "useDiscounts")} onClick={() => setDialog("discount")}>Descuento</Button>
            <Button data-olivia="sale.customer" variant="secondary" disabled={locked} title={customer.phone ? customer.name || customer.phone : undefined} onClick={() => setDialog("customer")}>Cliente</Button>
            <Button variant="secondary" disabled={locked} aria-pressed={deliveryMethod === "shipping"} onClick={() => setDialog("shipping")}>{deliveryMethod === "shipping" ? "Con envío · editar" : "Con envío"}</Button>
            <Button data-olivia="sale.origin" variant="secondary" disabled={locked} onClick={openOriginDialog}>Canal</Button>
          </div>
          {appliedDiscounts.length ? <div className="fm-quick-pos__discounts">{appliedDiscounts.map((discount, index) => <button type="button" disabled={locked} key={`${discount.id || discount.discountId}-${index}`} aria-label={`Quitar ${discount.name}`} onClick={() => discount.source === "manual" ? setManualDiscounts(manual => manual.filter(entry => entry !== discount)) : setDiscountIds(ids => ids.filter(id => id !== (discount.discountId || discount.id)))}>{discount.name} ×</button>)}</div> : null}
          {cart.length && saleSummary.total === 0 ? <p>Sin cobro</p> : <div data-olivia="sale.payment" className="fm-quick-pos__payments" role="group" aria-label="Forma de pago">{PAYMENT_OPTIONS.map(option => <button type="button" key={option.value} disabled={locked || (option.value === "multiple" && !can(profile, "quick-sales", "useMultiplePayments"))} aria-pressed={paymentMethod === option.value} className={paymentMethod === option.value ? "is-selected" : ""} onClick={() => { setPaymentMethod(option.value); if (option.value === "multiple") setDialog("payments"); }}>{friendlyPayments[option.value] || option.label}{option.value === "multiple" && paymentMethod === "multiple" ? <small>{paymentStatus}</small> : null}</button>)}</div>}
        </section>
      </div>
      {pendingIntent ? <Toast tone="warning">Confirmación pendiente. Recuperá el resultado de esta misma venta.</Toast> : null}
      {lastShipmentId && <Link className="fm-button fm-button--secondary" to={`/gestion/shipping?shipment=${encodeURIComponent(lastShipmentId)}`}>Ver ficha del envío generado</Link>}
      <ShippingDialog open={dialog === "shipping"} value={shipping} administrative onClose={() => setDialog("")} onConfirm={draft => { setShipping(draft); setDeliveryMethod("shipping"); setDialog(""); }} onRemove={() => { setShipping({}); setDeliveryMethod("pickup"); setDialog(""); }} />
      {submitState.error ? <div data-olivia-error="sale.form"><Toast tone="error">{submitState.error}</Toast></div> : null}
      {submitState.success ? <Toast tone="success">{submitState.success}</Toast> : null}
      {registeredInvoice ? <SaleInvoicePanel sale={registeredInvoice} allowGenerate={can(profile,"quick-sales","requestTicket")}/> : null}
      {fiscalReviewRequired ? <p>Las entregas bonificadas requieren revisión fiscal antes de emitir la factura.</p> : null}
      <footer className="fm-quick-pos__actions"><div><span>Total</span><strong>{formatMoney(saleSummary.total)}</strong></div><Button variant="secondary" icon="FileText" disabled={locked || !canConfirm || fiscalReviewRequired} onClick={() => setDialog("billing")}>Generar factura</Button><Button data-olivia="sale.submit" icon="Check" loading={submitState.busy} aria-disabled={!canConfirm || undefined} onClick={event => {
        if (!canConfirm) {
          const message = !cart.length ? "Agregá al menos un producto." : !stockReady ? "Esperá a que se lea el stock o elegí un origen activo." : !channel ? "Seleccioná el canal de venta." : !paymentMethod ? "Seleccioná el medio de pago." : "Completá los pagos para cubrir el total.";
          setSubmitState({ busy: false, error: message, success: "" }); return;
        }
        handleSubmit(event, false);
      }}>{pendingIntent ? "Recuperar confirmación" : "Continuar"}</Button></footer>

      <Modal open={dialog === "stock-review"} title="Stock insuficiente" description={`Origen: ${selectedLocation?.name || "origen seleccionado"}`} onClose={() => { if (!submitRef.current) setDialog(""); }} footer={<><Button variant="secondary" disabled={submitState.busy} onClick={() => setDialog("")}>Cancelar</Button><Button loading={submitState.busy} onClick={() => handleSubmit(null, stockReview.requestInvoice, stockReview.receiver, stockReview.discrepancies)}>Continuar de todas formas</Button></>}>
        <SaleStockWarning discrepancies={stockReview?.discrepancies} />
      </Modal>
      <Modal open={dialog === "origin"} title="Canal y origen del stock" description="Elegí por dónde llegó la venta y de dónde sale la mercadería." onClose={() => setDialog("")} footer={<><Button variant="secondary" onClick={() => setDialog("")}>Cancelar</Button><Button onClick={confirmOrigin}>Confirmar canal y origen</Button></>}>
        <FormField label="Canal comercial" required><Select value={originDraft?.channel || ""} onChange={event => setOriginDraft(current => ({ ...current, channel: event.target.value }))}><option value="">Elegir canal real</option>{SALES_CHANNELS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></FormField>
        <FormField label="Tipo de origen"><Select value={originDraft?.stockType || "location"} onChange={event => setOriginDraft(current => ({ ...current, stockType: event.target.value, locationId: "" }))}><option value="location">Ubicación</option><option value="warehouse">Depósito</option></Select></FormField>
        <FormField label="Origen físico del stock" required><Select value={originDraft?.locationId || ""} onChange={event => setOriginDraft(current => ({ ...current, locationId: event.target.value }))}><option value="">Elegir origen</option>{draftOrigins.map(origin => <option key={origin.id} value={origin.id}>{origin.name}</option>)}</Select></FormField>
        {originError ? <p className="fm-form-error" role="alert">{originError}</p> : null}
        {cart.length ? <p>Cambiar el origen vacía los productos seleccionados.</p> : null}
      </Modal>
      <DiscountDialog open={dialog === "discount"} availableDiscounts={availableDiscounts} selectedDiscountIds={discountIds} initialManualDiscounts={manualDiscounts} manualAllowed={manualAllowed} onClose={() => setDialog("")} onApply={({ savedIds, manual }) => { setDiscountIds(savedIds); setManualDiscounts(manual); setDialog(""); }} />
      <CustomerDialog open={dialog === "customer"} zones={zonesResult.data || []} initialCustomer={customer.phone ? customer : null} onClose={() => setDialog("")} onSelect={setCustomer} onClear={() => { setCustomer({ phone: "", name: "", zoneName: "" }); setDialog(""); }} />
      <Modal open={dialog === "payments"} title="Combinar pagos" description={`Total de la venta: ${formatMoney(saleSummary.total)}`} onClose={() => setDialog("")} footer={<Button disabled={allocation.invalid || allocation.difference !== 0 || allocation.positiveCount < 2} onClick={() => setDialog("")}>Listo</Button>}>
        {payments.map(part => <FormField key={part.method} label={friendlyPayments[part.method]}><div className="fm-quick-pos__payment-input"><input aria-label={friendlyPayments[part.method]} type="number" min="0" step="1" inputMode="numeric" value={part.amount} onChange={event => setPayments(current => current.map(entry => entry.method === part.method ? { ...entry, amount: event.target.value } : entry))} /><Button variant="ghost" disabled={allocation.invalid || allocation.difference <= 0} onClick={() => setPayments(current => completeRemainingPayment(current, part.method, saleSummary.total))}>Completar</Button></div></FormField>)}<p role="status">{paymentStatus}</p>
      </Modal>
      <Modal open={dialog === "price"} title="Editar precio" description={priceItem?.productName || "Precio unitario"} onClose={() => setDialog("")} footer={<Button disabled={!priceDraft.trim() || !Number.isInteger(Number(priceDraft)) || Number(priceDraft) < 0} onClick={() => { setPrices(current => ({ ...current, [priceItem.id]: Number(priceDraft) })); setDialog(""); }}>Aplicar precio</Button>}><FormField label="Precio unitario"><input type="number" min="0" step="1" inputMode="numeric" value={priceDraft} onChange={event => setPriceDraft(event.target.value)} /></FormField></Modal>
      <ArcaBillingDialog open={dialog === "billing"} total={saleSummary.total} busy={submitState.busy} error={submitState.error} onClose={() => setDialog("")} onContinue={() => { setDialog(""); handleSubmit(null, false); }} onConfirm={receiver => handleSubmit(null, true, receiver)} />
    </div>
  );
}
