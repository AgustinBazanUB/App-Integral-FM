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
import { calculateDiscountSummary } from "../../modules/locations/domain/discounts";
import { SALES_CHANNELS } from "../../modules/locations/domain/channels";
import { saleStockDiscrepancies } from "../../modules/locations/domain/saleStock";
import SaleStockWarning from "../components/SaleStockWarning";
import { can, effectiveSellerLocations } from "../permissions";
import { joinMasterProducts } from "../../modules/locations/domain/dashboard";
import { findCustomerByPhone, listActiveCustomerZones } from "../services/customerService";
import { buildCustomerDraft } from "../customers/customerDomain";
import { listLocationsShared, listMasterProductsShared, listDiscountsShared } from "../services/sharedResources";
import { readQuickSaleIntent, saveQuickSaleIntent, clearQuickSaleIntent } from "../seller/quickSaleIntent";
import { isDiscountAvailable } from "../../modules/locations/domain/dashboard";
import { useAuth } from "../AuthContext";
import { formatMoney } from "../formatters";
import { useAsyncData } from "../hooks";
import {
  createQuickSale,
} from "../services/managementService";
import { listQuickSaleStock, listWarehouses } from "../services/inventoryService";
import { dryRunArcaInvoice, requestPendingArcaInvoice } from "../services/arcaService";
import ArcaInvoicePrintAction from "../components/ArcaInvoicePrintAction";

