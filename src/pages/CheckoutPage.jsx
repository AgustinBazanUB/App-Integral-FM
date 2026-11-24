import { isValidCustomerPhone } from "../gestion/customers/customerDomain";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, LockKeyhole, ShieldCheck } from "lucide-react";
import { Link } from "../router";
import PageMeta from "../components/PageMeta";
import PaywayPaymentForm from "../components/PaywayPaymentForm";
import PaywayInvoiceAction from "../components/PaywayInvoiceAction";
import DeliveryAddressPicker from "../components/DeliveryAddressPicker";
import { useCart } from "../context/CartContext";
import { useCommerceCatalog } from "../context/CommerceCatalogContext";
import { categoryById } from "../data/categories";
import {
  createEcommerceOrder,
  observeEcommerceSimulationCapability,
  requestEcommerceDelivery,
  simulateApprovedEcommercePayment,
} from "../services/ecommerceService";
import { trackEvent } from "../utils/analytics";

const DRAFT_KEY = "flor-mia-checkout-draft-v2";
const steps = ["Datos y contacto", "Entrega", "Comprobante", "Pago"];

function newRequestId() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `web_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function initialDraft() {
  return {
    requestId: newRequestId(),
    accessToken: newRequestId().replaceAll("-", "") + newRequestId().replaceAll("-", ""),
    addressSearch: "", deliverySelection: null, floor: "", apartment: "", instructions: "", receiverName: "",
    billingMode: "consumer_final", billingName: "", billingAddress: "",
    fullName: "",
    email: "",
    phone: "",
    deliveryMethod: "pickup",
    notes: "",
    marketingConsent: false,
    fiscalCuit: "",
  };
}

function readDraft() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? "{}");
    return {
      ...initialDraft(),
      ...saved,
      requestId: saved.requestId || newRequestId(),
      addressSearch: saved.addressSearch || [saved.street, saved.number].filter(Boolean).join(" "),
    };
  } catch {
    return initialDraft();
  }
}

function formatMoney(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export default function CheckoutPage() {
  const {
    items,
    unitCount,
    knownSubtotal,
    hasPendingPrices,
    hasUnavailableItems,
    clearCart,
  } = useCart();
  const { ready: catalogReady, config, pending, refresh: refreshCatalog } = useCommerceCatalog();
  const [step, setStep] = useState(() => readDraft().pendingOrder ? 3 : 0);
  const [draft, setDraft] = useState(readDraft);
  const [errors, setErrors] = useState({});
  const [storageMessage, setStorageMessage] = useState("");
  const [submitState, setSubmitState] = useState({ busy: false, error: "" });
  const [orderResult, setOrderResult] = useState(null);
  const [deliveryRequest, setDeliveryRequest] = useState(null);
  const [deliveryRetry, setDeliveryRetry] = useState(0);
  const submitting = useRef(false);
  const [simulationCapability, setSimulationCapability] = useState({
    enabled: false,
    localRuntime: false,
    adminRequired: true,
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      setStorageMessage("");
    } catch {
      setStorageMessage(
        "No pudimos guardar el borrador en este dispositivo. Podés continuar, pero los datos no persistirán.",
      );
    }
  }, [draft]);

  useEffect(() => {
    trackEvent("begin_checkout", { quantity: unitCount, value: knownSubtotal });
  }, [knownSubtotal, unitCount]);

  useEffect(
    () => observeEcommerceSimulationCapability(setSimulationCapability),
    [],
  );

  const summary = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        category: categoryById[item.categoryId]?.name || item.product?.categoryName,
      })),
    [items],
  );
  const cartKey = JSON.stringify(items.map(({ productId, quantity }) => ({ productId, quantity }))
    .sort((a, b) => a.productId.localeCompare(b.productId)));
  const selectionToken = draft.deliverySelection?.selectionToken;
  const canQuote = step > 0 && !draft.pendingOrder && draft.deliveryMethod === "delivery"
    && config.deliveryAddressEnabled && Boolean(selectionToken) && items.length > 0;
  useEffect(() => {
    if (!canQuote) return;
    const controller = new AbortController();
    const identity = { selectionToken, cartKey, deliveryRetry };
    setDeliveryRequest({ ...identity, loading: true });
    requestEcommerceDelivery({ mode: "quote", selectionToken, items: JSON.parse(cartKey) }, { signal: controller.signal })
      .then(({ address, quote, status }) => {
        if (!controller.signal.aborted) setDeliveryRequest({ ...identity, address, quote, status });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setDeliveryRequest({ ...identity, error: error.message });
      });
    return () => controller.abort();
  }, [canQuote, selectionToken, cartKey, deliveryRetry]);
  const delivery = deliveryRequest?.selectionToken === selectionToken && deliveryRequest?.cartKey === cartKey
    && deliveryRequest?.deliveryRetry === deliveryRetry ? deliveryRequest : null;
  const quote = delivery?.quote?.expiresAt > Date.now() ? delivery.quote : null;
  const quoting = canQuote && (!delivery || delivery.loading);
  const shippingAmount = draft.pendingOrder?.shippingAmount ?? quote?.amount;

  function changeDeliveryAddress(value, option = null) {
    setDraft((current) => ({ ...current, addressSearch: value, deliverySelection: option }));
    setErrors((current) => ({ ...current, addressSearch: undefined, deliveryQuote: undefined }));
  }

  const updateField = (event) => {
    if (draft.pendingOrder) return;
    const { name, value, type, checked } = event.target;
    setDraft((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  };

  const validateCurrentStep = () => {
    const nextErrors = {};
    if (step === 0) {
      if (!draft.fullName.trim()) nextErrors.fullName = "Ingresá tu nombre.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email)) {
        nextErrors.email = "Ingresá un email válido.";
      }
      if (!isValidCustomerPhone(draft.phone)) {
        nextErrors.phone = "Ingresá un teléfono válido.";
      }
    }
    if (step === 1) {
      if (draft.deliveryMethod === "pickup" && !config.pickupEnabled) {
        nextErrors.deliveryMethod = "El retiro está PENDIENTE DE DEFINIR.";
      }
      if (draft.deliveryMethod === "delivery") {
        if (!config.deliveryEnabled || !config.deliveryAddressEnabled) {
          nextErrors.deliveryMethod = "El envío aún no está habilitado.";
        } else if (!selectionToken) {
          nextErrors.addressSearch = "Elegí una dirección de la lista.";
        } else if (!quote) {
          nextErrors.deliveryQuote = quoting ? "Esperá la cotización del envío." : "Necesitás una tarifa confirmada para continuar.";
        }
      }
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const goNext = () => {
    if (!validateCurrentStep()) return;
    if (step === 1) {
      trackEvent("add_shipping_info", {
        shipping_tier: draft.deliveryMethod,
        quantity: unitCount,
        value: knownSubtotal,
      });
    }
    setStep((current) => Math.min(current + 1, steps.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submitOrder = async ({ simulatePayment = false } = {}) => {
    if (submitting.current) return;
    submitting.current = true;
    setSubmitState({ busy: true, error: "" });
    try {
      let result = draft.pendingOrder ? { order: draft.pendingOrder } : null;
      if (!result) {
      const latestCatalog = await refreshCatalog();
      if (!latestCatalog?.ready && latestCatalog?.pending?.includes("ECOMMERCE_LOCATION_ID")) {
        throw new Error("La ubicación de stock Ecommerce está PENDIENTE DE DEFINIR.");
      }
      if (hasPendingPrices || hasUnavailableItems || !items.length) {
        throw new Error("El carrito cambió. Revisá precio y disponibilidad antes de confirmar.");
      }

      result = await createEcommerceOrder({
        requestId: draft.requestId,
        accessToken: draft.accessToken,
        billing: {
          mode: draft.billingMode,
          cuit: draft.fiscalCuit,
          name: draft.billingName,
          address: draft.billingAddress,
          ...(draft.billingMode === "fiscal" ? { requestedClass: "A" } : {}),
        },
        shipping: {
          method: draft.deliveryMethod,
          notes: draft.notes,
          ...(draft.deliveryMethod === "delivery" ? {
            quoteToken: quote?.quoteToken,
            address: {
              floor: draft.floor, apartment: draft.apartment,
              instructions: draft.instructions, receiverName: draft.receiverName,
            },
          } : {}),
        },
        items: items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
        customer: {
          fullName: draft.fullName,
          email: draft.email,
          phone: draft.phone,
          marketingConsent: draft.marketingConsent,
        },
        deliveryMethod: draft.deliveryMethod,
        notes: draft.notes,
        paymentMode: "pending",
        // Sólo diagnóstico: el backend NO usa este total como autoridad.
        clientTotal: knownSubtotal,
      });
      setDraft((current) => ({ ...current, pendingOrder: result.order }));
      }

      let finalOrder = result.order;
      if (!simulatePayment) {
        setDraft(current => ({ ...current, pendingOrder: result.order }));
        window.localStorage.setItem("flor-mia-last-order", JSON.stringify({ orderId: result.order.id, accessToken: draft.accessToken }));
        setStep(3);
        return;
      }
      let simulation = null;
      if (simulatePayment) {
        simulation = await simulateApprovedEcommercePayment({
          orderId: result.order.id,
          idempotencyKey: result.order.idempotencyKey || draft.requestId,
          receiverCuit: draft.fiscalCuit,
        });
        finalOrder = {
          ...result.order,
          ...simulation.order,
          invoiceId: simulation.invoice?.id || null,
          invoiceStatus: simulation.invoice?.status || result.order.invoiceStatus,
        };
      }

      setOrderResult({ ...finalOrder, simulation });
      setStep(3);
      window.localStorage.setItem("flor-mia-last-order",JSON.stringify({orderId:result.order.id,accessToken:draft.accessToken}));
      clearCart();
      window.localStorage.removeItem(DRAFT_KEY);
      setDraft(initialDraft());
      setSubmitState({ busy: false, error: "" });
      trackEvent("purchase_intent_created", {
        transaction_id: result.order.id,
        value: result.order.total,
        currency: "ARS",
        payment_status: result.order.paymentStatus,
      });
    } catch (error) {
      if (["ecommerce-delivery-quote-required", "ecommerce-delivery-quote-stale", "ecommerce-delivery-token-invalid"].includes(error?.code)) {
        setDeliveryRetry((current) => current + 1);
        setErrors({ deliveryQuote: "Revisá el importe actualizado antes de continuar." });
        setSubmitState({ busy: false, error: "" });
        setStep(1);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      if (error?.phase === "invoice") {
        setDraft((current) => ({ ...current, pendingOrder: current.pendingOrder ? {
          ...current.pendingOrder, paymentStatus: error.payment?.status || current.pendingOrder.paymentStatus,
          saleId: error.payment?.saleId || current.pendingOrder.saleId,
          fiscalRetryPending: true,
        } : null }));
      }
      setSubmitState({
        busy: false,
        error: error?.phase === "invoice"
          ? `El pago simulado y la venta quedaron registrados. Reintentá la preparación fiscal: ${error.message}`
          : error?.message || "No se pudo registrar el pedido.",
      });
    } finally {
      submitting.current = false;
      setSubmitState(current => ({ ...current, busy: false }));
    }
  };

  const checkoutBlocked =
    !draft.pendingOrder && (!catalogReady
    || hasPendingPrices
    || hasUnavailableItems
    || (draft.deliveryMethod === "pickup" && !config.pickupEnabled)
    || (draft.deliveryMethod === "delivery" && !quote));

  return (
    <main id="main-content" className="page-shell checkout-page">
      <PageMeta title="Checkout | Flor Mía" />
      <section className="checkout-header">
        <div className="container">
          <Link to="/productos">
            <ArrowLeft size={17} aria-hidden="true" />
            Seguir explorando
          </Link>
          <p className="eyebrow">CHECKOUT COMERCIAL</p>
          <h1>Tu pedido Flor Mía</h1>
          <div className="checkout-progress" aria-label={`Paso ${step + 1} de 4`}>
            {steps.map((label, index) => (
              <button
                type="button"
                key={label}
                className={index <= step ? "is-active" : ""}
                disabled={index > step || Boolean(orderResult) || Boolean(draft.pendingOrder)}
                onClick={() => index < step && !orderResult && setStep(index)}
                aria-current={index === step ? "step" : undefined}
              >
                <span>{index < step ? <Check size={15} /> : index + 1}</span>
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="section checkout-layout">
        <div className={`container checkout-grid${orderResult ? " checkout-grid--complete" : ""}`}>
          <div className="checkout-form-card">
            {orderResult ? (
              <div className="integration-state">
                <Check size={34} aria-hidden="true" />
                <h2>{orderResult.paymentStatus === "approved" ? "Pago aprobado. Tu pedido está confirmado." : "Pedido registrado."}</h2><Link className="button button--secondary" to="/mi-pedido">Consultar estado de mi pedido</Link>
                <p><strong>{orderResult.id}</strong></p>
                <p>Total recalculado por el backend: <strong>{formatMoney(orderResult.total)}</strong></p>
                <p>Pago: <strong>{orderResult.paymentStatus}</strong></p>
                {orderResult.paymentReference && <p>Referencia Payway Sandbox: <strong>{orderResult.paymentReference}</strong></p>}
                {orderResult.paymentStatus === "approved" && (
                  <PaywayInvoiceAction order={orderResult} accessToken={orderResult.accessToken}
                    onUpdate={invoice => setOrderResult(current => ({ ...current, ...invoice }))} />
                )}
                {orderResult.simulation ? (
                  <>
                    <p>Venta Ecommerce: <strong>{orderResult.saleId}</strong></p>
                    <p>Invoice: <strong>{orderResult.simulation.invoice?.id}</strong> · {orderResult.simulation.invoice?.status}</p>
                    <p>
                      Resultado fiscal: <strong>{orderResult.simulation.fiscal?.mode}</strong>
                      {orderResult.simulation.fiscal?.voucherClass ? ` · Factura ${orderResult.simulation.fiscal.voucherClass}` : ""}
                    </p>
                    <p>No se procesó un pago real y no se solicitó CAE en este flujo local.</p>
                  </>
                ) : (
                  <p>
                    Payway Sandbox confirmó el pago. La venta y el stock de prueba quedaron registrados. No se emitió un comprobante fiscal productivo.
                  </p>
                )}
                <Link className="button button--gold" to="/productos">Seguir comprando</Link>
              </div>
            ) : items.length || draft.pendingOrder ? (
              <>
                {step === 0 ? (
                  <form onSubmit={(event) => event.preventDefault()}>
                    <p className="eyebrow">PASO 1 DE 4</p>
                    <h2>Datos y contacto</h2>
                    <p>Comprá como invitado. Te pedimos estos datos para coordinar tu pedido.</p>
                    {storageMessage ? <p className="field-error" role="status">{storageMessage}</p> : null}
                    <div className="form-grid">
                      <label className="field-label field-label--full">
                        Nombre y apellido
                        <input name="fullName" value={draft.fullName} onChange={updateField} autoComplete="name" aria-invalid={Boolean(errors.fullName)} />
                        {errors.fullName ? <span className="field-error">{errors.fullName}</span> : null}
                      </label>
                      <label className="field-label">
                        Email
                        <input name="email" type="email" value={draft.email} onChange={updateField} autoComplete="email" aria-invalid={Boolean(errors.email)} />
                        {errors.email ? <span className="field-error">{errors.email}</span> : null}
                      </label>
                      <label className="field-label">
                        Teléfono
                        <input name="phone" type="tel" value={draft.phone} onChange={updateField} autoComplete="tel" aria-invalid={Boolean(errors.phone)} />
                        {errors.phone ? <span className="field-error">{errors.phone}</span> : null}
                      </label>
                      <label className="checkbox-label field-label--full">
                        <input type="checkbox" name="marketingConsent" checked={draft.marketingConsent} onChange={updateField} />
                        <span>Quiero recibir novedades. Este consentimiento es opcional.</span>
                      </label>
                    </div>
                  </form>
                ) : null}

                {step === 1 ? (
                  <form onSubmit={(event) => event.preventDefault()}>
                    <p className="eyebrow">PASO 2 DE 4</p>
                    <h2>Entrega o retiro</h2>
                    <div className="delivery-options">
                      <label>
                        <input
                          type="radio"
                          name="deliveryMethod"
                          value="pickup"
                          checked={draft.deliveryMethod === "pickup"}
                          onChange={updateField}
                        />
                        <span>
                          <strong>{config.pickup?.name ? `Retirar por ${config.pickup.name}` : "Retiro en local"}</strong>
                          <small>{config.pickupEnabled ? config.pickup?.address || "Habilitado comercialmente." : "Retiro aún no habilitado."}</small>
                        </span>
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="deliveryMethod"
                          value="delivery"
                          disabled={!config.deliveryEnabled || !config.deliveryAddressEnabled}
                          checked={draft.deliveryMethod === "delivery"}
                          onChange={updateField}
                        />
                        <span>
                          <strong>Envío</strong>
                          <small>{config.deliveryEnabled && config.deliveryAddressEnabled ? "Calculamos la tarifa para tu dirección." : "Envío aún no habilitado."}</small>
                        </span>
                      </label>
                    </div>
                    {draft.deliveryMethod === "delivery" && config.deliveryAddressEnabled && <div className="checkout-delivery-details">
                      <DeliveryAddressPicker
                        value={draft.addressSearch}
                        selection={draft.deliverySelection}
                        onInput={changeDeliveryAddress}
                        onSelect={(option) => changeDeliveryAddress(option.label, option)}
                        error={errors.addressSearch}
                      />
                      {draft.deliverySelection && <button type="button" className="delivery-retry" onClick={() => changeDeliveryAddress("")}>Cambiar dirección</button>}
                      {delivery?.address && <dl className="delivery-address-confirmation">
                        <div><dt>Ciudad o localidad</dt><dd>{delivery.address.city}{delivery.address.neighborhood ? " · " + delivery.address.neighborhood : ""}</dd></div>
                        <div><dt>Provincia</dt><dd>{delivery.address.province}</dd></div>
                        <div><dt>Código postal</dt><dd>{delivery.address.postalCode}</dd></div>
                      </dl>}
                      <div className="form-grid">
                        <label className="field-label">Piso (opcional)<input name="floor" maxLength={30} value={draft.floor} onChange={updateField} /></label>
                        <label className="field-label">Departamento (opcional)<input name="apartment" maxLength={50} value={draft.apartment} onChange={updateField} /></label>
                      </div>
                      <label className="field-label">
                        Nombre de quien recibe (opcional)
                        <input name="receiverName" maxLength={120} value={draft.receiverName} onChange={updateField} />
                      </label>
                      {quoting && <p className="delivery-hint" role="status">Confirmando dirección y tarifa…</p>}
                      {quote && <div className="delivery-quote" role="status">
                        <div><span>Zona y tarifa de envío</span><strong>{quote.name}</strong></div>
                        <strong>{quote.amount === 0 ? "Sin cargo" : formatMoney(quote.amount)}</strong>
                        {quote.promotion && <small>{quote.promotion} · Envío sin cargo dentro del AMBA</small>}
                      </div>}
                      {quote?.carrier === "andreani" && items.some((item) => item.product?.freeShippingAmba) && (
                        <p className="delivery-hint">El envío sin cargo de tu promoción aplica dentro del AMBA.</p>
                      )}
                      {(delivery?.error || delivery?.status?.message) && (
                        <p className="field-error" role="alert">{delivery.error || delivery.status.message}</p>
                      )}
                      {delivery?.error && <button type="button" className="delivery-retry" onClick={() => setDeliveryRetry((current) => current + 1)}>Reintentar cotización</button>}
                      {delivery?.quote && !quote && <button type="button" className="delivery-retry" onClick={() => setDeliveryRetry((current) => current + 1)}>Actualizar cotización</button>}
                      {errors.deliveryQuote && <p className="field-error" role="alert">{errors.deliveryQuote}</p>}
                      <label className="field-label">
                        Indicaciones para el repartidor (opcional)
                        <textarea name="instructions" rows="2" maxLength={500} value={draft.instructions} onChange={updateField} />
                      </label>
                    </div>}
                    {errors.deliveryMethod ? <p className="field-error">{errors.deliveryMethod}</p> : null}
                    <label className="field-label">
                      Notas del pedido
                      <textarea name="notes" rows="3" maxLength="500" value={draft.notes} onChange={updateField} />
                    </label>
                  </form>
                ) : null}

                {step === 2 ? (
                  <div>
                    <p className="eyebrow">PASO 3 DE 4</p>
                    <h2>Pago y facturación</h2>
                    <fieldset><legend>Datos de facturación</legend>
                      <label className="checkbox-label"><input type="radio" name="billingMode" value="consumer_final" checked={draft.billingMode === "consumer_final"} onChange={updateField}/>Consumidor final</label>
                      <label className="checkbox-label"><input type="radio" name="billingMode" value="fiscal" checked={draft.billingMode === "fiscal"} onChange={updateField}/>Factura A</label>
                      {draft.billingMode === "fiscal" && <div className="form-grid"><label className="field-label">CUIT<input name="fiscalCuit" value={draft.fiscalCuit} onChange={updateField} inputMode="numeric"/></label><label className="field-label">Nombre o razón social<input name="billingName" value={draft.billingName} onChange={updateField}/></label><label className="field-label field-label--full">Domicilio fiscal<input name="billingAddress" value={draft.billingAddress} onChange={updateField}/></label></div>}
                      <p>Para Factura A, verificamos el CUIT y su condición fiscal antes de confirmar el pedido.</p>
                    </fieldset>
                    <div className="integration-state">
                      <LockKeyhole size={30} aria-hidden="true" />
                      <h3>Pagar con Payway</h3>
                      <p>
                        Al confirmar reservaremos tus productos durante 15 minutos.
                        Después podrás pagar en Payway Sandbox con una tarjeta oficial de prueba.
                      </p>
                    </div>
                    {simulationCapability.enabled ? (
                      <div className="pending-panel">
                        <strong>Modo local de prueba para administrador</strong>
                        <p>
                          Este checkout no procesa un pago real.
                          La acción simulará un pago aprobado.
                          Se preparará un plan fiscal de prueba sin solicitar CAE.
                        </p>

                      </div>
                    ) : null}
                    <div className="integration-state">
                      <ShieldCheck size={28} aria-hidden="true" />
                      <h3>Confirmación segura de tu pedido.</h3>
                      <p>Comprobamos precio y disponibilidad antes de registrar tu pedido.</p>
                    </div>
                  </div>
                ) : null}

                {step === 3 ? (
                  <div>
                    <p className="eyebrow">PASO 4 DE 4</p>
                    <h2>Confirmar pedido</h2>
                    {draft.pendingOrder ? <PaywayPaymentForm order={draft.pendingOrder} accessToken={draft.accessToken}
                      onStartNewOrder={() => { const fresh = initialDraft(); setDraft(current => ({ ...current, requestId: fresh.requestId, accessToken: fresh.accessToken, pendingOrder: null })); setStep(0); }}
                      onUpdate={order => setDraft(current => ({ ...current, pendingOrder: { ...current.pendingOrder, ...order } }))}
                      onApproved={result => {
                        setOrderResult({ ...result.order, paymentReference: result.gateway.reference, accessToken: draft.accessToken });
                        clearCart();
                        window.localStorage.removeItem(DRAFT_KEY);
                        setDraft(initialDraft());
                      }} /> : null}
                    {draft.pendingOrder?.fiscalRetryPending ? (
                      <p role="status">El pago simulado y la venta ya están registrados. Podés reintentar el plan fiscal para este mismo pedido.</p>
                    ) : null}
                    {!draft.pendingOrder && checkoutBlocked ? (
                      <div className="pending-panel">
                        <strong>No se puede confirmar todavía.</strong>
                        <p>
                          Revisá los productos y las opciones de entrega disponibles.
                        </p>
                      </div>
                    ) : !draft.pendingOrder ? (
                      <div className="integration-state">
                        <Check size={30} aria-hidden="true" />
                        <h3>Listo para registrar el pedido.</h3>
                        <p>
                          Verificaremos el total y reservaremos tus productos al confirmar.
                        </p>
                      </div>
                    ) : null}
                    {submitState.error ? <p className="field-error" role="alert">{submitState.error}</p> : null}
                  </div>
                ) : null}

                {(!draft.pendingOrder || simulationCapability.enabled) && <div className="checkout-actions">
                  {step > 0 && !draft.pendingOrder ? (
                    <button type="button" className="button button--secondary" onClick={() => setStep((current) => current - 1)} disabled={submitState.busy}>
                      Volver
                    </button>
                  ) : null}
                  {step < steps.length - 1 ? (
                    <button type="button" className="button button--gold" onClick={goNext}>
                      {step === 2 ? "Revisar pedido" : "Continuar"}
                    </button>
                  ) : (
                    <>
                    {!draft.pendingOrder && <button
                      type="button"
                      className="button button--gold"
                      disabled={checkoutBlocked || submitState.busy}
                      onClick={() => submitOrder()}
                    >
                      {submitState.busy ? "Registrando…" : "Crear pedido y continuar al pago"}
                    </button>}
                    {simulationCapability.enabled ? (
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={checkoutBlocked || submitState.busy}
                        onClick={() => submitOrder({ simulatePayment: true })}
                      >
                        {submitState.busy ? "Procesando…" : draft.pendingOrder ? "Reintentar pago simulado + plan fiscal" : "Simular pago aprobado + factura"}
                      </button>
                    ) : null}
                    </>
                  )}
                </div>}
              </>
            ) : (
              <div className="empty-state">
                <h2>Tu carrito está vacío.</h2>
                <p>Agregá productos antes de recorrer el checkout.</p>
                <Link className="button" to="/productos">Explorar productos</Link>
              </div>
            )}
          </div>

          {!orderResult && <aside className="order-summary">
            <p className="eyebrow">RESUMEN</p>
            <h2>{unitCount} {unitCount === 1 ? "producto" : "productos"}</h2>
            <div className="order-summary__items">
              {summary.map((item) => (
                <article key={item.productId}>
                  {item.product?.image ? <img src={item.product.image} alt="" width="58" height="72" /> : null}
                  <div>
                    <span>{item.category}</span>
                    <strong>{item.product?.name || "Producto no disponible"}</strong>
                    <small>{item.quantity} unidad{item.quantity === 1 ? "" : "es"}</small>
                  </div>
                  <span>{typeof item.price === "number" ? formatMoney(item.price * item.quantity) : "No disponible"}</span>
                </article>
              ))}
            </div>
            <div className="order-summary__total">
              <span>Subtotal visible</span>
              <strong>{hasPendingPrices ? "No disponible" : formatMoney(knownSubtotal)}</strong>
            </div>
            {draft.deliveryMethod === "delivery" && (
              <div className="order-summary__total">
                <span>Envío</span>
                <strong>{shippingAmount == null ? "Por calcular" : shippingAmount === 0 ? "Sin cargo" : formatMoney(shippingAmount)}</strong>
              </div>
            )}
            {shippingAmount != null && draft.deliveryMethod === "delivery" && !hasPendingPrices && (
              <div className="order-summary__total">
                <span>Total</span><strong>{formatMoney(draft.pendingOrder?.total ?? knownSubtotal + shippingAmount)}</strong>
              </div>
            )}
            <p>Precio y disponibilidad se confirman al registrar tu pedido.</p>
          </aside>}
        </div>
      </section>
    </main>
  );
}
