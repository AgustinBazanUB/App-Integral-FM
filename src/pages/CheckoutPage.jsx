import { isValidCustomerPhone } from "../gestion/customers/customerDomain";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check } from "lucide-react";
import { Link } from "../router";
import PageMeta from "../components/PageMeta";
import PaywayPaymentForm, { paywayRequest } from "../components/PaywayPaymentForm";
import PaywayInvoiceAction from "../components/PaywayInvoiceAction";
import DeliveryAddressPicker from "../components/DeliveryAddressPicker";
import { useCart } from "../context/CartContext";
import { useCommerceCatalog } from "../context/CommerceCatalogContext";
import { categoryById } from "../data/categories";
import {
  createEcommerceOrder,
  fetchEcommerceBilling,
  observeEcommerceSimulationCapability,
  requestEcommerceDelivery,
  simulateApprovedEcommercePayment,
} from "../services/ecommerceService";
import { trackEvent } from "../utils/analytics";
import { isValidCuit, normalizeCuit } from "../../netlify/functions/_lib/arca/cuit.mjs";

import {
  activeCheckoutReservation, checkoutCartKey, CHECKOUT_DRAFT_EVENT, DRAFT_KEY, initialDraft, readDraft, reserveCheckoutDraft,
} from "../services/checkoutDraft";

const steps = ["Datos y contacto", "Entrega", "Pago y facturación"];
const paymentStep = steps.length - 1;

function fiscalAddressText(address) {
  if (!address?.street) return "";
  return [...new Set([address.street, address.city, address.province, address.postalCode].filter(Boolean))].join(", ");
}