import CustomerDialog from "../seller/CustomerDialog";
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
  const warehousesResult = useAsyncData(() => listWarehouses(profile), [profile.id]);
  const productsResult = useAsyncData(() => listMasterProductsShared(profile), [profile.id]);
  const discountsResult = useAsyncData(() => listDiscountsShared(profile), [profile.id]);
  const [stockType, setStockType] = useState(restored?.stockOrigin?.type || "location");
  const [locationId, setLocationId] = useState(restored?.stockOrigin?.id || "");
  const [stock, setStock] = useState(/** @type {{status: string, data: any[], error?: Error}} */ ({ status: "idle", data: [] }));
  const [quantities, setQuantities] = useState(() => Object.fromEntries((restored?.items || []).map(item => [item.id, item.qty])));
  const [prices, setPrices] = useState(() => Object.fromEntries((restored?.items || []).map(item => [item.id, item.unitPrice])));
  const [paymentMethod, setPaymentMethod] = useState(restored?.paymentMethod || "");
  const [payments, setPayments] = useState(restored?.payments || SINGLE_PAYMENT_METHODS.map(method => ({ method, amount: "" })));
  const [customer, setCustomer] = useState(restored?.customer || { phone: "", name: "", zoneName: "" });
  const [, setCustomerState] = useState({ status: "idle" });
  const [dialog, setDialog] = useState("");
  const [priceItem, setPriceItem] = useState(null);
  const [priceDraft, setPriceDraft] = useState("");
  const zonesResult = useAsyncData(() => listActiveCustomerZones(), [profile.id]);
  const [search, setSearch] = useState("");
  const [manualDiscounts, setManualDiscounts] = useState((restored?.discounts || []).filter(d => d.source === "manual" || d.discountId === "manual"));
  const [channel, setChannel] = useState(restored?.channel || "");
  const [customerDni, setCustomerDni] = useState(restored?.customerDni || "");
  const [invoiceRequested, setInvoiceRequested] = useState(restored?.invoiceRequested || false);
  const [receiverVatConditionId, setReceiverVatConditionId] = useState(restored?.receiverVatConditionId || "5");
  const [receiverDocument, setReceiverDocument] = useState(restored?.receiverDocument || "");
  const [deliveryMethod, setDeliveryMethod] = useState(restored?.deliveryMethod || "pickup");
  const [discountIds, setDiscountIds] = useState((restored?.discounts || []).filter(d => d.source !== "manual" && d.discountId !== "manual").map(d => d.discountId || d.id).filter(Boolean));
  const submitRef = useRef(false);
  const [submitState, setSubmitState] = useState({ busy: false, error: "", success: "" });
  const [registeredInvoice, setRegisteredInvoice] = useState(null);

  const locations = effectiveSellerLocations(profile, locationsResult.data || []);
  const origins = stockType === "warehouse" ? (warehousesResult.data || []) : locations;
  const stockOrigin = { type: stockType, id: locationId };
  const locked = submitState.busy || Boolean(pendingIntent);
  const refreshStock = async () => {
    const data = await listQuickSaleStock(stockOrigin, profile);
    setStock({ status: "ready", data });
  };
  useEffect(() => {
    if (!locationId && origins.length && !pendingIntent) setLocationId(origins[0].id);
  }, [locationId, origins, pendingIntent]);
  useEffect(() => {
    if (!locationId) { setStock({ status: "idle", data: [] }); return; }
    let active = true;
    setStock({ status: "loading", data: [] });
    listQuickSaleStock({ type: stockType, id: locationId }, profile)
      .then((data) => active && setStock({
        status: "ready",
        data,
      }))
      .catch((error) => active && setStock({ status: "error", data: [], error }));
    return () => {
      active = false;
    };
  }, [locationId, stockType, profile.id]);

  const catalog = useMemo(() => joinMasterProducts(productsResult.data || [], stock.data).filter(item => item.masterActive), [productsResult.data, stock.data]);
  const visibleProducts = catalog.filter(item => item.productName.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es")));
  const cart = useMemo(
    () => pendingIntent ? pendingIntent.sale.items.map(item => ({ ...item, productName: item.name, price: item.unitPrice })) :
      catalog
        .filter((item) => Number(quantities[item.id] || 0) > 0)
        .map((item) => ({ ...item, price: prices[item.id] ?? item.price, qty: Number(quantities[item.id]) })),
    [quantities, prices, catalog, pendingIntent],
  );
  const subtotal = cart.reduce(
    (sum, item) => sum + Number(item.price || 0) * item.qty,
    0,
  );
  const selectedLocation = origins.find((item) => item.id === locationId);
  const availableDiscounts = (discountsResult.data || []).filter((discount) => isDiscountAvailable(discount, stockType === "warehouse" ? {} : selectedLocation, new Date(), { profile, items: cart }));
  const appliedDiscounts = pendingIntent ? pendingIntent.sale.discounts : [...availableDiscounts.filter((discount) => discountIds.includes(discount.id)), ...manualDiscounts];
  const saleSummary = useMemo(() => calculateDiscountSummary(appliedDiscounts, subtotal, { paymentMethod, roundCashTotal: true }), [appliedDiscounts, subtotal, paymentMethod]);

  const allocation = paymentAllocationSummary(payments, saleSummary.total);
  const stockDiscrepancies = stockType === "location" && !pendingIntent ? saleStockDiscrepancies(cart) : [];

  const changeQty = (item, amount) => {
    setQuantities((current) => {
      const requested = Math.max(0, Number(current[item.id] || 0) + amount);
      const next = stockType === "warehouse" ? Math.min(Math.max(0, Number(item.currentStock || 0)), requested) : requested;
      return { ...current, [item.id]: next };
    });
  };

  const groups = Object.values(visibleProducts.reduce((result, item) => {
    const key = item.categoryId || item.categoryName || "uncategorized";
    result[key] ||= { id: key, name: item.categoryName || "Productos", items: [] };
    result[key].items.push(item);
    return result;
  }, {}));
  const canConfirm = Boolean(pendingIntent) || Boolean(cart.length && paymentMethod && channel &&
    (paymentMethod !== "multiple" || (!allocation.invalid && allocation.difference === 0 && allocation.positiveCount >= 2)));
  const switchOrigin = (id, type = stockType) => {
    setStockType(type); setLocationId(id); setQuantities({}); setPrices({}); setDiscountIds([]);
    setStock({ status: "idle", data: [] });
  };
  const paymentStatus = allocation.invalid ? "Revisá los montos" : allocation.difference === 0 ? "Pagos completos" : allocation.difference > 0 ? `Falta ${formatMoney(allocation.difference)}` : `Excede ${formatMoney(-allocation.difference)}`;


  const handleSubmit = async (event, requestInvoice = invoiceRequested) => {
    event.preventDefault();
    if (submitRef.current) return;
    submitRef.current = true;
    let sent = false;
    setRegisteredInvoice(null);
    setSubmitState({ busy: true, error: "", success: "" });
    try {
      const fiscalRequested = pendingIntent?.sale.invoiceRequested ?? requestInvoice;
      const receiverCondition = Number((pendingIntent?.sale.receiverVatConditionId ?? receiverVatConditionId) || 0);
      const receiverDigits = String(pendingIntent ? (pendingIntent.sale.receiverDocument || pendingIntent.sale.customerDni || "") : (receiverDocument || customerDni || "")).replace(/\D/g, "");
      if (fiscalRequested && [1, 4, 6].includes(receiverCondition) && receiverDigits.length !== 11) {
        throw new Error("Para Responsable Inscripto, Monotributo o Exento ingresá la CUIT de 11 dígitos.");
      }
      const receiver = fiscalRequested ? {
        vatConditionId: receiverCondition,
        documentType: receiverCondition === 5 ? (receiverDigits ? 96 : 99) : 80,
        documentNumber: receiverCondition === 5 ? (receiverDigits || "0") : receiverDigits,
        anonymousConsumerFinal: receiverCondition === 5 && !receiverDigits,
        concept: 1,
      } : null;
      let intent = pendingIntent;
      if (!intent) {
        if (!SALES_CHANNELS.some(option => option.value === channel)) throw new Error("Elegí el canal comercial real.");
        if (!selectedLocation || !cart.length) throw new Error("Elegí un origen y agregá productos.");
        normalizePayment(paymentMethod, PAYMENT_LABELS[paymentMethod], payments, saleSummary.total);
        const existing = customer.phone.trim() ? await findCustomerByPhone(customer.phone) : null;
        const saleCustomer = customer.phone.trim() ? buildCustomerDraft({ ...customer, name: existing?.name || customer.name, zoneName: existing?.zoneName || existing?.customZone || customer.zoneName }) : null;
        const sale = {
          stockOrigin, items: cart.map(item => ({ id: item.id, productId: item.id, name: item.productName, categoryId: item.categoryId || null, unitPrice: Number(item.price), qty: item.qty })),
          discounts: appliedDiscounts, paymentMethod, paymentMethodLabel: PAYMENT_LABELS[paymentMethod], payments,
          channel, customer: saleCustomer, customerDni, invoiceRequested: fiscalRequested, deliveryMethod, receiverVatConditionId, receiverDocument,
        };
        intent = saveQuickSaleIntent(profile.id, sale);
        setPendingIntent(intent);
      }
      sent = true;
      const result = await createQuickSale({ ...intent.sale, seller: profile, requestId: intent.requestId });
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
            const dryRun = await dryRunArcaInvoice({ invoiceId: invoice.id });
            if (dryRun?.blocked) {
              invoiceNotice = ` Solicitud fiscal creada, pero el dry-run requiere revisión: ${(dryRun.blockers || []).join(", ") || dryRun.reason || "bloqueada"}.`;
            } else {
              const plan = dryRun?.plan;
              invoiceNotice = plan
                ? ` Dry-run fiscal OK: Factura ${plan.voucherClass} · Neto ${formatMoney(plan.fiscal.net)} · IVA ${formatMoney(plan.fiscal.vat)} · Total ${formatMoney(plan.fiscal.total)}.`
                : " Solicitud fiscal creada en estado pendiente.";
            }
          }
        } catch (invoiceError) {
          invoiceNotice = ` La venta quedó registrada, pero no se pudo preparar/validar la solicitud fiscal: ${invoiceError.message}`;
        }
      }
      if (invoiceId) {
        setRegisteredInvoice({ saleId: result.id, sourceType: "admin_quick_sale", invoiceId });
      }
      clearQuickSaleIntent(profile.id);
      setPendingIntent(null);
      setQuantities({});
      setPrices({});
      setPayments(SINGLE_PAYMENT_METHODS.map(method => ({ method, amount: "" })));
      setCustomer({ phone: "", name: "", zoneName: "" });
      setCustomerState({ status: "idle" });
      setManualDiscounts([]);
      setCustomerDni("");
      setPaymentMethod("");
      setInvoiceRequested(false);
      setReceiverVatConditionId("5");
      setReceiverDocument("");
      setDiscountIds([]);
      setDialog("");
      setSubmitState({ busy: false, error: "", success: `${result.saleCode} registrada por ${formatMoney(result.total)}.${result.stockDiscrepancies?.length ? " Stock negativo pendiente de revisión." : ""}${invoiceNotice}` });
      // Refresh failure must never turn a committed sale into a retryable commercial failure.
      await refreshStock().catch(error => setStock({ status: "error", data: [], error }));
    } catch (error) {
      if (!sent || ["sale/validation", "permission-denied", "seller/insufficient-stock", "invalid-argument", "failed-precondition"].includes(error.code)) {
        clearQuickSaleIntent(profile.id);
        setPendingIntent(null);
      }
      setSubmitState({ busy: false, error: error.message, success: "" });
    } finally {
      submitRef.current = false;
    }
  };


  return (
    <div className="fm-page-enter fm-quick-pos">
      <PageHeader eyebrow="Administración" title="Venta rápida" description="Elegí productos, completá el pago y continuá." />
      <div className="fm-quick-pos__context">
        <Button variant="secondary" disabled={locked} onClick={() => setDialog("origin")}>Canal: {SALES_CHANNELS.find(option => option.value === channel)?.label || "Elegir"}</Button>
        <Button variant="secondary" disabled={locked} onClick={() => setDialog("origin")}>Stock: {selectedLocation?.name || "Elegir origen"}</Button>
      </div>
      <div className="fm-quick-pos__layout">
        <section className="fm-quick-pos__catalog" aria-label="Catálogo de productos">
          <FormField label="Buscar producto"><input type="search" disabled={locked} value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar en el catálogo" /></FormField>
          {[locationsResult, warehousesResult, productsResult].some(result => result.status === "error") ? <EmptyState icon="AlertTriangle" title="No se pudieron leer los recursos" description="Revisá conexión y permisos." /> : null}
          {productsResult.status === "loading" || stock.status === "loading" ? <Skeleton lines={4} /> : null}
          {stock.status === "error" ? <EmptyState icon="AlertTriangle" title="No se pudo leer el stock" description={stock.error.message} /> : null}
          {!locationId ? <EmptyState icon="Box" title="Elegí de dónde sale la mercadería" description="Seleccioná una ubicación o un depósito activo." /> : null}
          {stock.status === "ready" && !visibleProducts.length ? <EmptyState icon="Box" title="No hay productos disponibles" description="Revisá la búsqueda y los productos activos." /> : null}
          <div className="fm-quick-pos__categories">
            {stock.status === "ready" && groups.map(group => <details key={group.id} open className="fm-quick-pos__category">
              <summary>{group.name}<span>{group.items.length}</span></summary>
              <div className="fm-quick-pos__carousel">{group.items.map(item => {
                const qty = Number(quantities[item.id] || 0);
                return <button key={item.id} type="button" className={`fm-quick-pos__tile ${qty ? "is-selected" : ""}`} aria-label={`Agregar ${item.productName}`} disabled={locked || !item.hasLocalRecord || item.active === false || (stockType === "warehouse" && qty >= Number(item.currentStock || 0))} onClick={() => changeQty(item, 1)}>
                  <span className="fm-quick-pos__product-mark" aria-hidden="true">{item.productName.slice(0, 2).toUpperCase()}{item.thumbUrl || item.imageUrl ? <img src={item.thumbUrl || item.imageUrl} alt="" loading="lazy" decoding="async" onError={event => { event.currentTarget.style.display = "none"; }} /> : null}</span>
                  <strong>{item.productName}</strong><span>{formatMoney(item.price)}</span><small>{item.currentStock > 0 ? `${item.currentStock} disponibles` : `Stock registrado: ${item.currentStock}`}</small>
                  {qty > 0 ? <b className="fm-quick-pos__count">{qty}</b> : null}
                </button>;
              })}</div>
            </details>)}
          </div>
        </section>
        <section className="fm-quick-pos__sale" aria-label="Venta actual">
          <div className="fm-quick-pos__cart-head"><h2>Venta actual</h2><Button variant="ghost" disabled={locked || !cart.length} onClick={() => { setQuantities({}); setPrices({}); }}>Vaciar</Button></div>
          <div className="fm-quick-pos__cart">
            {!cart.length ? <p className="fm-quick-pos__empty">Tocá un producto para agregarlo a la venta.</p> : cart.map(item => <article key={item.id} className="fm-quick-pos__line">
              <div><strong>{item.productName}</strong><button type="button" className="fm-quick-pos__price" disabled={locked} aria-label={`Editar precio de ${item.productName}`} onClick={() => { setPriceItem(item); setPriceDraft(String(item.price)); setDialog("price"); }}>{formatMoney(item.price)} / unidad · Editar</button></div>
              <div className="fm-quantity-control"><button type="button" aria-label={`Quitar ${item.productName}`} disabled={locked} onClick={() => changeQty(item, -1)}>−</button><output aria-live="polite">{item.qty}</output><button type="button" aria-label={`Sumar ${item.productName}`} disabled={locked || (stockType === "warehouse" && item.qty >= Number(item.currentStock || 0))} onClick={() => changeQty(item, 1)}>+</button></div>
              <strong>{formatMoney(item.qty * Number(item.price))}</strong>
            </article>)}
          </div>
          <SaleStockWarning discrepancies={stockDiscrepancies} />
          <div className="fm-quick-pos__extras">
            <Button variant="secondary" disabled={locked || discountsResult.status === "loading"} onClick={() => setDialog("discount")}>Agregar descuento</Button>
            <Button variant="secondary" disabled={locked} onClick={() => setDialog("customer")}>{customer.phone ? customer.name || customer.phone : "Agregar cliente"}</Button>
            <Button variant="secondary" disabled={locked} aria-pressed={deliveryMethod === "shipping"} onClick={() => setDeliveryMethod(deliveryMethod === "shipping" ? "pickup" : "shipping")}>{deliveryMethod === "shipping" ? "Con envío" : "Retiro"}</Button>
            {customer.phone ? <Button variant="ghost" disabled={locked} onClick={() => setCustomer({ phone: "", name: "", zoneName: "" })}>Quitar cliente</Button> : null}
          </div>
          {appliedDiscounts.length ? <div className="fm-quick-pos__discounts">{appliedDiscounts.map((discount, index) => <button type="button" disabled={locked} key={`${discount.id || discount.discountId}-${index}`} aria-label={`Quitar ${discount.name}`} onClick={() => discount.source === "manual" ? setManualDiscounts(manual => manual.filter(entry => entry !== discount)) : setDiscountIds(ids => ids.filter(id => id !== (discount.discountId || discount.id)))}>{discount.name} ×</button>)}</div> : null}
          <div className="fm-quick-pos__totals"><span>{cart.reduce((count, item) => count + item.qty, 0)} productos · Subtotal</span><strong>{formatMoney(subtotal)}</strong>{saleSummary.discountTotal > 0 ? <><span>Descuentos</span><strong>− {formatMoney(saleSummary.discountTotal)}</strong></> : null}{saleSummary.cashRoundingDiscountTotal > 0 ? <><span>Incluye redondeo por efectivo</span><strong>− {formatMoney(saleSummary.cashRoundingDiscountTotal)}</strong></> : null}<span>Total</span><strong className="fm-quick-pos__total">{formatMoney(saleSummary.total)}</strong></div>
          <div className="fm-quick-pos__payments" role="group" aria-label="Forma de pago">{PAYMENT_OPTIONS.map(option => <button type="button" key={option.value} disabled={locked || (option.value === "multiple" && !can(profile, "quick-sales", "useMultiplePayments"))} aria-pressed={paymentMethod === option.value} className={paymentMethod === option.value ? "is-selected" : ""} onClick={() => { setPaymentMethod(option.value); if (option.value === "multiple") setDialog("payments"); }}>{friendlyPayments[option.value] || option.label}{option.value === "multiple" && paymentMethod === "multiple" ? <small>{paymentStatus}</small> : null}</button>)}</div>
        </section>
      </div>
      {pendingIntent ? <Toast tone="warning">Confirmación pendiente. Recuperá el resultado de esta misma venta.</Toast> : null}
      {submitState.error ? <Toast tone="error">{submitState.error}</Toast> : null}
      {submitState.success ? <Toast tone="success">{submitState.success}</Toast> : null}
      {registeredInvoice ? <ArcaInvoicePrintAction {...registeredInvoice} /> : null}
      <footer className="fm-quick-pos__actions"><div><span>Total</span><strong>{formatMoney(saleSummary.total)}</strong></div><Button variant="secondary" icon="FileText" disabled={locked || !canConfirm} onClick={() => setDialog("billing")}>Cargar factura</Button><Button icon="Check" loading={submitState.busy} disabled={!canConfirm} onClick={event => handleSubmit(event, false)}>{pendingIntent ? "Recuperar confirmación" : "Continuar"}</Button></footer>
      <Modal open={dialog === "origin"} title="Canal y origen del stock" description="Elegí por dónde llegó la venta y de dónde sale la mercadería." onClose={() => setDialog("")} footer={<Button onClick={() => setDialog("")}>Listo</Button>}>
        <FormField label="Canal comercial" required><Select value={channel} onChange={event => setChannel(event.target.value)}><option value="">Elegir canal real</option>{SALES_CHANNELS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></FormField>
        <FormField label="Tipo de origen"><Select value={stockType} onChange={event => switchOrigin("", event.target.value)}><option value="location">Ubicación</option><option value="warehouse">Depósito</option></Select></FormField>
        <FormField label="Origen físico del stock" required><Select value={locationId} onChange={event => switchOrigin(event.target.value)}><option value="">Elegir origen</option>{origins.map(origin => <option key={origin.id} value={origin.id}>{origin.name}</option>)}</Select></FormField>
        {cart.length ? <p>Cambiar el origen vacía los productos seleccionados.</p> : null}
      </Modal>
      <DiscountDialog open={dialog === "discount"} availableDiscounts={availableDiscounts} selectedDiscountIds={discountIds} initialManualDiscounts={manualDiscounts} manualAllowed={can(profile, "quick-sales", "useManualDiscounts")} onClose={() => setDialog("")} onApply={({ savedIds, manual }) => { setDiscountIds(savedIds); setManualDiscounts(manual); setDialog(""); }} />
      <CustomerDialog open={dialog === "customer"} zones={zonesResult.data || []} initialCustomer={customer.phone ? customer : null} onClose={() => setDialog("")} onSelect={setCustomer} />
      <Modal open={dialog === "payments"} title="Combinar pagos" description={`Total de la venta: ${formatMoney(saleSummary.total)}`} onClose={() => setDialog("")} footer={<Button disabled={allocation.invalid || allocation.difference !== 0 || allocation.positiveCount < 2} onClick={() => setDialog("")}>Listo</Button>}>
        {payments.map(part => <FormField key={part.method} label={friendlyPayments[part.method]}><div className="fm-quick-pos__payment-input"><input aria-label={friendlyPayments[part.method]} type="number" min="0" step="1" inputMode="numeric" value={part.amount} onChange={event => setPayments(current => current.map(entry => entry.method === part.method ? { ...entry, amount: event.target.value } : entry))} /><Button variant="ghost" disabled={allocation.invalid || allocation.difference <= 0} onClick={() => setPayments(current => completeRemainingPayment(current, part.method, saleSummary.total))}>Completar</Button></div></FormField>)}<p role="status">{paymentStatus}</p>
      </Modal>
      <Modal open={dialog === "price"} title="Editar precio" description={priceItem?.productName || "Precio unitario"} onClose={() => setDialog("")} footer={<Button disabled={!priceDraft.trim() || !Number.isInteger(Number(priceDraft)) || Number(priceDraft) < 0} onClick={() => { setPrices(current => ({ ...current, [priceItem.id]: Number(priceDraft) })); setDialog(""); }}>Aplicar precio</Button>}><FormField label="Precio unitario"><input type="number" min="0" step="1" inputMode="numeric" value={priceDraft} onChange={event => setPriceDraft(event.target.value)} /></FormField></Modal>
      <Modal open={dialog === "billing"} title="Cargar factura" description="Confirmá la venta y prepará su comprobante fiscal." onClose={() => !submitState.busy && setDialog("")} footer={<div className="fm-quick-pos__billing-actions"><Button variant="secondary" disabled={submitState.busy} onClick={event => handleSubmit(event, false)}>Solo continuar</Button><Button loading={submitState.busy} disabled={!canConfirm} onClick={event => handleSubmit(event, true)}>Generar factura y continuar</Button></div>}>
        <p className="fm-quick-pos__billing-total">Total {formatMoney(saleSummary.total)}</p>
        <FormField label="Condición IVA receptor" required><Select disabled={locked} value={receiverVatConditionId} onChange={event => { setReceiverVatConditionId(event.target.value); setReceiverDocument(""); }}><option value="5">Consumidor Final</option><option value="1">IVA Responsable Inscripto</option><option value="6">Responsable Monotributo</option><option value="4">IVA Sujeto Exento</option></Select></FormField>
        <FormField label={receiverVatConditionId === "5" ? "DNI (opcional)" : "CUIT del receptor"} required={receiverVatConditionId !== "5"} hint={receiverVatConditionId === "5" ? "Podés dejarlo vacío para Consumidor Final sin identificar, sujeto a validación fiscal." : "CUIT de 11 dígitos."}><input disabled={locked} inputMode="numeric" value={receiverDocument} onChange={event => setReceiverDocument(event.target.value.replace(/\D/g, "").slice(0, 11))} /></FormField>
        {submitState.error ? <Toast tone="error">{submitState.error}</Toast> : null}
      </Modal>
    </div>
  );
}