function rememberOrder(orderId, accessToken) {
  try {
    window.localStorage.setItem("flor-mia-last-order", JSON.stringify({ orderId, accessToken }));
  } catch {}
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
  const [draft, setDraft] = useState(readDraft);
  const [step, setStep] = useState(() => draft.pendingOrder || draft.checkoutStarted ? paymentStep : 0);
  const [errors, setErrors] = useState({});
  const [storageMessage, setStorageMessage] = useState("");
  const [submitState, setSubmitState] = useState({ busy: false, error: "" });
  const [orderResult, setOrderResult] = useState(null);
  const [deliveryRequest, setDeliveryRequest] = useState(null);
  const [deliveryRetry, setDeliveryRetry] = useState(0);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [fiscalLookup, setFiscalLookup] = useState(null);
  const [fiscalRetry, setFiscalRetry] = useState(0);
  const [clock, setClock] = useState(Date.now);
  const holdExpiry = draft.stockHold?.expiresAt;
  const actionLock = useRef(false);
  const paymentLock = useRef(false);
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
    const syncDraft = () => {
      if (!paymentLock.current && !actionLock.current && !orderResult) {
        setDraft(readDraft());
        setClock(Date.now());
      }
    };
    window.addEventListener(CHECKOUT_DRAFT_EVENT, syncDraft);
    return () => window.removeEventListener(CHECKOUT_DRAFT_EVENT, syncDraft);
  }, [orderResult]);

  useEffect(() => {
    if (!holdExpiry || draft.pendingOrder) return;
    const tick = () => setClock(Date.now());
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [holdExpiry, draft.pendingOrder]);

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
  const cartKey = checkoutCartKey(items);
  const holdActive = activeCheckoutReservation(draft, cartKey, Math.max(clock, Date.now()));
  const needsStockHold = config.checkoutReserveEnabled && !draft.pendingOrder && !holdActive;
  const holdSeconds = Math.max(0, Math.ceil((holdExpiry - clock) / 1000));
  const countdown = Math.floor(holdSeconds / 60) + ":" + String(holdSeconds % 60).padStart(2, "0");
  const selectionToken = draft.deliverySelection?.selectionToken;
  const canQuote = step > 0 && !draft.pendingOrder && draft.deliveryMethod === "delivery"
    && !needsStockHold && config.deliveryAddressEnabled && Boolean(selectionToken) && items.length > 0;
  useEffect(() => {
    if (!canQuote) return;
    const controller = new AbortController();
    const identity = { selectionToken, cartKey, deliveryRetry, requestId: draft.requestId };
    setDeliveryRequest({ ...identity, loading: true });
    requestEcommerceDelivery({
      mode: "quote", selectionToken, items: JSON.parse(cartKey),
      ...(holdActive ? { checkoutReservation: { requestId: draft.requestId, accessToken: draft.accessToken } } : {}),
    }, { signal: controller.signal })
      .then(({ address, quote, status }) => {
        if (!controller.signal.aborted) setDeliveryRequest({ ...identity, address, quote, status });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setDeliveryRequest({ ...identity, error: error.message });
      });
    return () => controller.abort();
  }, [canQuote, selectionToken, cartKey, deliveryRetry, holdActive, draft.requestId, draft.accessToken]);
  const delivery = deliveryRequest?.selectionToken === selectionToken && deliveryRequest?.cartKey === cartKey
    && deliveryRequest?.deliveryRetry === deliveryRetry && deliveryRequest.requestId === draft.requestId ? deliveryRequest : null;
  const quote = delivery?.quote?.expiresAt > Date.now() ? delivery.quote : null;
  const quoting = canQuote && (!delivery || delivery.loading);
  const shippingAmount = draft.pendingOrder?.shippingAmount ?? quote?.amount;

  const fiscalDigits = normalizeCuit(draft.fiscalCuit);
  const lookupCuit = !draft.pendingOrder && draft.billingMode === "fiscal" && isValidCuit(fiscalDigits) ? fiscalDigits : "";
  useEffect(() => {
    if (!lookupCuit) return;
    const controller = new AbortController();
    setFiscalLookup({ cuit: lookupCuit, loading: true });
    const timer = setTimeout(async () => {
      try {
        const { billing } = await fetchEcommerceBilling(lookupCuit, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setFiscalLookup({ cuit: lookupCuit, billing });
        setDraft((current) => {
          if (normalizeCuit(current.fiscalCuit) !== lookupCuit || current.pendingOrder) return current;
          return {
            ...current,
            billingName: current.billingName || billing.name,
            billingAddress: current.billingAddress || fiscalAddressText(billing.address),
          };
        });
      } catch (error) {
        if (!controller.signal.aborted) setFiscalLookup({ cuit: lookupCuit, error: error.message, code: error.code });
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [lookupCuit, fiscalRetry]);
  const currentFiscalLookup = lookupCuit && fiscalLookup?.cuit === lookupCuit ? fiscalLookup : null;
  const fiscalBilling = currentFiscalLookup?.billing;
  const canBill = draft.billingMode === "consumer_final" || (lookupCuit && currentFiscalLookup
    && !currentFiscalLookup.loading && currentFiscalLookup.code !== "ecommerce-invoice-a-unavailable"
    && draft.billingName.trim() && draft.billingAddress.trim());
  const suggestedAddress = (draft.deliveryMethod === "delivery" && delivery?.address)
    || (fiscalBilling && draft.billingAddress === fiscalAddressText(fiscalBilling.address) ? fiscalBilling.address : undefined);
  const isApartment = draft.residenceType === "apartment";
  const hasCheckoutAttempt = Boolean(draft.pendingOrder || draft.checkoutStarted);

  function changeDeliveryAddress(value, option = null) {
    setDraft((current) => ({ ...current, addressSearch: value, deliverySelection: option }));
    setErrors((current) => ({ ...current, addressSearch: undefined, deliveryQuote: undefined }));
  }

  const updateField = (event) => {
    if (hasCheckoutAttempt || paymentLock.current || actionLock.current) return;
    const { name, value, type, checked } = event.target;
    setDraft((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
      ...(name === "fiscalCuit" && normalizeCuit(value) !== normalizeCuit(current.fiscalCuit)
        ? { billingName: "", billingAddress: "" }
        : {}),
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
        if (isApartment) {
          if (!draft.floor.trim()) nextErrors.floor = "Ingresá el piso.";
          if (!draft.apartment.trim()) nextErrors.apartment = "Ingresá el departamento.";
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
    setStep((current) => Math.min(current + 1, paymentStep));
    setSubmitState({ busy: false, error: "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  async function changeStep(target) {
    if (orderResult || paymentLock.current || actionLock.current) return;
    if (hasCheckoutAttempt) {
      actionLock.current = true;
      setSubmitState({ busy: true, error: "" });
      try {
        await paywayRequest({
          mode: "edit",
          orderId: draft.pendingOrder?.id || "ecommerce_order_" + draft.requestId,
          accessToken: draft.accessToken,
        });
        const fresh = initialDraft();
        setDraft(current => ({
          ...current, requestId: fresh.requestId, accessToken: fresh.accessToken,
          pendingOrder: null, checkoutStarted: false, stockHold: null, holdRequestedFor: null,
        }));
        setSubmitState({ busy: false, error: "" });
      } catch (error) {
        setSubmitState({ busy: false, error: error.message });
        return;
      } finally {
        actionLock.current = false;
      }
    }
    setErrors({});
    setStep(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function renewCheckoutHold() {
    if (actionLock.current || paymentLock.current) return;
    actionLock.current = true;
    setSubmitState({ busy: true, error: "" });
    try {
      const saved = await reserveCheckoutDraft(draft, items);
      setDraft(saved);
      setClock(Date.now());
      setSubmitState({ busy: false, error: "" });
    } catch (error) {
      setDraft(readDraft());
      setSubmitState({ busy: false, error: error.message });
      if (error.code === "ecommerce-stock-insufficient") refreshCatalog().catch(() => {});
    } finally {
      actionLock.current = false;
    }
  }

  async function prepareOrder() {
    if (draft.pendingOrder) return draft.pendingOrder;
    if (config.checkoutReserveEnabled && !activeCheckoutReservation(draft, cartKey)) {
      throw new Error("La reserva del carrito venció. Volvé a reservar antes de pagar.");
    }
    if (draft.deliveryMethod === "delivery" && (!quote || quote.expiresAt <= Date.now())) {
      setDeliveryRetry(current => current + 1);
      throw new Error("La tarifa de envío se está actualizando. Revisala antes de pagar.");
    }
    const latestCatalog = await refreshCatalog();
    if (!latestCatalog?.ready && latestCatalog?.pending?.includes("ECOMMERCE_LOCATION_ID")) {
      throw new Error("La ubicación de stock Ecommerce está PENDIENTE DE DEFINIR.");
    }
    if (hasPendingPrices || (!holdActive && hasUnavailableItems) || !items.length) {
      throw new Error("El carrito cambió. Revisá precio y disponibilidad antes de confirmar.");
    }

    const started = { ...draft, checkoutStarted: true };
    setDraft(started);
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(started));
    } catch {}
    let result;
    try {
      result = await createEcommerceOrder({
        requestId: draft.requestId,
        accessToken: draft.accessToken,
        ...(holdActive ? { checkoutReservation: true } : {}),
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
              floor: isApartment ? draft.floor : "",
              apartment: isApartment ? draft.apartment : "",
              instructions: draft.instructions,
              receiverName: draft.receiverName,
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
    } catch (error) {
      if (["ecommerce-reservation-expired", "ecommerce-reservation-cart-changed"].includes(error.code)) {
        setDraft(current => ({ ...current, checkoutStarted: false, stockHold: current.stockHold ? { ...current.stockHold, expiresAt: 0 } : null }));
      }
      if (["ecommerce-delivery-quote-required", "ecommerce-delivery-quote-stale", "ecommerce-delivery-token-invalid"].includes(error.code)) {
        setDeliveryRetry(current => current + 1);
        throw new Error("Revisá la tarifa de entrega actualizada antes de pagar.");
      }
      throw error;
    }
    const saved = { ...started, pendingOrder: result.order };
    setDraft(saved);
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(saved));
    } catch {}
    rememberOrder(result.order.id, draft.accessToken);
    if (result.created) trackEvent("purchase_intent_created", {
      transaction_id: result.order.id,
      value: result.order.total,
      currency: "ARS",
      payment_status: result.order.paymentStatus,
    });
    return result.order;
  }

  function finishOrder(order) {
    rememberOrder(order.id, draft.accessToken);
    setOrderResult(order);
    clearCart();
    setDraft(initialDraft());
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitSimulatedPayment() {
    if (actionLock.current || paymentLock.current) return;
    actionLock.current = true;
    setSubmitState({ busy: true, error: "" });
    try {
      const order = await prepareOrder();
      const simulation = await simulateApprovedEcommercePayment({
        orderId: order.id,
        idempotencyKey: order.idempotencyKey || draft.requestId,
        receiverCuit: draft.billingMode === "fiscal" ? draft.fiscalCuit : "",
      });
      finishOrder({
        ...order, ...simulation.order, simulation,
        invoiceId: simulation.invoice?.id || null,
        invoiceStatus: simulation.invoice?.status || order.invoiceStatus,
      });
      setSubmitState({ busy: false, error: "" });
    } catch (error) {
      if (error.phase === "invoice") {
        setDraft(current => current.pendingOrder ? {
          ...current, pendingOrder: {
            ...current.pendingOrder,
            paymentStatus: error.payment?.status || current.pendingOrder.paymentStatus,
            saleId: error.payment?.saleId || current.pendingOrder.saleId,
            fiscalRetryPending: true,
          },
        } : current);
      }
      setSubmitState({
        busy: false,
        error: error.phase === "invoice"
          ? "El pago simulado se registró. Reintentá la preparación fiscal: " + error.message
          : error.message,
      });
    } finally {
      actionLock.current = false;
    }
  }

  const checkoutBlocked = !draft.pendingOrder && (!catalogReady || hasPendingPrices || needsStockHold || (!holdActive && hasUnavailableItems)
    || (draft.deliveryMethod === "pickup" && !config.pickupEnabled)
    || (draft.deliveryMethod === "delivery" && !quote));
  const navigatingLocked = Boolean(orderResult || paymentBusy || submitState.busy);
  const paymentDisabled = checkoutBlocked || (!draft.pendingOrder && !canBill) || submitState.busy;
  const estimate = {
    subtotal: knownSubtotal,
    shippingAmount: draft.deliveryMethod === "delivery" ? quote?.amount : 0,
    total: knownSubtotal + (quote?.amount ?? 0),
  };

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
          <div className="checkout-progress" aria-label={"Paso " + (step + 1) + " de " + steps.length}>
            {steps.map((label, index) => (
              <button
                type="button"
                key={label}
                className={index <= step ? "is-active" : ""}
                disabled={index > step || navigatingLocked}
                onClick={() => index < step && changeStep(index)}
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
            {!orderResult && !draft.pendingOrder && config.checkoutReserveEnabled && items.length > 0 && (
              <div className="pending-panel checkout-reservation">
                {holdActive ? (
                  <p>Carrito reservado por <strong role="timer" aria-label="Tiempo restante para pagar">{countdown}</strong></p>
                ) : !hasCheckoutAttempt ? (
                  <>
                    <p>{draft.stockHold?.cartKey === cartKey ? "Venció la reserva de tu carrito." : "Reservá tu carrito por 10 minutos para completar el pago."}</p>
                    <button className="button button--secondary" type="button" disabled={navigatingLocked} onClick={renewCheckoutHold}>
                      {submitState.busy ? "Reservando…" : "Reservar por 10 minutos"}
                    </button>
                  </>
                ) : null}
                {step !== paymentStep && submitState.error && <p className="field-error" role="alert">{submitState.error}</p>}
              </div>
            )}
            {orderResult ? (
              <div className="integration-state">
                <Check size={34} aria-hidden="true" />
                <h2>{orderResult.paymentStatus === "approved" ? "Pago aprobado. Tu pedido está confirmado." : "Pedido registrado."}</h2><Link className="button button--secondary" to="/mi-pedido">Consultar estado de mi pedido</Link>
                <p><strong>{orderResult.id}</strong></p>
                <p>Total recalculado por el backend: <strong>{formatMoney(orderResult.total)}</strong></p>
                <p>Pago: <strong>{orderResult.paymentStatus}</strong></p>
                {orderResult.paymentReference && <p>Referencia Payway Sandbox: <strong>{orderResult.paymentReference}</strong></p>}
                {orderResult.paymentStatus === "approved" && (
                  <PaywayInvoiceAction order={orderResult} accessToken={orderResult.accessToken} autoRequest
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
                    Payway Sandbox confirmó el pago. El pedido quedó registrado con sus unidades reservadas.
                  </p>
                )}
                <Link className="button button--gold" to="/productos">Seguir comprando</Link>
              </div>
            ) : items.length || hasCheckoutAttempt ? (
              <>
                {step === 0 ? (
                  <form onSubmit={(event) => event.preventDefault()}>
                    <p className="eyebrow">PASO 1 DE 3</p>
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
                    <p className="eyebrow">PASO 2 DE 3</p>
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
                      <label className="field-label">Tipo de domicilio
                        <select name="residenceType" value={draft.residenceType} onChange={updateField}>
                          <option value="house">Casa</option>
                          <option value="apartment">Departamento</option>
                        </select>
                      </label>
                      {isApartment && <div className="form-grid">
                        <label className="field-label">Piso
                          <input name="floor" maxLength={30} value={draft.floor} onChange={updateField} aria-invalid={Boolean(errors.floor)} />
                          {errors.floor && <span className="field-error">{errors.floor}</span>}
                        </label>
                        <label className="field-label">Departamento
                          <input name="apartment" maxLength={50} value={draft.apartment} onChange={updateField} aria-invalid={Boolean(errors.apartment)} />
                          {errors.apartment && <span className="field-error">{errors.apartment}</span>}
                        </label>
                      </div>}
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

                {step === paymentStep && (
                  <div className="checkout-payment">
                    <div>
                      <p className="eyebrow">PASO 3 DE 3</p>
                      <h2>Pago y facturación</h2>
                    </div>
                    <fieldset className="checkout-billing" disabled={hasCheckoutAttempt || paymentBusy || submitState.busy}>
                      <legend>¿Qué comprobante necesitás?</legend>
                      <label className="checkbox-label">
                        <input type="radio" name="billingMode" value="consumer_final" checked={draft.billingMode === "consumer_final"} onChange={updateField} />
                        Consumidor final
                      </label>
                      <label className="checkbox-label">
                        <input type="radio" name="billingMode" value="fiscal" checked={draft.billingMode === "fiscal"} onChange={updateField} />
                        Factura A
                      </label>
                      {draft.billingMode === "fiscal" && <div className="form-grid">
                        <label className="field-label field-label--full">CUIT
                          <input name="fiscalCuit" value={draft.fiscalCuit} onChange={updateField} inputMode="numeric" maxLength={13}
                            aria-invalid={fiscalDigits.length === 11 && !isValidCuit(fiscalDigits)} />
                          {fiscalDigits.length === 11 && !isValidCuit(fiscalDigits) && <span className="field-error">Ingresá un CUIT válido.</span>}
                        </label>
                        {lookupCuit && (!currentFiscalLookup || currentFiscalLookup.loading) &&
                          <p className="delivery-hint field-label--full" role="status">Consultando el padrón de ARCA…</p>}
                        {currentFiscalLookup?.error && <div className="field-label--full">
                          <p className="field-error" role="alert">{currentFiscalLookup.error}</p>
                          {currentFiscalLookup.code !== "ecommerce-invoice-a-unavailable" &&
                            <button className="delivery-retry" type="button" onClick={() => setFiscalRetry(value => value + 1)}>Volver a consultar</button>}
                        </div>}
                        {((currentFiscalLookup && !currentFiscalLookup.loading) || draft.pendingOrder) && <>
                          <label className="field-label field-label--full">Nombre o razón social
                            <input name="billingName" value={draft.billingName} maxLength={200} onChange={updateField} />
                          </label>
                          <label className="field-label field-label--full">Domicilio fiscal
                            <input name="billingAddress" value={draft.billingAddress} maxLength={300} onChange={updateField} />
                          </label>
                        </>}
                        {fiscalBilling?.name && <p className="delivery-hint field-label--full" role="status">Datos fiscales recuperados de ARCA.</p>}
                      </div>}
                    </fieldset>
                    {hasCheckoutAttempt && <button className="delivery-retry" type="button" disabled={navigatingLocked}
                      onClick={() => changeStep(paymentStep)}>Editar datos de facturación</button>}
                    {submitState.error && <p className="field-error" role="alert">{submitState.error}</p>}
                    {checkoutBlocked && <p className="field-error" role="status">Revisá precio, disponibilidad y entrega para continuar.</p>}
                    <PaywayPaymentForm key={draft.accessToken} order={draft.pendingOrder} accessToken={draft.accessToken}
                      estimate={estimate} prepareOrder={prepareOrder} suggestedAddress={suggestedAddress}
                      allowAddressLookup={config.deliveryAddressEnabled}
                      submitDisabled={paymentDisabled}
                      onBusyChange={busy => {
                        paymentLock.current = busy;
                        setPaymentBusy(busy);
                      }}
                      onStartNewOrder={() => changeStep(paymentStep)}
                      onUpdate={order => setDraft(current => current.accessToken === draft.accessToken
                        ? { ...current, pendingOrder: { ...current.pendingOrder, ...order } } : current)}
                      onApproved={result => finishOrder({ ...result.order, paymentReference: result.gateway.reference, accessToken: draft.accessToken })} />
                    {draft.pendingOrder?.fiscalRetryPending && (
                      <p role="status">El pago simulado quedó registrado. Podés reintentar el plan fiscal para este mismo pedido.</p>
                    )}
                    {simulationCapability.enabled && <div className="pending-panel">
                      <strong>Modo local de prueba para administrador</strong>
                      <p>Este checkout no procesa un pago real. La acción simulará un pago aprobado. Se preparará un plan fiscal de prueba sin solicitar CAE.</p>
                      <button type="button" className="button button--secondary" disabled={paymentDisabled || paymentBusy}
                        onClick={submitSimulatedPayment}>
                        {submitState.busy ? "Procesando…" : draft.pendingOrder ? "Reintentar pago simulado + plan fiscal" : "Simular pago aprobado + factura"}
                      </button>
                    </div>}
                  </div>
                )}

                <div className="checkout-actions">
                  {step > 0 && <button type="button" className="button button--secondary"
                    onClick={() => changeStep(step - 1)} disabled={navigatingLocked}>
                    {step === paymentStep ? "Volver a entrega" : "Volver"}
                  </button>}
                  {step < paymentStep && <button type="button" className="button button--gold" onClick={goNext} disabled={navigatingLocked || needsStockHold}>
                    Continuar
                  </button>}
                </div>
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
